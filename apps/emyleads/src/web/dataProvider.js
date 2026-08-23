import { criarChatbot } from "../domain/chatbots.js";
import { normalizePhone } from "../lib/phone.js";
import { obterSupabaseWeb } from "./supabaseClient.js";
import { webArea, WORKSPACE_KEY } from "./storage.js";

const CONFIG_KEY = "emyleads.web.config";
const AUTOMACAO_KEY = "emyleads.web.automacao";
const epoch = (value) => value ? new Date(value).getTime() : null;
const iso = (value) => value == null ? null : new Date(value).toISOString();
const texto = (value, fallback = "") => String(value ?? fallback).trim();

function falha(error, codigo = "web-provider-falhou") {
  const e = new Error(error?.message || "Não foi possível concluir a operação.");
  e.codigo = codigo;
  e.status = error?.status;
  return e;
}

function contato(row) {
  return {
    id: row.id, remoteId: row.id, nome: row.name || "", telefone: row.phone || "",
    waId: row.whatsapp_id || null, fotoUrl: null, avatarPath: row.avatar_path || null,
    ultimaEm: epoch(row.last_interaction_at), empresa: row.company || "", cargo: row.job_title || "",
    email: row.email || "", origem: row.source || "", responsavel: row.owner_label || "",
    tags: (row.contact_tags || []).map((item) => item.tag_id),
    criadoEm: epoch(row.created_at) || Date.now(), atualizadoEm: epoch(row.updated_at) || Date.now(),
  };
}

function negocio(row) {
  return {
    id: row.id, remoteId: row.id, contactId: row.contact_id, stageId: row.stage_id,
    titulo: row.title || "", valor: row.value == null ? null : Number(row.value),
    origem: row.source || "", status: row.status || "aberto", motivoPerda: row.loss_reason || "",
    criadoEm: epoch(row.created_at) || Date.now(), atualizadoEm: epoch(row.updated_at) || Date.now(),
  };
}

function tarefa(row) {
  return {
    id: row.id, remoteId: row.id, contactId: row.contact_id, dealId: row.deal_id || null,
    titulo: row.title || "", venceEm: epoch(row.due_at), concluida: Boolean(row.completed),
    concluidaEm: epoch(row.completed_at), responsavel: row.owner_label || "",
    criadoEm: epoch(row.created_at) || Date.now(), atualizadoEm: epoch(row.updated_at) || Date.now(),
  };
}

function nota(row) {
  return {
    id: row.id, remoteId: row.id, contactId: row.contact_id, texto: row.body || "",
    autor: row.author_label || "", criadoEm: epoch(row.created_at) || Date.now(),
    atualizadoEm: epoch(row.updated_at) || Date.now(),
  };
}

function evento(row) {
  return {
    id: row.id, remoteId: row.id, contactId: row.contact_id, tipo: row.event_type,
    entidadeTipo: row.entity_type || null, entidadeId: row.entity_id || null,
    origem: row.source || "app", carga: row.payload || {},
    ocorridoEm: epoch(row.occurred_at) || Date.now(), criadoEm: epoch(row.created_at) || Date.now(),
  };
}

function chatbot(row) {
  const definition = row.definition && typeof row.definition === "object" ? row.definition : {};
  return {
    ...definition,
    id: row.id,
    nome: row.name,
    ativo: Boolean(row.active),
    execucoes: Number(row.executions || 0),
    ultimaExecucaoEm: epoch(row.last_execution_at),
    criadoEm: epoch(row.created_at) || Date.now(),
    atualizadoEm: epoch(row.updated_at) || Date.now(),
    version: Number(row.version || 1),
  };
}

