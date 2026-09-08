// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRolagemConversa } from "./useRolagemConversa";

let container;
let root;
let controle;

function Harness({ conversaId, mensagens }) {
  controle = useRolagemConversa(conversaId, mensagens);
  return null;
}

function renderizar(conversaId, mensagens) {
  act(() => {
    root.render(<Harness conversaId={conversaId} mensagens={mensagens} />);
  });
}

function caixaDeRolagem({ altura = 500, visivel = 100, topo = 0 } = {}) {
  return {
    clientHeight: visivel,
    scrollHeight: altura,
    scrollTop: topo,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  controle = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("rolagem da conversa", () => {
  it("abre uma conversa diretamente na mensagem mais recente", () => {
    renderizar(null, []);
    const caixa = caixaDeRolagem();
    controle.rolagem.current = caixa;

    renderizar("conversa-1", [{ id: "mensagem-1" }]);

    expect(caixa.scrollTop).toBe(500);
  });

  it("acompanha novas mensagens quando a pessoa estava próxima do fim", () => {
    renderizar("conversa-1", []);
    const caixa = caixaDeRolagem({ topo: 365 });
    controle.rolagem.current = caixa;
    controle.aoRolar();
    caixa.scrollHeight = 600;

    renderizar("conversa-1", [{ id: "mensagem-1" }]);

    expect(caixa.scrollTop).toBe(600);
  });

  it("preserva a posição quando a pessoa está lendo mensagens antigas", () => {
    renderizar("conversa-1", []);
    const caixa = caixaDeRolagem({ topo: 100 });
    controle.rolagem.current = caixa;
    controle.aoRolar();
    caixa.scrollHeight = 600;

    renderizar("conversa-1", [{ id: "mensagem-1" }]);

    expect(caixa.scrollTop).toBe(100);
  });

  it("leva ao fim ao trocar de conversa mesmo após leitura acima", () => {
    renderizar("conversa-1", []);
    const caixa = caixaDeRolagem({ topo: 100 });
    controle.rolagem.current = caixa;
    controle.aoRolar();
    caixa.scrollHeight = 700;

    renderizar("conversa-2", [{ id: "mensagem-2" }]);

    expect(caixa.scrollTop).toBe(700);
  });
});
