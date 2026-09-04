import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { assistantProfileToAgentDefinition, validateAgentDefinition } from "../packages/intelligence/src/agent.mjs";

// A migration da FASE B não pode ser aplicada aqui (não há Postgres neste
// ambiente — ver LIVE_RESOLVER_INTEGRATION = PENDING em
// docs/intelligence/INTELLIGENCE-CORE.md). O que estes testes provam é o que
// dá para provar sem banco: que ela é aditiva, que não afrouxa a unicidade,
// que não antecipa a FASE C, e que o adapter lê o que ela persiste.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME_DA_MIGRATION = "20260904160000_identidade_do_agente_em_assistant_profiles.sql";

const sql = await readFile(new URL(NOME_DA_MIGRATION, MIGRATIONS_DIR), "utf8");

// As checagens de "a migration NÃO pode conter X" precisam olhar o que a
// migration FAZ, não o que ela explica. Fora ficam duas camadas de prosa: os
// comentários `--` do cabeçalho, e o texto dentro de literais — que aqui são
// os `comment on column` e as mensagens de `raise notice`, ambos documentação
// que cita de propósito o que a fase deixou de fora ("unique (organization_id,
// slug)", "allowedTools"). Sem essa poda, o teste proibiria a própria
// documentação da decisão.
const sqlEstrutural = sql
  .split("\n")
  .filter((linha) => !linha.trimStart().startsWith("--"))
  .join("\n")
  .replace(/'(?:[^']|'')*'/g, "''");

// Linha de assistant_profiles DEPOIS da FASE B: já tem as colunas novas.
function linhaPersistida(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    organization_id: "00000000-0000-4000-8000-000000000001",
    template_id: "10000000-0000-0000-0000-000000000001",
    audience: "customer",
    display_name: "Marina",
    slug: "marina",
    role: "recepcionista",
    soul_markdown: "# Marina\n\nFalo devagar e nunca prometo horário.",
    tone: "acolhedor e direto",
    brand_config: {},
    process_config: { rollout: { mode: "off" } },
    active: true,
    ...overrides,
  };
}

test("A: slug persistido é preservado, não recalculado a partir do nome", () => {
  // O slug é identidade estável: se alguém renomear o agente, o slug antigo
  // continua valendo. Recalcular aqui apagaria a identidade técnica.
  const agente = assistantProfileToAgentDefinition(
    linhaPersistida({ display_name: "Marina Recepção", slug: "marina" }),
  );
  assert.equal(agente.slug, "marina");
  assert.equal(agente.name, "Marina Recepção");
  assert.deepEqual(validateAgentDefinition(agente), []);
});

test("B: role persistido é preservado", () => {
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida()).role, "recepcionista");
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida({ role: null })).role, null);
});

test("C: soul_markdown persistido é preservado, inteiro", () => {
  const soul = "# Marina\n\nFalo devagar e nunca prometo horário.";
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida()).soulMarkdown, soul);
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida({ soul_markdown: null })).soulMarkdown, null);
});

test("D: tone continua vindo da coluna que já existia, sem coluna nova", () => {
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida()).tone, "acolhedor e direto");
  // A migration não pode ter criado uma segunda coluna de tom.
  assert.ok(!/add column if not exists tone\b/.test(sqlEstrutural), "tone já existe; não pode ser recriado");
  // E o limite do domínio (500) espelha o check da coluna original.
  const tomLongo = "x".repeat(501);
  assert.ok(
    validateAgentDefinition(assistantProfileToAgentDefinition(linhaPersistida({ tone: tomLongo })))
      .some((erro) => erro.includes("tone")),
  );
});

test("E: linha legada sem as colunas novas ainda é adaptada — fallback de transição", () => {
  // Compatibilidade de transição, não fonte da verdade: serve para fixture
  // antiga e para banco onde a migration ainda não foi aplicada.
  const legada = linhaPersistida();
  delete legada.slug;
  delete legada.role;
  delete legada.soul_markdown;

  const agente = assistantProfileToAgentDefinition(legada);
  assert.deepEqual(validateAgentDefinition(agente), []);
  assert.equal(agente.slug, "marina", "slug cai na derivação a partir de display_name");
  assert.equal(agente.role, null, "role não tem fallback: sem coluna, null");
  assert.equal(agente.soulMarkdown, null, "soul não tem fallback: inventar persona seria pior que não ter");

  // slug vazio/em branco também cai no fallback, não vira slug inválido.
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida({ slug: "   " })).slug, "marina");
});

