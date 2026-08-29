/**
 * Dublês da bancada — `chrome.runtime` e o `chat-inject`.
 *
 * Compartilhado pelas duas bancadas (painel e gestão) para que elas não
 * divirjam: se cada uma tivesse o próprio dublê, um dia uma passaria a testar
 * algo que a outra não testa, sem ninguém perceber.
 *
 * O que é falso: o transporte e o WhatsApp. O provider, o IndexedDB e as
 * operações são os de verdade.
 */

import { serializarErro } from "../data/erros";
import { operacoes } from "../data/localProvider";

const memoriaChrome = {};
// A bancada nasce com duas conexões: uma conectada e uma divergente. São os
// dois estados que a tela precisa distinguir e que ninguém consegue reproduzir
// à mão sem parear dois números de verdade.
let vinculadoDev = false;
let conexoesDev = [
  {
    connectionId: "dev-conexao-comercial",
    organizationId: "dev-org",
    name: "Comercial",
    host: "wsl://bancada",
    expectedPhoneMasked: "•••• 8362",
    runtime: "online",
    connection: {
      status: "connected",
      phoneMasked: "•••• 8362",
      sendBlocked: false,
      updatedAt: new Date().toISOString(),
    },
  },
  {
    connectionId: "dev-conexao-suporte",
    organizationId: "dev-org",
    name: "Suporte",
    host: "wsl://bancada",
    expectedPhoneMasked: "•••• 3855",
    runtime: "online",
    connection: {
      status: "identity_mismatch",
      phoneMasked: "•••• 8362",
      expectedPhoneMasked: "•••• 3855",
      sendBlocked: true,
      updatedAt: new Date().toISOString(),
    },
  },
];
const qrDev = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 21 21' shape-rendering='crispEdges'%3E%3Crect width='21' height='21' fill='white'/%3E%3Cpath fill='%23121730' d='M1 1h7v7H1zm2 2v3h3V3zM13 1h7v7h-7zm2 2v3h3V3zM1 13h7v7H1zm2 2v3h3v-3zM10 2h2v2h-2zm0 4h2v3h-2zm4 4h2v2h-2zm4 0h2v4h-2zm-8 1h3v2h-3zm5 3h2v2h-2zm3 2h2v4h-2zm-8-1h3v2h-3zm1 3h5v2h-5z'/%3E%3C/svg%3E";

/**
 * O atendimento de cada conexão na bancada, em memória.
 *
 * Começa desligado de propósito: o árbitro real falha fechado, e uma bancada
 * que já nasce ligada esconderia justamente o estado em que a conexão está no
 * dia da publicação.
 */
const atendimentosDev = {};
function atendimentoDev(connectionId) {
  atendimentosDev[connectionId] ||= {
    iaAtiva: false,
    donoPadrao: "bot",
    finalizadas: 3,
    sessoes: [
      {
        sessionId: `dev-${connectionId}-1`,
        contact: "556592178164",
        owner: "ia",
        openedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
        messages: 6,
      },
      {
        sessionId: `dev-${connectionId}-2`,
        contact: "556599887766",
        owner: "humano",
        openedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        messages: 2,
      },
    ],
  };
  return atendimentosDev[connectionId];
}

function resumoDev(connectionId) {
  const atual = atendimentoDev(connectionId);
  const abertas = { bot: 0, ia: 0, humano: 0 };
  atual.sessoes.forEach((s) => { abertas[s.owner] = (abertas[s.owner] || 0) + 1; });
  return {
    iaAtiva: atual.iaAtiva,
    donoPadrao: atual.donoPadrao,
    abertas,
    finalizadas: atual.finalizadas,
    conversations: atual.sessoes,
  };
}

let membrosDev = [
  {
    user_id: "dev-user",
    role: "owner",
    status: "active",
    responsibility: "Direção comercial, propostas estratégicas e decisões finais.",
    joined_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    profile: { id: "dev-user", full_name: "Usuário de desenvolvimento", display_name: "", color: null, avatar_path: null },
  },
  {
    user_id: "dev-admin",
    role: "admin",
    status: "active",
    responsibility: "Coordena a operação e acompanha os indicadores da equipe.",
    joined_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    profile: { id: "dev-admin", full_name: "Ana Administradora", display_name: "Ana", color: "#0369a1", avatar_path: null },
  },
  {
    user_id: "dev-atendente",
    role: "member",
    status: "active",
    responsibility: "Atende novos leads e faz o primeiro diagnóstico.",
    joined_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    profile: { id: "dev-atendente", full_name: "Bruno Atendente", display_name: "", color: null, avatar_path: null },
  },
];
let convitesDev = [];
let organizacaoDev = { id: "dev-org", name: "EmyLeads — bancada", slug: "emyleads-bancada" };

