import { describe, expect, it, vi } from "vitest";

vi.mock("../../../data/client", () => ({ api: {} }));

const { OPERADORES_LENTO_MS, OPERADORES_RAPIDO_MS, cadenciaDosOperadores } = await import("./useOperadores");

describe("cadenciaDosOperadores", () => {
  it("rápida só com um código enviado esperando resposta", () => {
    expect(cadenciaDosOperadores({ "u-1": Date.now() + 60_000 })).toBe(OPERADORES_RAPIDO_MS);
  });

  it("lenta no resto: o aviso `operators` do Realtime traz a mudança", () => {
    expect(cadenciaDosOperadores({})).toBe(OPERADORES_LENTO_MS);
    expect(cadenciaDosOperadores()).toBe(OPERADORES_LENTO_MS);
  });
});
