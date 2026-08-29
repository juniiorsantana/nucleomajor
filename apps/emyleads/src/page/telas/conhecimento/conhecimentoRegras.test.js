import { describe, expect, it } from "vitest";
import {
  colecaoAutomatica,
  colecoesExternasDisponiveis,
  exigeColecaoExterna,
  motivoParaNaoPublicar,
} from "./conhecimentoRegras";

const COLECOES = [
  { id: "c-ext", name: "Atendimento ao cliente", audience: "external", scope_type: "organization" },
  { id: "c-camp", name: "Captação agosto", audience: "external", scope_type: "campaign" },
  { id: "c-int", name: "Processos internos", audience: "internal", scope_type: "organization" },
  { id: "c-pes", name: "Minhas referências", audience: "external", scope_type: "personal" },
];

const rascunho = (partes = {}) => ({ escopo: "organization", audiencia: "internal", colecoesIds: [], ...partes });

describe("quando a coleção externa é obrigatória", () => {
  it("exige coleção só quando o público é externo", () => {
    expect(exigeColecaoExterna(rascunho({ audiencia: "external" }))).toBe(true);
    expect(exigeColecaoExterna(rascunho({ audiencia: "internal" }))).toBe(false);
  });

  it("não exige nada do escopo pessoal, que nunca vira externo", () => {
    // A tela força audiencia: "internal" ao salvar um documento pessoal.
    // Se a regra não soubesse disso, travaria o salvamento de um rascunho
    // pessoal que por acaso tivesse "external" no estado.
    expect(exigeColecaoExterna(rascunho({ escopo: "personal", audiencia: "external" }))).toBe(false);
  });

  it("aguenta rascunho ausente", () => {
    expect(exigeColecaoExterna(null)).toBe(false);
    expect(motivoParaNaoPublicar(null, COLECOES)).toBeNull();
  });
});

describe("quais coleções podem receber conteúdo de cliente", () => {
  it("aceita externas de organização e de campanha, recusa interna e pessoal", () => {
    expect(colecoesExternasDisponiveis(COLECOES).map((c) => c.id)).toEqual(["c-ext", "c-camp"]);
  });

  it("devolve lista vazia quando não há coleção nenhuma", () => {
    expect(colecoesExternasDisponiveis([])).toEqual([]);
    expect(colecoesExternasDisponiveis()).toEqual([]);
  });
});

describe("o que impede publicar", () => {
  it("libera documento interno sem coleção", () => {
    expect(motivoParaNaoPublicar(rascunho(), COLECOES)).toBeNull();
  });

  it("barra externo sem coleção e diz o que fazer", () => {
    const motivo = motivoParaNaoPublicar(rascunho({ audiencia: "external" }), COLECOES);
    expect(motivo).toMatch(/Escolha ao menos uma coleção externa/);
  });

  it("libera externo assim que uma coleção é marcada", () => {
    expect(motivoParaNaoPublicar(rascunho({ audiencia: "external", colecoesIds: ["c-ext"] }), COLECOES)).toBeNull();
  });

  it("manda criar a coleção quando a empresa não tem nenhuma", () => {
    // Texto diferente de propósito: aqui não existe botão para clicar nesta
    // tela, e pedir "escolha uma" faria a pessoa procurar o que não existe.
    const motivo = motivoParaNaoPublicar(rascunho({ audiencia: "external" }), [COLECOES[2]]);
    expect(motivo).toMatch(/Central de Inteligência/);
  });
});

describe("coleção marcada automaticamente", () => {
  it("marca sozinha quando só existe uma externa", () => {
    expect(colecaoAutomatica("external", [COLECOES[0], COLECOES[2]])).toEqual(["c-ext"]);
  });

  it("não escolhe por conta própria quando há mais de uma", () => {
    expect(colecaoAutomatica("external", COLECOES)).toEqual([]);
  });

  it("não marca nada ao voltar para interno", () => {
    expect(colecaoAutomatica("internal", COLECOES)).toEqual([]);
  });
});
