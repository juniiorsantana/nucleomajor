/**
 * Adaptador entre o grafo do chatbot e o React Flow.
 *
 * O modelo — travessia, validação, saídas, migração — mora em
 * `domain/chatbotGrafo.js`. Aqui fica só o que é da biblioteca: nó com
 * `position` e `type`, e a serialização do que vale a pena persistir.
 *
 * A separação não é estética. `data/` e `content/` nunca importam de `page/`, e
 * é essa fronteira que mantém o service worker vivo fora da aba. Enquanto a
 * travessia morava neste arquivo, o executor não tinha como alcançá-la.
 */

import {
  conexoesDoChatbot,
  idConexao,
  NO_CONDICOES,
  NO_ENTRADA,
  SAIDA_PADRAO,
  VERSAO_CANVAS,
} from "../../domain/chatbotGrafo";

export { NO_ENTRADA, NO_CONDICOES, VERSAO_CANVAS, idConexao };

const posicaoPadrao = (indice) => ({
  x: 72 + indice * 380,
  y: indice % 2 === 0 ? 176 : 244,
});

/**
 * Monta o grafo que o React Flow desenha.
 *
 * A topologia vem de `conexoesDoChatbot`, que é quem sabe ler tanto um canvas
 * v2 quanto um registro antigo — um chatbot sem conexões é linear por
 * definição. É aqui que a migração acontece na prática: o fluxo antigo abre
 * como cadeia, e o primeiro salvamento o grava canônico.
 */
export function criarGrafoInicial(passos = [], canvas = null) {
  const posicoes = new Map((canvas?.nos || []).map((no) => [no.id, { x: no.x, y: no.y }]));
  const nos = [
    {
      id: NO_ENTRADA,
      type: "entrada",
      position: posicoes.get(NO_ENTRADA) || posicaoPadrao(0),
      deletable: false,
      data: {},
    },
    {
      id: NO_CONDICOES,
      type: "condicoes",
      position: posicoes.get(NO_CONDICOES) || posicaoPadrao(1),
      deletable: false,
      data: {},
    },
    ...passos.map((passo, indice) => ({
      id: passo.id,
      type: "acao",
      position: posicoes.get(passo.id) || posicaoPadrao(indice + 2),
      data: { passoId: passo.id },
    })),
  ];

  const ids = new Set(nos.map((no) => no.id));
  const conexoes = conexoesDoChatbot({ passos, canvas }).filter(
    (conexao) => ids.has(conexao.source) && ids.has(conexao.target)
  );

  return {
    nos,
    conexoes: conexoes.map(({ source, saida, target }) => ({
      id: idConexao(source, target, saida),
      source,
      saida,
      target,
    })),
  };
}

/** Só posição e topologia: o resto é derivado e não precisa ser guardado. */
export function serializarCanvas(nos = [], conexoes = []) {
  return {
    versao: VERSAO_CANVAS,
    nos: nos.map((no) => ({ id: no.id, x: no.position.x, y: no.position.y })),
    conexoes: conexoes.map(({ source, saida, target }) => ({
      source,
      saida: saida || SAIDA_PADRAO,
      target,
    })),
  };
}
