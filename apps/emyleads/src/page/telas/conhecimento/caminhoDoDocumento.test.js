import { describe, expect, it } from "vitest";
import { caminhoDisponivel, derivarCaminho, pastaDoModelo, slugDoTitulo } from "./caminhoDoDocumento";

describe("slugDoTitulo", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(slugDoTitulo("Preços & Condições (2026)")).toBe("precos-condicoes-2026");
    expect(slugDoTitulo("Sobre a empresa")).toBe("sobre-a-empresa");
    expect(slugDoTitulo("Ação, informação e manutenção")).toBe("acao-informacao-e-manutencao");
  });

  it("a barra do título nunca vira pasta", () => {
    // `Vendas/Suporte` não pode criar um nível que ninguém pediu — e um título
    // começando com barra produziria caminho que o banco recusa.
    expect(slugDoTitulo("Vendas/Suporte")).toBe("vendas-suporte");
    expect(slugDoTitulo("/etc/senha")).toBe("etc-senha");
  });

  it("título que não sobra nada ainda produz um nome", () => {
    for (const titulo of ["", "   ", "!!!", "…", null, undefined]) {
      expect(slugDoTitulo(titulo)).toBe("documento");
    }
  });

  it("nunca produz ponto, barra ou hífen nas pontas", () => {
    for (const titulo of ["...", "-- Sobre --", "a..b", "a//b", "  espaço  "]) {
      const slug = slugDoTitulo(titulo);
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("pastaDoModelo", () => {
  it("sai do caminho que o modelo já trazia", () => {
    expect(pastaDoModelo("empresa")).toBe("empresa");
    expect(pastaDoModelo("servicos")).toBe("comercial");
    expect(pastaDoModelo("faq")).toBe("atendimento");
  });

  it("modelo sem caminho e modelo inexistente não inventam pasta", () => {
    expect(pastaDoModelo("livre")).toBe("");
    expect(pastaDoModelo("nao-existe")).toBe("");
    expect(pastaDoModelo(null)).toBe("");
  });
});

describe("caminhoDisponivel", () => {
  it("devolve o desejado quando está livre", () => {
    expect(caminhoDisponivel("empresa/sobre", [])).toBe("empresa/sobre.md");
  });

  it("numera a partir do segundo", () => {
    const ocupados = ["empresa/sobre.md"];
    expect(caminhoDisponivel("empresa/sobre", ocupados)).toBe("empresa/sobre-2.md");
    expect(caminhoDisponivel("empresa/sobre", [...ocupados, "empresa/sobre-2.md"])).toBe("empresa/sobre-3.md");
  });

  it("compara sem caixa, porque o índice único do banco é sobre lower(path)", () => {
    expect(caminhoDisponivel("Empresa/Sobre", ["empresa/sobre.md"])).toBe("Empresa/Sobre-2.md");
  });

  it("editar o próprio documento não empurra o caminho a cada gravação", () => {
    const ocupados = ["empresa/sobre.md", "comercial/regras.md"];
    expect(caminhoDisponivel("empresa/sobre", ocupados, { exceto: "empresa/sobre.md" }))
      .toBe("empresa/sobre.md");
  });

  it("aceita o desejado já com .md sem duplicar a extensão", () => {
    expect(caminhoDisponivel("empresa/sobre.md", [])).toBe("empresa/sobre.md");
    expect(caminhoDisponivel("empresa/sobre.MD", [])).toBe("empresa/sobre.md");
  });
});

describe("derivarCaminho", () => {
  it("junta a pasta do modelo com o slug do título", () => {
    expect(derivarCaminho({ titulo: "Sobre a empresa", modeloId: "empresa" })).toBe("empresa/sobre-a-empresa.md");
    expect(derivarCaminho({ titulo: "Regras comerciais", modeloId: "servicos" })).toBe("comercial/regras-comerciais.md");
  });

  it("modelo livre fica na raiz", () => {
    expect(derivarCaminho({ titulo: "Anotações", modeloId: "livre" })).toBe("anotacoes.md");
  });

  it("dois documentos de mesmo título produzem caminhos distintos", () => {
    const primeiro = derivarCaminho({ titulo: "Sobre a empresa", modeloId: "empresa" });
    const segundo = derivarCaminho({ titulo: "Sobre a empresa", modeloId: "empresa", ocupados: [primeiro] });
    expect(segundo).not.toBe(primeiro);
    expect(segundo).toBe("empresa/sobre-a-empresa-2.md");
  });

  describe("o resultado sempre satisfaz as constraints do banco", () => {
    // knowledge_documents_path_extensao e _path_travessia, como ficaram em
    // 20260829150000. Se a derivação puder produzir algo que elas recusam, o
    // erro aparece três telas depois de a pessoa digitar o título.
    const extensao = /^[^/].*\.md$/;
    const travessia = /(^|\/)\.{1,2}(\/|$)/;

    const titulos = [
      "Sobre a empresa", "../../etc/senha", "/absoluto", "..", ".", "a//b",
      "Preços & Condições", "!!!", "", "   ", "MAIÚSCULAS", "café com açúcar",
      "x".repeat(600), "1", "-", "Vendas/Suporte/Interno",
    ];
    const modelos = ["empresa", "servicos", "faq", "livre", "nao-existe"];

    for (const modeloId of modelos) {
      it(`modelo ${modeloId}`, () => {
        for (const titulo of titulos) {
          const caminho = derivarCaminho({ titulo, modeloId });
          expect(caminho, `título ${JSON.stringify(titulo)}`).toMatch(extensao);
          expect(caminho, `título ${JSON.stringify(titulo)}`).not.toMatch(travessia);
          expect(caminho).not.toContain("//");
          expect(caminho).toBe(caminho.trim());
          expect(caminho.length).toBeGreaterThanOrEqual(4);
          expect(caminho.length).toBeLessThanOrEqual(500);
        }
      });
    }
  });

  it("título longuíssimo é cortado preservando a extensão e o espaço do sufixo", () => {
    const caminho = derivarCaminho({ titulo: "a".repeat(2000), modeloId: "empresa" });
    expect(caminho.length).toBeLessThanOrEqual(500);
    expect(caminho.endsWith(".md")).toBe(true);
    expect(caminho.startsWith("empresa/")).toBe(true);
  });
});
