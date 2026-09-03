import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import AssistenteConhecimento from "./AssistenteConhecimento";
import { ETAPAS } from "./assistenteEstado";

/**
 * Render de servidor, como em `EditorDocumento.test.jsx`: não há jsdom neste
 * projeto, então o que dá para verificar é o primeiro quadro. Os efeitos não
 * rodam, e a navegação entre etapas está coberta pelos testes de
 * `assistenteEstado`, que é onde a regra mora.
 */
const base = {
  inteligencia: { collections: [] },
  documentos: [],
  aoFechar() {},
  aoSalvar() {},
  salvando: false,
};

const render = (extra = {}) => renderToStaticMarkup(<AssistenteConhecimento {...base} {...extra} />);

function instalarStorage(conteudo = null) {
  const dados = new Map(conteudo ? [["nucleo:conhecimento:rascunho", conteudo]] : []);
  globalThis.localStorage = {
    getItem: (chave) => (dados.has(chave) ? dados.get(chave) : null),
    setItem: (chave, valor) => dados.set(chave, String(valor)),
    removeItem: (chave) => dados.delete(chave),
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe("quatro etapas, não cinco", () => {
  it("a trilha do celular conta até quatro", () => {
    instalarStorage();
    expect(ETAPAS).toHaveLength(4);
    expect(render({ modeloId: "empresa" })).toContain("Etapa 2 de 4");
  });

  it("a etapa que sobrou não se chama mais “Onde”", () => {
    // "Onde" só tinha conteúdo para o público Clientes; nos outros dois era
    // uma tela que não escrevia nada. A pergunta virou parte de "Quem usa".
    instalarStorage();
    const html = render({ modeloId: "empresa" });
    expect(html).toContain("Conteúdo");
    expect(html).not.toMatch(/>Onde</);
  });
});

describe("a falha de gravação aparece dentro do modal", () => {
  it("rende o alerta com a mensagem traduzida", () => {
    // Antes, o banner ficava no corpo da página, atrás deste overlay: publicar
    // com erro não mostrava absolutamente nada.
    instalarStorage();
    const html = render({
      modeloId: "empresa",
      falha: { mensagem: "O caminho do arquivo não é válido.", campo: "caminho", sinal: 1 },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("O caminho do arquivo não é válido.");
  });

  it("sem falha não há alerta nenhum", () => {
    instalarStorage();
    expect(render({ modeloId: "empresa" })).not.toContain('role="alert"');
  });
});

describe("o rascunho que sobreviveu à aba fechada", () => {
  const guardado = (patch = {}) => JSON.stringify({
    estado: { etapa: 2, modeloId: "empresa", titulo: "Regras comerciais", texto: "Aceitamos Pix." },
    salvoEm: Date.now(),
    ...patch,
  });

  it("é oferecido pelo título, com quando foi", () => {
    instalarStorage(guardado());
    const html = render({ modeloId: "empresa" });
    expect(html).toContain("Regras comerciais");
    expect(html).toContain("Retomar");
    expect(html).toContain("Descartar");
  });

  it("sem rascunho guardado não oferece nada", () => {
    instalarStorage();
    expect(render({ modeloId: "empresa" })).not.toContain("Retomar");
  });

  it("rascunho velho demais não é oferecido", () => {
    instalarStorage(guardado({ salvoEm: Date.now() - 30 * 86400000 }));
    expect(render({ modeloId: "empresa" })).not.toContain("Retomar");
  });

  it("storage indisponível não derruba o assistente", () => {
    // Janela anônima e cookies bloqueados lançam na leitura. Um assistente que
    // não abre por causa do rascunho troca um conforto por um bloqueio.
    globalThis.localStorage = {
      getItem() { throw new Error("negado"); },
      setItem() { throw new Error("negado"); },
      removeItem() { throw new Error("negado"); },
    };
    expect(() => render({ modeloId: "empresa" })).not.toThrow();
  });
});

describe("o caminho do arquivo saiu do fluxo básico", () => {
  it("a etapa de conteúdo não pede caminho nenhum", () => {
    instalarStorage();
    const html = render({ modeloId: "empresa" });
    expect(html).not.toContain("Caminho do arquivo");
    expect(html).not.toContain("empresa/sobre.md");
  });
});