const customerProfileId = "dev-assistente-clientes";
let intelligenceDev = {
  profiles: [
    { id: "dev-assistente-interno", audience: "internal", display_name: "Assistente interno", tone: "Claro e organizado", brand_config: { brandName: "Núcleo Major", greeting: "Olá! O que vamos fazer agora?" }, process_config: { instructions: "Ajude cada profissional conforme suas permissões." }, active: true },
    { id: customerProfileId, audience: "customer", display_name: "Assistente Major", tone: "Natural e profissional", brand_config: { brandName: "Assistente Major", greeting: "Olá! Como posso ajudar você hoje?" }, process_config: { instructions: "Entenda a necessidade antes de orientar.", rollout: { mode: "pilot" } }, active: true },
  ],
  skills: ["Recepção", "Pré-qualificação", "Vendas", "Suporte", "Agenda"].map((name, index) => ({ id: `dev-skill-${index}`, name, description: `Habilidade oficial de ${name.toLocaleLowerCase("pt-BR")}.`, owner_type: "platform", audience: index === 4 ? "both" : "customer", current_version: 1, status: "published", spec: {} })),
  contacts: [
    { id: "dev-contato-piloto", name: "Mariana Costa", company: "Empresa Piloto", phone: "556599887766", whatsapp_id: "" },
    { id: "dev-contato-segundo", name: "Rafael Lima", company: "Cliente real", phone: "556598765432", whatsapp_id: "" },
  ],
  pilotContacts: [{ organization_id: "dev-org", profile_id: customerProfileId, contact_id: "dev-contato-piloto", active: true }],
  handoffs: [
    { id: "dev-handoff-1", status: "requested", reason_code: "requested_human", summary: "Cliente quer conversar sobre condições comerciais.", requested_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(), contact: { name: "Mariana Costa", company: "Empresa Piloto", phone: "556599887766" } },
    { id: "dev-handoff-2", status: "accepted", reason_code: "low_confidence", summary: "Necessidade precisa de validação da equipe.", requested_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(), contact: { name: "Paulo Mendes", phone: "556597771234" } },
    { id: "dev-handoff-3", status: "completed", reason_code: "skill_limit", summary: "Atendimento concluído pela equipe.", requested_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), contact: { name: "Carla Souza", phone: "556596661111" } },
  ],
};
const intelligenceBindings = intelligenceDev.skills.map((skill, index) => ({ organization_id: "dev-org", profile_id: customerProfileId, skill_id: skill.id, enabled: true, priority: index * 10 + 10 }));

const agendaDev = [
  {
    id: "dev-evento-equipe",
    sourceType: "event",
    organizationId: "dev-org",
    ownerId: "dev-user",
    ownerName: "Usuário de desenvolvimento",
    titulo: "Reunião semanal da equipe",
    descricao: "",
    inicio: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    fim: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    diaInteiro: false,
    tipo: "event",
    visibilidade: "organization",
    status: "scheduled",
    categoryId: "dev-categoria-reuniao",
    categoryName: "Reunião",
    categoryColor: "#FB923C",
    local: "Sala comercial",
    tags: ["equipe"],
    lembretes: [30],
  },
  {
    id: "dev-evento-pessoal",
    sourceType: "event",
    organizationId: "dev-org",
    ownerId: "dev-atendente",
    ownerName: "Bruno Atendente",
    titulo: "Indisponível",
    descricao: "",
    inicio: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    fim: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    diaInteiro: false,
    tipo: "block",
    visibilidade: "personal",
    status: "scheduled",
    categoryId: null,
    categoryName: null,
    categoryColor: "#CBD5E1",
    local: "",
    tags: [],
    lembretes: [],
  },
  {
    // Evento fora do expediente de propósito: a grade recortava em `dayEnd` e
    // sumia com quem estava do lado de fora, sem aviso. Sem um caso noturno na
    // bancada, esse buraco não aparecia em teste nenhum.
    id: "dev-evento-noturno",
    sourceType: "event",
    organizationId: "dev-org",
    ownerId: "dev-user",
    ownerName: "Usuário de desenvolvimento",
    titulo: "Jantar com cliente",
    descricao: "",
    inicio: (() => { const d = new Date(); d.setHours(19, 30, 0, 0); return d.toISOString(); })(),
    fim: (() => { const d = new Date(); d.setHours(21, 0, 0, 0); return d.toISOString(); })(),
    diaInteiro: false,
    tipo: "appointment",
    visibilidade: "personal",
    status: "scheduled",
    categoryId: "dev-categoria-atendimento",
    categoryName: "Atendimento",
    categoryColor: "#22C55E",
    local: "Restaurante",
    tags: [],
    lembretes: [30],
  },
  {
    id: "dev-tarefa-agenda",
    sourceType: "task",
    taskId: "dev-tarefa-agenda",
    organizationId: "dev-org",
    ownerId: "dev-user",
    ownerName: "Usuário de desenvolvimento",
    titulo: "Retornar para Mariana Costa",
    descricao: "",
    inicio: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    fim: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
    diaInteiro: false,
    tipo: "task",
    visibilidade: "organization",
    status: "scheduled",
    categoryId: null,
    categoryName: "Tarefa",
    categoryColor: "#F59E0B",
    local: "",
    tags: [],
    lembretes: [30],
  },
];

