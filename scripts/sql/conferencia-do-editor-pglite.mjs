// A conferência editor = banco num Postgres embutido (PGlite), sem a VPS.
//
// Mesmos casos de `casos-conferencia-do-editor.mjs`; o banco aqui é o
// harness + TODAS as migrations reais, em ordem, então `private.flow_validate`
// é exatamente a de produção (com perguntar, coletar e gatilho, 20260926120000).
// Falha (código 1) se algum caso tiver veredito diferente entre editor, banco e
// o esperado pelo nome do caso ("valido:" aceita, "recusa:" recusa).
//
//   node scripts/sql/casos-conferencia-do-editor.mjs > casos.jsonl
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/conferencia-do-editor-pglite.mjs . && node conferencia-do-editor-pglite.mjs <repo> casos.jsonl
//
// Resultado em 23/09/2026: 91 casos, 0 divergências.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const [REPO, CASOS] = process.argv.slice(2);
if (!REPO || !CASOS) throw new Error("uso: node conferencia-do-editor-pglite.mjs <repo> <casos.jsonl>");
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");

const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
await db.exec(ler("scripts/sql/harness-supabase-minimo.sql"));
await db.exec(`
  alter table auth.users add column if not exists email_confirmed_at timestamptz;
  alter table auth.users add column if not exists last_sign_in_at timestamptz;
`);
for (const f of readdirSync(`${REPO}/supabase/migrations`).filter((nome) => nome.endsWith(".sql")).sort()) {
  await db.exec(ler(`supabase/migrations/${f}`));
}

const divergencias = [];
const linhas = readFileSync(CASOS, "utf8").split(/\r?\n/).filter(Boolean);
for (const linha of linhas) {
  const { caso, editorAceita, problema, definicao } = JSON.parse(linha);
  let bancoAceita = true;
  let erro = "";
  try {
    await db.query("select private.flow_validate($1::jsonb)", [JSON.stringify(definicao)]);
  } catch (e) {
    bancoAceita = false;
    erro = String(e.message || e);
  }
  const esperado = caso.startsWith("valido:");
  const ok = editorAceita === esperado && bancoAceita === esperado;
  if (!ok) divergencias.push(`${caso}: editor ${editorAceita ? "aceita" : `recusa (${problema})`}, banco ${bancoAceita ? "aceita" : `recusa (${erro})`}`);
}

console.log(`${linhas.length} casos, ${divergencias.length} divergências`);
for (const item of divergencias) console.log(`  DIVERGE ${item}`);
process.exit(divergencias.length ? 1 : 0);
