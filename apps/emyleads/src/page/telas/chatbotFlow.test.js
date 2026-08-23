import { describe, expect, it } from "vitest";
import { NO_CONDICOES, NO_ENTRADA } from "../../domain/chatbotGrafo";
import { criarGrafoInicial, serializarCanvas } from "./chatbotFlow";

const passos = [
  { id: "mensagem", tipo: "enviar_mensagem", texto: "Olá" },
  { id: "etiqueta", tipo: "editar_etiquetas", adicionar: [], remover: [] },
];

describe("adaptador do React Flow", () => {
  it("abre um fluxo linear antigo como nós e conexões", () => {
    const grafo = criarGrafoInicial(passos);
    expect(grafo.nos.map((no) => no.id)).toEqual([NO_ENTRADA, NO_CONDICOES, "mensagem", "etiqueta"]);
    expect(grafo.conexoes.map((c) => [c.source, c.target])).toEqual([
      [NO_ENTRADA, NO_CONDICOES],
      [NO_CONDICOES, "mensagem"],
      ["mensagem", "etiqueta"],
    ]);
  });

  it("abre um canvas v1 completando a saída que ele não tinha", () => {
    // Registro gravado antes das saídas nomeadas precisa abrir, e não sumir.
    const canvas = {
      versao: 1,
      nos: [],
      conexoes: [
        { source: NO_ENTRADA, target: NO_CONDICOES },
        { source: NO_CONDICOES, target: "etiqueta" },
        { source: "etiqueta", target: "mensagem" },
      ],
    };
    const grafo = criarGrafoInicial(passos, canvas);
    expect(grafo.conexoes.every((c) => c.saida === "padrao")).toBe(true);
    expect(grafo.conexoes.map((c) => c.target)).toEqual([NO_CONDICOES, "etiqueta", "mensagem"]);
  });

  it("dá posição a bloco que o canvas não conhecia", () => {
    const grafo = criarGrafoInicial(passos, { versao: 2, nos: [{ id: "mensagem", x: 10, y: 20 }], conexoes: [] });
    expect(grafo.nos.find((no) => no.id === "mensagem").position).toEqual({ x: 10, y: 20 });
    expect(grafo.nos.find((no) => no.id === "etiqueta").position.x).toEqual(expect.any(Number));
  });

  it("persiste somente posição e topologia, já na versão 2", () => {
    const grafo = criarGrafoInicial(passos);
    expect(serializarCanvas(grafo.nos, grafo.conexoes)).toMatchObject({
      versao: 2,
      nos: expect.arrayContaining([{ id: "mensagem", x: expect.any(Number), y: expect.any(Number) }]),
      conexoes: expect.arrayContaining([
        { source: NO_ENTRADA, saida: "padrao", target: NO_CONDICOES },
      ]),
    });
  });
});