let notificacoesAgendaDev = [];
let conhecimentoDev = [];
let preferenciasAgendaDev = {
  timezone: "America/Sao_Paulo",
  dayStart: "05:00:00",
  dayEnd: "23:59:00",
  defaultView: "week",
  defaultReminderMinutes: [30],
  inAppEnabled: true,
  whatsappEnabled: false,
  phoneLast4: null,
  phoneVerified: false,
};

const categoriasAgendaDev = [
  { id: "dev-categoria-atividade", name: "Atividade", color: "#34D399", position: 0, active: true },
  { id: "dev-categoria-reuniao", name: "Reunião", color: "#FB923C", position: 1, active: true },
  { id: "dev-categoria-prioridade", name: "Prioridade", color: "#A78BFA", position: 2, active: true },
  { id: "dev-categoria-atendimento", name: "Atendimento", color: "#60A5FA", position: 3, active: true },
  { id: "dev-categoria-pessoal", name: "Pessoal", color: "#FDA4AF", position: 4, active: true },
];

const operacoesBancada = {
  ...operacoes,
  "auth.estado": async () => {
    const perfil = membrosDev.find((m) => m.user_id === "dev-user")?.profile || null;
    return {
      usuario: {
        id: "dev-user",
        email: "dev@emyleads.local",
        nome: perfil?.full_name || "Usuário de desenvolvimento",
        perfil,
      },
      organizacoes: [{ ...organizacaoDev, papel: "owner" }],
      organizacaoAtual: { ...organizacaoDev, papel: "owner" },
    };
  },
  "auth.sair": async () => ({ ok: true }),

  // O perfil da bancada mora dentro de `membrosDev` e não numa cópia à parte:
  // com duas cópias, salvar aqui mudaria o rodapé e deixaria a Equipe exibindo
  // o nome velho — o exato defeito que a tela nova existe para acabar.
  "perfil.ler": async () => membrosDev.find((m) => m.user_id === "dev-user")?.profile || null,
  "perfil.salvar": async ({ nome, nomeCurto, cor } = {}) => {
    membrosDev = membrosDev.map((m) => {
      if (m.user_id !== "dev-user") return m;
      const perfil = { ...m.profile };
      if (nome !== undefined) perfil.full_name = String(nome || "").trim();
      if (nomeCurto !== undefined) perfil.display_name = String(nomeCurto || "").trim();
      if (cor !== undefined) perfil.color = cor ? String(cor).toLowerCase() : null;
      return { ...m, profile: perfil };
    });
    return membrosDev.find((m) => m.user_id === "dev-user")?.profile || null;
  },

  "organizacoes.selecionar": async () => operacoesBancada["auth.estado"](),
  "organizacoes.atualizar": async ({ nome }) => {
    const limpo = String(nome || "").trim();
    if (limpo.length < 2 || limpo.length > 120) {
      throw new Error("O nome da empresa precisa ter entre 2 e 120 caracteres.");
    }
    organizacaoDev = { ...organizacaoDev, name: limpo };
    return organizacaoDev;
  },
  "organizacoes.listar": async () => (await operacoesBancada["auth.estado"]()).organizacoes,
  "organizacoes.membros": async () => membrosDev,
  "organizacoes.convites": async () => convitesDev,
  "organizacoes.aceitarConvite": async ({ token }) => {
    // Código inválido e código vencido dão a mesma exceção no banco, e está
    // certo: distinguir os dois contaria a quem tenta adivinhar se aquele
    // código já existiu. A bancada imita isso para a mensagem ser exercitada.
    if (!/^[0-9a-f]{64}$/.test(String(token || "").trim()))
      throw new Error("invite invalid or expired");
    return operacoesBancada["auth.estado"]();
  },
  "organizacoes.convidar": async ({ email, papel = "member" }) => {
    // O banco recusa convite como dono ("owner invitations are not allowed").
    // A bancada recusa junto: uma bancada mais permissiva que a produção deixa
    // passar exatamente o erro que ela deveria pegar.
    if (papel === "owner") throw new Error("owner invitations are not allowed");
    if (!String(email || "").trim().includes("@")) throw new Error("invalid invite email");
    const convite = {
      invite_id: `convite-${Date.now()}`,
      invited_email: String(email).trim().toLowerCase(),
      invited_role: papel,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      delivery_status: "sent",
    };
    convitesDev = [convite, ...convitesDev];
    return { inviteId: convite.invite_id, email: convite.invited_email, role: convite.invited_role, expiresAt: convite.expires_at, delivery: "sent" };
  },
  "organizacoes.reenviarConvite": async ({ conviteId }) => {
    const convite = convitesDev.find((item) => item.invite_id === conviteId);
    if (!convite) throw new Error("invite not found");
    return { inviteId: convite.invite_id, email: convite.invited_email, role: convite.invited_role, expiresAt: convite.expires_at, delivery: "sent" };
  },
  "organizacoes.cancelarConvite": async ({ conviteId }) => {
    convitesDev = convitesDev.map((item) => item.invite_id === conviteId ? { ...item, revoked_at: new Date().toISOString() } : item);
    return { cancelled: true, inviteId: conviteId };
  },
  "organizacoes.alterarPapel": async ({ usuarioId, papel }) => {
    const alvo = membrosDev.find((m) => m.user_id === usuarioId);
    if (alvo?.role === "owner") throw new Error("owner permission required");
    membrosDev = membrosDev.map((m) => (m.user_id === usuarioId ? { ...m, role: papel } : m));
    return membrosDev;
  },
  "organizacoes.removerMembro": async ({ usuarioId }) => {
    // `role <> 'owner'` no delete: remover um dono não dá erro, só não apaga.
    membrosDev = membrosDev.filter((m) => m.user_id !== usuarioId || m.role === "owner");
    return membrosDev;
  },
  "organizacoes.atualizarResponsabilidade": async ({ usuarioId, responsabilidade }) => {
    membrosDev = membrosDev.map((m) => m.user_id === usuarioId ? { ...m, responsibility: String(responsabilidade || "").trim() } : m);
    return membrosDev;
  },
  "organizacoes.robos": async () => [{
    connection_id: "dev-conexao-comercial",
    organization_id: "dev-org",
    status: "active",
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    last_used_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    revoked_at: null,
  }],
  "organizacoes.revogarRobo": async ({ conexaoId }) => ({ conexaoId, revogado: true }),
  "inteligencia.carregar": async () => ({
    templates: [], profiles: intelligenceDev.profiles, skills: intelligenceDev.skills,
    skillVersions: [], bindings: intelligenceBindings, collections: [], documentCollections: [],
    campaigns: [], sources: [], campaignSkills: [], campaignCollections: [], simulations: [], audit: [],
    pilotContacts: intelligenceDev.pilotContacts, contacts: intelligenceDev.contacts,
  }),
  "inteligencia.salvarPerfil": async ({ id, nome, tom, marca, processo, ativo }) => {
    intelligenceDev.profiles = intelligenceDev.profiles.map((profile) => profile.id === id ? { ...profile, display_name: nome, tone: tom, brand_config: marca, process_config: processo, active: ativo } : profile);
    return intelligenceDev.profiles.find((profile) => profile.id === id);
  },
  "inteligencia.configurarRollout": async ({ profileId, mode, contactIds }) => {
    intelligenceDev.profiles = intelligenceDev.profiles.map((profile) => profile.id === profileId ? { ...profile, process_config: { ...profile.process_config, rollout: { mode } } } : profile);
    intelligenceDev.pilotContacts = (contactIds || []).map((contactId) => ({ organization_id: "dev-org", profile_id: profileId, contact_id: contactId, active: true }));
    return { status: "updated", mode, pilotContacts: intelligenceDev.pilotContacts.length };
  },
  "inteligencia.listarAtendimentos": async () => intelligenceDev.handoffs,
  "inteligencia.transicionarAtendimento": async ({ requestId, action }) => {
    const status = action === "accept" ? "accepted" : action === "complete" ? "completed" : "returned";
    intelligenceDev.handoffs = intelligenceDev.handoffs.map((item) => item.id === requestId ? { ...item, status } : item);
    return { status, requestId };
  },
  "inteligencia.simular": async () => ({ assistente: { nome: "Assistente Major" }, skillAtivo: { nome: "Recepção" }, campanha: { nome: "Piloto Atendimento Major" }, colecoesPermitidas: [], skillsPermitidos: [] }),
  "conhecimento.listar": async () => conhecimentoDev.filter((item) => item.status !== "archived"),
  "conhecimento.salvar": async ({ id = null, escopo, caminho, titulo, conteudo = "", audiencia = "internal", colecoesIds = [], publicado = false }) => {
    const agora = new Date().toISOString();
    const anterior = conhecimentoDev.find((item) => item.id === id);
    const salvo = {
      id: id || `dev-conhecimento-${Date.now()}`,
      organizationId: "dev-org",
      escopo,
      usuarioId: escopo === "personal" ? "dev-user" : null,
      caminho,
      titulo,
      conteudo,
      status: "active",
      audiencia,
      publicadoEm: publicado ? (anterior?.publicadoEm || agora) : null,
      versao: Number(anterior?.versao || 0) + 1,
      criadoEm: anterior?.criadoEm || agora,
      atualizadoEm: agora,
      atualizadoPor: "dev-user",
      colecoesIds,
    };
    conhecimentoDev = anterior
      ? conhecimentoDev.map((item) => item.id === id ? salvo : item)
      : [salvo, ...conhecimentoDev];
    return salvo;
  },
  "conhecimento.testar": async ({ conteudo = "", pergunta = "" }) => {
    const palavra = String(pergunta).toLocaleLowerCase("pt-BR").split(/\s+/).find((item) => item.length > 3);
    const casou = Boolean(palavra && String(conteudo).toLocaleLowerCase("pt-BR").includes(palavra));
    return { consulta: pergunta, casou, trecho: casou ? String(conteudo).slice(0, 240) : "", relevancia: casou ? 1 : 0 };
  },
  "conhecimento.versoes": async ({ id }) => conhecimentoDev.filter((item) => item.id === id).map((item) => ({
    id: `${item.id}-v${item.versao}`, document_id: item.id, version: item.versao,
    path: item.caminho, title: item.titulo, content_markdown: item.conteudo,
    status: item.status, audience: item.audiencia, published_at: item.publicadoEm,
    changed_by: item.atualizadoPor, created_at: item.atualizadoEm,
  })),
  "conhecimento.arquivar": async ({ id }) => {
    conhecimentoDev = conhecimentoDev.map((item) => item.id === id ? { ...item, status: "archived" } : item);
    return { id, arquivado: true };
  },
  "agenda.permissao": async () => ({ organizationId: "dev-org", userId: "dev-user", papel: "owner" }),
  "agenda.calendario": async () => ({ organization_id: "dev-org", provider: "google", calendar_id: null, display_name: "Agenda compartilhada", enabled: false }),
  "agenda.contexto": async () => ({
    organizationId: "dev-org",
    userId: "dev-user",
    papel: "owner",
    calendar: { organizationId: "dev-org", displayName: "Agenda compartilhada", timezone: "America/Sao_Paulo", dayStart: "05:00:00", dayEnd: "23:59:00", googleEnabled: false },
    preference: preferenciasAgendaDev,
    members: membrosDev.filter((m) => m.status === "active").map((m) => ({ id: m.user_id, name: m.profile.full_name, role: m.role, responsibility: m.responsibility, phoneVerified: m.user_id === "dev-user" ? preferenciasAgendaDev.phoneVerified : null })),
    categories: categoriasAgendaDev.filter((categoria) => categoria.active),
  }),
  "agenda.listar": async ({ de, ate }) => {
    const inicio = new Date(de).getTime();
    const fim = new Date(ate).getTime();
    return agendaDev.filter((evento) => new Date(evento.inicio).getTime() < fim && new Date(evento.fim).getTime() > inicio);
  },
  "agenda.criar": async (evento) => {
    const salvo = {
      id: `dev-agenda-${Date.now()}`,
      sourceType: "event",
      organizationId: "dev-org",
      ownerId: "dev-user",
      ownerName: "Usuário de desenvolvimento",
      titulo: evento.titulo,
      descricao: evento.descricao || "",
      inicio: evento.inicio,
      fim: evento.fim,
      diaInteiro: false,
      tipo: evento.tipo || "appointment",
      visibilidade: evento.visibilidade || "personal",
      status: evento.status || "scheduled",
      categoryId: evento.categoryId || "dev-categoria-atividade",
      categoryName: evento.categoryId === "dev-categoria-reuniao" ? "Reunião" : "Atividade",
      categoryColor: evento.categoryId === "dev-categoria-reuniao" ? "#FB923C" : "#34D399",
      contactId: evento.contactId || null,
      local: evento.local || "",
      tags: evento.tags || [],
      lembretes: evento.lembretes || [],
    };
    agendaDev.push(salvo);
    return salvo;
  },
  "agenda.atualizar": async ({ id, patch: alteracoes }) => {
    const indice = agendaDev.findIndex((evento) => evento.id === id);
    if (indice < 0) throw new Error("Evento não encontrado.");
    agendaDev[indice] = { ...agendaDev[indice], ...alteracoes };
    return agendaDev[indice];
  },
  "agenda.remover": async ({ id }) => {
    const indice = agendaDev.findIndex((evento) => evento.id === id);
    if (indice >= 0) agendaDev.splice(indice, 1);
    return { id, removido: true };
  },
  "agenda.preferenciasAtualizar": async (form) => {
    preferenciasAgendaDev = {
      ...preferenciasAgendaDev,
      defaultView: form.visualizacao,
      dayStart: `${form.inicioDia}:00`,
      dayEnd: `${form.fimDia}:00`,
      defaultReminderMinutes: form.lembretes,
      inAppEnabled: form.notificacaoInterna,
      whatsappEnabled: form.whatsapp && preferenciasAgendaDev.phoneVerified,
    };
    return { salvo: true };
  },
  "agenda.categoriaSalvar": async ({ id, nome, cor }) => {
    const existente = categoriasAgendaDev.find((categoria) => categoria.id === id);
    if (existente) Object.assign(existente, { name: nome, color: cor });
    else categoriasAgendaDev.push({ id: `cat-${Date.now()}`, name: nome, color: cor, position: categoriasAgendaDev.length, active: true });
    return existente || categoriasAgendaDev.at(-1);
  },
  "agenda.notificacoes": async () => notificacoesAgendaDev,
  "agenda.notificacaoLida": async ({ id }) => {
    notificacoesAgendaDev = notificacoesAgendaDev.map((item) => item.id === id ? { ...item, lidaEm: new Date().toISOString() } : item);
    return { id, lida: true };
  },
  "agenda.telefoneSolicitar": async () => ({ verificacaoId: "dev-verificacao" }),
  "agenda.telefoneConfirmar": async ({ codigo }) => {
    if (codigo !== "123456") throw new Error("Código inválido. Na bancada, use 123456.");
    preferenciasAgendaDev = { ...preferenciasAgendaDev, phoneVerified: true, phoneLast4: "9999", whatsappEnabled: true };
    return { verificado: true };
  },
  "agenda.reagendarTarefa": async ({ id, inicio }) => {
    const evento = agendaDev.find((item) => item.sourceType === "task" && item.id === id);
    if (evento) { evento.inicio = inicio; evento.fim = new Date(new Date(inicio).getTime() + 30 * 60 * 1000).toISOString(); }
    return { id, inicio };
  },
  "sync.status": async () => ({ organizationId: "dev-org", online: true, pendentes: 0, erros: 0, ultimoSync: Date.now() }),
  "sync.executar": async () => operacoesBancada["sync.status"](),
  "sync.migracaoStatus": async () => ({ concluida: true, temDados: false, totais: {} }),
  "gateway.conexoes": async ({ organizationId }) => ({
    organizationId,
    vinculado: vinculadoDev,
    gateway: vinculadoDev ? "online" : "nao-vinculado",
    conexoes: vinculadoDev ? conexoesDev : [],
  }),
  "gateway.vincular": async ({ organizationId }) => {
    vinculadoDev = true;
    return operacoesBancada["gateway.conexoes"]({ organizationId });
  },
  "gateway.criar": async ({ connectionId, nome }) => {
    conexoesDev = [
      ...conexoesDev,
      {
        connectionId,
        organizationId: "dev-org",
        name: nome,
        host: "wsl://bancada",
        runtime: "online",
        connection: { status: "whatsapp_disconnected", updatedAt: new Date().toISOString() },
      },
    ];
    return { success: true };
  },
  "gateway.parear": async ({ connectionId }) => {
    conexoesDev = conexoesDev.map((c) =>
      c.connectionId === connectionId
        ? { ...c, connection: { status: "awaiting_qr", qrAvailable: true, updatedAt: new Date().toISOString() } }
        : c
    );
    return { success: true };
  },
  "gateway.qr": async () => ({ status: "awaiting_qr", imageData: qrDev }),
  "gateway.reconectar": async () => ({ success: true }),
  "gateway.revogar": async ({ connectionId }) => {
    conexoesDev = conexoesDev.map((c) =>
      c.connectionId === connectionId ? { ...c, runtime: "revoked", connection: null } : c
    );
    return { success: true };
  },
  "gateway.descarregar": async () => ({ descarregado: "dev-org" }),
  "gateway.automacao": async ({ connectionId, iaAtiva, defaultOwner }) => {
    const atual = atendimentoDev(connectionId);
    atual.iaAtiva = !!iaAtiva;
    if (defaultOwner) atual.donoPadrao = defaultOwner;
    return { success: true, ...resumoDev(connectionId) };
  },
  "gateway.resumoAtendimento": async ({ connectionId }) => ({
    success: true,
    open: true,
    ...resumoDev(connectionId),
  }),
  "gateway.definirDonoConversa": async ({ connectionId, contato, dono, atendente = null, agente = null }) => {
    const atual = atendimentoDev(connectionId);
    // O árbitro apaga a identidade em qualquer dono que não seja `humano`. A
    // bancada imita: uma sessão que voltou para a IA carregando um nome diria
    // que aquela pessoa atende uma conversa que ela devolveu.
    const humano = dono === "humano";
    const ia = dono === "ia";
    atual.sessoes = atual.sessoes.map((s) =>
      s.contact === contato
        ? {
            ...s,
            owner: dono,
            attendantId: humano ? atendente?.id || null : null,
            attendantName: humano ? atendente?.nome || null : null,
            agentId: ia ? agente?.id || null : null,
            agentName: ia ? agente?.nome || null : null,
          }
        : s
    );
    return { success: true };
  },
  "gateway.encerrarAtendimento": async ({ connectionId, contato }) => {
    const atual = atendimentoDev(connectionId);
    atual.sessoes = atual.sessoes.filter((s) => s.contact !== contato);
    atual.finalizadas += 1;
    return { success: true };
  },
  // Mesmo endpoint que `definirDonoConversa`, resolvido pela aba. Na bancada
  // só existe uma conexão em jogo, então a resolução é trivial.
  "gateway.transferirConversa": async ({ contato, destino, agente = null }) => {
    const atual = atendimentoDev(conexoesDev[0]?.connectionId);
    const numero = String(contato || "").replace(/\D/g, "");
    const existente = atual.sessoes.find((s) => s.contact === numero);
    if (existente) {
      atual.sessoes = atual.sessoes.map((s) => (s === existente ? {
        ...s,
        owner: destino,
        agentId: destino === "ia" ? agente?.id || null : null,
        agentName: destino === "ia" ? agente?.nome || null : null,
      } : s));
    } else {
      atual.sessoes = [
        ...atual.sessoes,
        {
          sessionId: `dev-nova-${numero}`,
          contact: numero,
          owner: destino,
          agentId: destino === "ia" ? agente?.id || null : null,
          agentName: destino === "ia" ? agente?.nome || null : null,
          openedAt: new Date().toISOString(),
          messages: 1,
        },
      ];
    }
    return { success: true };
  },
  "gateway.statusConversaAtual": async ({ contato }) => {
    const atual = atendimentoDev(conexoesDev[0]?.connectionId);
    return {
      connectionId: conexoesDev[0]?.connectionId,
      iaAtiva: atual.iaAtiva,
      donoPadrao: atual.donoPadrao,
      sessao: atual.sessoes.find((s) => s.contact === String(contato || "").replace(/\D/g, "")) || null,
    };
  },
  // A bancada não tem WhatsApp Web: finge que o operador está logado no mesmo
  // número da conexão Comercial, que é o caso real e o mais fácil de errar na
  // interface.
  "config.ler": async ({ chave }) =>
    chave === "sessaoWeb.operador"
      ? { conectado: true, last4: "8362", atualizadoEm: Date.now() }
      : operacoes["config.ler"]({ chave }),
};

