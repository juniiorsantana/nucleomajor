import { normalizePhone, variantesBR } from "../lib/phone.js";

const iso = (epoch) => (epoch == null ? null : new Date(epoch).toISOString());

function mapaIds(registros, existentes, gerarUuid) {
  const porLegado = new Map(
    (existentes || []).filter((item) => item.legacy_id).map((item) => [item.legacy_id, item.id])
  );
  return new Map(
    registros.map((item) => [item.id, porLegado.get(item.id) || gerarUuid()])
  );
}

function chavesTelefone(valor) {
  return variantesBR(valor);
}

function mapaIdsContatos(registros, existentes, gerarUuid) {
  const linhasExistentes = existentes || [];
  const porLegado = new Map(
    linhasExistentes.filter((item) => item.legacy_id).map((item) => [item.legacy_id, item.id])
  );
  const porTelefone = new Map();
  const porWhatsApp = new Map();
  const idsExistentes = new Set(linhasExistentes.map((item) => item.id));

  for (const item of linhasExistentes) {
    if (item.deleted_at) continue;
    for (const chave of chavesTelefone(item.phone)) porTelefone.set(chave, item.id);
    if (item.whatsapp_id) porWhatsApp.set(item.whatsapp_id, item.id);
  }

  // Um backup antigo pode conter o mesmo contato duas vezes. Os aliases
  // mantêm todas as referências apontando para um único registro remoto.
  const alias = new Map();
  const raiz = (id) => {
    let atual = id;
    while (alias.has(atual) && alias.get(atual) !== atual) atual = alias.get(atual);
    return atual;
  };
  const unir = (a, b) => {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra === rb) return ra;
    const escolhido = idsExistentes.has(ra) ? ra : idsExistentes.has(rb) ? rb : ra;
    alias.set(escolhido === ra ? rb : ra, escolhido);
    return escolhido;
  };
  const porIdentidade = new Map();
  const ids = new Map();

  for (const item of registros) {
    const telefones = chavesTelefone(item.telefone);
    const whatsapp = item.waId ? String(item.waId) : "";
    const candidatos = [
      ...telefones.map((chave) => porIdentidade.get(`phone:${chave}`) || porTelefone.get(chave)),
      porIdentidade.get(`wa:${whatsapp}`) || (whatsapp ? porWhatsApp.get(whatsapp) : null),
      porLegado.get(item.id),
    ].filter(Boolean);

    let id = candidatos[0] || gerarUuid();
    for (const candidato of candidatos.slice(1)) id = unir(id, candidato);
    id = raiz(id);
    ids.set(item.id, id);

    for (const chave of telefones) {
      const identidade = `phone:${chave}`;
      porIdentidade.set(identidade, raiz(unir(porIdentidade.get(identidade) || id, id)));
    }
    if (whatsapp) {
      const identidade = `wa:${whatsapp}`;
      porIdentidade.set(identidade, raiz(unir(porIdentidade.get(identidade) || id, id)));
    }
  }

  return new Map([...ids.entries()].map(([idLegado, idRemoto]) => [idLegado, raiz(idRemoto)]));
}

function preenchido(primeiro, segundo) {
  return primeiro !== null && primeiro !== undefined && String(primeiro) !== "" ? primeiro : segundo;
}

function dataExtrema(primeiro, segundo, modo) {
  if (!primeiro) return segundo || null;
  if (!segundo) return primeiro;
  const a = new Date(primeiro).getTime();
  const b = new Date(segundo).getTime();
  if (!Number.isFinite(a)) return segundo;
  if (!Number.isFinite(b)) return primeiro;
  return new Date(modo === "min" ? Math.min(a, b) : Math.max(a, b)).toISOString();
}

function mesclarContatos(primeiro, segundo) {
  return {
    ...primeiro,
    name: preenchido(primeiro.name, segundo.name),
    phone: preenchido(primeiro.phone, segundo.phone) || "",
    whatsapp_id: preenchido(primeiro.whatsapp_id, segundo.whatsapp_id) || null,
    company: preenchido(primeiro.company, segundo.company) || "",
    job_title: preenchido(primeiro.job_title, segundo.job_title) || "",
    email: preenchido(primeiro.email, segundo.email) || null,
    source: preenchido(primeiro.source, segundo.source) || "",
    owner_label: preenchido(primeiro.owner_label, segundo.owner_label) || "",
    avatar_path: preenchido(primeiro.avatar_path, segundo.avatar_path) || null,
    last_interaction_at: dataExtrema(primeiro.last_interaction_at, segundo.last_interaction_at, "max"),
    created_at: dataExtrema(primeiro.created_at, segundo.created_at, "min"),
    updated_at: dataExtrema(primeiro.updated_at, segundo.updated_at, "max"),
    deleted_at: null,
  };
}

