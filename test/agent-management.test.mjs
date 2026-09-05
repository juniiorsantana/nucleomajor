import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_ERRORS,
  AgentError,
  agentCommandToRow,
  agentPatchToRow,
  assertUpdatable,
  buildCreateAgentCommand,
  buildUpdateAgentCommand,
  mapDatabaseError,
} from "../packages/intelligence/src/agent-management.mjs";
import { slugFromAgentName } from "../packages/intelligence/src/agent.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const OUTRA_ORG = "00000000-0000-4000-8000-000000000002";
const ATOR = "00000000-0000-4000-8000-0000000000f1";

function criar(overrides = {}) {
  return buildCreateAgentCommand({
    organizationId: ORG,
    audience: "customer",
    name: "Emília",
    ...overrides,
  });
}

test("D: agente novo nasce NÃO-padrão, sempre", () => {
  // Regra 1 do módulo: promover é ato explícito. Nem passando isDefault true
  // de fora — o comando ignora, não obedece.
  assert.equal(criar().isDefault, false);
  assert.equal(criar({ isDefault: true }).isDefault, false);
  assert.equal(agentCommandToRow(criar({ isDefault: true }), { actor: ATOR }).is_default, false);
});

test("A/B/C: criar agentes de qualquer audience é aceito pelo domínio", () => {
  // O que impedia 2 customer não era o domínio, era a unique que a FASE E
  // removeu. Aqui só resta a validação.
  for (const audience of ["customer", "internal"]) {
    const comando = criar({ audience, name: "Closer" });
    assert.equal(comando.audience, audience);
    assert.equal(comando.name, "Closer");
  }
  assert.throws(() => criar({ audience: "parceiro" }), (erro) => {
    assert.ok(erro instanceof AgentError);
    assert.equal(erro.code, AGENT_ERRORS.INVALID);
    return true;
  });
});

test("o slug sai da REGRA CANÔNICA, não de uma terceira implementação", () => {
  // Se este teste e agent-slug-equivalence divergirem, é porque alguém criou
  // uma quarta regra de slug — que é exatamente o que o módulo proíbe.
  assert.equal(criar({ name: "Emília" }).slug, slugFromAgentName("Emília", "customer"));
  assert.equal(criar({ name: "Emília" }).slug, "emilia");
  assert.equal(criar({ name: "Agente de Pré-Qualificação" }).slug, "agente-de-pre-qualificacao");
  // Slug explícito é respeitado, desde que válido.
  assert.equal(criar({ name: "Closer", slug: "closer-noturno" }).slug, "closer-noturno");
  assert.throws(() => criar({ name: "Closer", slug: "Closer Noturno" }), AgentError);
});

test("E/F: colisão de slug vira erro de DOMÍNIO, não 23505 cru", () => {
  // E: mesma org, mesmo slug. O banco levanta unique_violation na constraint
  // de slug; a UI precisa entender "renomeie", não "23505".
  const erro = mapDatabaseError({
    code: "23505",
    message: 'duplicate key value violates unique constraint "assistant_profiles_organization_slug_key"',
  });
  assert.ok(erro instanceof AgentError);
  assert.equal(erro.code, AGENT_ERRORS.SLUG_ALREADY_EXISTS);
  assert.match(erro.message, /identificador/i);

  // A colisão do índice parcial é outra coisa e pede outra ação: trocar o
  // padrão em vez de criar mais um.
  const erroPadrao = mapDatabaseError({
    code: "23505",
    message: 'duplicate key value violates unique constraint "assistant_profiles_one_default_idx"',
  });
  assert.equal(erroPadrao.code, AGENT_ERRORS.DEFAULT_ALREADY_EXISTS);

  // F: o mesmo slug em OUTRA organização não é colisão nenhuma — a unique é
  // por (organization_id, slug). O domínio não impede.
  assert.equal(criar({ name: "Emília" }).slug, criar({ organizationId: OUTRA_ORG, name: "Emília" }).slug);
});

