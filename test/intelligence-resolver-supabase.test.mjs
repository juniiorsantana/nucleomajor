import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseIntelligenceResolver } from "../src/intelligenceResolver.mjs";

// Testa só o mapeamento request → RPC (path, headers, body). Nunca chama
// rede real nem produção: `fetchImpl` é um stub local.

function fakeFetch(respostas) {
  const chamadas = [];
  const fetchImpl = async (url, options) => {
    chamadas.push({ url, options });
    const resposta = respostas.shift();
    return {
      ok: resposta.ok ?? true,
      status: resposta.status ?? 200,
      text: async () => JSON.stringify(resposta.body ?? {}),
    };
  };
  return { fetchImpl, chamadas };
}

const REQUEST = Object.freeze({
  organizationId: "00000000-0000-4000-8000-000000000001",
  audience: "customer",
  channel: "whatsapp",
  conversationKeyHash: "a1".repeat(32),
  requesterPhone: "+5511900000001",
  incomingText: "oi",
  sourceData: { origem: "teste" },
});

test("resolveV2 chama a RPC nucleo_intelligence_context_resolve_v2 com os parâmetros SQL corretos", async () => {
  const { fetchImpl, chamadas } = fakeFetch([{ body: { schemaVersion: "fase-h-2" } }]);
  const resolver = createSupabaseIntelligenceResolver({
    supabaseUrl: "https://exemplo.supabase.co",
    supabaseKey: "chave-de-teste",
    token: "token-do-usuario",
    fetchImpl,
  });

  const payload = await resolver.resolveV2(REQUEST);

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://exemplo.supabase.co/rest/v1/rpc/nucleo_intelligence_context_resolve_v2");
  assert.equal(chamadas[0].options.method, "POST");
  assert.equal(chamadas[0].options.headers.apikey, "chave-de-teste");
  assert.equal(chamadas[0].options.headers.Authorization, "Bearer token-do-usuario");
  const corpo = JSON.parse(chamadas[0].options.body);
  assert.deepEqual(corpo, {
    conversation_key_hash: REQUEST.conversationKeyHash,
    requester_phone: REQUEST.requesterPhone,
    incoming_text: REQUEST.incomingText,
    source_data: REQUEST.sourceData,
  });
  // organizationId/audience/channel NÃO fazem parte da assinatura real de v2/v3
  // (são derivados internamente pelo SQL) — não devem vazar para o corpo.
  assert.ok(!("organization_id" in corpo));
  assert.ok(!("audience" in corpo));
  assert.ok(!("channel" in corpo));
  assert.deepEqual(payload, { schemaVersion: "fase-h-2" });
});

test("resolveV3 chama a RPC nucleo_intelligence_context_resolve_v3, distinta de v2", async () => {
  const { fetchImpl, chamadas } = fakeFetch([{ body: { schemaVersion: "fase-h-3" } }]);
  const resolver = createSupabaseIntelligenceResolver({
    supabaseUrl: "https://exemplo.supabase.co",
    supabaseKey: "chave-de-teste",
    fetchImpl,
  });

  const payload = await resolver.resolveV3(REQUEST);

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://exemplo.supabase.co/rest/v1/rpc/nucleo_intelligence_context_resolve_v3");
  // Sem `token` explícito, usa a própria supabaseKey no Authorization.
  assert.equal(chamadas[0].options.headers.Authorization, "Bearer chave-de-teste");
  assert.deepEqual(payload, { schemaVersion: "fase-h-3" });
});

test("resposta não-ok vira erro com a mensagem do Supabase, sem mascarar", async () => {
  const { fetchImpl } = fakeFetch([{ ok: false, status: 400, body: { message: "published skill contains an unsupported tool" } }]);
  const resolver = createSupabaseIntelligenceResolver({ supabaseUrl: "https://exemplo.supabase.co", supabaseKey: "k", fetchImpl });
  await assert.rejects(() => resolver.resolveV2(REQUEST), /unsupported tool/);
});

test("sem supabaseUrl/supabaseKey configurados, falha cedo sem tentar chamar fetch", async () => {
  const chamadas = [];
  const fetchImpl = async (...args) => {
    chamadas.push(args);
    throw new Error("não deveria ter chamado fetch");
  };
  const resolver = createSupabaseIntelligenceResolver({ fetchImpl });
  await assert.rejects(() => resolver.resolveV2(REQUEST), /não configurado/);
  assert.equal(chamadas.length, 0);
});
