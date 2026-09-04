import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { loadSkillCatalog } from "../packages/intelligence/src/catalog.mjs";
import { resolutionFromV2, resolutionFromV3 } from "../packages/intelligence/src/contracts/adapters.mjs";
import { validateIntelligenceRequest } from "../packages/intelligence/src/contracts/intelligence-request.mjs";
import { CONTRACT_VERSION, validateIntelligenceResolution } from "../packages/intelligence/src/contracts/intelligence-resolution.mjs";
import { isKnownTool } from "../packages/intelligence/src/tools.mjs";

const FIXTURES_DIR = new URL("./fixtures/intelligence/", import.meta.url);

async function loadFixture(nome) {
  const raw = await readFile(new URL(nome, FIXTURES_DIR), "utf8");
  return JSON.parse(raw);
}

async function loadAllFixtures() {
  const arquivos = (await readdir(FIXTURES_DIR)).filter((nome) => nome.endsWith(".json"));
  return Promise.all(arquivos.map(loadFixture));
}

function resolveFixture(fixture) {
  return fixture.function === "v3" ? resolutionFromV3(fixture.payload) : resolutionFromV2(fixture.payload);
}

// A: Request válido passa.
test("A: um IntelligenceRequest válido não produz erros", async () => {
  const fixtures = await loadAllFixtures();
  for (const fixture of fixtures) {
    const errors = validateIntelligenceRequest(fixture.request);
    assert.deepEqual(errors, [], `${fixture.description}: ${errors.join(" | ")}`);
  }
});

// B: Request inválido falha.
test("B: um IntelligenceRequest inválido é rejeitado com o erro certo", () => {
  assert.deepEqual(validateIntelligenceRequest(null), ["IntelligenceRequest deve ser um objeto"]);

  const base = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    audience: "customer",
    channel: "whatsapp",
    conversationKeyHash: "a1".repeat(32),
  };
  assert.deepEqual(validateIntelligenceRequest(base), []);

  const semOrg = { ...base, organizationId: "não-é-um-uuid" };
  assert.ok(validateIntelligenceRequest(semOrg).some((e) => e.includes("organizationId")));

  const audienciaRuim = { ...base, audience: "both" };
  assert.ok(validateIntelligenceRequest(audienciaRuim).some((e) => e.includes("audience")));

  const canalRuim = { ...base, channel: "sms" };
  assert.ok(validateIntelligenceRequest(canalRuim).some((e) => e.includes("channel")));

  const hashCurto = { ...base, conversationKeyHash: "abc123" };
  assert.ok(validateIntelligenceRequest(hashCurto).some((e) => e.includes("conversationKeyHash")));

  const targetModeRuim = { ...base, sourceData: { targetMode: "algo-invalido" } };
  assert.ok(validateIntelligenceRequest(targetModeRuim).some((e) => e.includes("sourceData.targetMode")));
});

// C: Resolution válida passa.
test("C: uma IntelligenceResolution válida (adaptada de fixture real) não produz erros", async () => {
  const fixtures = await loadAllFixtures();
  for (const fixture of fixtures) {
    const resolution = resolveFixture(fixture);
    const errors = validateIntelligenceResolution(resolution);
    assert.deepEqual(errors, [], `${fixture.description}: ${errors.join(" | ")}`);
  }
});

// D: Tool inexistente na Resolution falha.
test("D: allowedTools com ferramenta fora do Tool Registry é rejeitado", async () => {
  const fixture = await loadFixture("recepcao-v3-primeiro-contato.json");
  const resolution = resolveFixture(fixture);
  const invalida = { ...resolution, allowedTools: [...resolution.allowedTools, "tool.inexistente"] };
  const errors = validateIntelligenceResolution(invalida);
  assert.ok(errors.some((e) => e.includes("tool.inexistente")), errors.join(" | "));

  const stageInvalido = {
    ...resolution,
    stage: resolution.stage
      ? { ...resolution.stage, allowedTools: [...resolution.stage.allowedTools, "tool.inexistente"] }
      : { id: "x", objective: "x", requiredFields: [], allowedTools: ["tool.inexistente"], completion: "x" },
  };
  assert.ok(
    validateIntelligenceResolution(stageInvalido).some((e) => e.includes("stage.allowedTools") && e.includes("tool.inexistente")),
  );
});

// E: Payload realista de v2 consegue virar Resolution.
test("E: payload real de resolve_v2 (skill interna tarefas) vira Resolution válida e sem stage", async () => {
  const fixture = await loadFixture("tarefa-v2-interna.json");
  const resolution = resolutionFromV2(fixture.payload);
  assert.deepEqual(validateIntelligenceResolution(resolution), []);
  assert.equal(resolution.contractVersion, CONTRACT_VERSION);
  assert.equal(resolution.sourceSchemaVersion, "fase-h-2");
  assert.equal(resolution.audience, "internal");
  assert.equal(resolution.skill.slug, "tarefas");
  assert.deepEqual(resolution.allowedTools, ["task.read", "task.prepare", "task.confirm", "knowledge.search"]);
  // v2 nunca expõe stage, mesmo tarefas tendo workflow de 4 estágios em skill.json.
  assert.equal(resolution.stage, null);
  assert.equal(resolution.runtimeContext, null);
  assert.equal(resolution.pendingAction, null);
});

