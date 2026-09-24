/**
 * As contas dos Relatórios, sem React, para poder testar.
 *
 * Três palavras com sentido fixo (decidido com o dono em 24/09/2026):
 *
 *   contato  - todo mundo no CRM; conta pela data de criação;
 *   lead     - contato marcado como lead; conta por `leadEm`;
 *   negócio  - a oportunidade no Funil; só existe para lead.
 *
 * Dois jeitos de contar, e cada parte da tela usa um só:
 *
 *   PERÍODO - o que aconteceu entre `inicio` e `fim`, venha de quando vier.
 *             É o dos cartões e da tabela mês a mês.
 *   SAFRA   - das pessoas que chegaram no período, até onde cada uma foi até
 *             hoje. É o do funil, e é o único em que "quantos desses" faz
 *             sentido: cada degrau é parte do anterior, nunca passa de 100%.
 *
 * `fim` é sempre exclusivo.
 */

const DIA = 24 * 60 * 60 * 1000;

const normalizar = (texto) =>
  String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const dentro = (ts, inicio, fim) => ts != null && ts >= inicio && ts < fim;

/* ------------------------------------------------------------ períodos */

const inicioDoMes = (ano, mes) => new Date(ano, mes, 1).getTime();

export const PRESETS = [
  { id: "mes", rotulo: "Este mês" },
  { id: "mes-anterior", rotulo: "Mês passado" },
  { id: "30d", rotulo: "Últimos 30 dias" },
  { id: "90d", rotulo: "Últimos 90 dias" },
  { id: "ano", rotulo: "Este ano" },
];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function rotuloDoMes(ts, longo = false) {
  const d = new Date(ts);
  return longo ? `${MESES_LONGOS[d.getMonth()]} de ${d.getFullYear()}` : `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * O período de um atalho, e o anterior de mesmo tamanho para a comparação.
 * Mês compara com o mês anterior inteiro (setembro com agosto), não com os 30
 * dias antes: é assim que quem lê pensa.
 */
export function periodoDoPreset(id, agora = Date.now()) {
  const d = new Date(agora);
  const ano = d.getFullYear();
  const mes = d.getMonth();
  const amanha = new Date(ano, mes, d.getDate() + 1).getTime();
  if (id === "mes") {
    // O mês corrente está pela metade: compará-lo com o mês anterior inteiro
    // mostraria queda todo dia 10. Compara com os mesmos dias do mês anterior
    // (1 a 24 de setembro contra 1 a 24 de agosto), cortados no fim dele.
    const fimAnterior = Math.min(new Date(ano, mes - 1, d.getDate() + 1).getTime(), inicioDoMes(ano, mes));
    return { inicio: inicioDoMes(ano, mes), fim: amanha, anterior: { inicio: inicioDoMes(ano, mes - 1), fim: fimAnterior } };
  }
  if (id === "mes-anterior") {
    return { inicio: inicioDoMes(ano, mes - 1), fim: inicioDoMes(ano, mes), anterior: { inicio: inicioDoMes(ano, mes - 2), fim: inicioDoMes(ano, mes - 1) } };
  }
  if (id === "ano") {
    return { inicio: inicioDoMes(ano, 0), fim: inicioDoMes(ano + 1, 0), anterior: { inicio: inicioDoMes(ano - 1, 0), fim: inicioDoMes(ano, 0) } };
  }
  const dias = id === "90d" ? 90 : 30;
  const inicio = new Date(ano, mes, d.getDate() + 1 - dias).getTime();
  return { inicio, fim: amanha, anterior: periodoAnteriorDe(inicio, amanha) };
}

/** Um mês do calendário, a partir de qualquer instante dentro dele. */
export function periodoDoMes(ts) {
  const d = new Date(ts);
  const ano = d.getFullYear();
  const mes = d.getMonth();
  return { inicio: inicioDoMes(ano, mes), fim: inicioDoMes(ano, mes + 1), anterior: { inicio: inicioDoMes(ano, mes - 1), fim: inicioDoMes(ano, mes) } };
}

export function periodoAnteriorDe(inicio, fim) {
  const dias = Math.max(1, Math.round((fim - inicio) / DIA));
  const d = new Date(inicio);
  return { inicio: new Date(d.getFullYear(), d.getMonth(), d.getDate() - dias).getTime(), fim: inicio };
}

/** `de` e `ate` como "aaaa-mm-dd", do jeito do `<input type="date">`; `ate` inclusivo. */
export function periodoPersonalizado(de, ate) {
  const [a1, m1, d1] = String(de || "").split("-").map(Number);
  const [a2, m2, d2] = String(ate || "").split("-").map(Number);
  if (!a1 || !a2) return null;
  let inicio = new Date(a1, m1 - 1, d1).getTime();
  let fim = new Date(a2, m2 - 1, d2 + 1).getTime();
  if (fim <= inicio) [inicio, fim] = [new Date(a2, m2 - 1, d2).getTime(), new Date(a1, m1 - 1, d1 + 1).getTime()];
  return { inicio, fim, anterior: periodoAnteriorDe(inicio, fim) };
}

/* ------------------------------------------------------ negócio: estado */

export function acharEstagioFechado(estagios = []) {
  return estagios.find((e) => e.id === "fechado" || normalizar(e.nome) === "fechado") || null;
}

/**
 * Proposta é a etapa cujo nome tem "proposta"; chegar nela é estar nela ou em
 * qualquer etapa depois (Negociação, Fechado), ou ter sido ganho. Sem etapa
 * com esse nome, o degrau some do funil em vez de mostrar zero.
 */
export function etapasDaProposta(estagios = []) {
  const proposta = [...estagios].sort((a, b) => a.ordem - b.ordem).find((e) => normalizar(e.nome).includes("proposta"));
  if (!proposta) return null;
  return new Set(estagios.filter((e) => e.ordem >= proposta.ordem).map((e) => e.id));
}

/** O Funil trata "na etapa Fechado" e "status ganho" como a mesma coisa; aqui também. */
export function foiGanho(negocio, idFechado) {
  return negocio.status === "ganho" || (negocio.status !== "perdido" && idFechado != null && negocio.stageId === idFechado);
}

/**
 * Quando fechou. `fechadoEm` vem do banco (migration 20260926150000); antes
 * dela só há `atualizadoEm`, que muda a cada edição — por isso `aproximado`.
 */
export function dataDoFechamento(negocio, idFechado) {
  const fechado = negocio.status === "perdido" || foiGanho(negocio, idFechado);
  if (!fechado) return { em: null, aproximado: false };
  if (negocio.fechadoEm != null) return { em: negocio.fechadoEm, aproximado: false };
  return { em: negocio.atualizadoEm || negocio.criadoEm || null, aproximado: true };
}

/* ------------------------------------------------------------- filtros */

/**
 * Origem e responsável são do CONTATO, para os três níveis. Filtrar o negócio
 * pela origem dele e o lead pela do contato faria os degraus do funil
 * contarem populações diferentes.
 */
export function aplicarFiltros({ contatos = [], negocios = [] }, { origem = "", responsavel = "" } = {}) {
  if (!origem && !responsavel) return { contatos, negocios };
  const passa = (c) => (!origem || (c.origem || "") === origem) && (!responsavel || (c.responsavel || "") === responsavel);
  const filtrados = contatos.filter(passa);
  const ids = new Set(filtrados.map((c) => c.id));
  return { contatos: filtrados, negocios: negocios.filter((n) => ids.has(n.contactId)) };
}

/* -------------------------------------------------------------- contas */

/**
 * O que cada negócio já alcançou, por contato: tem negócio, chegou à
 * proposta, ganhou. O histórico só acrescenta — um negócio perdido que passou
 * por Proposta só é visto por ele.
 */
function alcancePorContato(negocios, historico, estagios) {
  const idFechado = acharEstagioFechado(estagios)?.id ?? null;
  const proposta = etapasDaProposta(estagios);
  const passouPelaProposta = new Set();
  if (proposta) {
    for (const h of historico || []) {
      if (proposta.has(h.paraEtapa) || h.paraStatus === "ganho") passouPelaProposta.add(h.negocioId);
    }
  }
  const alcance = new Map();
  for (const n of negocios) {
    const atual = alcance.get(n.contactId) || { negocio: false, proposta: false, ganho: false };
    atual.negocio = true;
    const ganho = foiGanho(n, idFechado);
    if (ganho) atual.ganho = true;
    if (proposta && (ganho || proposta.has(n.stageId) || passouPelaProposta.has(n.id))) atual.proposta = true;
    alcance.set(n.contactId, atual);
  }
  return { alcance, temProposta: Boolean(proposta) };
}

/** Os números de um período. `leadEm === undefined` em todos = banco sem a coluna. */
export function metricasDoPeriodo({ contatos = [], negocios = [], estagios = [] }, { inicio, fim }) {
  const idFechado = acharEstagioFechado(estagios)?.id ?? null;
  const semMarcaDeLead = contatos.length > 0 && contatos.every((c) => c.leadEm === undefined);

  const contatosNovos = contatos.filter((c) => dentro(c.criadoEm, inicio, fim));
  const leadsNovos = semMarcaDeLead ? null : contatos.filter((c) => dentro(c.leadEm, inicio, fim));
  const negociosNovos = negocios.filter((n) => dentro(n.criadoEm, inicio, fim));

  let ganhos = 0;
  let valorGanho = 0;
  let perdidos = 0;
  let aproximado = false;
  const motivos = new Map();
  for (const n of negocios) {
    const { em, aproximado: aprox } = dataDoFechamento(n, idFechado);
    if (!dentro(em, inicio, fim)) continue;
    if (aprox) aproximado = true;
    if (n.status === "perdido") {
      perdidos += 1;
      const motivo = (n.motivoPerda || "").trim() || "Sem motivo informado";
      motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
    } else {
      ganhos += 1;
      valorGanho += n.valor || 0;
    }
  }

  return {
    contatosNovos: contatosNovos.length,
    leadsNovos: leadsNovos ? leadsNovos.length : null,
    negociosNovos: negociosNovos.length,
    valorCriado: negociosNovos.reduce((s, n) => s + (n.valor || 0), 0),
    ganhos,
    valorGanho,
    perdidos,
    taxaDeGanho: ganhos + perdidos ? ganhos / (ganhos + perdidos) : null,
    fechamentoAproximado: aproximado,
    motivosDePerda: [...motivos.entries()].map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total),
    semMarcaDeLead,
  };
}

/**
 * A safra: dos contatos que chegaram no período, quantos viraram lead,
 * quantos têm negócio, quantos chegaram à proposta, quantos foram ganhos —
 * até hoje. Cada degrau é subconjunto do anterior.
 */
export function funilDaSafra({ contatos = [], negocios = [], estagios = [] }, historico, { inicio, fim }) {
  const { alcance, temProposta } = alcancePorContato(negocios, historico, estagios);
  const safra = contatos.filter((c) => dentro(c.criadoEm, inicio, fim));
  const semMarcaDeLead = contatos.length > 0 && contatos.every((c) => c.leadEm === undefined);
  const leads = semMarcaDeLead ? [] : safra.filter((c) => c.leadEm != null);
  const comNegocio = leads.filter((c) => alcance.get(c.id)?.negocio);
  const naProposta = comNegocio.filter((c) => alcance.get(c.id)?.proposta);
  const ganhos = (temProposta ? naProposta : comNegocio).filter((c) => alcance.get(c.id)?.ganho);

  const degraus = [
    { id: "contatos", rotulo: "Contatos novos", total: safra.length },
    ...(semMarcaDeLead ? [] : [{ id: "leads", rotulo: "Viraram lead", total: leads.length }]),
    ...(semMarcaDeLead ? [] : [{ id: "negocios", rotulo: "Com negócio", total: comNegocio.length }]),
    ...(temProposta && !semMarcaDeLead ? [{ id: "proposta", rotulo: "Chegaram à proposta", total: naProposta.length }] : []),
    ...(semMarcaDeLead ? [] : [{ id: "ganhos", rotulo: "Fecharam", total: ganhos.length }]),
  ];
  return degraus.map((d, i) => ({
    ...d,
    doAnterior: i === 0 ? null : degraus[i - 1].total ? d.total / degraus[i - 1].total : null,
    doTopo: degraus[0].total ? d.total / degraus[0].total : null,
  }));
}

/** Os últimos `quantos` meses até o mês de `ate`, do mais antigo ao mais novo. */
export function serieMensal(dados, historico, { ate = Date.now(), quantos = 12 } = {}) {
  const d = new Date(ate);
  const meses = [];
  for (let i = quantos - 1; i >= 0; i -= 1) {
    const inicio = inicioDoMes(d.getFullYear(), d.getMonth() - i);
    const fim = inicioDoMes(d.getFullYear(), d.getMonth() - i + 1);
    const m = metricasDoPeriodo(dados, { inicio, fim });
    const safra = funilDaSafra(dados, historico, { inicio, fim });
    const topo = safra[0]?.total || 0;
    const fecharam = safra.find((s) => s.id === "ganhos")?.total ?? null;
    meses.push({ inicio, fim, rotulo: rotuloDoMes(inicio), ...m, safraFechou: topo && fecharam != null ? fecharam / topo : null });
  }
  return meses;
}

/** Leads (ou contatos, se o banco ainda não marca lead) por origem, no período. */
export function porOrigem({ contatos = [], negocios = [], estagios = [] }, { inicio, fim }) {
  const idFechado = acharEstagioFechado(estagios)?.id ?? null;
  const semMarcaDeLead = contatos.length > 0 && contatos.every((c) => c.leadEm === undefined);
  const base = contatos.filter((c) => dentro(semMarcaDeLead ? c.criadoEm : c.leadEm, inicio, fim));
  const negociosDe = new Map();
  for (const n of negocios) negociosDe.set(n.contactId, [...(negociosDe.get(n.contactId) || []), n]);
  const grupos = new Map();
  for (const c of base) {
    const origem = (c.origem || "").trim() || "Sem origem";
    const g = grupos.get(origem) || { origem, leads: 0, comNegocio: 0, ganhos: 0, valorGanho: 0 };
    g.leads += 1;
    const dele = negociosDe.get(c.id) || [];
    if (dele.length) g.comNegocio += 1;
    const ganhosDele = dele.filter((n) => foiGanho(n, idFechado));
    if (ganhosDele.length) g.ganhos += 1;
    g.valorGanho += ganhosDele.reduce((s, n) => s + (n.valor || 0), 0);
    grupos.set(origem, g);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, conversao: g.leads ? g.ganhos / g.leads : null }))
    .sort((a, b) => b.leads - a.leads || a.origem.localeCompare(b.origem));
}

/** Os leads que entraram no período, mais novos primeiro, com o que já têm no Funil. */
export function leadsDoPeriodo({ contatos = [], negocios = [], estagios = [] }, { inicio, fim }) {
  const idFechado = acharEstagioFechado(estagios)?.id ?? null;
  const nomeDaEtapa = new Map(estagios.map((e) => [e.id, e.nome]));
  const negociosDe = new Map();
  for (const n of negocios) negociosDe.set(n.contactId, [...(negociosDe.get(n.contactId) || []), n]);
  return contatos
    .filter((c) => dentro(c.leadEm, inicio, fim))
    .sort((a, b) => b.leadEm - a.leadEm)
    .map((c) => {
      const dele = (negociosDe.get(c.id) || []).sort((a, b) => b.criadoEm - a.criadoEm);
      const principal = dele[0];
      const situacao = !principal ? "Sem negócio"
        : principal.status === "perdido" ? "Perdido"
        : foiGanho(principal, idFechado) ? "Ganho"
        : nomeDaEtapa.get(principal.stageId) || "Em andamento";
      return { contato: c, negocios: dele.length, situacao, valor: dele.reduce((s, n) => s + (n.valor || 0), 0) };
    });
}

/** Variação contra o período anterior; nulo quando não há base para comparar. */
export function variacao(atual, anterior) {
  if (atual == null || anterior == null) return null;
  if (anterior === 0) return atual === 0 ? 0 : null;
  return (atual - anterior) / anterior;
}

/* ----------------------------------------------------------------- CSV */

const celula = (v) => {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Ponto e vírgula e BOM: é o que o Excel em português abre sem perguntar nada. */
export function paraCsv(cabecalho, linhas) {
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
}
