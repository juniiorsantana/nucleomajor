// A conferência editor = banco num Postgres embutido (PGlite), sem a VPS.
//
// Mesmos casos de `casos-conferencia-do-editor.mjs`; o banco aqui é o
// harness + TODAS as migrations reais, em ordem, então `private.flow_validate`
// é exatamente a de produção (com perguntar, coletar e gatilho, 20260926120000).
// Falha (código 1) se algum caso tiver veredito diferente entre editor, banco e
// o esperado pelo nome do caso ("valido:" aceita, "recusa:" recusa).
//
// Caso com `plano` (Etapa 10, 20261018100000) passa por
// `private.flow_validate(spec, organizacao)` numa empresa daquele plano: o
// fluxo é conferido também contra as funções liberadas.
//
//   node scripts/sql/casos-conferencia-do-editor.mjs > casos.jsonl
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/conferencia-do-editor-pglite.mjs . && node conferencia-do-editor-pglite.mjs <repo> casos.jsonl
//
// Resultado em 23/09/2026: 91 casos, 0 divergências.
// Resultado em 18/10/2026: 117 casos (10 deles por plano), 0 divergências.
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
  -- O padrão do Supabase que a 20261017100000 confere: toda função nova de
  -- public nasce executável por anon, authenticated e service_role.
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
`);
for (const f of readdirSync(`${REPO}/supabase/migrations`).filter((nome) => nome.endsWith(".sql")).sort()) {
  await db.exec(ler(`supabase/migrations/${f}`));
}

// Uma empresa por plano, criadas como o painel cria.
async function como(sub, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [sub, JSON.stringify({ sub, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return tx.query(sql, params);
  });
}
const ADMIN = "aaaaaaaa-0000-4000-8000-0000000000a1";
await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;`);
async function empresa(numero, plano) {
  const dono = `bbbbbbbb-0000-4000-8000-0000000000b${numero}`;
  const email = `plano${numero}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [dono, email]);
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, $2, 7)", [email, plano])).rows[0].access_code;
  return (await como(dono, "select public.create_organization($1, $2) as id", [`Plano ${numero}`, codigo])).rows[0].id;
}
const EMPRESAS = {
  so_chatbot: await empresa(1, "base"),
  com_ia: await empresa(2, "full"),
  sem_nada: await empresa(3, "base"),
};
await como(ADMIN, "select public.platform_entitlement_set($1, 'chatbots', false, null, null, 'conferencia', false)", [EMPRESAS.sem_nada]);

const divergencias = [];
const linhas = readFileSync(CASOS, "utf8").split(/\r?\n/).filter(Boolean);
for (const linha of linhas) {
  const { caso, plano, editorAceita, problema, definicao } = JSON.parse(linha);
  let bancoAceita = true;
  let erro = "";
  try {
    if (plano) {
      if (!EMPRESAS[plano]) throw new Error(`plano desconhecido na conferência: ${plano}`);
      await db.query("select private.flow_validate($1::jsonb, $2)", [JSON.stringify(definicao), EMPRESAS[plano]]);
    } else {
      await db.query("select private.flow_validate($1::jsonb)", [JSON.stringify(definicao)]);
    }
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
