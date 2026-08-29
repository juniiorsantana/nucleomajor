import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const MIGRATION = new URL("../supabase/migrations/20260828200000_conhecimento_publicacao_atomica.sql", import.meta.url);

test("a migration protege rascunhos nos dois caminhos contextuais", async () => {
  const arquivo = (await readFile(MIGRATION, "utf8")).toLowerCase();
  const sql = arquivo.replace(/--[^\n]*/g, "");
  const busca = sql.slice(
    sql.indexOf("create or replace function public.nucleo_contextual_knowledge_search"),
    sql.indexOf("create or replace function public.nucleo_contextual_knowledge_document"),
  );
  const leitura = sql.slice(sql.indexOf("create or replace function public.nucleo_contextual_knowledge_document"));

  assert.equal(busca.split("document.published_at is not null").length - 1, 2);
  assert.equal(leitura.split("document.published_at is not null").length - 1, 1);
  assert.match(busca, /context_row\.audience = 'internal'/);
  assert.match(busca, /context_row\.audience = 'customer'/);
});

test("o salvamento transacional valida permissão, publicação e coleções", async () => {
  const arquivo = (await readFile(MIGRATION, "utf8")).toLowerCase();
  const sql = arquivo.replace(/--[^\n]*/g, "");
  const salvar = sql.slice(
    sql.indexOf("create or replace function public.nucleo_knowledge_save"),
    sql.indexOf("create or replace function public.nucleo_contextual_knowledge_search"),
  );

  assert.match(salvar, /private\.is_org_member\(target_organization\)/);
  assert.match(salvar, /private\.can_manage_org\(target_organization\)/);
  assert.match(salvar, /published external knowledge requires an external collection/);
  assert.match(salvar, /delete from public\.knowledge_document_collections/);
  assert.match(salvar, /insert into public\.knowledge_document_collections/);
  assert.match(sql, /revoke insert, update, delete on public\.knowledge_document_collections from authenticated/);
  assert.equal(sql.split("begin;").length - 1, 1);
  assert.equal(sql.split("commit;").length - 1, 1);
});
