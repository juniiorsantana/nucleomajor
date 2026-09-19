// Prova comportamental da migration 20260920110000 (o plano sem IA nunca chega
// ao Claude) num Postgres embutido (PGlite). Banco em memória, nada de produção.
//
// Mesmo método de prova-checkout-asaas.mjs: harness + TODAS as migrations
// reais. A prova central é a de NÃO REGRESSÃO: para uma empresa `full` (a
// Major), as quatro funções respondem EXATAMENTE o mesmo antes e depois — o
// resultado ou o erro, com ids e horários normalizados.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-plano-sem-ia.mjs . && node prova-plano-sem-ia.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-plano-sem-ia.mjs <repo>");
const MIGRATION = "20260920110000_plano_sem_ia_nao_chama_o_claude.sql";
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const sha = (texto) => createHash("sha256").update(texto, "utf8").digest("hex");

const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") => (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);

const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
await db.exec(ler("scripts/sql/harness-supabase-minimo.sql"));
await db.exec("alter table auth.users add column if not exists email_confirmed_at timestamptz;");
const migrations = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
if (!migrations.includes(MIGRATION)) throw new Error(`migration não achada: ${MIGRATION}`);
for (const f of migrations) {
  if (f >= MIGRATION) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}

async function como(claims, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [claims?.sub || "", JSON.stringify(claims || { role: "anon" })],
    );
    await tx.exec(`set local role ${claims ? "authenticated" : "anon"}`);
    return tx.query(sql, params);
  });
}
const usuario = (sub) => ({ sub, role: "authenticated" });
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];

// ---------------------------------------------------------------- o mundo
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO_FULL = "aaaaaaaa-0000-4000-8000-000000000002";
const DONO_BASE = "bbbbbbbb-0000-4000-8000-000000000003";
const ROBO_FULL = "dddddddd-0000-4000-8000-000000000004";
const ROBO_BASE = "dddddddd-0000-4000-8000-000000000005";
const CONEXAO_FULL = "eeeeeeee-0000-4000-8000-000000000006";
const CONEXAO_BASE = "eeeeeeee-0000-4000-8000-000000000007";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO_FULL}', 'major@exemplo.invalido', now()),
    ('${DONO_BASE}', 'base@exemplo.invalido', now()),
    ('${ROBO_FULL}', 'robot+full@invalid.emyleads.local', now()),
    ('${ROBO_BASE}', 'robot+base@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

// Empresa full, pelo caminho manual (é como a Major existe).
const codigoFull = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access('major@exemplo.invalido','full',7)")).rows[0].access_code;
const orgFull = (await como(usuario(DONO_FULL), "select public.create_organization('Major', $1) as id", [codigoFull])).rows[0].id;

// Empresa base, pelo caminho do pagamento.
const TOKEN = "f".repeat(64);
await db.query("insert into public.billing_intakes (provider, token_hash) values ('asaas', $1)", [sha(TOKEN)]);
await db.query("insert into public.billing_payment_links (provider, external_link_id, plan_code) values ('asaas', 'LINK', 'base')");
const venda = (await como(null, "select public.nucleo_billing_asaas_receive($1, $2::jsonb, 'base@exemplo.invalido') r", [TOKEN, JSON.stringify({
  id: "evt_1", event: "PAYMENT_RECEIVED",
  payment: { id: "pay_1", customer: "cus_1", subscription: "sub_1", paymentLink: "LINK", dueDate: "2026-09-20" },
})])).rows[0].r;
const orgBase = (await como(usuario(DONO_BASE), "select public.create_organization('Cliente Base', $1) as id", [venda.access_code])).rows[0].id;
confere("empresa base nasce no plano base", (await um("select plan_code from public.organization_subscriptions where organization_id=$1", [orgBase])).plan_code === "base");

// Uma conexão e um robô para cada empresa.
for (const [org, conexao, robo] of [[orgFull, CONEXAO_FULL, ROBO_FULL], [orgBase, CONEXAO_BASE, ROBO_BASE]]) {
  await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [conexao, org]);
  await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [conexao, org, robo]);
}
const robo = (sub, org, conexao) => ({
  sub, role: "authenticated",
  app_metadata: { is_robot: "true", organization_id: org, connection_id: conexao },
});
const roboFull = robo(ROBO_FULL, orgFull, CONEXAO_FULL);
const roboBase = robo(ROBO_BASE, orgBase, CONEXAO_BASE);

