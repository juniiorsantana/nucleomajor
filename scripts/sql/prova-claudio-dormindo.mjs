// Prova comportamental da migration 20260927100000 (o Cláudio dormindo no
// painel) num Postgres embutido (PGlite), com o harness e TODAS as migrations
// reais do repositório, em ordem. Nada aqui toca produção.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-claudio-dormindo.mjs . && node prova-claudio-dormindo.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-claudio-dormindo.mjs <repo>");
const MIGRATION = "20260927100000_o_claudio_dormindo_no_painel.sql";
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");

const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") => (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);
const erroDe = async (fn) => {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e.message || e);
  }
};

const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
await db.exec(ler("scripts/sql/harness-supabase-minimo.sql"));
await db.exec(`
  alter table auth.users add column if not exists email_confirmed_at timestamptz;
  alter table auth.users add column if not exists last_sign_in_at timestamptz;
`);

const migrations = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
if (!migrations.includes(MIGRATION)) throw new Error(`migration não achada: ${MIGRATION}`);
for (const f of migrations) {
  if (f >= MIGRATION) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}

async function como(sub, sql, params = [], role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [sub || "", JSON.stringify(sub ? { sub, role: "authenticated" } : { role: "anon" })],
    );
    if (role) await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO = "bbbbbbbb-0000-4000-8000-000000000002";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

// O banco aceita uma conexão viva por empresa: uma empresa por situação.
let sequencia = 0;
async function empresa(nome) {
  sequencia += 1;
  const dono = `bbbbbbbb-0000-4000-8000-00000000000${sequencia}`;
  const email = `dono${sequencia}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [dono, email]);
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, 'full', 7)", [email])).rows[0].access_code;
  return (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
}

// Cinco conexões, uma por situação.
const conexoes = {
  dormindo: "cccccccc-0000-4000-8000-000000000001",
  cota: "cccccccc-0000-4000-8000-000000000002",
  bem: "cccccccc-0000-4000-8000-000000000003",
  calada: "cccccccc-0000-4000-8000-000000000004",
  revogada: "cccccccc-0000-4000-8000-000000000005",
};
const orgDe = {};
for (const [nome, id] of Object.entries(conexoes)) {
  orgDe[id] = await empresa(nome === "dormindo" ? "Major" : `Empresa ${nome}`);
  await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, $3)", [id, orgDe[id], nome]);
}
await db.query(
  "update public.whatsapp_connections set status = 'revoked', revoked_at = now() where id = $1",
  [conexoes.revogada],
);
const runtime = async (id, modelo, codigoErro, sinal = "now()") => db.query(`
  insert into public.connection_runtime_status (
    connection_id, organization_id, instance_id, bridge_status, whatsapp_status, assistant_status,
    mcp_status, agenda_status, model_status, last_model_error_code, heartbeat_at
  ) values ($1, $2, gen_random_uuid(), 'online', 'connected', 'online', 'configured', 'available', $3, $4, ${sinal})`,
[id, orgDe[id], modelo, codigoErro]);
await runtime(conexoes.cota, "quota_exhausted", "model_quota_exhausted");
await runtime(conexoes.dormindo, "unavailable", "model_auth_unavailable", "now() - interval '1 minute'");
await runtime(conexoes.bem, "available", "");
await runtime(conexoes.calada, "unavailable", "model_auth_unavailable", "now() - interval '1 hour'");
await runtime(conexoes.revogada, "unavailable", "model_auth_unavailable");

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com as conferências internas");

const linhas = (await como(ADMIN, "select * from public.platform_model_alerts()")).rows;
const ids = linhas.map((l) => l.connection_id);
confere("admin vê as duas conexões paradas", linhas.length === 2, JSON.stringify(ids));
confere("login vencido vem primeiro", ids[0] === conexoes.dormindo);
confere("cota aparece", ids.includes(conexoes.cota));
confere("conexão com modelo disponível não aparece", !ids.includes(conexoes.bem));
confere("runtime calado há uma hora não aparece", !ids.includes(conexoes.calada));
confere("conexão revogada não aparece", !ids.includes(conexoes.revogada));
confere("traz nome da empresa e da conexão",
  linhas[0]?.organization_name === "Major" && linhas[0]?.connection_name === "dormindo");
confere("traz o código do erro", linhas[0]?.error_code === "model_auth_unavailable");

const naoAdmin = await erroDe(() => como(DONO, "select * from public.platform_model_alerts()"));
confere("dono de empresa não lê", naoAdmin.includes("platform administrator permission required"), naoAdmin);
const anonimo = await erroDe(() => como(null, "select * from public.platform_model_alerts()", [], "anon"));
confere("anônimo não executa", /permission denied/i.test(anonimo), anonimo);

// A resposta boa limpa o alerta: o runtime grava `available`.
await db.query("update public.connection_runtime_status set model_status = 'available', last_model_error_code = '' where connection_id = $1", [conexoes.dormindo]);
const depois = (await como(ADMIN, "select connection_id from public.platform_model_alerts()")).rows.map((l) => l.connection_id);
confere("quando o Cláudio acorda, o alerta some", !depois.includes(conexoes.dormindo) && depois.length === 1);

const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", reaplicar.includes("ja foi aplicada"), reaplicar);

for (const linha of passou) console.log(`PASS ${linha}`);
for (const linha of falhas) console.log(`FAIL ${linha}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
