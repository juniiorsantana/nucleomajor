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
