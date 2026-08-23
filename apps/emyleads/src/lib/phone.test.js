import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, variantesBR } from "./phone";

describe("phone", () => {
  it("normaliza formatos brasileiros com e sem DDI", () => {
    expect(normalizePhone("(65) 99217-8164")).toBe("5565992178164");
    expect(normalizePhone("5565992178164")).toBe("5565992178164");
    expect(normalizePhone("65 99217-8164")).toBe("5565992178164");
  });

  it("mantém números internacionais sem inventar DDI", () => {
    expect(normalizePhone("5511987654321")).toBe("5511987654321");
    expect(variantesBR("447911123456")).toEqual(["447911123456"]);
  });

  it("gera as duas variantes do nono dígito", () => {
    expect(variantesBR("5565992178164")).toEqual([
      "5565992178164",
      "556592178164",
    ]);
    expect(variantesBR("556592178164")).toEqual([
      "556592178164",
      "5565992178164",
    ]);
  });

  it("formata telefone brasileiro sem perder o nono dígito", () => {
    expect(formatPhone("5565992178164")).toBe("(65) 99217-8164");
  });
});
