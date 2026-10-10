/**
 * A troca voluntária de WhatsApp na bancada: o banco, a VPS e o Bridge
 * simulados em memória, com as regras do contrato de verdade (migration
 * 20261012100000 e troca.go do Bridge). Serve para ver a tela inteira sem
 * número real: A conectado → desconectado → B esperado → QR → B conectado, e
 * as falhas que se recuperam.
 *
 * Parâmetros da URL (dev-gestao.html?tela=conexoes&...):
 *   troca=direct|whatsapp_code|off  a liberação da conexão (padrão: direct)
 *   troca-equipe=nao                quem olha não administra a plataforma
 *   troca-vps=fora                  a primeira aplicação falha (bridge_offline)
 *   troca-runtime=fora              a VPS está calada desde o início (nada começa)
 *   troca-runtime=cai               a VPS cai logo depois da confirmação: o
 *                                   pedido fica parado na fila, cancelável
 *   troca-qr=outro                  o QR é lido por outro número
 *   vinculado=1                     a bancada já abre vinculada (stub.js)
 *
 * No modo com código, o código da bancada é sempre a1b2c3d4.
 *
 * Nada disto vai para o portal: a bancada só existe no `npm run dev`.
 */

export const CONEXAO_DA_TROCA = "dev-conexao-major-vps";
export const CODIGO_DA_BANCADA = "a1b2c3d4";

const TEMPO_ATE_A_VPS_PEGAR_MS = 1500;
const TEMPO_ATE_APLICAR_MS = 2500;
const TEMPO_ATE_LER_O_QR_MS = 6000;
const JANELA_DE_CONFIRMACAO_MS = 10 * 60 * 1000;

const agora = () => new Date().toISOString();
const final = (digitos) => String(digitos || "").slice(-4);
const mascara = (digitos) => `•••• ${final(digitos)}`;

function normalizar(texto) {
  const digitos = String(texto || "").replace(/\D/g, "");
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
}

// O mesmo celular com e sem o nono dígito, como o banco e o Bridge comparam.
function variantes(digitos) {
  if (digitos.length === 13 && digitos.startsWith("55") && digitos[4] === "9") {
    return [digitos, digitos.slice(0, 4) + digitos.slice(5)];
  }
  if (digitos.length === 12 && digitos.startsWith("55")) {
    return [digitos, `${digitos.slice(0, 4)}9${digitos.slice(4)}`];
  }
  return [digitos];
}

export function conexaoDaTrocaInicial() {
  return {
    connectionId: CONEXAO_DA_TROCA,
    organizationId: "dev-org",
    name: "WhatsApp da Major (VPS)",
    host: "VPS do Núcleo",
    runtime: "online",
    remoteManaged: true,
    controlPlane: { heartbeat_at: agora(), fresh: true },
    expectedPhoneMasked: mascara("556599998362"),
    connection: {
      status: "connected",
      phoneMasked: mascara("556599998362"),
      sendBlocked: false,
      updatedAt: agora(),
    },
  };
}

/**
 * `ler()` devolve a conexão como a bancada a guarda; `gravar(mudanca)` muda
 * os campos dela. O resto (pedidos, geração, liberação) mora aqui dentro.
 */
