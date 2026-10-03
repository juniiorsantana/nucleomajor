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
  VERSAO_CANVAS_RAMIFICADO,
} from "../../domain/chatbotGrafo";

export { NO_ENTRADA, NO_CONDICOES, VERSAO_CANVAS, VERSAO_CANVAS_RAMIFICADO, idConexao };

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
export function criarGrafoInicial(passos = [], canvas = null, { ramificado = false } = {}) {
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

  // Abrir um fluxo antigo no formato com caminhos: o retorno e a falha da IA
  // eram IDs escondidos no bloco (`retornoPassoId`, `falhaPassoId`). Aqui eles
  // viram as ligações das saídas "Sucesso" e "Falha", visíveis no mapa — o
  // canvas passa a ser a única fonte de para onde a conversa vai (ADR-0006).
  if (ramificado) {
    for (const passo of passos) {
      for (const [saida, campo] of [["sucesso", "retornoPassoId"], ["falha", "falhaPassoId"]]) {
        const alvo = passo[campo];
        const ocupada = conexoes.some((c) => c.source === passo.id && (c.saida || SAIDA_PADRAO) === saida);
        if (alvo && ids.has(alvo) && alvo !== passo.id && !ocupada)
          conexoes.push({ source: passo.id, saida, target: alvo });
      }
    }
  }

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

/**
 * Esta ligação pode existir?
 *
 * Vale para o arraste e para a reconexão, e é o que impede o mapa de mostrar
 * um desenho que o salvamento recusaria. `ramificado` troca a regra do v2
 * ("cada bloco tem uma entrada e uma saída") pela do v3: cada SAÍDA segue para
 * um bloco só, mas um bloco pode receber vários caminhos — é a convergência.
 * Ciclo continua proibido nos dois.
 */
export function conexaoPermitida(conexoes, nova, { ramificado = false, ignorarId = null } = {}) {
  const { source, target } = nova;
  const saida = nova.saida || nova.sourceHandle || SAIDA_PADRAO;
  if (!source || !target || source === target || target === NO_ENTRADA) return false;
  if (source === NO_ENTRADA && target !== NO_CONDICOES) return false;
  if (target === NO_CONDICOES && source !== NO_ENTRADA) return false;

  const outras = conexoes.filter((item) => item.id !== ignorarId);
  const saidaDe = (item) => item.saida || item.sourceHandle || SAIDA_PADRAO;
  if (ramificado) {
    if (outras.some((item) => item.source === source && saidaDe(item) === saida)) return false;
  } else if (outras.some((item) => item.source === source || item.target === target)) {
    return false;
  }

  // Se do destino já se chega à origem, a ligação fecharia um ciclo.
  const vizinhos = new Map();
  for (const item of outras) vizinhos.set(item.source, [...(vizinhos.get(item.source) || []), item.target]);
  const pilha = [target];
  const vistos = new Set();
  while (pilha.length) {
    const atual = pilha.pop();
    if (atual === source) return false;
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    pilha.push(...(vizinhos.get(atual) || []));
  }
  return true;
}

/**
 * Posições em colunas: cada bloco fica uma coluna depois do seu antecessor
 * mais distante, e os blocos de uma mesma coluna se empilham. Num fluxo
 * linear isso dá a mesma fileira de antes; num ramificado, "Sim" e "Não"
 * ficam um sobre o outro em vez de se atropelarem.
 */
export function posicoesEmColunas(ids = [], conexoes = []) {
  const coluna = new Map(ids.map((id) => [id, 0]));
  // Relaxa as arestas até estabilizar: o grafo é acíclico, então para em
  // no máximo `ids.length` voltas. O limite protege de um desenho com ciclo.
  for (let volta = 0; volta < ids.length; volta += 1) {
    let mudou = false;
    for (const { source, target } of conexoes) {
      if (!coluna.has(source) || !coluna.has(target)) continue;
      if (coluna.get(target) < coluna.get(source) + 1) {
        coluna.set(target, coluna.get(source) + 1);
        mudou = true;
      }
    }
    if (!mudou) break;
  }
  const porColuna = new Map();
  const posicoes = new Map();
  for (const id of ids) {
    const c = coluna.get(id);
    const linha = porColuna.get(c) || 0;
    porColuna.set(c, linha + 1);
    posicoes.set(id, { x: 72 + c * 380, y: 150 + linha * 250 });
  }
  return posicoes;
}

/** Só posição e topologia: o resto é derivado e não precisa ser guardado. */
export function serializarCanvas(nos = [], conexoes = [], versao = VERSAO_CANVAS) {
  return {
    versao,
    nos: nos.map((no) => ({ id: no.id, x: no.position.x, y: no.position.y })),
    conexoes: conexoes.map(({ source, saida, target }) => ({
      source,
      saida: saida || SAIDA_PADRAO,
      target,
    })),
  };
}
