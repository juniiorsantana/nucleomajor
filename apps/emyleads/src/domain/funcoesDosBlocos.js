/**
 * De que função do plano cada bloco, regra e gatilho do fluxo precisa (Etapa 10).
 *
 * Esta é a LISTA ÚNICA. Três lugares a respeitam:
 *
 *   * o editor: bloco não liberado aparece com cadeado e o motivo, e não entra
 *     no mapa;
 *   * o banco (`private.flow_block_requirements`, migrations 20261018100000 e
 *     20261018110000, que trouxe os `ajustes`):
 *     salvar um fluxo v3 que usa bloco não liberado é recusado, e a execução
 *     de uma empresa que perdeu a função sai pela Falha;
 *   * o runtime da VPS, que lê do banco o que cada passo exige (`requer` no
 *     envelope do claim) em vez de manter uma cópia.
 *
 * A cópia no banco é este mesmo JSON, e `funcoesDosBlocos.test.js` falha se as
 * duas divergirem. Mudou aqui, muda na migration.
 *
 * Toda função citada precisa existir no catálogo `platform_features`. Função
 * nova nasce desligada para todos (regra do catálogo, 20260924100000): um
 * bloco que passe a exigir uma chave nova fica com cadeado para todo mundo até
 * a Major ligar.
 *
 * O bloco de transferência vale por destino: `transferir:ia` passa a conversa
 * para o Claude, que é a Major pagando; `transferir:humano` é só chatbot.
 */

import { DESTINOS_TRANSFERENCIA, TIPOS_PASSO } from "./chatbots.js";

export const FUNCOES_DOS_BLOCOS = Object.freeze({
  blocos: Object.freeze({
    enviar_mensagem: "chatbots",
    editar_etiquetas: "chatbots",
    condicao: "chatbots",
    encerrar: "chatbots",
    perguntar: "chatbots",
    coletar: "chatbots",
    aguardar: "chatbots",
    "transferir:humano": "chatbots",
    "transferir:ia": "ai_customer",
  }),
  regras: Object.freeze({
    tem_etiqueta: "chatbots",
    estagio_atual: "chatbots",
    primeira_conversa: "chatbots",
    tarefa_atrasada: "chatbots",
    sem_interacao_ha: "chatbots",
    dia_da_semana: "chatbots",
    janela_de_horario: "chatbots",
  }),
  gatilhos: Object.freeze({
    mensagem: "chatbots",
    palavra: "chatbots",
    manual: "chatbots",
    etiqueta: "chatbots",
    etapa: "chatbots",
    campanha: "chatbots",
  }),
  // Etapa 9: uma opção de um bloco que depende do plano ("<tipo>:<campo>",
  // vale quando o campo é true). Tranca ao salvar, nunca ao rodar: a pergunta
  // de uma empresa que perdeu a IA segue com a escada de sempre.
  ajustes: Object.freeze({
    "perguntar:iaQuandoNaoEntende": "ai_customer",
  }),
});

/** As funções das opções ligadas no passo (o grupo `ajustes`). */
export function funcoesDosAjustes(passo) {
  return Object.entries(FUNCOES_DOS_BLOCOS.ajustes)
    .filter(([chave]) => {
      const [tipo, campo] = chave.split(":");
      return passo?.tipo === tipo && passo?.[campo] === true;
    })
    .map(([, funcao]) => funcao);
}

/** A pergunta pode usar a IA quando não entender? */
export const iaNoMenuLiberada = (recursos) =>
  funcaoLiberada(FUNCOES_DOS_BLOCOS.ajustes["perguntar:iaQuandoNaoEntende"], recursos);

/** Como cada função aparece no motivo do cadeado (o nome do catálogo). */
export const NOMES_DAS_FUNCOES = Object.freeze({
  chatbots: "Chatbots",
  ai_customer: "IA atendendo clientes",
});

/** `transferir:ia`, `transferir:humano` ou o próprio tipo. */
export function chaveDoBloco(passo) {
  if (passo?.tipo === TIPOS_PASSO.transferir) {
    const destino = passo.destino === DESTINOS_TRANSFERENCIA.ia ? DESTINOS_TRANSFERENCIA.ia : DESTINOS_TRANSFERENCIA.humano;
    return `${TIPOS_PASSO.transferir}:${destino}`;
  }
  return String(passo?.tipo || "");
}

