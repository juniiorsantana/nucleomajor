import { obterSupabase } from "./supabaseClient.js";

const WORKSPACE_KEY = "emyleads.workspace.atual";

function erroAgenda(error, codigo = "agenda-falhou") {
  const erro = new Error(error?.message || "Não foi possível acessar a agenda.");
  erro.codigo = codigo;
  return erro;
}

const texto = (valor, fallback = "") => String(valor ?? fallback).trim();

function normalizarEvento(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    taskId: row.task_id || null,
    organizationId: row.organization_id,
    ownerId: row.owner_id || null,
    ownerName: row.owner_name || "",
    titulo: row.title || "",
    descricao: row.description || "",
    inicio: row.starts_at,
    fim: row.ends_at,
    diaInteiro: Boolean(row.all_day),
    tipo: row.kind,
    visibilidade: row.visibility,
    contactId: row.contact_id || null,
    status: row.status,
    googleEventId: row.google_event_id || null,
    googleCalendarId: row.google_calendar_id || null,
    categoryId: row.category_id || null,
    categoryName: row.category_name || (row.source_type === "task" ? "Tarefa" : "Atividade"),
    categoryColor: row.category_color || (row.source_type === "task" ? "#F59E0B" : "#34D399"),
    local: row.location || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    lembretes: Array.isArray(row.reminder_minutes) ? row.reminder_minutes : [],
  };
}

function instante(valor, campo) {
  const data = new Date(valor);
  if (!valor || Number.isNaN(data.getTime())) {
    const erro = new Error(`Informe uma data válida para ${campo}.`);
    erro.codigo = "agenda-data-invalida";
    throw erro;
  }
  return data.toISOString();
}

function validarIntervalo(inicio, fim) {
  if (new Date(fim).getTime() <= new Date(inicio).getTime()) {
    const erro = new Error("O fim precisa ser depois do início.");
    erro.codigo = "agenda-intervalo-invalido";
    throw erro;
  }
}

