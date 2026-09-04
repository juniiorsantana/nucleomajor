/**
 * Adapters: payload cru de `nucleo_intelligence_context_resolve_v2`/`_v3`
 * (JSON já desserializado, como o driver Postgres/Supabase entrega) →
 * IntelligenceResolution. Não chamam o banco, não substituem os
 * resolvedores — só traduzem o que eles já devolvem. Ver a matriz de campos
 * em docs/intelligence/INTELLIGENCE-CONTRACT.md.
 *
 * v2 nunca expõe `stage`/`workflow`/`pendingAction` (nem para skills
 * internas com múltiplos estágios, como `tarefas`/`agenda`) — isso é
 * preservado como `null`, não inventado. v3, quando `audience !== 'customer'`,
 * devolve exatamente o payload de v2 (early return na função SQL); o adapter
 * de v3 lida com isso sozinho porque `runtimeContext.workflow` simplesmente
 * não existe nesse caso, e os campos correspondentes também saem `null`.
 *
 * Nenhum dos dois preenche `routingReason`: essa string só existe hoje no
 * lado JS (`apps/emyleads/src/domain/intelligenceRouter.js`), nunca é
 * serializada pelo SQL.
 */

import { CONTRACT_VERSION } from "./intelligence-resolution.mjs";

function mapAssistant(assistente) {
  if (!assistente) return null;
  return {
    id: assistente.id ?? null,
    name: assistente.nome ?? null,
    tone: assistente.tom ?? null,
    brand: assistente.marca ?? null,
    process: assistente.processo ?? null,
    templateId: assistente.templateId ?? null,
  };
}

function mapCampaign(campanha) {
  if (!campanha) return null;
  return {
    id: campanha.id ?? null,
    name: campanha.nome ?? null,
    objective: campanha.objetivo ?? null,
    offer: campanha.oferta ?? null,
    targetAudience: campanha.publico ?? null,
    // `settings` (configuracao) é jsonb livre por campanha. Preservado aqui
    // de propósito (ver passo 7 — não descartar informação para o contrato
    // "ficar bonito"), mas quem monta um prompt a partir da Resolution deve
    // decidir o que expor: `src/intelligenceContext.mjs` já remove este
    // mesmo campo antes de montar o prompt do assistente web, por conter
    // dados potencialmente sensíveis (comentário no próprio arquivo).
    settings: campanha.configuracao ?? null,
    expectedResult: campanha.resultadoEsperado ?? null,
  };
}

function mapSkill(activeSkill) {
  if (!activeSkill) return null;
  return {
    id: activeSkill.id ?? null,
    slug: activeSkill.slug ?? null,
    name: activeSkill.name ?? null,
    version: activeSkill.version ?? null,
    contentHash: activeSkill.contentHash ?? null,
    objective: activeSkill.objective ?? null,
    instructions: activeSkill.instructions ?? null,
  };
}

function mapStage(stageSpec) {
  if (!stageSpec) return null;
  return {
    id: stageSpec.id ?? null,
    objective: stageSpec.objective ?? null,
    requiredFields: stageSpec.requiredFields ?? [],
    allowedTools: stageSpec.allowedTools ?? [],
    completion: stageSpec.completion ?? null,
  };
}

function mapKnowledge(colecoes) {
  return (colecoes ?? []).map((colecao) => ({
    id: colecao.id ?? null,
    name: colecao.nome ?? null,
    scope: colecao.escopo ?? null,
    audience: colecao.audiencia ?? null,
  }));
}

function mapRuntimeWorkflow(workflow) {
  if (!workflow) return null;
  return {
    sessionId: workflow.sessionId ?? null,
    revision: workflow.revision ?? null,
    primarySkillId: workflow.primarySkillId ?? null,
    activeSkillId: workflow.activeSkillId ?? null,
    stack: workflow.stack ?? [],
    expiresAt: workflow.expiresAt ?? null,
    subflowExpiresAt: workflow.subflowExpiresAt ?? null,
    confirmationMinutes: workflow.confirmationMinutes ?? null,
  };
}

/**
 * payload = retorno cru de `nucleo_intelligence_context_resolve_v2`
 * (schemaVersion 'fase-h-2'). Nunca tem `runtimeContext.workflow`.
 */
export function resolutionFromV2(payload) {
  const runtimeContext = payload?.runtimeContext ?? {};
  const activeSkill = runtimeContext.activeSkill ?? null;
  return {
    contractVersion: CONTRACT_VERSION,
    sourceSchemaVersion: payload?.schemaVersion ?? null,
    contextId: payload?.contextoId ?? null,
    audience: runtimeContext.audience ?? payload?.audiencia ?? null,
    assistant: mapAssistant(runtimeContext.assistant),
    campaign: mapCampaign(runtimeContext.campaign),
    skill: mapSkill(activeSkill),
    stage: null,
    allowedTools: activeSkill?.allowedTools ?? [],
    guardrails: activeSkill?.guardrails ?? [],
    handoff: activeSkill?.handoff ?? [],
    knowledge: mapKnowledge(runtimeContext.allowedCollections),
    policies: runtimeContext.policies ?? {},
    runtimeContext: null,
    pendingAction: null,
    routingReason: null,
  };
}

/**
 * payload = retorno cru de `nucleo_intelligence_context_resolve_v3`
 * (schemaVersion 'fase-h-3' quando audience === 'customer'; caso contrário
 * v3 devolve o payload de v2 sem alteração — este adapter cobre os dois
 * casos, porque `runtimeContext.workflow` só existe no primeiro).
 */
export function resolutionFromV3(payload) {
  const runtimeContext = payload?.runtimeContext ?? {};
  const activeSkill = runtimeContext.activeSkill ?? null;
  const workflow = runtimeContext.workflow ?? null;
  const stage = mapStage(workflow?.stageSpec ?? null);
  return {
    contractVersion: CONTRACT_VERSION,
    sourceSchemaVersion: payload?.schemaVersion ?? null,
    contextId: payload?.contextoId ?? null,
    audience: runtimeContext.audience ?? payload?.audiencia ?? null,
    assistant: mapAssistant(runtimeContext.assistant),
    campaign: mapCampaign(runtimeContext.campaign),
    skill: mapSkill(activeSkill),
    stage,
    allowedTools: stage?.allowedTools ?? activeSkill?.allowedTools ?? [],
    guardrails: activeSkill?.guardrails ?? [],
    handoff: activeSkill?.handoff ?? [],
    knowledge: mapKnowledge(runtimeContext.allowedCollections),
    policies: runtimeContext.policies ?? {},
    runtimeContext: mapRuntimeWorkflow(workflow),
    pendingAction: workflow ? { pending: Boolean(workflow.pendingSensitiveAction) } : null,
    routingReason: null,
  };
}
