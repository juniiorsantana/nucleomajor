import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels = [];
  const removed = [];
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
  };
  return { channels, removed, supabase };
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
});
