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

function somarDias(dia, n) {
  return diaEmSaoPaulo(new Date(new Date(`${dia}T12:00:00-03:00`).getTime() + n * DIA_MS));
}

function validarDia(dia) {
  const texto = String(dia).trim();
  if (!DIA_VALIDO.test(texto) || Number.isNaN(new Date(`${texto}T00:00:00-03:00`).getTime())) {
    throw new ToolError("Informe o dia no formato AAAA-MM-DD, por exemplo 2026-10-09.");
  }
  return texto;
}

function vazio(valor) {
  return valor === undefined || valor === null || valor === "";
}

function diaPedido(dia, agora) {
  return intervaloDoDia(vazio(dia) ? diaEmSaoPaulo(agora) : validarDia(dia));
}

export const PERIODOS = ["hoje", "ontem", "semana", "7dias", "mes", "30dias"];

/**
 * O período de uma pergunta ("como foi a semana?") e o anterior, do mesmo
 * tamanho, para comparar. `dia` vence `periodo`: é um dia só.
 * "semana" começa na segunda e "mes" no dia 1, os dois até hoje.
 */
export function periodoPedido({ dia, periodo } = {}, agora) {
  const hoje = diaEmSaoPaulo(agora);
  const janela = (primeiro, dias, rotulo, recuo, rotuloAnterior) => {
    const inicio = intervaloDoDia(primeiro).inicio;
    const fim = new Date(inicio.getTime() + dias * DIA_MS);
    return {
      dia: primeiro,
      dias,
      inicio,
      fim,
      rotulo,
      anterior: { inicio: new Date(inicio.getTime() - recuo * DIA_MS), fim: new Date(fim.getTime() - recuo * DIA_MS), rotulo: rotuloAnterior },
    };
  };
  if (!vazio(dia)) {
    const certo = validarDia(dia);
    if (certo === hoje) return janela(certo, 1, "hoje", 1, "ontem");
    return janela(certo, 1, `em ${dataCurta(intervaloDoDia(certo).inicio)}`, 1, "no dia anterior");
  }
  const qual = vazio(periodo) ? "hoje" : String(periodo);
  if (qual === "hoje") return janela(hoje, 1, "hoje", 1, "ontem");
  if (qual === "ontem") return janela(somarDias(hoje, -1), 1, "ontem", 1, "anteontem");
  if (qual === "semana") {
    const desdeSegunda = (new Date(`${hoje}T12:00:00-03:00`).getUTCDay() + 6) % 7;
    return janela(somarDias(hoje, -desdeSegunda), desdeSegunda + 1, "nesta semana", 7, "no mesmo trecho da semana passada");
  }
  if (qual === "7dias") return janela(somarDias(hoje, -6), 7, "nos últimos 7 dias", 7, "nos 7 dias anteriores");
  if (qual === "mes") {
    const dias = Number(hoje.slice(8, 10));
    return janela(`${hoje.slice(0, 8)}01`, dias, "neste mês", dias, `nos ${dias} dias anteriores`);
  }
  if (qual === "30dias") return janela(somarDias(hoje, -29), 30, "nos últimos 30 dias", 30, "nos 30 dias anteriores");
  throw new ToolError(`Período desconhecido: ${qual}. Use ${PERIODOS.join(", ")}, ou um dia (AAAA-MM-DD).`);
}

function hora(data) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(new Date(data));
}

function dataCurta(data) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(new Date(data));
}

function diaDaSemana(data) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(data));
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

