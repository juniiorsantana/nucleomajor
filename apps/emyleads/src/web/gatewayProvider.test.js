import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels = [];
  const removed = [];
  const rows = { whatsapp_connections: [], connection_runtime_status: [] };
  const supabase = {
    channel: vi.fn((name) => {
      const channel = {
        name,
        binding: null,
        on: vi.fn(function on(_kind, binding, callback) {
          this.binding = { binding, callback };
          return this;
        }),
        subscribe: vi.fn(function subscribe() { return this; }),
      };
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async (channel) => { removed.push(channel); }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn((table) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        neq: vi.fn(() => query),
        order: vi.fn(() => query),
        then(resolve) { return Promise.resolve(resolve({ data: rows[table] || [], error: null })); },
      };
      return query;
    }),
  };
  return { channels, removed, rows, supabase };
});

vi.mock("./supabaseClient.js", () => ({ obterSupabaseWeb: () => mocks.supabase }));
vi.mock("./storage.js", () => ({
  webArea: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() },
}));

import { criarOperacoesGateway } from "./gatewayProvider.js";

describe("WebGatewayProvider Realtime", () => {
  beforeEach(() => {
    mocks.channels.length = 0;
    mocks.removed.length = 0;
    mocks.supabase.channel.mockClear();
    mocks.supabase.removeChannel.mockClear();
    mocks.supabase.from.mockClear();
    mocks.rows.whatsapp_connections = [];
    mocks.rows.connection_runtime_status = [];
  });

  it("mantém um único canal por organização e troca o filtro sem misturar empresas", async () => {
    const operacoes = criarOperacoesGateway();
    const major = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
    const outra = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await operacoes["gateway.ativarRealtime"]({ organizationId: major });
    await operacoes["gateway.ativarRealtime"]({ organizationId: major });
    expect(mocks.channels).toHaveLength(1);
    expect(mocks.channels[0].binding.binding).toEqual(expect.objectContaining({
      table: "portal_realtime_events",
      filter: `organization_id=eq.${major}`,
    }));

    await operacoes["gateway.ativarRealtime"]({ organizationId: outra });
    expect(mocks.channels).toHaveLength(2);
    expect(mocks.removed).toEqual([mocks.channels[0]]);
    expect(mocks.channels[1].binding.binding.filter).toBe(`organization_id=eq.${outra}`);
  });

  it("usa o heartbeat recente da VPS sem depender do gateway local", async () => {
    const connectionId = "8ee1e6d0-a9d0-4041-b6ea-878716a34a71";
    const organizationId = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
    mocks.rows.whatsapp_connections = [{
      id: connectionId,
      name: "WhatsApp principal (8362)",
      status: "connected",
      automation_status: "active",
      expected_phone_last4: "8362",
      verified_phone_last4: "8362",
      last_activity_at: null,
      updated_at: "2026-08-25T12:00:00Z",
    }];
    mocks.rows.connection_runtime_status = [{
      connection_id: connectionId,
      instance_id: "11111111-1111-4111-8111-111111111111",
      runtime_kind: "vps",
      host_label: "VPS Núcleo Major",
      bridge_status: "online",
      whatsapp_status: "connected",
      assistant_status: "online",
      model_status: "quota_exhausted",
      last_model_success_at: "2026-08-25T11:55:00Z",
      last_model_error_code: "model_quota_exhausted",
      mcp_status: "configured",
      agenda_status: "available",
      agenda_read: true,
      agenda_write: true,
      chatbot_status: "online",
      automation_enabled: true,
      default_owner: "ia",
      open_bot: 0,
      open_ai: 2,
      open_human: 1,
      heartbeat_at: new Date().toISOString(),
    }];

    const result = await criarOperacoesGateway()["gateway.conexoes"]({ organizationId });

    expect(result.gateway).toBe("cloud");
    expect(result.conexoes[0]).toMatchObject({
      runtime: "online",
      host: "VPS Núcleo Major",
      remoteManaged: true,
      readiness: {
        assistant: "online",
        modelStatus: "quota_exhausted",
        lastModelErrorCode: "model_quota_exhausted",
        mcp: "configured",
        agenda: "available",
        chatbot: "online",
      },
      attendance: { iaAtiva: true, donoPadrao: "ia" },
    });
  });
});

