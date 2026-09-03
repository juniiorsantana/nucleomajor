import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gravarRascunho, lerRascunho, limparRascunho } from "./rascunhoLocal";

/** Um localStorage de mentira, para o teste não depender do ambiente. */
function areaFalsa(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (chave) => (dados.has(chave) ? dados.get(chave) : null),
    setItem: (chave, valor) => dados.set(chave, String(valor)),
    removeItem: (chave) => dados.delete(chave),
    get tamanho() {
      return dados.size;
    },
  };
}

/** Um que recusa tudo: janela anônima, cookies bloqueados, cota estourada. */
function areaQueLanca() {
  return {
    getItem: () => { throw new Error("acesso negado"); },
    setItem: () => { throw new Error("cota estourada"); },
    removeItem: () => { throw new Error("acesso negado"); },
  };
}

const ESTADO = { etapa: 2, titulo: "Sobre a empresa", texto: "Somos de Cuiabá." };

describe("ida e volta", () => {
  it("grava e lê o mesmo estado", () => {
    const area = areaFalsa();
    expect(gravarRascunho(ESTADO, area)).toBe(true);
    expect(lerRascunho(area).estado).toEqual(ESTADO);
  });

  it("limpar apaga de verdade", () => {
    const area = areaFalsa();
    gravarRascunho(ESTADO, area);
    limparRascunho(area);
    expect(lerRascunho(area)).toBe(null);
    expect(area.tamanho).toBe(0);
  });

  it("sem nada guardado devolve null", () => {
    expect(lerRascunho(areaFalsa())).toBe(null);
  });
});

describe("o storage pode falhar, e falhar não pode travar a tela", () => {
  it("gravar devolve false em vez de lançar", () => {
    expect(() => gravarRascunho(ESTADO, areaQueLanca())).not.toThrow();
    expect(gravarRascunho(ESTADO, areaQueLanca())).toBe(false);
  });

  it("ler devolve null em vez de lançar", () => {
    expect(() => lerRascunho(areaQueLanca())).not.toThrow();
    expect(lerRascunho(areaQueLanca())).toBe(null);
  });

  it("limpar não lança", () => {
    expect(() => limparRascunho(areaQueLanca())).not.toThrow();
  });

  it("gravar estado nulo não escreve nada", () => {
    const area = areaFalsa();
    expect(gravarRascunho(null, area)).toBe(false);
    expect(area.tamanho).toBe(0);
  });
});

describe("conteúdo inválido é descartado, não carregado para sempre", () => {
  it("JSON quebrado some do storage", () => {
    const area = areaFalsa({ "nucleo:conhecimento:rascunho": "{isto não é json" });
    expect(lerRascunho(area)).toBe(null);
    expect(area.tamanho).toBe(0);
  });

  it("formato antigo sem estado ou sem data some", () => {
    for (const bruto of ['{"salvoEm":123}', '{"estado":{"a":1}}', '{"estado":"texto","salvoEm":1}', "null"]) {
      const area = areaFalsa({ "nucleo:conhecimento:rascunho": bruto });
      expect(lerRascunho(area)).toBe(null);
      expect(area.tamanho).toBe(0);
    }
  });
});

describe("validade", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rascunho de ontem ainda é oferecido", () => {
    const area = areaFalsa();
    vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
    gravarRascunho(ESTADO, area);
    vi.setSystemTime(new Date("2026-08-21T10:00:00Z"));
    expect(lerRascunho(area)?.estado).toEqual(ESTADO);
  });

  it("passados sete dias ele some sozinho", () => {
    // Quem ia voltar já voltou. Oferecer um rascunho de duas semanas atrás é
    // ruído que ensina a ignorar o aviso.
    const area = areaFalsa();
    vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
    gravarRascunho(ESTADO, area);
    vi.setSystemTime(new Date("2026-08-28T10:00:00Z"));
    expect(lerRascunho(area)).toBe(null);
    expect(area.tamanho).toBe(0);
  });
});
