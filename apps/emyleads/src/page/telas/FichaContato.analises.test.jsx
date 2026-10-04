// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  conversas: {
    listar: vi.fn(),
    mensagens: vi.fn(),
    analises: vi.fn(),
    analise: vi.fn(),
    creditosDeAnalise: vi.fn(),
    pedirAnalise: vi.fn(),
    salvarAnalise: vi.fn(),
  },
  tarefas: { criar: vi.fn() },
  agenda: { criar: vi.fn() },
}));
vi.mock("../../data/client", () => ({ api }));

import FichaContato from "./FichaContato";
import { esquecerConversasDosLeads } from "./leads/useConversasDosLeads";

let container;
let root;
const render = async (elemento) => {
  await act(async () => root.render(elemento));
  await act(async () => {});
  await act(async () => {});
};
const clicar = async (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

const contato = { id: "k1", nome: "Rodrigo Alves", telefone: "5565999990001", lead_at: "2026-09-20T12:00:00Z", leadEm: Date.now() };
const conversa = { id: "conn:5565999990001", nome: "Rodrigo Alves", telefone: "5565999990001", ultimaMensagemEm: Date.now() };
const props = (extra = {}) => ({
  contato,
  negocios: [],
  tarefas: [],
  notas: [],
  eventos: [],
  estagios: [],
  aoFechar: vi.fn(),
  aoEditar: vi.fn(),
  ...extra,
});

beforeEach(() => {
  esquecerConversasDosLeads();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(api.conversas).forEach((fn) => fn.mockReset());
  api.conversas.listar.mockResolvedValue([conversa]);
  api.conversas.mensagens.mockResolvedValue([]);
  api.conversas.creditosDeAnalise.mockResolvedValue({ limit: 30, used: 2, left: 28, renewsAt: "2026-10-22T00:00:00Z" });
  api.conversas.analises.mockResolvedValue([
    { id: "a1", kind: "completa", status: "done", result: { schema_version: "analysis_report.v2", summary: "Lead bom." },
      completed_at: "2026-10-04T12:00:00Z", saved_at: "2026-10-04T12:05:00Z", service_score: 45 },
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("As análises da conversa na ficha do lead", () => {
  it("o lead com conversa mostra as análises e o botão de analisar", async () => {
    await render(<FichaContato {...props({ podeAnalisar: true })} />);
    const bloco = document.body.querySelector('[data-analise-da-conversa="ficha"]');
    expect(bloco).toBeTruthy();
    expect(bloco.textContent).toContain("Análise da conversa");
    expect(bloco.textContent).toContain("Completa");
    expect(api.conversas.analises).toHaveBeenCalledWith({ id: conversa.id });
    expect([...bloco.querySelectorAll("button")].some((b) => b.textContent.trim() === "Analisar conversa")).toBe(true);
  });

  it("abrir uma análise salva abre o relatório, mesmo sem a tela de Conversas", async () => {
    api.conversas.analise.mockResolvedValue({
      analysisId: "a1", kind: "completa", status: "done", result: { schema_version: "analysis_report.v2", summary: "Lead bom." },
      completedAt: "2026-10-04T12:00:00Z", savedAt: "2026-10-04T12:05:00Z",
      report: { schema_version: "analysis.v2", kind: "completa", vendedor_score: null, lead_score: null, matrix: { key: "sem_conclusao" }, diagnosis: { summary: "Lead bom." }, red_flags: [] },
    });
    await render(<FichaContato {...props({ podeAnalisar: false })} />);
    const item = [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Completa ·"));
    await clicar(item);
    await act(async () => {});
    expect(api.conversas.analise).toHaveBeenCalledWith({ analiseId: "a1" });
    expect(document.body.querySelector('[role="dialog"]').textContent).toContain("Análise completa");
    // Sem a conversa aberta, não há "usar na conversa" nem "ver evidência".
    expect(document.body.textContent).not.toContain("Usar na conversa");
  });

  it("lead sem conversa não mostra o bloco", async () => {
    api.conversas.listar.mockResolvedValue([]);
    await render(<FichaContato {...props({ podeAnalisar: true })} />);
    expect(document.body.querySelector("[data-analise-da-conversa]")).toBeNull();
  });

  it("quem não é dono nem admin vê só as salvas, sem o botão de pedir", async () => {
    await render(<FichaContato {...props({ podeAnalisar: false })} />);
    const bloco = document.body.querySelector('[data-analise-da-conversa="ficha"]');
    expect(bloco.textContent).toContain("Completa");
    expect([...bloco.querySelectorAll("button")].some((b) => b.textContent.trim() === "Analisar conversa")).toBe(false);
    expect(api.conversas.creditosDeAnalise).not.toHaveBeenCalled();
  });
});
