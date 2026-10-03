import { describe, expect, it } from "vitest";
import { corDoEstagio, ehEstagioFechado } from "./types";

describe("cor do estágio", () => {
  it("segue a escala azul pela ordem, e não volta ao começo depois do último degrau", () => {
    expect(corDoEstagio(0).marca).toBe("var(--el-st-1)");
    expect(corDoEstagio({ id: "proposta", nome: "Proposta", ordem: 3 }).marca).toBe("var(--el-st-4)");
    expect(corDoEstagio(9).marca).toBe("var(--el-st-6)");
  });

  it("Fechado é verde em qualquer tela, pelo id ou pelo nome", () => {
    expect(corDoEstagio({ id: "fechado", nome: "Fechado", ordem: 5 }).marca).toBe("var(--el-success)");
    expect(corDoEstagio({ id: "x1", nome: " fechado ", ordem: 2 }).marca).toBe("var(--el-success)");
    expect(ehEstagioFechado({ id: "x2", nome: "Negociação" })).toBe(false);
  });
});
