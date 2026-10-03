// A Avaliação do vendedor v2 (migration 20261008100000): a nota única do
// atendimento, que critica o trabalho do vendedor. Só arrumação para a tela:
// nota, faixa, cobertura, estados e pontos vêm prontos do banco
// (relatório analysis.v2); a crítica e a reescrita vêm do Analista
// (analysis_report.v2).

import { ROTULO_DO_ESTADO, TOM_DO_ESTADO, semNumerosInternos } from "./analiseDaConversa.js";

export const RELATORIO_V2 = "analysis_report.v2";

/** O diagnóstico no formato da v2. */
export const ehRelatorioV2 = (resultado) => resultado?.schema_version === RELATORIO_V2;

/** O relatório agregado da v2, montado pelo banco. */
export const ehAnaliseV2 = (relatorio) => relatorio?.schema_version === "analysis.v2";

/** Os 9 pontos de um bom vendedor: o nome da tela e o livro de onde vem. */
export const PONTOS_DO_VENDEDOR = {
  advance: { nome: "Avanço com data", fonte: "SPIN Selling · Rackham" },
  diagnosis: { nome: "Diagnóstico", fonte: "SPIN Selling · Gap Selling" },
  objection: { nome: "Trata objeção", fonte: "Never Split the Difference · Voss" },
  leads: { nome: "Ensina e conduz", fonte: "The Challenger Sale" },
  close: { nome: "Pede o fechamento", fonte: "Secrets of Closing the Sale · Ziglar" },
  follow_up: { nome: "Follow-up", fonte: "Fanatical Prospecting · Blount" },
  speed: { nome: "Velocidade", fonte: "Harvard Business Review, 2011" },
  empathy: { nome: "Escuta e empatia", fonte: "Never Split the Difference · Voss" },
  promises: { nome: "Cumpre o que promete", fonte: "Influence · Cialdini" },
};

// O estado de negócio diz mais que "crítico" ou "bom" nestes pontos.
const ROTULO_DO_VALOR = {
  advance: {
    fechou: "Fechou",
    compromisso_com_data: "Avançou com data",
    propos_com_data: "Propôs com data",
    compromisso_sem_data: "Avançou sem data",
    continuacao: "Ficou em aberto",
    desqualificado_com_motivo: "Desqualificado",
  },
  promises: { cumpriu: "Cumpriu", cumpriu_com_atraso: "Cumpriu atrasado", vencida_sem_entrega: "Não cumpriu" },
};

/** As faixas da nota, com o tom da cor. */
export const FAIXAS = {
  vendeu_bem: { rotulo: "Vendeu bem", tom: "success" },
  nao_fecha: { rotulo: "Atende, mas não fecha", tom: "warning" },
  atrapalhou: { rotulo: "Atrapalhou a venda", tom: "danger" },
};

export const ROTULO_DO_ALERTA_V2 = {
  conversation_left_open: "Terminou sem compromisso com data",
  broken_promise: "Promessa não cumprida",
  overdue_follow_up: "Ninguém voltou a chamar",
  playbook_violation: "Fora do playbook",
  premature_solution: "Ofereceu antes de entender",
  critical_information_ignored: "Informação importante ignorada",
};

export const nomeDoPonto = (ponto) => PONTOS_DO_VENDEDOR[ponto?.key]?.nome || ponto?.name || ponto?.key || "";

/** "Ficou em aberto", "Atenção", "Não avaliado". */
export function rotuloDoPonto(ponto) {
  if (!ponto) return "";
  if (ponto.status === "nao_avaliado" || ponto.points_awarded == null) return ROTULO_DO_ESTADO.nao_avaliado;
  return ROTULO_DO_VALOR[ponto.key]?.[ponto.state] || ROTULO_DO_ESTADO[ponto.status] || ponto.status;
}

export const tomDoPonto = (ponto) => (ponto?.points_awarded == null ? "faint" : TOM_DO_ESTADO[ponto.status] || "faint");

const perdidos = (p) => Number(p.weight) - Number(p.points_awarded);

/**
 * Do que mais custou ao que foi bem: primeiro quem perdeu mais pontos; os não
 * avaliados no fim, do maior peso para o menor.
 */
export function pontosEmOrdem(pontos = []) {
  const avaliados = pontos.filter((p) => p.points_awarded != null);
  const fora = pontos.filter((p) => p.points_awarded == null);
  return [
    ...avaliados.sort((a, b) => perdidos(b) - perdidos(a) || Number(b.weight) - Number(a.weight)),
    ...fora.sort((a, b) => Number(b.weight) - Number(a.weight)),
  ];
}

const numero = (valor) =>
  Number.isInteger(Number(valor)) ? String(Number(valor)) : Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** "8,4 / 14", ou "—" quando o ponto não foi avaliado (nunca zero). */
export function pontosEmTexto(ponto) {
  if (!ponto || ponto.points_awarded == null) return "—";
  return `${numero(ponto.points_awarded)} / ${numero(ponto.weight)}`;
}

/** "39,2 ÷ 88 = 45": a conta da nota, com o que a tabela mostra. */
export function contaDoVendedor(nota) {
  const avaliados = (nota?.criteria || []).filter((p) => p.points_awarded != null);
  const pontos = Math.round(avaliados.reduce((soma, p) => soma + Number(p.points_awarded), 0) * 10) / 10;
  const peso = Number(nota?.evaluated_weight) || 0;
  return { pontos, peso, texto: nota?.score == null ? "" : `${numero(pontos)} ÷ ${numero(peso)} = ${nota.score}` };
}