describe("Pareamento de uma conexão da VPS", () => {
  const organizationId = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
  const connectionId = "8ee1e6d0-a9d0-4041-b6ea-878716a34a71";

  /**
   * O par de respostas de um pedido: a RPC que enfileira e a que acompanha.
   *
   * O portal nunca fala com a VPS. Ele deixa o pedido na fila e volta perguntar
   * — e é esse vaivém que estes testes prendem.
   */
  const responder = (desfecho) => {
    mocks.supabase.rpc.mockImplementation(async (nome) => {
      if (nome === "nucleo_connection_pair_request") {
        return { data: { commandId: "cmd-par-1", status: "pending" }, error: null };
      }
      if (nome === "nucleo_connection_pair_status") return { data: desfecho, error: null };
      return { data: null, error: null };
    });
  };

  beforeEach(() => {
    mocks.supabase.rpc.mockReset();
  });

  it("abre o pareamento pela fila, e não pelo 127.0.0.1", async () => {
    responder({ status: "completed", errorCode: "", result: { status: "starting_pairing" } });
    const resultado = await criarOperacoesGateway()["gateway.parear"]({
      organizationId, connectionId, remoto: true,
    });

    expect(resultado).toEqual({ status: "starting_pairing" });
    const pedido = mocks.supabase.rpc.mock.calls.find(
      ([nome]) => nome === "nucleo_connection_pair_request"
    );
    expect(pedido[1].requested_step).toBe("connection_pair_start");
    expect(pedido[1].target_connection).toBe(connectionId);
    // A RPC exige identificador hexadecimal do clique.
    expect(pedido[1].command_payload.clientId).toMatch(/^[0-9a-fA-F-]{8,64}$/);
  });

  it("devolve a imagem do QR que a VPS leu do bridge", async () => {
    responder({
      status: "completed",
      errorCode: "",
      result: {
        status: "awaiting_qr",
        imageData: "data:image/png;base64,AAAA",
        expiresAt: "2026-09-10T01:00:00Z",
      },
    });
    const qr = await criarOperacoesGateway()["gateway.qr"]({
      organizationId, connectionId, remoto: true,
    });

    expect(qr.imageData).toBe("data:image/png;base64,AAAA");
    expect(qr.status).toBe("awaiting_qr");
  });

  it("sem imagem devolve nulo, para a tela não desenhar quadrado em branco", async () => {
    responder({ status: "completed", errorCode: "", result: { status: "connecting" } });
    const qr = await criarOperacoesGateway()["gateway.qr"]({
      organizationId, connectionId, remoto: true,
    });

    expect(qr).toBeNull();
  });

  it("sessão viva recusa com o motivo, e não com um erro genérico", async () => {
    // A tela precisa poder dizer "este número já está conectado". Um erro
    // genérico faria alguém tentar apagar uma sessão que está funcionando.
    responder({ status: "failed", errorCode: "session_exists", result: {} });

    await expect(
      criarOperacoesGateway()["gateway.parear"]({ organizationId, connectionId, remoto: true })
    ).rejects.toThrow("session_exists");
  });

  it("a conexão local continua sem passar pela fila", async () => {
    mocks.supabase.rpc.mockImplementation(async () => ({ data: null, error: null }));
    await criarOperacoesGateway()["gateway.qr"]({
      organizationId, connectionId, remoto: false,
    }).catch(() => {});

    expect(mocks.supabase.rpc).not.toHaveBeenCalledWith(
      "nucleo_connection_pair_request", expect.anything()
    );
  });
});
