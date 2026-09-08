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
  verificarNumero: vi.fn(),
  iniciar: vi.fn(),
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
  conversasApi.verificarNumero.mockResolvedValue({ comandoId: "cmd-check", situacao: "pending" });
  conversasApi.iniciar.mockResolvedValue({ id: "org-a:5565992178164", criada: true });
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

describe("reenvio de uma bolha que falhou", () => {
  /**
   * O teste que impede o cliente de receber a mesma mensagem duas vezes.
   *
   * Um comando pode ser dado como expirado DEPOIS de o runtime tê-lo
   * reivindicado — e nesse caso ele talvez tenha saído. A RPC chaveia a
   * idempotência pelo `clientId` e só ressuscita comando `failed` ou `expired`;
   * reaproveitar a chave faz um comando que na verdade saiu ser devolvido como
   * está. Com chave nova, sairia uma segunda mensagem igual.
   */
  it("reaproveita o clientId do clique original", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.desfecho.mockResolvedValue({ situacao: "failed", motivo: "send_failed" });

    await renderizar("org-a");
    await drenar();
    await act(async () => estado.enviar("ok"));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await drenar();

    const bolha = estado.mensagens.find((item) => item.texto === "ok");
    expect(bolha).toMatchObject({ falhou: true });

    const clientIdOriginal = conversasApi.enviar.mock.calls[0][0].clientId;
    expect(clientIdOriginal).toBeTruthy();

    await act(async () => estado.reenviar(bolha.chave));
    await drenar();

    expect(conversasApi.enviar).toHaveBeenCalledTimes(2);
    expect(conversasApi.enviar.mock.calls[1][0].clientId).toBe(clientIdOriginal);
    expect(conversasApi.enviar.mock.calls[1][0].texto).toBe("ok");
  });

  it("não cria uma segunda bolha ao tentar de novo", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.desfecho.mockResolvedValue({ situacao: "failed", motivo: "send_failed" });

    await renderizar("org-a");
    await drenar();
    await act(async () => estado.enviar("ok"));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await drenar();

    const bolha = estado.mensagens.find((item) => item.texto === "ok");
    await act(async () => estado.reenviar(bolha.chave));
    await drenar();

    // Uma bolha só, e de volta ao estado "enviando": duas bolhas iguais lado a
    // lado, uma falha e uma a caminho, descreveriam duas mensagens para o
    // cliente onde só existe uma.
    const iguais = estado.mensagens.filter((item) => item.texto === "ok");
    expect(iguais).toHaveLength(1);
    expect(iguais[0]).toMatchObject({ falhou: false, enviando: true });
  });

  it("ignora o pedido quando a bolha não falhou", async () => {
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    await renderizar("org-a");
    await drenar();
    await act(async () => estado.enviar("ok"));
    await drenar();

    const bolha = estado.mensagens.find((item) => item.texto === "ok");
    await act(async () => estado.reenviar(bolha.chave));
    await drenar();

    expect(conversasApi.enviar).toHaveBeenCalledTimes(1);
  });
});

describe("verificação de número", () => {
  it("responde sim quando o runtime confirma", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.desfecho.mockResolvedValue({
      situacao: "completed",
      motivo: "",
      resultado: { onWhatsApp: true, reason: "" },
    });

    await renderizar("org-a");
    await drenar();

    let resposta;
    await act(async () => {
      const pedido = estado.verificarNumero("5565992178164");
      await vi.advanceTimersByTimeAsync(3_000);
      resposta = await pedido;
    });

    expect(resposta).toEqual({ situacao: "sim", motivo: "" });
  });

  it("número sem conta é resposta, e não falha", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.desfecho.mockResolvedValue({
      situacao: "completed",
      motivo: "",
      resultado: { onWhatsApp: false, reason: "not_registered" },
    });

    await renderizar("org-a");
    await drenar();

    let resposta;
    await act(async () => {
      const pedido = estado.verificarNumero("5511900000000");
      await vi.advanceTimersByTimeAsync(3_000);
      resposta = await pedido;
    });

    expect(resposta).toEqual({ situacao: "nao", motivo: "not_registered" });
  });

  /**
   * O modal não pode herdar o orçamento de dez minutos de um envio.
   *
   * `acompanhar` persegue um comando até a validade da RPC, e isso é certo para
   * uma mensagem: ela vai sair, e quem escreveu quer saber quando. Aqui há uma
   * pessoa parada esperando para digitar o próximo caractere.
   */
  it("desiste em menos de um minuto e devolve indefinido", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.desfecho.mockResolvedValue({ situacao: "pending", motivo: "" });

    await renderizar("org-a");
    await drenar();

    let resposta;
    await act(async () => {
      const pedido = estado.verificarNumero("5565992178164");
      await vi.advanceTimersByTimeAsync(60_000);
      resposta = await pedido;
    });

    expect(resposta).toEqual({ situacao: "indefinido", motivo: "" });
  });

  it("um Bridge fora do ar nunca vira número inexistente", async () => {
    vi.useFakeTimers();
    conversasApi.listar.mockResolvedValue([conversa("org-a:5511")]);
    conversasApi.desfecho.mockResolvedValue({
      situacao: "failed",
      motivo: "bridge_unavailable",
      resultado: {},
    });

    await renderizar("org-a");
    await drenar();

    let resposta;
    await act(async () => {
      const pedido = estado.verificarNumero("5565992178164");
      await vi.advanceTimersByTimeAsync(3_000);
      resposta = await pedido;
    });

    // "não consegui perguntar" e "não tem WhatsApp" levam a ações opostas.
    expect(resposta.situacao).toBe("indefinido");
  });
});
