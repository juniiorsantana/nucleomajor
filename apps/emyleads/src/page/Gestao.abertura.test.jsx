// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Toda chamada fica pendente: o portal fica no estado de "carregando", com
// `dados` ainda nulo — foi aí que a leitura de `dados.chatbots` derrubou tudo
// em 23/09/2026 (tela preta ao entrar).
vi.mock("../data/client", () => {
  const pendente = () => new Promise(() => {});
  const grupo = new Proxy({}, { get: () => pendente });
  return { api: new Proxy({}, { get: () => grupo }), chamar: pendente };
});

window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const { default: Gestao } = await import("./Gestao");

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

describe("abrir o portal", () => {
  it("enquanto os dados carregam, a tela abre sem quebrar", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root.render(<Gestao sessao={{ usuario: { nome: "Júnior" }, organizacao: { nome: "Major" }, recursos: null }} />);
    });
    expect(container.textContent).toContain("Carregando");
    expect(erros.mock.calls.map((c) => String(c[0])).join("\n")).not.toMatch(/Cannot read properties of null/);
    erros.mockRestore();
  });
});
