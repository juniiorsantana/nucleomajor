// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AvatarComDono, Bolha, LinhaConversa } from "./pecas";

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

describe("o nome de quem escreveu na bolha", () => {
  const bolha = (mensagem) =>
    renderizar(<Bolha mensagem={mensagem} nomeProprio="Você" aoReenviar={null} />);

  it("mostra o nome que veio do banco", () => {
    bolha({ direcao: "sai", texto: "Oi!", hora: "10:30", tom: "ia", autor: "Bia" });
    expect(container.textContent).toContain("Bia");
  });

  it("sem autoria, a bolha sai sem nome — foi o celular", () => {
    bolha({ direcao: "sai", texto: "respondi daqui", hora: "10:31", tom: null, autor: null });
    expect(container.textContent).not.toContain("Você");
  });

  /**
   * O defeito que este teste existe para impedir.
   *
   * A bolha tinha um recurso para `tom === "humano"` sem nome: usar o nome de
   * quem está OLHANDO a tela. Enquanto a autoria não existia no dado, isso
   * nunca disparava. Com a Fase 2 ele passou a alcançar mensagens espelhadas —
   * e poria "Você" numa mensagem que outra pessoa da equipe mandou. O nome de
   * quem vê só vale para a bolha que ainda não voltou do WhatsApp, porque essa
   * foi escrita aqui, agora, por quem está olhando.
   */
  it("não empresta o nome de quem vê para mensagem de outra pessoa", () => {
    bolha({ direcao: "sai", texto: "já respondi", hora: "10:32", tom: "humano", autor: null });
    expect(container.textContent).not.toContain("Você");
  });

  it("mas a bolha ainda a caminho leva o nome de quem está escrevendo", () => {
    bolha({
      direcao: "sai", texto: "estou enviando", hora: "10:33",
      tom: "humano", autor: null, enviando: true,
    });
    expect(container.textContent).toContain("Você");
  });
});
