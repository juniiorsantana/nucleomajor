// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gatewayApi = {
  conexoes: vi.fn(),
  resumoAtendimento: vi.fn(),
  prontidao: vi.fn(),
  qr: vi.fn(),
  parear: vi.fn(),
  ativarRealtime: vi.fn(),
};
const configApi = { ler: vi.fn() };
const organizacoesApi = { robos: vi.fn() };

vi.mock("../../data/client", () => ({
  api: { gateway: gatewayApi, config: configApi, organizacoes: organizacoesApi },
}));

const { default: Conexoes } = await import("./Conexoes");

const ORG = "org-1";
const CONEXAO = "8ee1e6d0-0000-0000-0000-000000000001";
const organizacao = { id: ORG, name: "Núcleo Major", papel: "owner" };

/** Uma conexão da VPS como `api.gateway.conexoes` a devolve. */
function conexaoRemota(status, extra = {}) {
  return {
    connectionId: CONEXAO,
    name: "Comercial",
    runtime: "online",
    host: "vps-nucleo",
    remoteManaged: true,
    expectedPhoneMasked: "•••• 8362",
    controlPlane: { heartbeat_at: new Date(Date.now() - 12000).toISOString(), fresh: true },
    connection: { status, phoneMasked: status === "connected" ? "•••• 8362" : null, updatedAt: new Date().toISOString() },
    ...extra,
  };
}

let container;
let root;

async function montar(conexao) {
  gatewayApi.conexoes.mockResolvedValue({ organizationId: ORG, vinculado: true, gateway: "cloud", conexoes: [conexao] });
  await act(async () => {
    root.render(<Conexoes organizacao={organizacao} usuario={{ id: "u1", nome: "Ana" }} />);
  });
  // O laço da tela consulta em cadeia (conexões, atendimento, prontidão);
  // duas voltas de microtasks bastam para a primeira carga assentar.
  await act(async () => {
    await Promise.resolve();
  });
}

const botao = (texto) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === texto) || null;

beforeEach(() => {
  vi.clearAllMocks();
  configApi.ler.mockResolvedValue(null);
  organizacoesApi.robos.mockResolvedValue([]);
  gatewayApi.prontidao.mockResolvedValue(null);
  gatewayApi.resumoAtendimento.mockResolvedValue({
    iaAtiva: true,
    donoPadrao: "ia",
    abertas: { bot: 0, ia: 0, humano: 0 },
    conversations: [],
    remoteSummary: true,
  });
  gatewayApi.qr.mockResolvedValue(null);
  gatewayApi.parear.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("cartão da conexão em duas camadas", () => {
  it("desconectado: a primeira camada diz o essencial e os detalhes técnicos ficam recolhidos", async () => {
    await montar(conexaoRemota("logged_out"));

    const cartao = container.querySelector("section:has(details)");
    expect(cartao).not.toBeNull();
    expect(cartao.textContent).toContain("Comercial");
    expect(cartao.textContent).toContain("•••• 8362");
    expect(cartao.textContent).toContain("Desconectado");
    expect(cartao.textContent).toContain("O WhatsApp não está conectado.");
    expect(botao("Conectar WhatsApp")).not.toBeNull();

    // O interruptor na primeira camada, e honesto: na VPS ele é só leitura.
    expect(cartao.textContent).toContain("Atendimento automático");
    expect(cartao.textContent).toContain("Ligado");
    expect(cartao.textContent).toContain("Definido no runtime da VPS");
    expect(cartao.querySelector("[role=switch]")).toBeNull();

    // O diagnóstico existe, mas dentro dos detalhes — e fechado por padrão.
    const detalhes = cartao.querySelector("details");
    expect(detalhes.open).toBe(false);
    expect(detalhes.textContent).toContain("Bridge");
    expect(detalhes.textContent).toContain("vps-nucleo");
    expect(detalhes.textContent).toContain("Sinal da VPS");
    expect(detalhes.textContent).toContain("Quem atende uma conversa nova");
    // Nada do diagnóstico vazou para fora dos detalhes.
    const foraDosDetalhes = cartao.textContent.replace(detalhes.textContent, "");
    expect(foraDosDetalhes).not.toContain("Bridge");
    expect(foraDosDetalhes).not.toContain("MCP do Núcleo");
  });

  it("conectar pede o pareamento à VPS e mostra o QR no cartão antes de o heartbeat virar", async () => {
    gatewayApi.qr.mockResolvedValue({ status: "awaiting_qr", imageData: "data:image/png;base64,QUJD" });
    await montar(conexaoRemota("logged_out"));

    await act(async () => {
      botao("Conectar WhatsApp").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(gatewayApi.parear).toHaveBeenCalledWith({ organizationId: ORG, connectionId: CONEXAO, remoto: true });
    expect(gatewayApi.qr).toHaveBeenCalledWith({ organizationId: ORG, connectionId: CONEXAO, remoto: true });
    const imagem = container.querySelector("section img[alt*='QR Code']");
    expect(imagem?.getAttribute("src")).toBe("data:image/png;base64,QUJD");
    expect(container.textContent).toContain("Aparelhos conectados");
    expect(container.textContent).toContain("número final 8362");
  });

  it("conectado: selo verde, sem botão de conectar nem QR, e o interruptor diz que a IA responde", async () => {
    await montar(conexaoRemota("connected"));

    const cartao = container.querySelector("section:has(details)");
    expect(cartao.textContent).toContain("Conectado e recebendo mensagens.");
    expect(botao("Conectar WhatsApp")).toBeNull();
    expect(cartao.querySelector("img")).toBeNull();
    expect(cartao.textContent).toContain("A IA responde as conversas desta conexão");
  });

  it("quem não é administrador não vê o botão de conectar na conexão da VPS", async () => {
    gatewayApi.conexoes.mockResolvedValue({ organizationId: ORG, vinculado: true, gateway: "cloud", conexoes: [conexaoRemota("logged_out")] });
    await act(async () => {
      root.render(<Conexoes organizacao={{ ...organizacao, papel: "member" }} usuario={null} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(botao("Conectar WhatsApp")).toBeNull();
    expect(container.textContent).toContain("permissão de administrador");
  });
});
