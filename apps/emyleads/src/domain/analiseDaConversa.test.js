import { describe, expect, it } from "vitest";
import {
  analiseDoBanco,
  creditosEmTexto,
  emAndamento,
  impedimentoDaSugestao,
  motivoDaFalha,
  prazoDaSugestao,
  semCreditos,
} from "./analiseDaConversa";

describe("créditos de análise", () => {
  it("diz o saldo e o dia da renovação", () => {
    const texto = creditosEmTexto({ limit: 30, used: 18, left: 12, renewsAt: "2026-10-15T03:00:00Z" });
    expect(texto).toBe("12 de 30 análises · renova 15/10");
  });

  it("limite nulo é ilimitado; sem dados, nada", () => {
    expect(creditosEmTexto({ limit: null, used: 4, left: null })).toBe("Análises ilimitadas");
    expect(creditosEmTexto(null)).toBe("");
  });

  it("sem crédito só quando há limite e o saldo zerou", () => {
    expect(semCreditos({ limit: 30, left: 0 })).toBe(true);
    expect(semCreditos({ limit: 30, left: 1 })).toBe(false);
    expect(semCreditos({ limit: null, left: null })).toBe(false);
    expect(semCreditos(null)).toBe(false);
  });
});

describe("andamento e falha", () => {
  it("pendente e lendo continuam; o resto terminou", () => {
    expect(emAndamento("pending")).toBe(true);
    expect(emAndamento("running")).toBe(true);
    expect(emAndamento("done")).toBe(false);
    expect(emAndamento("failed")).toBe(false);
  });

  it("todo código vira frase, inclusive o desconhecido", () => {
    expect(motivoDaFalha("analysis_account_missing")).toMatch(/conta de análise/);
    expect(motivoDaFalha("expired")).toMatch(/WhatsApp/);
    expect(motivoDaFalha("algo_novo")).toMatch(/Tente de novo/);
  });

  it("a resposta do banco ganha os nomes da tela; resultado vazio é nada", () => {
    const analise = analiseDoBanco({ analysisId: "a1", kind: "comercial", status: "expired", result: {}, credits: { limit: 30 } });
    expect(analise).toMatchObject({ id: "a1", tipo: "comercial", situacao: "expired", resultado: null, creditos: { limit: 30 } });
    expect(analiseDoBanco({ id: "a2", status: "done", result: { resumo: "x" }, saved_at: "2026-10-02" }))
      .toMatchObject({ id: "a2", resultado: { resumo: "x" }, salvaEm: "2026-10-02" });
  });
});

describe("prazo das sugestões", () => {
  it("vence às 9h, N dias depois", () => {
    const agora = new Date(2026, 9, 2, 14, 30);
    const prazo = prazoDaSugestao(2, agora);
    expect([prazo.getDate(), prazo.getHours(), prazo.getMinutes()]).toEqual([4, 9, 0]);
  });

  it("hoje, depois das 9h, vira daqui a uma hora; teto de 30 dias", () => {
    const agora = new Date(2026, 9, 2, 14, 30);
    expect(prazoDaSugestao(0, agora).getTime()).toBe(agora.getTime() + 60 * 60 * 1000);
    expect(prazoDaSugestao(99, agora).getDate()).toBe(1);
  });
});

describe("o que impede aplicar uma sugestão", () => {
  const estagios = [{ id: "e1", nome: "Lead" }, { id: "e2", nome: "Em contato" }];
  const etiquetas = [{ id: "t1", nome: "Lead quente" }];
  const contato = { id: "c1", tags: ["t1"] };

  it("etapa precisa de negócio, de etapa existente e de mudança", () => {
    const sugestao = { tipo: "etapa", valor: "em contato" };
    expect(impedimentoDaSugestao(sugestao, { contato, negocio: null, estagios })).toMatch(/negócio/);
    expect(impedimentoDaSugestao(sugestao, { contato, negocio: { stageId: "e2" }, estagios })).toMatch(/já está/);
    expect(impedimentoDaSugestao(sugestao, { contato, negocio: { stageId: "e1" }, estagios })).toBe("");
    expect(impedimentoDaSugestao({ tipo: "etapa", valor: "Sumiu" }, { contato, negocio: { stageId: "e1" }, estagios })).toMatch(/não existe/);
  });

  it("etiqueta, tarefa e compromisso precisam de contato; etiqueta repetida não", () => {
    expect(impedimentoDaSugestao({ tipo: "tarefa", valor: "x" }, { contato: null })).toMatch(/Crie o lead/);
    expect(impedimentoDaSugestao({ tipo: "etiqueta", valor: "lead quente" }, { contato, etiquetas })).toMatch(/já tem/);
    expect(impedimentoDaSugestao({ tipo: "etiqueta", valor: "Nova" }, { contato, etiquetas })).toBe("");
  });
});
