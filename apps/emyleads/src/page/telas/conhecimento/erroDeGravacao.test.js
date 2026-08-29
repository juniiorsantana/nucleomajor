import { describe, expect, it } from "vitest";
import { ETAPA_DO_CAMPO, mensagemDeGravacao } from "./erroDeGravacao";

/** O formato que o supabase-js entrega ao `throw error` do provider. */
const doPostgrest = (message, extra = {}) => ({ message, details: null, hint: null, code: null, ...extra });

describe("o erro do caminho — o que a pessoa realmente viu na tela", () => {
  it("traduz o nome anônimo que o banco tem hoje", () => {
    const erro = doPostgrest(
      'new row for relation "knowledge_documents" violates check constraint "knowledge_documents_path_check2"',
      { code: "23514" },
    );
    const { mensagem, campo } = mensagemDeGravacao(erro);
    expect(campo).toBe("caminho");
    expect(mensagem).toMatch(/caminho do arquivo não é válido/i);
    // O texto do Postgres não pode sobrar em lugar nenhum da frase.
    expect(mensagem).not.toMatch(/constraint|relation|violates/i);
  });

  it("traduz também os nomes próprios que a migration corretiva cria", () => {
    for (const nome of ["knowledge_documents_path_extensao", "knowledge_documents_path_travessia"]) {
      const { campo } = mensagemDeGravacao(doPostgrest(`violates check constraint "${nome}"`));
      expect(campo).toBe("caminho");
    }
  });

  it("caminho duplicado não é anunciado como caminho malformado", () => {
    // As duas mensagens citam `path`. Se a ordem das regras invertesse, quem
    // salvasse dois documentos com o mesmo título leria que o caminho está
    // errado — e ele não está: está ocupado.
    const erro = doPostgrest(
      'duplicate key value violates unique constraint "knowledge_documents_active_path_unique"',
      { code: "23505" },
    );
    const { mensagem, campo } = mensagemDeGravacao(erro);
    expect(campo).toBe("caminho");
    expect(mensagem).toMatch(/já existe um documento/i);
  });
});

describe("as exceções que a RPC levanta", () => {
  const casos = [
    ["knowledge title required", "titulo", /título/i],
    ["knowledge path required", "caminho", /caminho/i],
    ["published external knowledge requires an external collection", "colecoes", /coleção externa/i],
    ["personal knowledge cannot be assigned to collections", "publico", /pessoal/i],
    ["organization knowledge requires administrator role", "publico", /administrador/i],
    ["knowledge document not found", null, /não existe mais/i],
  ];

  for (const [mensagemDoBanco, campoEsperado, frase] of casos) {
    it(`traduz "${mensagemDoBanco}"`, () => {
      const { mensagem, campo } = mensagemDeGravacao(doPostgrest(mensagemDoBanco, { code: "P0001" }));
      expect(campo).toBe(campoEsperado);
      expect(mensagem).toMatch(frase);
      expect(mensagem).not.toBe(mensagemDoBanco);
    });
  }
});

describe("o que não se traduz", () => {
  it("devolve o texto original quando não reconhece o erro", () => {
    // Esconder um erro desconhecido atrás de "algo deu errado" tira a única
    // pista que a pessoa tinha para relatar o problema.
    const { mensagem, campo } = mensagemDeGravacao(doPostgrest("connection pool exhausted"));
    expect(mensagem).toBe("connection pool exhausted");
    expect(campo).toBe(null);
  });

  it("não quebra com erro vazio, nulo ou sem mensagem", () => {
    for (const entrada of [null, undefined, {}, new Error("")]) {
      const { mensagem } = mensagemDeGravacao(entrada);
      expect(typeof mensagem).toBe("string");
      expect(mensagem.length).toBeGreaterThan(0);
    }
  });

  it("aproveita details e hint quando a mensagem sozinha não basta", () => {
    const erro = doPostgrest("new row violates check constraint", {
      details: 'Failing row contains (…, knowledge_documents_path_extensao, …)',
    });
    expect(mensagemDeGravacao(erro).campo).toBe("caminho");
  });
});

describe("para onde o foco vai", () => {
  it("todo campo com nome tem uma etapa correspondente", () => {
    // Sem isto, um campo novo apareceria numa mensagem e o assistente tentaria
    // navegar para `undefined`.
    const campos = new Set();
    for (const texto of [
      'violates check constraint "knowledge_documents_path_check2"',
      "knowledge title required",
      "content_markdown exceeds",
      "personal knowledge cannot be assigned to collections",
      "published external knowledge requires an external collection",
    ]) {
      const { campo } = mensagemDeGravacao(doPostgrest(texto));
      if (campo) campos.add(campo);
    }
    for (const campo of campos) expect(ETAPA_DO_CAMPO[campo]).toBeTypeOf("number");
  });
});