const perfilClienteDe = async (org) => (await um(
  "select id from public.assistant_profiles where organization_id=$1 and audience='customer' and is_default", [org],
)).id;
const perfilFull = await perfilClienteDe(orgFull);
const perfilBase = await perfilClienteDe(orgBase);

// Resultado OU erro, com o que muda a cada execução apagado.
const normaliza = (valor) => JSON.stringify(valor)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g, "<ts>")
  .replace(/[0-9a-f]{64}/g, "<hash>");
async function resultado(claims, sql, params) {
  try {
    const r = await como(claims, sql, params);
    return normaliza({ ok: r.rows[0] });
  } catch (e) {
    return normaliza({ erro: String(e.message) });
  }
}

// As duas fotografias partem do MESMO estado: a primeira liga e desliga o
// rollout, e isso fica gravado em process_config.
const configInicial = (await um("select process_config from public.assistant_profiles where id=$1", [perfilFull])).process_config;
let rodada = 0;
async function fotografia() {
  rodada += 1;
  await db.query("update public.assistant_profiles set process_config=$2::jsonb where id=$1", [perfilFull, JSON.stringify(configInicial)]);
  const conversa = sha(`conversa-${rodada}`);
  return {
    acesso: await resultado(roboFull, "select public.nucleo_customer_assistant_access('5565999990000') r", []),
    v2: await resultado(roboFull, "select public.nucleo_intelligence_context_resolve_v2($1, '5565999990000', 'oi', '{}'::jsonb) r", [conversa]),
    v3: await resultado(roboFull, "select public.nucleo_intelligence_context_resolve_v3($1, '5565999990001', 'quero saber o preço', '{}'::jsonb) r", [sha(`outra-${rodada}`)]),
    rolloutPiloto: await resultado(usuario(DONO_FULL), "select public.customer_assistant_rollout_update($1, 'pilot', '{}'::uuid[]) r", [perfilFull]),
    rolloutAtivo: await resultado(usuario(DONO_FULL), "select public.customer_assistant_rollout_update($1, 'active', '{}'::uuid[]) r", [perfilFull]),
    acessoAtivo: await resultado(roboFull, "select public.nucleo_customer_assistant_access('5565999990000') r", []),
    rolloutOff: await resultado(usuario(DONO_FULL), "select public.customer_assistant_rollout_update($1, 'off', '{}'::uuid[]) r", [perfilFull]),
    semRobo: await resultado(usuario(DONO_FULL), "select public.nucleo_customer_assistant_access('5565999990000') r", []),
  };
}

const antes = await fotografia();

// ---------------------------------------------------------------- a migration
const migration = ler(`supabase/migrations/${MIGRATION}`);
await db.exec(migration);
confere("migration aplica", true);
let reaplicar = "";
try { await db.exec(migration); } catch (e) { reaplicar = String(e.message); }
await db.exec("rollback");
confere("reaplicar é recusado pela guarda", /ja foi aplicada/.test(reaplicar), reaplicar);

// ------------------------------------------- a Major não sente diferença
const depois = await fotografia();
for (const chave of Object.keys(antes)) {
  confere(`full: ${chave} idêntico antes e depois`, antes[chave] === depois[chave], `${antes[chave]} ≠ ${depois[chave]}`);
}
confere("full: o rollout ativo foi realmente ligado na fotografia", /"allowed":true/.test(depois.acessoAtivo), depois.acessoAtivo);

// ------------------------------------------------------------- plano base
const acessoBase = (await como(roboBase, "select public.nucleo_customer_assistant_access('5565999990000') r")).rows[0].r;
confere("base: portão do cliente recusa com plan_without_assistant", acessoBase.allowed === false && acessoBase.reason === "plan_without_assistant");
for (const versao of ["v2", "v3"]) {
  const erro = await resultado(roboBase, `select public.nucleo_intelligence_context_resolve_${versao}($1, '5565999990000', 'oi', '{}'::jsonb) r`, [sha(`base-${versao}`)]);
  confere(`base: resolve_${versao} não entrega contrato`, /plan without assistant/.test(erro), erro);
}
for (const modo of ["pilot", "active"]) {
  const erro = await resultado(usuario(DONO_BASE), `select public.customer_assistant_rollout_update($1, '${modo}', '{}'::uuid[]) r`, [perfilBase]);
  confere(`base: rollout ${modo} recusado`, /plan without assistant/.test(erro), erro);
}
const off = await resultado(usuario(DONO_BASE), "select public.customer_assistant_rollout_update($1, 'off', '{}'::uuid[]) r", [perfilBase]);
confere("base: rollout off continua valendo", !/erro/.test(off), off);