export function criarTrocaDev({ ler, gravar, parametros = new URLSearchParams() }) {
  const pedidoDeModo = parametros.get("troca");
  const config = {
    modo: ["direct", "whatsapp_code", "off"].includes(pedidoDeModo) ? pedidoDeModo : "direct",
    equipe: parametros.get("troca-equipe") !== "nao",
    vpsFalha: parametros.get("troca-vps") === "fora",
    vpsCai: parametros.get("troca-runtime") === "cai",
    qrOutro: parametros.get("troca-qr") === "outro",
  };
  const banco = {
    geracao: 0,
    liberadaEm: null,
    esperado: "556599998362",
    pedido: null,
    chaves: new Map(),
    vpsCalada: parametros.get("troca-runtime") === "fora",
  };

  const status = () => ler()?.connection?.status || "whatsapp_disconnected";
  const ator = () => (config.modo === "direct" ? config.equipe : config.modo !== "off");

  function visao(pedido) {
    if (!pedido) return null;
    return {
      requestId: pedido.id,
      kind: pedido.kind,
      status: pedido.status,
      reason: "voluntary",
      confirmationMethod: pedido.metodo,
      oldLast4: pedido.antigo,
      newLast4: pedido.novo ? final(pedido.novo) : null,
      importHistory: pedido.importar,
      mine: true,
      confirmUntil: pedido.ate,
      attemptsLeft: 5 - pedido.tentativas,
      sendsLeft: 3 - pedido.envios,
      confirmedAt: pedido.confirmadoEm,
      generation: pedido.geracao,
      appliedAt: pedido.aplicadoEm,
      remoteLogout: pedido.remoto,
      errorCode: pedido.erro,
      createdAt: pedido.criadoEm,
      commandStatus: pedido.comando,
    };
  }

  function exigirLiberacao(metodo = null) {
    if (config.modo === "off") throw new Error("connection change is not enabled for this connection");
    if (metodo && metodo !== config.modo) throw new Error("connection change policy changed; start again");
    if (config.modo === "direct" && !config.equipe) {
      throw new Error("direct connection change requires a platform administrator");
    }
  }

  function exigirPedido(pedidoId) {
    if (!banco.pedido || banco.pedido.id !== pedidoId) throw new Error("change request not found");
    return banco.pedido;
  }

  // A fila e o gatilho: pending → claimed → applied (ou failed).
  function aplicarNaVps(pedido) {
    banco.geracao += 1;
    pedido.geracao = banco.geracao;
    pedido.status = "queued";
    pedido.comando = "pending";
    pedido.erro = null;
    pedido.confirmadoEm ||= agora();
    if (config.vpsCai) {
      // A VPS para de responder: o pedido fica na fila até ela voltar ou
      // alguém cancelar. Nada se aplica sozinho.
      banco.vpsCalada = true;
      return;
    }
    const geracao = pedido.geracao;
    setTimeout(() => {
      if (pedido.status !== "queued" || pedido.geracao !== geracao) return;
      pedido.status = "running";
      pedido.comando = "claimed";
      setTimeout(() => {
        if (config.vpsFalha) {
          // A próxima tentativa passa: é o "Tentar de novo" que se quer ver.
          config.vpsFalha = false;
          pedido.status = "failed";
          pedido.comando = "failed";
          pedido.erro = "bridge_offline";
          return;
        }
        // Sem sessão (já desconectada), não há desligamento a confirmar.
        const tinhaSessao = ["connected", "identity_mismatch", "reconnecting"].includes(status());
        pedido.remoto = tinhaSessao ? true : null;
        pedido.status = "applied";
        pedido.comando = "completed";
        pedido.aplicadoEm = agora();
        banco.liberadaEm = agora();
        if (pedido.kind === "change_number") banco.esperado = pedido.novo;
        // O Bridge desligou a sessão e reiniciou esperando o portal.
        gravar({
          expectedPhoneMasked: mascara(banco.esperado),
          connection: { status: "whatsapp_disconnected", phoneMasked: null, sendBlocked: false, updatedAt: agora() },
        });
      }, TEMPO_ATE_APLICAR_MS);
    }, TEMPO_ATE_A_VPS_PEGAR_MS);
  }

  const operacoes = {
    "gateway.trocaEstado": async ({ connectionId } = {}) => {
      if (connectionId !== CONEXAO_DA_TROCA) {
        return { mode: "off", actorAllowed: false, sessionReleasedAt: null, request: null, identity: null, runtime: null };
      }
      return {
        mode: config.modo,
        actorAllowed: ator(),
        sessionReleasedAt: banco.liberadaEm,
        request: visao(banco.pedido),
        identity: { last4: final(banco.esperado), generation: banco.geracao },
        runtime: { whatsappStatus: status(), fresh: !banco.vpsCalada, heartbeatAt: agora() },
      };
    },

    "gateway.trocaIniciar": async ({ tipo, telefone = null, importarHistorico = false, chave } = {}) => {
      if (chave && banco.chaves.has(chave)) return { ...visao(banco.chaves.get(chave)), repeated: true };
      exigirLiberacao();
      if (!["disconnect", "change_number"].includes(tipo)) throw new Error("change kind is invalid");
      let novo = null;
      if (tipo === "change_number") {
        novo = normalizar(telefone);
        if (!/^[1-9][0-9]{9,14}$/.test(novo)) throw new Error("invalid phone");
        if (variantes(novo).includes(banco.esperado)) throw new Error("same number: reconnect instead of changing");
      }
      if (banco.vpsCalada) throw new Error("runtime is not online");
      const conectado = status() === "connected";
      if (!conectado && (config.modo === "whatsapp_code" || !banco.liberadaEm)) {
        throw new Error("old whatsapp is not connected");
      }
      if (banco.pedido && ["queued", "running"].includes(banco.pedido.status)) {
        throw new Error("a confirmed change is already in progress");
      }
      if (banco.pedido?.status === "awaiting_confirmation") banco.pedido.status = "superseded";
      const pedido = {
        id: globalThis.crypto?.randomUUID?.() || `pedido-${Date.now()}`,
        kind: tipo,
        status: "awaiting_confirmation",
        metodo: config.modo,
        antigo: final(banco.esperado),
        novo,
        importar: tipo === "change_number" && Boolean(importarHistorico),
        ate: new Date(Date.now() + JANELA_DE_CONFIRMACAO_MS).toISOString(),
        tentativas: 0,
        envios: config.modo === "whatsapp_code" ? 1 : 0,
        confirmadoEm: null,
        geracao: null,
        aplicadoEm: null,
        remoto: null,
        erro: null,
        criadoEm: agora(),
        comando: null,
      };
      if (config.modo === "whatsapp_code") {
        console.info(`[bancada] código da troca no WhatsApp final ${pedido.antigo}: ${CODIGO_DA_BANCADA}`);
      }
      banco.pedido = pedido;
      if (chave) banco.chaves.set(chave, pedido);
      return { ...visao(pedido), repeated: false };
    },

    "gateway.trocaConfirmar": async ({ pedidoId, codigo = null } = {}) => {
      const pedido = exigirPedido(pedidoId);
      if (pedido.status !== "awaiting_confirmation") {
        return { confirmed: false, result: "not-awaiting-confirmation", ...visao(pedido) };
      }
      exigirLiberacao(pedido.metodo);
      if (Date.parse(pedido.ate) <= Date.now()) return { confirmed: false, result: "expired", ...visao(pedido) };
      if (pedido.metodo === "whatsapp_code") {
        if (pedido.tentativas >= 5) return { confirmed: false, result: "too-many-attempts", ...visao(pedido) };
        if (String(codigo || "").toLowerCase() !== CODIGO_DA_BANCADA) {
          pedido.tentativas += 1;
          return { confirmed: false, result: "invalid-code", ...visao(pedido) };
        }
      }
      aplicarNaVps(pedido);
      return { confirmed: true, ...visao(pedido) };
    },

    "gateway.trocaReenviar": async ({ pedidoId } = {}) => {
      const pedido = exigirPedido(pedidoId);
      if (pedido.metodo !== "whatsapp_code") throw new Error("this change is not confirmed by code");
      if (pedido.envios >= 3) throw new Error("code send limit reached");
      pedido.envios += 1;
      pedido.tentativas = 0;
      pedido.ate = new Date(Date.now() + JANELA_DE_CONFIRMACAO_MS).toISOString();
      console.info(`[bancada] código reenviado: ${CODIGO_DA_BANCADA}`);
      return visao(pedido);
    },

    "gateway.trocaCancelar": async ({ pedidoId } = {}) => {
      const pedido = exigirPedido(pedidoId);
      const cancelavel = pedido.status === "awaiting_confirmation"
        || (["queued", "failed", "expired"].includes(pedido.status) && pedido.comando !== "claimed");
      if (!cancelavel) {
        return { cancelled: false, result: pedido.status === "running" ? "in-progress" : "not-cancellable", ...visao(pedido) };
      }
      pedido.status = "cancelled";
      return { cancelled: true, ...visao(pedido) };
    },

    "gateway.trocaRepetir": async ({ pedidoId } = {}) => {
      const pedido = exigirPedido(pedidoId);
      if (!["failed", "expired"].includes(pedido.status) || !pedido.confirmadoEm) {
        throw new Error("change request cannot be retried");
      }
      exigirLiberacao(pedido.metodo);
      aplicarNaVps(pedido);
      return visao(pedido);
    },
  };

  return {
    operacoes,
    ehDaTroca: (connectionId) => connectionId === CONEXAO_DA_TROCA,
    /**
     * Ler o QR na bancada: alguns segundos depois do pedido de pareamento, o
     * número esperado conecta (ou outro número, com `troca-qr=outro`, e a
     * conexão cai em identity_mismatch com o envio bloqueado).
     */
    simularLeituraDoQr() {
      setTimeout(() => {
        if (ler()?.connection?.status !== "awaiting_qr") return;
        if (config.qrOutro) {
          gravar({
            connection: {
              status: "identity_mismatch",
              phoneMasked: "•••• 0000",
              expectedPhoneMasked: mascara(banco.esperado),
              sendBlocked: true,
              updatedAt: agora(),
            },
          });
          return;
        }
        // Conectou o número certo: a liberação acaba, como no banco.
        banco.liberadaEm = null;
        gravar({ connection: { status: "connected", phoneMasked: mascara(banco.esperado), sendBlocked: false, updatedAt: agora() } });
      }, TEMPO_ATE_LER_O_QR_MS);
    },
  };
}
