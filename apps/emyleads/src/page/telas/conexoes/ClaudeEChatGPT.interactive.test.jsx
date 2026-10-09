// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * O bloco "Claude e ChatGPT" de Conexões. A fronteira mockada é
 * `../../../data/client`, como nas outras telas.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = { auth: { aplicativosConectados: vi.fn(), desconectarAplicativo: vi.fn() } };
vi.mock("../../../data/client", () => ({ api }));

const { ClaudeEChatGPT, enderecoDoMcp } = await import("./ClaudeEChatGPT");

const ENDERECO = "https://nucleomajor.com/mcp";
let raiz;
let container;

beforeEach(() => {
  api.auth.aplicativosConectados.mockReset();
  api.auth.desconectarAplicativo.mockReset();
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
});

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(<ClaudeEChatGPT endereco={ENDERECO} />));
  await act(async () => {});
}

const botao = (texto) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === texto);

describe("ClaudeEChatGPT", () => {
  it("o endereço vem da origem pública do portal", () => {
    expect(enderecoDoMcp({ publicOrigin: "https://nucleomajor.com/" }, { origin: "http://localhost:5173" })).toBe(ENDERECO);
    expect(enderecoDoMcp({}, { origin: "http://localhost:5173" })).toBe("http://localhost:5173/mcp");
  });

  it("sem nada conectado: endereço, passos dos dois aplicativos e 'Nenhum ainda'", async () => {
    api.auth.aplicativosConectados.mockResolvedValue({ liberado: true, aplicativos: [] });
    await montar();

    expect(container.querySelector("#endereco-mcp").value).toBe(ENDERECO);
    expect(container.textContent).toContain("Não conectado");
    expect(container.textContent).toContain("Adicionar conector personalizado");
    expect(container.textContent).toContain("Nenhum ainda.");
    expect(container.querySelector("a[href='https://claude.ai']")).not.toBeNull();

    await act(async () => botao("ChatGPT").click());
    expect(botao("ChatGPT").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Modo desenvolvedor");
    expect(container.querySelector("a[href='https://chatgpt.com']")).not.toBeNull();
  });

  it("copiar põe o endereço na área de transferência", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    api.auth.aplicativosConectados.mockResolvedValue({ liberado: true, aplicativos: [] });
    await montar();

    await act(async () => botao("Copiar").click());
    expect(writeText).toHaveBeenCalledWith(ENDERECO);
    expect(botao("Copiado")).toBeDefined();
  });

  it("conectado: mostra o aplicativo e desconecta pelo id", async () => {
    api.auth.aplicativosConectados
      .mockResolvedValueOnce({ liberado: true, aplicativos: [{ id: "c1", nome: "Claude", desde: "2026-10-09T15:00:00Z" }] })
      .mockResolvedValueOnce({ liberado: true, aplicativos: [] });
    api.auth.desconectarAplicativo.mockResolvedValue({ ok: true });
    await montar();

    expect(container.textContent).toContain("Conectado em 09/10");
    await act(async () => botao("Desconectar").click());
    expect(api.auth.desconectarAplicativo).toHaveBeenCalledWith({ clientId: "c1" });
    expect(container.textContent).toContain("Nenhum ainda.");
    expect(container.textContent).toContain("Não conectado");
  });

  it("desconectar que falha mostra a falha e mantém o aplicativo na lista", async () => {
    api.auth.aplicativosConectados.mockResolvedValue({ liberado: true, aplicativos: [{ id: "c1", nome: "ChatGPT", desde: null }] });
    api.auth.desconectarAplicativo.mockRejectedValue(new Error("Não foi possível desconectar o aplicativo. Tente de novo."));
    await montar();

    await act(async () => botao("Desconectar").click());
    expect(container.querySelector("[role=alert]").textContent).toContain("Não foi possível desconectar");
    expect(container.textContent).toContain("ChatGPT");
    expect(botao("Desconectar").disabled).toBe(false);
  });

  it("OAuth ainda desligado: avisa em vez de mostrar passos que falhariam", async () => {
    api.auth.aplicativosConectados.mockResolvedValue({ liberado: false, aplicativos: [] });
    await montar();

    expect(container.textContent).toContain("Ainda não liberado");
    expect(container.textContent).toContain("ainda não foi liberado");
    expect(container.querySelector("#endereco-mcp")).toBeNull();
  });

  it("lista que não carrega: passos continuam e dá para tentar de novo", async () => {
    api.auth.aplicativosConectados
      .mockRejectedValueOnce(new Error("Não foi possível ver os aplicativos conectados agora."))
      .mockResolvedValueOnce({ liberado: true, aplicativos: [{ id: "c1", nome: "Claude", desde: null }] });
    await montar();

    expect(container.querySelector("#endereco-mcp")).not.toBeNull();
    expect(container.textContent).toContain("Não foi possível conferir agora.");
    await act(async () => botao("Tentar de novo").click());
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("Conectado");
  });
});
