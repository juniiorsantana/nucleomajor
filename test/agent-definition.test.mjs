import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_AUDIENCES,
  AGENT_STATUSES,
  assistantProfileToAgentDefinition,
  slugFromAgentName,
  validateAgentDefinition,
} from "../packages/intelligence/src/agent.mjs";

// Linha realista de `assistant_profiles`, sanitizada — mesmas colunas que a
// migration 20260823120000_fase_h_inteligencia_contextual.sql:159-175 cria.
function linhaDePerfil(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    organization_id: "00000000-0000-4000-8000-000000000001",
    template_id: "10000000-0000-0000-0000-000000000001",
    audience: "internal",
    display_name: "Assistente interno",
    tone: "claro, cordial e objetivo",
    brand_config: {},
    process_config: { rollout: { mode: "off" } },
    active: true,
    created_by: "00000000-0000-4000-8000-0000000000f1",
    updated_by: "00000000-0000-4000-8000-0000000000f1",
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
    ...overrides,
  };
}

function agenteValido(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    organizationId: "00000000-0000-4000-8000-000000000001",
    name: "Assistente interno",
    slug: "assistente-interno",
    audience: "internal",
    role: null,
    tone: "claro, cordial e objetivo",
    soulMarkdown: null,
    status: "active",
    isDefault: true,
    ...overrides,
  };
}

test("A: um AgentDefinition válido não produz erros", () => {
  assert.deepEqual(validateAgentDefinition(agenteValido()), []);
  // Com os campos opcionais preenchidos também.
  assert.deepEqual(
    validateAgentDefinition(
      agenteValido({ role: "recepcionista", soulMarkdown: "# Quem sou\n\nRespondo com calma." }),
    ),
    [],
  );
  assert.deepEqual(validateAgentDefinition(null), ["AgentDefinition deve ser um objeto"]);
});

test("B: nome vazio é rejeitado", () => {
  assert.ok(validateAgentDefinition(agenteValido({ name: "" })).some((e) => e.includes("name")));
  assert.ok(validateAgentDefinition(agenteValido({ name: "   " })).some((e) => e.includes("name")));
  assert.ok(validateAgentDefinition(agenteValido({ name: "a" })).some((e) => e.includes("name")));
  assert.ok(validateAgentDefinition(agenteValido({ name: "x".repeat(101) })).some((e) => e.includes("name")));
});

test("C: slug inválido é rejeitado", () => {
  for (const slug of ["Assistente Interno", "assistente_interno", "-assistente", "assistente-", "", "açaí"]) {
    assert.ok(
      validateAgentDefinition(agenteValido({ slug })).some((e) => e.includes("slug")),
      `slug deveria ser rejeitado: ${JSON.stringify(slug)}`,
    );
  }
});

test("D: audience inválida é rejeitada", () => {
  for (const audience of ["both", "interno", "", null, undefined]) {
    assert.ok(
      validateAgentDefinition(agenteValido({ audience })).some((e) => e.includes("audience")),
      `audience deveria ser rejeitada: ${JSON.stringify(audience)}`,
    );
  }
  // "both" existe para SKILLS, não para agente — assistant_profiles só
  // aceita internal/customer (check constraint da migration).
  assert.deepEqual([...AGENT_AUDIENCES].sort(), ["customer", "internal"]);
});

test("E: status inválido é rejeitado", () => {
  for (const status of ["draft", "archived", "ativo", true, null]) {
    assert.ok(
      validateAgentDefinition(agenteValido({ status })).some((e) => e.includes("status")),
      `status deveria ser rejeitado: ${JSON.stringify(status)}`,
    );
  }
  assert.deepEqual([...AGENT_STATUSES].sort(), ["active", "inactive"]);
});

