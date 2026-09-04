import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assistantProfileToAgentDefinition, validateAgentDefinition } from "../packages/intelligence/src/agent.mjs";

// FASE C. A migration não pôde ser aplicada aqui (não há Postgres neste
// ambiente). Os contratos abaixo se dividem em dois tipos, e a diferença
// importa na hora de confiar neles:
//
//   - DOMÍNIO (A, B, C): rodam de verdade, sobre o adapter.
//   - ESTRUTURAIS (D, E, F, G, H, I, J, K): asseguram que a migration DECLARA
//     a regra certa. Quem executa a regra é o Postgres, no apply — e a própria
//     migration falha sozinha se a declaração não estiver lá (bloco final).
//     A prova comportamental correspondente está em
//     scripts/sql/prova-agente-padrao.sql, para banco descartável.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME_DA_MIGRATION = "20260904190000_agente_padrao_explicito.sql";

const sql = await readFile(new URL(NOME_DA_MIGRATION, MIGRATIONS_DIR), "utf8");

// Só o SQL que executa: fora ficam os comentários `--` e o texto dentro de
// literais (os `comment on column` citam de propósito o que a fase não faz).
const sqlEstrutural = sql
  .split("\n")
  .filter((linha) => !linha.trimStart().startsWith("--"))
  .join("\n")
  .replace(/'(?:[^']|'')*'/g, "''");

function linhaPersistida(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    organization_id: "00000000-0000-4000-8000-000000000001",
    audience: "customer",
    display_name: "Marina",
    slug: "marina",
    role: null,
    soul_markdown: null,
    tone: "acolhedor e direto",
    active: true,
    is_default: true,
    ...overrides,
  };
}

test("A: perfil existente vira is_default=true pelo backfill, com a premissa verificada antes", () => {
  // O backfill marca todo mundo como padrão — o que só é correto porque a
  // unique antiga garante uma linha por (organização, audience). A migration
  // confere essa premissa em vez de supô-la.
  assert.ok(
    /having count\(\*\) > 1/.test(sqlEstrutural),
    "a migration deveria checar se há mais de um perfil por (organization_id, audience) antes do backfill",
  );
  assert.ok(
    /update public\.assistant_profiles\s+set is_default = true\s+where not is_default/.test(sqlEstrutural),
    "o backfill explícito não está lá",
  );
  assert.ok(
    sql.includes("o backfill nao pode assumir que todo perfil e o padrao da sua audience"),
    "a migration deveria falhar, com mensagem clara, se a premissa não valer",
  );
});

test("B: o AgentDefinition lê row.is_default do banco", () => {
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida({ is_default: true })).isDefault, true);
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida({ is_default: false })).isDefault, false);
  assert.deepEqual(validateAgentDefinition(assistantProfileToAgentDefinition(linhaPersistida({ is_default: false }))), []);
});

test("C: o fallback legado true só vale quando a coluna não existe", () => {
  const legada = linhaPersistida();
  delete legada.is_default;
  assert.equal(assistantProfileToAgentDefinition(legada).isDefault, true, "sem coluna, cai no fallback de transição");

  // Com a coluna presente, o banco manda — inclusive quando diz false.
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida({ is_default: false })).isDefault, false);
  // Valor não-booleano não é confundido com "false".
  assert.equal(assistantProfileToAgentDefinition(linhaPersistida({ is_default: null })).isDefault, true);
});

test("D: dois padrões na mesma organização e audience são rejeitados pelo índice parcial", () => {
  assert.ok(
    /create unique index if not exists assistant_profiles_one_default_idx\s+on public\.assistant_profiles \(organization_id, audience\)\s+where is_default/.test(sqlEstrutural),
    "o índice parcial de um padrão por audience não está declarado como esperado",
  );
  // E a migration se recusa a terminar se o índice não for parcial de fato.
  assert.ok(sql.includes("indexdef like '%WHERE is_default%'"));
  assert.ok(sql.includes("nao foi criado como parcial"));
});

test("E: um padrão de customer e um de internal convivem — o índice é por audience", () => {
  // `(organization_id, audience) where is_default` permite exatamente um par
  // por audience, então customer e internal não competem entre si.
  const indice = sqlEstrutural.match(/create unique index if not exists assistant_profiles_one_default_idx[^;]+/)[0];
  assert.ok(indice.includes("(organization_id, audience)"), "audience precisa fazer parte da chave do índice");
  assert.ok(!/\(organization_id\)\s*$/.test(indice), "o índice não pode ser só por organização");
});

