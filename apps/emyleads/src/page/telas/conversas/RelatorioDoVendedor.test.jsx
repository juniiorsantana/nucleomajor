// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  tarefas: { criar: vi.fn() },
  agenda: { criar: vi.fn() },
}));
vi.mock("../../../data/client", () => ({ api }));

import { RelatorioDoVendedor } from "./RelatorioDoVendedor";

let container;
let root;
const render = async (elemento) => {
  await act(async () => root.render(elemento));
};
const botao = (texto) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === texto);
const clicar = async (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

const ponto = (key, weight, status, points, extra = {}) => ({ key, name: key, weight, status, points_awarded: points, ...extra });

// O exemplo do canvas: 39,2 de 88 = 45, Atrapalhou a venda.
const RELATORIO = {
  schema_version: "analysis.v2",
  seller: { kind: "equipe", authorId: null, label: "Equipe · pelo celular" },
  speed: { state: "bom", firstResponseBusinessMinutes: 4 },
  vendedor_score: {
    score: 45, max_score: 100, evaluated_weight: 88, max_weight: 100, coverage: 88, conclusive: true,
    band: "atrapalhou", band_label: "Atrapalhou a venda",
    criteria: [
      ponto("speed", 8, "bom", 8, { critique: "Respondeu em 4 minutos." }),
      ponto("advance", 16, "critico", 0, {
        state: "continuacao", critique: "Terminou em 'fico à disposição'.",
        better: "Te ligo amanhã às 19h para mostrar a simulação para vocês dois?", evidence_message_ids: ["m3"],
      }),
      ponto("close", 12, "nao_avaliado", null),
      ponto("diagnosis", 14, "atencao", 8.4, { critique: "Só perguntas de situação.", better: "Hoje você paga aluguel?" }),
      ponto("objection", 12, "ruim", 2.4),
      ponto("leads", 12, "ruim", 2.4),
      ponto("follow_up", 10, "ruim", 2),
      ponto("empathy", 8, "bom", 8),
      ponto("promises", 8, "bom", 8, { state: "cumpriu" }),
    ],
  },
  diagnosis: {
    summary: "Atendeu rápido, mas não vendeu.",
    verdict: "Atendeu rápido e com educação, mas não vendeu: deixou o cliente sem caminho.",
    did_well: [{ title: "Respondeu em 4 minutos", evidence_message_ids: ["m1"] }],
    cost_the_sale: [{ title: "Aceitou o 'vou ver com minha esposa'", evidence_message_ids: ["m3"] }],
    what_to_do_now: [{ priority: "alta", action_type: "reply", title: "Retomar com o casal", instruction: "Propor 15 minutos", reason: "", due_at: null, evidence_message_ids: [] }],
    suggested_message: { applicable: true, text: "Que tal 15 minutos com vocês dois amanhã às 19h?" },
  },
  red_flags: [{ code: "conversation_left_open", severity: null, criterion: "advance", reason: "Sem compromisso com data.", evidence_message_ids: [] }],
};
const analise = { id: "a2", situacao: "done", relatorio: RELATORIO, resultado: { schema_version: "analysis_report.v2", ...RELATORIO.diagnosis } };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("RelatorioDoVendedor", () => {
  it("mostra a nota, a faixa e quem atendeu", async () => {
    await render(<RelatorioDoVendedor analise={analise} nome="Rodrigo" />);
    const texto = container.textContent;
    expect(container.querySelector("[data-faixa]").textContent).toBe("Atrapalhou a venda");
    expect(texto).toContain("88% avaliado");
    expect(texto).toContain("Fez 39,2 dos 88 pontos que dava para avaliar.");
    expect(container.querySelector("[data-vendedor]").textContent).toBe("Equipe · pelo celular");
    expect(texto).toContain("sem dizer quem escreveu");
    expect(texto).toContain("Primeira resposta em 4 min de horário comercial.");
  });

  it("dá o veredito, o que fez bem e o que custou a venda", async () => {
    await render(<RelatorioDoVendedor analise={analise} />);
    const texto = container.textContent;
    expect(texto).toContain("deixou o cliente sem caminho");
    expect(texto).toContain("O que fez bem");
    expect(texto).toContain("Respondeu em 4 minutos");
    expect(texto).toContain("Aceitou o 'vou ver com minha esposa'");
    expect(texto).toContain("Terminou sem compromisso com data");
  });

  it("os 9 pontos, do que mais custou ao que foi bem, com o livro e a reescrita", async () => {
    await render(<RelatorioDoVendedor analise={analise} />);
    const ordem = [...container.querySelectorAll("[data-ponto]")].map((linha) => linha.getAttribute("data-ponto"));
    expect(ordem.slice(0, 2)).toEqual(["advance", "objection"]);
    expect(ordem.at(-1)).toBe("close");
    const avanco = container.querySelector('[data-ponto="advance"]').textContent;
    expect(avanco).toContain("Avanço com data");
    expect(avanco).toContain("SPIN Selling · Rackham");
    expect(avanco).toContain("Ficou em aberto");
    expect(avanco).toContain("0 / 16");
    expect(avanco).toContain("Te ligo amanhã às 19h");
    expect(container.querySelector('[data-ponto="diagnosis"]').textContent).toContain("8,4 / 14");
    const fechamento = container.querySelector('[data-ponto="close"]').textContent;
    expect(fechamento).toContain("Não avaliado");
    expect(fechamento).toContain("Não conta contra");
    expect(fechamento).toContain("—");
    expect(container.querySelector('[data-ponto="speed"]').textContent).toContain("Manter.");
    expect(container.textContent).toContain("39,2 ÷ 88 = 45");
  });

  it("nota com pouca coisa avaliada não ganha faixa", async () => {
    const pouco = { ...RELATORIO, vendedor_score: { ...RELATORIO.vendedor_score, score: 81, coverage: 30, conclusive: false, band: "vendeu_bem" } };
    await render(<RelatorioDoVendedor analise={{ ...analise, relatorio: pouco }} />);
    expect(container.querySelector("[data-faixa]").textContent).toBe("Não conclusiva");
    expect(container.textContent).toContain("ainda não é conclusiva");
  });

  it("a evidência leva à mensagem e a mensagem sugerida vai para a conversa", async () => {
    const aoVerMensagem = vi.fn(() => true);
    const aoUsarMensagem = vi.fn();
    const aoFechar = vi.fn();
    await render(<RelatorioDoVendedor analise={analise} podeAgir aoVerMensagem={aoVerMensagem} aoUsarMensagem={aoUsarMensagem} aoFechar={aoFechar} />);
    const evidencia = [...container.querySelectorAll('[data-ponto="advance"] button')].find((b) => b.textContent.includes("Ver evidência"));
    await clicar(evidencia);
    expect(aoVerMensagem).toHaveBeenCalledWith("m3");
    await clicar(botao("Usar na conversa"));
    expect(aoUsarMensagem).toHaveBeenCalledWith("Que tal 15 minutos com vocês dois amanhã às 19h?");
    expect(aoFechar).toHaveBeenCalled();
  });
});

// A Análise Completa (20261010100000): a nota do lead e o veredito do cruzamento.
const LEAD = {
  score: 83, max_score: 100, evaluated_weight: 95, max_weight: 100, coverage: 95, conclusive: true, band: "bom", band_label: "Bom",
  criteria: [
    ponto("need", 20, "bom", 20, { state: "sim" }),
    ponto("decision", 15, "atencao", 9, { state: "outra_pessoa", reason: "Precisa ver com a esposa.", evidence_message_ids: ["m2"] }),
    ponto("fit", 5, "nao_avaliado", null),
    ponto("objection", 10, "atencao", 6, { state: "contornavel" }),
  ],
};
const COMPLETA = {
  ...RELATORIO,
  kind: "completa",
  credits: 2,
  lead_score: LEAD,
  matrix: { key: "em_risco", label: "Oportunidade em risco", lead_good: true, service_good: false },
  diagnosis: {
    ...RELATORIO.diagnosis,
    lead_verdict: "Quer comprar e tem pressa, mas depende da esposa.",
    matrix_explanation: "Lead bom e atendimento abaixo do corte: venda escorrendo.",
  },
};

describe("RelatorioDoVendedor na Análise Completa", () => {
  it("as duas notas e o veredito do cruzamento, com a casa marcada", async () => {
    await render(<RelatorioDoVendedor analise={{ ...analise, relatorio: COMPLETA }} />);
    expect(container.querySelector("[data-faixa]").textContent).toBe("Atrapalhou a venda");
    expect(container.querySelector("[data-faixa-lead]").textContent).toBe("Bom");
    expect(container.querySelector("[data-veredito]").textContent).toBe("Oportunidade em risco");
    expect(container.textContent).toContain("venda escorrendo");
    expect(container.querySelector('[data-casa="em_risco"]').getAttribute("aria-current")).toBe("true");
    expect(container.querySelector('[data-casa="avancar"]').getAttribute("aria-current")).toBeNull();
    expect(container.querySelector("[data-veredito-lead]").textContent).toContain("depende da esposa");
    // Os dois lados: os 9 pontos do vendedor e os pontos do lead.
    expect(container.querySelector('[data-ponto="advance"]')).toBeTruthy();
    const decisao = container.querySelector('[data-ponto-lead="decision"]').textContent;
    expect(decisao).toContain("Quem decide");
    expect(decisao).toContain("Depende de outra pessoa");
    expect(decisao).toContain("9 / 15");
    expect(decisao).toContain("Precisa ver com a esposa.");
    expect(container.querySelector('[data-ponto-lead="fit"]').textContent).toContain("Não avaliado");
    expect(container.textContent).toContain("Faixas do lead");
  });

  it("sem base, o quadro não marca casa nenhuma", async () => {
    const semBase = { ...COMPLETA, matrix: { key: "sem_conclusao", label: "Ainda sem conclusão" }, diagnosis: { ...COMPLETA.diagnosis, matrix_explanation: null } };
    await render(<RelatorioDoVendedor analise={{ ...analise, relatorio: semBase }} />);
    expect(container.querySelector("[data-veredito]").textContent).toBe("Ainda sem conclusão");
    expect(container.querySelectorAll('[data-casa][aria-current="true"]').length).toBe(0);
    expect(container.textContent).toContain("menos de 50%");
  });

  it("análise do lead mostra só o lead", async () => {
    const soLead = { ...COMPLETA, kind: "lead", matrix: null };
    await render(<RelatorioDoVendedor analise={{ ...analise, relatorio: soLead }} />);
    expect(container.querySelector("[data-faixa-lead]").textContent).toBe("Bom");
    expect(container.querySelector("[data-faixa]")).toBeNull();
    expect(container.querySelector('[data-ponto="advance"]')).toBeNull();
    expect(container.querySelector("[data-veredito]")).toBeNull();
    expect(container.querySelector('[data-ponto-lead="need"]')).toBeTruthy();
    expect(container.textContent).not.toContain("Faixas do vendedor");
  });

  it("análise de atendimento na v3 não mostra o lead", async () => {
    await render(<RelatorioDoVendedor analise={{ ...analise, relatorio: { ...COMPLETA, kind: "atendimento", matrix: null } }} />);
    expect(container.querySelector("[data-faixa-lead]")).toBeNull();
    expect(container.querySelector('[data-ponto-lead="need"]')).toBeNull();
    expect(container.querySelector("[data-faixa]")).toBeTruthy();
  });
});
