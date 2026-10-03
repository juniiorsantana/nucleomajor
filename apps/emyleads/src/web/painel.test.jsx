// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAVE_DO_PAINEL, guardarPainel, outroPainel, painelEscolhido } from "./painel";
import { TrocaDePainel } from "./TrocaDePainel";

const memoria = () => {
  const dados = new Map();
  return { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)) };
};

describe("a escolha do painel", () => {
  it("sem escolha abre o antigo; a escolha guardada vale", () => {
    const armazenamento = memoria();
    expect(painelEscolhido({ url: "https://nucleomajor.com/app/conversas", armazenamento })).toBe("antigo");
    guardarPainel("novo", armazenamento);
    expect(painelEscolhido({ url: "https://nucleomajor.com/app/conversas", armazenamento })).toBe("novo");
  });

  it("?painel= na URL escolhe e guarda; valor estranho é ignorado", () => {
    const armazenamento = memoria();
    expect(painelEscolhido({ url: "https://nucleomajor.com/app/?painel=novo", armazenamento })).toBe("novo");
    expect(armazenamento.getItem(CHAVE_DO_PAINEL)).toBe("novo");
    expect(painelEscolhido({ url: "https://nucleomajor.com/app/?painel=azul", armazenamento })).toBe("novo");
    guardarPainel("qualquer", armazenamento);
    expect(painelEscolhido({ url: "https://nucleomajor.com/app/", armazenamento })).toBe("antigo");
  });

  it("navegador que não guarda nada continua abrindo", () => {
    const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    expect(painelEscolhido({ url: "https://nucleomajor.com/app/", armazenamento: quebrado })).toBe("antigo");
    expect(painelEscolhido({ url: "https://nucleomajor.com/app/?painel=novo", armazenamento: quebrado })).toBe("novo");
    expect(outroPainel("novo")).toBe("antigo");
    expect(outroPainel("antigo")).toBe("novo");
  });
});

describe("o botão flutuante", () => {
  let container;
  let root;
  beforeEach(() => {
    // O jsdom daqui não tem armazenamento (origem opaca): um de mentira.
    vi.stubGlobal("localStorage", memoria());
    vi.stubGlobal("sessionStorage", memoria());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("no painel antigo convida para o novo; trocar guarda e recarrega", async () => {
    const aoTrocar = vi.fn();
    await act(async () => root.render(<TrocaDePainel painel="antigo" aoTrocar={aoTrocar} />));
    const botao = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Experimentar o painel novo"));
    await act(async () => botao.click());
    expect(localStorage.getItem(CHAVE_DO_PAINEL)).toBe("novo");
    expect(aoTrocar).toHaveBeenCalledWith("novo");
  });

  it("no painel novo oferece voltar; o X esconde só nesta aba", async () => {
    await act(async () => root.render(<TrocaDePainel painel="novo" aoTrocar={() => {}} />));
    expect(container.textContent).toContain("Voltar ao painel antigo");
    await act(async () => container.querySelector('button[aria-label="Esconder este botão"]').click());
    expect(container.querySelector("[data-troca-de-painel]")).toBeNull();
    expect(sessionStorage.getItem("nucleo.painel.botao")).toBe("escondido");
  });
});
