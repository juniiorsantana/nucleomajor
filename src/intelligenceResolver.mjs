/**
 * Implementação real (infra) do Resolver Port
 * (packages/intelligence/src/resolver-port.mjs) — chama
 * `nucleo_intelligence_context_resolve_v2`/`_v3` via REST/RPC do Supabase,
 * com o mesmo mecanismo (fetch cru contra PostgREST, sem SDK) já usado por
 * `supabaseRequest()` em server.mjs. Não introduz um segundo client: este
 * workspace não depende de `@supabase/supabase-js` (só `apps/emyleads` usa o
 * SDK); a convenção aqui sempre foi fetch direto.
 *
 * `packages/intelligence` nunca importa este arquivo — é o inverso: quem for
 * montar as dependências do Core (`resolveIntelligence`) importa daqui.
 *
 * ACHADO IMPORTANTE (auditoria da ETAPA 5): `nucleo_intelligence_context_resolve_v2`
 * e `_v3` recebem só 4 parâmetros — `conversation_key_hash`, `requester_phone`,
 * `incoming_text`, `source_data`. NÃO recebem `organization_id`/`audience`/
 * `channel` — esses são derivados internamente a partir do telefone do
 * solicitante (`nucleo_operator_context`) e das credenciais do robô que
 * chama a função. Isso é diferente de `intelligence_context_preview` (usada
 * pelo Simulador), que recebe `target_organization`/`target_audience`
 * explícitos. Por isso, `IntelligenceRequest.organizationId`/`.audience`/
 * `.channel` NÃO são enviados nesta chamada — ver docs/intelligence/INTELLIGENCE-CORE.md.
 * Nenhum SQL foi alterado para conferir isso; é o comportamento já existente.
 *
 * NINGUÉM chama este módulo em produção ainda (ETAPA 5) — v2/v3 hoje só são
 * chamadas pelo runtime externo (Bridge/Python na VPS, fora deste repo).
 * Este arquivo existe para permitir testar/usar o Intelligence Core contra
 * o Supabase real quando um consumidor decidir adotá-lo — não migra nada.
 */

async function callResolverRpc({ supabaseUrl, supabaseKey, token, fetchImpl }, functionName, request) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase não configurado para o Intelligence Resolver (supabaseUrl/supabaseKey ausentes).");
  }
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token || supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      conversation_key_hash: request.conversationKeyHash,
      requester_phone: request.requesterPhone ?? "",
      incoming_text: request.incomingText ?? "",
      source_data: request.sourceData ?? {},
    }),
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = String(payload?.message || payload?.hint || `Falha ao chamar ${functionName} (status ${response.status})`);
    throw new Error(message);
  }
  return payload;
}

/**
 * @param {object} config
 * @param {string} config.supabaseUrl
 * @param {string} config.supabaseKey chave/credencial usada no header `apikey`
 * @param {string} [config.token] token do header `Authorization: Bearer` — se omitido, usa `supabaseKey`
 * @param {typeof fetch} [config.fetchImpl] injeção para teste; default = `fetch` global
 * @returns {import("../packages/intelligence/src/resolver-port.mjs")} Resolver Port
 */
export function createSupabaseIntelligenceResolver({ supabaseUrl, supabaseKey, token, fetchImpl = fetch } = {}) {
  const config = { supabaseUrl, supabaseKey, token, fetchImpl };
  return {
    resolveV2: (request) => callResolverRpc(config, "nucleo_intelligence_context_resolve_v2", request),
    resolveV3: (request) => callResolverRpc(config, "nucleo_intelligence_context_resolve_v3", request),
  };
}