// F: Payload realista de v3 consegue virar Resolution.
test("F: payload real de resolve_v3 (solicitacao-agenda pendente) vira Resolution válida com stage e workflow", async () => {
  const fixture = await loadFixture("solicitacao-agenda-v3-pendente.json");
  const resolution = resolutionFromV3(fixture.payload);
  assert.deepEqual(validateIntelligenceResolution(resolution), []);
  assert.equal(resolution.sourceSchemaVersion, "fase-h-3");
  assert.equal(resolution.skill.slug, "solicitacao-agenda");
  assert.equal(resolution.stage.id, "confirmar_cliente");
  assert.deepEqual(resolution.allowedTools, ["calendar.request.prepare"]); // vem do estágio, não da skill inteira
  assert.equal(resolution.pendingAction.pending, true);
  assert.equal(resolution.runtimeContext.sessionId, "00000000-0000-4000-8000-000000000063");
  assert.deepEqual(resolution.runtimeContext.stack, [
    { skillId: "00000000-0000-4000-8000-000000000051", skillSlug: "recepcao", returnStage: "entender" },
  ]);
});

// G: Campos críticos não são perdidos no adapter.
test("G: informação crítica sobrevive ao adapter (campaign.settings, stack, pendingAction, contentHash)", async () => {
  const vendas = resolveFixture(await loadFixture("vendas-v3-com-campanha.json"));
  assert.deepEqual(vendas.campaign.settings, { canal: "meta-ads", criativoId: "cr-482" });
  assert.equal(vendas.campaign.expectedResult, "assinatura do plano anual");
  assert.equal(vendas.skill.contentHash, "b2c3d4e5f60718293a4b5c6d7e8f9001122334455667788990aabbccddeeff2");
  assert.deepEqual(vendas.runtimeContext.stack, [
    { skillId: "00000000-0000-4000-8000-000000000051", skillSlug: "recepcao", returnStage: "entender" },
  ]);

  const semSkill = resolveFixture(await loadFixture("sem-skill-v2-interna.json"));
  assert.equal(semSkill.skill, null);
  assert.deepEqual(semSkill.allowedTools, []);
  assert.equal(semSkill.contextId, null);
});

// H: As 7 skills atuais conseguem ser representadas no contrato.
test("H: as 7 skills publicadas do catálogo cabem em uma IntelligenceResolution válida", async () => {
  const catalogo = await loadSkillCatalog();
  assert.equal(catalogo.filter((entry) => entry.errors.length).length, 0, "catálogo de skills inválido");
  assert.equal(catalogo.length, 7, "esperava as 7 skills atuais");

  for (const entry of catalogo) {
    const skill = entry.skill;
    const stages = skill.workflow?.stages ?? [];
    const estagiosParaTestar = stages.length ? stages : [null];
    for (const stage of estagiosParaTestar) {
      const payload = {
        schemaVersion: skill.audience === "internal" ? "fase-h-2" : "fase-h-3",
        contextoId: "00000000-0000-4000-8000-000000000000",
        runtimeContext: {
          audience: skill.audience === "internal" ? "internal" : "customer",
          assistant: { id: "a", nome: "Ana", tom: "neutro", marca: {}, processo: {}, templateId: "t" },
          campaign: null,
          activeSkill: {
            id: skill.slug,
            slug: skill.slug,
            name: skill.name,
            version: 1,
            contentHash: "0".repeat(64),
            objective: skill.objective,
            instructions: entry.instructions,
            allowedTools: skill.allowedTools,
            guardrails: skill.guardrails,
            handoff: skill.handoff,
          },
          workflow: stage
            ? {
                sessionId: "00000000-0000-4000-8000-000000000000",
                revision: 1,
                primarySkillId: skill.slug,
                activeSkillId: skill.slug,
                stage: stage.id,
                stageSpec: stage,
                stack: [],
                pendingSensitiveAction: false,
                expiresAt: null,
                subflowExpiresAt: null,
                confirmationMinutes: 10,
              }
            : undefined,
          allowedCollections: [],
          policies: {},
        },
      };
      const resolution = skill.audience === "internal" ? resolutionFromV2(payload) : resolutionFromV3(payload);
      const errors = validateIntelligenceResolution(resolution);
      assert.deepEqual(errors, [], `${skill.slug}${stage ? `/${stage.id}` : ""}: ${errors.join(" | ")}`);
      for (const tool of resolution.allowedTools) assert.ok(isKnownTool(tool), `${skill.slug}: ${tool} fora do Registry`);
    }
  }
});
