// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../data/client", () => ({
  api: {
    inteligencia: { carregar: async () => ({ skills: [], campaigns: [] }) },
    chatbots: { criar: vi.fn(), atualizar: vi.fn() },
  },
}));

const { PerguntaEditor } = await import("./ChatbotEditor");

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const SO_CHATBOT = { chatbots: true };
const COM_IA = { chatbots: true, ai_customer: true };
const passo = (extra = {}) => ({
  id: "menu", tipo: "perguntar", texto: "Como ajudo?", tentativas: 2, prazoHoras: 24,
  opcoes: [{ id: "a", rotulo: "Agendar", sinonimos: [] }], ...extra,
});
const desenha = (props) => act(() => root.render(<PerguntaEditor aoMudar={() => {}} {...props} />));
const caixa = () => container.querySelector('input[type="checkbox"]');

describe("Usar IA quando não entender (Etapa 9)", () => {
  it("aparece para quem tem IA e marca a pergunta", () => {
    const aoMudar = vi.fn();
    desenha({ passo: passo(), recursos: COM_IA, aoMudar });
    expect(container.textContent).toContain("Usar IA quando não entender");
    expect(caixa().checked).toBe(false);
    act(() => caixa().click());
    expect(aoMudar).toHaveBeenCalledWith(expect.objectContaining({ iaQuandoNaoEntende: true }));
  });

  it("não aparece para quem só tem chatbot, nem com o plano ainda não lido", () => {
    desenha({ passo: passo(), recursos: SO_CHATBOT });
    expect(caixa()).toBeNull();
    desenha({ passo: passo(), recursos: null });
    expect(caixa()).toBeNull();
  });

  it("pergunta já marcada numa empresa sem IA mostra o cadeado e deixa desmarcar", () => {
    const aoMudar = vi.fn();
    desenha({ passo: passo({ iaQuandoNaoEntende: true }), recursos: SO_CHATBOT, aoMudar });
    expect(container.textContent).toMatch(/IA atendendo clientes.*Desmarque para salvar/);
    expect(caixa().disabled).toBe(false);
    act(() => caixa().click());
    expect(aoMudar).toHaveBeenCalledWith(expect.objectContaining({ iaQuandoNaoEntende: false }));
  });
});
