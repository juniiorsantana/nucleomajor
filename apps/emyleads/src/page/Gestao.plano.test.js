import { describe, expect, it } from "vitest";
import { telaDeEntrada, telaLiberada } from "./Gestao";
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

  it("cada tela obedece à sua chave", () => {
    const tudo = { crm: true, agenda: true, team_management: true, whatsapp_web: true, chatbots: true, ai_customer: true, ai_team: true };
    const pares = [
      ["contatos", "crm"], ["funil", "crm"], ["tarefas", "crm"],
      ["agenda", "agenda"], ["equipe", "team_management"],
      ["conversas", "whatsapp_web"], ["conexoes", "whatsapp_web"],
      ["chatbots", "chatbots"],
    ];
    for (const [tela, chave] of pares) {
      expect(telaLiberada(tela, tudo)).toBe(true);
      expect(telaLiberada(tela, { ...tudo, [chave]: false })).toBe(false);
    }
    // Configurações e Minha conta nunca somem: são a saída de qualquer trava.
    expect(telaLiberada("config", {})).toBe(true);
    expect(telaLiberada("conta", {})).toBe(true);
  });

  it("as chaves de sempre só somem com false explícito", () => {
    // Plano gravado antes de a chave existir não perde a tela.
    for (const chave of ["crm", "agenda", "team_management", "whatsapp_web", "chatbots"]) {
      expect(planoLibera({}, chave)).toBe(true);
      expect(planoLibera({ [chave]: null }, chave)).toBe(true);
      expect(planoLibera({ [chave]: false }, chave)).toBe(false);
    }
  });

  it("função desconhecida nasce desligada", () => {
    expect(planoLibera({}, "relatorios_sob_medida")).toBe(false);
    expect(planoLibera({ relatorios_sob_medida: "sim" }, "relatorios_sob_medida")).toBe(false);
    expect(planoLibera({ relatorios_sob_medida: true }, "relatorios_sob_medida")).toBe(true);
    // Sem a leitura do estado, nada se esconde — nem o desconhecido.
    expect(planoLibera(null, "relatorios_sob_medida")).toBe(true);
  });

  it("entrada em tela desligada cai na primeira liberada", () => {
    // Nos testes a plataforma não é a web: a entrada padrão é Contatos.
    const semCrm = { crm: false, agenda: true };
    expect(telaDeEntrada("contatos", semCrm)).not.toBe("contatos");
    expect(telaLiberada(telaDeEntrada("contatos", semCrm), semCrm)).toBe(true);
    expect(telaDeEntrada("contatos", { crm: true })).toBe("contatos");
    // Rota escolhida de propósito mostra o aviso, não pula.
    expect(telaDeEntrada("agenda", { agenda: false })).toBe("agenda");
    // Sem nada liberado, sobra Configurações.
    const nada = { crm: false, agenda: false, team_management: false, whatsapp_web: false, chatbots: false, assistant: false };
    expect(telaDeEntrada("contatos", nada)).toBe("config");
  });
});
