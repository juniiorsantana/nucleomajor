/**
 * O grafo do chatbot: quem liga em quem, e por qual saída.
 *
 * Mora em `domain/` e não junto do editor por uma razão dura: `data/` e
 * `content/` nunca importam de `page/` — é essa fronteira que mantém o service
 * worker vivo fora da aba. Enquanto a travessia morava em `page/telas/`, o
 * executor não tinha como andar pelo grafo nem se quisesse; ele iterava o
 * array `passos` porque era o único que alcançava.
 *
 * ## O que muda na versão 2
 *
 * Na v1, `passos` guardava conteúdo E ordem, enquanto `canvas.conexoes`
 * guardava topologia. Duas fontes de verdade para a mesma coisa, sustentadas
 * só porque ramificação era proibida e a ordem linear era gravada de volta no
 * array ao salvar.
 *
 * Na v2 a topologia manda, e `passos` é um saco de blocos. Duas mudanças
 * pequenas no dado compram isso:
 *
 * 1. **saídas nomeadas** — a conexão passa a ser `{ source, saida, target }`.
 *    Hoje `saida` é sempre `padrao`; sem o campo, um bloco de duas saídas não
 *    teria como dizer qual aresta é a do "sim" e qual é a do "não", e
 *    acrescentá-lo depois custaria outra migração;
 * 2. **aridade por tipo de bloco** — no lugar da regra global "cada saída
 *    segue para apenas um bloco nesta versão", cada tipo declara as saídas que
 *    tem. É por essa costura que um futuro bloco de condição entra sem tocar
 *    no validador.
 *
 * O comportamento não muda. Nenhum bloco ramifica ainda, então andar pelo
 * grafo produz exatamente o mesmo caminho que iterar o array — e é isso que os
 * testes de equivalência verificam.
 */

import { saidasDoPasso, TIPOS_PASSO } from "./chatbots.js";

export const NO_ENTRADA = "entrada";
export const NO_CONDICOES = "condicoes";

export const VERSAO_CANVAS = 2;

/** A saída única de um bloco que não ramifica. */
export const SAIDA_PADRAO = "padrao";

export const idConexao = (source, target, saida = SAIDA_PADRAO) =>
  `conexao:${source}:${saida}:${target}`;

/** Nós fixos do fluxo: existem sempre, não são passos e não se apagam. */
const FIXOS = new Set([NO_ENTRADA, NO_CONDICOES]);

/**
 * As saídas de um nó qualquer — fixo ou bloco.
 *
 * `null` significa "não sei quem é esse nó", que é diferente de "não tem
 * saída". Confundir os dois faria uma conexão órfã passar por terminal.
 */
export function saidasDoNo(id, porId) {
  if (FIXOS.has(id)) return [SAIDA_PADRAO];
  const passo = porId.get(id);
  return passo ? saidasDoPasso(passo) : null;
}

/** Normaliza uma conexão gravada antes das saídas nomeadas. */
const comSaida = (conexao) => ({
  source: conexao.source,
  saida: conexao.saida || SAIDA_PADRAO,
  target: conexao.target,
});

/**
 * A topologia de um chatbot que não tem nenhuma.
 *
 * **Chatbot sem conexões é linear por definição** — a ordem do array vira a
 * cadeia. Isso não é ambiguidade tolerada: é o default do modelo, numa função
 * só, usada tanto ao ler um registro da v1 quanto ao criar um chatbot novo em
 * código. Um registro antigo continua funcionando, e o primeiro salvamento no
 * editor o grava já canônico.
 *
 * A cadeia **para no primeiro bloco terminal**. Bloco sem saída não liga em
 * nada, e o que vier depois dele no array já era inalcançável na v1 — o
 * executor parava ali do mesmo jeito. Encadear assim mesmo produziria um grafo
 * que a própria validação recusaria.
 */
export function topologiaDe(passos = []) {
  const conexoes = [{ source: NO_ENTRADA, saida: SAIDA_PADRAO, target: NO_CONDICOES }];
  let anterior = NO_CONDICOES;

  for (const passo of passos) {
    conexoes.push({ source: anterior, saida: SAIDA_PADRAO, target: passo.id });
    if (!saidasDoPasso(passo).length) break;
    anterior = passo.id;
  }

  return conexoes;
}

/**
 * As conexões de um chatbot, venham elas do canvas ou do default linear.
 *
 * É por aqui que todo mundo lê topologia: o executor, o editor e a validação.
 * Um lugar só decidindo o que fazer com registro antigo é o que impede a v1 e
 * a v2 de conviverem como dois formatos que cada camada interpreta do seu
 * jeito.
 */
export function conexoesDoChatbot(chatbot) {
  const gravadas = chatbot?.canvas?.conexoes;
  if (!Array.isArray(gravadas) || !gravadas.length) return topologiaDe(chatbot?.passos || []);
  return gravadas.map(comSaida);
}

/**
 * Percorre o caminho a partir das condições e devolve os passos em ordem.
 *
 * Só a saída `padrao` por enquanto — é a única que existe. Quando um bloco
 * ramificar, esta função ganha o argumento que diz qual saída seguir; quem
 * chama hoje não precisa saber disso.
 */
