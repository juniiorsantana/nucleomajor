/**
 * Motor puro de condições dos chatbots.
 *
 * Nada aqui conhece IndexedDB, WhatsApp ou React. O provider carrega a ficha
 * e os chatbots persistidos; este módulo apenas decide se as condições
 * atendem.
 */

import { tarefaAtrasada } from "./types.js";

export const TIPOS_CONDICAO = {
  temEtiqueta: "tem_etiqueta",
  estagioAtual: "estagio_atual",
  primeiraConversa: "primeira_conversa",
  tarefaAtrasada: "tarefa_atrasada",
  semInteracaoHa: "sem_interacao_ha",
  diaDaSemana: "dia_da_semana",
  janelaDeHorario: "janela_de_horario",
};

/**
 * Os fusos que uma regra de horário aceita — os do Brasil, lista fechada.
 *
 * O fuso mora NA regra, e não no ambiente: o mesmo fluxo é avaliado no
 * navegador (fuso de quem abriu) e na VPS (UTC), e "são 8h?" tem de dar a
 * mesma resposta nos dois. Lista fechada porque o banco confere a mesma lista
 * sem poder consultar o catálogo de fusos numa função imutável.
 */
export const FUSOS_DO_BRASIL = [
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Fortaleza",
  "America/Recife",
  "America/Maceio",
  "America/Belem",
  "America/Araguaina",
  "America/Santarem",
  "America/Manaus",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco",
  "America/Eirunepe",
  "America/Noronha",
];
export const FUSO_PADRAO = "America/Sao_Paulo";

/** Domingo = 0, como `Date#getDay`. O mesmo número vale no Python e no banco. */
export const DIAS_DA_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const horaValida = (valor) => HORA.test(String(valor || ""));
const minutosDe = (hora) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/** Dia da semana e minuto do dia de um instante, no relógio de um fuso. */
export function relogioNoFuso(agora, fuso) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(agora));
  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(valor("weekday"));
  return { dia, minutos: Number(valor("hour")) * 60 + Number(valor("minute")) };
}

/**
 * Está dentro da janela? `fim` menor que `inicio` é janela que vira a noite
 * (22:00–06:00). Início e fim iguais não é janela — a validação recusa.
 */
export function dentroDaJanela(minutos, inicio, fim) {
  const de = minutosDe(inicio);
  const ate = minutosDe(fim);
  return de < ate ? minutos >= de && minutos < ate : minutos >= de || minutos < ate;
}

export const OPERADORES_LOGICOS = {
  e: "e",
  ou: "ou",
};

const UM_DIA_MS = 24 * 60 * 60 * 1000;

const EVENTOS_DE_IDENTIDADE = new Set([
  "contact.created",
  "contact.imported",
  "contact.whatsapp_linked",
]);

const negocioAberto = (negocios = []) =>
  negocios.find((n) => n.status === "aberto") || negocios[0] || null;

const recenciaDoContato = (contato) =>
  contato?.ultimaEm ?? contato?.atualizadoEm ?? contato?.criadoEm ?? null;

export function avaliarCondicao(condicao, contexto) {
  const { contato, negocios = [], tarefas = [], eventos = [], agora = Date.now() } = contexto;

  switch (condicao.tipo) {
    case TIPOS_CONDICAO.temEtiqueta:
      return Boolean(contato?.tags?.includes(condicao.etiquetaId));

    case TIPOS_CONDICAO.estagioAtual: {
      const aberto = negocioAberto(negocios);
      return Boolean(aberto && aberto.stageId === condicao.stageId);
    }

    case TIPOS_CONDICAO.primeiraConversa:
      return eventos.length > 0 && eventos.every((e) => EVENTOS_DE_IDENTIDADE.has(e.tipo));

    case TIPOS_CONDICAO.tarefaAtrasada:
      return tarefas.some((t) => tarefaAtrasada(t, agora));

    case TIPOS_CONDICAO.semInteracaoHa: {
      const recencia = recenciaDoContato(contato);
      if (recencia == null) return false;
      return agora - recencia >= condicao.dias * UM_DIA_MS;
    }

    // Regra malformada ou fuso desconhecido responde "não", nunca lança: o
    // fluxo segue pelo Não em vez de parar a conversa.
    case TIPOS_CONDICAO.diaDaSemana: {
      if (!FUSOS_DO_BRASIL.includes(condicao.fuso) || !Array.isArray(condicao.dias)) return false;
      return condicao.dias.includes(relogioNoFuso(agora, condicao.fuso).dia);
    }

    case TIPOS_CONDICAO.janelaDeHorario: {
      if (!FUSOS_DO_BRASIL.includes(condicao.fuso)) return false;
      if (!horaValida(condicao.inicio) || !horaValida(condicao.fim) || condicao.inicio === condicao.fim) return false;
      return dentroDaJanela(relogioNoFuso(agora, condicao.fuso).minutos, condicao.inicio, condicao.fim);
    }

    default:
      return false;
  }
}

export function avaliarExpressao(expressao, contexto, profundidade = 0) {
  if (profundidade > 8) return false;
  if (Array.isArray(expressao)) {
    return expressao.length > 0
      && expressao.every((item) => avaliarExpressao(item, contexto, profundidade + 1));
  }
  if (!expressao || typeof expressao !== "object") return false;
  if (!Object.hasOwn(expressao, "operador")) return avaliarCondicao(expressao, contexto);
  if (!Array.isArray(expressao.itens) || expressao.itens.length === 0) return false;
  if (expressao.operador === OPERADORES_LOGICOS.e)
    return expressao.itens.every((item) => avaliarExpressao(item, contexto, profundidade + 1));
  if (expressao.operador === OPERADORES_LOGICOS.ou)
    return expressao.itens.some((item) => avaliarExpressao(item, contexto, profundidade + 1));
  return false;
}

export function regraAtende(regra, contexto) {
  return avaliarExpressao(regra.condicoes, contexto);
}

export function regrasAtendidas(regras, contexto) {
  return regras.filter((regra) => regra.ativo !== false && regraAtende(regra, contexto));
}
