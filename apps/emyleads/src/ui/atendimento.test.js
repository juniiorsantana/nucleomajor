import { describe, expect, it } from "vitest";
import { textoDoAtendimento, textoDoDono } from "./atendimento";

describe("rótulo do dono", () => {
  it("traduz os três donos", () => {
    expect(textoDoDono("bot")).toBe("Robô do CRM");
    expect(textoDoDono("ia")).toBe("Agente de IA");
    expect(textoDoDono("humano")).toBe("Atendente");
  });
});

describe("rótulo com quem assumiu", () => {
  it("mostra o nome de quem está atendendo", () => {
    // "Atendente" responde a pergunta errada quando a equipe tem mais de uma
    // pessoa: quem olha precisa saber se é ela mesma ou a colega.
    expect(textoDoAtendimento({ owner: "humano", attendantName: "Ana" })).toBe("Atendente · Ana");
  });

  it("cai no rótulo genérico quando ninguém se identificou", () => {
    // Sessão assumida antes de a identidade existir, ou por um fluxo que só
    // disse "alguém pegue".
    expect(textoDoAtendimento({ owner: "humano" })).toBe("Atendente");
    expect(textoDoAtendimento({ owner: "humano", attendantName: "   " })).toBe("Atendente");
    expect(textoDoAtendimento({ owner: "humano", attendantName: null })).toBe("Atendente");
  });

  it("robô e IA não ganham nome de gente", () => {
    expect(textoDoAtendimento({ owner: "ia", attendantName: "Ana" })).toBe("Agente de IA");
    expect(textoDoAtendimento({ owner: "bot", attendantName: "Ana" })).toBe("Robô do CRM");
  });

  it("sessão ausente não quebra", () => {
    expect(textoDoAtendimento(null)).toBe("—");
    expect(textoDoAtendimento(undefined)).toBe("—");
  });
});
