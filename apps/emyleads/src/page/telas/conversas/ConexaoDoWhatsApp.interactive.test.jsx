// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * A empresa nova que ainda não tem WhatsApp: antes, o spinner "Consultando a
 * conexão…" para sempre. Agora, o pedido; depois do pedido, "preparando".
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gateway = { solicitar: vi.fn() };
vi.mock("../../../data/client", () => ({ api: { gateway } }));

const { EstadoVazioConversas } = await import("./ConexaoDoWhatsApp");
const { FASES, resumirConexao } = await import("../conexoes/estadoDaConexao");

let raiz;
let container;

async function montar(elemento) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(elemento));
}

async function digitar(input, valor) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Corpo em bloco de propósito: função devolvida pelo beforeEach vira rotina
// de limpeza, e o Vitest chamaria o próprio mock depois de cada teste.
beforeEach(() => {
  gateway.solicitar.mockReset();
});
afterEach(async () => {
  await act(async () => raiz?.unmount());
  container?.remove();
});

describe("empresa sem WhatsApp", () => {
  it("dono vê o pedido e o número vai para o provedor", async () => {
    const aoPedir = vi.fn();
    gateway.solicitar.mockResolvedValue({ connectionId: "c1", created: true });
    await montar(<EstadoVazioConversas carregado resumo={null} podeGerenciar organizationId="org-1" aoPedirConexao={aoPedir} />);

    expect(container.textContent).toContain("Conecte o WhatsApp da empresa");
    expect(container.textContent).not.toContain("Consultando a conexão");
    const botao = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Conectar meu WhatsApp"));
    expect(botao.disabled).toBe(true);

    await digitar(container.querySelector("input[type=tel]"), "(65) 99217-8164");
    expect(botao.disabled).toBe(false);
    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => {});

    expect(gateway.solicitar).toHaveBeenCalledWith({ organizationId: "org-1", telefone: "(65) 99217-8164" });
    expect(aoPedir).toHaveBeenCalledTimes(1);
  });

  it("a recusa do servidor aparece na tela", async () => {
    gateway.solicitar.mockRejectedValue(new Error("O seu plano já tem todas as conexões de WhatsApp que ele permite."));
    await montar(<EstadoVazioConversas carregado resumo={null} podeGerenciar organizationId="org-1" />);
    await digitar(container.querySelector("input[type=tel]"), "65992178164");
    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => {});
    expect(container.querySelector("[role=alert]").textContent).toContain("todas as conexões");
  });

  it("atendente não vê o formulário", async () => {
    await montar(<EstadoVazioConversas carregado resumo={null} podeGerenciar={false} organizationId="org-1" />);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Quem administra a empresa");
  });

  it("antes da primeira leitura, ainda consulta", async () => {
    await montar(<EstadoVazioConversas carregado={false} resumo={null} podeGerenciar organizationId="org-1" />);
    expect(container.textContent).toContain("Consultando a conexão");
  });
});

describe("pedido feito, VPS ainda sem runtime", () => {
  const pedida = {
    connectionId: "c1",
    runtime: "runtime_offline",
    controlPlane: null,
    remoteManaged: false,
    expectedPhoneMasked: "•••• 8164",
    connection: { status: "created", expectedPhoneMasked: "•••• 8164", phoneMasked: null },
  };

  it("é 'preparando', não 'o serviço caiu'", async () => {
    const resumo = resumirConexao(pedida);
    expect(resumo.fase).toBe(FASES.PREPARANDO);
    expect(resumo.detalhe).toContain("final 8164");
    await montar(<EstadoVazioConversas carregado resumo={resumo} podeGerenciar organizationId="org-1" />);
    expect(container.textContent).toContain("Estamos preparando o seu WhatsApp");
  });

  it("uma conexão que já deu sinal e parou continua sendo 'runtime parado'", () => {
    const caiu = { ...pedida, controlPlane: { heartbeat_at: "2026-09-19T10:00:00Z", fresh: false }, remoteManaged: true };
    expect(resumirConexao(caiu).fase).toBe(FASES.RUNTIME_PARADO);
    const major = { ...pedida, controlPlane: null, connection: { ...pedida.connection, status: "connected" } };
    expect(resumirConexao(major).fase).toBe(FASES.RUNTIME_PARADO);
  });
});
