// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const conversasApi = {
  listar: vi.fn(),
  modelos: vi.fn(),
  mensagens: vi.fn(),
  enviar: vi.fn(),
  trocarDono: vi.fn(),
  desfecho: vi.fn(),
  guardarBaralho: vi.fn(),
};

const organizacoesApi = { membros: vi.fn() };
const gatewayApi = { ativarRealtime: vi.fn() };
globalThis.__EMYLEADS_PLATFORM__ = "web";

vi.mock("../../../data/client", () => ({
  api: {
    conversas: conversasApi,
    organizacoes: organizacoesApi,
    gateway: gatewayApi,
  },
}));

const { useConversas } = await import("./useConversas");

const conversa = (id) => ({
  id,
  nome: id,
  grupo: false,
  dono: "humano",
  naoLidas: 0,
});

const mensagem = (messageId, texto, enviadaEm = Date.now() - 60_000) => ({
  tipo: "mensagem",
  messageId,
  direcao: "sai",
  hora: "09:41",
  texto,
  enviadaEm,
  lido: false,
});

function adiada() {
  let resolve;
  let reject;
  const promise = new Promise((ok, falhar) => {
    resolve = ok;
    reject = falhar;
  });
  return { promise, resolve, reject };
}

let container;
let root;
let estado;

function Harness({ organizacaoId }) {
  estado = useConversas(organizacaoId);
  return null;
}

async function renderizar(organizacaoId) {
  await act(async () => {
    root.render(<Harness organizacaoId={organizacaoId} />);
  });
}

async function drenar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  estado = null;
  vi.clearAllMocks();
  conversasApi.listar.mockResolvedValue([]);
  conversasApi.modelos.mockResolvedValue([]);
  conversasApi.mensagens.mockResolvedValue([]);
  conversasApi.enviar.mockResolvedValue({ comandoId: "cmd-1", situacao: "pending" });
  conversasApi.trocarDono.mockResolvedValue({ comandoId: "cmd-dono", situacao: "pending" });
  conversasApi.desfecho.mockResolvedValue({ situacao: "pending", motivo: "" });
  conversasApi.guardarBaralho.mockResolvedValue({});
  organizacoesApi.membros.mockResolvedValue([]);
  gatewayApi.ativarRealtime.mockResolvedValue({ ativo: true });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("isolamento por organização", () => {
  it("oculta o estado antigo enquanto a organização nova carrega", async () => {
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    await renderizar("org-a");
    await drenar();
    expect(estado.conversas?.[0]?.id).toBe("org-a:5511");

    const cargaB = adiada();
    conversasApi.listar.mockImplementation(() => cargaB.promise);
    await renderizar("org-b");

    expect(estado.conversas).toBeNull();
    expect(estado.mensagens).toEqual([]);
    expect(estado.atual).toBeNull();

    await act(async () => cargaB.resolve([conversa("org-b:5522")]));
    await drenar();
    expect(estado.conversas?.[0]?.id).toBe("org-b:5522");
  });

  it("descarta a resposta antiga que termina depois da organização nova", async () => {
    const cargaA = adiada();
    conversasApi.listar
      .mockImplementationOnce(() => cargaA.promise)
      .mockResolvedValue([conversa("org-b:5522")]);

    await renderizar("org-a");
    await renderizar("org-b");
    await drenar();
    expect(estado.conversas?.[0]?.id).toBe("org-b:5522");

    await act(async () => cargaA.resolve([conversa("org-a:5511")]));
    await drenar();
    expect(estado.conversas?.[0]?.id).toBe("org-b:5522");
  });
});

describe("recuperação de leitura", () => {
  it("sai do erro fatal quando o polling volta a responder", async () => {
    vi.useFakeTimers();
    conversasApi.listar
      .mockRejectedValueOnce(new Error("rede indisponível"))
      .mockResolvedValue([conversa("org-a:5511")]);

    await renderizar("org-a");
    await drenar();
    expect(estado.erro).toBe("rede indisponível");

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await drenar();
    expect(estado.erro).toBe("");
    expect(estado.conversas?.[0]?.id).toBe("org-a:5511");
  });
});