test("F: uma linha real de assistant_profiles vira um AgentDefinition válido", () => {
  const interno = assistantProfileToAgentDefinition(linhaDePerfil());
  assert.deepEqual(validateAgentDefinition(interno), []);
  assert.deepEqual(interno, {
    id: "00000000-0000-4000-8000-0000000000a1",
    organizationId: "00000000-0000-4000-8000-000000000001",
    name: "Assistente interno",
    slug: "assistente-interno",
    audience: "internal",
    role: null,
    tone: "claro, cordial e objetivo",
    soulMarkdown: null,
    status: "active",
    isDefault: true,
  });

  const cliente = assistantProfileToAgentDefinition(
    linhaDePerfil({
      id: "00000000-0000-4000-8000-0000000000a2",
      audience: "customer",
      display_name: "Assistente da empresa",
      active: false,
    }),
  );
  assert.deepEqual(validateAgentDefinition(cliente), []);
  assert.equal(cliente.slug, "assistente-da-empresa");
  assert.equal(cliente.status, "inactive");

  // Nome com acento e pontuação continua gerando slug válido.
  const acentuado = assistantProfileToAgentDefinition(linhaDePerfil({ display_name: "Recepção — Clínica!" }));
  assert.equal(acentuado.slug, "recepcao-clinica");
  assert.deepEqual(validateAgentDefinition(acentuado), []);

  // display_name só com símbolos ainda passa no check do banco (2 chars);
  // o slug cai no fallback determinístico em vez de sair inválido.
  assert.equal(slugFromAgentName("!!", "customer"), "agente-customer");
});

test("G: soulMarkdown é preservado quando existe, e é null quando a origem não tem", () => {
  // Hoje assistant_profiles não tem coluna de soul — o adapter devolve null
  // em vez de inventar conteúdo de persona.
  assert.equal(assistantProfileToAgentDefinition(linhaDePerfil()).soulMarkdown, null);

  // E o contrato aceita e preserva o markdown quando ele existir (FASE B).
  const soul = "# Marina\n\nSou a recepcionista da clínica. Falo devagar e nunca prometo horário.";
  const agente = agenteValido({ soulMarkdown: soul });
  assert.deepEqual(validateAgentDefinition(agente), []);
  assert.equal(agente.soulMarkdown, soul);
});

test("H: o adapter não inventa permissões — soul é persona, não autorização", () => {
  const agente = assistantProfileToAgentDefinition(linhaDePerfil());
  for (const campo of ["allowedTools", "tools", "permissions", "acl", "grants", "scopes"]) {
    assert.ok(!(campo in agente), `AgentDefinition não pode carregar "${campo}"`);
  }
  // process_config/brand_config da linha original não viram permissão nem
  // vazam para dentro do agente por acidente.
  assert.ok(!("process_config" in agente) && !("processConfig" in agente));
  assert.ok(!("brand_config" in agente) && !("brandConfig" in agente));
});

test("I: skills continuam entidade independente — o AgentDefinition não as carrega", () => {
  const agente = assistantProfileToAgentDefinition(linhaDePerfil());
  for (const campo of ["skills", "skillIds", "assistant_profile_skills", "profileSkills"]) {
    assert.ok(!(campo in agente), `AgentDefinition não pode embutir "${campo}"`);
  }
  // Um AgentDefinition com skills embutidas continua "válido" quanto à
  // forma dos campos exigidos — a separação é uma regra de modelagem
  // (documentada em agent.mjs e em MULTI-AGENT-MIGRATION.md), garantida
  // pelo adapter não produzir esse campo, não por rejeição do validador.
  assert.deepEqual(Object.keys(agente).sort(), [
    "audience",
    "id",
    "isDefault",
    "name",
    "organizationId",
    "role",
    "slug",
    "soulMarkdown",
    "status",
    "tone",
  ]);
});

test("isDefault vem true do adapter porque a UNIQUE atual garante um agente por audience", () => {
  // Esta derivação é o ponto exato que a FASE C precisa substituir por uma
  // coluna real ANTES da FASE E remover unique (organization_id, audience).
  assert.equal(assistantProfileToAgentDefinition(linhaDePerfil()).isDefault, true);
  assert.equal(assistantProfileToAgentDefinition(linhaDePerfil({ active: false })).isDefault, true);
  assert.equal(assistantProfileToAgentDefinition(null), null);
});
