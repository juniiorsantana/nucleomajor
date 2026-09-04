/**
 * Intelligence Core — primeiro ponto de entrada único:
 *
 *   IntelligenceRequest → resolveIntelligence → IntelligenceResolution
 *
 * Nesta etapa o Core NÃO decide roteamento (skill/campanha/estágio/handoff
 * continuam sendo decididos pelos resolvedores SQL v2/v3). Ele só:
 *   1. valida o IntelligenceRequest;
 *   2. chama o Resolver Port na versão pedida (v2 ou v3 — nunca decidida
 *      pelo próprio Request, ver `options.resolverVersion`);
 *   3. adapta o payload cru com `resolutionFromV2`/`resolutionFromV3`
 *      (packages/intelligence/src/contracts/adapters.mjs, da ETAPA 4);
 *   4. valida a IntelligenceResolution resultante (o que inclui checar
 *      `allowedTools` contra o Tool Registry, ver contracts/intelligence-resolution.mjs);
 *   5. devolve a Resolution, ou lança um IntelligenceCoreError classificado.
 *
 * Não importa Supabase, `fetch`, env vars nem nenhum SDK de infraestrutura —
 * só os contratos puros da ETAPA 4 e o Resolver Port (duck-typed) recebido
 * por injeção. Ver docs/intelligence/INTELLIGENCE-CORE.md.
 */

import { resolutionFromV2, resolutionFromV3 } from "./contracts/adapters.mjs";
import { validateIntelligenceRequest } from "./contracts/intelligence-request.mjs";
import { validateIntelligenceResolution } from "./contracts/intelligence-resolution.mjs";
import { isResolverPort } from "./resolver-port.mjs";

// A versão do resolvedor é política de execução (quem chama decide qual
// caminho SQL usar), não conteúdo da conversa — por isso vive em `options`,
// nunca dentro de IntelligenceRequest. "shadow" (rodar os dois e comparar)
// fica para uma etapa futura, como Execution Policy — aqui só os dois modos
// determinísticos e explícitos que já existem em SQL.
export const RESOLVER_VERSIONS = Object.freeze(new Set(["v2", "v3"]));

const ADAPTERS_BY_VERSION = Object.freeze({ v2: resolutionFromV2, v3: resolutionFromV3 });

export const INTELLIGENCE_CORE_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  UNSUPPORTED_RESOLVER_VERSION: "UNSUPPORTED_RESOLVER_VERSION",
  RESOLVER_UNAVAILABLE: "RESOLVER_UNAVAILABLE",
  INVALID_RESOLVER_PAYLOAD: "INVALID_RESOLVER_PAYLOAD",
});

/**
 * Erro classificado do Core. `details` só carrega mensagens já produzidas
 * pelos próprios validadores deste pacote (seguras de expor). Uma falha do
 * resolvedor (rede, RPC, etc.) vai em `cause` — nunca em `message` — para
 * não vazar detalhe interno/sensível a quem só precisa do `code`.
 */
export class IntelligenceCoreError extends Error {
  constructor(code, message, { details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "IntelligenceCoreError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/**
 * @param {object} request IntelligenceRequest (ver contracts/intelligence-request.mjs)
 * @param {object} options política de execução. `resolverVersion`: "v2" | "v3", obrigatório.
 * @param {object} dependencies colaboradores injetados. `resolver`: Resolver Port, obrigatório.
 * @returns {Promise<object>} IntelligenceResolution válida.
 */
export async function resolveIntelligence(request, options = {}, dependencies = {}) {
  const { resolverVersion } = options;
  const { resolver } = dependencies;

  const requestErrors = validateIntelligenceRequest(request);
  if (requestErrors.length) {
    throw new IntelligenceCoreError("INVALID_REQUEST", "IntelligenceRequest inválido.", { details: requestErrors });
  }

  if (!RESOLVER_VERSIONS.has(resolverVersion)) {
    throw new IntelligenceCoreError(
      "UNSUPPORTED_RESOLVER_VERSION",
      `options.resolverVersion deve ser ${[...RESOLVER_VERSIONS].join(" ou ")}.`,
      { details: [`recebido: ${JSON.stringify(resolverVersion)}`] },
    );
  }

  if (!isResolverPort(resolver)) {
    throw new IntelligenceCoreError("RESOLVER_UNAVAILABLE", "Nenhum Resolver Port válido foi injetado em dependencies.resolver.");
  }

  let rawPayload;
  try {
    rawPayload = resolverVersion === "v2" ? await resolver.resolveV2(request) : await resolver.resolveV3(request);
  } catch (error) {
    throw new IntelligenceCoreError("RESOLVER_UNAVAILABLE", "O resolvedor de inteligência não respondeu.", { cause: error });
  }

  let resolution;
  try {
    resolution = ADAPTERS_BY_VERSION[resolverVersion](rawPayload);
  } catch (error) {
    throw new IntelligenceCoreError(
      "INVALID_RESOLVER_PAYLOAD",
      "O payload devolvido pelo resolvedor não pôde ser adaptado para IntelligenceResolution.",
      { cause: error },
    );
  }

  const resolutionErrors = validateIntelligenceResolution(resolution);
  if (resolutionErrors.length) {
    throw new IntelligenceCoreError(
      "INVALID_RESOLVER_PAYLOAD",
      "A resolução adaptada a partir do resolvedor é inválida.",
      { details: resolutionErrors },
    );
  }

  return resolution;
}
