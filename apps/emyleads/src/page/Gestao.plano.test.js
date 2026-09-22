import { describe, expect, it } from "vitest";
import { telaLiberada } from "./Gestao";
import { planoLibera } from "./plano";

describe("menu pelo plano", () => {
  it("sem o estado da assinatura, nada some", () => {
    for (const tela of ["conhecimento", "chatbots", "contatos", "conexoes"]) {
      expect(telaLiberada(tela, null)).toBe(true);
    }
  });

  it("no plano Base, Inteligência e Chatbots saem e o resto fica", () => {
    const base = { crm: true, agenda: true, assistant: false, ai_customer: false, ai_team: false, knowledge: false, chatbots: false };
    expect(telaLiberada("conhecimento", base)).toBe(false);
    expect(telaLiberada("chatbots", base)).toBe(false);
    for (const tela of ["conversas", "contatos", "funil", "tarefas", "agenda", "conexoes", "equipe", "config", "conta"]) {
      expect(telaLiberada(tela, base)).toBe(true);
    }
  });

  it("nos planos com IA, tudo aparece", () => {
    const atendimento = { assistant: true, ai_customer: true, ai_team: false, chatbots: true };
    const completo = { assistant: true, ai_customer: true, ai_team: true, chatbots: true };
    for (const plano of [atendimento, completo]) {
      expect(telaLiberada("conhecimento", plano)).toBe(true);
      expect(telaLiberada("chatbots", plano)).toBe(true);
    }
  });

  it("plano gravado antes das chaves novas continua valendo pelo assistant", () => {
    const antigo = { assistant: true, chatbots: true };
    expect(telaLiberada("conhecimento", antigo)).toBe(true);
    expect(planoLibera(antigo, "assistente_equipe")).toBe(true);
    expect(planoLibera({ assistant: false }, "inteligencia")).toBe(false);
  });

  it("o assistente da equipe é só de quem tem ai_team", () => {
    const atendimento = { assistant: true, ai_customer: true, ai_team: false };
    const completo = { assistant: true, ai_customer: true, ai_team: true };
    expect(planoLibera(atendimento, "assistente_equipe")).toBe(false);
    expect(planoLibera(atendimento, "atendimento_ia")).toBe(true);
    expect(planoLibera(completo, "assistente_equipe")).toBe(true);
    // Sem leitura da assinatura, nada é escondido.
    expect(planoLibera(null, "assistente_equipe")).toBe(true);
  });
});