describe("conciliação de mensagens pendentes", () => {
  it("não confunde uma mensagem antiga de mesmo texto com o envio novo", async () => {
    vi.useFakeTimers();
    const antiga = mensagem("wa-antiga", "ok");
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.mensagens.mockResolvedValue([antiga]);

    await renderizar("org-a");
    await drenar();
    await act(async () => estado.enviar("ok"));
    await drenar();

    expect(estado.mensagens.some((item) => item.enviando)).toBe(true);

    conversasApi.mensagens.mockResolvedValue([
      antiga,
      {
        tipo: "mensagem",
        messageId: "wa-recebida",
        direcao: "entra",
        hora: "09:42",
        texto: "você está aí?",
        enviadaEm: Date.now(),
        lido: false,
      },
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await drenar();
    expect(estado.mensagens.some((item) => item.enviando)).toBe(true);

    conversasApi.mensagens.mockResolvedValue([
      antiga,
      {
        tipo: "mensagem",
        messageId: "wa-recebida",
        direcao: "entra",
        hora: "09:42",
        texto: "você está aí?",
        enviadaEm: Date.now(),
        lido: false,
      },
      mensagem("wa-nova", "ok", Date.now()),
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await drenar();
    expect(estado.mensagens.some((item) => item.enviando)).toBe(false);
  });

  it("consome somente uma bolha quando dois envios iguais aguardam retorno", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.mensagens.mockResolvedValue([]);

    await renderizar("org-a");
    await drenar();
    await act(async () => {
      await estado.enviar("ok");
      await estado.enviar("ok");
    });
    expect(estado.mensagens.filter((item) => item.enviando)).toHaveLength(2);

    conversasApi.mensagens.mockResolvedValue([mensagem("wa-nova", "ok", Date.now())]);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("emyleads:connections-changed", {
        detail: { organizationId: "org-a", topic: "conversas" },
      }));
    });
    await drenar();

    expect(estado.mensagens.filter((item) => item.enviando)).toHaveLength(1);
  });
});

describe("atualização e desmontagem", () => {
  it("recarrega lista e conversa quando chega o tópico de Realtime", async () => {
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    await renderizar("org-a");
    await drenar();

    conversasApi.listar.mockResolvedValue([
      conversa("org-a:5511"),
      conversa("org-a:5533"),
    ]);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("emyleads:connections-changed", {
        detail: { organizationId: "org-a", topic: "conversas" },
      }));
    });
    await drenar();

    expect(estado.conversas).toHaveLength(2);
    expect(conversasApi.mensagens).toHaveBeenCalledWith({ id: "org-a:5511" });
  });

  it("não consulta desfecho depois que a tela é desmontada", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    await renderizar("org-a");
    await drenar();
    await act(async () => estado.enviar("até logo"));

    act(() => root.unmount());
    root = null;
    await vi.advanceTimersByTimeAsync(20_000);

    expect(conversasApi.desfecho).not.toHaveBeenCalled();
  });

  it("cancela também uma transferência pendente ao desmontar", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    await renderizar("org-a");
    await drenar();

    let transferencia;
    act(() => {
      transferencia = estado.trocarDono("ia");
    });
    act(() => root.unmount());
    root = null;
    await vi.advanceTimersByTimeAsync(2_000);
    await transferencia;

    expect(conversasApi.desfecho).not.toHaveBeenCalled();
  });
});

describe("acompanhamento do comando", () => {
  it("continua consultando depois de 40 segundos e mostra a falha tardia", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.desfecho.mockImplementation(async () =>
      conversasApi.desfecho.mock.calls.length >= 21
        ? { situacao: "failed", motivo: "send_failed" }
        : { situacao: "pending", motivo: "" }
    );

    await renderizar("org-a");
    await drenar();
    await act(async () => estado.enviar("mensagem em fila"));
    await act(async () => vi.advanceTimersByTimeAsync(50_000));
    await drenar();

    expect(conversasApi.desfecho).toHaveBeenCalledTimes(21);
    expect(estado.mensagens.find((item) => item.texto === "mensagem em fila"))
      .toMatchObject({ falhou: true, enviando: false });
    expect(estado.aviso).toMatch(/WhatsApp recusou o envio/);
  });
});
