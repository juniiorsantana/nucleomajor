import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { slugFromAgentName } from "../packages/intelligence/src/agent.mjs";

// A regra de slug de agente existe em dois lugares: `slugFromAgentName` no
// domínio e `private.agent_slug` na migration
// 20260904160000_identidade_do_agente_em_assistant_profiles.sql, que fez o
// backfill e preenche toda linha nova.
//
// Dois algoritmos "parecidos" é exatamente o que este arquivo existe para
// impedir. A garantia é feita em três camadas:
//
//   1. aqui: o corpus canônico bate com a implementação JavaScript;
//   2. aqui: o bloco de prova DENTRO da migration cobre exatamente o mesmo
//      corpus, com as mesmas expectativas (comparação textual do SQL);
//   3. na aplicação da migration: aquele bloco roda no Postgres real e
//      levanta exceção se o banco computar algo diferente — a migration
//      falha em vez de gravar slug divergente.
//
// A camada 3 é a única que prova o comportamento do Postgres, e não pode
// rodar aqui (não há banco). As camadas 1 e 2 garantem que, quando ela
// rodar, ela estará checando a coisa certa.

const MIGRATION = new URL(
  "../supabase/migrations/20260904160000_identidade_do_agente_em_assistant_profiles.sql",
  import.meta.url,
);
const CORPUS = new URL("./fixtures/agent/agent-slug-cases.json", import.meta.url);

const { cases } = JSON.parse(await readFile(CORPUS, "utf8"));
const sql = await readFile(MIGRATION, "utf8");

// Extrai os trios ['nome', 'audience', 'slug'] do array `casos` do bloco de
// prova da migration. Nenhum nome do corpus contém aspas simples (garantido
// pelo próprio teste abaixo), então o literal SQL é delimitado sem escape.
function casosDeclaradosNaMigration() {
  const bloco = sql.slice(sql.indexOf("casos constant text[][] := array["));
  const array = bloco.slice(0, bloco.indexOf("];"));
  return [...array.matchAll(/\['([^']*)',\s*'([^']*)',\s*'([^']*)'\]/g)].map((match) => ({
    name: match[1],
    audience: match[2],
    slug: match[3],
  }));
}

test("F: o corpus canônico bate com a implementação JavaScript da regra de slug", () => {
  assert.ok(cases.length >= 10, "o corpus precisa cobrir mais que os dois nomes semeados");
  for (const caso of cases) {
    assert.equal(
      slugFromAgentName(caso.name, caso.audience),
      caso.slug,
      `slugFromAgentName(${JSON.stringify(caso.name)}, ${JSON.stringify(caso.audience)})`,
    );
  }
});

test("F: o bloco de prova da migration cobre exatamente o mesmo corpus, com as mesmas expectativas", () => {
  const naMigration = casosDeclaradosNaMigration();
  assert.ok(naMigration.length > 0, "não achei o array `casos` no bloco de prova da migration");

  const ordenar = (lista) =>
    [...lista]
      .map((caso) => `${caso.name}|${caso.audience}|${caso.slug}`)
      .sort();

  assert.deepEqual(
    ordenar(naMigration),
    ordenar(cases),
    "o corpus do bloco de prova SQL divergiu de agent-slug-cases.json; os dois lados precisam provar a mesma coisa",
  );
});

test("F: nenhum nome do corpus tem aspas simples, senão a extração do literal SQL sai errada", () => {
  for (const caso of cases) {
    assert.ok(!caso.name.includes("'"), `o corpus não suporta aspas simples: ${JSON.stringify(caso.name)}`);
  }
});

test("F: a migration usa a forma escapada dos combining marks, não os caracteres literais", () => {
  // Um arquivo de migration com combining chars invisíveis é frágil: uma
  // normalização NFC do arquivo mudaria a regra em silêncio, e o slug de
  // todo mundo mudaria junto.
  assert.ok(sql.includes("[\\u0300-\\u036f]"), "a migration deveria usar o escape \\u0300-\\u036f do Postgres");
  const trechoDaFuncao = sql.slice(sql.indexOf("create or replace function private.agent_slug"), sql.indexOf("comment on function"));
  assert.ok(
    !/[̀-ͯ]/.test(trechoDaFuncao),
    "a função SQL não pode conter combining marks literais",
  );
});

test("F: os passos da função SQL espelham, na ordem, os passos da função JavaScript", () => {
  const funcao = sql.slice(sql.indexOf("create or replace function private.agent_slug"), sql.indexOf("$$;"));
  for (const passo of ["normalize(", "[\\u0300-\\u036f]", "lower(", "[^a-z0-9]+", "btrim(", "agente-"]) {
    assert.ok(funcao.includes(passo), `passo ausente na função SQL: ${passo}`);
  }
  // A ordem importa: acento é removido ANTES da troca de não-alfanumérico.
  assert.ok(
    funcao.indexOf("[\\u0300-\\u036f]") < funcao.indexOf("[^a-z0-9]+"),
    "a remoção de acento precisa vir antes da troca de não-alfanumérico",
  );
});
