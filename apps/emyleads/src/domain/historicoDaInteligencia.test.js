import { describe, expect, it } from "vitest";
import { rotuloDoHistorico } from "./historicoDaInteligencia.js";

describe("rotuloDoHistorico", () => {
  it("traduz a operação do banco e concorda o gênero", () => {
    expect(rotuloDoHistorico({ action: "update", entity_type: "profile" })).toBe("Agente atualizado");
    expect(rotuloDoHistorico({ action: "insert", entity_type: "campaign" })).toBe("Campanha criada");
    expect(rotuloDoHistorico({ action: "delete", entity_type: "skill" })).toBe("Habilidade removida");
    expect(rotuloDoHistorico({ action: "INSERT", entity_type: "template" })).toBe("Modelo de agente criado");
  });

  it("mostra a versão quando há", () => {
    expect(rotuloDoHistorico({ action: "update", entity_type: "skill", version: 3 })).toBe("Habilidade atualizada · v3");
  });

  it("o que não conhece aparece como veio, sem sumir", () => {
    expect(rotuloDoHistorico({ action: "rollback", entity_type: "skill", version: 2 })).toBe("rollback · skill · v2");
    expect(rotuloDoHistorico({ action: "update", entity_type: "novo_tipo" })).toBe("update · novo_tipo");
    expect(rotuloDoHistorico({})).toBe(" · ");
  });
});
