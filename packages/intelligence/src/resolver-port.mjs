/**
 * Resolver Port — o contrato que `core.mjs` depende, nunca de Supabase
 * diretamente. Qualquer objeto com este formato serve: a implementação real
 * (RPC via REST/PostgREST, em src/intelligenceResolver.mjs, fora deste
 * pacote), um fake de teste, ou um futuro adapter para outro backend.
 *
 *   resolver.resolveV2(request: IntelligenceRequest) => Promise<rawPayload>
 *   resolver.resolveV3(request: IntelligenceRequest) => Promise<rawPayload>
 *
 * `rawPayload` é o JSON cru que `nucleo_intelligence_context_resolve_v2`/`_v3`
 * devolvem (já desserializado) — o formato que
 * `contracts/adapters.mjs` (`resolutionFromV2`/`resolutionFromV3`) sabe
 * traduzir. O port não valida nem transforma nada; só busca o payload.
 *
 * Duck typing, sem classe/interface: `isResolverPort` confere só a forma
 * mínima (duas funções), não a origem do objeto.
 */

export function isResolverPort(value) {
  return Boolean(value) && typeof value.resolveV2 === "function" && typeof value.resolveV3 === "function";
}
