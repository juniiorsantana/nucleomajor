/**
 * As ferramentas do MCP do portal: só leitura, sempre com o token de quem
 * pergunta. A RLS decide o que cada pessoa vê; aqui ficam só as regras de
 * contagem, que são as mesmas das telas do portal (cada uma cita a sua).
 *
 * Nada aqui fala com a rede diretamente: tudo passa por `db`, que o
 * `mcp.mjs` monta com o token do usuário. Os testes injetam um `db` falso.
 */

import { variantesBR } from "../apps/emyleads/src/lib/phone.js";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 24 * 60 * 60 * 1000;
const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/;

export class ToolError extends Error {}

/* ───────────────────────── datas em Brasília ───────────────────────── */

export function diaEmSaoPaulo(agora) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/**
 * Início e fim do dia em Brasília. O Brasil não tem horário de verão desde
 * 2019, então o deslocamento é sempre -03:00. O portal usa a hora do
 * navegador; aqui o servidor roda em UTC, e sem isto o "hoje" viraria às 21h.
 */
export function intervaloDoDia(dia) {
  const inicio = new Date(`${dia}T00:00:00-03:00`);
  return { dia, inicio, fim: new Date(inicio.getTime() + DIA_MS) };
}

function diaPedido(dia, agora) {
  if (dia === undefined || dia === null || dia === "") return intervaloDoDia(diaEmSaoPaulo(agora));
  const texto = String(dia).trim();
  if (!DIA_VALIDO.test(texto) || Number.isNaN(new Date(`${texto}T00:00:00-03:00`).getTime())) {
    throw new ToolError("Informe o dia no formato AAAA-MM-DD, por exemplo 2026-10-09.");
  }
  return intervaloDoDia(texto);
}

function hora(data) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(new Date(data));
}

function dataCurta(data) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(new Date(data));
}

function rotuloDoDia(intervalo, agora) {
  return intervalo.dia === diaEmSaoPaulo(agora) ? "hoje" : `em ${dataCurta(intervalo.inicio)}`;
}

