import { describe, expect, it } from "vitest";
import { MODELOS, MODELO_POR_ID, PRIMEIROS_PASSOS, lerBlocos, lerTitulo, montarMarkdown } from "./modelosConhecimento";

describe("catálogo de modelos", () => {
  it("todo modelo do primeiro acesso existe no catálogo", () => {
    for (const id of PRIMEIROS_PASSOS) expect(MODELO_POR_ID.has(id)).toBe(true);
  });

  it("todo modelo tem ou blocos ou perguntas e respostas", () => {
    // Um modelo sem os dois abriria o editor simples em branco, sem nenhuma
    // pergunta — que é justamente o que ele existe para evitar.
    for (const modelo of MODELOS) {
      expect(modelo.blocos.length > 0 || modelo.perguntasERespostas === true).toBe(true);
    }
  });
});

describe("montarMarkdown", () => {
  it("põe o título como h1 e cada bloco como h2", () => {
    const markdown = montarMarkdown({
      titulo: "Sobre a Major Hub",
      blocos: [{ rotulo: "Quem é a empresa", texto: "Uma agência de Cuiabá." }],
    });
    expect(markdown).toBe("# Sobre a Major Hub\n\n## Quem é a empresa\n\nUma agência de Cuiabá.\n");
  });

  it("descarta bloco sem texto", () => {
    // Título órfão entra no search_vector e faz o documento casar com uma
    // pergunta que ele não responde.
    const markdown = montarMarkdown({
      titulo: "T",
      blocos: [{ rotulo: "Onde atendemos", texto: "   " }, { rotulo: "Prazos", texto: "Até 5 dias." }],
    });
    expect(markdown).not.toContain("Onde atendemos");
    expect(markdown).toContain("## Prazos");
  });

  it("transforma bloco de lista em itens, sem duplicar o hífen de quem já digitou", () => {
    const markdown = montarMarkdown({
      titulo: "T",
      blocos: [{ rotulo: "Serviços", lista: true, texto: "Tráfego pago\n- Social media\n\nSites" }],
    });
    expect(markdown).toContain("- Tráfego pago\n- Social media\n- Sites");
  });
});

describe("lerBlocos", () => {
  it("desmonta o Markdown de volta nos mesmos blocos", () => {
    const original = {
      titulo: "Sobre a Major Hub",
      blocos: [
        { rotulo: "Quem é a empresa", texto: "Uma agência de Cuiabá." },
        { rotulo: "Onde atendemos", texto: "Todo o Brasil." },
      ],
    };
    const blocos = lerBlocos(montarMarkdown(original));
    expect(blocos).toEqual(original.blocos.map((bloco) => ({ rotulo: bloco.rotulo, texto: bloco.texto })));
  });

  it("guarda texto solto antes do primeiro subtítulo", () => {
    // Documento escrito à mão, sem `##` nenhum, não pode chegar vazio ao
    // editor simples.
    expect(lerBlocos("# T\n\nUm parágrafo solto.")).toEqual([{ rotulo: "", texto: "Um parágrafo solto." }]);
  });

  it("ignora o h1, que vive fora do conteúdo", () => {
    expect(lerBlocos("# Título\n\n## Bloco\n\nTexto.")).toEqual([{ rotulo: "Bloco", texto: "Texto." }]);
  });

  it("lê o título de volta", () => {
    expect(lerTitulo("# Sobre a Major Hub\n\n## X")).toBe("Sobre a Major Hub");
    expect(lerTitulo("## Só subtítulo")).toBe("");
  });
});
