// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const criar = vi.fn(async () => ({}));
vi.mock("../../data/client", () => ({
  api: {
    inteligencia: { carregar: async () => ({ skills: [], campaigns: [{ id: "33333333-3333-4333-8333-333333333333", name: "Planos do Site", status: "active" }] }) },
    chatbots: { criar, atualizar: vi.fn(async () => ({})) },
  },
}));

const { default: ChatbotEditor } = await import("./ChatbotEditor");

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  globalThis.DOMMatrixReadOnly ??= class { constructor() { this.m22 = 1; } };
});

let container;
let root;
beforeEach(() => {
  criar.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function abrir(props = {}) {
  await act(async () => {
    root.render(<ChatbotEditor chatbot={null} tags={[]} estagios={[]} recarregar={async () => {}} aoFechar={() => {}} {...props} />);
  });
}

const seletorDeGatilho = () =>
  [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "palavra"));

describe("o início do fluxo no editor", () => {
  it("abre no cartão de início, com o gatilho e as condições", async () => {
    await abrir({ ramificado: true });
    expect(container.textContent).toContain("Início do fluxo");
    expect(container.textContent).toContain("O fluxo começa quando");
    expect(container.textContent).toContain("Condições");
    const valores = [...seletorDeGatilho().options].map((o) => o.value);
    expect(valores).toEqual(["mensagem", "palavra", "manual", "etiqueta", "etapa", "campanha"]);
  });

  it("no formato sem caminhos, só mensagem e palavra", async () => {
    await abrir({ ramificado: false });
    expect([...seletorDeGatilho().options].map((o) => o.value)).toEqual(["mensagem", "palavra"]);
  });

  it("gatilho manual esconde as condições e explica o follow-up", async () => {
    await abrir({ ramificado: true });
    await act(async () => {
      const select = seletorDeGatilho();
      select.value = "manual";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Iniciar fluxo");
    expect(container.textContent).not.toContain("Adicionar condição");
  });

  it("a paleta oferece os blocos que perguntam só com caminhos", async () => {
    await abrir({ ramificado: true });
    expect(container.textContent).toContain("Pedir para escolher");
    expect(container.textContent).toContain("Pedir para digitar");
    expect(container.textContent).toContain("Aguardar");
  });

  it("o bloco Aguardar só existe com caminhos", async () => {
    await abrir({ ramificado: false });
    expect(container.textContent).not.toContain("Espera e segue sozinho");
  });
});
