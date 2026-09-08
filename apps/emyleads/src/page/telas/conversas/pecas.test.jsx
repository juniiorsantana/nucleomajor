// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AvatarComDono, LinhaConversa } from "./pecas";

let container;
let root;

function renderizar(elemento) {
  act(() => root.render(elemento));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("avatar da conversa", () => {
  it("mostra a foto assinada na linha da conversa", () => {
    renderizar(
      <LinhaConversa
        conversa={{
          nome: "Marina Alves",
          fotoUrl: "https://storage.test/avatar.jpg",
          dono: "ia",
          grupo: false,
          naoLidas: 0,
          hora: "10:30",
          previa: "Bom dia",
        }}
        ativa={false}
        aoAbrir={() => {}}
      />
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://storage.test/avatar.jpg"
    );
  });

  it("volta para as iniciais se a imagem não carregar", () => {
    renderizar(
      <AvatarComDono
        nome="Marina Alves"
        foto="https://storage.test/avatar-invalido.jpg"
        dono="humano"
      />
    );

    const imagem = container.querySelector("img");
    expect(imagem).not.toBeNull();

    act(() => imagem.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("MA");
  });
});
