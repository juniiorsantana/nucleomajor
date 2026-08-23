/**
 * Cliente do gateway local, escopado por workspace e conexão.
 *
 * O que mudou em relação à versão singleton, e por quê:
 *
 * 1. Não existe mais `emyleads.gateway.token`. Uma chave global significava
 *    que trocar de empresa mantinha a credencial da anterior viva — e uma
 *    credencial viva do workspace errado é acesso cruzado, não inconveniência.
 *    Agora o índice é `organizationId : connectionId : installationId`.
 * 2. Toda operação exige a organização. O provider nunca deduz workspace do
 *    que está guardado; quem manda é quem chamou, e o gateway ainda confere do
 *    lado dele.
 * 3. `descarregar` existe para a troca de workspace. Sem ela, o polling da
 *    tela anterior continuaria consultando conexões que o usuário deixou para
 *    trás.
 */

const GATEWAY_ORIGIN = "http://127.0.0.1:8090";
const GATEWAY_BASE = `${GATEWAY_ORIGIN}/api/v1`;
const CHAVE_CREDENCIAIS = "emyleads.gateway.credenciais";
const CHAVE_INSTALACAO = "emyleads.gateway.instalacao";
const TIMEOUT_MS = 4000;

/** Escopo de organização: vale para todas as conexões daquele workspace. */
const ORGANIZACAO_INTEIRA = "*";

function erroGateway(mensagem, codigo, extras = {}) {
  const erro = new Error(mensagem);
  erro.codigo = codigo;
  Object.assign(erro, extras);
  return erro;
}

function exigirOrganizacao(organizationId) {
  const limpo = String(organizationId || "").trim();
  if (!limpo) {
    throw erroGateway("Selecione uma empresa antes de operar conexões.", "workspace-ausente");
  }
  return limpo;
}

function chave(organizationId, connectionId, installationId) {
  return `${organizationId}:${connectionId || ORGANIZACAO_INTEIRA}:${installationId}`;
}

/**
 * Quem está assumindo, no formato que o gateway espera.
 *
 * Vai vazio quando não há pessoa: um chatbot que transfere para "humano" está
 * dizendo "alguém pegue", não "Ana pegou". Inventar um atendente ali faria a
 * fila de quem precisa de gente parecer já atendida.
 *
 * O nome viaja junto do id porque o gateway não tem como traduzir um do outro
 * — ele não tem credencial do Supabase. Sem isto, o painel mostra um UUID.
 */
function identidade(atendente) {
  const id = String(atendente?.id || "").trim();
  if (!id) return {};
  return { attendantId: id, attendantName: String(atendente?.nome || "").trim() };
}

/** Só dígitos. O bridge chaveia a sessão pelo que o WhatsApp devolve. */
function digitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

/**
 * Qual conexão corresponde à aba do operador.
 *
 * Os dois são o mesmo número, mas nada os liga programaticamente — a única
 * ponte que existe hoje é o próprio número. Com uma conexão só e sem leitura
 * da aba, usa essa: é a resposta certa no caso comum, e o alternativo seria
 * recusar toda operação enquanto o content script não reportasse.
 *
 * Devolve `null` quando não dá para decidir. Chutar entre várias conexões
 * mandaria a operação para o número errado.
 */
function encontrarConexaoNaLista(lista, conexaoLast4) {
  const alvo = digitos(conexaoLast4).slice(-4);
  if (!alvo) return lista.length === 1 ? lista[0] : null;
  return lista.find((c) => digitos(c.connection?.phoneMasked).slice(-4) === alvo) || null;
}

async function instalacaoAtual() {
  const dados = await chrome.storage.local.get(CHAVE_INSTALACAO);
  const existente = dados[CHAVE_INSTALACAO];
  if (existente) return existente;

  // Identifica esta máquina, não o usuário. Serve para revogar uma instalação
  // sem derrubar as outras do mesmo workspace.
  const id = `chrome-${crypto.randomUUID().replace(/-/g, "")}`;
  await chrome.storage.local.set({ [CHAVE_INSTALACAO]: id });
  return id;
}

async function todasAsCredenciais() {
  const dados = await chrome.storage.local.get(CHAVE_CREDENCIAIS);
  return dados[CHAVE_CREDENCIAIS] || {};
}

/**
 * Devolve a credencial mais específica que sirva: a da conexão, se existir, e
 * senão a do workspace. Uma credencial de outra organização nunca entra aqui —
 * a chave não bate.
 */
async function credencial(organizationId, connectionId) {
  const instalacao = await instalacaoAtual();
  const guardadas = await todasAsCredenciais();
  return (
    guardadas[chave(organizationId, connectionId, instalacao)] ||
    guardadas[chave(organizationId, null, instalacao)] ||
    ""
  );
}

