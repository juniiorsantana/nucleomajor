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

const { default: ChatbotEditor, cadeadoDoBloco } = await import("./ChatbotEditor");

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

const SO_CHATBOT = { chatbots: true };
const COM_IA = { chatbots: true, ai_customer: true };

// Um fluxo salvo quando a empresa ainda tinha IA: mensagem, IA, e a Falha vai
// para a equipe.
const FLUXO_COM_IA = {
  id: "44444444-4444-4444-8444-444444444444",
  nome: "Boas-vindas com IA",
  ativo: true,
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "oi", tipo: "enviar_mensagem", texto: "Oi" },
    { id: "ia", tipo: "transferir", destino: "ia", alvoIa: "reception", objetivoIa: "Qualificar", motivo: "" },
    { id: "fim", tipo: "encerrar" },
    { id: "equipe", tipo: "transferir", destino: "humano", motivo: "" },
  ],
  canvas: {
    versao: 3,
    nos: [],
    conexoes: [
      { source: "entrada", saida: "padrao", target: "condicoes" },
      { source: "condicoes", saida: "padrao", target: "oi" },
      { source: "oi", saida: "padrao", target: "ia" },
      { source: "ia", saida: "sucesso", target: "fim" },
      { source: "ia", saida: "falha", target: "equipe" },
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
const nosDeAcao = () => container.querySelectorAll(".flow-node--acao").length;
const clicar = async (elemento) => {
  await act(async () => {
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const botaoSalvar = () => [...container.querySelectorAll("button")].find((botao) => /Salvar fluxo/.test(botao.textContent));

describe("o cadeado de cada bloco (Etapa 10)", () => {
  it("a lista única decide o cadeado da paleta", () => {
    expect(cadeadoDoBloco({ id: "atalho_ia", tipo: "transferir", destino: "ia" }, SO_CHATBOT)).toMatch(/IA atendendo clientes/);
    expect(cadeadoDoBloco({ id: "atalho_ia", tipo: "transferir", destino: "ia" }, COM_IA)).toBeNull();
    expect(cadeadoDoBloco({ id: "transferir", tipo: "transferir" }, SO_CHATBOT)).toBeNull();
    // Sem o plano lido, nada tranca: a trava de verdade é a do banco.
    expect(cadeadoDoBloco({ id: "atalho_ia", tipo: "transferir", destino: "ia" }, null)).toBeNull();
  });

  it("sem IA, “Passar para a IA” aparece com cadeado e o motivo, e não entra no mapa", async () => {
    await abrir({ recursos: SO_CHATBOT });
    const bloco = blocoDaPaleta("Passar para a IA");
    expect(bloco).toBeTruthy();
    expect(bloco.getAttribute("aria-disabled")).toBe("true");
    expect(bloco.getAttribute("draggable")).toBeNull();
    expect(bloco.textContent).toMatch(/IA atendendo clientes/);
    expect(bloco.querySelector('[aria-label="Bloco com cadeado"]')).not.toBeNull();
    const antes = nosDeAcao();
    await clicar(bloco);
    expect(nosDeAcao()).toBe(antes);
  });

  it("os outros blocos seguem livres no plano só com chatbot", async () => {
    await abrir({ recursos: SO_CHATBOT });
    for (const titulo of ["Enviar mensagem", "Pedir para escolher", "Aguardar", "Transferir conversa", "Encerrar"]) {
      expect(blocoDaPaleta(titulo)?.getAttribute("aria-disabled"), titulo).toBeNull();
    }
  });

  it("com IA, “Passar para a IA” entra no mapa já com Sucesso e Falha", async () => {
    await abrir({ recursos: COM_IA });
    const bloco = blocoDaPaleta("Passar para a IA");
    expect(bloco.getAttribute("aria-disabled")).toBeNull();
    const antes = nosDeAcao();
    await clicar(bloco);
    expect(nosDeAcao()).toBe(antes + 1);
    expect(container.textContent).toContain("Sucesso");
    expect(container.textContent).toContain("Falha");
  });

  it("no painel, o destino IA fica trancado com o motivo", async () => {
    await abrir({ recursos: SO_CHATBOT });
    await clicar(blocoDaPaleta("Transferir conversa"));
    const destino = [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "ia"));
    const opcaoIa = [...destino.options].find((o) => o.value === "ia");
    expect(opcaoIa.disabled).toBe(true);
    expect(opcaoIa.textContent).toMatch(/cadeado/);
    expect(container.textContent).toMatch(/IA atendendo clientes/);
  });

  it("o fluxo antigo com IA mostra o bloco com cadeado no mapa", async () => {
    await abrir({ chatbot: FLUXO_COM_IA, recursos: SO_CHATBOT });
    expect(container.querySelector(".flow-node__cadeado")?.getAttribute("title")).toMatch(/IA atendendo clientes/);
    expect(container.textContent).toContain("Bloco com cadeado");
  });

  it("salvar o fluxo antigo sem mudar o desenho passa (como no banco)", async () => {
    await abrir({ chatbot: FLUXO_COM_IA, recursos: SO_CHATBOT });
    await clicar(botaoSalvar());
    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("mudar o desenho de um fluxo com cadeado é recusado com o motivo, antes de ir ao banco", async () => {
    await abrir({ chatbot: FLUXO_COM_IA, recursos: SO_CHATBOT });
    // Trocar o gatilho muda a definição, como mexer num bloco.
    const gatilho = [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "manual"));
    await act(async () => {
      gatilho.value = "manual";
      gatilho.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await clicar(botaoSalvar());
    expect(atualizar).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Este fluxo usa um bloco com cadeado/);
  });

  it("religar um fluxo com cadeado é recusado; desligado ele salva", async () => {
    await abrir({ chatbot: { ...FLUXO_COM_IA, ativo: false }, recursos: SO_CHATBOT });
    await clicar(botaoSalvar());
    expect(atualizar).toHaveBeenCalledTimes(1);
    await clicar(container.querySelector('[role="switch"]'));
    await clicar(botaoSalvar());
    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(container.textContent).toMatch(/IA atendendo clientes/);
  });

  it("com IA, o mesmo fluxo salva normalmente", async () => {
    await abrir({ chatbot: FLUXO_COM_IA, recursos: COM_IA });
    expect(container.querySelector(".flow-node__cadeado")).toBeNull();
    await clicar(botaoSalvar());
    expect(atualizar).toHaveBeenCalledTimes(1);
  });
});