export function caminhoDoGrafo(passos = [], conexoes = []) {
  const porId = new Map(passos.map((passo) => [passo.id, passo]));
  const saidas = new Map(
    conexoes.map(comSaida).map((c) => [`${c.source}:${c.saida}`, c.target])
  );

  const ordem = [];
  const vistos = new Set([NO_ENTRADA, NO_CONDICOES]);
  let atual = saidas.get(`${NO_CONDICOES}:${SAIDA_PADRAO}`);

  while (atual && porId.has(atual) && !vistos.has(atual)) {
    vistos.add(atual);
    const passo = porId.get(atual);
    ordem.push(passo);
    // A aridade vale aqui, e não só na validação. Um grafo malformado — com
    // aresta saindo de um bloco terminal — não pode fazer o executor seguir
    // adiante; a barreira mora em quem executa, não em quem avisa.
    if (!saidasDoPasso(passo).length) break;
    atual = saidas.get(`${atual}:${SAIDA_PADRAO}`);
  }

  return ordem;
}

/**
 * O grafo está bem formado?
 *
 * Devolve `{ ordem, passos, erro }` — `erro` em português, porque quem lê é o
 * operador montando o fluxo, não o código.
 */
export function validarGrafo(passos = [], conexoes = []) {
  const porId = new Map(passos.map((passo) => [passo.id, passo]));
  const idsPassos = new Set(porId.keys());
  const normalizadas = conexoes.map(comSaida);

  const saidas = new Map();
  const entradas = new Map();

  for (const conexao of normalizadas) {
    const { source, saida, target } = conexao;
    const disponiveis = saidasDoNo(source, porId);

    if (disponiveis === null || (!FIXOS.has(target) && !idsPassos.has(target)))
      return { erro: "Existe uma conexão apontando para um bloco inexistente." };
    if (source === target) return { erro: "Um bloco não pode ser conectado nele mesmo." };

    // Aridade por tipo: a mensagem diz qual bloco não comporta a conexão, e
    // não que "esta versão" não comporta. A diferença importa no dia em que um
    // bloco passar a comportar.
    if (!disponiveis.length) {
      const nome = porId.get(source);
      return {
        erro: `O bloco “${TITULO_CURTO(nome)}” entrega a conversa e não continua o fluxo. Remova a conexão que sai dele.`,
      };
    }
    if (!disponiveis.includes(saida))
      return { erro: "Existe uma conexão saindo de uma porta que este bloco não tem." };

    const chaveSaida = `${source}:${saida}`;
    if (saidas.has(chaveSaida))
      return { erro: "Cada saída pode seguir para apenas um bloco." };
    if (entradas.has(target))
      return { erro: "Cada bloco pode receber apenas uma conexão." };

    saidas.set(chaveSaida, target);
    entradas.set(target, source);
  }

  const daEntrada = saidas.get(`${NO_ENTRADA}:${SAIDA_PADRAO}`);
  if (daEntrada !== NO_CONDICOES || entradas.get(NO_CONDICOES) !== NO_ENTRADA)
    return { erro: "Conecte ‘Nova mensagem’ diretamente a ‘Condições’." };
  if (entradas.has(NO_ENTRADA))
    return { erro: "O bloco ‘Nova mensagem’ não pode ter uma entrada." };

  const ordem = [];
  const vistos = new Set([NO_ENTRADA, NO_CONDICOES]);
  let atual = saidas.get(`${NO_CONDICOES}:${SAIDA_PADRAO}`);
  while (atual) {
    if (!idsPassos.has(atual)) return { erro: "O caminho contém uma conexão inválida." };
    if (vistos.has(atual)) return { erro: "O fluxo não pode conter ciclos." };
    vistos.add(atual);
    ordem.push(atual);
    atual = saidas.get(`${atual}:${SAIDA_PADRAO}`);
  }

  if (ordem.length !== passos.length) {
    const faltantes = passos.length - ordem.length;
    return {
      erro: `${faltantes} bloco${faltantes === 1 ? " está" : "s estão"} desconectado${faltantes === 1 ? "" : "s"}. Conecte todas as entradas e saídas.`,
    };
  }
  if (normalizadas.length !== ordem.length + 1)
    return { erro: "Remova conexões que não fazem parte do caminho principal." };

  return { ordem, passos: ordem.map((id) => porId.get(id)), erro: null };
}

/** Nome curto de um bloco para caber numa mensagem de erro. */
const TITULO_CURTO = (passo) =>
  ({
    [TIPOS_PASSO.enviarMensagem]: "Enviar mensagem",
    [TIPOS_PASSO.editarEtiquetas]: "Etiquetas",
    [TIPOS_PASSO.transferir]: "Transferir conversa",
  })[passo?.tipo] || "bloco";

/**
 * O fim do caminho ligado — onde o editor pendura um bloco novo.
 *
 * Para no primeiro nó cuja saída padrão está livre. Um bloco terminal também
 * tem a saída livre, no sentido de não estar ocupada; quem decide se dá para
 * pendurar ali é o editor, consultando a aridade.
 */
export function ultimoNoDoCaminho(conexoes = []) {
  const saidas = new Map(
    conexoes.map(comSaida).map((c) => [`${c.source}:${c.saida}`, c.target])
  );
  const vistos = new Set();
  let atual = NO_CONDICOES;

  while (saidas.has(`${atual}:${SAIDA_PADRAO}`) && !vistos.has(atual)) {
    vistos.add(atual);
    atual = saidas.get(`${atual}:${SAIDA_PADRAO}`);
  }
  return atual;
}
