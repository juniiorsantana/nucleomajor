import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ETAPA 11B. A migration de hardening tira do alcance de `authenticated` as
// colunas estruturais do agente. Estes contratos travam a DECLARAÇÃO; a prova
// COMPORTAMENTAL — que roda como `authenticated`, exatamente como o PostgREST,
// e mede efeito real em vez de ausência de exceção — está em
// `scripts/sql/prova-fronteira-de-escrita.sql`, executada antes e depois.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME = "20260905160000_protege_campos_estruturais_dos_agentes.sql";

const sql = await readFile(new URL(NOME, MIGRATIONS_DIR), "utf8");
const executavel = sql
  .split("\n")
  .filter((linha) => !linha.trimStart().startsWith("--"))
  .join("\n");

// O texto de um GRANT específico, sem os comentários que citam as colunas de
// fora da lista de propósito.
function listaDe(tipo, tabela) {
  const padrao = new RegExp(
    `grant ${tipo} \\(([^)]*)\\)\\s*\\n?\\s*on public\\.${tabela} to authenticated`,
    "i",
  );
  const achado = executavel.match(padrao);
  assert.ok(achado, `não achei o grant de ${tipo} em ${tabela}`);
  return achado[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

test("A: o privilégio de tabela inteira sai das duas tabelas", () => {
  for (const tabela of ["assistant_profiles", "assistant_profile_skills"]) {
    assert.match(
      executavel,
      new RegExp(`revoke insert, update, delete, truncate on public\\.${tabela} from authenticated`, "i"),
      `${tabela} deveria perder o privilégio amplo antes de receber o fino`,
    );
  }
});

test("B: is_default e id ficam fora de INSERT — agente nasce comum por regra do BANCO", () => {
  const insert = listaDe("insert", "assistant_profiles");
  assert.ok(!insert.includes("is_default"), "is_default não pode ser inserível");
  assert.ok(!insert.includes("id"), "id não pode ser inserível");
  // E o que o produto precisa para criar agente continua lá.
  for (const coluna of ["organization_id", "audience", "display_name", "slug", "created_by", "updated_by"]) {
    assert.ok(insert.includes(coluna), `${coluna} precisa continuar inserível`);
  }
});

test("C: as quatro colunas estruturais ficam fora de UPDATE", () => {
  const update = listaDe("update", "assistant_profiles");
  for (const coluna of ["id", "organization_id", "audience", "is_default"]) {
    assert.ok(!update.includes(coluna), `${coluna} não pode ser atualizável`);
  }
});

test("D: audience e organization_id são inseríveis mas não atualizáveis", () => {
  // É exatamente isto que transforma "definido na criação, imutável depois" em
  // regra do banco em vez de promessa do JavaScript.
  const insert = listaDe("insert", "assistant_profiles");
  const update = listaDe("update", "assistant_profiles");
  for (const coluna of ["audience", "organization_id"]) {
    assert.ok(insert.includes(coluna), `${coluna} precisa ser inserível`);
    assert.ok(!update.includes(coluna), `${coluna} não pode ser atualizável`);
  }
});

test("E: o que a tela edita hoje continua editável — inclusive active", () => {
  const update = listaDe("update", "assistant_profiles");
  for (const coluna of [
    "display_name", "slug", "role", "tone", "soul_markdown",
    "brand_config", "process_config", "active", "updated_by",
  ]) {
    assert.ok(update.includes(coluna), `${coluna} precisa continuar editável`);
  }
  // `active` é o caso que mais tenta: desativar o PADRÃO é legítimo, e o
  // runtime já sabe recusar sem promover ninguém. Confundir com `is_default`
  // aqui reintroduziria, por segurança, a ambiguidade que a FASE C separou.
  assert.ok(update.includes("active"));
});

test("F: no vínculo de skill, só o comportamento é editável — nunca de quem é", () => {
  const update = listaDe("update", "assistant_profile_skills");
  for (const coluna of ["organization_id", "profile_id", "skill_id"]) {
    assert.ok(!update.includes(coluna), `${coluna} não pode ser atualizável`);
  }
  for (const coluna of ["enabled", "priority", "configuration", "updated_by"]) {
    assert.ok(update.includes(coluna), `${coluna} precisa continuar editável`);
  }
});

test("G: a migration é só hardening — não toca em produto", () => {
  assert.doesNotMatch(executavel, /create or replace function/i, "não redefine função");
  assert.doesNotMatch(executavel, /create policy|alter policy|drop policy/i, "não mexe em policy");
  assert.doesNotMatch(executavel, /drop (table|column|index|constraint)/i, "não remove estrutura");
  assert.doesNotMatch(
    executavel,
    /^\s*(insert into|update public|delete from)/im,
    "não altera dado existente",
  );
});

test("H: ela se recusa a rodar se a RPC de troca de padrão não existir", () => {
  // Fechar `is_default` sem a RPC deixaria o produto sem NENHUM caminho para
  // trocar o agente padrão — hardening que vira indisponibilidade.
  assert.match(executavel, /nucleo_agent_set_default/);
  assert.match(executavel, /prosecdef/);
  assert.match(executavel, /hardening abortado/);
});

test("I: e verifica o próprio resultado, nos dois sentidos", () => {
  assert.match(executavel, /coluna estrutural ainda gravavel/);
  assert.match(executavel, /coluna editavel perdeu UPDATE/);
  assert.match(executavel, /criar agente ficou impossivel/);
  // TRUNCATE é o único caminho que apagaria a tabela apesar da RLS.
  assert.match(executavel, /TRUNCATE continua concedido/);
});
