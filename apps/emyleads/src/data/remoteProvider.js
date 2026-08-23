import * as db from "./db.js";
import { ESTAGIOS_PADRAO, TAGS_PADRAO } from "../domain/types.js";
import { planejarMigracao } from "./migrationMapper.js";
import { obterSupabase } from "./supabaseClient.js";

const WORKSPACE_KEY = "emyleads.workspace.atual";
const SNAPSHOT_CHAVE = "migracao-snapshot";
const SNAPSHOT_ESTADO_CHAVE = "migracao-snapshot-estado";
const SNAPSHOT_CONCLUIDO_CHAVE = "migracao-snapshot-concluida";
const OUTBOX_PENDENTE = "pendente";
const OUTBOX_PROCESSANDO = "processando";
const OUTBOX_ERRO = "erro";
const BATCH = 250;

const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const aleatorio = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${aleatorio()}-${aleatorio().slice(0, 4)}-4${aleatorio().slice(1, 4)}-${aleatorio().slice(0, 4)}-${aleatorio()}${aleatorio()}`;
};

const UUID_ANY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const uuidRemotoValido = (valor) => UUID_ANY_RE.test(String(valor || ""));

const iso = (valor, fallback = Date.now()) =>
  valor == null ? new Date(fallback).toISOString() : new Date(valor).toISOString();
const epoch = (valor) => (valor == null ? null : new Date(valor).getTime());
const semNulo = (valor, fallback = "") => valor ?? fallback;

const assinaturaPacote = (pacote) => JSON.stringify({
  contatos: pacote.contatos.map((item) => [item.id, item.atualizadoEm, item.avatarPath || null, item.fotoUrl ? [item.fotoUrl.length, item.fotoUrl.slice(0, 32)] : null]),
  negocios: pacote.negocios.map((item) => [item.id, item.atualizadoEm]),
  tarefas: pacote.tarefas.map((item) => [item.id, item.criadoEm, item.concluida, item.concluidaEm]),
  notas: pacote.notas.map((item) => [item.id, item.criadoEm]),
  eventos: (pacote.eventos || []).map((item) => [item.id, item.ocorridoEm, item.criadoEm]),
  estagios: pacote.estagios.map((item) => [item.id, item.nome, item.ordem]),
  tags: pacote.tags.map((item) => [item.id, item.nome, item.cor]),
});

const CAMPOS_VALIDACAO = {
  stages: ["legacy_id", "name", "position", "deleted_at"],
  tags: ["legacy_id", "name", "color", "deleted_at"],
  contacts: ["legacy_id", "name", "phone", "whatsapp_id", "company", "job_title", "email", "source", "owner_label", "avatar_path", "last_interaction_at", "created_at", "deleted_at"],
  deals: ["legacy_id", "contact_id", "stage_id", "title", "value", "source", "status", "loss_reason", "created_at", "deleted_at"],
  tasks: ["legacy_id", "contact_id", "deal_id", "title", "due_at", "completed", "completed_at", "owner_label", "created_at", "deleted_at"],
  notes: ["legacy_id", "contact_id", "body", "author_label", "created_at", "deleted_at"],
  events: ["legacy_id", "contact_id", "event_type", "entity_type", "entity_id", "source", "payload", "occurred_at", "created_at"],
};
const CAMPOS_DATA = new Set(["created_at", "last_interaction_at", "due_at", "completed_at", "occurred_at"]);

function serializarOrdenado(valor) {
  if (Array.isArray(valor)) return `[${valor.map(serializarOrdenado).join(",")}]`;
  if (valor && typeof valor === "object") {
    return `{${Object.keys(valor).sort().map((chave) => `${JSON.stringify(chave)}:${serializarOrdenado(valor[chave])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

function valorParaComparacao(valor, campo) {
  if (valor === undefined) return null;
  if (valor === null || valor === "") return valor === "" && campo === "value" ? "" : valor;
  if (CAMPOS_DATA.has(campo)) return new Date(valor).getTime();
  if (campo === "payload") return serializarOrdenado(valor);
  if (campo === "value") return String(valor);
  return valor;
}

const temDadosMigraveis = (pacote) => {
  const entidades = pacote.contatos.length + pacote.negocios.length + pacote.tarefas.length + pacote.notas.length + (pacote.eventos?.length || 0);
  const estagiosPersonalizados = JSON.stringify(pacote.estagios.map(({ id, nome, ordem }) => ({ id, nome, ordem }))) !== JSON.stringify(ESTAGIOS_PADRAO);
  const tagsPersonalizadas = JSON.stringify(pacote.tags.map(({ id, nome, cor }) => ({ id, nome, cor }))) !== JSON.stringify(TAGS_PADRAO);
  return entidades > 0 || estagiosPersonalizados || tagsPersonalizadas;
};

const tempoMigracao = (valor, fallback = null) => {
  if (valor === null || valor === undefined || valor === "") return fallback;
  const convertido = typeof valor === "number" ? valor : new Date(valor).getTime();
  return Number.isFinite(convertido) && convertido >= 0 ? convertido : fallback;
};

// A base antiga não tinha contrato de data rígido. Um registro corrompido não
// pode impedir a entrada no painel nem invalidar toda a cópia para a nuvem.
const normalizarPacoteMigracao = (pacote) => {
  const agora = Date.now();
  const contatos = (pacote.contatos || []).map((item) => ({
    ...item,
    criadoEm: tempoMigracao(item.criadoEm, agora),
    atualizadoEm: tempoMigracao(item.atualizadoEm, tempoMigracao(item.criadoEm, agora)),
    ultimaEm: tempoMigracao(item.ultimaEm),
  }));
  const negocios = (pacote.negocios || []).map((item) => ({
    ...item,
    criadoEm: tempoMigracao(item.criadoEm, agora),
    atualizadoEm: tempoMigracao(item.atualizadoEm, tempoMigracao(item.criadoEm, agora)),
  }));
  const tarefas = (pacote.tarefas || []).map((item) => ({
    ...item,
    criadoEm: tempoMigracao(item.criadoEm, agora),
    atualizadoEm: tempoMigracao(item.atualizadoEm, tempoMigracao(item.criadoEm, agora)),
    venceEm: tempoMigracao(item.venceEm),
    concluidaEm: tempoMigracao(item.concluidaEm),
  }));
  const notas = (pacote.notas || []).map((item) => ({
    ...item,
    criadoEm: tempoMigracao(item.criadoEm, agora),
    atualizadoEm: tempoMigracao(item.atualizadoEm, tempoMigracao(item.criadoEm, agora)),
  }));
  const eventos = (pacote.eventos || []).map((item) => ({
    ...item,
    ocorridoEm: tempoMigracao(item.ocorridoEm, agora),
    criadoEm: tempoMigracao(item.criadoEm, agora),
  }));
  return { ...pacote, contatos, negocios, tarefas, notas, eventos };
};

const ENTIDADES = {
  estagios: {
    loja: db.LOJAS.estagios,
    tabela: "stages",
    id: "id",
    paraRemoto: (r, organizationId, remoteId) => ({
      id: remoteId, organization_id: organizationId, legacy_id: r.id,
      name: r.nome, position: r.ordem, deleted_at: null,
    }),
    doRemoto: (r, id) => ({
      id, remoteId: r.id, nome: r.name, ordem: r.position,
    }),
  },
  tags: {
    loja: db.LOJAS.tags,
    tabela: "tags",
    id: "id",
    paraRemoto: (r, organizationId, remoteId) => ({
      id: remoteId, organization_id: organizationId, legacy_id: r.id,
      name: r.nome, color: r.cor, deleted_at: null,
    }),
    doRemoto: (r, id) => ({
      id, remoteId: r.id, nome: r.name, cor: r.color,
    }),
  },
  contatos: {
    loja: db.LOJAS.contatos,
    tabela: "contacts",
    id: "id",
    paraRemoto: (r, organizationId, remoteId) => ({
      id: remoteId, organization_id: organizationId, legacy_id: r.id,
      name: semNulo(r.nome), phone: semNulo(r.telefone), whatsapp_id: r.waId || null,
      company: semNulo(r.empresa), job_title: semNulo(r.cargo), email: r.email || null,
      source: semNulo(r.origem), owner_label: semNulo(r.responsavel),
      avatar_path: r.avatarPath || null, last_interaction_at: r.ultimaEm ? iso(r.ultimaEm) : null,
      created_at: iso(r.criadoEm), updated_at: iso(r.atualizadoEm), deleted_at: null,
    }),
    doRemoto: (r, id, atual = {}) => ({
      ...atual, id, remoteId: r.id, nome: semNulo(r.name), telefone: semNulo(r.phone),
      waId: r.whatsapp_id || null, empresa: semNulo(r.company), cargo: semNulo(r.job_title),
      email: semNulo(r.email), origem: semNulo(r.source), responsavel: semNulo(r.owner_label),
      avatarPath: r.avatar_path || null, fotoUrl: atual.fotoUrl || null, ultimaEm: epoch(r.last_interaction_at),
      criadoEm: epoch(r.created_at) || atual.criadoEm || Date.now(),
      atualizadoEm: epoch(r.updated_at) || atual.atualizadoEm || Date.now(),
    }),
  },
  negocios: {
    loja: db.LOJAS.negocios,
    tabela: "deals",
    id: "id",
    paraRemoto: (r, organizationId, remoteId, refs) => ({
      id: remoteId, organization_id: organizationId, legacy_id: r.id,
      contact_id: refs.contatos.get(r.contactId), stage_id: refs.estagios.get(r.stageId),
      title: semNulo(r.titulo), value: r.valor, source: semNulo(r.origem), status: r.status,
      loss_reason: semNulo(r.motivoPerda), created_at: iso(r.criadoEm),
      updated_at: iso(r.atualizadoEm), deleted_at: null,
    }),
    doRemoto: (r, id, atual, refs) => ({
      ...atual, id, remoteId: r.id, contactId: refs.contatos.get(r.contact_id) || r.legacy_contact_id,
      stageId: refs.estagios.get(r.stage_id) || r.legacy_stage_id, titulo: semNulo(r.title),
      valor: r.value, origem: semNulo(r.source), status: r.status,
      motivoPerda: semNulo(r.loss_reason), criadoEm: epoch(r.created_at) || atual.criadoEm || Date.now(),
      atualizadoEm: epoch(r.updated_at) || atual.atualizadoEm || Date.now(),
    }),
  },
  tarefas: {
    loja: db.LOJAS.tarefas,
    tabela: "tasks",
    id: "id",
    paraRemoto: (r, organizationId, remoteId, refs) => ({
      id: remoteId, organization_id: organizationId, legacy_id: r.id,
      contact_id: refs.contatos.get(r.contactId), deal_id: r.dealId ? refs.negocios.get(r.dealId) : null,
      title: semNulo(r.titulo), due_at: r.venceEm == null ? null : iso(r.venceEm),
      completed: Boolean(r.concluida), completed_at: r.concluidaEm == null ? null : iso(r.concluidaEm),
      owner_label: semNulo(r.responsavel), created_at: iso(r.criadoEm),
      updated_at: iso(r.atualizadoEm ?? r.criadoEm), deleted_at: null,
    }),
    doRemoto: (r, id, atual, refs) => ({
      ...atual, id, remoteId: r.id, contactId: refs.contatos.get(r.contact_id) || r.legacy_contact_id,
      dealId: r.deal_id ? refs.negocios.get(r.deal_id) || r.legacy_deal_id : null,
      titulo: semNulo(r.title), venceEm: epoch(r.due_at), concluida: Boolean(r.completed),
      concluidaEm: epoch(r.completed_at), responsavel: semNulo(r.owner_label),
      criadoEm: epoch(r.created_at) || atual.criadoEm || Date.now(),
      atualizadoEm: epoch(r.updated_at) || atual.atualizadoEm || atual.criadoEm || Date.now(),
    }),
  },
  notas: {
    loja: db.LOJAS.notas,
    tabela: "notes",
    id: "id",
    paraRemoto: (r, organizationId, remoteId, refs) => ({
      id: remoteId, organization_id: organizationId, legacy_id: r.id,
      contact_id: refs.contatos.get(r.contactId), body: semNulo(r.texto),
      author_label: semNulo(r.autor), created_at: iso(r.criadoEm),
      updated_at: iso(r.atualizadoEm ?? r.criadoEm), deleted_at: null,
    }),
    doRemoto: (r, id, atual, refs) => ({
      ...atual, id, remoteId: r.id, contactId: refs.contatos.get(r.contact_id) || r.legacy_contact_id,
      texto: semNulo(r.body), autor: semNulo(r.author_label),
      criadoEm: epoch(r.created_at) || atual.criadoEm || Date.now(),
      atualizadoEm: epoch(r.updated_at) || atual.atualizadoEm || atual.criadoEm || Date.now(),
    }),
  },
  eventos: {
    loja: db.LOJAS.eventos,
    tabela: "contact_events",
    id: "id",
    cursorCampo: "created_at",
    paraRemoto: (r, organizationId, remoteId, refs) => ({
      id: remoteId, organization_id: organizationId,
      legacy_id: r.id,
      contact_id: refs.contatos.get(r.contactId), event_type: r.tipo,
      entity_type: r.entidadeTipo,
      entity_id: {
        contato: refs.contatos,
        negocio: refs.negocios,
        tarefa: refs.tarefas,
        nota: refs.notas,
      }[r.entidadeTipo]?.get(r.entidadeId) || null,
      source: r.origem || "app", payload: r.carga || {},
      occurred_at: iso(r.ocorridoEm), created_at: iso(r.criadoEm),
    }),
    doRemoto: (r, id, _atual, refs) => ({
      id, remoteId: r.id, contactId: refs.contatos.get(r.contact_id), tipo: r.event_type,
      entidadeTipo: r.entity_type,
      entidadeId: r.entity_id
        ? refs[{ contato: "contatos", negocio: "negocios", tarefa: "tarefas", nota: "notas" }[r.entity_type]]?.get(r.entity_id) || r.entity_id
        : null,
      origem: r.source, carga: r.payload || {}, ocorridoEm: epoch(r.occurred_at), criadoEm: epoch(r.created_at),
    }),
  },
};

const ORDEM = ["estagios", "tags", "contatos", "negocios", "tarefas", "notas", "eventos"];
const CHAVE = (tipo, id) => `map:${tipo}:${id}`;
const CURSOR = (tipo) => `cursor:${tipo}`;

/**
 * Operações que não têm o que sincronizar: ou são leitura pura, ou mexem em
 * estado que só faz sentido nesta máquina.
 *
 * A pausa da automação está aqui de propósito. Ela é um freio de mão do
 * atendente que está com o WhatsApp aberto na frente dele; não pode depender
 * de um round-trip que pode falhar, nem calar o bot dos colegas por engano.
 */
const LOCAL_SEM_SYNC = new Set([
  "dados.exportar", "config.ler", "config.gravar",
  "chatbots.listar", "chatbots.buscar", "chatbots.criar",
  "chatbots.atualizar", "chatbots.remover", "chatbots.duplicar",
  "chatbots.avaliar", "chatbots.preparar",
  "chatbots.prepararAutomatico", "chatbots.marcarAutomaticoEnviado",
  "chatbots.cancelarAutomatico",
  "automacao.estado", "automacao.pausar",
  "automacao.diario", "automacao.registrar",
]);

function erroRemoto(error, codigo = "sincronizacao-falhou") {
  const erro = new Error(error?.message || "Não foi possível sincronizar com o Supabase.");
  erro.codigo = codigo;
  return erro;
}

function obterAtualizavel(item, existente) {
  return existente?.find((r) => r.remoteId === item.id || r.id === item.legacy_id) || null;
}

export function criarOperacoesSincronizacao({ supabase = obterSupabase(), local } = {}) {
  if (!local) throw new Error("O provider remoto precisa do LocalProvider.");

  const lerWorkspace = async () => {
    const salvo = (await chrome.storage.local.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    if (salvo) db.definirWorkspace(salvo);
    return db.obterWorkspace() || salvo || null;
  };

  const sessaoObrigatoria = async () => {
    const organizationId = await lerWorkspace();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw erroRemoto(error, "sessao-falhou");
    if (!data?.session?.user || !organizationId) {
      const erro = new Error("Entre em uma empresa antes de sincronizar.");
      erro.codigo = "workspace-ausente";
      throw erro;
    }
    return { organizationId, userId: data.session.user.id };
  };

  const mapa = async (tipo, localId) =>
    (await db.buscar(db.LOJAS.sync, CHAVE(tipo, localId)))?.remoteId || null;

  const salvarMapa = (tipo, localId, remoteId) =>
    db.gravar(db.LOJAS.sync, { chave: CHAVE(tipo, localId), remoteId });

  const rpcFaseFAusente = (error) => ["42883", "PGRST202", "PGRST205"].includes(error?.code);

  const reivindicarExecucaoChatbot = async (args, resultado) => {
    if (!resultado?.preparacao || !args?.messageId) return resultado;
    const { organizationId } = await sessaoObrigatoria();
    const bot = await db.buscar(db.LOJAS.chatbots, resultado.preparacao.chatbotId);
    const contato = await db.buscar(db.LOJAS.contatos, args.contactId);
    const chatbotId = uuidRemotoValido(bot?.remoteId) ? bot.remoteId : uuidRemotoValido(bot?.id) ? bot.id : null;
    const contactId = uuidRemotoValido(contato?.remoteId) ? contato.remoteId : null;
    // Durante a transição dos chatbots locais para UUIDs remotos, o cache
    // continua operando. A proteção central passa a valer assim que a primeira
    // sincronização da Fase F terminar.
    if (!chatbotId) return resultado;
    const { data, error } = await supabase.rpc("chatbot_execution_claim", {
      target_organization: organizationId,
      target_chatbot: chatbotId,
      target_contact: contactId,
      target_external_message: String(args.messageId),
    });
    if (error) {
      if (!rpcFaseFAusente(error)) console.warn("[EmyLeads] claim central indisponível; mantendo proteção local:", error.message);
      return resultado;
    }
    const executionId = Array.isArray(data) ? data[0] : data;
    if (!executionId) {
      await local["chatbots.cancelarAutomatico"]({
        contactId: args.contactId,
        chatbotId: resultado.preparacao.chatbotId,
        chatbotNome: resultado.preparacao.nome,
        messageId: args.messageId,
        erro: "Mensagem já reivindicada por outro conector.",
      }).catch(() => {});
      return { preparacao: null, motivo: "reserva-remota-ativa" };
    }
    return {
      ...resultado,
      preparacao: { ...resultado.preparacao, executionId },
    };
  };

  const concluirExecucaoChatbot = async (executionId, status, result = {}) => {
    if (!uuidRemotoValido(executionId)) return false;
    try {
      const { organizationId } = await sessaoObrigatoria();
      const { error } = await supabase.rpc("chatbot_execution_complete", {
        target_organization: organizationId,
        target_execution: executionId,
        target_status: status,
        target_result: result,
      });
      if (error && !rpcFaseFAusente(error)) throw error;
      return !error;
    } catch (error) {
      console.warn("[EmyLeads] conclusão central do chatbot ficará para diagnóstico:", error?.message || error);
      return false;
    }
  };

  const localizar = async (tipo, remoteRow) => {
    const config = ENTIDADES[tipo];
    const todos = await db.todos(config.loja);
    return obterAtualizavel(remoteRow, todos);
  };

  const refsLocais = async () => {
    const refs = {};
    for (const tipo of ORDEM) {
      refs[tipo] = new Map();
      const todos = await db.todos(ENTIDADES[tipo].loja);
      todos.forEach((r) => {
        if (uuidRemotoValido(r.remoteId)) {
          refs[tipo].set(r.remoteId, r.id);
          refs[tipo].set(r.id, r.remoteId);
        }
      });
    }
    return refs;
  };

  const montarOutbox = async ({ tipo, item, operacao = "upsert", remoteRow = null, organizationId }) => {
    const config = ENTIDADES[tipo];
    const localId = item?.id || remoteRow?.legacy_id;
    let remoteId = uuidRemotoValido(item?.remoteId) ? item.remoteId : null;
    if (!remoteId && localId) {
      const mapeado = await mapa(tipo, localId);
      remoteId = uuidRemotoValido(mapeado) ? mapeado : null;
    }
    if (operacao === "upsert" && !remoteId) remoteId = uuid();
    if (item && operacao === "upsert" && item.remoteId !== remoteId) {
      await db.gravar(config.loja, { ...item, remoteId });
    }
    const refs = await refsLocais();
    const payload = operacao === "upsert"
      ? config.paraRemoto(item, organizationId, remoteId, refs)
      : { id: remoteId, organization_id: organizationId, deleted_at: new Date().toISOString() };
    if (remoteId) await salvarMapa(tipo, localId, remoteId);

    const anteriores = await db.todos(db.LOJAS.outbox);
    const antigo = anteriores.find((o) => o.entidade === tipo && o.localId === localId && o.status !== OUTBOX_PROCESSANDO);
    const registro = {
      id: antigo?.id || uuid(), entidade: tipo, localId, remoteId,
      operacao, payload, tags: item?.tags || [], status: OUTBOX_PENDENTE,
      tentativas: antigo?.tentativas || 0, criadoEm: antigo?.criadoEm || Date.now(),
      atualizadoEm: Date.now(), ultimoErro: null,
    };
    return db.gravar(db.LOJAS.outbox, registro);
  };

  const registrarTudo = async () => {
    for (const tipo of ORDEM) {
      const itens = await db.todos(ENTIDADES[tipo].loja);
      for (const item of itens) await montarOutbox({ tipo, item, organizationId: db.obterWorkspace() });
    }
  };

  const capturarAntes = async (op, args) => {
    const porOp = {
      "contatos": "contatos", "negocios": "negocios", "tarefas": "tarefas", "notas": "notas",
      "estagios": "estagios", "tags": "tags",
    };
    const [grupo, metodo] = op.split(".");
    const tipo = porOp[grupo];
    if (tipo && args?.id && ENTIDADES[tipo]) {
      const item = await db.buscar(ENTIDADES[tipo].loja, args.id);
      const resultado = { tipo, item };
      if (tipo === "contatos" && item) {
        resultado.dependentes = {
          negocios: await db.porIndice(db.LOJAS.negocios, "contactId", args.id),
          tarefas: await db.porIndice(db.LOJAS.tarefas, "contactId", args.id),
          notas: await db.porIndice(db.LOJAS.notas, "contactId", args.id),
          eventos: await db.porIndice(db.LOJAS.eventos, "contactId", args.id),
        };
      }
      if (tipo === "estagios" && item) resultado.dependentes = { negocios: await db.porIndice(db.LOJAS.negocios, "stageId", args.id) };
      if (tipo === "tags" && item) resultado.dependentes = { contatos: (await db.todos(db.LOJAS.contatos)).filter((c) => (c.tags || []).includes(args.id)) };
      return resultado;
    }
    if (["dados.apagar", "dados.importar", "dados.semear"].includes(op)) {
      const antes = {};
      for (const nome of ["contatos", "negocios", "tarefas", "notas", "eventos"]) antes[nome] = await db.todos(ENTIDADES[nome].loja);
      return { antes };
    }
    return null;
  };

  const registrarResultado = async (op, args, resultado, antes) => {
    if (!db.obterWorkspace()) return;
    const [grupo, metodo] = op.split(".");
    const tipo = { contatos: "contatos", negocios: "negocios", tarefas: "tarefas", notas: "notas", eventos: "eventos", estagios: "estagios", tags: "tags" }[grupo];
    const mutacoesTotais = ["contatos.importar", "contatos.importarDoWhatsApp", "estagios.salvar", "tags.salvar", "dados.importar", "dados.semear"];
    if (mutacoesTotais.includes(op)) await registrarTudo();
    else if (op === "dados.apagar") {
      for (const nome of ["contatos", "negocios", "tarefas", "notas", "eventos"]) for (const item of antes?.antes?.[nome] || []) {
        await montarOutbox({ tipo: nome, item, operacao: "delete", organizationId: db.obterWorkspace() });
      }
    } else if ((op === "estagios.remover" || op === "tags.remover") && tipo) {
      await registrarTudo();
      await montarOutbox({ tipo, item: antes?.item, operacao: "delete", organizationId: db.obterWorkspace() });
    } else if (tipo && (resultado?.id || metodo === "remover")) {
      const remover = metodo === "remover";
      await montarOutbox({ tipo, item: remover ? antes?.item : resultado, operacao: remover ? "delete" : "upsert", organizationId: db.obterWorkspace() });
      if (remover && antes?.dependentes) {
        for (const [dependente, itens] of Object.entries(antes.dependentes)) {
          const tipoDependente = { negocios: "negocios", tarefas: "tarefas", notas: "notas", eventos: "eventos", contatos: "contatos" }[dependente];
          for (const item of itens) await montarOutbox({ tipo: tipoDependente, item, operacao: "delete", organizationId: db.obterWorkspace() });
        }
      }
    } else if (op === "contatos.resolver" && resultado?.id) {
      await montarOutbox({ tipo: "contatos", item: resultado, organizationId: db.obterWorkspace() });
    } else if (op === "chatbots.executar" && resultado?.contato?.id) {
      // Chatbots são locais, mas a etiqueta alterada pelo bot pertence ao
      // contato e precisa sobreviver ao próximo pull do Supabase.
      await montarOutbox({ tipo: "contatos", item: resultado.contato, organizationId: db.obterWorkspace() });
    }

    // Eventos são escritos diretamente pelo LocalProvider nas operações de
    // negócio. Enfileirar os ainda não mapeados garante que o histórico local
    // também chegue ao histórico remoto.
    const pendencias = await db.todos(db.LOJAS.outbox);
    const eventos = await db.todos(db.LOJAS.eventos);
    for (const evento of eventos) {
      const remoto = await mapa("eventos", evento.id);
      const jaEnfileirado = pendencias.some(
        (item) => item.entidade === "eventos" && item.localId === evento.id
      );
      if (!remoto && !jaEnfileirado) {
        await montarOutbox({
          tipo: "eventos",
          item: evento,
          organizationId: db.obterWorkspace(),
        });
      }
    }
  };

  const pushItem = async (item, organizationId) => {
    const config = ENTIDADES[item.entidade];
    if (!config || !uuidRemotoValido(item.remoteId)) return;
    if (item.operacao === "delete") {
      if (item.entidade === "eventos") {
        const { error } = await supabase.from(config.tabela).delete().eq("id", item.remoteId).eq("organization_id", organizationId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from(config.tabela).update({ deleted_at: item.payload.deleted_at }).eq("id", item.remoteId).eq("organization_id", organizationId);
      if (error) throw error;
    } else {
      if (item.entidade === "eventos") {
        const { error } = await supabase.from(config.tabela).upsert(item.payload, { onConflict: "id" });
        if (error) throw error;
      } else {
        const { data: remoto, error: leituraErro } = await supabase.from(config.tabela).select("id,updated_at,version").eq("id", item.remoteId).maybeSingle();
        if (leituraErro) throw leituraErro;
        const localUpdated = item.payload.updated_at ? new Date(item.payload.updated_at).getTime() : Date.now();
        if (remoto?.updated_at && new Date(remoto.updated_at).getTime() > localUpdated) {
          await db.gravar(db.LOJAS.sync, { chave: `conflito:${item.id}`, entidade: item.entidade, remoteId: item.remoteId, ocorridoEm: Date.now(), localUpdated, remotoUpdated: remoto.updated_at });
          const contactId = item.entidade === "contatos" ? item.remoteId : item.payload.contact_id;
          if (contactId) {
            await supabase.from("contact_events").insert({
              organization_id: organizationId,
              contact_id: contactId,
              event_type: "sync.conflict",
              entity_type: item.entidade,
              entity_id: item.remoteId,
              source: "sync",
              payload: { resolution: "remote-wins", localUpdated, remoteUpdated: remoto.updated_at },
            });
          }
          return;
        }
        const { error } = await supabase.from(config.tabela).upsert(item.payload, { onConflict: "id" });
        if (error) throw error;
        if (item.entidade === "contatos" && Array.isArray(item.tags)) {
          await supabase.from("contact_tags").delete().eq("organization_id", organizationId).eq("contact_id", item.remoteId);
          const tagRows = [];
          for (const localTagId of item.tags) {
            const tagId = await mapa("tags", localTagId);
            if (tagId) tagRows.push({ organization_id: organizationId, contact_id: item.remoteId, tag_id: tagId });
          }
          if (tagRows.length) {
            const { error: tagsError } = await supabase.from("contact_tags").upsert(tagRows, { onConflict: "contact_id,tag_id" });
            if (tagsError) throw tagsError;
          }
        }
        if (item.entidade === "contatos") {
          const contatoLocal = await db.buscar(db.LOJAS.contatos, item.localId);
          if (contatoLocal?.fotoUrl && (/^data:/i.test(contatoLocal.fotoUrl) || !item.payload.avatar_path)) {
            const foto = await subirFoto(contatoLocal, item.remoteId, organizationId);
            if (!foto.ok) throw new Error(foto.motivo || "Não foi possível enviar a foto do contato.");
            await db.gravar(db.LOJAS.contatos, { ...contatoLocal, avatarPath: foto.caminho, fotoUrl: foto.url });
          }
        }
      }
    }

    const contatosComFoto = (await db.todos(db.LOJAS.contatos)).filter((item) => item.avatarPath && !item.fotoUrl?.startsWith("data:"));
    for (const contato of contatosComFoto) {
      try {
        const { data, error } = await supabase.storage.from("contact-avatars").createSignedUrl(contato.avatarPath, 3600);
        if (!error && data?.signedUrl) await db.gravar(db.LOJAS.contatos, { ...contato, fotoUrl: data.signedUrl });
      } catch {
        // Avatar é enriquecimento; falha de URL não interrompe o sync.
      }
    }
  };

  const OUTBOX_UUID_FIELDS = {
    estagios: [],
    tags: [],
    contatos: [],
    negocios: ["contact_id", "stage_id"],
    tarefas: ["contact_id", "deal_id"],
    notas: ["contact_id"],
    eventos: ["contact_id", "entity_id"],
  };

  const outboxPrecisaReparar = (item) => {
    if (!ENTIDADES[item.entidade] || item.operacao !== "upsert") return false;
    if (!uuidRemotoValido(item.remoteId) || !uuidRemotoValido(item.payload?.id)) return true;
    return (OUTBOX_UUID_FIELDS[item.entidade] || []).some((campo) => {
      const valor = item.payload?.[campo];
      return valor != null && !uuidRemotoValido(valor);
    });
  };

  const repararOutboxLegado = async (organizationId) => {
    const itens = (await db.todos(db.LOJAS.outbox))
      .filter((item) => (
        item.operacao === "delete" && !uuidRemotoValido(item.remoteId)
      ) || outboxPrecisaReparar(item))
      .sort((a, b) => ORDEM.indexOf(a.entidade) - ORDEM.indexOf(b.entidade) || a.criadoEm - b.criadoEm);

    for (const item of itens) {
      if (item.operacao === "delete") {
        // Esse registro nunca chegou ao Supabase: não há nada remoto a apagar.
        await db.apagar(db.LOJAS.outbox, item.id);
        continue;
      }
      const config = ENTIDADES[item.entidade];
      const local = config ? await db.buscar(config.loja, item.localId) : null;
      if (!local) {
        await db.apagar(db.LOJAS.outbox, item.id);
        continue;
      }
      await montarOutbox({ tipo: item.entidade, item: local, organizationId });
    }
  };

  const processarOutbox = async (organizationId) => {
    await repararOutboxLegado(organizationId);
    const pendentes = (await db.todos(db.LOJAS.outbox))
      .filter((item) => item.status === OUTBOX_PENDENTE || item.status === OUTBOX_ERRO)
      .sort((a, b) => ORDEM.indexOf(a.entidade) - ORDEM.indexOf(b.entidade) || a.criadoEm - b.criadoEm);
    for (const item of pendentes) {
      await db.gravar(db.LOJAS.outbox, { ...item, status: OUTBOX_PROCESSANDO, tentativas: item.tentativas + 1 });
      try {
        await pushItem(item, organizationId);
        await db.apagar(db.LOJAS.outbox, item.id);
      } catch (error) {
        await db.gravar(db.LOJAS.outbox, { ...item, status: OUTBOX_ERRO, tentativas: item.tentativas + 1, ultimoErro: error?.message || String(error), atualizadoEm: Date.now() });
        throw erroRemoto(error);
      }
    }
  };

  const obterCursor = async (tipo) => {
    const registro = await db.buscar(db.LOJAS.sync, CURSOR(tipo));
    const cursor = registro?.valor;
    const valor = cursor?.valor ?? cursor?.updatedAt ?? null;
    if (!valor || !Number.isFinite(new Date(valor).getTime())) {
      if (cursor) await db.apagar(db.LOJAS.sync, CURSOR(tipo));
      return null;
    }
    return {
      valor,
      // Cursor antigo pode carregar o ID local. O timestamp continua útil,
      // mas a ordenação por UUID só pode receber um UUID real.
      id: uuidRemotoValido(cursor?.id) ? cursor.id : ZERO_UUID,
    };
  };
  const salvarCursor = (tipo, valor) => db.gravar(db.LOJAS.sync, { chave: CURSOR(tipo), valor });

  const buscarNovos = async (tabela, cursor, organizationId, cursorCampo = "updated_at") => {
    let consulta = supabase.from(tabela).select("*").eq("organization_id", organizationId).order(cursorCampo, { ascending: true }).order("id", { ascending: true }).limit(BATCH);
    const valorBruto = cursor?.valor ?? cursor?.updatedAt ?? null;
    const valorCursor = valorBruto && Number.isFinite(new Date(valorBruto).getTime()) ? valorBruto : null;
    if (valorCursor) {
      // Versões antigas do cache usavam o ID local (por exemplo, `2ru5prvh`)
      // como cursor. As tabelas remotas têm `id` UUID; enviar esse valor ao
      // PostgREST faz o PostgreSQL abortar o sync antes de qualquer migração.
      // Com um cursor inválido, retomamos daquele instante usando o menor UUID
      // e o próximo lote grava o cursor remoto correto.
      const cursorId = UUID_ANY_RE.test(cursor?.id || "") ? cursor.id : ZERO_UUID;
      consulta = consulta.or(`${cursorCampo}.gt.${valorCursor},and(${cursorCampo}.eq.${valorCursor},id.gt.${cursorId})`);
    }
    const { data, error } = await consulta;
    if (error) throw error;
    return data || [];
  };

  const hidratarFotos = async () => {
    const contatos = await db.todos(db.LOJAS.contatos);
    for (const contato of contatos) {
      if (!contato.avatarPath) continue;
      try {
        const { data, error } = await supabase.storage.from("contact-avatars").createSignedUrl(contato.avatarPath, 3600);
        if (!error && data?.signedUrl && data.signedUrl !== contato.fotoUrl) {
          await db.gravar(db.LOJAS.contatos, { ...contato, fotoUrl: data.signedUrl });
        }
      } catch {
        // A foto é enriquecimento visual; falha na URL não interrompe o sync.
      }
    }
  };

  const aplicarLinha = async (tipo, row, refs) => {
    const config = ENTIDADES[tipo];
    const existente = await localizar(tipo, row);
    const localId = existente?.id || row.legacy_id || row.id;
    await salvarMapa(tipo, localId, row.id);
    if (row.deleted_at) {
      if (existente) await db.apagar(config.loja, existente.id);
      return;
    }
    const local = config.doRemoto(row, localId, existente || {}, refs);
    await db.gravar(config.loja, local);
    refs[tipo].set(row.id, localId);
    refs[tipo].set(localId, localId);
  };

  const sincronizarCacheChatbots = async (organizationId) => {
    const buscar = () => supabase.from("chatbot_definitions").select("*")
      .eq("organization_id", organizationId).is("deleted_at", null)
      .order("updated_at", { ascending: true });
    let { data, error } = await buscar();
    // Permite atualizar primeiro o conector e aplicar a migration depois, sem
    // derrubar os chatbots locais durante a janela de implantação.
    if (error?.code === "42P01" || error?.code === "PGRST205") return false;
    if (error) throw error;
    const itensLocais = await db.todos(db.LOJAS.chatbots);
    const cacheAnterior = await db.buscar(db.LOJAS.sync, "chatbots-cache");
    if (!(data || []).length && itensLocais.length && !cacheAnterior) {
      const payload = itensLocais.map((item) => {
        const {
          id: _id, remoteId: _remoteId, nome, ativo, execucoes: _execucoes,
          ultimaExecucaoEm: _ultima, criadoEm: _criado, atualizadoEm: _atualizado,
          version: _version, ...definition
        } = item;
        return { name: nome, active: ativo !== false, definition };
      });
      const migracao = await supabase.rpc("migrate_local_chatbots", {
        target_organization: organizationId,
        chatbot_payload: payload,
      });
      if (migracao.error) {
        // Um profissional comum não pode migrar definições. Ele mantém o cache
        // anterior até um dono/administrador concluir a primeira sincronização.
        if (!rpcFaseFAusente(migracao.error) && !/management required/i.test(migracao.error.message || "")) {
          console.warn("[EmyLeads] migração inicial dos chatbots adiada:", migracao.error.message);
        }
        return false;
      }
      ({ data, error } = await buscar());
      if (error) throw error;
      if (!(data || []).length) return false;
    }
    const atuais = new Map(itensLocais.map((item) => [item.remoteId || item.id, item]));
    const chatbots = (data || []).map((row) => {
      const anterior = atuais.get(row.id) || {};
      const definition = row.definition && typeof row.definition === "object" ? row.definition : {};
      return {
        ...anterior,
        ...definition,
        id: row.id,
        remoteId: row.id,
        nome: row.name,
        ativo: Boolean(row.active),
        execucoes: Math.max(Number(row.executions || 0), Number(anterior.execucoes || 0)),
        ultimaExecucaoEm: epoch(row.last_execution_at) || anterior.ultimaExecucaoEm || null,
        criadoEm: epoch(row.created_at) || anterior.criadoEm || Date.now(),
        atualizadoEm: epoch(row.updated_at) || Date.now(),
        version: Number(row.version || 1),
      };
    });
    await db.limpar(db.LOJAS.chatbots);
    if (chatbots.length) await db.gravarVarios(db.LOJAS.chatbots, chatbots);
    await db.gravar(db.LOJAS.sync, {
      chave: "chatbots-cache",
      valor: { sincronizadoEm: Date.now(), quantidade: chatbots.length },
    });
    return true;
  };

  const puxar = async (organizationId) => {
    const refs = await refsLocais();
    for (const tipo of ORDEM) {
      const cursorCampo = ENTIDADES[tipo].cursorCampo || "updated_at";
      let cursor = await obterCursor(tipo);
      while (true) {
        const rows = await buscarNovos(ENTIDADES[tipo].tabela, cursor, organizationId, cursorCampo);
        if (!rows.length) break;
        for (const row of rows) await aplicarLinha(tipo, row, refs);
        const ultimo = rows[rows.length - 1];
        cursor = { valor: ultimo[cursorCampo], id: ultimo.id };
        await salvarCursor(tipo, cursor);
        if (rows.length < BATCH) break;
      }
    }

    const { data: relacoes, error } = await supabase.from("contact_tags").select("contact_id,tag_id").eq("organization_id", organizationId);
    if (error) throw error;
    const porContato = new Map();
    for (const relacao of relacoes || []) {
      const contato = refs.contatos.get(relacao.contact_id);
      const tag = refs.tags.get(relacao.tag_id);
      if (contato && tag) porContato.set(contato, [...(porContato.get(contato) || []), tag]);
    }
    const contatos = await db.todos(db.LOJAS.contatos);
    for (const contato of contatos) {
      const tags = porContato.get(contato.id) || [];
      if (JSON.stringify(contato.tags || []) !== JSON.stringify(tags)) await db.gravar(db.LOJAS.contatos, { ...contato, tags });
    }
    await sincronizarCacheChatbots(organizationId);
    await hidratarFotos();
  };

  const executar = async () => {
    const { organizationId } = await sessaoObrigatoria();
    // Primeiro puxa referências remotas (estágios/tags e alterações de outros
    // dispositivos). Assim uma criação offline nunca é enviada com uma FK
    // local no lugar do UUID remoto.
    await puxar(organizationId);
    await processarOutbox(organizationId);
    // O push pode ter criado/alterado dados; uma segunda leitura atualiza o
    // cache e os cursores antes de liberar a tela.
    await puxar(organizationId);
    await db.gravar(db.LOJAS.sync, { chave: "ultimo-sync", valor: Date.now() });
    return status();
  };

  const status = async () => {
    const organizationId = await lerWorkspace();
    const outbox = await db.todos(db.LOJAS.outbox);
    return {
      organizationId, online: typeof navigator === "undefined" || navigator.onLine !== false,
      pendentes: outbox.filter((item) => item.status !== OUTBOX_PROCESSANDO).length,
      erros: outbox.filter((item) => item.status === OUTBOX_ERRO).length,
      ultimoSync: (await db.buscar(db.LOJAS.sync, "ultimo-sync"))?.valor || null,
    };
  };

  const exportarLegado = async () => {
    const workspace = db.obterWorkspace();
    db.definirWorkspace(null);
    try { return await local["dados.exportar"]({}); }
    finally { db.definirWorkspace(workspace); }
  };

  const exportarPacoteMigracao = async (organizationId) => {
    const pacote = normalizarPacoteMigracao(await exportarLegado());
    const workspaceAnterior = db.obterWorkspace();
    try {
      // A materialização do blob do WhatsApp pode acontecer depois da primeira
      // tentativa. O workspace autenticado é então a fonte mais recente da
      // foto, mesmo quando o banco legado ainda guarda o blob original.
      db.definirWorkspace(organizationId);
      const contatosWorkspace = await local["contatos.listar"]();
      const porRemoteId = new Map(contatosWorkspace.filter((item) => item.remoteId).map((item) => [item.remoteId, item]));
      const contatos = [];
      for (const contato of pacote.contatos) {
        const remoteId = (await db.buscar(db.LOJAS.sync, CHAVE("contatos", contato.id)))?.remoteId;
        const atual = porRemoteId.get(remoteId);
        const fotoValida = atual?.fotoUrl && /^(data:|https?:)/i.test(atual.fotoUrl) ? atual.fotoUrl : contato.fotoUrl;
        contatos.push({
          ...contato,
          avatarPath: atual?.avatarPath || contato.avatarPath || null,
          fotoUrl: fotoValida || null,
        });
      }
      return { ...pacote, contatos };
    } finally {
      db.definirWorkspace(workspaceAnterior);
    }
  };

  const noBancoLegado = async (fn) => {
    const workspaceAnterior = db.obterWorkspace();
    db.definirWorkspace(null);
    try {
      return await fn();
    } finally {
      db.definirWorkspace(workspaceAnterior);
    }
  };

  const lerEstadoLegado = (chave) => noBancoLegado(async () => (await db.buscar(db.LOJAS.sync, chave))?.valor || null);
  const gravarEstadoLegado = (chave, valor) => noBancoLegado(() => db.gravar(db.LOJAS.sync, { chave, valor }));

  const criarSnapshotMigracao = async (organizationId) => {
    const pacote = await exportarPacoteMigracao(organizationId);
    const snapshot = {
      id: uuid(),
      criadoEm: Date.now(),
      organizationId,
      assinatura: assinaturaPacote(pacote),
      pacote,
      totais: {
        contatos: pacote.contatos.length,
        negocios: pacote.negocios.length,
        tarefas: pacote.tarefas.length,
        notas: pacote.notas.length,
        estagios: pacote.estagios.length,
        tags: pacote.tags.length,
        eventos: pacote.eventos?.length || 0,
        fotos: pacote.contatos.filter((contato) => contato.fotoUrl || contato.avatarPath).length,
      },
    };
    await gravarEstadoLegado(SNAPSHOT_CHAVE, snapshot);
    await gravarEstadoLegado(SNAPSHOT_ESTADO_CHAVE, {
      snapshotId: snapshot.id,
      assinatura: snapshot.assinatura,
      etapa: "snapshot",
      processado: 0,
      total: snapshot.totais.contatos + snapshot.totais.negocios + snapshot.totais.tarefas + snapshot.totais.notas + snapshot.totais.estagios + snapshot.totais.tags + snapshot.totais.eventos,
      status: "pronto",
    });
    return snapshot;
  };

  const obterSnapshotMigracao = async (organizationId) => {
    const snapshot = await lerEstadoLegado(SNAPSHOT_CHAVE);
    return snapshot?.organizationId === organizationId
      ? { ...snapshot, pacote: normalizarPacoteMigracao(snapshot.pacote) }
      : null;
  };

  const buscarExistentes = async (organizationId) => {
    const existentes = {};
    const chavesPlano = {
      estagios: "stages",
      tags: "tags",
      contatos: "contacts",
      negocios: "deals",
      tarefas: "tasks",
      notas: "notes",
      eventos: "events",
    };
    for (const tipo of ORDEM) {
      const colunas = tipo === "contatos" ? "id,legacy_id,phone,whatsapp_id,avatar_path,deleted_at" : "id,legacy_id";
      const { data, error } = await supabase.from(ENTIDADES[tipo].tabela).select(colunas).eq("organization_id", organizationId);
      if (error) throw error;
      existentes[chavesPlano[tipo]] = data || [];
    }
    return existentes;
  };

  const subirFoto = async (contato, remoteContactId, organizationId) => {
    const fonte = contato?.fotoUrl || null;
    const caminhoExistente = contato?.avatarPath || null;
    // URLs assinadas são apenas cache de visualização. Se o caminho já existe,
    // não tentamos reutilizar uma URL que pode ter expirado.
    if (caminhoExistente && !/^data:/i.test(fonte || "")) {
      const { data: signed, error: signedError } = await supabase.storage.from("contact-avatars").createSignedUrl(caminhoExistente, 60);
      if (signedError || !signed?.signedUrl) return { ok: false, caminho: caminhoExistente, motivo: signedError?.message || "foto sem URL privada" };
      return { ok: true, caminho: caminhoExistente, url: signed.signedUrl };
    }
    if (!fonte || !/^data:|^https?:/i.test(fonte)) return { ok: false, motivo: "fonte-indisponivel" };
    try {
      const resposta = await fetch(fonte);
      if (!resposta.ok) throw new Error(`foto HTTP ${resposta.status}`);
      const blob = await resposta.blob();
      const caminho = `organizations/${organizationId}/contacts/${remoteContactId}/avatar.jpg`;
      const { error } = await supabase.storage.from("contact-avatars").upload(caminho, blob, { contentType: blob.type || "image/jpeg", upsert: true });
      if (error) throw error;
      const { error: updateError } = await supabase.from("contacts").update({ avatar_path: caminho }).eq("id", remoteContactId).eq("organization_id", organizationId);
      if (updateError) throw updateError;
      const { data: signed, error: signedError } = await supabase.storage.from("contact-avatars").createSignedUrl(caminho, 60);
      if (signedError || !signed?.signedUrl) throw signedError || new Error("foto sem URL privada");
      return { ok: true, caminho, url: signed.signedUrl };
    } catch (error) {
      return { ok: false, motivo: error?.message || String(error) };
    }
  };

  const montarPacoteLocal = (pacote, plano, fotos = []) => {
    const fotoPorContato = new Map(fotos.map((foto) => [foto.legacyId, foto]));
    const avatarRemotoPorContato = new Map(plano.tabelas.contacts.map((contato) => [contato.legacy_id, contato.avatar_path || null]));
    const contatos = pacote.contatos.map((contato) => {
      const foto = fotoPorContato.get(contato.id);
      return {
        ...contato,
        remoteId: plano.ids.contacts.get(contato.id),
        avatarPath: foto?.ok ? foto.caminho : contato.avatarPath || avatarRemotoPorContato.get(contato.id) || null,
        // Mantém a fonte quando o upload falhar para permitir nova tentativa.
        fotoUrl: foto?.ok ? foto.url : foto?.source || contato.fotoUrl || null,
      };
    });
    return {
      ...pacote,
      contatos,
      negocios: pacote.negocios.map((item) => ({ ...item, remoteId: plano.ids.deals.get(item.id) })),
      tarefas: pacote.tarefas.map((item) => ({ ...item, remoteId: plano.ids.tasks.get(item.id) })),
      notas: pacote.notas.map((item) => ({ ...item, remoteId: plano.ids.notes.get(item.id) })),
      estagios: pacote.estagios.map((item) => ({ ...item, remoteId: plano.ids.stages.get(item.id) })),
      tags: pacote.tags.map((item) => ({ ...item, remoteId: plano.ids.tags.get(item.id) })),
      eventos: (pacote.eventos || []).map((item) => ({ ...item, remoteId: plano.ids.events.get(item.id) })),
    };
  };

  const validarMigracaoRemota = async (plano, organizationId) => {
    const verificacoes = [
      ["stages", plano.tabelas.stages],
      ["tags", plano.tabelas.tags],
      ["contacts", plano.tabelas.contacts],
      ["deals", plano.tabelas.deals],
      ["tasks", plano.tabelas.tasks],
      ["notes", plano.tabelas.notes],
      ["contact_events", plano.tabelas.events],
    ];
    for (const [tabela, rows] of verificacoes) {
      if (!rows.length) continue;
      const ids = rows.map((row) => row.id);
      const campos = CAMPOS_VALIDACAO[tabela === "contact_events" ? "events" : tabela];
      const select = campos ? `id,${campos.join(",")}` : "id";
      const { data, error } = await supabase
        .from(tabela)
        .select(select)
        .eq("organization_id", organizationId)
        .in("id", ids);
      if (error) throw erroRemoto(error, "validacao-migracao-falhou");
      const encontrados = new Set((data || []).map((row) => row.id));
      const ausentes = ids.filter((id) => !encontrados.has(id));
      if (ausentes.length) {
        const erro = new Error(`A validação encontrou ${ausentes.length} registro(s) ausente(s) em ${tabela}.`);
        erro.codigo = "migracao-incompleta";
        erro.tabela = tabela;
        erro.ids = ausentes;
        throw erro;
      }
      const porId = new Map((data || []).map((row) => [row.id, row]));
      const pacotePorTabela = { stages: plano.tabelas.stages, tags: plano.tabelas.tags, contacts: plano.tabelas.contacts, deals: plano.tabelas.deals, tasks: plano.tabelas.tasks, notes: plano.tabelas.notes, events: plano.tabelas.events };
      const divergencias = [];
      for (const esperado of pacotePorTabela[tabela === "contact_events" ? "events" : tabela] || []) {
        const atual = porId.get(esperado.id);
        for (const campo of campos || []) {
          if (valorParaComparacao(atual?.[campo], campo) !== valorParaComparacao(esperado[campo], campo)) {
            divergencias.push({ id: esperado.id, campo });
          }
        }
      }
      if (divergencias.length) {
        const erro = new Error(`A validação encontrou ${divergencias.length} campo(s) divergente(s) em ${tabela}.`);
        erro.codigo = "migracao-incompleta";
        erro.tabela = tabela;
        erro.divergencias = divergencias;
        throw erro;
      }
    }
    if (plano.tabelas.contactTags.length) {
      const { data, error } = await supabase
        .from("contact_tags")
        .select("contact_id,tag_id")
        .eq("organization_id", organizationId);
      if (error) throw erroRemoto(error, "validacao-tags-falhou");
      const presentes = new Set((data || []).map((row) => `${row.contact_id}:${row.tag_id}`));
      const ausentes = plano.tabelas.contactTags.filter((row) => !presentes.has(`${row.contact_id}:${row.tag_id}`));
      if (ausentes.length) {
        const erro = new Error(`A validação encontrou ${ausentes.length} vínculo(s) de tag ausente(s).`);
        erro.codigo = "migracao-incompleta";
        throw erro;
      }
    }
  };

  const validarFotosRemotas = async (plano, organizationId) => {
    if (!plano.avatars.length) return [];
    const ids = plano.avatars.map((avatar) => plano.ids.contacts.get(avatar.legacyId));
    const { data, error } = await supabase
      .from("contacts")
      .select("id,avatar_path")
      .eq("organization_id", organizationId)
      .in("id", ids);
    if (error) throw erroRemoto(error, "validacao-fotos-falhou");
    const porId = new Map((data || []).map((item) => [item.id, item.avatar_path]));
    const pendentes = [];
    for (const avatar of plano.avatars) {
      const remoteId = plano.ids.contacts.get(avatar.legacyId);
      const caminho = porId.get(remoteId) || avatar.existingPath;
      if (!caminho) {
        pendentes.push({ ...avatar, motivo: "avatar_path-ausente" });
        continue;
      }
      const { data: signed, error: signedError } = await supabase
        .storage
        .from("contact-avatars")
        .createSignedUrl(caminho, 60);
      if (signedError || !signed?.signedUrl) pendentes.push({ ...avatar, caminho, motivo: signedError?.message || "url-privada-indisponivel" });
    }
    return pendentes;
  };

  const etapasMigracao = (plano) => [
    { nome: "stages", tabela: "stages", rows: plano.tabelas.stages },
    { nome: "tags", tabela: "tags", rows: plano.tabelas.tags },
    { nome: "contacts", tabela: "contacts", rows: plano.tabelas.contacts },
    { nome: "deals", tabela: "deals", rows: plano.tabelas.deals },
    { nome: "tasks", tabela: "tasks", rows: plano.tabelas.tasks },
    { nome: "notes", tabela: "notes", rows: plano.tabelas.notes },
    { nome: "events", tabela: "contact_events", rows: plano.tabelas.events },
    { nome: "contactTags", tabela: "contact_tags", rows: plano.tabelas.contactTags },
    { nome: "photos", tabela: null, rows: plano.avatars },
    { nome: "validate", tabela: null, rows: [] },
  ];

  const totalEtapasMigracao = (etapas) => etapas.reduce((total, etapa) => total + etapa.rows.length, 0);

  const gravarProgressoMigracao = (valor) => gravarEstadoLegado(SNAPSHOT_ESTADO_CHAVE, valor);

  const montarTotaisSnapshot = (snapshot) => ({
    ...snapshot.totais,
    fotos: snapshot.totais.fotos || 0,
  });

  const migrarLegado = async ({ confirmado = false } = {}) => {
    const { organizationId } = await sessaoObrigatoria();
    let snapshot = await obterSnapshotMigracao(organizationId);
    if (!snapshot) {
      const pacotePreview = await exportarPacoteMigracao(organizationId);
      const totaisPreview = {
        contatos: pacotePreview.contatos.length,
        negocios: pacotePreview.negocios.length,
        tarefas: pacotePreview.tarefas.length,
        notas: pacotePreview.notas.length,
        estagios: pacotePreview.estagios.length,
        tags: pacotePreview.tags.length,
        eventos: pacotePreview.eventos?.length || 0,
        fotos: pacotePreview.contatos.filter((contato) => contato.fotoUrl || contato.avatarPath).length,
      };
      if (!confirmado) return { confirmado: false, totais: totaisPreview, temDados: temDadosMigraveis(pacotePreview) };
      snapshot = await criarSnapshotMigracao(organizationId);
    } else if (!confirmado) {
      return { confirmado: false, totais: montarTotaisSnapshot(snapshot), temDados: temDadosMigraveis(snapshot.pacote), snapshotId: snapshot.id };
    }

    if (!temDadosMigraveis(snapshot.pacote)) {
      await gravarEstadoLegado(SNAPSHOT_CONCLUIDO_CHAVE, { snapshotId: snapshot.id, assinatura: snapshot.assinatura, concluidoEm: Date.now(), totais: snapshot.totais });
      return { confirmado: true, concluida: true, totais: montarTotaisSnapshot(snapshot), snapshotId: snapshot.id };
    }

    const existentes = await buscarExistentes(organizationId);
    const plano = planejarMigracao({ pacote: snapshot.pacote, organizationId, existentes, gerarUuid: uuid });
    const etapas = etapasMigracao(plano);
    const total = totalEtapasMigracao(etapas);
    const estadoAnterior = await lerEstadoLegado(SNAPSHOT_ESTADO_CHAVE);
    const etapaAnterior = estadoAnterior?.snapshotId === snapshot.id && estadoAnterior.assinatura === snapshot.assinatura ? estadoAnterior.etapa : "stages";
    const indiceInicial = Math.max(0, etapas.findIndex((etapa) => etapa.nome === etapaAnterior));
    const acumuladoAntes = (indice) => etapas.slice(0, indice).reduce((soma, etapa) => soma + etapa.rows.length, 0);
    let etapaAtual = etapaAnterior;
    let processadoAtual = estadoAnterior?.snapshotId === snapshot.id ? estadoAnterior.processado || 0 : 0;
    let fotosMigradas = estadoAnterior?.snapshotId === snapshot.id ? estadoAnterior.fotos || [] : [];
    const salvarEstado = (etapa, processado, status = "processando", extras = {}) => gravarProgressoMigracao({
      snapshotId: snapshot.id,
      assinatura: snapshot.assinatura,
      etapa,
      processado,
      total,
      status,
      atualizadoEm: Date.now(),
      ...extras,
    }).then((resultado) => {
      etapaAtual = etapa;
      processadoAtual = processado;
      if (extras.fotos) fotosMigradas = extras.fotos;
      return resultado;
    });

    try {
      for (let indice = indiceInicial; indice < etapas.length; indice += 1) {
        const etapa = etapas[indice];
        const base = acumuladoAntes(indice);
        await salvarEstado(etapa.nome, base, "processando");
        if (etapa.nome === "photos") {
          const fotos = [];
          for (let i = 0; i < etapa.rows.length; i += 1) {
            const item = etapa.rows[i];
            const contato = snapshot.pacote.contatos.find((registro) => registro.id === item.legacyId);
            const resultado = await subirFoto(contato, plano.ids.contacts.get(item.legacyId), organizationId);
            fotos.push({ ...item, ...resultado });
            await salvarEstado(etapa.nome, base + i + 1, "processando", { fotos });
          }
          fotosMigradas = fotos;
          const fotosPendentes = fotos.filter((foto) => !foto.ok);
          if (fotosPendentes.length) {
            const pacoteParcial = montarPacoteLocal(snapshot.pacote, plano, fotos);
            db.definirWorkspace(organizationId);
            await local["dados.importar"]({ pacote: pacoteParcial });
            await gravarEstadoLegado(SNAPSHOT_ESTADO_CHAVE, {
              snapshotId: snapshot.id, assinatura: snapshot.assinatura, etapa: "photos", processado: base + etapa.rows.length,
              total, status: "pendente-fotos", fotos, fotosPendentes, atualizadoEm: Date.now(),
            });
            return { confirmado: true, concluida: false, totais: montarTotaisSnapshot(snapshot), fotos, fotosPendentes, snapshotId: snapshot.id };
          }
          for (const foto of fotos) {
            const contato = plano.tabelas.contacts.find((registro) => registro.legacy_id === foto.legacyId);
            if (contato && foto.ok) contato.avatar_path = foto.caminho;
          }
          await salvarEstado("validate", base + etapa.rows.length, "processando", { fotos });
          continue;
        }
        if (etapa.nome === "validate") {
          await validarMigracaoRemota(plano, organizationId);
          const fotosPendentes = await validarFotosRemotas(plano, organizationId);
          if (fotosPendentes.length) {
            await salvarEstado("photos", total - fotosPendentes.length, "pendente-fotos", { fotosPendentes });
            return { confirmado: true, concluida: false, totais: montarTotaisSnapshot(snapshot), fotosPendentes, snapshotId: snapshot.id };
          }
          await salvarEstado("complete", total, "concluido");
          const pacoteLocal = montarPacoteLocal(snapshot.pacote, plano, fotosMigradas);
          db.definirWorkspace(organizationId);
          await local["dados.importar"]({ pacote: pacoteLocal });
          for (const tipo of ORDEM) {
            for (const item of pacoteLocal[{ estagios: "estagios", tags: "tags", contatos: "contatos", negocios: "negocios", tarefas: "tarefas", notas: "notas", eventos: "eventos" }[tipo]] || []) {
              await salvarMapa(tipo, item.id, item.remoteId);
            }
          }
          const concluida = { snapshotId: snapshot.id, assinatura: snapshot.assinatura, concluidoEm: Date.now(), totais: snapshot.totais };
          await gravarEstadoLegado(SNAPSHOT_CONCLUIDO_CHAVE, concluida);
          await db.gravar(db.LOJAS.sync, { chave: "migracao-concluida", valor: concluida.concluidoEm, totais: snapshot.totais });
          await db.apagar(db.LOJAS.sync, "migracao-pendente-fotos");
          return { confirmado: true, concluida: true, totais: montarTotaisSnapshot(snapshot), snapshotId: snapshot.id };
        }
        for (let i = 0; i < etapa.rows.length; i += BATCH) {
          const lote = etapa.rows.slice(i, i + BATCH);
          const { error } = await supabase.from(etapa.tabela).upsert(lote, { onConflict: etapa.nome === "contactTags" ? "contact_id,tag_id" : "id" });
          if (error) throw erroRemoto(error, `migracao-${etapa.nome}-falhou`);
          await salvarEstado(etapa.nome, base + Math.min(i + lote.length, etapa.rows.length), "processando");
        }
      }
      throw new Error("A migração não alcançou a etapa de validação.");
    } catch (error) {
      await salvarEstado(etapaAtual, processadoAtual, "erro", { erro: error?.message || String(error), fotos: fotosMigradas });
      throw erroRemoto(error, "migracao-falhou");
    }
  };

  const migracaoStatus = async () => {
    const { organizationId } = await sessaoObrigatoria();
    const snapshot = await obterSnapshotMigracao(organizationId);
    const legado = snapshot?.pacote || await exportarPacoteMigracao(organizationId);
    const totais = snapshot ? montarTotaisSnapshot(snapshot) : {
      contatos: legado.contatos.length, negocios: legado.negocios.length, tarefas: legado.tarefas.length,
      notas: legado.notas.length, estagios: legado.estagios.length, tags: legado.tags.length,
      eventos: legado.eventos?.length || 0, fotos: legado.contatos.filter((contato) => contato.fotoUrl || contato.avatarPath).length,
    };
    const estado = snapshot ? await lerEstadoLegado(SNAPSHOT_ESTADO_CHAVE) : null;
    const concluida = snapshot ? await lerEstadoLegado(SNAPSHOT_CONCLUIDO_CHAVE) : null;
    const base = {
      concluida: false,
      temDados: temDadosMigraveis(legado),
      totais,
      fotos: totais.fotos || 0,
      fotosPendentes: estado?.status === "pendente-fotos" ? (estado.fotosPendentes?.length || 0) : 0,
      snapshotId: snapshot?.id || null,
      snapshotCriadoEm: snapshot?.criadoEm || null,
      etapa: estado?.etapa || (snapshot ? "snapshot" : null),
      progresso: estado ? { processado: estado.processado || 0, total: estado.total || 0, status: estado.status } : null,
    };
    if (!base.temDados) return { ...base, concluida: true };
    if (!concluida || concluida.snapshotId !== snapshot?.id || concluida.assinatura !== snapshot?.assinatura) return base;
    // O snapshot valida somente a carga inicial. Depois de concluído, o sync
    // normal pode alterar os registros; isso não deve reabrir a migração.
    return {
      ...base,
      concluida: true,
      etapa: "complete",
      progresso: {
        processado: base.progresso?.total || 0,
        total: base.progresso?.total || 0,
        status: "concluido",
      },
    };
  };

  const operacoes = {
    "sync.status": status,
    "sync.executar": executar,
    "sync.migracaoStatus": migracaoStatus,
    "sync.migrarLegado": migrarLegado,
  };

  const wrappedLocal = {};
  for (const [op, executarLocal] of Object.entries(local)) {
    wrappedLocal[op] = async (args = {}) => {
      // O service worker MV3 perde variáveis de módulo quando dorme. Restaurar
      // o workspace antes de QUALQUER leitura local impede o painel do
      // WhatsApp de acordar no banco legado vazio e deixar de reconhecer o
      // contato (e suas etiquetas) até a Gestão ser aberta novamente.
      await lerWorkspace();
      const antes = await capturarAntes(op, args);
      let resultado = await executarLocal(args);
      if (op === "chatbots.prepararAutomatico") {
        resultado = await reivindicarExecucaoChatbot(args, resultado);
      }
      try {
        await registrarResultado(op, args, resultado, antes);
        if (op === "chatbots.marcarAutomaticoEnviado" && resultado) {
          void concluirExecucaoChatbot(args.executionId, "sent", { enviado: true });
        } else if (op === "chatbots.cancelarAutomatico" && resultado) {
          void concluirExecucaoChatbot(args.executionId, "failed", { erro: args.erro || null });
        } else if (op === "chatbots.executar" && resultado) {
          void concluirExecucaoChatbot(args.preparacao?.executionId, "sent", {
            chatbotId: resultado.chatbotId,
            etiquetas: resultado.etiquetas || [],
            transferencia: resultado.transferencia || null,
          });
        }
        if (db.obterWorkspace() && !LOCAL_SEM_SYNC.has(op)) {
          void executar().catch(() => {});
        }
      } catch (error) {
        console.error(`[EmyLeads] fila ${op} falhou:`, error);
      }
      return resultado;
    };
  }

  return { operacoes: { ...wrappedLocal, ...operacoes }, syncInterno: { registrarResultado, executar, status } };
}
