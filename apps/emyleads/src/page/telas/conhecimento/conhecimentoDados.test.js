import { describe, expect, it } from "vitest";
import {
  DIAS_PARA_REVISAR,
  diasSemAlteracao,
  filtrar,
  precisaRevisao,
  publicoDoDocumento,
  resumo,
  resumoDoConteudo,
  situacaoDoDocumento,
  tempoRelativo,
} from "./conhecimentoDados";

const AGORA = Date.parse("2026-08-28T12:00:00.000Z");
const diasAtras = (dias) => new Date(AGORA - dias * 86400000).toISOString();

const documento = (patch = {}) => ({
  id: "doc",
  titulo: "Sobre a Major Hub",
  caminho: "empresa/sobre.md",
  conteudo: "",
  escopo: "organization",
  audiencia: "internal",
  publicadoEm: diasAtras(1),
  atualizadoEm: diasAtras(1),
  ...patch,
});

describe("publicoDoDocumento", () => {
  it("chama de Clientes o que tem audiência externa", () => {
    expect(publicoDoDocumento(documento({ audiencia: "external" }))).toBe("clientes");
  });

  it("chama de Equipe o interno de organização", () => {
    expect(publicoDoDocumento(documento())).toBe("equipe");
  });

  it("o escopo pessoal vence a audiência", () => {
    // Um documento pessoal nunca é conteúdo de cliente, mesmo que a audiência
    // tenha ficado 'external' por algum caminho antigo de gravação.
    expect(publicoDoDocumento(documento({ escopo: "personal", audiencia: "external" }))).toBe("pessoal");
  });
});

describe("situacaoDoDocumento", () => {
  it("sem publicadoEm é rascunho", () => {
    expect(situacaoDoDocumento(documento({ publicadoEm: null }))).toBe("rascunho");
  });

  it("com publicadoEm é publicado, inclusive no conteúdo interno", () => {
    // O eixo é independente do público: interno também pode estar publicado.
    expect(situacaoDoDocumento(documento({ audiencia: "internal" }))).toBe("publicado");
  });
});

describe("precisaRevisao", () => {
  it("marca o publicado parado há mais que o limite", () => {
    expect(precisaRevisao(documento({ atualizadoEm: diasAtras(DIAS_PARA_REVISAR + 4) }), AGORA)).toBe(true);
  });

  it("não marca o que está dentro do limite", () => {
    expect(precisaRevisao(documento({ atualizadoEm: diasAtras(DIAS_PARA_REVISAR - 1) }), AGORA)).toBe(false);
  });

  it("nunca cobra revisão de rascunho", () => {
    // Rascunho parado não está no ar; avisar sobre ele seria só barulho.
    const parado = documento({ publicadoEm: null, atualizadoEm: diasAtras(400) });
    expect(precisaRevisao(parado, AGORA)).toBe(false);
  });

  it("conta os dias sem alteração a partir de atualizadoEm", () => {
    expect(diasSemAlteracao(documento({ atualizadoEm: diasAtras(34) }), AGORA)).toBe(34);
  });
});

describe("resumo", () => {
  const acervo = [
    documento({ id: "1", audiencia: "external" }),
    documento({ id: "2", audiencia: "external", publicadoEm: null }),
    documento({ id: "3" }),
    documento({ id: "4", atualizadoEm: diasAtras(34) }),
    documento({ id: "5", escopo: "personal", publicadoEm: null }),
  ];

  it("conta cada eixo separadamente", () => {
    const total = resumo(acervo, AGORA);
    expect(total).toMatchObject({
      todos: 5, clientes: 2, equipe: 2, pessoal: 1, rascunhos: 2, publicados: 3, revisao: 1,
    });
  });

  it("um documento pode contar em público e em situação ao mesmo tempo", () => {
    // Os dois eixos são independentes: a soma de rascunhos + publicados dá o
    // total, e a soma dos públicos também. Eles não se dividem entre si.
    const total = resumo(acervo, AGORA);
    expect(total.clientes + total.equipe + total.pessoal).toBe(total.todos);
    expect(total.rascunhos + total.publicados).toBe(total.todos);
  });
});

describe("filtrar", () => {
  const acervo = [
    documento({ id: "1", titulo: "Perguntas frequentes", audiencia: "external" }),
    documento({ id: "2", titulo: "Regras comerciais", atualizadoEm: diasAtras(40) }),
    documento({ id: "3", titulo: "Modelo de proposta", escopo: "personal", publicadoEm: null }),
  ];

  it("todos devolve o acervo inteiro", () => {
    expect(filtrar(acervo, { filtro: "todos", agora: AGORA })).toHaveLength(3);
  });

  it("filtra por público", () => {
    expect(filtrar(acervo, { filtro: "clientes", agora: AGORA }).map((d) => d.id)).toEqual(["1"]);
  });

  it("filtra por situação", () => {
    expect(filtrar(acervo, { filtro: "rascunhos", agora: AGORA }).map((d) => d.id)).toEqual(["3"]);
  });

  it("filtra por revisão pendente", () => {
    expect(filtrar(acervo, { filtro: "revisao", agora: AGORA }).map((d) => d.id)).toEqual(["2"]);
  });

  it("a busca soma ao filtro em vez de substituir", () => {
    // Buscar dentro de "Clientes" não pode devolver documento de outro público.
    const achados = filtrar(acervo, { filtro: "clientes", busca: "regras", agora: AGORA });
    expect(achados).toHaveLength(0);
  });

  it("busca sem acento de caixa alta no título e no conteúdo", () => {
    const achados = filtrar(acervo, { filtro: "todos", busca: "PERGUNTAS", agora: AGORA });
    expect(achados.map((d) => d.id)).toEqual(["1"]);
  });
});

describe("resumoDoConteudo", () => {
  it("pula o título e devolve a primeira frase de verdade", () => {
    const texto = "# Sobre a Major Hub\n\n## Quem é a empresa\n\nA Major Hub é uma agência de Cuiabá.";
    expect(resumoDoConteudo(texto)).toBe("A Major Hub é uma agência de Cuiabá.");
  });

  it("aceita lista como primeira linha útil, sem o marcador", () => {
    expect(resumoDoConteudo("# Serviços\n\n- Gestão de tráfego pago")).toBe("Gestão de tráfego pago");
  });

  it("devolve vazio quando só há títulos", () => {
    expect(resumoDoConteudo("# Um\n\n## Dois")).toBe("");
  });
});

describe("tempoRelativo", () => {
  it.each([
    [0.0002, "agora"],
    [0.02, "há 28 min"],
    [0.1, "há 2 horas"],
    [1, "ontem"],
    [3, "há 3 dias"],
    [16, "há 2 semanas"],
    [34, "há 1 mês"],
  ])("%s dias vira %s", (dias, esperado) => {
    expect(tempoRelativo(diasAtras(dias), AGORA)).toBe(esperado);
  });

  it("devolve vazio para data inválida", () => {
    expect(tempoRelativo(null, AGORA)).toBe("");
  });
});