/**
 * Qualquer credencial desta máquina que alcance esta organização.
 *
 * O código de vínculo é emitido **por conexão**, então a credencial que sai do
 * bootstrap é escopada à conexão, não à organização. Procurar só a chave de
 * organização fazia a tela dizer "não vinculado" logo depois de um vínculo
 * bem-sucedido — e o operador tentava de novo com um código já consumido.
 *
 * Preferir a de organização quando existir: ela enxerga todas as conexões do
 * workspace, enquanto a escopada enxerga uma só.
 */
async function credencialDaOrganizacao(organizationId) {
  const instalacao = await instalacaoAtual();
  const guardadas = await todasAsCredenciais();

  const daOrganizacao = guardadas[chave(organizationId, null, instalacao)];
  if (daOrganizacao) return daOrganizacao;

  const prefixo = `${organizationId}:`;
  const sufixo = `:${instalacao}`;
  const escopada = Object.keys(guardadas).find(
    (k) => k.startsWith(prefixo) && k.endsWith(sufixo)
  );
  return escopada ? guardadas[escopada] : "";
}

async function guardarCredencial({ organizationId, connectionId, installationId, token }) {
  const guardadas = await todasAsCredenciais();
  guardadas[chave(organizationId, connectionId, installationId)] = token;
  await chrome.storage.local.set({ [CHAVE_CREDENCIAIS]: guardadas });
}

async function esquecerCredenciais(predicado) {
  const guardadas = await todasAsCredenciais();
  const restantes = Object.fromEntries(
    Object.entries(guardadas).filter(([k]) => !predicado(k))
  );
  await chrome.storage.local.set({ [CHAVE_CREDENCIAIS]: restantes });
}

