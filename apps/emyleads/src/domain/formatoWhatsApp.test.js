import { describe, expect, it } from "vitest";
import { formatarWhatsApp } from "./formatoWhatsApp.js";

const t = (texto) => ({ tipo: "texto", texto });

describe("formatarWhatsApp", () => {
  it("texto sem marcador passa como está", () => {
    expect(formatarWhatsApp("Oi, tudo bem?")).toEqual([t("Oi, tudo bem?")]);
    expect(formatarWhatsApp("")).toEqual([]);
    expect(formatarWhatsApp(null)).toEqual([]);
  });

  it("negrito com UM asterisco, itálico, riscado", () => {
    expect(formatarWhatsApp("qual o *tamanho da equipe*?")).toEqual([
      t("qual o "),
      { tipo: "negrito", filhos: [t("tamanho da equipe")] },
      t("?"),
    ]);
    expect(formatarWhatsApp("_por onde_ chegam")).toEqual([{ tipo: "italico", filhos: [t("por onde")] }, t(" chegam")]);
    expect(formatarWhatsApp("de ~R$ 200~ por R$ 150")).toEqual([
      t("de "),
      { tipo: "riscado", filhos: [t("R$ 200")] },
      t(" por R$ 150"),
    ]);
  });

  it("um dentro do outro", () => {
    expect(formatarWhatsApp("*muito _importante_*")).toEqual([
      { tipo: "negrito", filhos: [t("muito "), { tipo: "italico", filhos: [t("importante")] }] },
    ]);
  });

  it("monoespaçado com três crases (atravessa linha) e com uma", () => {
    expect(formatarWhatsApp("código: ```a *b*\nc```")).toEqual([t("código: "), { tipo: "mono", texto: "a *b*\nc" }]);
    expect(formatarWhatsApp("use `PIX10`")).toEqual([t("use "), { tipo: "mono", texto: "PIX10" }]);
  });

  it("não formata o que o WhatsApp também não formata", () => {
    expect(formatarWhatsApp("2*3*4")).toEqual([t("2*3*4")]);
    expect(formatarWhatsApp("nome_do_arquivo.pdf")).toEqual([t("nome_do_arquivo.pdf")]);
    expect(formatarWhatsApp("* não fecha")).toEqual([t("* não fecha")]);
    expect(formatarWhatsApp("*sem fim")).toEqual([t("*sem fim")]);
    expect(formatarWhatsApp("* espaço *")).toEqual([t("* espaço *")]);
    expect(formatarWhatsApp("**")).toEqual([t("**")]);
  });

  it("negrito não atravessa a quebra de linha", () => {
    expect(formatarWhatsApp("*começo\nfim*")).toEqual([t("*começo\nfim*")]);
  });

  it("link é separado antes e não vira itálico", () => {
    expect(formatarWhatsApp("veja https://site.com/a_b_c e _isto_")).toEqual([
      t("veja "),
      { tipo: "link", texto: "https://site.com/a_b_c", href: "https://site.com/a_b_c" },
      t(" e "),
      { tipo: "italico", filhos: [t("isto")] },
    ]);
  });

  it("www. ganha https e a pontuação final fica fora do link", () => {
    expect(formatarWhatsApp("acesse www.nucleomajor.com.")).toEqual([
      t("acesse "),
      { tipo: "link", texto: "www.nucleomajor.com", href: "https://www.nucleomajor.com" },
      t("."),
    ]);
  });
});
