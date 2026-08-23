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

    default:
      return false;
  }
}

export function regraAtende(regra, contexto) {
  if (!regra.condicoes || regra.condicoes.length === 0) return false;
  return regra.condicoes.every((condicao) => avaliarCondicao(condicao, contexto));
}

export function regrasAtendidas(regras, contexto) {
  return regras.filter((regra) => regra.ativo !== false && regraAtende(regra, contexto));
}
