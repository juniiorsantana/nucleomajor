// Prova comportamental da migration 20260921100000 (o cliente pede o WhatsApp
// pelo portal) num Postgres embutido (PGlite). Banco em memória.
//
// Mesmo método das outras provas do checkout: harness + TODAS as migrations
// reais, em ordem.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-pedido-de-conexao.mjs . && node prova-pedido-de-conexao.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-pedido-de-conexao.mjs <repo>");
const MIGRATION = "20260921100000_pedido_de_conexao_do_whatsapp.sql";
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
async function erroDe(fn) {
  try { await fn(); return ""; } catch (e) { return String(e.message || e); }
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO_FULL = "aaaaaaaa-0000-4000-8000-000000000002";
const DONO_BASE = "bbbbbbbb-0000-4000-8000-000000000003";
const ATENDENTE = "bbbbbbbb-0000-4000-8000-000000000004";
const ROBO = "dddddddd-0000-4000-8000-000000000005";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO_FULL}', 'major@exemplo.invalido', now()),
    ('${DONO_BASE}', 'Base@Exemplo.invalido', now()),
    ('${ATENDENTE}', 'atendente@exemplo.invalido', now()),
    ('${ROBO}', 'robot@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

const codigoFull = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access('major@exemplo.invalido','full',7)")).rows[0].access_code;
const orgFull = (await como(usuario(DONO_FULL), "select public.create_organization('Major', $1) as id", [codigoFull])).rows[0].id;

const TOKEN = "f".repeat(64);
await db.query("insert into public.billing_intakes (provider, token_hash) values ('asaas', $1)", [sha(TOKEN)]);
await db.query("insert into public.billing_payment_links (provider, external_link_id, plan_code) values ('asaas', 'LINK', 'base')");
const venda = (await como(null, "select public.nucleo_billing_asaas_receive($1, $2::jsonb, 'base@exemplo.invalido') r", [TOKEN, JSON.stringify({
  id: "evt_1", event: "PAYMENT_RECEIVED",
  payment: { id: "pay_1", customer: "cus_1", subscription: "sub_1", paymentLink: "LINK", dueDate: "2026-09-20" },
})])).rows[0].r;
const orgBase = (await como(usuario(DONO_BASE), "select public.create_organization('Clínica Base', $1) as id", [venda.access_code])).rows[0].id;
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [orgBase, ATENDENTE]);

// A Major já tem a conexão dela, criada à mão.
const CONEXAO_MAJOR = "eeeeeeee-0000-4000-8000-000000000006";
await db.query(
  "insert into public.whatsapp_connections (id, organization_id, name, expected_phone_hash, expected_phone_last4) values ($1, $2, 'WhatsApp Major', $3, '8362')",
  [CONEXAO_MAJOR, orgFull, sha(`${CONEXAO_MAJOR}:5565999998362`)],
);

// ------------------------------------------------ antes: o defeito do min(uuid)
const antes = await erroDe(() => db.query("select private.conexao_da_organizacao($1)", [orgFull]));
confere("antes: conexao_da_organizacao quebra com min(uuid)", /min\(uuid\)/.test(antes), antes);

// ---------------------------------------------------------------- a migration
const migration = ler(`supabase/migrations/${MIGRATION}`);
await db.exec(migration);
confere("migration aplica", true);
const reaplicar = await erroDe(() => db.exec(migration));
await db.exec("rollback");
confere("reaplicar é recusado pela guarda", /ja foi aplicada/.test(reaplicar), reaplicar);

confere("depois: conexao_da_organizacao devolve a conexão", (await um("select private.conexao_da_organizacao($1) id", [orgFull])).id === CONEXAO_MAJOR);

// ---------------------------------------------------------------- o pedido
const pedir = (quem, org, telefone, nome = "") =>
  como(usuario(quem), "select public.nucleo_connection_request($1, $2, $3) r", [org, nome, telefone]).then((r) => r.rows[0].r);

confere("atendente não pede conexão", /organization management required/.test(await erroDe(() => pedir(ATENDENTE, orgBase, "65992178164"))));
confere("dono de outra empresa não pede pela minha", /organization management required/.test(await erroDe(() => pedir(DONO_FULL, orgBase, "65992178164"))));
confere("anon não pede", /permission denied/.test(await erroDe(() => como(null, "select public.nucleo_connection_request($1, '', '65992178164')", [orgBase]))));
const robo = { sub: ROBO, role: "authenticated", app_metadata: { is_robot: "true", organization_id: orgBase, connection_id: CONEXAO_MAJOR } };
confere("robô não pede", /robot credentials/.test(await erroDe(() => como(robo, "select public.nucleo_connection_request($1, '', '65992178164')", [orgBase]))));
confere("telefone inválido recusado", /invalid phone/.test(await erroDe(() => pedir(DONO_BASE, orgBase, "123"))));