/** A função de que o bloco precisa. Tipo desconhecido não é liberado por ninguém. */
export const funcaoDoBloco = (passo) => FUNCOES_DOS_BLOCOS.blocos[chaveDoBloco(passo)] || null;
export const funcaoDaRegra = (tipo) => FUNCOES_DOS_BLOCOS.regras[tipo] || null;
export const funcaoDoGatilho = (tipo) => FUNCOES_DOS_BLOCOS.gatilhos[tipo || "mensagem"] || null;

/** Só `true` explícito libera, como o resto do portal lê `recursos`. */
export const funcaoLiberada = (funcao, recursos) => Boolean(funcao) && recursos?.[funcao] === true;

/**
 * Por que este bloco (ou regra, ou gatilho) está trancado, ou `null`.
 * `funcao` nula quer dizer tipo desconhecido.
 */
export function motivoDoCadeado(funcao, recursos) {
  if (funcaoLiberada(funcao, recursos)) return null;
  if (!funcao) return "Este bloco não existe mais no construtor.";
  const nome = NOMES_DAS_FUNCOES[funcao] || funcao;
  return `Exige a função “${nome}”, que não está liberada para a sua empresa. Fale com a Major.`;
}

function regrasDaExpressao(expressao, profundidade = 0) {
  if (profundidade > 8 || expressao == null) return [];
  if (Array.isArray(expressao)) return expressao.flatMap((item) => regrasDaExpressao(item, profundidade + 1));
  if (typeof expressao !== "object") return [];
  if ("operador" in expressao) return regrasDaExpressao(expressao.itens, profundidade + 1);
  return [expressao.tipo];
}

/**
 * Todas as funções de que um fluxo precisa, em ordem de aparição, sem repetir.
 * Mesmo percurso de `private.flow_required_features`.
 */
export function funcoesDoFluxo(definicao) {
  const funcoes = [funcaoDoGatilho(definicao?.gatilho?.tipo)];
  for (const tipo of regrasDaExpressao(definicao?.condicoes)) funcoes.push(funcaoDaRegra(tipo));
  for (const passo of Array.isArray(definicao?.passos) ? definicao.passos : []) {
    funcoes.push(funcaoDoBloco(passo));
    funcoes.push(...funcoesDosAjustes(passo));
    if (passo?.tipo === TIPOS_PASSO.condicao)
      for (const tipo of regrasDaExpressao(passo.expressao)) funcoes.push(funcaoDaRegra(tipo));
  }
  return [...new Set(funcoes.filter(Boolean))];
}

/**
 * O que o banco diria ao salvar: `null` quando o plano libera tudo o que o
 * fluxo usa, ou o motivo do primeiro cadeado. Só vale para o formato com
 * caminhos (v3); o v2 continua no executor antigo até a Etapa 11.
 */
export function bloqueioDoFluxo(definicao, recursos) {
  if (Number(definicao?.canvas?.versao) !== 3) return null;
  for (const passo of Array.isArray(definicao?.passos) ? definicao.passos : []) {
    const funcao = funcaoDoBloco(passo);
    if (funcao && !funcaoLiberada(funcao, recursos))
      return `Este fluxo usa um bloco com cadeado. ${motivoDoCadeado(funcao, recursos)} Troque ou remova o bloco para salvar.`;
    const ajuste = funcoesDosAjustes(passo).find((item) => !funcaoLiberada(item, recursos));
    if (ajuste)
      return `Uma pergunta deste fluxo usa “Usar IA quando não entender”. ${motivoDoCadeado(ajuste, recursos)} Desmarque a opção para salvar.`;
  }
  const trancada = funcoesDoFluxo(definicao).find((funcao) => !funcaoLiberada(funcao, recursos));
  return trancada ? `Este fluxo usa uma regra com cadeado. ${motivoDoCadeado(trancada, recursos)}` : null;
}
