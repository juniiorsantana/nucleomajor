// Prova comportamental da migration 20260924110000 (painel da plataforma) num
// Postgres embutido (PGlite), com o harness e TODAS as migrations reais do
// repositório, em ordem. Nada aqui toca produção.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-painel-da-plataforma.mjs . && node prova-painel-da-plataforma.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-painel-da-plataforma.mjs <repo>");
const MIGRATION = "20260924110000_painel_da_plataforma.sql";
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
// O harness é mínimo: o Supabase real tem as duas colunas.
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
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO_MAJOR = "aaaaaaaa-0000-4000-8000-000000000002";
const DONO_A = "bbbbbbbb-0000-4000-8000-000000000003";
const DONO_B = "bbbbbbbb-0000-4000-8000-000000000004";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO_MAJOR}', 'major@exemplo.invalido', now()),
    ('${DONO_A}', 'Cliente.A@exemplo.invalido', now()),
    ('${DONO_B}', 'cliente.b@exemplo.invalido', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

async function empresa(dono, email, plano, nome) {
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, $2, 7)", [email.toLowerCase(), plano])).rows[0].access_code;
  return (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
}
const MAJOR = await empresa(DONO_MAJOR, "major@exemplo.invalido", "full", "Major");
const ORG_A = await empresa(DONO_A, "cliente.a@exemplo.invalido", "base", "Cliente A");
const ORG_B = await empresa(DONO_B, "cliente.b@exemplo.invalido", "base", "Cliente B");

// ---------------------------------------------------------------- a migration
const migration = ler(`supabase/migrations/${MIGRATION}`);
await db.exec(migration);
confere("migration aplica", true);
confere("reaplicar é recusado pela guarda", /ja foi aplicada/.test(await erroDe(() => db.exec(migration))));
await db.exec("rollback");

// Uso de A: contatos (um apagado), um negócio, WhatsApp com conversa e mensagens.
await db.query("insert into public.contacts (organization_id, name) values ($1, 'Um'), ($1, 'Dois'), ($1, 'Três')", [ORG_A]);
await db.query("update public.contacts set deleted_at = now() where organization_id = $1 and name = 'Três'", [ORG_A]);
const conexaoA = (await como(DONO_A, "select public.nucleo_connection_request($1, 'WhatsApp', '65999990001') v", [ORG_A])).rows[0].v.connectionId;
await db.query(
  `insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, last_message_at)
   values ($1, $2, '5565988887777', now() - interval '2 days'), ($1, $2, '5565988886666', now() - interval '40 days')`,
  [conexaoA, ORG_A],
);
await db.query(
  `insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, sent_at)
   values ($1, $2, '5565988887777', 'm1', now() - interval '2 days'),
          ($1, $2, '5565988887777', 'm2', now() - interval '1 day'),
          ($1, $2, '5565988886666', 'm3', now() - interval '40 days')`,
  [conexaoA, ORG_A],
);
await db.query("update auth.users set last_sign_in_at = '2026-09-20 10:00:00-03' where id = $1", [DONO_A]);

// ------------------------------------------------------------------ quem entra
const chamadas = [
  ["select * from public.platform_organizations_list()", []],
  ["select public.platform_organization_detail($1)", [ORG_A]],
  ["select * from public.platform_audit_list()", []],
  ["select public.platform_organization_set_period($1, now() + interval '30 days', false, 'x')", [ORG_A]],
  ["select public.platform_organization_end_now($1, 'motivo')", [ORG_A]],
  ["select public.platform_organization_set_plan($1, 'completo', 'x')", [ORG_A]],
  ["select * from public.platform_plans_list()", []],
];
for (const [sql, params] of chamadas) {
  const nome = sql.match(/platform_[a-z_]+/)[0];
  confere(`dono de empresa não chama ${nome}`, /platform administrator/.test(await erroDe(() => como(DONO_A, sql, params))));
  confere(`anônimo não chama ${nome}`, /permission denied|platform administrator/.test(await erroDe(() => como(null, sql, params, "anon"))));
}
confere("a leitura privada não é chamada direto",
  /permission denied/.test(await erroDe(() => como(ADMIN, "select * from private.platform_organization_rows(null)"))));
confere("nenhuma recusa mudou a assinatura de A",
  (await um("select status from public.organization_subscriptions where organization_id = $1", [ORG_A])).status === "active");

// ------------------------------------------------------------------------ lista
const lista = (await como(ADMIN, "select * from public.platform_organizations_list()")).rows;
confere("lista tem as 3 empresas, por nome", lista.map((l) => l.organization_name).join(",") === "Cliente A,Cliente B,Major");
const linhaA = lista.find((l) => l.organization_id === ORG_A);
confere("lista: dono em minúsculas", linhaA.owner_email === "cliente.a@exemplo.invalido");
confere("lista: último acesso do dono", linhaA.owner_last_sign_in_at instanceof Date && linhaA.owner_last_sign_in_at.toISOString() === "2026-09-20T13:00:00.000Z");
confere("lista: plano e situação", linhaA.plan_code === "base" && linhaA.plan_name === "Base" && linhaA.state === "ok" && linhaA.subscription_status === "active");
confere("lista: origem manual", linhaA.source === "manual");
confere("lista: 1 membro", linhaA.members === 1);
confere("lista: contatos sem os apagados", linhaA.contacts === 2, `contatos=${linhaA.contacts}`);
confere("lista: WhatsApp 1 de 1", linhaA.connections_in_use === 1 && linhaA.connections_limit === 1);
confere("lista: sem ajustes", linhaA.active_adjustments === 0);
confere("lista: sem sinal da VPS", linhaA.last_heartbeat_at === null);
const linhaB = lista.find((l) => l.organization_id === ORG_B);
confere("lista: B sem WhatsApp e sem acesso registrado", linhaB.connections_in_use === 0 && linhaB.owner_last_sign_in_at === null);
confere("lista: Major no full", lista.find((l) => l.organization_id === MAJOR).plan_code === "full");

// ---------------------------------------------------------------------- detalhe
await como(ADMIN, "select public.platform_entitlement_set($1, 'chatbots', true, null, null, 'piloto')", [ORG_A]);
await como(ADMIN, "select public.platform_entitlement_set($1, 'agenda', false, null, now() + interval '10 days', 'teste')", [ORG_A]);
let detalhe = (await como(ADMIN, "select public.platform_organization_detail($1) v", [ORG_A])).rows[0].v;
confere("detalhe: resumo igual à linha da lista", detalhe.organization.organization_id === ORG_A && detalhe.organization.contacts === 2);
confere("detalhe: resumo conta os ajustes", detalhe.organization.active_adjustments === 2);
confere("detalhe: um item por linha do catálogo", detalhe.features.length === 10 && detalhe.features[0].key === "crm");
const item = (chave) => detalhe.features.find((f) => f.key === chave);
confere("detalhe: chatbots — plano não, ajuste sim, resultado sim",
  item("chatbots").plan === false && item("chatbots").adjustment.enabled === true && item("chatbots").adjustment.active === true && item("chatbots").result === true);
confere("detalhe: agenda — plano sim, ajuste não com prazo, resultado não",
  item("agenda").plan === true && item("agenda").adjustment.enabled === false && item("agenda").adjustment.expiresAt && item("agenda").result === false);
confere("detalhe: crm sem ajuste", item("crm").adjustment === null && item("crm").result === true);
confere("detalhe: IA marcada", item("ai_customer").isAi === true && item("crm").isAi === false);
confere("detalhe: limite de WhatsApp", item("connections").kind === "limit" && item("connections").plan === 1 && item("connections").result === 1);
confere("detalhe: uso", detalhe.usage.contacts === 2 && detalhe.usage.deals === 0 && detalhe.usage.conversations30d === 1 && detalhe.usage.messages30d === 2,
  JSON.stringify(detalhe.usage));
confere("detalhe: pessoas", detalhe.members.length === 1 && detalhe.members[0].role === "owner" && detalhe.members[0].email === "cliente.a@exemplo.invalido");
confere("detalhe: WhatsApp", detalhe.connections.length === 1 && detalhe.connections[0].last4 === "0001" && detalhe.connections[0].status === "created");
confere("detalhe: sem vendas do Asaas", Array.isArray(detalhe.billing) && detalhe.billing.length === 0);
confere("detalhe: histórico dos 2 ajustes, o mais novo primeiro",
  detalhe.audit.length === 2 && detalhe.audit[0].target === "agenda" && detalhe.audit[0].actor_email === "cmo@majorhub.com.br");
confere("detalhe: empresa inexistente é recusada",
  /organization not found/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_detail('00000000-0000-4000-8000-000000000000')"))));

// Ajuste vencido aparece, marcado como inativo, e não vale.
await db.query("update public.organization_entitlements set expires_at = now() - interval '1 minute' where organization_id = $1 and key = 'agenda'", [ORG_A]);
detalhe = (await como(ADMIN, "select public.platform_organization_detail($1) v", [ORG_A])).rows[0].v;
confere("detalhe: ajuste vencido aparece como inativo e o plano volta", item("agenda").adjustment.active === false && item("agenda").result === true);
confere("detalhe: vencido não conta como ajuste ativo", detalhe.organization.active_adjustments === 1);

// --------------------------------------------------------------------- estender
const estado = async (org) => (await um("select private.org_access_state($1) s", [org])).s;
const assinatura = async (org) => um("select * from public.organization_subscriptions where organization_id = $1", [org]);
let r = (await como(ADMIN, "select public.platform_organization_set_period($1, '2030-01-31 23:59:59-03', false, '90 dias de cortesia') v", [ORG_A])).rows[0].v;
let sub = await assinatura(ORG_A);
confere("estender sem renovação: canceled com data", sub.status === "canceled" && sub.current_period_ends_at.toISOString() === "2030-02-01T02:59:59.000Z");
confere("estender sem renovação: segue com acesso", (await estado(ORG_A)) === "ok" && r.subscription.state === "ok");
confere("estender: manual não avisa do Asaas", r.billingInAsaas === false);
r = (await como(ADMIN, "select public.platform_organization_set_period($1, now() + interval '30 days', true) v", [ORG_A])).rows[0].v;
confere("estender com renovação: active", (await assinatura(ORG_A)).status === "active" && r.subscription.status === "active");
confere("data no passado é recusada",
  /must be in the future/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_set_period($1, now() - interval '1 day', false)", [ORG_A]))));
confere("data sem fim é recusada",
  /must be in the future/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_set_period($1, null, false)", [ORG_A]))));
confere("data absurda é recusada",
  /too far/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_set_period($1, now() + interval '20 years', false)", [ORG_A]))));
confere("empresa inexistente é recusada",
  /organization not found/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_set_period('00000000-0000-4000-8000-000000000000', now() + interval '1 day', false)"))));

// Em atraso: estender limpa o relógio do bloqueio.
await db.query("update public.organization_subscriptions set status = 'past_due', past_due_since = now() - interval '6 days' where organization_id = $1", [ORG_B]);
confere("B em atraso", (await estado(ORG_B)) === "past_due");
await como(ADMIN, "select public.platform_organization_set_period($1, now() + interval '30 days', false, 'acerto por fora')", [ORG_B]);
sub = await assinatura(ORG_B);
confere("estender B tira o atraso", sub.past_due_since === null && (await estado(ORG_B)) === "ok");

// ------------------------------------------------------------------ encerrar
confere("encerrar sem nota é recusado",
  /note required/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_end_now($1, '')", [ORG_B]))));
confere("encerrar com nota curta demais é recusado",
  /note required/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_end_now($1, ' a ')", [ORG_B]))));
confere("recusa não encerrou", (await estado(ORG_B)) === "ok");
r = (await como(ADMIN, "select public.platform_organization_end_now($1, 'pediu para sair') v", [ORG_B])).rows[0].v;
confere("encerrar bloqueia na hora", r.subscription.state === "blocked");
confere("encerrada: o dono não vê mais o estado como ok", (await como(DONO_B, "select * from public.organization_access_state($1)", [ORG_B])).rows[0].state === "blocked");
confere("encerrada: perde as funções", !(await um("select private.org_has_feature($1, 'crm') v", [ORG_B])).v);
await como(ADMIN, "select public.platform_organization_set_period($1, now() + interval '7 days', false, 'voltou')", [ORG_B]);
confere("estender reabre a encerrada", (await estado(ORG_B)) === "ok");

// --------------------------------------------------------------- trocar o plano
r = (await como(ADMIN, "select public.platform_organization_set_plan($1, 'completo', 'upgrade') v", [ORG_A])).rows[0].v;
confere("trocar plano grava", (await assinatura(ORG_A)).plan_code === "completo" && r.subscription.plan_code === "completo");
confere("plano novo liga a IA", (await um("select private.org_has_feature($1, 'ai_team') v", [ORG_A])).v === true);
await como(ADMIN, "select public.platform_entitlement_set($1, 'chatbots', false, null, null, 'sem chatbot')", [ORG_A]);
confere("ajuste continua valendo por cima do plano novo", (await um("select private.org_has_feature($1, 'chatbots') v", [ORG_A])).v === false);
const antesDoRepetido = (await um("select count(*)::int n from public.platform_audit_log")).n;
await como(ADMIN, "select public.platform_organization_set_plan($1, 'COMPLETO ')", [ORG_A]);
confere("mesmo plano não grava nada", (await um("select count(*)::int n from public.platform_audit_log")).n === antesDoRepetido);
confere("plano inexistente é recusado",
  /plan unavailable/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_set_plan($1, 'ouro')", [ORG_A]))));
await db.query("update public.saas_plans set active = false where code = 'atendimento'");
confere("plano inativo é recusado",
  /plan unavailable/.test(await erroDe(() => como(ADMIN, "select public.platform_organization_set_plan($1, 'atendimento')", [ORG_A]))));
const planos = (await como(ADMIN, "select * from public.platform_plans_list()")).rows;
confere("planos: todos, os ativos primeiro, com limites", planos.length === 4 && planos.at(-1).code === "atendimento" && planos[0].limits.connections === 1);
await db.query("update public.saas_plans set active = true where code = 'atendimento'");

// ------------------------------------------------------------------- Asaas
await db.query("update public.organization_subscriptions set source = 'payment' where organization_id = $1", [ORG_B]);
r = (await como(ADMIN, "select public.platform_organization_set_period($1, now() + interval '30 days', true) v", [ORG_B])).rows[0].v;
confere("empresa do Asaas: a resposta avisa da cobrança", r.billingInAsaas === true);
await db.query(
  `insert into public.billing_subscriptions (provider, external_subscription_id, email, plan_code, status, organization_id)
   values ('asaas', 'sub_prova', 'cliente.a@exemplo.invalido', 'completo', 'active', $1)`,
  [ORG_A],
);
r = (await como(ADMIN, "select public.platform_organization_set_period($1, now() + interval '30 days', true) v", [ORG_A])).rows[0].v;
confere("venda ativa ligada também avisa", r.billingInAsaas === true);
detalhe = (await como(ADMIN, "select public.platform_organization_detail($1) v", [ORG_A])).rows[0].v;
confere("detalhe: a venda aparece", detalhe.billing.length === 1 && detalhe.billing[0].externalSubscriptionId === "sub_prova");

// -------------------------------------------------------------------- histórico
const todas = (await como(ADMIN, "select * from public.platform_audit_list()")).rows;
const porAcao = (acao) => todas.filter((l) => l.action === acao);
confere("histórico: cada ação gravou", porAcao("subscription.set_period").length === 6 && porAcao("subscription.end_now").length === 1 && porAcao("subscription.set_plan").length === 1,
  todas.map((l) => l.action).join(","));
confere("histórico: o mais novo primeiro", todas[0].id > todas.at(-1).id);
confere("histórico: com nome da empresa e autor", todas.every((l) => l.actor_email === "cmo@majorhub.com.br" && l.organization_name));
const fim = porAcao("subscription.end_now")[0];
confere("histórico: encerrar guarda antes, depois e nota",
  fim.before.state === "ok" && fim.after.state === "blocked" && fim.after.status === "canceled" && fim.note === "pediu para sair");
const troca = porAcao("subscription.set_plan")[0];
confere("histórico: troca de plano guarda de → para", troca.before.plan_code === "base" && troca.after.plan_code === "completo" && troca.target === "completo");
const deB = (await como(ADMIN, "select * from public.platform_audit_list($1)", [ORG_B])).rows;
confere("histórico filtrado por empresa", deB.length > 0 && deB.every((l) => l.organization_id === ORG_B));
confere("histórico com limite", (await como(ADMIN, "select * from public.platform_audit_list(null, 2)")).rows.length === 2);
confere("limite fora da faixa vira 1", (await como(ADMIN, "select * from public.platform_audit_list(null, -5)")).rows.length === 1);
confere("histórico continua sem update", /append-only/.test(await erroDe(() => db.query("update public.platform_audit_log set note = 'x'"))));
confere("histórico continua sem delete", /append-only/.test(await erroDe(() => db.query("delete from public.platform_audit_log"))));

// ------------------------------------------------ Major: nada mudou para ela
const major = (await como(DONO_MAJOR, "select * from public.organization_access_state($1)", [MAJOR])).rows[0];
confere("Major intocada", major.state === "ok" && major.plan_code === "full" && major.features.ai_team === true);

console.log(`PASS ${passou.length}`);
for (const p of passou) console.log("  ok  " + p);
if (falhas.length) {
  console.log(`FAIL ${falhas.length}`);
  for (const f of falhas) console.log("  XX  " + f);
  process.exit(1);
}
