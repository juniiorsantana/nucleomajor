// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * O portão do painel: sem sessão, o login; logado sem ser da administração,
 * "Acesso restrito" e nada mais; da administração, as telas.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = { estado: vi.fn(), entrar: vi.fn(), sair: vi.fn() };
const plataforma = {
  estado: vi.fn(),
  empresas: vi.fn(),
  empresa: vi.fn(),
  planosDoPainel: vi.fn(),
  historico: vi.fn(),
  planos: vi.fn(),
  vendas: vi.fn(),
  pedidosDeConexao: vi.fn(),
};
vi.mock("../data/client", () => ({ api: { auth, plataforma } }));

// O menu (`Rail`) pergunta a largura da tela; o jsdom não sabe responder.
window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const { default: PainelApp, caminhoDaRota, rotaDoCaminho } = await import("./PainelApp");

let raiz;
let container;

async function montar(caminho = "/", aoNavegar = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(<PainelApp caminho={caminho} aoNavegar={aoNavegar} />));
  await act(async () => {});
  return aoNavegar;
}

async function digitar(input, valor) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  for (const fn of [...Object.values(auth), ...Object.values(plataforma)]) fn.mockReset();
  plataforma.empresas.mockResolvedValue([]);
  plataforma.historico.mockResolvedValue([]);
  plataforma.planos.mockResolvedValue([]);
  plataforma.vendas.mockResolvedValue([]);
  plataforma.pedidosDeConexao.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => raiz?.unmount());
  container?.remove();
});

describe("rotas", () => {
  it("ida e volta entre caminho e tela", () => {
    expect(rotaDoCaminho("/")).toEqual({ tela: "empresas", id: null });
    expect(rotaDoCaminho("/empresas/abc")).toEqual({ tela: "empresa", id: "abc" });
    expect(rotaDoCaminho("/historico")).toEqual({ tela: "historico", id: null });
    expect(rotaDoCaminho("/qualquer")).toEqual({ tela: "empresas", id: null });
    expect(caminhoDaRota({ tela: "empresa", id: "abc" })).toBe("/empresas/abc");
    expect(caminhoDaRota({ tela: "empresas" })).toBe("/");
    expect(caminhoDaRota({ tela: "vendas" })).toBe("/vendas");
  });
});

describe("portão", () => {
  it("sem sessão, pede login e entra", async () => {
    auth.estado.mockResolvedValueOnce(null).mockResolvedValue({ usuario: { email: "cmo@majorhub.com.br" } });
    auth.entrar.mockResolvedValue({});
    plataforma.estado.mockResolvedValue({ administrador: true });
    await montar();

    expect(container.textContent).toContain("Painel da plataforma");
    await digitar(container.querySelector("input[type=email]"), "cmo@majorhub.com.br");
    await digitar(container.querySelector("input[type=password]"), "segredo");
    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => {});

    expect(auth.entrar).toHaveBeenCalledWith({ email: "cmo@majorhub.com.br", senha: "segredo" });
    expect(container.textContent).toContain("Empresas");
    expect(plataforma.empresas).toHaveBeenCalled();
  });

  it("logado sem ser da administração: acesso restrito e nenhuma leitura do painel", async () => {
    auth.estado.mockResolvedValue({ usuario: { email: "cliente@exemplo.com" } });
    plataforma.estado.mockResolvedValue({ administrador: false });
    await montar();

    expect(container.textContent).toContain("Acesso restrito");
    expect(container.textContent).toContain("cliente@exemplo.com");
    expect(plataforma.empresas).not.toHaveBeenCalled();

    auth.sair.mockResolvedValue({ ok: true });
    const sair = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Sair"));
    await act(async () => sair.click());
    expect(auth.sair).toHaveBeenCalled();
    expect(container.querySelector("input[type=password]")).not.toBeNull();
  });

  it("da administração: o menu navega pelas telas", async () => {
    auth.estado.mockResolvedValue({ usuario: { email: "cmo@majorhub.com.br" } });
    plataforma.estado.mockResolvedValue({ administrador: true });
    const aoNavegar = await montar("/");
    const historico = [...container.querySelectorAll("nav button")].find((b) => b.textContent.includes("Histórico"));
    await act(async () => historico.click());
    expect(aoNavegar).toHaveBeenCalledWith("/historico");
  });
});