export function criarOperacoesDadosWeb({ supabase = obterSupabaseWeb(), area = webArea } = {}) {
  const contexto = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw falha(error, "sessao-falhou");
    const user = data?.session?.user;
    const organizationId = (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    if (!user || !organizationId) throw falha({ message: "Entre em uma empresa para continuar." }, "workspace-ausente");
    const { data: membership, error: membershipError } = await supabase
      .from("organization_members").select("role,status")
      .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw falha(membershipError, "organizacao-permissao-falhou");
    if (!membership || membership.status !== "active") throw falha({ message: "Você não tem acesso a esta empresa." }, "organizacao-sem-acesso");
    return { organizationId, userId: user.id, role: membership.role };
  };

  const executar = async (query, codigo) => {
    const { data, error } = await query;
    if (error) throw falha(error, codigo);
    return data;
  };

  const registrarEvento = async ({ organizationId, userId }, dados) => {
    if (!dados.contactId) return;
    await supabase.from("contact_events").insert({
      organization_id: organizationId, contact_id: dados.contactId,
      event_type: dados.tipo, entity_type: dados.entidadeTipo || null,
      entity_id: dados.entidadeId || null, source: dados.origem || "web",
      payload: dados.carga || {}, occurred_at: new Date().toISOString(), created_by: userId,
    }).then(() => {}).catch(() => {});
  };

  const listarContatos = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("contacts")
      .select("*,contact_tags(tag_id)").eq("organization_id", ctx.organizationId)
      .is("deleted_at", null).order("updated_at", { ascending: false }), "contatos-lista-falhou");
    return (rows || []).map(contato);
  };

  const salvarTagsContato = async (ctx, contactId, tags = []) => {
    await executar(supabase.from("contact_tags").delete()
      .eq("organization_id", ctx.organizationId).eq("contact_id", contactId), "contato-tags-limpeza-falhou");
    const ids = [...new Set((tags || []).filter(Boolean))];
    if (ids.length) await executar(supabase.from("contact_tags").insert(
      ids.map((tagId) => ({ organization_id: ctx.organizationId, contact_id: contactId, tag_id: tagId })),
    ), "contato-tags-falhou");
  };

  const criarContato = async (dados = {}) => {
    const ctx = await contexto();
    const row = await executar(supabase.from("contacts").insert({
      organization_id: ctx.organizationId, name: texto(dados.nome),
      phone: normalizePhone(dados.telefone) || "", whatsapp_id: dados.waId || null,
      company: texto(dados.empresa), job_title: texto(dados.cargo), email: texto(dados.email) || null,
      source: texto(dados.origem), owner_label: texto(dados.responsavel),
      last_interaction_at: iso(dados.ultimaEm), created_by: ctx.userId, updated_by: ctx.userId,
    }).select("*").single(), "contato-criacao-falhou");
    await salvarTagsContato(ctx, row.id, dados.tags);
    await registrarEvento(ctx, { contactId: row.id, tipo: "contact.created", entidadeTipo: "contato", entidadeId: row.id });
    return contato({ ...row, contact_tags: (dados.tags || []).map((tag_id) => ({ tag_id })) });
  };

  const atualizarContato = async ({ id, patch = {} }) => {
    const ctx = await contexto();
    const campos = {
      nome: "name", telefone: "phone", waId: "whatsapp_id", empresa: "company",
      cargo: "job_title", email: "email", origem: "source", responsavel: "owner_label",
      avatarPath: "avatar_path", ultimaEm: "last_interaction_at",
    };
    const payload = { updated_by: ctx.userId };
    for (const [campo, coluna] of Object.entries(campos)) {
      if (patch[campo] === undefined) continue;
      payload[coluna] = campo === "telefone" ? normalizePhone(patch[campo]) || ""
        : campo === "ultimaEm" ? iso(patch[campo]) : patch[campo] || (campo === "email" || campo === "waId" ? null : "");
    }
    const row = await executar(supabase.from("contacts").update(payload)
      .eq("organization_id", ctx.organizationId).eq("id", id).is("deleted_at", null)
      .select("*").single(), "contato-atualizacao-falhou");
    if (patch.tags !== undefined) await salvarTagsContato(ctx, id, patch.tags);
    await registrarEvento(ctx, { contactId: id, tipo: "contact.updated", entidadeTipo: "contato", entidadeId: id, carga: { campos: Object.keys(patch) } });
    const tags = patch.tags ?? (await listarContatos()).find((item) => item.id === id)?.tags ?? [];
    return contato({ ...row, contact_tags: tags.map((tag_id) => ({ tag_id })) });
  };

  const listarNegocios = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("deals").select("*")
      .eq("organization_id", ctx.organizationId).is("deleted_at", null)
      .order("updated_at", { ascending: false }), "negocios-lista-falhou");
    return (rows || []).map(negocio);
  };

  const criarNegocio = async (dados = {}) => {
    const ctx = await contexto();
    const row = await executar(supabase.from("deals").insert({
      organization_id: ctx.organizationId, contact_id: dados.contactId, stage_id: dados.stageId,
      title: texto(dados.titulo), value: dados.valor === "" || dados.valor == null ? null : Number(dados.valor),
      source: texto(dados.origem), status: dados.status || "aberto", loss_reason: texto(dados.motivoPerda),
      created_by: ctx.userId, updated_by: ctx.userId,
    }).select("*").single(), "negocio-criacao-falhou");
    await registrarEvento(ctx, { contactId: row.contact_id, tipo: "deal.created", entidadeTipo: "negocio", entidadeId: row.id, carga: { titulo: row.title } });
    return negocio(row);
  };

  const atualizarNegocio = async ({ id, patch = {} }) => {
    const ctx = await contexto();
    const campos = { contactId: "contact_id", stageId: "stage_id", titulo: "title", valor: "value", origem: "source", status: "status", motivoPerda: "loss_reason" };
    const payload = { updated_by: ctx.userId };
    for (const [campo, coluna] of Object.entries(campos)) if (patch[campo] !== undefined) payload[coluna] = campo === "valor" ? (patch[campo] === "" || patch[campo] == null ? null : Number(patch[campo])) : patch[campo];
    const row = await executar(supabase.from("deals").update(payload).eq("organization_id", ctx.organizationId).eq("id", id).select("*").single(), "negocio-atualizacao-falhou");
    await registrarEvento(ctx, { contactId: row.contact_id, tipo: "deal.updated", entidadeTipo: "negocio", entidadeId: id, carga: { campos: Object.keys(patch) } });
    return negocio(row);
  };

  const listarTarefas = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("tasks").select("*")
      .eq("organization_id", ctx.organizationId).is("deleted_at", null)
      .order("updated_at", { ascending: false }), "tarefas-lista-falhou");
    return (rows || []).map(tarefa);
  };

  const criarTarefa = async (dados = {}) => {
    const ctx = await contexto();
    const row = await executar(supabase.from("tasks").insert({
      organization_id: ctx.organizationId, contact_id: dados.contactId, deal_id: dados.dealId || null,
      title: texto(dados.titulo), due_at: iso(dados.venceEm), completed: Boolean(dados.concluida),
      completed_at: dados.concluida ? new Date().toISOString() : null, owner_label: texto(dados.responsavel),
      owner_id: ctx.userId, created_by: ctx.userId, updated_by: ctx.userId,
    }).select("*").single(), "tarefa-criacao-falhou");
    await registrarEvento(ctx, { contactId: row.contact_id, tipo: "task.created", entidadeTipo: "tarefa", entidadeId: row.id, carga: { titulo: row.title } });
    return tarefa(row);
  };

  const atualizarTarefa = async ({ id, patch = {} }) => {
    const ctx = await contexto();
    const campos = { contactId: "contact_id", dealId: "deal_id", titulo: "title", venceEm: "due_at", concluida: "completed", concluidaEm: "completed_at", responsavel: "owner_label" };
    const payload = { updated_by: ctx.userId };
    for (const [campo, coluna] of Object.entries(campos)) if (patch[campo] !== undefined) payload[coluna] = campo === "venceEm" || campo === "concluidaEm" ? iso(patch[campo]) : patch[campo];
    const row = await executar(supabase.from("tasks").update(payload).eq("organization_id", ctx.organizationId).eq("id", id).select("*").single(), "tarefa-atualizacao-falhou");
    await registrarEvento(ctx, { contactId: row.contact_id, tipo: "task.updated", entidadeTipo: "tarefa", entidadeId: id, carga: { campos: Object.keys(patch) } });
    return tarefa(row);
  };

  const listarNotas = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("notes").select("*")
      .eq("organization_id", ctx.organizationId).is("deleted_at", null)
      .order("created_at", { ascending: false }), "notas-lista-falhou");
    return (rows || []).map(nota);
  };

  const criarNota = async (dados = {}) => {
    const ctx = await contexto();
    const row = await executar(supabase.from("notes").insert({
      organization_id: ctx.organizationId, contact_id: dados.contactId,
      body: texto(dados.texto), author_label: texto(dados.autor),
      created_by: ctx.userId, updated_by: ctx.userId,
    }).select("*").single(), "nota-criacao-falhou");
    await registrarEvento(ctx, { contactId: row.contact_id, tipo: "note.created", entidadeTipo: "nota", entidadeId: row.id });
    return nota(row);
  };

  const listarEventos = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("contact_events").select("*")
      .eq("organization_id", ctx.organizationId).order("occurred_at", { ascending: false }).limit(1000), "eventos-lista-falhou");
    return (rows || []).map(evento);
  };

  const listarEstagios = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("stages").select("*")
      .eq("organization_id", ctx.organizationId).is("deleted_at", null).order("position"), "estagios-lista-falhou");
    return (rows || []).map((row) => ({ id: row.id, remoteId: row.id, nome: row.name, ordem: row.position }));
  };

  const salvarEstagios = async ({ estagios = [] }) => {
    const ctx = await contexto();
    if (estagios.length > 1) {
      const atuais = await listarEstagios();
      for (const [index, item] of atuais.entries()) {
        await executar(supabase.from("stages").update({ position: 1000 + index })
          .eq("organization_id", ctx.organizationId).eq("id", item.id), "estagios-reordenacao-falhou");
      }
    }
    for (const item of estagios) {
      const base = { name: texto(item.nome), position: Number(item.ordem), updated_by: ctx.userId };
      if (/^[0-9a-f-]{36}$/i.test(item.id || "")) {
        await executar(supabase.from("stages").update(base).eq("organization_id", ctx.organizationId).eq("id", item.id), "estagio-atualizacao-falhou");
      } else {
        await executar(supabase.from("stages").upsert({ ...base, organization_id: ctx.organizationId, legacy_id: item.id, created_by: ctx.userId }, { onConflict: "organization_id,legacy_id" }), "estagio-criacao-falhou");
      }
    }
    return listarEstagios();
  };

  const listarTags = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("tags").select("*")
      .eq("organization_id", ctx.organizationId).is("deleted_at", null).order("name"), "tags-lista-falhou");
    return (rows || []).map((row) => ({ id: row.id, remoteId: row.id, nome: row.name, cor: row.color }));
  };

  const salvarTags = async ({ tags = [] }) => {
    const ctx = await contexto();
    for (const item of tags) {
      const base = { name: texto(item.nome), color: item.cor || "#626B7A", updated_by: ctx.userId };
      if (/^[0-9a-f-]{36}$/i.test(item.id || "")) {
        await executar(supabase.from("tags").update(base).eq("organization_id", ctx.organizationId).eq("id", item.id), "tag-atualizacao-falhou");
      } else {
        await executar(supabase.from("tags").upsert({ ...base, organization_id: ctx.organizationId, legacy_id: item.id, created_by: ctx.userId }, { onConflict: "organization_id,legacy_id" }), "tag-criacao-falhou");
      }
    }
    return listarTags();
  };

  const listarChatbots = async () => {
    const ctx = await contexto();
    const rows = await executar(supabase.from("chatbot_definitions").select("*")
      .eq("organization_id", ctx.organizationId).is("deleted_at", null).order("created_at"), "chatbots-lista-falhou");
    return (rows || []).map(chatbot);
  };

  const criarChatbotWeb = async (dados = {}) => {
    const ctx = await contexto();
    const bot = criarChatbot(dados);
    const { id: _id, nome, ativo, execucoes: _execucoes, ultimaExecucaoEm: _ultima, criadoEm: _criado, atualizadoEm: _atualizado, ...definition } = bot;
    const row = await executar(supabase.from("chatbot_definitions").insert({
      organization_id: ctx.organizationId, name: nome, active: ativo,
      definition, created_by: ctx.userId, updated_by: ctx.userId,
    }).select("*").single(), "chatbot-criacao-falhou");
    return chatbot(row);
  };

  const atualizarChatbotWeb = async ({ id, patch = {} }) => {
    const ctx = await contexto();
    const atual = (await listarChatbots()).find((item) => item.id === id);
    if (!atual) throw falha({ message: "Chatbot não encontrado." }, "chatbot-nao-encontrado");
    const proximo = { ...atual, ...patch };
    const { id: _id, nome, ativo, execucoes: _execucoes, ultimaExecucaoEm: _ultima, criadoEm: _criado, atualizadoEm: _atualizado, version: _version, ...definition } = proximo;
    const row = await executar(supabase.from("chatbot_definitions").update({ name: nome, active: ativo, definition, updated_by: ctx.userId })
      .eq("organization_id", ctx.organizationId).eq("id", id).select("*").single(), "chatbot-atualizacao-falhou");
    return chatbot(row);
  };

  const softDelete = async (table, id, codigo) => {
    const ctx = await contexto();
    await executar(supabase.from(table).update({ deleted_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq("organization_id", ctx.organizationId).eq("id", id), codigo);
    return { id };
  };

  const operacoes = {
    "sync.executar": async () => ({ sincronizado: true, origem: "supabase" }),
    "sync.status": async () => ({ sincronizado: true, origem: "supabase" }),
    "sync.migracaoStatus": async () => ({ temDados: false, concluida: true, totais: {} }),
    "sync.migrarLegado": async () => ({ concluida: true }),

    "contatos.listar": listarContatos,
    "contatos.buscar": async ({ id }) => (await listarContatos()).find((item) => item.id === id) || null,
    "contatos.criar": criarContato,
    "contatos.atualizar": atualizarContato,
    "contatos.remover": async ({ id }) => {
      const ctx = await contexto();
      const deletedAt = new Date().toISOString();
      for (const table of ["deals", "tasks", "notes"]) {
        await executar(supabase.from(table).update({ deleted_at: deletedAt, updated_by: ctx.userId })
          .eq("organization_id", ctx.organizationId).eq("contact_id", id), "contato-dependencias-remocao-falhou");
      }
      return softDelete("contacts", id, "contato-remocao-falhou");
    },
    "contatos.ficha": async ({ contactId }) => ({
      contato: (await listarContatos()).find((item) => item.id === contactId) || null,
      negocios: (await listarNegocios()).filter((item) => item.contactId === contactId),
      tarefas: (await listarTarefas()).filter((item) => item.contactId === contactId),
      notas: (await listarNotas()).filter((item) => item.contactId === contactId),
      eventos: (await listarEventos()).filter((item) => item.contactId === contactId),
    }),
    "contatos.importar": async ({ linhas = [] }) => {
      let importados = 0; const ignorados = [];
      for (const linha of linhas) { try { await criarContato(linha); importados += 1; } catch (error) { ignorados.push({ ...linha, motivo: error.message }); } }
      return { importados, ignorados };
    },

    "negocios.listar": listarNegocios,
    "negocios.porContato": async ({ contactId }) => (await listarNegocios()).filter((item) => item.contactId === contactId),
    "negocios.criar": criarNegocio,
    "negocios.atualizar": atualizarNegocio,
    "negocios.remover": async ({ id }) => softDelete("deals", id, "negocio-remocao-falhou"),

    "tarefas.listar": listarTarefas,
    "tarefas.porContato": async ({ contactId }) => (await listarTarefas()).filter((item) => item.contactId === contactId),
    "tarefas.criar": criarTarefa,
    "tarefas.atualizar": atualizarTarefa,
    "tarefas.concluir": ({ id, concluida }) => atualizarTarefa({ id, patch: { concluida, concluidaEm: concluida ? Date.now() : null } }),
    "tarefas.remover": async ({ id }) => softDelete("tasks", id, "tarefa-remocao-falhou"),

    "notas.listar": listarNotas,
    "notas.porContato": async ({ contactId }) => (await listarNotas()).filter((item) => item.contactId === contactId),
    "notas.criar": criarNota,
    "notas.remover": async ({ id }) => softDelete("notes", id, "nota-remocao-falhou"),

    "eventos.listar": listarEventos,
    "eventos.porContato": async ({ contactId }) => (await listarEventos()).filter((item) => item.contactId === contactId),

    "estagios.listar": listarEstagios,
    "estagios.salvar": salvarEstagios,
    "estagios.remover": async ({ id, moverPara = null }) => {
      const ctx = await contexto();
      const { count } = await supabase.from("deals").select("id", { count: "exact", head: true }).eq("organization_id", ctx.organizationId).eq("stage_id", id).is("deleted_at", null);
      if (count && !moverPara) { const e = falha({ message: "Este estágio possui negócios." }, "estagio-com-negocios"); e.quantidade = count; throw e; }
      if (count) await executar(supabase.from("deals").update({ stage_id: moverPara, updated_by: ctx.userId }).eq("organization_id", ctx.organizationId).eq("stage_id", id), "estagio-mover-negocios-falhou");
      return softDelete("stages", id, "estagio-remocao-falhou");
    },

    "tags.listar": listarTags,
    "tags.salvar": salvarTags,
    "tags.remover": async ({ id }) => {
      const ctx = await contexto();
      const { count } = await supabase.from("contact_tags").select("contact_id", { count: "exact", head: true }).eq("organization_id", ctx.organizationId).eq("tag_id", id);
      await executar(supabase.from("contact_tags").delete().eq("organization_id", ctx.organizationId).eq("tag_id", id), "tag-vinculos-remocao-falhou");
      await softDelete("tags", id, "tag-remocao-falhou");
      return { id, contatosAfetados: count || 0 };
    },

    "chatbots.listar": listarChatbots,
    "chatbots.buscar": async ({ id }) => (await listarChatbots()).find((item) => item.id === id) || null,
    "chatbots.criar": criarChatbotWeb,
    "chatbots.atualizar": atualizarChatbotWeb,
    "chatbots.remover": async ({ id }) => softDelete("chatbot_definitions", id, "chatbot-remocao-falhou"),
    "chatbots.duplicar": async ({ id }) => {
      const atual = (await listarChatbots()).find((item) => item.id === id);
      if (!atual) throw falha({ message: "Chatbot não encontrado." }, "chatbot-nao-encontrado");
      return criarChatbotWeb({ ...atual, id: undefined, nome: `${atual.nome} (cópia)`, execucoes: 0, ultimaExecucaoEm: null });
    },

    "automacao.estado": async () => (await area.get(AUTOMACAO_KEY))[AUTOMACAO_KEY] || { pausada: false },
    "automacao.pausar": async ({ pausada }) => { const valor = { pausada: Boolean(pausada), atualizadoEm: Date.now() }; await area.set({ [AUTOMACAO_KEY]: valor }); return valor; },
    "automacao.diario": async () => [],
    "automacao.registrar": async () => ({ registrado: true }),

    "config.ler": async ({ chave }) => ((await area.get(CONFIG_KEY))[CONFIG_KEY] || {})[chave] ?? null,
    "config.gravar": async ({ chave, valor }) => { const todos = (await area.get(CONFIG_KEY))[CONFIG_KEY] || {}; todos[chave] = valor; await area.set({ [CONFIG_KEY]: todos }); return valor; },

    "dados.exportar": async () => ({
      versao: 1, contatos: await listarContatos(), negocios: await listarNegocios(),
      tarefas: await listarTarefas(), notas: await listarNotas(), eventos: await listarEventos(),
      estagios: await listarEstagios(), tags: await listarTags(), chatbots: await listarChatbots(),
    }),
    "dados.importar": async () => { throw falha({ message: "A restauração em nuvem será liberada após a validação administrativa do arquivo." }, "importacao-web-bloqueada"); },
    "dados.apagar": async () => { throw falha({ message: "A exclusão total precisa ser confirmada por um administrador no servidor." }, "exclusao-web-bloqueada"); },
  };

  return operacoes;
}