/**
 * A faixa que a tela mostra. Nota não conclusiva (menos de 50% avaliado)
 * não ganha faixa: diz que ainda não dá para julgar.
 */
export function faixaDaNota(nota) {
  if (!nota || nota.score == null) return { rotulo: "Ainda não avaliável", tom: "faint", conclusiva: false };
  if (!nota.conclusive) return { rotulo: "Não conclusiva", tom: "faint", conclusiva: false };
  return { ...(FAIXAS[nota.band] || { rotulo: nota.band_label || "", tom: "faint" }), conclusiva: true };
}

/** Quem atendeu, com a explicação quando é o vendedor geral. */
export function vendedorEmTexto(vendedor) {
  if (!vendedor?.label) return { nome: "Sem resposta da empresa", nota: "" };
  if (vendedor.kind === "equipe") {
    return {
      nome: "Equipe · pelo celular",
      nota: "As mensagens saíram direto do WhatsApp, sem dizer quem escreveu. A nota conta para o vendedor geral da conta.",
    };
  }
  if (vendedor.kind === "ia") return { nome: "IA", nota: "Quem respondeu foi o agente de IA." };
  return { nome: vendedor.label, nota: "" };
}

// Até 03/10/2026 (20261009100000) o banco parava de contar em 241 minutos:
// nas análises dessa época, 241 em estado crítico quer dizer "mais de 4 h".
const TETO_ANTIGO = 241;

/** "12 min", "4 h", "12 h 30 min" (minutos de horário comercial). */
export function duracaoUtil(minutos) {
  const total = Math.max(0, Math.round(Number(minutos) || 0));
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** A velocidade da primeira resposta, em tempo de horário comercial. */
export function velocidadeEmTexto(velocidade) {
  if (!velocidade) return "";
  const antigo = (m) => m === TETO_ANTIGO && velocidade.state === "critico";
  const minutos = velocidade.firstResponseBusinessMinutes;
  if (minutos != null) {
    if (minutos < 1) return "Primeira resposta em menos de 1 minuto.";
    if (antigo(minutos)) return "Primeira resposta depois de mais de 4 h de horário comercial.";
    return `Primeira resposta em ${duracaoUtil(minutos)} de horário comercial.`;
  }
  const espera = velocidade.waitingBusinessMinutes;
  if (espera != null) {
    return antigo(espera)
      ? "O cliente espera a primeira resposta há mais de 4 h de horário comercial."
      : `O cliente espera a primeira resposta há ${duracaoUtil(espera)} de horário comercial.`;
  }
  return "";
}

/**
 * A linha do tempo com legenda só no que mais importa: o que custou a venda,
 * o principal gargalo e os alertas. A v2 cita muitas mensagens (uma por ponto,
 * mais o que fez bem); com legenda em todas, os textos se atropelam. O ponto
 * de cada mensagem continua lá, clicável.
 */
export function linhaDoVendedor(timeline, diagnostico, alertas = []) {
  if (!timeline?.messages) return timeline;
  const ids = new Set(
    [
      ...(diagnostico?.cost_the_sale || []).flatMap((item) => item.evidence_message_ids || []),
      ...(diagnostico?.main_bottleneck?.evidence_message_ids || []),
      ...alertas.flatMap((alerta) => alerta.evidence_message_ids || []),
    ].filter(Boolean)
  );
  return { ...timeline, messages: timeline.messages.map((m) => (m.snippet && !ids.has(m.id) ? { ...m, snippet: null } : m)) };
}

/** O que a tela diz de um ponto sem crítica do Analista. */
export function criticaDoPonto(ponto) {
  const critica = semNumerosInternos(ponto?.critique);
  if (critica) return critica;
  if (ponto?.points_awarded != null) return "";
  if (ponto?.key === "close") return "O cliente não deu sinal de compra. Não conta contra.";
  if (ponto?.key === "speed") return "A conversa foi começada pela empresa, ou o cliente ainda está dentro do prazo.";
  if (ponto?.key === "objection") return "O cliente não fez objeção.";
  if (ponto?.key === "promises") return "Nenhuma promessa vencida para avaliar.";
  return "A conversa não mostra isso. Não conta contra.";
}

/** O resumo em texto para colar no WhatsApp ou num e-mail. */
export function resumoDoVendedorParaCopiar({ nome, relatorio }) {
  const nota = relatorio?.vendedor_score;
  const diagnostico = relatorio?.diagnosis || {};
  const faixa = faixaDaNota(nota);
  const linhas = [`Avaliação do vendedor${nome ? ` · ${nome}` : ""}`];
  if (nota?.score != null) linhas.push(`Nota: ${nota.score}/100 · ${faixa.rotulo} · ${nota.coverage}% avaliado`);
  const quem = vendedorEmTexto(relatorio?.seller).nome;
  if (quem) linhas.push(`Quem atendeu: ${quem}`);
  if (diagnostico.verdict) linhas.push("", semNumerosInternos(diagnostico.verdict));
  const bem = (diagnostico.did_well || []).map((item) => `+ ${semNumerosInternos(item.title)}`);
  const custou = (diagnostico.cost_the_sale || []).map((item) => `- ${semNumerosInternos(item.title)}`);
  if (bem.length) linhas.push("", "O que fez bem:", ...bem);
  if (custou.length) linhas.push("", "O que custou a venda:", ...custou);
  const acao = (diagnostico.what_to_do_now || [])[0];
  if (acao?.title) linhas.push("", `O que fazer agora: ${semNumerosInternos(acao.title)}`);
  return linhas.join("\n");
}
