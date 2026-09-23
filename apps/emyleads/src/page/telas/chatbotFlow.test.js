import { describe, expect, it } from "vitest";
import { NO_CONDICOES, NO_ENTRADA } from "../../domain/chatbotGrafo";
import { conexaoPermitida, criarGrafoInicial, posicoesEmColunas, serializarCanvas } from "./chatbotFlow";

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

const ligar = (source, target, saida = "padrao") => ({ id: `${source}:${saida}:${target}`, source, target, saida });
const base = [ligar(NO_ENTRADA, NO_CONDICOES), ligar(NO_CONDICOES, "cond")];

describe("quais ligações o mapa aceita", () => {
  it("no v3, cada saída de uma condição segue para um bloco só", () => {
    const conexoes = [...base, ligar("cond", "a", "sim")];
    expect(conexaoPermitida(conexoes, ligar("cond", "b", "nao"), { ramificado: true })).toBe(true);
    expect(conexaoPermitida(conexoes, ligar("cond", "b", "sim"), { ramificado: true })).toBe(false);
  });

  it("no v3, dois caminhos podem chegar ao mesmo bloco", () => {
    const conexoes = [...base, ligar("cond", "a", "sim"), ligar("cond", "b", "nao"), ligar("a", "fim")];
    expect(conexaoPermitida(conexoes, ligar("b", "fim"), { ramificado: true })).toBe(true);
    // O v2 continua linear: o mesmo desenho é recusado.
    expect(conexaoPermitida(conexoes, ligar("b", "fim"))).toBe(false);
  });

  it("recusa ciclo nos dois formatos", () => {
    const conexoes = [...base, ligar("cond", "a", "sim"), ligar("a", "b")];
    expect(conexaoPermitida(conexoes, ligar("b", "cond"), { ramificado: true })).toBe(false);
    expect(conexaoPermitida(conexoes, ligar("b", "a"), { ramificado: true })).toBe(false);
  });

  it("protege Nova mensagem e Condições", () => {
    expect(conexaoPermitida(base, ligar("cond", NO_CONDICOES), { ramificado: true })).toBe(false);
    expect(conexaoPermitida(base, ligar("cond", NO_ENTRADA), { ramificado: true })).toBe(false);
    expect(conexaoPermitida([], ligar(NO_ENTRADA, "cond"), { ramificado: true })).toBe(false);
  });

  it("aceita reconectar a própria ligação sem acusar saída ocupada", () => {
    const conexoes = [...base, ligar("cond", "a", "sim")];
    const antiga = conexoes[2];
    expect(conexaoPermitida(conexoes, ligar("cond", "b", "sim"), { ramificado: true, ignorarId: antiga.id })).toBe(true);
  });
});

describe("organizar em colunas", () => {
  it("põe Sim e Não na mesma coluna, um sobre o outro, e a convergência depois", () => {
    const conexoes = [...base, ligar("cond", "a", "sim"), ligar("cond", "b", "nao"), ligar("a", "fim"), ligar("b", "fim")];
    const pos = posicoesEmColunas([NO_ENTRADA, NO_CONDICOES, "cond", "a", "b", "fim"], conexoes);
    expect(pos.get("a").x).toBe(pos.get("b").x);
    expect(pos.get("a").y).not.toBe(pos.get("b").y);
    expect(pos.get("fim").x).toBeGreaterThan(pos.get("a").x);
  });

  it("não trava com um desenho que tenha ciclo", () => {
    const pos = posicoesEmColunas(["a", "b"], [ligar("a", "b"), ligar("b", "a")]);
    expect(pos.size).toBe(2);
  });
});

it("grava a versão pedida", () => {
  expect(serializarCanvas([], [], 3).versao).toBe(3);
  expect(serializarCanvas([], []).versao).toBe(2);
});
