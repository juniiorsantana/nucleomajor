import { describe, expect, it } from "vitest";
import {
  PALAVRAS_CONFORTAVEIS,
  analisarInline,
  analisarMarkdown,
  contarPalavras,
  folegoDoDocumento,
  hrefSeguro,
} from "./markdown";

describe("analisarInline", () => {
  it("separa negrito, ênfase e código", () => {
    expect(analisarInline("um **dois** _três_ `quatro`")).toEqual([
      { tipo: "texto", texto: "um " },
      { tipo: "forte", texto: "dois" },
      { tipo: "texto", texto: " " },
      { tipo: "enfase", texto: "três" },
      { tipo: "texto", texto: " " },
      { tipo: "codigo", texto: "quatro" },
    ]);
  });

  it("não interpreta marcação dentro de código", () => {
    // Sem isto, documentar o próprio Markdown viraria negrito na tela.
    expect(analisarInline("`**literal**`")).toEqual([{ tipo: "codigo", texto: "**literal**" }]);
  });

  it("lê link com texto e destino", () => {
    expect(analisarInline("veja [o site](https://nucleomajor.com)")).toEqual([
      { tipo: "texto", texto: "veja " },
      { tipo: "link", texto: "o site", href: "https://nucleomajor.com" },
    ]);
  });

  it("respeita a barra invertida de escape", () => {
    expect(analisarInline("preço \\*promocional\\*")).toEqual([
      { tipo: "texto", texto: "preço *promocional*" },
    ]);
  });

  it("asterisco solto continua sendo texto", () => {
    expect(analisarInline("2 * 3 = 6")).toEqual([{ tipo: "texto", texto: "2 * 3 = 6" }]);
  });

  it("número solto no texto não é confundido com marca interna de escape", () => {
    // O escape guarda o caractere atrás de um índice numérico entre
    // delimitadores de uso privado. Se a marca fosse só o número, um
    // "prazo de 0 a 7 dias" seria mutilado ao restaurar.
    expect(analisarInline("prazo de \\*0\\* a 7 dias")).toEqual([
      { tipo: "texto", texto: "prazo de *0* a 7 dias" },
    ]);
  });

  it("mantém a barra invertida dentro de código, onde ela é literal", () => {
    expect(analisarInline("`\\*nao interpreta\\*`")).toEqual([
      { tipo: "codigo", texto: "\\*nao interpreta\\*" },
    ]);
  });
});

describe("analisarMarkdown", () => {
  it("lê títulos com o nível certo", () => {
    const [um, dois] = analisarMarkdown("# Um\n\n### Dois");
    expect(um).toMatchObject({ tipo: "titulo", nivel: 1 });
    expect(dois).toMatchObject({ tipo: "titulo", nivel: 3 });
  });

  it("junta linhas seguidas num parágrafo só", () => {
    // Quebra simples de linha não é parágrafo novo em Markdown; tratá-la como
    // se fosse deixaria o texto picado na pré-visualização.
    const blocos = analisarMarkdown("uma linha\ne a continuação\n\noutro parágrafo");
    expect(blocos).toHaveLength(2);
    expect(blocos[0].partes[0].texto).toBe("uma linha e a continuação");
  });

  it("agrupa itens numa lista e separa listas de tipos diferentes", () => {
    const blocos = analisarMarkdown("- a\n- b\n1. c");
    expect(blocos).toHaveLength(2);
    expect(blocos[0]).toMatchObject({ tipo: "lista", ordenada: false });
    expect(blocos[0].itens).toHaveLength(2);
    expect(blocos[1]).toMatchObject({ tipo: "lista", ordenada: true });
  });

  it("preserva bloco de código sem interpretar o conteúdo", () => {
    const blocos = analisarMarkdown("```\n# não é título\n```");
    expect(blocos).toEqual([{ tipo: "codigo", texto: "# não é título" }]);
  });

  it("fecha bloco de código não terminado em vez de engolir o resto", () => {
    const blocos = analisarMarkdown("```\nabre e não fecha");
    expect(blocos).toEqual([{ tipo: "codigo", texto: "abre e não fecha" }]);
  });

  it("texto vazio não vira bloco nenhum", () => {
    expect(analisarMarkdown("   \n\n  ")).toEqual([]);
  });
});

describe("hrefSeguro", () => {
  it("aceita http e https", () => {
    expect(hrefSeguro("https://nucleomajor.com")).toBe("https://nucleomajor.com");
    expect(hrefSeguro("http://exemplo.com")).toBe("http://exemplo.com");
  });

  it.each(["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>", "vbscript:x", "  javascript:x"])(
    "recusa %s",
    (href) => {
      // O texto é escrito por uma pessoa da empresa e lido por outra: um href
      // executável aqui rodaria na sessão de quem abrisse o documento.
      expect(hrefSeguro(href)).toBeNull();
    },
  );
});

describe("contarPalavras e fôlego", () => {
  it("ignora a marcação ao contar", () => {
    expect(contarPalavras("# Título\n\n- **um** dois")).toBe(3);
  });

  it("não conta o conteúdo de bloco de código", () => {
    expect(contarPalavras("texto real\n\n```\numa duas tres quatro\n```")).toBe(2);
  });

  it("classifica o fôlego pelos limites", () => {
    expect(folegoDoDocumento(100)).toBe("folgado");
    expect(folegoDoDocumento(PALAVRAS_CONFORTAVEIS * 0.8)).toBe("atento");
    expect(folegoDoDocumento(PALAVRAS_CONFORTAVEIS)).toBe("longo");
  });
});
