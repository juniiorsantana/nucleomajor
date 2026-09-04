/**
 * IntelligenceRequest — o que o Intelligence Core recebe para tomar uma
 * decisão. Modelado a partir dos parâmetros reais aceitos hoje por
 * `private.intelligence_payload`, `nucleo_intelligence_context_resolve_v2` e
 * `_v3` (ver docs/intelligence/INTELLIGENCE-CONTRACT.md). Não é a assinatura
 * SQL: é a forma canônica que um adapter converte PARA essa assinatura.
 *
 * Não inclui `currentState`/`pendingAction`: nenhum resolvedor real aceita
 * estado de sessão como entrada — o estado é lido internamente a partir de
 * `conversationKeyHash` + `organizationId` + `audience`. Um campo assim aqui
 * fingiria uma capacidade que o sistema não tem.
 */

export const REQUEST_CHANNELS = Object.freeze(new Set(["whatsapp", "web", "simulator"]));
export const REQUEST_AUDIENCES = Object.freeze(new Set(["internal", "customer"]));
export const CONVERSATION_KEY_HASH_PATTERN = /^[0-9a-f]{64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Chaves conhecidas de sourceData quando audience === "customer" — só o
// resolvedor v3 as lê hoje (targetMode/targetSkillId/targetCampaignId,
// escolha manual de skill/campanha feita pelo fluxo de chatbot do Portal).
// Não são obrigatórias nem exclusivas: sourceData continua um objeto livre.
export const SOURCE_DATA_TARGET_MODES = Object.freeze(new Set(["reception", "skill", "campaign"]));

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Valida um IntelligenceRequest. Retorna uma lista de erros (vazia = válido)
 * — mesmo estilo de `validateSkillPackage` em catalog.mjs.
 */
export function validateIntelligenceRequest(request) {
  const errors = [];
  if (!isObject(request)) return ["IntelligenceRequest deve ser um objeto"];

  if (typeof request.organizationId !== "string" || !UUID_PATTERN.test(request.organizationId)) {
    errors.push("organizationId deve ser um uuid");
  }
  if (!REQUEST_AUDIENCES.has(request.audience)) {
    errors.push("audience deve ser internal ou customer");
  }
  if (!REQUEST_CHANNELS.has(request.channel)) {
    errors.push("channel deve ser whatsapp, web ou simulator");
  }
  if (typeof request.conversationKeyHash !== "string" || !CONVERSATION_KEY_HASH_PATTERN.test(request.conversationKeyHash)) {
    errors.push("conversationKeyHash deve ser um hash sha256 hexadecimal (64 caracteres)");
  }
  if (request.requesterPhone !== undefined && typeof request.requesterPhone !== "string") {
    errors.push("requesterPhone deve ser um texto quando presente");
  }
  if (request.incomingText !== undefined && typeof request.incomingText !== "string") {
    errors.push("incomingText deve ser um texto quando presente");
  }
  if (request.sourceData !== undefined && !isObject(request.sourceData)) {
    errors.push("sourceData deve ser um objeto quando presente");
  } else if (isObject(request.sourceData) && request.sourceData.targetMode !== undefined) {
    if (!SOURCE_DATA_TARGET_MODES.has(request.sourceData.targetMode)) {
      errors.push("sourceData.targetMode deve ser reception, skill ou campaign");
    }
    if (request.sourceData.targetSkillId !== undefined && !UUID_PATTERN.test(request.sourceData.targetSkillId)) {
      errors.push("sourceData.targetSkillId deve ser um uuid quando presente");
    }
    if (request.sourceData.targetCampaignId !== undefined && !UUID_PATTERN.test(request.sourceData.targetCampaignId)) {
      errors.push("sourceData.targetCampaignId deve ser um uuid quando presente");
    }
  }
  if (request.shouldPersist !== undefined && typeof request.shouldPersist !== "boolean") {
    errors.push("shouldPersist deve ser booleano quando presente");
  }

  return errors;
}
