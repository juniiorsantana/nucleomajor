import { describe, expect, it } from "vitest";
import {
  caminhoDoGrafo,
  conexoesDoChatbot,
  NO_CONDICOES,
  NO_ENTRADA,
  SAIDA_PADRAO,
  topologiaDe,
  ultimoNoDoCaminho,
  validarGrafo,
} from "./chatbotGrafo";

const passos = [
  { id: "mensagem", tipo: "enviar_mensagem", texto: "Olá" },
  { id: "etiqueta", tipo: "editar_etiquetas", adicionar: [], remover: [] },
];

const ligar = (source, target) => ({ source, saida: SAIDA_PADRAO, target });

const caminhoValido = [
  ligar(NO_ENTRADA, NO_CONDICOES),
  ligar(NO_CONDICOES, "mensagem"),
  ligar("mensagem", "etiqueta"),
];

describe("topologia derivada", () => {
  it("chatbot sem conexões é linear por definição", () => {
    expect(topologiaDe(passos)).toEqual(caminhoValido);
  });

  it("a cadeia para no bloco terminal", () => {
    // O que vier depois de uma transferência já era inalcançável na v1 — o
    // executor parava ali. Encadear produziria um grafo que a validação recusa.
    const comTransferencia = [
      { id: "mensagem", tipo: "enviar_mensagem", texto: "Olá" },
      { id: "entrega", tipo: "transferir", destino: "humano" },
      { id: "orfao", tipo: "editar_etiquetas", adicionar: [], remover: [] },
    ];
    expect(topologiaDe(comTransferencia).map((c) => c.target)).toEqual([
      NO_CONDICOES,
      "mensagem",
      "entrega",
    ]);
  });

  it("prefere as conexões gravadas quando existem", () => {
    const chatbot = {
      passos,
      canvas: { versao: 2, nos: [], conexoes: [ligar(NO_ENTRADA, NO_CONDICOES)] },
    };
    expect(conexoesDoChatbot(chatbot)).toEqual([ligar(NO_ENTRADA, NO_CONDICOES)]);
  });

  it("completa a saída de uma conexão gravada antes das saídas nomeadas", () => {
    const chatbot = {
      passos,
      canvas: { versao: 1, nos: [], conexoes: [{ source: NO_ENTRADA, target: NO_CONDICOES }] },
    };
    expect(conexoesDoChatbot(chatbot)).toEqual([ligar(NO_ENTRADA, NO_CONDICOES)]);
  });

  it("cai no default linear quando o canvas não tem topologia", () => {
    expect(conexoesDoChatbot({ passos, canvas: { versao: 1, nos: [], conexoes: [] } })).toEqual(
      caminhoValido
    );
    expect(conexoesDoChatbot({ passos })).toEqual(caminhoValido);
  });
});

describe("travessia do grafo", () => {
  it("devolve os passos na ordem em que estão ligados", () => {
    const invertido = [
      ligar(NO_ENTRADA, NO_CONDICOES),
      ligar(NO_CONDICOES, "etiqueta"),
      ligar("etiqueta", "mensagem"),
    ];
    expect(caminhoDoGrafo(passos, invertido).map((p) => p.id)).toEqual(["etiqueta", "mensagem"]);
  });

  it("é equivalente à ordem do array num fluxo linear", () => {
    // A prova de que a v2 muda o modelo e não o comportamento: enquanto nada
    // ramifica, andar pelo grafo e iterar o array dão o mesmo caminho.
    expect(caminhoDoGrafo(passos, topologiaDe(passos))).toEqual(passos);
  });

  it("não entra em laço quando o grafo tem ciclo", () => {
    const ciclico = [...caminhoValido, ligar("etiqueta", "mensagem")];
    expect(caminhoDoGrafo(passos, ciclico).map((p) => p.id)).toEqual(["mensagem", "etiqueta"]);
  });

  it("para no bloco terminal", () => {
    const comTransferencia = [
      { id: "entrega", tipo: "transferir", destino: "ia" },
      { id: "depois", tipo: "enviar_mensagem", texto: "não alcança" },
    ];
    const conexoes = [
      ligar(NO_ENTRADA, NO_CONDICOES),
      ligar(NO_CONDICOES, "entrega"),
      ligar("entrega", "depois"),
    ];
    expect(caminhoDoGrafo(comTransferencia, conexoes).map((p) => p.id)).toEqual(["entrega"]);
  });
});

describe("validação do grafo", () => {
  it("aceita o caminho ligado e devolve a ordem", () => {
    const { ordem, erro } = validarGrafo(passos, caminhoValido);
    expect(erro).toBeNull();
    expect(ordem).toEqual(["mensagem", "etiqueta"]);
  });

  it("recusa bloco desconectado", () => {
    expect(validarGrafo(passos, caminhoValido.slice(0, 2)).erro).toMatch(/desconectado/);
  });

  it("recusa duas conexões saindo da mesma porta", () => {
    const bifurcado = [
      ligar(NO_ENTRADA, NO_CONDICOES),
      ligar(NO_CONDICOES, "mensagem"),
      ligar(NO_CONDICOES, "etiqueta"),
    ];
    expect(validarGrafo(passos, bifurcado).erro).toMatch(/apenas um bloco/);
  });

  it("recusa ciclo", () => {
    const ciclico = [...caminhoValido, ligar("etiqueta", "mensagem")];
    expect(validarGrafo(passos, ciclico).erro).toBeTruthy();
  });

  it("recusa conexão para bloco inexistente", () => {
    expect(validarGrafo(passos, [...caminhoValido, ligar("etiqueta", "fantasma")]).erro).toMatch(
      /inexistente/
    );
  });

  it("diz qual bloco não continua o fluxo, em vez de culpar a versão", () => {
    // A mensagem antiga era "cada saída pode seguir para apenas um bloco NESTA
    // VERSÃO" — culpava o produto por uma regra que é do tipo de bloco.
    const comTransferencia = [
      { id: "entrega", tipo: "transferir", destino: "humano" },
      { id: "depois", tipo: "enviar_mensagem", texto: "oi" },
    ];
    const conexoes = [
      ligar(NO_ENTRADA, NO_CONDICOES),
      ligar(NO_CONDICOES, "entrega"),
      ligar("entrega", "depois"),
    ];
    const { erro } = validarGrafo(comTransferencia, conexoes);
    expect(erro).toMatch(/Transferir conversa/);
    expect(erro).toMatch(/entrega a conversa e não continua/);
  });

  it("recusa saída que o bloco não tem", () => {
    const conexoes = [
      ligar(NO_ENTRADA, NO_CONDICOES),
      { source: NO_CONDICOES, saida: "nao", target: "mensagem" },
      ligar("mensagem", "etiqueta"),
    ];
    expect(validarGrafo(passos, conexoes).erro).toMatch(/porta que este bloco não tem/);
  });

  it("exige que Nova mensagem ligue direto em Condições", () => {
    const solto = [ligar(NO_CONDICOES, "mensagem"), ligar("mensagem", "etiqueta")];
    expect(validarGrafo(passos, solto).erro).toMatch(/Nova mensagem/);
  });
});

describe("fim do caminho", () => {
  it("acha o último nó ligado", () => {
    expect(ultimoNoDoCaminho(caminhoValido)).toBe("etiqueta");
  });

  it("devolve Condições quando não há nenhum passo ligado", () => {
    expect(ultimoNoDoCaminho([ligar(NO_ENTRADA, NO_CONDICOES)])).toBe(NO_CONDICOES);
  });
});