export function instalarChromeFalso() {
  globalThis.__EMYLEADS_DEV_CALL__ = async (op, args = {}) => {
    const executar = operacoesBancada[op];
    if (!executar) throw new Error(`Operação desconhecida: ${op}`);
    return executar(args);
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (chave) => {
          if (typeof chave === "string") return { [chave]: memoriaChrome[chave] };
          return { ...memoriaChrome };
        },
        set: async (valores) => Object.assign(memoriaChrome, valores),
        remove: async (chave) => delete memoriaChrome[chave],
      },
    },
    runtime: {
      sendMessage(mensagem, responder) {
        const executar = operacoesBancada[mensagem.op];
        if (!executar)
          return responder({
            ok: false,
            erro: { mensagem: `Operação desconhecida: ${mensagem.op}` },
          });
        Promise.resolve()
          .then(() => executar(mensagem.args || {}))
          .then((dados) => responder({ ok: true, dados: dados ?? null }))
          // Mesmo serializador do service worker, e não um improviso: a
          // primeira versão daqui só repassava a mensagem, e a bancada passou
          // a testar um transporte que perdia o `codigo` — bug que não existia
          // no produto e que me fez procurar no lugar errado.
          .catch((err) => responder({ ok: false, erro: serializarErro(err) }));
      },
      lastError: null,
      getURL: (p) => p,
    },
    tabs: { query: async () => [], create: async () => {}, update: async () => {} },
    windows: { update: async () => {} },
    action: { onClicked: { addListener: () => {} } },
  };
}