async function requisitar(caminho, { method = "GET", body, token = "", base = GATEWAY_BASE } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(`${base}${caminho}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const codigos = {
        401: "gateway-nao-autorizado",
        403: "conexao-proibida",
        404: "conexao-desconhecida",
      };
      throw erroGateway(
        dados?.message || dados?.error || "O gateway local recusou a operação.",
        codigos[resposta.status] || "gateway-resposta",
        { status: resposta.status }
      );
    }
    return dados;
  } catch (erro) {
    if (erro?.codigo) throw erro;
    const expirou = erro?.name === "AbortError";
    throw erroGateway(
      expirou
        ? "O gateway local demorou para responder."
        : "O serviço local de conexões está offline.",
      expirou ? "gateway-timeout" : "gateway-offline"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function criarOperacoesGateway() {
  /**
   * Faz a chamada com a credencial certa e limpa a credencial quando ela
   * deixa de valer. Guardar um token que o gateway já rejeitou só produziria
   * uma tela que insiste em falhar.
   */
  const comCredencial = async (organizationId, connectionId, executar) => {
    const token = await credencial(organizationId, connectionId);
    if (!token) {
      throw erroGateway("Vincule esta máquina ao serviço local.", "gateway-nao-vinculado");
    }
    try {
      return await executar(token);
    } catch (erro) {
      if (erro.codigo === "gateway-nao-autorizado") {
        const instalacao = await instalacaoAtual();
        await esquecerCredenciais(
          (k) =>
            k === chave(organizationId, connectionId, instalacao) ||
            k === chave(organizationId, null, instalacao)
        );
      }
      throw erro;
    }
  };

  const conexoes = async ({ organizationId } = {}) => {
    const organizacao = exigirOrganizacao(organizationId);
    const token = await credencialDaOrganizacao(organizacao);
    if (!token) {
      return { organizationId: organizacao, vinculado: false, gateway: "nao-vinculado", conexoes: [] };
    }

    try {
      const resposta = await requisitar("/connections", { token });
      return {
        organizationId: organizacao,
        vinculado: true,
        gateway: "online",
        conexoes: resposta.connections || [],
      };
    } catch (erro) {
      if (erro.codigo === "gateway-nao-autorizado") {
        const instalacao = await instalacaoAtual();
        await esquecerCredenciais((k) => k.startsWith(`${organizacao}:`) && k.endsWith(`:${instalacao}`));
        return { organizationId: organizacao, vinculado: false, gateway: "nao-autorizado", conexoes: [] };
      }
      if (erro.codigo === "gateway-offline" || erro.codigo === "gateway-timeout") {
        return {
          organizationId: organizacao,
          vinculado: true,
          gateway: "offline",
          conexoes: [],
          erro: erro.message,
        };
      }
      throw erro;
    }
  };

  /**
   * A conexão desta aba, ou um erro explícito.
   *
   * Falha em vez de devolver nada: uma transferência que não acontece é o
   * pior caso do fluxo quando o destino é humano — o cliente avisado de que
   * alguém vai atender e o robô seguindo em frente.
   */
  const resolverPelaAba = async (organizationId, conexaoLast4) => {
    const { conexoes: lista } = await conexoes({ organizationId });
    const alvo = encontrarConexaoNaLista(lista, conexaoLast4);
    if (!alvo) {
      throw erroGateway(
        "Não foi possível identificar a conexão desta aba do WhatsApp.",
        "transferencia-sem-conexao"
      );
    }
    return alvo;
  };

  return {
    "gateway.conexoes": conexoes,

    "gateway.prontidao": async ({ organizationId, connectionId } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const resposta = await comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/readiness`, { token })
      );
      return resposta.readiness || null;
    },

    "gateway.vincular": async ({ organizationId, code } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const limpo = String(code || "").trim().toUpperCase();
      if (!limpo) throw erroGateway("Informe o código mostrado na página local.", "bootstrap-vazio");

      const instalacao = await instalacaoAtual();
      const resposta = await requisitar("/bootstrap", {
        method: "POST",
        body: { code: limpo, installationId: instalacao },
      });
      if (!resposta.token) {
        throw erroGateway("O gateway não devolveu uma credencial.", "bootstrap-invalido");
      }
      // Gateway anterior ao multi-tenant: devolve um token sem escopo nenhum.
      // Distinguir isso de um código de outra empresa importa — são problemas
      // diferentes, e tratar os dois como "empresa errada" mandaria o operador
      // procurar o erro no lugar errado.
      if (!resposta.organizationId) {
        throw erroGateway(
          "O serviço local está numa versão anterior às conexões por empresa. Atualize e reinicie o gateway.",
          "gateway-desatualizado"
        );
      }
      // O escopo é o que o gateway devolveu, nunca o que a tela supôs. Um
      // código emitido para outra empresa não vira credencial desta.
      if (resposta.organizationId !== organizacao) {
        throw erroGateway(
          "Este código pertence a outra empresa. Confira o workspace selecionado.",
          "bootstrap-outro-workspace"
        );
      }
      await guardarCredencial({
        organizationId: resposta.organizationId,
        connectionId: resposta.connectionId || null,
        installationId: resposta.installationId || instalacao,
        token: resposta.token,
      });
      return conexoes({ organizationId: organizacao });
    },

    "gateway.criar": async ({ organizationId, connectionId, nome } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      return comCredencial(organizacao, null, (token) =>
        requisitar("/connections", {
          method: "POST",
          body: { connectionId, name: String(nome || "").trim() },
          token,
        })
      );
    },

    "gateway.parear": async ({ organizationId, connectionId } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      return comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/pairing/start`, { method: "POST", body: {}, token })
      );
    },

    "gateway.qr": async ({ organizationId, connectionId } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const resposta = await comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/pairing/qr`, { token })
      );
      return resposta.pairing || null;
    },

    "gateway.reconectar": async ({ organizationId, connectionId } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      return comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/reconnect`, { method: "POST", body: {}, token })
      );
    },

    "gateway.identidade": async ({ organizationId, connectionId } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const resposta = await comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/verify-identity`, { method: "POST", body: {}, token })
      );
      return resposta.identity || null;
    },

    /**
     * Envia somente o desafio criado pelo RPC de operadores. O bridge recebe
     * a organizacao e a conexao e confere os dois contra o estado real antes
     * de enviar. O provider nao expõe a rota generica de mensagens para a
     * equipe.
     */
    "gateway.enviarCodigoOperador": async ({ organizationId, connectionId, recipient, code } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      return comCredencial(organizacao, connectionId, (token) =>
        requisitar("/api/operator-verification/send", {
          // O navegador fala somente com o gateway. Ele valida a credencial
          // da instalação e encaminha o desafio ao Bridge com o token interno
          // correto, que nunca fica exposto na extensão.
          base: GATEWAY_ORIGIN,
          method: "POST",
          body: {
            organization_id: organizacao,
            connection_id: connectionId,
            recipient: digitos(recipient),
            code: String(code || "").trim(),
          },
          token,
        })
      );
    },

    "gateway.revogar": async ({ organizationId, connectionId } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const resultado = await comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/revoke`, { method: "POST", body: {}, token })
      );
      const instalacao = await instalacaoAtual();
      await esquecerCredenciais((k) => k === chave(organizacao, connectionId, instalacao));
      return resultado;
    },

    /**
     * Entrega uma conversa a outro dono — o bloco de transferência do fluxo.
     *
     * Resolve a conexão pelo número: a conexão desta aba é a que tem o mesmo
     * WhatsApp que está logado no navegador. É a mesma correspondência que a
     * tela de Conexões mostra, e é a única ponte que existe hoje entre a aba e
     * o bridge — os dois são o mesmo número, mas nada os liga programaticamente.
     *
     * Falha explícita quando não dá para resolver. Uma transferência que não
     * acontece precisa aparecer no diário: o pior caso é o cliente ser avisado
     * de que alguém vai atender e o robô seguir respondendo.
     */
    "gateway.transferirConversa": async ({ organizationId, conexaoLast4, contato, destino, motivo, atendente = null, agente = null } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const numero = digitos(contato);
      if (!numero) throw erroGateway("Contato sem telefone para transferir.", "transferencia-sem-contato");

      const alvo = await resolverPelaAba(organizacao, conexaoLast4);
      return comCredencial(organizacao, alvo.connectionId, (token) =>
        requisitar(`/connections/${alvo.connectionId}/conversation`, {
          method: "POST",
          body: {
            contact: numero,
            owner: destino,
            reason: motivo || "",
            ...identidade(atendente),
            ...(agente?.id ? { agentId: agente.id, agentName: agente.nome || "" } : {}),
          },
          token,
        })
      );
    },

    /**
     * O interruptor da IA numa conexão, e quem atende uma conversa nova.
     *
     * Quem guarda é o gateway, não a interface — a tela pode estar fechada
     * quando o bot erra na frente de um cliente. Aqui só se comanda.
     */
    "gateway.automacao": async ({ organizationId, connectionId, iaAtiva, defaultOwner } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      return comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/automation`, {
          method: "POST",
          body: {
            iaAtiva: !!iaAtiva,
            ...(defaultOwner ? { defaultOwner } : {}),
          },
          token,
        })
      );
    },

    /** Sessões de atendimento e o resumo da conexão, numa consulta só. */
    "gateway.resumoAtendimento": async ({ organizationId, connectionId, abertas = true } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const caminho = `/connections/${connectionId}/conversations${abertas ? "" : "?closed=1"}`;
      return comCredencial(organizacao, connectionId, (token) => requisitar(caminho, { token }));
    },

    "gateway.definirDonoConversa": async ({ organizationId, connectionId, contato, dono, motivo, atendente = null } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const numero = digitos(contato);
      if (!numero) throw erroGateway("Contato sem telefone.", "atendimento-sem-contato");

      return comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/conversation`, {
          method: "POST",
          body: { contact: numero, owner: dono, reason: motivo || "", ...identidade(atendente) },
          token,
        })
      );
    },

    /**
     * Finalizar não é ignorar: a próxima mensagem abre sessão nova e é
     * atendida. "Finalizada" é escrituração nossa — o WhatsApp não tem fim de
     * conversa.
     */
    "gateway.encerrarAtendimento": async ({ organizationId, connectionId, contato, motivo } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const numero = digitos(contato);
      if (!numero) throw erroGateway("Contato sem telefone.", "atendimento-sem-contato");

      return comCredencial(organizacao, connectionId, (token) =>
        requisitar(`/connections/${connectionId}/conversation/close`, {
          method: "POST",
          body: { contact: numero, reason: motivo || "" },
          token,
        })
      );
    },

    /**
     * Quem atende a conversa aberta nesta aba.
     *
     * Só leitura, e resolvida pela aba porque o content script não conhece
     * `connectionId` — ele conhece o número logado no navegador.
     */
    "gateway.statusConversaAtual": async ({ organizationId, contato, conexaoLast4 } = {}) => {
      const organizacao = exigirOrganizacao(organizationId);
      const numero = digitos(contato);
      if (!numero) throw erroGateway("Contato sem telefone.", "atendimento-sem-contato");

      const alvo = await resolverPelaAba(organizacao, conexaoLast4);
      const resposta = await comCredencial(organizacao, alvo.connectionId, (token) =>
        requisitar(`/connections/${alvo.connectionId}/conversations`, { token })
      );

      return {
        connectionId: alvo.connectionId,
        iaAtiva: !!resposta.iaAtiva,
        donoPadrao: resposta.donoPadrao || null,
        sessao: (resposta.conversations || []).find((s) => digitos(s.contact) === numero) || null,
      };
    },

    /**
     * Chamado na troca de workspace. Descarrega a credencial da empresa que
     * ficou para trás: um token que sobrevive à troca é acesso que o usuário
     * acha que encerrou.
     */
    "gateway.descarregar": async ({ organizationId } = {}) => {
      if (!organizationId) {
        await chrome.storage.local.remove(CHAVE_CREDENCIAIS);
        return { descarregado: "tudo" };
      }
      const organizacao = String(organizationId).trim();
      await esquecerCredenciais((k) => k.startsWith(`${organizacao}:`));
      return { descarregado: organizacao };
    },
  };
}
