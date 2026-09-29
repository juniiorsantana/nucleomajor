// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../data/client", () => ({
  api: {
    inteligencia: { carregar: async () => ({ skills: [], campaigns: [] }) },
    chatbots: { criar: vi.fn(async () => ({})), atualizar: vi.fn(async () => ({})) },
  },
}));

const { default: ChatbotEditor, GRUPOS_DA_PALETA, blocosAgrupados } = await import("./ChatbotEditor");
const { NoAcao } = await import("./ChatbotFlowNodes");

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  globalThis.DOMMatrixReadOnly ??= class { constructor() { this.m22 = 1; } };
});

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

const blocos = [
  { id: "enviar_mensagem", grupo: "Falar com o contato", titulo: "Enviar mensagem", descricao: "Responde no WhatsApp" },
  { id: "encerrar", grupo: "Encerrar", titulo: "Encerrar", descricao: "Termina o fluxo aqui" },
  { id: "aguardar", grupo: "Tempo", titulo: "Aguardar", descricao: "Espera e segue sozinho" },
  { id: "condicao", grupo: "Decidir o caminho", titulo: "Condição", descricao: "Segue por Sim ou por Não" },
];

describe("paleta do construtor (design de 14/09)", () => {
  it("agrupa na ordem do design e esconde grupo vazio", () => {
    const grupos = blocosAgrupados(blocos);
    expect(grupos.map((item) => item.grupo)).toEqual(["Falar com o contato", "Decidir o caminho", "Tempo", "Encerrar"]);
    expect(GRUPOS_DA_PALETA[0]).toBe("Falar com o contato");
  });

  it("a busca olha o nome e a descrição, sem diferenciar maiúscula", () => {
    expect(blocosAgrupados(blocos, "SIM").flatMap((item) => item.blocos.map((bloco) => bloco.id))).toEqual(["condicao"]);
    expect(blocosAgrupados(blocos, "espera")[0].blocos[0].id).toBe("aguardar");
    expect(blocosAgrupados(blocos, "nada disso")).toEqual([]);
  });
});

describe("saídas do cartão (design de 14/09)", () => {
  it("numera as saídas e marca como ligada só a que tem destino", async () => {
    await act(async () => {
      root.render(
        <ReactFlowProvider>
          <NoAcao
            data={{
              tipo: "perguntar",
              indice: 1,
              resumo: "Como posso ajudar?",
              saidas: ["op_a", "op_b"],
              rotulos: { op_a: "Agendar", op_b: "Preço" },
              livres: ["op_b"],
            }}
            selected={false}
          />
        </ReactFlowProvider>,
      );
    });
    const linhas = [...container.querySelectorAll(".flow-saida")];
    expect(linhas.map((linha) => linha.querySelector(".flow-saida__num").textContent)).toEqual(["1", "2"]);
    expect(linhas.map((linha) => linha.classList.contains("is-ligada"))).toEqual([true, false]);
    const portas = [...container.querySelectorAll(".flow-port--out")];
    expect(portas.map((porta) => porta.classList.contains("is-ligada"))).toEqual([true, false]);
    expect(container.querySelector(".flow-node--pergunta")).not.toBeNull();
  });
});

describe("editor com o visual do design", () => {
  it("mostra a paleta em grupos, a busca, a barra de zoom e nenhum minimapa", async () => {
    await act(async () => {
      root.render(<ChatbotEditor chatbot={null} tags={[]} estagios={[]} recarregar={async () => {}} aoFechar={() => {}} ramificado />);
    });
    const grupos = [...container.querySelectorAll("aside section[aria-label]")].map((secao) => secao.getAttribute("aria-label"));
    expect(grupos).toEqual(GRUPOS_DA_PALETA);
    expect(container.querySelector('input[aria-label="Buscar bloco"]')).not.toBeNull();
    expect(container.querySelector(".flow-zoom__valor")?.textContent).toMatch(/^\d+%$/);
    expect(container.querySelector('button[aria-label="Aumentar zoom"]')).not.toBeNull();
    expect(container.querySelector(".react-flow__minimap")).toBeNull();
    expect(container.querySelector(".react-flow__controls")).toBeNull();
  });

  it("a busca da paleta filtra os blocos", async () => {
    await act(async () => {
      root.render(<ChatbotEditor chatbot={null} tags={[]} estagios={[]} recarregar={async () => {}} aoFechar={() => {}} ramificado />);
    });
    const busca = container.querySelector('input[aria-label="Buscar bloco"]');
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => {
      definir.call(busca, "horário");
      busca.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const nomes = [...container.querySelectorAll("aside section button strong")].map((item) => item.textContent);
    expect(nomes).toEqual(["Horário"]);
  });
});
