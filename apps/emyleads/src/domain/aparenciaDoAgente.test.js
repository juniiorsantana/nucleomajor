import { describe, expect, it } from "vitest";
import { aparenciaDoAgent, gradeDoSimbolo, normalizarAparencia, sementeNova } from "./aparenciaDoAgente";

describe("aparência do agente", () => {
  it("sem escolha guardada, cor e semente saem do id e não mudam", () => {
    const a = aparenciaDoAgent({ id: "8f2c-agente" });
    expect(a).toEqual(aparenciaDoAgent({ id: "8f2c-agente" }));
    expect(a.cor).toBeGreaterThanOrEqual(1);
    expect(a.cor).toBeLessThanOrEqual(8);
    expect(a.semente).toBe("8f2c-agente");
  });

  it("a escolha guardada vale sobre o derivado", () => {
    expect(aparenciaDoAgent({ id: "x", appearance: { cor: 6, semente: "abc" } })).toEqual({ cor: 6, semente: "abc" });
  });

  it("valor fora da forma é ignorado, e não quebra a tela", () => {
    expect(normalizarAparencia({ cor: 9, semente: "" })).toEqual({});
    expect(normalizarAparencia({ cor: "3" })).toEqual({ cor: 3 });
    expect(normalizarAparencia(null)).toEqual({});
    expect(normalizarAparencia([1])).toEqual({});
    expect(normalizarAparencia({ semente: "x".repeat(40) }).semente).toHaveLength(32);
  });
});

describe("símbolo", () => {
  it("é estável, espelhado e tem o centro aceso", () => {
    const g = gradeDoSimbolo("emilia");
    expect(g).toEqual(gradeDoSimbolo("emilia"));
    expect(g[2][2]).toBe(true);
    for (const linha of g) expect(linha).toEqual([...linha].reverse());
  });

  it("nunca sai quase vazio", () => {
    for (const semente of ["a", "b", "zzz", "0", "agente", "123456"]) {
      const acesas = gradeDoSimbolo(semente).flat().filter(Boolean).length;
      expect(acesas).toBeGreaterThanOrEqual(5);
    }
  });

  it("sementes diferentes dão símbolos diferentes", () => {
    const vistos = new Set(["um", "dois", "tres", "quatro", "cinco", "seis"].map((s) => JSON.stringify(gradeDoSimbolo(s))));
    expect(vistos.size).toBeGreaterThan(4);
  });

  it("'Outro símbolo' gera semente curta", () => {
    expect(sementeNova(() => 0.5)).toMatch(/^[0-9a-z]{6}$/);
  });
});
