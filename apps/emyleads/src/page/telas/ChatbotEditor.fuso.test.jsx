// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

// Um fluxo gravado com o horário de Recife. A empresa, depois, passou para
// Manaus: a regra gravada não pode mudar de sentido.
const FLUXO_DE_RECIFE = {
  id: "55555555-5555-4555-8555-555555555555",
  nome: "Horário comercial",
  ativo: true,
  condicoes: [{ tipo: "janela_de_horario", inicio: "08:00", fim: "18:00", fuso: "America/Recife" }],
  passos: [{ id: "oi", tipo: "enviar_mensagem", texto: "Oi" }, { id: "fim", tipo: "encerrar" }],
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

async function abrir(props = {}) {
  await act(async () => {
    root.render(<ChatbotEditor chatbot={null} tags={[]} estagios={[]} recarregar={async () => {}} aoFechar={() => {}} ramificado {...props} />);
  });
}

const blocoDaPaleta = (titulo) =>
  [...container.querySelectorAll("aside section button")].find((botao) => botao.querySelector("strong")?.textContent === titulo);
const seletorDeFuso = () =>
  [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "America/Noronha"));
const seletorDeRegra = () =>
  [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "dia_da_semana"));
const botaoSalvar = () => [...container.querySelectorAll("button")].find((botao) => /Salvar fluxo/.test(botao.textContent));
const clicar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("o fuso da empresa no editor (Etapa 4, variante segura)", () => {
  it("a regra nova de horário nasce no fuso da empresa", async () => {
    await abrir({ fuso: "America/Manaus" });
    await clicar(blocoDaPaleta("Horário"));
    expect(seletorDeFuso().value).toBe("America/Manaus");
  });

  it("sem o fuso da empresa, nasce em São Paulo, como antes", async () => {
    await abrir();
    await clicar(blocoDaPaleta("Dias da semana"));
    expect(seletorDeFuso().value).toBe("America/Sao_Paulo");
  });

  it("trocar o tipo da regra para dia da semana também usa o fuso da empresa", async () => {
    await abrir({ fuso: "America/Cuiaba" });
    await clicar(blocoDaPaleta("Tem etiqueta"));
    const tipo = seletorDeRegra();
    await act(async () => {
      tipo.value = "dia_da_semana";
      tipo.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(seletorDeFuso().value).toBe("America/Cuiaba");
  });

  it("o fluxo gravado salva com o fuso que já tinha, não com o da empresa", async () => {
    await abrir({ chatbot: FLUXO_DE_RECIFE, fuso: "America/Manaus" });
    await clicar(botaoSalvar());
    expect(atualizar, container.querySelector("[role=alert]")?.textContent || container.textContent.slice(0, 400)).toHaveBeenCalledTimes(1);
    const enviado = JSON.stringify(atualizar.mock.calls[0]);
    expect(enviado).toContain("America/Recife");
    expect(enviado).not.toContain("America/Manaus");
  });
});
