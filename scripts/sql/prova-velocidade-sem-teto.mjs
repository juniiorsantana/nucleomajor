// Prova da migration 20261009100000 (a velocidade sem o teto de 241 minutos)
// num Postgres embutido (PGlite), com o harness e todas as migrations reais.
//
//   cd /tmp/prova && node prova-velocidade-sem-teto.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-velocidade-sem-teto.mjs <repo>");
const MIGRATION = "20261009100000_velocidade_sem_teto.sql";
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");

const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") => (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);

const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
await db.exec(ler("scripts/sql/harness-supabase-minimo.sql"));
await db.exec(`
  alter table auth.users add column if not exists email_confirmed_at timestamptz;
  alter table auth.users add column if not exists last_sign_in_at timestamptz;
`);
const migrations = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
for (const f of migrations) {
  if (f >= MIGRATION) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}

async function como(sub, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [sub, JSON.stringify({ sub, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return tx.query(sql, params);
  });
}
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO = "bbbbbbbb-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now()), ('${DONO}', 'dono@exemplo.invalido', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access('dono@exemplo.invalido', 'full', 7)")).rows[0].access_code;
const ORG = (await como(DONO, "select public.create_organization('Teste', $1) as id", [codigo])).rows[0].id;
const CONEXAO = "cccccccc-0000-4000-8000-000000000001";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'teste')", [CONEXAO, ORG]);
let n = 0;
async function msg(telefone, quando, deMim) {
  n += 1;
  await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind, author_id, media_type)
    values ($1, $2, $3, $4, 'oi', $5::timestamptz, $6, '', null, '')`, [CONEXAO, ORG, telefone, `m${n}`, quando, deMim]);
}
const fatos = async (telefone, ate) =>
  (await db.query("select private.fatos_do_vendedor($1, $2, $3, $4::timestamptz) as f", [ORG, CONEXAO, telefone, ate])).rows[0].f;

// Quarta 30/09 10h; resposta na quinta 10h: 12 horas úteis (10h às 20h + 8h às 10h) = 720 min.
await msg("5565900000001", "2026-09-30 10:00-03", false);
await msg("5565900000001", "2026-10-01 10:00-03", true);
// Sem resposta, das 10h às 15h30: 330 min.
await msg("5565900000002", "2026-09-30 10:00-03", false);

let antes = await fatos("5565900000001", "2026-10-01 12:00-03");
confere("antes da correção, a resposta de um dia aparecia como 241", antes.speed.firstResponseBusinessMinutes === 241 && antes.speed.state === "critico",
  JSON.stringify(antes.speed.firstResponseBusinessMinutes));

await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna");

let f = await fatos("5565900000001", "2026-10-01 12:00-03");
confere("depois: o tempo de verdade, 720 minutos úteis, e o estado continua crítico",
  f.speed.firstResponseBusinessMinutes === 720 && f.speed.state === "critico", JSON.stringify(f.speed));
f = await fatos("5565900000002", "2026-09-30 15:30-03");
confere("sem resposta: a espera de verdade (330 min) e crítico", f.speed.waitingBusinessMinutes === 330 && f.speed.state === "critico", JSON.stringify(f.speed));
f = await fatos("5565900000002", "2026-09-30 11:00-03");
confere("sem resposta há 60 min: ainda não avaliado", f.speed.waitingBusinessMinutes === 60 && f.speed.state === "nao_avaliado");
const permissao = (await db.query("select has_function_privilege('authenticated', 'private.fatos_do_vendedor(uuid, uuid, text, timestamptz)', 'execute') as t")).rows[0].t;
confere("cliente continua sem executar a função", permissao === false);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