test("G: editar não move o agente de organização nem troca a audience", () => {
  assert.throws(() => assertUpdatable({ organizationId: OUTRA_ORG }), (erro) => {
    assert.equal(erro.code, AGENT_ERRORS.ORGANIZATION_IMMUTABLE);
    return true;
  });
  assert.throws(() => assertUpdatable({ organization_id: OUTRA_ORG }), AgentError);

  // audience é identidade estrutural: decide conhecimento visível, skills
  // amarráveis e qual índice parcial de padrão o agente disputa.
  assert.throws(() => assertUpdatable({ audience: "internal" }), (erro) => {
    assert.equal(erro.code, AGENT_ERRORS.AUDIENCE_IMMUTABLE);
    return true;
  });

  // E o patch normalizado nunca carrega essas colunas.
  const row = agentPatchToRow(buildUpdateAgentCommand({ name: "Emília II" }), { actor: ATOR });
  assert.ok(!("organization_id" in row));
  assert.ok(!("audience" in row));
  assert.ok(!("is_default" in row));
  assert.equal(row.display_name, "Emília II");
});

test("I: isDefault não entra por updateAgent — trocar padrão é operação própria", () => {
  // Deixar passar reabriria o "update um false, update outro true" que a RPC
  // atômica existe para fechar.
  for (const patch of [{ isDefault: true }, { is_default: true }]) {
    assert.throws(() => buildUpdateAgentCommand(patch), (erro) => {
      assert.equal(erro.code, AGENT_ERRORS.INVALID);
      assert.match(erro.details.join(" "), /setDefaultAgent/);
      return true;
    });
  }
});

test("L: desativar é edição comum e não fala de padrão nenhum", () => {
  // Desativar o padrão é permitido; promover outro NÃO é efeito colateral.
  const row = agentPatchToRow(buildUpdateAgentCommand({ active: false }), { actor: ATOR });
  assert.equal(row.active, false);
  assert.deepEqual(Object.keys(row).sort(), ["active", "updated_by"]);
});

test("campos opcionais viram null em vez de string vazia", () => {
  const comando = criar({ role: "   ", tone: "", soulMarkdown: "  " });
  assert.equal(comando.role, null);
  assert.equal(comando.tone, null);
  assert.equal(comando.soulMarkdown, null);
  // E tone respeita o limite real da coluna (500).
  assert.equal(criar({ tone: "x".repeat(900) }).tone.length, 500);
});

test("o patch vazio é recusado, em vez de virar UPDATE sem efeito", () => {
  assert.throws(() => buildUpdateAgentCommand({}), AgentError);
});

test("H: negativa de RLS vira FORBIDDEN, não erro genérico", () => {
  for (const bruto of [
    { code: "42501", message: "permission denied for table assistant_profiles" },
    { message: 'new row violates row-level security policy for table "assistant_profiles"' },
    { message: "organization management required" },
  ]) {
    const erro = mapDatabaseError(bruto);
    assert.ok(erro instanceof AgentError, JSON.stringify(bruto));
    assert.equal(erro.code, AGENT_ERRORS.FORBIDDEN);
  }
});

test("erro que o domínio não reconhece NÃO é engolido", () => {
  // Traduzir tudo em AgentError esconderia falha real de infra.
  assert.equal(mapDatabaseError({ code: "08006", message: "connection failure" }), null);
  assert.equal(mapDatabaseError(null), null);
});

test("soul e persona não carregam permissão", () => {
  // Regra 3: o comando de criação não tem, e não pode ganhar, campo de
  // ferramenta/permissão. Skills continuam entidade separada.
  const comando = criar({ soulMarkdown: "# Emília\nSeja calorosa.", allowedTools: ["crm.contact.upsert"] });
  assert.ok(!("allowedTools" in comando));
  assert.ok(!("skills" in comando));
  assert.ok(!("permissions" in comando));
  const row = agentCommandToRow(comando, { actor: ATOR });
  assert.ok(!("allowed_tools" in row));
  assert.equal(row.soul_markdown, "# Emília\nSeja calorosa.");
});