/** Converte um backup local completo no formato relacional do Supabase. */
export function planejarMigracao({
  pacote,
  organizationId,
  existentes = {},
  gerarUuid = () => crypto.randomUUID(),
}) {
  const ids = {
    stages: mapaIds(pacote.estagios, existentes.stages, gerarUuid),
    tags: mapaIds(pacote.tags, existentes.tags, gerarUuid),
    contacts: mapaIdsContatos(pacote.contatos, existentes.contacts, gerarUuid),
    deals: mapaIds(pacote.negocios, existentes.deals, gerarUuid),
    tasks: mapaIds(pacote.tarefas, existentes.tasks, gerarUuid),
    notes: mapaIds(pacote.notas, existentes.notes, gerarUuid),
    events: mapaIds(pacote.eventos || [], existentes.events, gerarUuid),
  };
  const stages = pacote.estagios.map((item) => ({
    id: ids.stages.get(item.id),
    organization_id: organizationId,
    legacy_id: item.id,
    name: item.nome,
    position: item.ordem,
    deleted_at: null,
  }));

  const tags = pacote.tags.map((item) => ({
    id: ids.tags.get(item.id),
    organization_id: organizationId,
    legacy_id: item.id,
    name: item.nome,
    color: item.cor,
    deleted_at: null,
  }));

  const contatosPorId = new Map();
  for (const item of pacote.contatos) {
    const id = ids.contacts.get(item.id);
    const existente = (existentes.contacts || []).find((registro) => registro.id === id);
    const contato = {
      id,
      organization_id: organizationId,
      legacy_id: item.id,
      name: preenchido(item.nome, existente?.name) || "",
      phone: normalizePhone(item.telefone) || preenchido(existente?.phone, "") || "",
      whatsapp_id: item.waId || existente?.whatsapp_id || null,
      company: preenchido(item.empresa, existente?.company) || "",
      job_title: preenchido(item.cargo, existente?.job_title) || "",
      email: item.email || existente?.email || null,
      source: preenchido(item.origem, existente?.source) || "",
      owner_label: preenchido(item.responsavel, existente?.owner_label) || "",
      avatar_path: item.avatarPath || existente?.avatar_path || null,
      last_interaction_at: iso(item.ultimaEm),
      created_at: iso(item.criadoEm),
      updated_at: iso(item.atualizadoEm),
      deleted_at: null,
    };
    contatosPorId.set(id, contatosPorId.has(id) ? mesclarContatos(contatosPorId.get(id), contato) : contato);
  }
  const contacts = [...contatosPorId.values()];

  const contactTagsPorChave = new Map();
  for (const contato of pacote.contatos) {
    for (const tagId of contato.tags || []) {
      const linha = {
        organization_id: organizationId,
        contact_id: ids.contacts.get(contato.id),
        tag_id: ids.tags.get(tagId),
      };
      contactTagsPorChave.set(`${linha.contact_id}:${linha.tag_id}`, linha);
    }
  }
  const contactTags = [...contactTagsPorChave.values()];

  const deals = pacote.negocios.map((item) => ({
    id: ids.deals.get(item.id),
    organization_id: organizationId,
    legacy_id: item.id,
    contact_id: ids.contacts.get(item.contactId),
    stage_id: ids.stages.get(item.stageId),
    title: item.titulo,
    value: item.valor,
    source: item.origem,
    status: item.status,
    loss_reason: item.motivoPerda,
    created_at: iso(item.criadoEm),
    updated_at: iso(item.atualizadoEm),
    deleted_at: null,
  }));

  const tasks = pacote.tarefas.map((item) => ({
    id: ids.tasks.get(item.id),
    organization_id: organizationId,
    legacy_id: item.id,
    contact_id: ids.contacts.get(item.contactId),
    deal_id: item.dealId ? ids.deals.get(item.dealId) : null,
    title: item.titulo,
    due_at: iso(item.venceEm),
    completed: item.concluida,
    completed_at: iso(item.concluidaEm),
    owner_label: item.responsavel,
    created_at: iso(item.criadoEm),
    updated_at: iso(item.atualizadoEm ?? item.criadoEm),
    deleted_at: null,
  }));

  const notes = pacote.notas.map((item) => ({
    id: ids.notes.get(item.id),
    organization_id: organizationId,
    legacy_id: item.id,
    contact_id: ids.contacts.get(item.contactId),
    body: item.texto,
    author_label: item.autor,
    created_at: iso(item.criadoEm),
    updated_at: iso(item.atualizadoEm ?? item.criadoEm),
    deleted_at: null,
  }));

  const avatarsPorContato = new Map();
  for (const item of pacote.contatos) {
    if (!((typeof item.fotoUrl === "string" && item.fotoUrl.length > 0) || item.avatarPath)) continue;
    const avatar = {
      contactId: ids.contacts.get(item.id),
      legacyId: item.id,
      source: item.fotoUrl || null,
      existingPath: item.avatarPath || null,
    };
    const atual = avatarsPorContato.get(avatar.contactId);
    avatarsPorContato.set(avatar.contactId, atual ? {
      ...atual,
      source: atual.source || avatar.source,
      existingPath: atual.existingPath || avatar.existingPath,
    } : avatar);
  }
  const avatars = [...avatarsPorContato.values()];

  const events = (pacote.eventos || []).map((item) => ({
    id: ids.events.get(item.id),
    organization_id: organizationId,
    legacy_id: item.id,
    contact_id: ids.contacts.get(item.contactId),
    event_type: item.tipo,
    entity_type: item.entidadeTipo,
    entity_id: {
      contato: ids.contacts,
      negocio: ids.deals,
      tarefa: ids.tasks,
      nota: ids.notes,
    }[item.entidadeTipo]?.get(item.entidadeId) || null,
    source: item.origem || "app",
    payload: item.carga || {},
    occurred_at: iso(item.ocorridoEm),
    created_at: iso(item.criadoEm),
  }));

  return {
    ids,
    tabelas: { stages, tags, contacts, contactTags, deals, tasks, notes, events },
    avatars,
    totais: {
      contatos: contacts.length,
      negocios: deals.length,
      tarefas: tasks.length,
      notas: notes.length,
      estagios: stages.length,
      tags: tags.length,
      fotos: avatars.length,
      eventos: events.length,
    },
  };
}
