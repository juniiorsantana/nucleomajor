import { describe, expect, it } from "vitest";
import { telaLiberada } from "./Gestao";

describe("menu pelo plano", () => {
  it("sem o estado da assinatura, nada some", () => {
    for (const tela of ["conhecimento", "chatbots", "contatos", "conexoes"]) {
      expect(telaLiberada(tela, null)).toBe(true);
    }
  });

  it("no plano Base, Inteligência e Chatbots saem e o resto fica", () => {
    const base = { crm: true, agenda: true, assistant: false, knowledge: false, chatbots: false };
    expect(telaLiberada("conhecimento", base)).toBe(false);
    expect(telaLiberada("chatbots", base)).toBe(false);
    for (const tela of ["conversas", "contatos", "funil", "tarefas", "agenda", "conexoes", "equipe", "config", "conta"]) {
      expect(telaLiberada(tela, base)).toBe(true);
    }
  });

  it("no plano com IA, tudo aparece", () => {
    const full = { assistant: true, chatbots: true };
    expect(telaLiberada("conhecimento", full)).toBe(true);
    expect(telaLiberada("chatbots", full)).toBe(true);
  });
});