test("F: a coluna nasce false, para que agente novo não vire padrão em silêncio", () => {
  assert.ok(
    /add column if not exists is_default boolean not null default false/.test(sqlEstrutural),
    "is_default precisa ser not null default false",
  );
  assert.ok(!/default true/i.test(sqlEstrutural), "nenhuma coluna desta fase pode nascer com default true");
});

test("G: provision_intelligence cria os dois perfis iniciais como padrão", () => {
  const funcao = sqlEstrutural.slice(sqlEstrutural.indexOf("create or replace function private.provision_intelligence"));
  const insertsDePerfil = [...funcao.matchAll(/insert into public\.assistant_profiles \(([^)]*)\)\s*values \(([^;]*?)\)\s*on conflict/gs)];
  assert.equal(insertsDePerfil.length, 2, "esperava os dois inserts de perfil inicial");
  for (const [, colunas, valores] of insertsDePerfil) {
    assert.ok(colunas.includes("is_default"), "o insert precisa informar is_default explicitamente");
    assert.ok(/,\s*true\s*$/.test(valores.trim()), "o valor de is_default precisa ser true");
  }
  for (const audience of ["'internal'", "'customer'"]) {
    assert.ok(funcao.includes(audience) || sql.includes(audience), `perfil ${audience} não encontrado`);
  }
});

test("H: unique (organization_id, audience) continua intacta", () => {
  assert.ok(
    !/drop\s+constraint/i.test(sqlEstrutural) && !/drop\s+index/i.test(sqlEstrutural),
    "a FASE C não pode derrubar constraint nem índice",
  );
  assert.ok(
    sql.includes("array['audience', 'organization_id']"),
    "a migration deveria provar, no apply, que a unique antiga continua existindo",
  );
  assert.ok(sql.includes("nao pode liberar multi-agent"));
});

test("I: ainda não é possível criar dois agentes da mesma audience", () => {
  // A unique antiga é o que impede — e ela não foi tocada. A FASE E é que
  // remove, e só depois da FASE D.
  assert.ok(!/alter table[^;]*drop constraint/i.test(sqlEstrutural));
  assert.ok(
    !/assistant_profiles_organization_id_audience_key/.test(sqlEstrutural),
    "a constraint antiga não pode ser referenciada para remoção",
  );
});

test("J: nenhum resolvedor foi tocado — roteamento não muda nesta fase", () => {
  for (const resolvedor of [
    "intelligence_payload",
    "nucleo_intelligence_context_resolve_v2",
    "nucleo_intelligence_context_resolve_v3",
    "nucleo_customer_assistant_access",
  ]) {
    assert.ok(
      !new RegExp(`create or replace function[^;]*${resolvedor}`, "i").test(sqlEstrutural),
      `a FASE C não pode redefinir ${resolvedor}`,
    );
  }
  // A única função redefinida é a de provisionamento, que não roteia nada.
  const redefinidas = [...sqlEstrutural.matchAll(/create or replace function ([a-z_.]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(redefinidas, ["private.provision_intelligence"]);
});

test("K: colisão de slug é rejeitada, e a unicidade é provada antes de ser imposta", () => {
  assert.ok(
    /add constraint assistant_profiles_organization_slug_key unique \(organization_id, slug\)/.test(sqlEstrutural),
    "a unicidade de slug por organização não está declarada",
  );
  // Impor sem conferir seria uma migration que falha em produção por dado.
  assert.ok(
    sql.includes("resolva antes de impor a unicidade de slug"),
    "a migration deveria contar colisões e falhar com mensagem clara antes de criar a constraint",
  );
  // display_name continua livre para repetir.
  assert.ok(
    !/unique \(organization_id, display_name\)/.test(sqlEstrutural),
    "display_name não deve ser único: dois agentes podem se chamar igual",
  );
});

test("a migration é aditiva: nada é derrubado, renomeado ou apagado", () => {
  assert.ok(!/drop table/i.test(sqlEstrutural));
  assert.ok(!/drop column/i.test(sqlEstrutural));
  assert.ok(!/alter table[^;]*rename/i.test(sqlEstrutural));
  assert.ok(!/delete from/i.test(sqlEstrutural));
});

test("nenhuma migration histórica foi editada para acomodar esta fase", async () => {
  for (const nome of ["20260823120000_fase_h_inteligencia_contextual.sql", "20260904160000_identidade_do_agente_em_assistant_profiles.sql"]) {
    const conteudo = await readFile(new URL(nome, MIGRATIONS_DIR), "utf8");
    // Mencionar não é declarar: a FASE B cita `is_default` justamente para
    // levantar exceção caso a coluna já exista. O que nenhuma migration
    // anterior pode ter é a criação da coluna.
    assert.ok(
      !/add column[^;]*is_default/i.test(conteudo),
      `${nome} não deveria criar a coluna is_default`,
    );
  }
});