export function criarOperacoesAgenda({ supabase = obterSupabase(), area = chrome.storage.local } = {}) {
  const workspace = async () => {
    const salvo = (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    const { data, error } = await supabase.auth.getSession();
    if (error) throw erroAgenda(error, "sessao-falhou");
    const user = data?.session?.user;
    if (!user || !salvo) {
      throw erroAgenda({ message: "Entre em uma empresa antes de acessar a agenda." }, "workspace-ausente");
    }
    return { organizationId: salvo, userId: user.id };
  };

  const membro = async () => {
    const { organizationId, userId } = await workspace();
    const { data, error } = await supabase
      .from("organization_members")
      .select("role,status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw erroAgenda(error, "agenda-permissao-falhou");
    if (!data || data.status !== "active") {
      throw erroAgenda({ message: "Você não tem acesso a esta empresa." }, "organizacao-sem-acesso");
    }
    return { ...data, organizationId, userId };
  };

  const intervalo = (de, ate) => ({
    inicio: instante(de, "o início"),
    fim: instante(ate, "o fim"),
  });

  const categoriaPadrao = async (organizationId) => {
    const { data, error } = await supabase
      .from("calendar_categories")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw erroAgenda(error, "agenda-categoria-falhou");
    if (!data?.id) throw erroAgenda({ message: "A empresa não possui uma categoria de agenda ativa." }, "agenda-categoria-ausente");
    return data.id;
  };

  const validarCategoria = (nome, cor) => {
    const nomeSeguro = texto(nome).slice(0, 60);
    const corSegura = texto(cor).toUpperCase();
    if (!nomeSeguro) throw erroAgenda({ message: "Informe o nome da categoria." }, "agenda-categoria-nome-ausente");
    if (!/^#[0-9A-F]{6}$/.test(corSegura)) throw erroAgenda({ message: "Informe uma cor hexadecimal válida." }, "agenda-categoria-cor-invalida");
    return { nome: nomeSeguro, cor: corSegura };
  };

  const criar = async ({
    titulo,
    descricao = "",
    inicio,
    fim,
    diaInteiro = false,
    tipo = "appointment",
    visibilidade = "personal",
    contactId = null,
    categoryId = null,
    local = "",
    tags = [],
    status = "scheduled",
    lembretes = [30],
  }) => {
    const atual = await membro();
    const startsAt = instante(inicio, "o início");
    const endsAt = instante(fim, "o fim");
    validarIntervalo(startsAt, endsAt);
    const payload = {
      organization_id: atual.organizationId,
      owner_id: atual.userId,
      created_by: atual.userId,
      updated_by: atual.userId,
      title: texto(titulo),
      description: texto(descricao),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: Boolean(diaInteiro),
      kind: tipo,
      visibility: visibilidade,
      contact_id: contactId || null,
      category_id: categoryId || await categoriaPadrao(atual.organizationId),
      location: texto(local).slice(0, 500),
      tags: Array.isArray(tags) ? tags.map((tag) => texto(tag).slice(0, 40)).filter(Boolean).slice(0, 12) : [],
      status,
      reminder_minutes: Array.isArray(lembretes) ? [...new Set(lembretes.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 10080).slice(0, 5) : [],
    };
    if (!payload.title) throw erroAgenda({ message: "Informe um título para o evento." }, "agenda-titulo-ausente");
    if (!['personal', 'organization'].includes(payload.visibility)) {
      throw erroAgenda({ message: "Visibilidade de agenda inválida." }, "agenda-visibilidade-invalida");
    }
    if (payload.visibility === "organization" && !["owner", "admin"].includes(atual.role)) {
      throw erroAgenda({ message: "Somente donos e administradores criam eventos da empresa." }, "agenda-organizacional-sem-permissao");
    }

    const { data, error } = await supabase.from("calendar_events").insert(payload).select("*").single();
    if (error) throw erroAgenda(error);
    return normalizarEvento({ ...data, source_type: "event", owner_name: "" });
  };

  const atualizar = async ({ id, patch = {} }) => {
    const atual = await membro();
    const permitido = {};
    const campos = {
      titulo: "title",
      descricao: "description",
      inicio: "starts_at",
      fim: "ends_at",
      diaInteiro: "all_day",
      tipo: "kind",
      visibilidade: "visibility",
      contactId: "contact_id",
      categoryId: "category_id",
      local: "location",
      tags: "tags",
      lembretes: "reminder_minutes",
      status: "status",
    };
    for (const [campo, coluna] of Object.entries(campos)) {
      if (patch[campo] === undefined) continue;
      permitido[coluna] = ["inicio", "fim"].includes(campo)
        ? instante(patch[campo], campo === "inicio" ? "o início" : "o fim")
        : campo === "titulo" || campo === "descricao" || campo === "local"
          ? (campo === "local" ? texto(patch[campo]).slice(0, 500) : texto(patch[campo]))
          : campo === "diaInteiro"
            ? Boolean(patch[campo])
            : campo === "tags"
              ? (Array.isArray(patch[campo]) ? patch[campo].map((tag) => texto(tag).slice(0, 40)).filter(Boolean).slice(0, 12) : [])
              : campo === "lembretes"
                ? (Array.isArray(patch[campo]) ? [...new Set(patch[campo].map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 10080).slice(0, 5) : [])
            : patch[campo] || null;
    }
    if (permitido.starts_at && permitido.ends_at) validarIntervalo(permitido.starts_at, permitido.ends_at);
    permitido.updated_by = atual.userId;
    const { data, error } = await supabase.from("calendar_events").update(permitido).eq("id", id).eq("organization_id", atual.organizationId).select("*").single();
    if (error) throw erroAgenda(error);
    return normalizarEvento({ ...data, source_type: "event", owner_name: "" });
  };

  return {
    "agenda.permissao": async () => {
      const atual = await membro();
      return { organizationId: atual.organizationId, userId: atual.userId, papel: atual.role };
    },

    "agenda.listar": async ({ de, ate }) => {
      const atual = await membro();
      const faixa = intervalo(de, ate);
      const { data, error } = await supabase.rpc("calendar_events_list", {
        target_organization: atual.organizationId,
        range_start: faixa.inicio,
        range_end: faixa.fim,
      });
      if (error) throw erroAgenda(error);
      return (data || []).map(normalizarEvento);
    },

    "agenda.contexto": async () => {
      const atual = await membro();
      const { data, error } = await supabase.rpc("calendar_context", {
        target_organization: atual.organizationId,
      });
      if (error) throw erroAgenda(error, "agenda-contexto-falhou");
      return {
        ...(data || {}),
        organizationId: atual.organizationId,
        userId: atual.userId,
        papel: atual.role,
      };
    },

    "agenda.criar": criar,
    "agenda.atualizar": atualizar,

    "agenda.remover": async ({ id }) => {
      const atual = await membro();
      const { error } = await supabase
        .from("calendar_events")
        .update({ deleted_at: new Date().toISOString(), status: "cancelled", updated_by: atual.userId })
        .eq("id", id)
        .eq("organization_id", atual.organizationId);
      if (error) throw erroAgenda(error);
      return { id, removido: true };
    },

    "agenda.calendario": async () => {
      const atual = await membro();
      const { data, error } = await supabase
        .from("organization_calendars")
        .select("organization_id,provider,calendar_id,display_name,enabled")
        .eq("organization_id", atual.organizationId)
        .maybeSingle();
      if (error) throw erroAgenda(error, "agenda-calendario-falhou");
      return data || { organization_id: atual.organizationId, provider: "google", calendar_id: null, display_name: "Agenda compartilhada", enabled: false };
    },

    "agenda.preferenciasAtualizar": async ({
      visualizacao = "week",
      inicioDia = "08:00",
      fimDia = "18:00",
      lembretes = [30],
      notificacaoInterna = true,
      whatsapp = false,
    }) => {
      const atual = await membro();
      const { error } = await supabase.rpc("calendar_preferences_update", {
        target_organization: atual.organizationId,
        target_default_view: visualizacao,
        target_day_start: inicioDia,
        target_day_end: fimDia,
        target_default_reminders: lembretes,
        target_in_app_enabled: Boolean(notificacaoInterna),
        target_whatsapp_enabled: Boolean(whatsapp),
      });
      if (error) throw erroAgenda(error, "agenda-preferencias-falhou");
      return { salvo: true };
    },

    "agenda.categoriaSalvar": async ({ id = null, nome, cor }) => {
      const atual = await membro();
      if (!["owner", "admin"].includes(atual.role)) {
        throw erroAgenda({ message: "Somente donos e administradores configuram categorias." }, "agenda-categoria-sem-permissao");
      }
      const segura = validarCategoria(nome, cor);
      const payload = { name: segura.nome, color: segura.cor };
      if (!id) {
        const { data: ultima, error: erroPosicao } = await supabase
          .from("calendar_categories")
          .select("position")
          .eq("organization_id", atual.organizationId)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (erroPosicao) throw erroAgenda(erroPosicao, "agenda-categoria-posicao-falhou");
        payload.position = Number(ultima?.position ?? -1) + 1;
      }
      const consulta = id
        ? supabase.from("calendar_categories").update(payload).eq("id", id).eq("organization_id", atual.organizationId)
        : supabase.from("calendar_categories").insert({
          ...payload,
          organization_id: atual.organizationId,
          created_by: atual.userId,
        });
      const { data, error } = await consulta.select("id,name,color,position,active").single();
      if (error) throw erroAgenda(error, "agenda-categoria-salvar-falhou");
      return data;
    },

    "agenda.notificacoes": async ({ limite = 50 } = {}) => {
      const atual = await membro();
      const { data, error } = await supabase.rpc("calendar_notifications_list", {
        target_organization: atual.organizationId,
        max_items: Math.max(1, Math.min(Number(limite) || 50, 100)),
      });
      if (error) throw erroAgenda(error, "agenda-notificacoes-falhou");
      return (data || []).map((item) => ({
        id: item.id,
        sourceType: item.source_type,
        sourceId: item.source_id,
        titulo: item.title,
        inicio: item.starts_at,
        lembrarEm: item.remind_at,
        canal: item.channel,
        status: item.status,
        entregueEm: item.delivered_at,
        lidaEm: item.read_at,
        erro: item.error_code || null,
      }));
    },

    "agenda.notificacaoLida": async ({ id }) => {
      const atual = await membro();
      const { error } = await supabase.rpc("calendar_notification_mark_read", {
        target_organization: atual.organizationId,
        notification_id: id,
      });
      if (error) throw erroAgenda(error, "agenda-notificacao-leitura-falhou");
      return { id, lida: true };
    },

    "agenda.telefoneSolicitar": async ({ telefone }) => {
      const atual = await membro();
      const { data, error } = await supabase.rpc("calendar_phone_verification_begin", {
        target_organization: atual.organizationId,
        target_phone: telefone,
      });
      if (error) throw erroAgenda(error, "agenda-telefone-solicitacao-falhou");
      return { verificacaoId: data };
    },

    "agenda.telefoneConfirmar": async ({ verificacaoId, codigo }) => {
      const { data, error } = await supabase.rpc("calendar_phone_verification_confirm", {
        verification_id: verificacaoId,
        verification_code: texto(codigo),
      });
      if (error) throw erroAgenda(error, "agenda-telefone-confirmacao-falhou");
      if (data !== true) {
        throw erroAgenda({ message: "Código inválido ou expirado." }, "agenda-telefone-codigo-invalido");
      }
      return { verificado: true };
    },

    "agenda.reagendarTarefa": async ({ id, inicio }) => {
      const atual = await membro();
      const dueAt = instante(inicio, "o prazo");
      const { data, error } = await supabase
        .from("tasks")
        .update({ due_at: dueAt, owner_id: atual.userId, updated_by: atual.userId })
        .eq("id", id)
        .eq("organization_id", atual.organizationId)
        .select("id,due_at")
        .single();
      if (error) throw erroAgenda(error, "agenda-tarefa-falhou");
      return { id: data.id, inicio: data.due_at };
    },
  };
}
