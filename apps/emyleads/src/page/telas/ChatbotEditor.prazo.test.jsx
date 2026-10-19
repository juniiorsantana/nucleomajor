// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O prazo da execução parada (20261018150000): um fluxo que não anda fecha
// sozinho depois dele. Vazio, vale o da empresa.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const criar = vi.fn(async () => ({}));
const atualizar = vi.fn(async () => ({}));
vi.mock("../../data/client", () => ({
  api: {
    inteligencia: { carregar: async () => ({ skills: [], campaigns: [] }) },
    chatbots: { criar, atualizar },
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
  atualizar.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const FLUXO = {
  id: "44444444-4444-4444-8444-444444444444",
  nome: "Boas-vindas",
  ativo: true,
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "oi", tipo: "enviar_mensagem", texto: "Oi" },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: {
    versao: 3,
    nos: [],
    conexoes: [
      { source: "entrada", saida: "padrao", target: "condicoes" },
      { source: "condicoes", saida: "padrao", target: "oi" },
      { source: "oi", saida: "padrao", target: "fim" },
    ],
  },
};

async function abrir(chatbot, ramificado = true) {
  await act(async () => {
    root.render(
      <ChatbotEditor chatbot={chatbot} tags={[]} estagios={[]} recarregar={async () => {}} aoFechar={() => {}}
        ramificado={ramificado} recursos={{ chatbots: true }} />,
    );
  });
}

const campo = () => container.querySelector('input[aria-label="Horas até o fluxo parado fechar sozinho"]');
const botaoSalvar = () => [...container.querySelectorAll("button")].find((botao) => /Salvar fluxo/.test(botao.textContent));
const digitar = async (input, valor) => {
  const definir = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    definir.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const salvar = async () => {
  await act(async () => {
    botaoSalvar().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("o prazo da execução parada no editor", () => {
  it("aparece no início do fluxo com caminhos, vazio quando o fluxo não diz", async () => {
    await abrir(FLUXO);
    expect(campo()).not.toBeNull();
    expect(campo().value).toBe("");
    expect(campo().placeholder).toBe("24");
  });

  it("não aparece no fluxo sem caminhos", async () => {
    await abrir({ ...FLUXO, canvas: { versao: 2, nos: [], conexoes: [] } }, false);
    expect(campo()).toBeNull();
  });

  it("grava o prazo como número", async () => {
    await abrir(FLUXO);
    await digitar(campo(), "6");
    await salvar();
    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(atualizar.mock.calls[0][0].patch.prazoExecucaoHoras).toBe(6);
  });

  it("apagar o campo tira o prazo do fluxo (volta o da empresa)", async () => {
    await abrir({ ...FLUXO, prazoExecucaoHoras: 12 });
    expect(campo().value).toBe("12");
    await digitar(campo(), "");
    await salvar();
    const patch = atualizar.mock.calls[0][0].patch;
    expect("prazoExecucaoHoras" in patch).toBe(true);
    expect(patch.prazoExecucaoHoras).toBeUndefined();
    expect(JSON.parse(JSON.stringify(patch))).not.toHaveProperty("prazoExecucaoHoras");
  });

  it("recusa o prazo fora de 1 a 720 horas, com o motivo, sem gravar", async () => {
    await abrir(FLUXO);
    await digitar(campo(), "721");
    await salvar();
    expect(atualizar).not.toHaveBeenCalled();
    expect(container.textContent).toContain("entre 1 e 720 horas");
  });
});