export function tempoDesde(data, agora) {
  const minutos = Math.max(0, Math.round((agora.getTime() - new Date(data).getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return minutos % 60 ? `${horas} h ${minutos % 60} min` : `${horas} h`;
  return `${Math.floor(horas / 24)} dias`;
}

/* ───────────────────────── nomes e privacidade ───────────────────────── */

/** Telefone inteiro não sai daqui: o modelo do outro lado não precisa dele. */
export function telefoneMascarado(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  return digitos ? `…${digitos.slice(-4)}` : "sem número";
}

function nomeDoContato(nome, telefone) {
  const limpo = String(nome || "").trim();
  return limpo || `Contato ${telefoneMascarado(telefone)}`;
}

function previa(texto) {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();
  return limpo.length > 80 ? `${limpo.slice(0, 79)}…` : limpo;
}

function semAcento(texto) {
  return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/* ───────────────────────── empresa ───────────────────────── */

const PAPEIS = { owner: "dono", admin: "administrador", member: "membro" };

export async function empresasDoUsuario(db, userId) {
  const linhas = await db.select(
    `/rest/v1/organization_members?select=role,organization:organizations(id,name)&user_id=eq.${encodeURIComponent(userId)}&status=eq.active`,
  );
  return (linhas || [])
    .filter((linha) => linha.organization?.id)
    .map((linha) => ({ id: linha.organization.id, nome: linha.organization.name || "Sem nome", papel: linha.role }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * A empresa sai sempre da lista de vínculos da própria pessoa. O que o
 * modelo escreve em `empresa` só escolhe dentro dela, nunca fora.
 */
export function escolherEmpresa(empresas, pedido) {
  if (!empresas.length) throw new ToolError("Esta conta não participa de nenhuma empresa ativa no Núcleo Major.");
  const texto = semAcento(pedido);
  if (!texto) {
    if (empresas.length === 1) return empresas[0];
    throw new ToolError(`Você participa de ${empresas.length} empresas. Diga de qual: ${empresas.map((e) => e.nome).join("; ")}.`);
  }
  const porId = empresas.find((e) => e.id === String(pedido).trim());
  if (porId) return porId;
  const exata = empresas.filter((e) => semAcento(e.nome) === texto);
  if (exata.length === 1) return exata[0];
  const parecidas = empresas.filter((e) => semAcento(e.nome).includes(texto));
  if (parecidas.length === 1) return parecidas[0];
  if (parecidas.length > 1) {
    throw new ToolError(`Mais de uma empresa combina com "${pedido}": ${parecidas.map((e) => e.nome).join("; ")}. Diga qual.`);
  }
  throw new ToolError(`Nenhuma das suas empresas se chama "${pedido}". As suas são: ${empresas.map((e) => e.nome).join("; ")}.`);
}

/* ───────────────────────── as perguntas ───────────────────────── */

const org = (id) => `organization_id=eq.${encodeURIComponent(id)}`;
const iso = (data) => encodeURIComponent(data.toISOString());

/**
 * Conversas: a tabela espelhada do Bridge, uma linha por chat
 * (`conversasProvider.js`). Grupo é mais da metade das linhas, então conta
 * à parte. "Com mensagem no dia" vem das mensagens, não de
 * `last_message_at`, que anda para frente e apagaria os dias passados.
 * "Precisa de você" é o filtro da tela Conversas (`Conversas.jsx`).
 */
export async function conversas(db, empresa, intervalo) {
  const base = `/rest/v1/whatsapp_conversations?select=contact_phone&${org(empresa.id)}`;
  const [diretas, grupos, naoLidas, precisaDeVoce, telefonesDeGrupo, mensagens] = await Promise.all([
    db.count(`${base}&chat_kind=eq.direto`),
    db.count(`${base}&chat_kind=eq.grupo`),
    db.count(`${base}&chat_kind=eq.direto&unread_count=gt.0`),
    db.count(`${base}&chat_kind=eq.direto&unread_count=gt.0&owner=eq.humano`),
    db.selectAll(`${base}&chat_kind=eq.grupo`),
    db.selectAll(
      `/rest/v1/whatsapp_messages?select=contact_phone,is_from_me&${org(empresa.id)}&sent_at=gte.${iso(intervalo.inicio)}&sent_at=lt.${iso(intervalo.fim)}`,
    ),
  ]);
  const grupo = new Set(telefonesDeGrupo.map((linha) => linha.contact_phone));
  const doDia = new Set();
  let recebidas = 0;
  let enviadas = 0;
  for (const mensagem of mensagens) {
    if (grupo.has(mensagem.contact_phone)) continue;
    doDia.add(mensagem.contact_phone);
    if (mensagem.is_from_me) enviadas += 1;
    else recebidas += 1;
  }
  return { diretas, grupos, comMensagemNoDia: doDia.size, mensagensRecebidas: recebidas, mensagensEnviadas: enviadas, naoLidas, precisaDeVoce };
}

/** Lead é `contacts.lead_at` preenchido (`domain/lead.js`); contato não é lead. */
export async function leads(db, empresa, intervalo) {
  const base = `/rest/v1/contacts?select=id&${org(empresa.id)}&deleted_at=is.null&lead_at=not.is.null`;
  const seteDiasAntes = new Date(intervalo.fim.getTime() - 7 * DIA_MS);
  const [total, noDia, ultimos7Dias] = await Promise.all([
    db.count(base),
    db.count(`${base}&lead_at=gte.${iso(intervalo.inicio)}&lead_at=lt.${iso(intervalo.fim)}`),
    db.count(`${base}&lead_at=gte.${iso(seteDiasAntes)}&lead_at=lt.${iso(intervalo.fim)}`),
  ]);
  return { total, noDia, ultimos7Dias };
}

/**
 * Lead esperando = a última mensagem da conversa direta é dele. É o estado
 * que a tela de Leads chama de "Respondeu" (`conversaDoLead.js`): o lead
 * respondeu e a equipe ainda não. O casamento lead↔conversa é pelas
 * variantes do número, com e sem o nono dígito, como lá.
 */
export async function leadsEsperando(db, empresa, agora, { limite = 15, janelaDias = 7 } = {}) {
  const [conversasEsperando, contatosLead] = await Promise.all([
    db.selectAll(
      `/rest/v1/whatsapp_conversations?select=contact_phone,contact_name,last_message_preview,last_message_at,owner&${org(empresa.id)}&chat_kind=eq.direto&last_message_from_me=eq.false&last_message_at=not.is.null&order=last_message_at.desc`,
    ),
    db.selectAll(`/rest/v1/contacts?select=id,name,phone&${org(empresa.id)}&deleted_at=is.null&lead_at=not.is.null`),
  ]);
  const leadPorTelefone = new Map();
  for (const contato of contatosLead) {
    for (const forma of variantesBR(contato.phone)) leadPorTelefone.set(forma, contato);
  }
  const vistos = new Set();
  const esperando = [];
  for (const conversa of conversasEsperando) {
    const lead = variantesBR(conversa.contact_phone).map((forma) => leadPorTelefone.get(forma)).find(Boolean);
    if (!lead || vistos.has(lead.id)) continue;
    vistos.add(lead.id);
    esperando.push({
      nome: nomeDoContato(lead.name || conversa.contact_name, conversa.contact_phone),
      desde: conversa.last_message_at,
      espera: tempoDesde(conversa.last_message_at, agora),
      quemAtende: { ia: "IA", bot: "fluxo", humano: "equipe" }[conversa.owner] || "fluxo",
      ultimaMensagem: previa(conversa.last_message_preview),
    });
  }
  const corte = agora.getTime() - janelaDias * DIA_MS;
  const recentes = esperando.filter((item) => new Date(item.desde).getTime() >= corte);
  // A espera mais longa primeiro: é a que mais arrisca o lead.
  recentes.sort((a, b) => new Date(a.desde) - new Date(b.desde));
  return {
    total: esperando.length,
    recentes: recentes.length,
    antigos: esperando.length - recentes.length,
    janelaDias,
    lista: recentes.slice(0, limite),
  };
}

/**
 * Tarefas pendentes = não concluídas e não apagadas (`Tarefas.jsx`).
 * Responsáveis vêm de `task_assignees`; sem nenhum, vale `owner_id`
 * (`tarefasUtils.js`, `idsDosResponsaveis`).
 */
export async function tarefas(db, empresa, intervalo, userId, { limite = 10 } = {}) {
  const [pendentes, atribuicoes] = await Promise.all([
    db.selectAll(`/rest/v1/tasks?select=id,title,due_at,owner_id&${org(empresa.id)}&deleted_at=is.null&completed=eq.false&order=due_at.asc.nullslast`),
    db.selectAll(`/rest/v1/task_assignees?select=task_id,user_id&${org(empresa.id)}`),
  ]);
  const porTarefa = new Map();
  for (const linha of atribuicoes) {
    if (!porTarefa.has(linha.task_id)) porTarefa.set(linha.task_id, []);
    porTarefa.get(linha.task_id).push(linha.user_id);
  }
  const responsaveis = (tarefa) => porTarefa.get(tarefa.id) || (tarefa.owner_id ? [tarefa.owner_id] : []);

  const pessoas = [...new Set(pendentes.flatMap(responsaveis))];
  const nomes = new Map();
  if (pessoas.length) {
    try {
      const perfis = await db.select(`/rest/v1/profiles?select=id,full_name&id=in.(${pessoas.map(encodeURIComponent).join(",")})`);
      for (const perfil of perfis || []) if (perfil.full_name) nomes.set(perfil.id, perfil.full_name);
    } catch {
      // Sem nome, a tarefa continua útil: o título e o prazo bastam.
    }
  }

  const grupos = { atrasadas: [], doDia: [], depois: [], semData: [] };
  let minhas = 0;
  for (const tarefa of pendentes) {
    const ids = responsaveis(tarefa);
    if (ids.includes(userId)) minhas += 1;
    const item = {
      titulo: tarefa.title || "Sem título",
      prazo: tarefa.due_at || null,
      responsaveis: ids.map((id) => (id === userId ? "você" : nomes.get(id) || "alguém da equipe")),
    };
    if (!tarefa.due_at) grupos.semData.push(item);
    else if (new Date(tarefa.due_at) < intervalo.inicio) grupos.atrasadas.push(item);
    else if (new Date(tarefa.due_at) < intervalo.fim) grupos.doDia.push(item);
    else grupos.depois.push(item);
  }
  return {
    pendentes: pendentes.length,
    minhas,
    atrasadas: grupos.atrasadas.length,
    doDia: grupos.doDia.length,
    depois: grupos.depois.length,
    semData: grupos.semData.length,
    listaAtrasadas: grupos.atrasadas.slice(0, limite),
    listaDoDia: grupos.doDia.slice(0, limite),
  };
}

/**
 * Agenda do dia pela mesma RPC do portal (`agendaProvider.js`). Ela já
 * respeita a visibilidade: evento pessoal de outra pessoa chega mascarado.
 * Tarefas com prazo também vêm nela; ficam de fora, já que têm ferramenta.
 */
export async function agenda(db, empresa, intervalo) {
  const linhas = await db.rpc("calendar_events_list", {
    target_organization: empresa.id,
    range_start: intervalo.inicio.toISOString(),
    range_end: intervalo.fim.toISOString(),
  });
  const eventos = (linhas || [])
    .filter((linha) => linha.source_type === "event")
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .map((linha) => ({
      titulo: linha.title || "Sem título",
      inicio: linha.starts_at,
      fim: linha.ends_at,
      diaTodo: Boolean(linha.all_day),
      horario: linha.all_day ? "dia todo" : `${hora(linha.starts_at)}–${hora(linha.ends_at)}`,
      responsavel: linha.owner_name || null,
      local: linha.location || null,
      provisorio: linha.status === "tentative",
    }));
  return { total: eventos.length, eventos };
}

/* ───────────────────────── texto para o celular ───────────────────────── */

function textoConversas(r, quando) {
  return [
    `Conversas ${quando}: ${r.comMensagemNoDia} com mensagem (${r.mensagensRecebidas} recebidas, ${r.mensagensEnviadas} enviadas).`,
    `No total: ${r.diretas} conversas diretas e ${r.grupos} grupos. Não lidas: ${r.naoLidas}. Precisando de alguém da equipe: ${r.precisaDeVoce}.`,
  ].join("\n");
}

function textoLeads(r, quando) {
  return `Leads: ${r.total} no total, ${r.noDia} novos ${quando}, ${r.ultimos7Dias} nos últimos 7 dias.`;
}

function textoEsperando(r) {
  if (!r.total) return "Nenhum lead esperando resposta.";
  const linhas = [`Leads esperando resposta: ${r.recentes} nos últimos ${r.janelaDias} dias${r.antigos ? ` (e ${r.antigos} há mais tempo)` : ""}.`];
  for (const item of r.lista) {
    linhas.push(`- ${item.nome}: há ${item.espera} (${item.quemAtende})${item.ultimaMensagem ? ` — "${item.ultimaMensagem}"` : ""}`);
  }
  if (r.recentes > r.lista.length) linhas.push(`…e mais ${r.recentes - r.lista.length}.`);
  return linhas.join("\n");
}

function linhaDeTarefa(item, comData) {
  const prazo = item.prazo ? (comData ? `${dataCurta(item.prazo)} ${hora(item.prazo)}` : hora(item.prazo)) : "";
  return `- ${item.titulo}${prazo ? ` (${prazo})` : ""} — ${item.responsaveis.join(", ") || "sem responsável"}`;
}

function textoTarefas(r, quando) {
  if (!r.pendentes) return "Nenhuma tarefa pendente.";
  const linhas = [`Tarefas pendentes: ${r.pendentes} (${r.minhas} suas). Atrasadas: ${r.atrasadas}. Para ${quando}: ${r.doDia}. Sem data: ${r.semData}.`];
  if (r.listaAtrasadas.length) linhas.push("Atrasadas:", ...r.listaAtrasadas.map((t) => linhaDeTarefa(t, true)));
  if (r.listaDoDia.length) linhas.push(`Para ${quando}:`, ...r.listaDoDia.map((t) => linhaDeTarefa(t, false)));
  return linhas.join("\n");
}

function textoAgenda(r, quando) {
  if (!r.total) return `Nenhum compromisso na agenda ${quando}.`;
  return [
    `Compromissos ${quando}: ${r.total}.`,
    ...r.eventos.map((e) => `- ${e.horario} ${e.titulo}${e.responsavel ? ` — ${e.responsavel}` : ""}${e.provisorio ? " (provisório)" : ""}`),
  ].join("\n");
}

/* ───────────────────────── catálogo ───────────────────────── */

const EMPRESA = {
  type: "string",
  description: "Nome (ou parte do nome) da empresa. Só é preciso quando a pessoa participa de mais de uma.",
};
const DIA = {
  type: "string",
  description: "Dia no formato AAAA-MM-DD, no horário de Brasília. Sem ele, vale hoje.",
};

function ferramenta(name, title, description, properties = {}) {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

export const TOOLS = [
  ferramenta("minhas_empresas", "Minhas empresas", "Lista as empresas do Núcleo Major em que a pessoa participa, com o papel dela em cada uma."),
  ferramenta(
    "resumo_do_dia",
    "Resumo do dia",
    "Responde de uma vez: conversas do dia, leads, leads esperando resposta, tarefas pendentes e compromissos da agenda. Use para perguntas gerais como 'como está hoje?'.",
    { empresa: EMPRESA, dia: DIA },
  ),
  ferramenta("conversas", "Conversas do WhatsApp", "Quantas conversas tiveram mensagem no dia, total de conversas, não lidas e quantas precisam de alguém da equipe.", { empresa: EMPRESA, dia: DIA }),
  ferramenta("leads", "Leads", "Quantos leads existem, quantos entraram no dia e nos últimos 7 dias.", { empresa: EMPRESA, dia: DIA }),
  ferramenta("leads_esperando", "Leads esperando resposta", "Leads cuja última mensagem no WhatsApp é deles, ou seja, esperando a equipe responder, com há quanto tempo e quem atende.", { empresa: EMPRESA }),
  ferramenta("tarefas", "Tarefas", "Tarefas pendentes: atrasadas, do dia, sem data, e quantas são da própria pessoa.", { empresa: EMPRESA, dia: DIA }),
  ferramenta("agenda", "Agenda", "Compromissos da agenda no dia, com horário e responsável.", { empresa: EMPRESA, dia: DIA }),
];

const NOMES = new Set(TOOLS.map((tool) => tool.name));

/**
 * Executa uma ferramenta. Devolve `{ text, data, empresa }`; erro de uso
 * (empresa ambígua, dia inválido) sai como `ToolError`, que o protocolo
 * entrega ao modelo como resultado com `isError`, para ele perguntar.
 */
export async function runTool(name, args, { db, user, agora = new Date() }) {
  if (!NOMES.has(name)) throw new ToolError(`Ferramenta desconhecida: ${name}.`);
  const entrada = args && typeof args === "object" ? args : {};
  const empresas = await empresasDoUsuario(db, user.id);

  if (name === "minhas_empresas") {
    if (!empresas.length) return { text: "Esta conta não participa de nenhuma empresa ativa.", data: { empresas } };
    const linhas = empresas.map((e) => `- ${e.nome} (${PAPEIS[e.papel] || e.papel})`);
    return { text: `Suas empresas:\n${linhas.join("\n")}`, data: { empresas } };
  }

  const empresa = escolherEmpresa(empresas, entrada.empresa);
  const intervalo = diaPedido(entrada.dia, agora);
  const quando = rotuloDoDia(intervalo, agora);
  const cabecalho = `${empresa.nome} — ${quando === "hoje" ? `hoje, ${dataCurta(intervalo.inicio)}` : quando}`;
  const contexto = { empresa: { id: empresa.id, nome: empresa.nome }, dia: intervalo.dia };

  if (name === "conversas") {
    const r = await conversas(db, empresa, intervalo);
    return { text: `${cabecalho}\n${textoConversas(r, quando)}`, data: { ...contexto, ...r }, empresa };
  }
  if (name === "leads") {
    const r = await leads(db, empresa, intervalo);
    return { text: `${cabecalho}\n${textoLeads(r, quando)}`, data: { ...contexto, ...r }, empresa };
  }
  if (name === "leads_esperando") {
    const r = await leadsEsperando(db, empresa, agora);
    return { text: `${empresa.nome}\n${textoEsperando(r)}`, data: { ...contexto, ...r }, empresa };
  }
  if (name === "tarefas") {
    const r = await tarefas(db, empresa, intervalo, user.id);
    return { text: `${cabecalho}\n${textoTarefas(r, quando)}`, data: { ...contexto, ...r }, empresa };
  }
  if (name === "agenda") {
    const r = await agenda(db, empresa, intervalo);
    return { text: `${cabecalho}\n${textoAgenda(r, quando)}`, data: { ...contexto, ...r }, empresa };
  }

  // resumo_do_dia
  const [rc, rl, re, rt, ra] = await Promise.all([
    conversas(db, empresa, intervalo),
    leads(db, empresa, intervalo),
    leadsEsperando(db, empresa, agora, { limite: 5 }),
    tarefas(db, empresa, intervalo, user.id, { limite: 5 }),
    agenda(db, empresa, intervalo),
  ]);
  const text = [cabecalho, textoConversas(rc, quando), textoLeads(rl, quando), textoEsperando(re), textoTarefas(rt, quando), textoAgenda(ra, quando)].join("\n\n");
  return { text, data: { ...contexto, conversas: rc, leads: rl, leadsEsperando: re, tarefas: rt, agenda: ra }, empresa };
}