test("G: a migration analisa colisão de slug em vez de impor UNIQUE às cegas", () => {
  assert.ok(
    !/unique\s*\(\s*organization_id\s*,\s*slug\s*\)/i.test(sqlEstrutural),
    "esta fase não pode impor unique (organization_id, slug) sem ver os dados reais",
  );
  assert.ok(sql.includes("having count(*) > 1"), "a migration deveria contar as colisões");
  assert.ok(/raise notice/i.test(sql), "o relatório de colisão é NOTICE, não exceção — não pode derrubar a aplicação");
});

test("H: a migration mantém unique (organization_id, audience) e prova isso no apply", () => {
  assert.ok(
    !/drop\s+constraint/i.test(sqlEstrutural) && !/drop\s+index/i.test(sqlEstrutural),
    "nenhuma constraint/índice pode ser derrubado nesta fase",
  );
  assert.ok(
    sql.includes("array['audience', 'organization_id']"),
    "a migration deveria checar, no apply, que a unique continua existindo",
  );
  assert.ok(sql.includes("nao pode liberar multi-agent"));
});

test("H: a constraint original segue intacta na migration histórica", async () => {
  const original = "20260823120000_fase_h_inteligencia_contextual.sql";
  const historica = await readFile(new URL(original, MIGRATIONS_DIR), "utf8");
  assert.ok(historica.includes("unique (organization_id, audience)"), `${original} foi alterada`);
});

test("I: a migration não introduz is_default — isso é a FASE C", () => {
  assert.ok(!/add column[^;]*is_default/i.test(sqlEstrutural), "is_default não pertence a esta fase");
  assert.ok(
    sql.includes("is_default nao pertence a esta fase"),
    "a migration deveria falhar no apply se is_default aparecer",
  );
});

test("J: a migration não embute skill nem permissão no perfil", () => {
  for (const proibido of ["allowed_tools", "allowedTools", "permissions", "skill_id", "assistant_profile_skills"]) {
    assert.ok(!sqlEstrutural.includes(proibido), `a migration não pode tocar em "${proibido}"`);
  }
  const agente = assistantProfileToAgentDefinition(linhaPersistida());
  for (const campo of ["skills", "allowedTools", "permissions", "acl"]) {
    assert.ok(!(campo in agente), `AgentDefinition não pode carregar "${campo}"`);
  }
});

test("a migration é aditiva e não toca em resolvedor nenhum", () => {
  for (const resolvedor of [
    "intelligence_payload",
    "nucleo_intelligence_context_resolve_v2",
    "nucleo_intelligence_context_resolve_v3",
    "nucleo_customer_assistant_access",
  ]) {
    assert.ok(
      !new RegExp(`create or replace function[^;]*${resolvedor}`, "i").test(sqlEstrutural),
      `a FASE B não pode redefinir ${resolvedor}`,
    );
  }
  assert.ok(!/drop table/i.test(sqlEstrutural) && !/drop column/i.test(sqlEstrutural) && !/alter table[^;]*rename/i.test(sqlEstrutural));
});

test("nenhuma migration histórica foi editada para acomodar esta fase", async () => {
  // A FASE B só pode existir como arquivo novo.
  const arquivos = (await readdir(MIGRATIONS_DIR)).filter((nome) => nome.endsWith(".sql")).sort();
  const anteriores = arquivos.filter((nome) => nome < NOME_DA_MIGRATION);
  assert.ok(anteriores.length > 0);
  for (const nome of anteriores) {
    const conteudo = await readFile(new URL(nome, MIGRATIONS_DIR), "utf8");
    assert.ok(
      !conteudo.includes("soul_markdown") && !conteudo.includes("agent_slug"),
      `${nome} não deveria conhecer os campos da FASE B`,
    );
  }
});
