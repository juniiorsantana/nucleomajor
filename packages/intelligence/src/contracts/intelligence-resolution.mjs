/**
 * IntelligenceResolution — a decisão produzida pelo Intelligence Core.
 * Modelada a partir do que `runtimeContext` de
 * `nucleo_intelligence_context_resolve_v2`/`_v3` já compila hoje (ver
 * docs/intelligence/INTELLIGENCE-CONTRACT.md para a auditoria completa),
 * mais os campos que só existem soltos no lado JS (`routingReason`, de
 * `intelligenceRouter.js`).
 *
 * Ainda usa `assistant` (assistant_profiles), não `agent` — não antecipa
 * entidades que não existem no sistema hoje (agentId, agentRouter, soul).
 */

import { isKnownTool } from "../tools.mjs";

// Versão do CONTRATO, não do resolvedor SQL que o produziu. 'fase-h-2' e
// 'fase-h-3' continuam vivendo em `sourceSchemaVersion`, como rastro de qual
// função gerou o payload original — não são reaproveitados aqui porque
// descrevem a evolução do resolvedor, não a deste contrato, que pode evoluir
// em ritmo diferente (por exemplo quando um adapter novo passar a alimentá-lo
// sem que v2/v3 tenham mudado uma linha).
export const CONTRACT_VERSION = 1;

export const RESOLUTION_AUDIENCES = Object.freeze(new Set(["internal", "customer"]));

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateNullableObject(value, field, errors, requiredKeys = []) {
  if (value === null || value === undefined) return;
  if (!isObject(value)) {
    errors.push(`${field} deve ser um objeto ou null`);
    return;
  }
  for (const key of requiredKeys) {
    if (!(key in value)) errors.push(`${field}.${key} é obrigatório quando ${field} não é null`);
  }
}

/**
 * Valida uma IntelligenceResolution. Retorna uma lista de erros (vazia =
 * válida). `allowedTools` é sempre conferido contra o Tool Registry
 * (`isKnownTool`, packages/intelligence/src/tools.mjs) — nenhuma outra lista
 * é usada para essa checagem.
 */
export function validateIntelligenceResolution(resolution) {
  const errors = [];
  if (!isObject(resolution)) return ["IntelligenceResolution deve ser um objeto"];

  if (resolution.contractVersion !== CONTRACT_VERSION) {
    errors.push(`contractVersion deve ser ${CONTRACT_VERSION}`);
  }
  if (typeof resolution.sourceSchemaVersion !== "string" || !resolution.sourceSchemaVersion.trim()) {
    errors.push("sourceSchemaVersion deve ser um texto não vazio");
  }
  if (resolution.contextId !== null && typeof resolution.contextId !== "string") {
    errors.push("contextId deve ser um texto ou null");
  }
  if (!RESOLUTION_AUDIENCES.has(resolution.audience)) {
    errors.push("audience deve ser internal ou customer");
  }

  validateNullableObject(resolution.assistant, "assistant", errors, ["id", "name"]);
  validateNullableObject(resolution.campaign, "campaign", errors, ["id"]);
  validateNullableObject(resolution.skill, "skill", errors, ["id", "slug", "name"]);
  validateNullableObject(resolution.stage, "stage", errors, ["id"]);
  validateNullableObject(resolution.runtimeContext, "runtimeContext", errors, ["sessionId"]);
  validateNullableObject(resolution.pendingAction, "pendingAction", errors, ["pending"]);
  if (isObject(resolution.pendingAction) && typeof resolution.pendingAction.pending !== "boolean") {
    errors.push("pendingAction.pending deve ser booleano");
  }

  if (!isStringArray(resolution.allowedTools)) {
    errors.push("allowedTools deve ser uma lista de textos");
  } else {
    const desconhecidas = resolution.allowedTools.filter((tool) => !isKnownTool(tool));
    if (desconhecidas.length) errors.push(`allowedTools contém ferramenta(s) desconhecida(s) no Tool Registry: ${desconhecidas.join(", ")}`);
  }
  if (isObject(resolution.stage) && isStringArray(resolution.stage.allowedTools)) {
    const desconhecidas = resolution.stage.allowedTools.filter((tool) => !isKnownTool(tool));
    if (desconhecidas.length) errors.push(`stage.allowedTools contém ferramenta(s) desconhecida(s) no Tool Registry: ${desconhecidas.join(", ")}`);
  }

  if (!isStringArray(resolution.guardrails)) errors.push("guardrails deve ser uma lista de textos");
  if (!isStringArray(resolution.handoff)) errors.push("handoff deve ser uma lista de textos");

  if (!Array.isArray(resolution.knowledge)) {
    errors.push("knowledge deve ser uma lista");
  } else {
    for (const [index, item] of resolution.knowledge.entries()) {
      if (!isObject(item) || typeof item.id !== "string" || typeof item.name !== "string") {
        errors.push(`knowledge[${index}] deve ter ao menos id e name`);
      }
    }
  }

  if (!isObject(resolution.policies)) errors.push("policies deve ser um objeto");

  if (resolution.routingReason !== null && typeof resolution.routingReason !== "string") {
    errors.push("routingReason deve ser um texto ou null");
  }

  return errors;
}
