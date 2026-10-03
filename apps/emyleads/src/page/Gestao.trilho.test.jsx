// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it, vi } from "vitest";

// O portal (web), e não a extensão: é no portal que Conversas existe. A
// bancada local roda como extensão e por isso não mostra o ícone; este teste
// garante que no portal ele está lá, e em primeiro.
vi.stubGlobal("__EMYLEADS_PLATFORM__", "web");

vi.mock("../data/client", () => {
  const pendente = () => new Promise(() => {});
  const grupo = new Proxy({}, { get: () => pendente });
  return { api: new Proxy({}, { get: () => grupo }), chamar: pendente };
});

window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const { default: Gestao } = await import("./Gestao");

afterAll(() => vi.unstubAllGlobals());

describe("trilho do portal", () => {
  it("Conversas é o primeiro destino, e a organização não ocupa o trilho", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Gestao sessao={{ usuario: { id: "u1" }, organizacaoAtual: null, acesso: { recursos: null } }} />);
    });

    const trilho = container.querySelector('nav[aria-label="Navegação principal"]');
    const destinos = [...trilho.querySelectorAll("button[aria-label]")]
      .map((b) => b.getAttribute("aria-label"))
      .filter((rotulo) => rotulo !== "Buscar nesta tela");

    expect(destinos[0]).toBe("Conversas");
    expect(destinos).toEqual(expect.arrayContaining(["Leads", "Campanhas", "Funil", "Relatórios", "Tarefas", "Agenda", "Equipe de IA", "Fluxos"]));
    for (const daOrganizacao of ["Conexões", "Equipe", "Configurações"]) expect(destinos).not.toContain(daOrganizacao);

    act(() => root.unmount());
    container.remove();
  });
});
