import { describe, expect, it } from "vitest";
import { ondeAtende, prontidaoDoAgent } from "./prontidaoDoAgente";

const campanhas = [
  { name: "Formulário Meta", assistant_profile_id: "b", status: "active" },
  { name: "Indicação", assistant_profile_id: "b", status: "test" },
  { name: "Rascunho", assistant_profile_id: "b", status: "draft" },
  { name: "Antiga", assistant_profile_id: "c", status: "closed" },
];

describe("onde o agente atende", () => {
  it("principal recebe quem chega", () => {
    expect(ondeAtende({ id: "a", isDefault: true, status: "active" }, campanhas).tipo).toBe("principal");
  });
  it("só campanhas no ar contam", () => {
    expect(ondeAtende({ id: "b", status: "active" }, campanhas)).toEqual({ tipo: "campanhas", campanhas: ["Formulário Meta", "Indicação"] });
    expect(ondeAtende({ id: "c", status: "active" }, campanhas).tipo).toBe("nenhum");
  });
  it("pausado vence o resto", () => {
    expect(ondeAtende({ id: "a", isDefault: true, status: "inactive" }, campanhas).tipo).toBe("pausado");
  });
});

describe("prontidão", () => {
  const pronto = { soulMarkdown: "Recebe cada pessoa com atenção e conduz ao próximo passo certo.", audience: "customer" };

  it("conta os cinco itens e aponta a primeira falta", () => {
    const r = prontidaoDoAgent({ agent: pronto, habilidades: 2, temConhecimento: true, playbookPublicado: false, onde: { tipo: "principal" } });
    expect(r.prontos).toBe(4);
    expect(r.total).toBe(5);
    expect(r.primeiraFalta.id).toBe("vender");
  });

  it("o que ainda carrega não conta como falta", () => {
    const r = prontidaoDoAgent({ agent: pronto, habilidades: 1, temConhecimento: null, playbookPublicado: null, onde: { tipo: "campanhas" } });
    expect(r.primeiraFalta).toBeNull();
    expect(r.prontos).toBe(3);
  });

  it("personalidade curta demais e agente sem lugar para atender aparecem como falta", () => {
    const r = prontidaoDoAgent({ agent: { soulMarkdown: "oi", audience: "internal" }, habilidades: 0, temConhecimento: false, playbookPublicado: true, onde: { tipo: "nenhum" } });
    expect(r.itens.filter((i) => i.pronto === false).map((i) => i.id)).toEqual(["personalidade", "conhecimento", "habilidades", "onde"]);
    expect(r.itens.find((i) => i.id === "conhecimento").falta).toBe("Sem conhecimento da equipe");
  });
});