function cortar(texto, limite) {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

const previa = (texto) => cortar(texto, 80);

function semAcento(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const QUEM_ATENDE = { ia: "IA", bot: "fluxo", humano: "equipe" };

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
const lista = (valores) => `(${valores.map((v) => encodeURIComponent(v)).join(",")})`;

/** Em que faixa de idade está uma espera: hoje, nos últimos 7 dias, ou antes. */
function faixa(data, agora) {
  const momento = new Date(data).getTime();
  if (momento >= intervaloDoDia(diaEmSaoPaulo(agora)).inicio.getTime()) return "hoje";
  if (momento >= agora.getTime() - 7 * DIA_MS) return "semana";
  return "antigas";
}

async function conversasComMensagem(db, empresa, inicio, fim, grupo) {
  const mensagens = await db.selectAll(
    `/rest/v1/whatsapp_messages?select=contact_phone,is_from_me&${org(empresa.id)}&sent_at=gte.${iso(inicio)}&sent_at=lt.${iso(fim)}`,
  );
  const telefones = new Set();
  let recebidas = 0;
  let enviadas = 0;
  for (const mensagem of mensagens) {
    if (grupo.has(mensagem.contact_phone)) continue;
    telefones.add(mensagem.contact_phone);
    if (mensagem.is_from_me) enviadas += 1;
    else recebidas += 1;
  }
  return { conversas: telefones.size, recebidas, enviadas };
}

/**
 * Conversas: a tabela espelhada do Bridge, uma linha por chat
 * (`conversasProvider.js`). Grupo é mais da metade das linhas, então conta
 * à parte. "Com mensagem no período" vem das mensagens, não de
 * `last_message_at`, que anda para frente e apagaria os dias passados.
 * "Precisa de você" é o filtro da tela Conversas (`Conversas.jsx`), e vem
 * separado por idade: o total sozinho somava conversas paradas há semanas.
 */
export async function conversas(db, empresa, periodo, agora) {
  const base = `/rest/v1/whatsapp_conversations?select=contact_phone&${org(empresa.id)}`;
  const [diretas, grupos, naoLidas, precisando, telefonesDeGrupo] = await Promise.all([
    db.count(`${base}&chat_kind=eq.direto`),
    db.count(`${base}&chat_kind=eq.grupo`),
    db.count(`${base}&chat_kind=eq.direto&unread_count=gt.0`),
    db.selectAll(
      `/rest/v1/whatsapp_conversations?select=last_message_at&${org(empresa.id)}&chat_kind=eq.direto&unread_count=gt.0&owner=eq.humano`,
    ),
    db.selectAll(`${base}&chat_kind=eq.grupo`),
  ]);
  const grupo = new Set(telefonesDeGrupo.map((linha) => linha.contact_phone));
  const [noPeriodo, antes] = await Promise.all([
    conversasComMensagem(db, empresa, periodo.inicio, periodo.fim, grupo),
    conversasComMensagem(db, empresa, periodo.anterior.inicio, periodo.anterior.fim, grupo),
  ]);
  const precisaDeVoce = { total: precisando.length, hoje: 0, semana: 0, antigas: 0 };
  for (const linha of precisando) if (linha.last_message_at) precisaDeVoce[faixa(linha.last_message_at, agora)] += 1;
  return {
    diretas,
    grupos,
    comMensagem: noPeriodo.conversas,
    mensagensRecebidas: noPeriodo.recebidas,
    mensagensEnviadas: noPeriodo.enviadas,
    anterior: { comMensagem: antes.conversas, mensagensRecebidas: antes.recebidas },
    naoLidas,
    precisaDeVoce,
  };
}

/** Lead é `contacts.lead_at` preenchido (`domain/lead.js`); contato não é lead. */
export async function leads(db, empresa, periodo) {
  const base = `/rest/v1/contacts?select=id&${org(empresa.id)}&deleted_at=is.null&lead_at=not.is.null`;
  const [total, noPeriodo, anterior] = await Promise.all([
    db.count(base),
    db.count(`${base}&lead_at=gte.${iso(periodo.inicio)}&lead_at=lt.${iso(periodo.fim)}`),
    db.count(`${base}&lead_at=gte.${iso(periodo.anterior.inicio)}&lead_at=lt.${iso(periodo.anterior.fim)}`),
  ]);
  return { total, noPeriodo, anterior };
}

function indicePorTelefone(contatos) {
  const indice = new Map();
  for (const contato of contatos) {
    for (const forma of variantesBR(contato.phone)) indice.set(forma, contato);
  }
  return indice;
}

const contatoDoTelefone = (indice, telefone) => variantesBR(telefone).map((forma) => indice.get(forma)).find(Boolean) || null;

/**
 * Quem está esperando a equipe: conversa direta cuja última mensagem é do
 * contato. Para lead, é o estado que a tela de Leads chama de "Respondeu"
 * (`conversaDoLead.js`). Vale para todos, não só lead: o cliente que
 * mandou mensagem e ficou sem resposta costuma ser o maior volume.
 *
 * Separado por idade, e a faixa mais antiga também diz quem é: era
 * justamente o caso grave que sumia da lista.
 */
export async function esperando(db, empresa, agora, { somenteLeads = false, limites = { hoje: 15, semana: 10, antigas: 5 } } = {}) {
  const [conversasEsperando, contatos] = await Promise.all([
    db.selectAll(
      `/rest/v1/whatsapp_conversations?select=contact_phone,contact_name,last_message_preview,last_message_at,owner&${org(empresa.id)}&chat_kind=eq.direto&last_message_from_me=eq.false&last_message_at=not.is.null&order=last_message_at.desc`,
    ),
    db.selectAll(`/rest/v1/contacts?select=id,name,phone,lead_at&${org(empresa.id)}&deleted_at=is.null`),
  ]);
  const indice = indicePorTelefone(contatos);
  const vistos = new Set();
  const faixas = { hoje: [], semana: [], antigas: [] };
  for (const conversa of conversasEsperando) {
    const contato = contatoDoTelefone(indice, conversa.contact_phone);
    const lead = Boolean(contato?.lead_at);
    if (somenteLeads && !lead) continue;
    const chave = contato?.id || conversa.contact_phone;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    faixas[faixa(conversa.last_message_at, agora)].push({
      nome: nomeDoContato(contato?.name || conversa.contact_name, conversa.contact_phone),
      lead,
      desde: conversa.last_message_at,
      espera: tempoDesde(conversa.last_message_at, agora),
      quemAtende: QUEM_ATENDE[conversa.owner] || "fluxo",
      ultimaMensagem: previa(conversa.last_message_preview),
    });
  }
  // Hoje e na semana, a espera mais longa primeiro: é a que mais arrisca.
  // Nas antigas, a mais recente primeiro: é a que ainda dá para salvar.
  faixas.hoje.sort((a, b) => new Date(a.desde) - new Date(b.desde));
  faixas.semana.sort((a, b) => new Date(a.desde) - new Date(b.desde));
  faixas.antigas.sort((a, b) => new Date(b.desde) - new Date(a.desde));
  const resumo = (nome) => ({ total: faixas[nome].length, lista: faixas[nome].slice(0, limites[nome]) });
  return {
    somenteLeads,
    total: faixas.hoje.length + faixas.semana.length + faixas.antigas.length,
    hoje: resumo("hoje"),
    semana: resumo("semana"),
    antigas: resumo("antigas"),
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
  const nomes = await nomesDasPessoas(db, pendentes.flatMap(responsaveis));

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

async function nomesDasPessoas(db, ids) {
  const nomes = new Map();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return nomes;
  try {
    const perfis = await db.select(`/rest/v1/profiles?select=id,full_name&id=in.${lista(unicos)}`);
    for (const perfil of perfis || []) if (perfil.full_name) nomes.set(perfil.id, perfil.full_name);
  } catch {
    // Sem nome, a tarefa continua útil: o título e o prazo bastam.
  }
  return nomes;
}

/**
 * Agenda pela mesma RPC do portal (`agendaProvider.js`), de um dia ou de
 * vários ("como está a semana?"). Ela já respeita a visibilidade: evento
 * pessoal de outra pessoa chega mascarado. Tarefas com prazo também vêm
 * nela; ficam de fora, já que têm ferramenta.
 */
export async function agenda(db, empresa, intervalo, dias = 1) {
  const fim = new Date(intervalo.inicio.getTime() + dias * DIA_MS);
  const linhas = await db.rpc("calendar_events_list", {
    target_organization: empresa.id,
    range_start: intervalo.inicio.toISOString(),
    range_end: fim.toISOString(),
  });
  const eventos = (linhas || [])
    .filter((linha) => linha.source_type === "event")
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .map((linha) => ({
      titulo: linha.title || "Sem título",
      dia: diaEmSaoPaulo(new Date(linha.starts_at)),
      inicio: linha.starts_at,
      fim: linha.ends_at,
      diaTodo: Boolean(linha.all_day),
      horario: linha.all_day ? "dia todo" : `${hora(linha.starts_at)}–${hora(linha.ends_at)}`,
      responsavel: linha.owner_name || null,
      local: linha.location || null,
      provisorio: linha.status === "tentative",
    }));
  return { dias, total: eventos.length, eventos };
}

/* ───────────────────────── uma pessoa ───────────────────────── */

/** O que vai para o `ilike` do PostgREST: sem curinga nem pontuação de sintaxe. */
function termoDeBusca(texto) {
  return String(texto || "").replace(/[*%,()"'\\:]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Acha quem a pessoa quer dizer: por nome (contém), pelo número inteiro
 * (com e sem o nono dígito) ou pelos últimos dígitos ("a Maria final 8164").
 * Procura no CRM e nas conversas, porque muita gente que escreve no
 * WhatsApp nunca virou contato.
 */
export async function buscarPessoas(db, empresa, busca) {
  const texto = String(busca || "").trim();
  const digitos = texto.replace(/\D/g, "");
  const contatosBase = `/rest/v1/contacts?select=id,name,phone,company,job_title,source,lead_at,created_at&${org(empresa.id)}&deleted_at=is.null`;
  const conversasBase = `/rest/v1/whatsapp_conversations?select=contact_phone,contact_name,last_message_at,last_message_from_me,last_message_preview,owner,unread_count&${org(empresa.id)}&chat_kind=eq.direto`;
  let filtroContato;
  let filtroConversa;
  if (digitos.length >= 8) {
    const formas = variantesBR(digitos);
    const todas = formas.length ? formas : [digitos];
    filtroContato = `phone=in.${lista(todas)}`;
    filtroConversa = `contact_phone=in.${lista(todas)}`;
  } else if (digitos.length >= 4 && digitos.length === texto.replace(/[\s\-.()+]/g, "").length) {
    filtroContato = `phone=like.${encodeURIComponent(`*${digitos}`)}`;
    filtroConversa = `contact_phone=like.${encodeURIComponent(`*${digitos}`)}`;
  } else {
    const termo = termoDeBusca(texto);
    if (termo.length < 2) throw new ToolError("Diga o nome (ou parte dele) ou o número de quem você procura.");
    const padrao = encodeURIComponent(`*${termo}*`);
    filtroContato = `name=ilike.${padrao}`;
    filtroConversa = `contact_name=ilike.${padrao}`;
  }
  const [contatos, conversasAchadas] = await Promise.all([
    db.select(`${contatosBase}&${filtroContato}&limit=10`),
    db.select(`${conversasBase}&${filtroConversa}&limit=10`),
  ]);
  const indice = indicePorTelefone(contatos || []);
  const candidatos = (contatos || []).map((contato) => ({ contato, conversa: null }));
  for (const conversa of conversasAchadas || []) {
    const dono = contatoDoTelefone(indice, conversa.contact_phone);
    if (dono) {
      const candidato = candidatos.find((c) => c.contato.id === dono.id);
      if (!candidato.conversa || new Date(conversa.last_message_at || 0) > new Date(candidato.conversa.last_message_at || 0)) {
        candidato.conversa = conversa;
      }
    } else {
      candidatos.push({ contato: null, conversa });
    }
  }
  return candidatos;
}

function rotuloDoCandidato({ contato, conversa }) {
  const nome = nomeDoContato(contato?.name || conversa?.contact_name, contato?.phone || conversa?.contact_phone);
  const tipo = !contato ? "só no WhatsApp" : contato.lead_at ? "lead" : "contato";
  return `${nome} (${telefoneMascarado(contato?.phone || conversa?.contact_phone)}, ${tipo})`;
}

/** Um só, ou a pergunta de volta: nunca chuta entre duas Marias. */
export function escolherPessoa(candidatos, busca) {
  if (!candidatos.length) {
    throw new ToolError(`Não achei ninguém com "${busca}" nos contatos nem nas conversas. Tente outra parte do nome ou o número.`);
  }
  if (candidatos.length === 1) return candidatos[0];
  const alvo = semAcento(busca);
  const exatos = candidatos.filter((c) => semAcento(c.contato?.name || c.conversa?.contact_name) === alvo);
  if (exatos.length === 1) return exatos[0];
  throw new ToolError(
    `Achei ${candidatos.length} pessoas com "${busca}": ${candidatos.slice(0, 8).map(rotuloDoCandidato).join("; ")}. Qual delas? Pode dizer o nome completo ou os últimos dígitos do número.`,
  );
}

async function conversaDoContato(db, empresa, contato) {
  const formas = variantesBR(contato.phone);
  if (!formas.length) return null;
  const linhas = await db.select(
    `/rest/v1/whatsapp_conversations?select=contact_phone,contact_name,last_message_at,last_message_from_me,last_message_preview,owner,unread_count&${org(empresa.id)}&chat_kind=eq.direto&contact_phone=in.${lista(formas)}`,
  );
  return (linhas || []).sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))[0] || null;
}

/**
 * A ficha: o que a tela da ficha mostra, em poucas linhas. Negócio com a
 * etapa pelo nome, tarefas abertas, as três notas mais novas e o pé da
 * conversa (quem falou por último e quando).
 */
export async function ficha(db, empresa, candidato, agora) {
  const { contato } = candidato;
  let conversa = candidato.conversa;
  if (!contato) {
    return { noCrm: false, nome: nomeDoContato(conversa.contact_name, conversa.contact_phone), telefone: telefoneMascarado(conversa.contact_phone), conversa: peDaConversa(conversa, agora) };
  }
  const porContato = `contact_id=eq.${encodeURIComponent(contato.id)}&${org(empresa.id)}&deleted_at=is.null`;
  const [negocios, etapas, abertas, notas, achada] = await Promise.all([
    db.select(`/rest/v1/deals?select=title,value,status,stage_id,loss_reason,updated_at&${porContato}&order=updated_at.desc`),
    db.select(`/rest/v1/stages?select=id,name&${org(empresa.id)}&deleted_at=is.null`),
    db.select(`/rest/v1/tasks?select=title,due_at&${porContato}&completed=eq.false&order=due_at.asc.nullslast`),
    db.select(`/rest/v1/notes?select=body,author_label,created_at&${porContato}&order=created_at.desc&limit=3`),
    conversa ? Promise.resolve(conversa) : conversaDoContato(db, empresa, contato),
  ]);
  conversa = achada;
  const nomeDaEtapa = new Map((etapas || []).map((etapa) => [etapa.id, etapa.name]));
  return {
    noCrm: true,
    nome: nomeDoContato(contato.name, contato.phone),
    telefone: telefoneMascarado(contato.phone),
    lead: Boolean(contato.lead_at),
    leadDesde: contato.lead_at || null,
    empresaDoContato: contato.company || null,
    cargo: contato.job_title || null,
    origem: contato.source || null,
    noCrmDesde: contato.created_at || null,
    negocios: (negocios || []).map((negocio) => ({
      titulo: negocio.title || null,
      etapa: nomeDaEtapa.get(negocio.stage_id) || "etapa removida",
      situacao: negocio.status,
      valor: negocio.value === null || negocio.value === undefined ? null : Number(negocio.value),
      motivoDaPerda: negocio.status === "perdido" ? negocio.loss_reason || null : null,
    })),
    tarefasAbertas: (abertas || []).map((tarefa) => ({ titulo: tarefa.title || "Sem título", prazo: tarefa.due_at || null })),
    notas: (notas || []).map((nota) => ({ texto: cortar(nota.body, 200), autor: nota.author_label || null, em: nota.created_at })),
    conversa: conversa ? peDaConversa(conversa, agora) : null,
  };
}

function peDaConversa(conversa, agora) {
  return {
    ultimaEm: conversa.last_message_at || null,
    haQuanto: conversa.last_message_at ? tempoDesde(conversa.last_message_at, agora) : null,
    ultimaFoiDe: conversa.last_message_from_me ? "equipe" : "contato",
    esperandoResposta: conversa.last_message_from_me === false,
    quemAtende: QUEM_ATENDE[conversa.owner] || "fluxo",
    naoLidas: conversa.unread_count || 0,
    ultimaMensagem: previa(conversa.last_message_preview),
  };
}

const AUTORES = { ia: "IA", bot: "Fluxo", humano: "Equipe", celular: "Equipe (celular)", "": "Equipe" };
const MIDIAS = { audio: "áudio", ptt: "áudio", image: "imagem", video: "vídeo", document: "documento", sticker: "figurinha" };

/**
 * As últimas mensagens com uma pessoa, em ordem, para o modelo resumir.
 * Só de quem foi pedido e só quando pedido: é o dado mais sensível que sai
 * daqui. Áudio transcrito chega como texto, marcado; mídia sem texto, pelo
 * rótulo.
 */
export async function mensagens(db, empresa, candidato, quantidade = 20) {
  const telefone = candidato.contato?.phone || candidato.conversa?.contact_phone;
  const formas = variantesBR(telefone);
  const telefones = formas.length ? formas : [String(telefone || "").replace(/\D/g, "")].filter(Boolean);
  const nome = nomeDoContato(candidato.contato?.name || candidato.conversa?.contact_name, telefone);
  if (!telefones.length) return { nome, total: 0, mensagens: [] };
  const limite = Math.min(Math.max(Number(quantidade) || 20, 1), 50);
  const linhas = await db.select(
    `/rest/v1/whatsapp_messages?select=content,sent_at,is_from_me,author_kind,author_name,media_type&${org(empresa.id)}&contact_phone=in.${lista(telefones)}&order=sent_at.desc&limit=${limite}`,
  );
  const ordenadas = (linhas || []).sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at)).slice(-limite);
  return {
    nome,
    total: ordenadas.length,
    mensagens: ordenadas.map((linha) => {
      const midia = linha.media_type ? MIDIAS[linha.media_type] || "anexo" : "";
      const conteudo = cortar(linha.content, 400);
      return {
        em: linha.sent_at,
        quem: linha.is_from_me ? cortar(linha.author_name, 40) || AUTORES[linha.author_kind] || "Equipe" : nome,
        daEquipe: Boolean(linha.is_from_me),
        texto: conteudo ? (midia ? `[${midia}] ${conteudo}` : conteudo) : `[${midia || "mensagem sem texto"}]`,
      };
    }),
  };
}

/* ───────────────────────── texto para o celular ───────────────────────── */

function comparacao(atual, antes, rotulo) {
  return `${rotulo}: ${antes}${atual > antes ? " (subiu)" : atual < antes ? " (caiu)" : ""}`;
}

function textoConversas(r, periodo) {
  const p = r.precisaDeVoce;
  return [
    `Conversas ${periodo.rotulo}: ${r.comMensagem} com mensagem (${r.mensagensRecebidas} recebidas, ${r.mensagensEnviadas} enviadas); ${comparacao(r.comMensagem, r.anterior.comMensagem, periodo.anterior.rotulo)}.`,
    `No total: ${r.diretas} conversas diretas e ${r.grupos} grupos. Não lidas: ${r.naoLidas}.`,
    `Precisando de alguém da equipe: ${p.total} (${p.hoje} de hoje, ${p.semana} dos últimos 7 dias, ${p.antigas} mais antigas).`,
  ].join("\n");
}

function textoLeads(r, periodo) {
  return `Leads: ${r.total} no total, ${r.noPeriodo} novos ${periodo.rotulo}; ${comparacao(r.noPeriodo, r.anterior, periodo.anterior.rotulo)}.`;
}

function linhaDeEspera(item) {
  return `- ${item.nome}${item.lead ? " (lead)" : ""}: há ${item.espera} (${item.quemAtende})${item.ultimaMensagem ? ` — "${item.ultimaMensagem}"` : ""}`;
}

function textoEsperando(r) {
  const quem = r.somenteLeads ? "lead" : "pessoa";
  if (!r.total) return `Nenhum${r.somenteLeads ? " lead" : "a pessoa"} esperando resposta.`;
  const linhas = [`Esperando resposta: ${r.total} (${r.hoje.total} de hoje, ${r.semana.total} dos últimos 7 dias, ${r.antigas.total} há mais tempo).`];
  const bloco = (titulo, faixaDeEspera) => {
    if (!faixaDeEspera.total) return;
    linhas.push(`${titulo}:`, ...faixaDeEspera.lista.map(linhaDeEspera));
    if (faixaDeEspera.total > faixaDeEspera.lista.length) linhas.push(`…e mais ${faixaDeEspera.total - faixaDeEspera.lista.length} ${quem}(s).`);
  };
  bloco("De hoje", r.hoje);
  bloco("Últimos 7 dias", r.semana);
  bloco("Há mais tempo (as mais recentes)", r.antigas);
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
  const alcance = r.dias > 1 ? `nos próximos ${r.dias} dias` : quando;
  if (!r.total) return `Nenhum compromisso na agenda ${alcance}.`;
  const linhas = [`Compromissos ${alcance}: ${r.total}.`];
  let diaAtual = "";
  for (const evento of r.eventos) {
    if (r.dias > 1 && evento.dia !== diaAtual) {
      diaAtual = evento.dia;
      linhas.push(`${diaDaSemana(evento.inicio)}:`);
    }
    linhas.push(`- ${evento.horario} ${evento.titulo}${evento.responsavel ? ` — ${evento.responsavel}` : ""}${evento.provisorio ? " (provisório)" : ""}`);
  }
  return linhas.join("\n");
}

function textoFicha(f) {
  const linhas = [`${f.nome} (${f.telefone})${f.noCrm ? (f.lead ? `, lead desde ${dataCurta(f.leadDesde)}` : ", contato (não é lead)") : ", só no WhatsApp (não está no CRM)"}.`];
  const extras = [f.empresaDoContato, f.cargo, f.origem && `origem: ${f.origem}`].filter(Boolean);
  if (extras.length) linhas.push(extras.join(" · "));
  for (const negocio of f.negocios || []) {
    linhas.push(`Negócio${negocio.titulo ? ` "${negocio.titulo}"` : ""}: ${negocio.etapa}, ${negocio.situacao}${negocio.valor !== null ? `, R$ ${negocio.valor.toLocaleString("pt-BR")}` : ""}${negocio.motivoDaPerda ? ` (perdido: ${negocio.motivoDaPerda})` : ""}.`);
  }
  if (f.noCrm && !(f.negocios || []).length) linhas.push("Sem negócio no Funil.");
  for (const tarefa of f.tarefasAbertas || []) linhas.push(`Tarefa aberta: ${tarefa.titulo}${tarefa.prazo ? ` (${dataCurta(tarefa.prazo)} ${hora(tarefa.prazo)})` : ""}.`);
  for (const nota of f.notas || []) linhas.push(`Nota de ${dataCurta(nota.em)}${nota.autor ? ` (${nota.autor})` : ""}: ${nota.texto}`);
  if (f.conversa) {
    const c = f.conversa;
    linhas.push(
      c.esperandoResposta
        ? `WhatsApp: esperando a equipe há ${c.haQuanto} (${c.quemAtende}). Última: "${c.ultimaMensagem}".`
        : `WhatsApp: a equipe falou por último, há ${c.haQuanto}. Última: "${c.ultimaMensagem}".`,
    );
  } else {
    linhas.push("Sem conversa no WhatsApp.");
  }
  return linhas.join("\n");
}

function textoMensagens(r) {
  if (!r.total) return `Nenhuma mensagem guardada com ${r.nome} (o portal guarda os últimos 90 dias).`;
  return [
    `Conversa com ${r.nome}, últimas ${r.total} mensagens:`,
    ...r.mensagens.map((m) => `${dataCurta(m.em)} ${hora(m.em)} · ${m.quem}: ${m.texto}`),
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
const PERIODO = {
  type: "string",
  enum: PERIODOS,
  description: "Período em vez de um dia: hoje, ontem, semana (de segunda até hoje), 7dias, mes (do dia 1 até hoje) ou 30dias. Vem comparado com o período anterior.",
};
const BUSCA = {
  type: "string",
  description: "Nome (ou parte), número de WhatsApp ou os últimos dígitos do número de quem se procura.",
};

function ferramenta(name, title, description, properties = {}, required = []) {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false },
    annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

export const TOOLS = [
  ferramenta("minhas_empresas", "Minhas empresas", "Lista as empresas do Núcleo Major em que a pessoa participa, com o papel dela em cada uma."),
  ferramenta(
    "resumo_do_dia",
    "Resumo do dia",
    "Responde de uma vez: conversas do dia, leads, quem está esperando resposta, tarefas pendentes e compromissos da agenda. Use para perguntas gerais como 'como está hoje?'.",
    { empresa: EMPRESA, dia: DIA },
  ),
  ferramenta(
    "esperando_resposta",
    "Quem está esperando resposta",
    "Pessoas cuja última mensagem no WhatsApp é delas, esperando a equipe: de hoje, dos últimos 7 dias e mais antigas, com nome, há quanto tempo, quem atende e a última mensagem. Use para 'tem alguém esperando?', 'quem eu preciso responder?'.",
    { empresa: EMPRESA, somente_leads: { type: "boolean", description: "Só leads (contatos marcados como lead). Sem ele, todos." } },
  ),
  ferramenta("leads_esperando", "Leads esperando resposta", "O mesmo que esperando_resposta, só com leads.", { empresa: EMPRESA }),
  ferramenta(
    "ficha_do_contato",
    "Ficha do contato",
    "Quem é uma pessoa: se é lead, negócio e etapa no Funil, tarefas abertas, notas recentes e como está a conversa no WhatsApp. Procura por nome, número ou últimos dígitos; se houver mais de uma, devolve a lista para escolher.",
    { empresa: EMPRESA, busca: BUSCA },
    ["busca"],
  ),
  ferramenta(
    "conversa_com_contato",
    "Conversa com o contato",
    "As últimas mensagens do WhatsApp com uma pessoa, em ordem, para resumir o que ela pediu ou o que foi combinado. Use só quando perguntarem sobre a conversa de alguém específico.",
    { empresa: EMPRESA, busca: BUSCA, mensagens: { type: "integer", minimum: 1, maximum: 50, description: "Quantas mensagens trazer (padrão 20, no máximo 50)." } },
    ["busca"],
  ),
  ferramenta("conversas", "Conversas do WhatsApp", "Quantas conversas tiveram mensagem no dia ou no período, comparado com o anterior; total, não lidas, e quantas precisam de alguém da equipe, por idade.", { empresa: EMPRESA, dia: DIA, periodo: PERIODO }),
  ferramenta("leads", "Leads", "Quantos leads existem e quantos entraram no dia ou no período, comparado com o anterior.", { empresa: EMPRESA, dia: DIA, periodo: PERIODO }),
  ferramenta("tarefas", "Tarefas", "Tarefas pendentes: atrasadas, do dia, sem data, e quantas são da própria pessoa.", { empresa: EMPRESA, dia: DIA }),
  ferramenta(
    "agenda",
    "Agenda",
    "Compromissos da agenda com horário e responsável, de um dia ou dos próximos dias ('como está a semana?').",
    { empresa: EMPRESA, dia: { ...DIA, description: "Primeiro dia (AAAA-MM-DD, Brasília). Sem ele, hoje." }, dias: { type: "integer", minimum: 1, maximum: 14, description: "Quantos dias a partir do primeiro (padrão 1, no máximo 14)." } },
  ),
];

const NOMES = new Set(TOOLS.map((tool) => tool.name));

/**
 * Executa uma ferramenta. Devolve `{ text, data, empresa }`; erro de uso
 * (empresa ambígua, dia inválido, duas Marias) sai como `ToolError`, que o
 * protocolo entrega ao modelo como resultado com `isError`, para ele
 * perguntar.
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
  const contexto = { empresa: { id: empresa.id, nome: empresa.nome } };

  if (name === "esperando_resposta" || name === "leads_esperando") {
    const somenteLeads = name === "leads_esperando" || entrada.somente_leads === true;
    const r = await esperando(db, empresa, agora, { somenteLeads });
    return { text: `${empresa.nome}\n${textoEsperando(r)}`, data: { ...contexto, ...r }, empresa };
  }
  if (name === "ficha_do_contato" || name === "conversa_com_contato") {
    const candidato = escolherPessoa(await buscarPessoas(db, empresa, entrada.busca), entrada.busca);
    if (name === "ficha_do_contato") {
      const f = await ficha(db, empresa, candidato, agora);
      return { text: `${empresa.nome}\n${textoFicha(f)}`, data: { ...contexto, ...f }, empresa };
    }
    const r = await mensagens(db, empresa, candidato, entrada.mensagens);
    return { text: `${empresa.nome}\n${textoMensagens(r)}`, data: { ...contexto, ...r }, empresa };
  }

  if (name === "conversas" || name === "leads") {
    const periodo = periodoPedido({ dia: entrada.dia, periodo: entrada.periodo }, agora);
    const cabecalho = `${empresa.nome} — ${periodo.rotulo}`;
    const dataDoPeriodo = { ...contexto, periodo: periodo.rotulo, de: periodo.inicio.toISOString(), ate: periodo.fim.toISOString() };
    if (name === "conversas") {
      const r = await conversas(db, empresa, periodo, agora);
      return { text: `${cabecalho}\n${textoConversas(r, periodo)}`, data: { ...dataDoPeriodo, ...r }, empresa };
    }
    const r = await leads(db, empresa, periodo);
    return { text: `${cabecalho}\n${textoLeads(r, periodo)}`, data: { ...dataDoPeriodo, ...r }, empresa };
  }

  const intervalo = diaPedido(entrada.dia, agora);
  const quando = intervalo.dia === diaEmSaoPaulo(agora) ? "hoje" : `em ${dataCurta(intervalo.inicio)}`;
  const cabecalho = `${empresa.nome} — ${quando === "hoje" ? `hoje, ${dataCurta(intervalo.inicio)}` : quando}`;
  const contextoDoDia = { ...contexto, dia: intervalo.dia };

  if (name === "tarefas") {
    const r = await tarefas(db, empresa, intervalo, user.id);
    return { text: `${cabecalho}\n${textoTarefas(r, quando)}`, data: { ...contextoDoDia, ...r }, empresa };
  }
  if (name === "agenda") {
    const dias = Math.min(Math.max(Number(entrada.dias) || 1, 1), 14);
    const r = await agenda(db, empresa, intervalo, dias);
    return { text: `${cabecalho}\n${textoAgenda(r, quando)}`, data: { ...contextoDoDia, ...r }, empresa };
  }

  // resumo_do_dia
  const periodo = periodoPedido({ dia: entrada.dia }, agora);
  const [rc, rl, re, rt, ra] = await Promise.all([
    conversas(db, empresa, periodo, agora),
    leads(db, empresa, periodo),
    esperando(db, empresa, agora, { limites: { hoje: 5, semana: 5, antigas: 3 } }),
    tarefas(db, empresa, intervalo, user.id, { limite: 5 }),
    agenda(db, empresa, intervalo, 1),
  ]);
  const text = [cabecalho, textoConversas(rc, periodo), textoLeads(rl, periodo), textoEsperando(re), textoTarefas(rt, quando), textoAgenda(ra, quando)].join("\n\n");
  return { text, data: { ...contextoDoDia, conversas: rc, leads: rl, esperando: re, tarefas: rt, agenda: ra }, empresa };
}
