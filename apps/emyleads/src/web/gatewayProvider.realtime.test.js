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

  it("repassa a conexão e a conversa, e a espera acumula as chaves", async () => {
    const detalhes = [];
    const guardar = (evento) => detalhes.push(evento.detail);
    window.addEventListener("emyleads:connections-changed", guardar);
    await criarOperacoesGateway()["gateway.ativarRealtime"]({ organizationId });
    const canal = mocks.channels[0];
    canal.aoEvento({ new: { topic: "conversas", entity_id: "conexao-1", entity_key: "5511900000001" } });
    canal.aoEvento({ new: { topic: "conversas", entity_id: "conexao-1", entity_key: "5511900000002" } });
    canal.aoEvento({ new: { topic: "conversas", entity_id: "conexao-1", entity_key: "5511900000001" } });
    vi.advanceTimersByTime(100);
    window.removeEventListener("emyleads:connections-changed", guardar);
    expect(detalhes).toEqual([
      {
        organizationId,
        topic: "conversas",
        entityId: "conexao-1",
        entityKeys: ["5511900000001", "5511900000002"],
      },
    ]);
  });

  it("um aviso sem chave na espera vira 'não sei qual', e conexões diferentes não dão entityId", async () => {
    const detalhes = [];
    const guardar = (evento) => detalhes.push(evento.detail);
    window.addEventListener("emyleads:connections-changed", guardar);
    await criarOperacoesGateway()["gateway.ativarRealtime"]({ organizationId });
    const canal = mocks.channels[0];
    canal.aoEvento({ new: { topic: "conversas", entity_id: "conexao-1", entity_key: "5511900000001" } });
    canal.aoEvento({ new: { topic: "conversas", entity_id: "conexao-2" } });
    vi.advanceTimersByTime(100);
    // A espera seguinte começa do zero.
    canal.aoEvento({ new: { topic: "conversas", entity_id: "conexao-1", entity_key: "5511900000003" } });
    vi.advanceTimersByTime(100);
    window.removeEventListener("emyleads:connections-changed", guardar);
    expect(detalhes[0]).toMatchObject({ entityId: null, entityKeys: null });
    expect(detalhes[1]).toMatchObject({ entityId: "conexao-1", entityKeys: ["5511900000003"] });
  });

  it("avisa quando o canal fica inscrito e quando cai, e diz o estado a quem chega depois", async () => {
    const estados = [];
    const guardar = (evento) => estados.push(evento.detail);
    window.addEventListener("emyleads:realtime-status", guardar);
    const gateway = criarOperacoesGateway();
    const primeira = await gateway["gateway.ativarRealtime"]({ organizationId });
    expect(primeira.inscrito).toBe(false);
    const canal = mocks.channels[0];
    canal.aoEstado("SUBSCRIBED");
    expect((await gateway["gateway.ativarRealtime"]({ organizationId })).inscrito).toBe(true);
    canal.aoEstado("CHANNEL_ERROR");
    canal.aoEstado("TIMED_OUT");
    canal.aoEstado("SUBSCRIBED");
    window.removeEventListener("emyleads:realtime-status", guardar);
    expect(estados.map((e) => e.inscrito)).toEqual([true, false, true]);
    expect(estados.every((e) => e.organizationId === organizationId)).toBe(true);
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
