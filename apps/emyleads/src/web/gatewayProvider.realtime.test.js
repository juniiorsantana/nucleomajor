// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels = [];
  const supabase = {
    channel: vi.fn((name) => {
      const channel = {
        name,
        aoEvento: null,
        aoEstado: null,
        on: vi.fn(function on(_kind, _binding, callback) {
          this.aoEvento = callback;
          return this;
        }),
        subscribe: vi.fn(function subscribe(callback) {
          this.aoEstado = callback;
          return this;
        }),
      };
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async () => {}),
  };
  return { channels, supabase };
});

vi.mock("./supabaseClient.js", () => ({ obterSupabaseWeb: () => mocks.supabase }));
vi.mock("./storage.js", () => ({
  webArea: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() },
}));

import { criarOperacoesGateway } from "./gatewayProvider.js";

const organizationId = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";

describe("avisos do realtime", () => {
  let recebidos;
  const ouvir = (evento) => recebidos.push(evento.detail.topic);

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.channels.length = 0;
    recebidos = [];
    window.addEventListener("emyleads:connections-changed", ouvir);
  });

  afterEach(() => {
    window.removeEventListener("emyleads:connections-changed", ouvir);
    vi.useRealTimers();
  });

  it("o aviso de conversas não some quando o de conexões chega logo depois", async () => {
    await criarOperacoesGateway()["gateway.ativarRealtime"]({ organizationId });
    const canal = mocks.channels[0];
    // Como em produção: a mensagem nova e o heartbeat da VPS a 10 ms um do outro.
    canal.aoEvento({ new: { topic: "conversas" } });
    canal.aoEvento({ new: { topic: "connections" } });
    vi.advanceTimersByTime(100);
    expect(recebidos.sort()).toEqual(["connections", "conversas"]);
  });

  it("avisos repetidos do mesmo tópico ainda viram um só", async () => {
    await criarOperacoesGateway()["gateway.ativarRealtime"]({ organizationId });
    const canal = mocks.channels[0];
    canal.aoEvento({ new: { topic: "conversas" } });
    canal.aoEvento({ new: { topic: "conversas" } });
    vi.advanceTimersByTime(100);
    expect(recebidos).toEqual(["conversas"]);
  });

  it("religar o canal manda as telas recarregarem o que perderam", async () => {
    await criarOperacoesGateway()["gateway.ativarRealtime"]({ organizationId });
    const canal = mocks.channels[0];
    canal.aoEstado("SUBSCRIBED");
    vi.advanceTimersByTime(100);
    // A primeira conexão não tem o que recuperar: a tela acabou de carregar.
    expect(recebidos).toEqual([]);

    canal.aoEstado("CHANNEL_ERROR");
    canal.aoEstado("SUBSCRIBED");
    vi.advanceTimersByTime(100);
    expect(recebidos.sort()).toEqual(["connections", "conversas", "operators"]);
  });
});