const primeiro = await pedir(DONO_BASE, orgBase, "(65) 99217-8164");
confere("dono pede e a conexão nasce", primeiro.created === true && primeiro.status === "created", JSON.stringify(primeiro));
const linha = await um("select * from public.whatsapp_connections where id=$1", [primeiro.connectionId]);
confere("nasce na empresa certa, com nome padrão", linha.organization_id === orgBase && linha.name === "WhatsApp principal");
confere("número guardado como hash salgado pela conexão + final", linha.expected_phone_hash === sha(`${primeiro.connectionId}:5565992178164`) && linha.expected_phone_last4 === "8164");
confere("sem runtime ainda", (await um("select count(*)::int n from public.connection_runtime_status where connection_id=$1", [primeiro.connectionId])).n === 0);

const denovo = await pedir(DONO_BASE, orgBase, "+55 65 99217-8164");
confere("pedir o mesmo número de novo devolve o mesmo pedido", denovo.created === false && denovo.connectionId === primeiro.connectionId);
confere("o plano base cabe uma conexão", /connection limit reached/.test(await erroDe(() => pedir(DONO_BASE, orgBase, "65999990000"))));
confere("a Major (full, 1 conexão) também respeita o limite", /connection limit reached/.test(await erroDe(() => pedir(DONO_FULL, orgFull, "65999990000"))));

// A conexão da organização agora resolve sozinha para a empresa nova.
confere("conexao_da_organizacao acha a conexão nova", (await um("select private.conexao_da_organizacao($1) id", [orgBase])).id === primeiro.connectionId);

// Empresa bloqueada não pede.
await db.query("update public.organization_subscriptions set status='suspended' where organization_id=$1", [orgBase]);
await db.query("update public.whatsapp_connections set status='revoked', revoked_at=now() where id=$1", [primeiro.connectionId]);
confere("empresa bloqueada não pede", /subscription is not active/.test(await erroDe(() => pedir(DONO_BASE, orgBase, "65992178164"))));
await db.query("update public.organization_subscriptions set status='active' where organization_id=$1", [orgBase]);
const refeito = await pedir(DONO_BASE, orgBase, "65992178164", "Recepção");
confere("revogada a anterior, pede de novo com outro nome", refeito.created === true && refeito.connectionId !== primeiro.connectionId);

// ---------------------------------------------------------------- a lista
confere("não-admin não vê os pedidos", /platform administrator/.test(await erroDe(() => como(usuario(DONO_BASE), "select * from public.platform_connection_requests_list()"))));
let lista = (await como(usuario(ADMIN), "select * from public.platform_connection_requests_list()")).rows;
confere("admin vê os pedidos vivos", lista.length === 2, JSON.stringify(lista.map((l) => l.connection_name)));
const pedido = lista.find((l) => l.connection_id === refeito.connectionId);
confere("pedido traz empresa, dono, final e plano", pedido?.organization_name === "Clínica Base" && pedido?.owner_email === "base@exemplo.invalido"
  && pedido?.expected_phone_last4 === "8164" && pedido?.plan_code === "base" && pedido?.heartbeat_at === null, JSON.stringify(pedido));

await db.query(
  `insert into public.connection_runtime_status
     (connection_id, organization_id, instance_id, bridge_status, whatsapp_status, assistant_status, mcp_status, agenda_status)
   values ($1, $2, gen_random_uuid(), 'online', 'connected', 'online', 'configured', 'available')`,
  [CONEXAO_MAJOR, orgFull],
);
lista = (await como(usuario(ADMIN), "select * from public.platform_connection_requests_list()")).rows;
confere("pedidos sem runtime vêm primeiro", lista[0].connection_id === refeito.connectionId && lista[1].heartbeat_at !== null);

console.log(`\nPASS ${passou.length}`);
for (const p of passou) console.log("  ok  ", p);
if (falhas.length) {
  console.log(`\nFAIL ${falhas.length}`);
  for (const f of falhas) console.log("  FAIL", f);
  process.exit(1);
}
