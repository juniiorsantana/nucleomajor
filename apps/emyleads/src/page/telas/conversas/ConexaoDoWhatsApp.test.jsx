// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FASES } from "../conexoes/estadoDaConexao";
import { EstadoVazioConversas, FaixaConexao, ModalConectarWhatsApp } from "./ConexaoDoWhatsApp";

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

const resumo = (fase, extra = {}) => ({
  fase,
  tom: "neutro",
  selo: "",
  titulo: "Título da fase",
  detalhe: "Detalhe da fase.",
  numero: "+55 65 •••• 8362",
  sinal: "",
  podeConectar: fase === FASES.DESCONECTADO || fase === FASES.PAREANDO,
  ...extra,
});

const botao = (texto) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === texto) || null;

describe("estado vazio de Conversas", () => {
  it("enquanto não sabe da conexão, só diz que está consultando", () => {
    renderizar(<EstadoVazioConversas resumo={null} carregado={false} podeGerenciar aoConectar={() => {}} aoVerCodigo={() => {}} />);
    expect(container.textContent).toContain("Consultando a conexão");
    expect(container.querySelector("button")).toBeNull();
  });

  it("desconectado convida a conectar o número da empresa, com o botão para quem pode", () => {
    const aoConectar = vi.fn();
    renderizar(<EstadoVazioConversas resumo={resumo(FASES.DESCONECTADO)} carregado podeGerenciar aoConectar={aoConectar} aoVerCodigo={() => {}} />);

    expect(container.textContent).toContain("ainda não está conectado");
    expect(container.textContent).toContain("o número final 8362");
    act(() => botao("Conectar WhatsApp").click());
    expect(aoConectar).toHaveBeenCalledTimes(1);
  });

  it("quem não é administrador vê o motivo, não um botão que falha", () => {
    renderizar(<EstadoVazioConversas resumo={resumo(FASES.DESCONECTADO)} carregado podeGerenciar={false} aoConectar={() => {}} aoVerCodigo={() => {}} />);
    expect(botao("Conectar WhatsApp")).toBeNull();
    expect(container.textContent).toContain("permissão de administrador");
  });

  it("aguardando leitura oferece ver o código em vez de pedir outro", () => {
    const aoVerCodigo = vi.fn();
    const aoConectar = vi.fn();
    renderizar(<EstadoVazioConversas resumo={resumo(FASES.PAREANDO)} carregado podeGerenciar aoConectar={aoConectar} aoVerCodigo={aoVerCodigo} />);

    expect(container.textContent).toContain("Aguardando a leitura do QR");
    act(() => botao("Ver o código").click());
    expect(aoVerCodigo).toHaveBeenCalledTimes(1);
    expect(aoConectar).not.toHaveBeenCalled();
  });

  it("conectado sem conversa diz o que vai aparecer, sem botão", () => {
    renderizar(<EstadoVazioConversas resumo={resumo(FASES.CONECTADO)} carregado podeGerenciar aoConectar={() => {}} aoVerCodigo={() => {}} />);
    expect(container.textContent).toContain("Conectado. Nenhuma conversa ainda.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("runtime parado e número divergente mostram o erro e apontam para Conexões", () => {
    for (const fase of [FASES.RUNTIME_PARADO, FASES.DIVERGENTE]) {
      renderizar(<EstadoVazioConversas resumo={resumo(fase, { titulo: "Deu ruim.", detalhe: "Explicação." })} carregado podeGerenciar aoConectar={() => {}} aoVerCodigo={() => {}} />);
      expect(container.textContent).toContain("Deu ruim.");
      expect(container.textContent).toContain("Explicação.");
      expect(container.textContent).toContain("Detalhes em Conexões");
      expect(container.querySelector("button")).toBeNull();
    }
  });
});

describe("faixa de conexão no topo da lista", () => {
  it("não existe quando está conectado ou pareando", () => {
    for (const fase of [FASES.CONECTADO, FASES.PAREANDO]) {
      renderizar(<FaixaConexao resumo={resumo(fase)} podeGerenciar aoConectar={() => {}} />);
      expect(container.querySelector("[role=status]")).toBeNull();
    }
    renderizar(<FaixaConexao resumo={null} podeGerenciar aoConectar={() => {}} />);
    expect(container.querySelector("[role=status]")).toBeNull();
  });

  it("desconectado avisa que ninguém recebe e deixa conectar dali", () => {
    const aoConectar = vi.fn();
    renderizar(<FaixaConexao resumo={resumo(FASES.DESCONECTADO)} podeGerenciar aoConectar={aoConectar} />);
    expect(container.querySelector("[role=status]").textContent).toContain("ninguém recebe nem responde");
    act(() => botao("Conectar").click());
    expect(aoConectar).toHaveBeenCalledTimes(1);
  });

  it("erro de runtime mostra o título do problema, sem botão de conectar", () => {
    renderizar(<FaixaConexao resumo={resumo(FASES.RUNTIME_PARADO, { titulo: "O serviço não deu sinal." })} podeGerenciar aoConectar={() => {}} />);
    expect(container.textContent).toContain("O serviço não deu sinal.");
    expect(botao("Conectar")).toBeNull();
  });
});

describe("modal de conexão", () => {
  it("fechado não renderiza nada", () => {
    renderizar(<ModalConectarWhatsApp aberto={false} resumo={resumo(FASES.DESCONECTADO)} qr={null} pedindo={false} aoGerar={() => {}} aoFechar={() => {}} />);
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("mostra o QR quando ele veio e a instrução para o número certo", () => {
    renderizar(
      <ModalConectarWhatsApp
        aberto
        resumo={resumo(FASES.PAREANDO)}
        qr={{ status: "awaiting_qr", imageData: "data:image/png;base64,QUJD" }}
        pedindo={false}
        aoGerar={() => {}}
        aoFechar={() => {}}
      />
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,QUJD");
    expect(container.textContent).toContain("final 8362");
    expect(container.textContent).toContain("Aparelhos conectados");
  });

  it("diz por que o código não veio, e deixa pedir outro", () => {
    const aoGerar = vi.fn();
    renderizar(
      <ModalConectarWhatsApp
        aberto
        resumo={resumo(FASES.DESCONECTADO)}
        qr={{ erro: "pairing_rate_limited" }}
        pedindo={false}
        aoGerar={aoGerar}
        aoFechar={() => {}}
      />
    );
    expect(container.textContent).toContain("O código não veio");
    expect(container.textContent).toContain("pairing_rate_limited");
    act(() => botao("Gerar novo código").click());
    expect(aoGerar).toHaveBeenCalledTimes(1);
  });

  it("ao conectar, troca para o estado pronto e não deixa um QR morto na tela", () => {
    const aoFechar = vi.fn();
    renderizar(
      <ModalConectarWhatsApp
        aberto
        resumo={resumo(FASES.CONECTADO)}
        qr={{ status: "awaiting_qr", imageData: "data:image/png;base64,QUJD" }}
        pedindo={false}
        aoGerar={() => {}}
        aoFechar={aoFechar}
      />
    );
    expect(container.textContent).toContain("WhatsApp conectado");
    expect(container.querySelector("img")).toBeNull();
    expect(botao("Gerar novo código")).toBeNull();
    act(() => botao("Pronto").click());
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("Esc e o clique fora fecham; o clique dentro não", () => {
    const aoFechar = vi.fn();
    renderizar(<ModalConectarWhatsApp aberto resumo={resumo(FASES.DESCONECTADO)} qr={null} pedindo aoGerar={() => {}} aoFechar={aoFechar} />);

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(aoFechar).toHaveBeenCalledTimes(1);

    act(() => container.querySelector("[role=dialog]").click());
    expect(aoFechar).toHaveBeenCalledTimes(1);

    act(() => container.querySelector("[role=dialog]").parentElement.click());
    expect(aoFechar).toHaveBeenCalledTimes(2);
  });
});
