// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * A administração saiu de Configurações e foi para o painel da plataforma.
 * Aqui sobra só a porta, e só para quem é da administração.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plataforma = { estado: vi.fn() };
vi.mock("../../data/client", () => ({ api: { plataforma } }));

const { AtalhoDoPainel, enderecoDoPainel } = await import("./Configuracoes");

let raiz;
let container;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(<AtalhoDoPainel />));
  await act(async () => {});
}

beforeEach(() => {
  plataforma.estado.mockReset();
  delete globalThis.__NUCLEO_CONFIG__;
});

afterEach(async () => {
  await act(async () => raiz?.unmount());
  container?.remove();
  delete globalThis.__NUCLEO_CONFIG__;
});

describe("atalho do painel da plataforma", () => {
  it("o administrador vê o link para o painel, e nada do cartão antigo", async () => {
    plataforma.estado.mockResolvedValue({ administrador: true });
    await montar();
    const link = container.querySelector("a");
    expect(link.getAttribute("href")).toBe("https://painel.nucleomajor.com");
    expect(link.textContent).toContain("Abrir o painel");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Gerar liberação");
  });

  it("quem não é da plataforma não vê nada", async () => {
    plataforma.estado.mockResolvedValue({ administrador: false });
    await montar();
    expect(container.textContent).toBe("");
  });

  it("falha ao consultar também não mostra nada", async () => {
    plataforma.estado.mockRejectedValue(new Error("rede"));
    await montar();
    expect(container.textContent).toBe("");
  });

  it("o endereço vem da configuração do servidor quando existe", () => {
    globalThis.__NUCLEO_CONFIG__ = { painelOrigin: "https://painel.exemplo.invalido/" };
    expect(enderecoDoPainel()).toBe("https://painel.exemplo.invalido");
  });
});
