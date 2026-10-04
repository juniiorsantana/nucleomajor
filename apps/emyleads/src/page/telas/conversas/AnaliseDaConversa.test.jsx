// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  conversas: {
    creditosDeAnalise: vi.fn(),
    analises: vi.fn(),
    pedirAnalise: vi.fn(),
    analise: vi.fn(),
    salvarAnalise: vi.fn(),
  },
  negocios: { atualizar: vi.fn() },
  tarefas: { criar: vi.fn() },
  agenda: { criar: vi.fn() },
}));
vi.mock("../../../data/client", () => ({ api }));

import { AnaliseDaConversa, INTERVALO_DO_ANDAMENTO_MS } from "./AnaliseDaConversa";

let container;
let root;
const render = async (elemento) => {
  await act(async () => root.render(elemento));
  await act(async () => {});
};
const botao = (texto) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === texto);
const clicar = async (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

const CREDITOS = { limit: 30, used: 7, left: 23, renewsAt: "2026-10-15T03:00:00Z" };
const RESULTADO = {
  resumo: "Lead morno que perguntou preço.",
  indicadores: { Temperatura: "Morna" },
  porque: [{ texto: "Perguntou preço primeiro", evidencia: "Quanto custa?", quando: "01/10 09:00" }],
  oQueFaltou: ["Não propôs o diagnóstico"],
  proximoPasso: "Propor o diagnóstico com dois horários.",
  sugestoes: [
    { tipo: "etapa", valor: "Em contato", motivo: "já conversou", prazoDias: 0 },
    { tipo: "tarefa", valor: "Ligar amanhã", motivo: "combinado", prazoDias: 1 },
  ],
};
const conversa = { id: "conn:5565999990001", nome: "Lia" };
const contato = { id: "k1", tags: [] };
const negocio = { id: "d1", stageId: "e1" };
const estagios = [{ id: "e1", nome: "Lead" }, { id: "e2", nome: "Em contato" }];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(api).forEach((grupo) => Object.values(grupo).forEach((fn) => fn.mockReset()));
  api.conversas.creditosDeAnalise.mockResolvedValue(CREDITOS);
  api.conversas.analises.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const props = (extra = {}) => ({ conversa, contato, negocio, estagios, etiquetas: [], podePedir: true, ...extra });

describe("o bloco da análise na ficha", () => {
  it("dono vê o botão e o saldo do ciclo", async () => {
    await render(<AnaliseDaConversa {...props()} />);
    expect(botao("Analisar conversa")).toBeTruthy();
    expect(container.textContent).toContain("23 de 30 análises · renova 15/10");
  });

  it("some para a equipe sem análise salva e para o banco sem a migration", async () => {
    await render(<AnaliseDaConversa {...props({ podePedir: false })} />);
    expect(container.textContent).toBe("");
    expect(api.conversas.creditosDeAnalise).not.toHaveBeenCalled();

    api.conversas.creditosDeAnalise.mockRejectedValue(new Error("function does not exist"));
    await render(<AnaliseDaConversa {...props({ conversa: { ...conversa, id: "conn:2" } })} />);
    expect(container.textContent).toBe("");
  });

  it("a equipe vê a análise salva, sem botão de pedir", async () => {
    api.conversas.analises.mockResolvedValue([
      { id: "a1", kind: "comercial", status: "done", result: RESULTADO, completed_at: "2026-10-01T12:00:00Z", saved_at: "2026-10-01T12:05:00Z" },
    ]);
    await render(<AnaliseDaConversa {...props({ podePedir: false })} />);
    expect(container.textContent).toContain("Comercial · 01/10");
    expect(container.textContent).toContain("Salva");
    expect(botao("Analisar conversa")).toBeUndefined();
    await clicar([...container.querySelectorAll("button")][0]);
    expect(document.body.textContent).toContain("Propor o diagnóstico com dois horários.");
    expect(botao("Aplicar")).toBeUndefined();
  });
});

describe("pedir, acompanhar, aplicar e salvar", () => {
  it("pede, segue o andamento até o resultado e aplica a sugestão de etapa", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setInterval", "clearInterval"] });
    api.conversas.pedirAnalise.mockResolvedValue({ analysisId: "a9", status: "pending", credits: { ...CREDITOS, left: 22 } });
    api.conversas.analise.mockResolvedValue({ analysisId: "a9", kind: "comercial", status: "done", result: RESULTADO, completedAt: "2026-10-02T12:00:00Z", credits: { ...CREDITOS, left: 22 } });
    const aoAplicado = vi.fn();
    await render(<AnaliseDaConversa {...props({ aoAplicado })} />);

    await clicar(botao("Analisar conversa"));
    // O banco já descontou: a recarga depois do resultado lê o saldo novo.
    api.conversas.creditosDeAnalise.mockResolvedValue({ ...CREDITOS, left: 22 });
    await clicar(botao("Analisar · usa 2 créditos"));
    expect(api.conversas.pedirAnalise).toHaveBeenCalledWith({ id: conversa.id, tipo: "completa" });
    expect(document.body.textContent).toContain("Lendo a conversa…");

    await act(async () => vi.advanceTimersByTime(INTERVALO_DO_ANDAMENTO_MS));
    await act(async () => {});
    expect(document.body.textContent).toContain("Lead morno que perguntou preço.");
    expect(document.body.textContent).toContain("“Quanto custa?”");
    expect(container.textContent).toContain("22 de 30");

    const [aplicarEtapa] = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Aplicar");
    await clicar(aplicarEtapa);
    expect(api.negocios.atualizar).toHaveBeenCalledWith({ id: "d1", patch: { stageId: "e2" } });
    expect(aoAplicado).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Feito");

    api.conversas.salvarAnalise.mockResolvedValue({ salva: true });
    await clicar(botao("Salvar na ficha"));
    expect(api.conversas.salvarAnalise).toHaveBeenCalledWith({ analiseId: "a9" });
    expect(document.body.textContent).toContain("Salva na ficha");
  });

  it("falha mostra o motivo e avisa que o crédito voltou", async () => {
    api.conversas.analises.mockResolvedValue([]);
    api.conversas.pedirAnalise.mockResolvedValue({ analysisId: "a2", status: "pending", credits: CREDITOS });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    api.conversas.analise.mockResolvedValue({ analysisId: "a2", kind: "comercial", status: "failed", errorCode: "analysis_account_missing" });
    await render(<AnaliseDaConversa {...props()} />);
    await clicar(botao("Analisar conversa"));
    await clicar(botao("Analisar · usa 2 créditos"));
    await act(async () => vi.advanceTimersByTime(INTERVALO_DO_ANDAMENTO_MS));
    await act(async () => {});
    expect(document.body.textContent).toContain("A conta de análise ainda não foi conectada na VPS.");
    expect(document.body.textContent).toContain("O crédito desta análise foi devolvido.");
    expect(botao("Tentar de novo")).toBeTruthy();
  });

  it("sem crédito, o botão de pedir fica travado; recusa do banco aparece", async () => {
    api.conversas.creditosDeAnalise.mockResolvedValue({ ...CREDITOS, left: 0 });
    await render(<AnaliseDaConversa {...props()} />);
    await clicar(botao("Analisar conversa"));
    expect(botao("Analisar · usa 2 créditos").disabled).toBe(true);

    api.conversas.creditosDeAnalise.mockResolvedValue(CREDITOS);
    api.conversas.pedirAnalise.mockRejectedValue(new Error("Esta conversa ainda não tem mensagens para analisar."));
    await render(<AnaliseDaConversa {...props({ conversa: { ...conversa, id: "conn:3" } })} />);
    await clicar(botao("Analisar conversa"));
    await clicar(botao("Analisar · usa 2 créditos"));
    expect(document.body.querySelector('[role="alert"]').textContent).toContain("ainda não tem mensagens");
  });

  it("com 1 crédito, a Completa (2) fica travada e o Lead (1) libera", async () => {
    api.conversas.creditosDeAnalise.mockResolvedValue({ ...CREDITOS, left: 1 });
    await render(<AnaliseDaConversa {...props()} />);
    await clicar(botao("Analisar conversa"));
    expect(document.body.textContent).toContain("as duas + veredito");
    expect(botao("Analisar · usa 2 créditos").disabled).toBe(true);
    await clicar(document.body.querySelector('input[value="lead"]'));
    expect(botao("Analisar · usa 1 crédito").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Comercial");
  });

  it("uma análise pedida antes de recarregar a página continua sendo seguida", async () => {
    api.conversas.analises.mockResolvedValue([{ id: "a5", kind: "atendimento", status: "running", result: {}, requested_at: "2026-10-02T12:00:00Z" }]);
    await render(<AnaliseDaConversa {...props()} />);
    expect(container.textContent).toContain("Analisando… ver");
    expect(botao("Analisar conversa").disabled).toBe(true);
  });
});

describe("Analysis Schema v1 no diálogo", () => {
  const RELATORIO_V1 = {
    schema_version: "analysis.v1",
    lead_score: null,
    atendimento_score: { score: 62, max_score: 100, evaluated_weight: 55, max_weight: 100, label: "62/100 até aqui", criteria: [] },
    diagnosis: { summary: "Conduziu bem, falta o próximo passo.", why_this_score: [], what_to_do_now: [], suggested_message: { applicable: false, text: null }, red_flags: [] },
    red_flags: [],
  };
  const RESULTADO_V1 = { schema_version: "analysis_report.v1", formatVersion: 3, summary: "Conduziu bem, falta o próximo passo." };

  it("análise v1 abre o relatório novo, com a nota do banco", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    api.conversas.pedirAnalise.mockResolvedValue({ analysisId: "v1", status: "pending", credits: CREDITOS });
    api.conversas.analise.mockResolvedValue({ analysisId: "v1", kind: "comercial", status: "done", result: RESULTADO_V1, report: RELATORIO_V1, serviceScore: 62 });
    await render(<AnaliseDaConversa {...props()} />);
    await clicar(botao("Analisar conversa"));
    await clicar(botao("Analisar · usa 2 créditos"));
    await act(async () => vi.advanceTimersByTime(INTERVALO_DO_ANDAMENTO_MS));
    await act(async () => {});
    expect(document.body.textContent).toContain("Nota do atendimento");
    expect(document.body.textContent).toContain("62/100 — 55% dos critérios avaliados");
    expect(document.body.textContent).toContain("Conduziu bem, falta o próximo passo.");
    expect(document.body.textContent).not.toContain("Sugestões");
  });

  it("da lista: mostra a nota e busca o relatório completo ao abrir", async () => {
    api.conversas.analises.mockResolvedValue([
      { id: "v1", kind: "comercial", status: "done", result: RESULTADO_V1, completed_at: "2026-10-03T12:00:00Z", saved_at: "2026-10-03T12:05:00Z", service_score: 62,
        scores: { atendimento: { score: 62, evaluatedWeight: 55, maxWeight: 100 } } },
    ]);
    api.conversas.analise.mockResolvedValue({ analysisId: "v1", kind: "comercial", status: "done", result: RESULTADO_V1, report: RELATORIO_V1, savedAt: "2026-10-03T12:05:00Z" });
    await render(<AnaliseDaConversa {...props()} />);
    expect(container.textContent).toContain("62/100 · 55%");
    await clicar([...container.querySelectorAll("button")].find((b) => b.textContent.includes("Comercial · 03/10")));
    await act(async () => {});
    expect(api.conversas.analise).toHaveBeenCalledWith({ analiseId: "v1" });
    expect(document.body.textContent).toContain("62/100 — 55% dos critérios avaliados");
  });

  it("análise antiga (formato anterior) continua com a tela de antes", async () => {
    api.conversas.analises.mockResolvedValue([
      { id: "a1", kind: "comercial", status: "done", result: RESULTADO, completed_at: "2026-10-01T12:00:00Z", saved_at: "2026-10-01T12:05:00Z" },
    ]);
    api.conversas.analise.mockResolvedValue({ analysisId: "a1", kind: "comercial", status: "done", result: RESULTADO, report: { atendimento_score: null, diagnosis: null } });
    await render(<AnaliseDaConversa {...props()} />);
    await clicar([...container.querySelectorAll("button")][0]);
    await act(async () => {});
    expect(document.body.textContent).toContain("Propor o diagnóstico com dois horários.");
    expect(document.body.textContent).not.toContain("Nota do atendimento");
  });
});