// Mesmo que alguém tenha ligado o rollout por fora, o portão continua fechado.
await db.query("update public.assistant_profiles set process_config = jsonb_set(coalesce(process_config, '{}'::jsonb), '{rollout}', '{\"mode\":\"active\"}'::jsonb) where id=$1", [perfilBase]);
const forcado = (await como(roboBase, "select public.nucleo_customer_assistant_access('5565999990000') r")).rows[0].r;
confere("base: rollout ligado à força ainda não passa", forcado.allowed === false && forcado.reason === "plan_without_assistant");

// ------------------------------------------ full bloqueada também para
await db.query("update public.organization_subscriptions set status='canceled', current_period_ends_at = now() - interval '1 day' where organization_id=$1", [orgFull]);
const bloqueada = (await como(roboFull, "select public.nucleo_customer_assistant_access('5565999990000') r")).rows[0].r;
confere("full bloqueada: portão fecha", bloqueada.allowed === false && bloqueada.reason === "plan_without_assistant");
const v3Bloqueada = await resultado(roboFull, "select public.nucleo_intelligence_context_resolve_v3($1, '5565999990000', 'oi', '{}'::jsonb) r", [sha("bloqueada")]);
confere("full bloqueada: resolve_v3 recusa", /plan without assistant/.test(v3Bloqueada), v3Bloqueada);
await db.query("update public.organization_subscriptions set status='active', current_period_ends_at = null where organization_id=$1", [orgFull]);
const reaberta = (await como(roboFull, "select public.nucleo_customer_assistant_access('5565999990000') r")).rows[0].r;
confere("full regularizada: portão reabre", reaberta.reason !== "plan_without_assistant");

// ---------------------------------------------------------- privilégios
for (const assinatura of [
  "private.nucleo_customer_assistant_access('5565999990000')",
  "private.nucleo_intelligence_context_resolve_v3('x', '', '', '{}'::jsonb)",
]) {
  const erro = await resultado(roboFull, `select ${assinatura} r`, []);
  confere(`robô não chama ${assinatura.split("(")[0]} direto`, /permission denied/.test(erro), erro);
}
const anon = await resultado(null, "select public.nucleo_customer_assistant_access('5565999990000') r", []);
confere("anon não chama o portão", /permission denied/.test(anon), anon);

// ------------------------------------------------ o "Desfazer" do roteiro
const roteiro = ler("docs/checkout/ROTEIRO-LEVA-2-PLANO-SEM-IA.md");
const desfazer = roteiro.slice(roteiro.indexOf("## Desfazer"));
const inicioSql = desfazer.indexOf("```sql") + "```sql".length;
const sqlDesfazer = desfazer.slice(inicioSql, desfazer.indexOf("```", inicioSql));
await db.exec(sqlDesfazer);
const semTrava = (await um("select prosrc from pg_proc where oid = to_regprocedure('public.nucleo_customer_assistant_access(text)')")).prosrc;
confere("desfazer devolve a função viva ao public", !semTrava.includes("org_has_feature") && semTrava.includes("contact_opted_out"));
const baseSemTrava = (await como(roboBase, "select public.nucleo_customer_assistant_access('5565999990000') r")).rows[0].r;
confere("desfazer: o portão volta a responder pelo rollout", baseSemTrava.reason !== "plan_without_assistant", JSON.stringify(baseSemTrava));
const fullDepoisDeDesfazer = await resultado(roboFull, "select public.nucleo_intelligence_context_resolve_v3($1, '5565999990001', 'quero saber o preço', '{}'::jsonb) r", [sha("desfeito")]);
confere("desfazer: resolve_v3 volta a responder igual", fullDepoisDeDesfazer === antes.v3, fullDepoisDeDesfazer);

console.log(`\nPASS ${passou.length}`);
for (const p of passou) console.log("  ok  ", p);
if (falhas.length) {
  console.log(`\nFAIL ${falhas.length}`);
  for (const f of falhas) console.log("  FAIL", f);
  process.exit(1);
}
