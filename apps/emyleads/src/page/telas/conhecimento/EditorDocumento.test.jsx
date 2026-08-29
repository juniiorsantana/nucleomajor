import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EditorDocumento from "./EditorDocumento";

const documento = {
  id: "doc-1",
  escopo: "personal",
  audiencia: "internal",
  titulo: "Minha referência",
  caminho: "pessoal/referencia.md",
  conteudo: "# Minha referência\n\n## Nota\n\nTexto.\n",
  colecoesIds: [],
  publicadoEm: null,
  versao: 1,
};

const propriedades = {
  rascunho: documento,
  aoMudar() {},
  podeEscrever: true,
  podeGerenciarEmpresa: false,
  inteligencia: { collections: [] },
  impedimento: null,
  exigeColecao: false,
  salvando: false,
  salvoEm: "2026-08-28T20:00:00.000Z",
  aoSalvar() {},
  aoVerHistorico() {},
  aoArquivar() {},
  aoVoltar() {},
};

describe("estado de salvamento do editor", () => {
  it("não afirma que está salvo quando há alterações locais", () => {
    const html = renderToStaticMarkup(<EditorDocumento {...propriedades} alterado />);
    expect(html).toContain("alterações não salvas");
    expect(html).not.toContain("salvo há");
  });

  it("mostra o último salvamento quando o rascunho está limpo", () => {
    const html = renderToStaticMarkup(<EditorDocumento {...propriedades} alterado={false} />);
    expect(html).toMatch(/salvo (agora|há|ontem)/);
  });
});