const ETIQUETAS_FALSAS = [
  { id: "1", nome: "Novo cliente", cor: "#6366f1", quantidade: 4 },
  { id: "2", nome: "Aguardando pagamento", cor: "#b45309", quantidade: 2 },
  { id: "3", nome: "Orçamento enviado", cor: "#0369a1", quantidade: 3 },
];

const CONTATOS_FALSOS = [
  { nome: "Mariana Costa", telefone: "5565993518362", empresa: "Agro Forte" },
  { nome: "Lucas Almeida", telefone: "5565991204488", empresa: "" },
  { nome: "Fernanda Ribeiro", telefone: "5566996337712", empresa: "Vet Campo" },
  { nome: "Ricardo Nunes", telefone: "5565984450198", empresa: "" },
  { nome: "Patrícia Gomes", telefone: "5565992017744", empresa: "Studio Movimento" },
  { nome: "", telefone: "5511987654321", empresa: "" },
  { nome: "Carlos Eduardo", telefone: "5562991887766", empresa: "Alvorada" },
  { nome: "Juliana Prado", telefone: "5565988776655", empresa: "" },
].map((c, i) => ({
  ...c,
  waId: `${100000000000000 + i}@lid`,
  ehMeuContato: true,
  ultimaEm: Date.now() - i * 3600000,
}));

/** Responde ao mesmo protocolo do chat-inject.js. */
export function instalarChatInjectFalso() {
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.source !== "emyleads") return;
    const responder = (dados) =>
      window.postMessage({ source: "emyleads-page", id: d.id, ok: true, dados }, "*");

    if (d.cmd === "listarEtiquetas") return responder(ETIQUETAS_FALSAS);
    if (d.cmd === "listarContatos") {
      const n = d.escopo === "etiqueta" ? 3 : d.escopo === "conversas" ? 6 : 8;
      return responder(CONTATOS_FALSOS.slice(0, n));
    }
  });
}

/** Semeia uma vez, para as telas terem conteúdo. */
export async function semearSePreciso(nomeDoContatoDemo) {
  const jaTem = await operacoes["contatos.listar"]({});
  if (jaTem.length) return;

  await operacoes["dados.semear"]({});
  if (nomeDoContatoDemo) {
    const contatos = await operacoes["contatos.listar"]({});
    if (contatos[0]) {
      await operacoes["contatos.atualizar"]({
        id: contatos[0].id,
        patch: { nome: nomeDoContatoDemo },
      });
    }
  }
}
