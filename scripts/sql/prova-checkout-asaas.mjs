// Prova comportamental da migration 20260920100000 (o pagamento libera a
// empresa) num Postgres embutido (PGlite). Nada aqui toca produção: banco em
// memória, criado e destruído neste processo.
//
// Diferente das provas anteriores, esta NÃO monta tabelas à mão: aplica o
// harness e TODAS as migrations reais do repositório, em ordem. Assim a
// criação da empresa passa pelos gatilhos de verdade (agenda, categorias,
// agentes) e a prova não passa contra uma cópia que divergiu.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-checkout-asaas.mjs . && node prova-checkout-asaas.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-checkout-asaas.mjs <repo>");
const MIGRATION = "20260920100000_o_pagamento_libera_a_empresa.sql";
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const sha = (texto) => createHash("sha256").update(texto, "utf8").digest("hex");

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
// O harness tem só três colunas em auth.users; a confirmação de e-mail é
// exatamente o que esta migration passa a exigir.
await db.exec("alter table auth.users add column if not exists email_confirmed_at timestamptz;");

const migrations = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
if (!migrations.includes(MIGRATION)) throw new Error(`migration não achada: ${MIGRATION}`);
for (const f of migrations) {
  if (f >= MIGRATION) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}

// Executa como um papel/usuário, numa transação: auth.uid() lê o GUC.
async function como(sub, sql, params = [], role = null) {
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
const DONO_ANTIGO = "aaaaaaaa-0000-4000-8000-000000000002";
const CLIENTE = "bbbbbbbb-0000-4000-8000-000000000003";
const INTRUSO = "bbbbbbbb-0000-4000-8000-000000000004";
const SEM_CONFIRMAR = "bbbbbbbb-0000-4000-8000-000000000005";
const CLIENTE_2 = "bbbbbbbb-0000-4000-8000-000000000006";
const ORG_SEM_ASSINATURA = "cccccccc-0000-4000-8000-000000000007";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO_ANTIGO}', 'dono.antigo@exemplo.invalido', now()),
    ('${CLIENTE}', 'cliente@exemplo.invalido', now()),
    ('${INTRUSO}', 'intruso@exemplo.invalido', now()),
    ('${SEM_CONFIRMAR}', 'sem.confirmar@exemplo.invalido', null),
    ('${CLIENTE_2}', 'cliente2@exemplo.invalido', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

// ------------------------------------------------ antes: a empresa que já existe
const codigoAntigo = (await como(ADMIN, "select * from public.issue_onboarding_access('dono.antigo@exemplo.invalido','full',7)")).rows[0].access_code;
const orgAntiga = (await como(DONO_ANTIGO, "select public.create_organization('Major Antiga', $1) as id", [codigoAntigo])).rows[0].id;
// Uma empresa sem linha de assinatura (criada fora do fluxo) ganha uma.
await db.exec(`insert into public.organizations (id, name, slug, created_by) values ('${ORG_SEM_ASSINATURA}', 'Sem Assinatura', 'sem-assinatura-1', '${ADMIN}')`);

// ---------------------------------------------------------------- a migration
const migration = ler(`supabase/migrations/${MIGRATION}`);
await db.exec(migration);
confere("migration aplica", true);
confere(
  "reaplicar é recusado pela guarda",
  /ja conhece billing_subscriptions/.test(await erroDe(() => db.exec(migration))),
);
// A guarda derruba o `begin` do arquivo sem chegar ao `commit`: é o que o SQL
// Editor faria. Aqui a sessão é uma só, então a prova desfaz à mão.
await db.exec("rollback");

confere("empresa antiga continua ok", (await um("select private.org_access_state($1) s", [orgAntiga])).s === "ok");
const semAssinatura = await um("select plan_code, status, source from public.organization_subscriptions where organization_id=$1", [ORG_SEM_ASSINATURA]);
confere("empresa sem assinatura ganha full/active/migration", semAssinatura?.plan_code === "full" && semAssinatura?.source === "migration");

const base = await um("select features, limits from public.saas_plans where code='base'");
confere("plano base sem assistant", base.features.assistant === false && base.features.crm === true);
confere("plano base com 1 conexão", base.limits.connections === 1);

// --------------------------------------------------------------- a ligação
const TOKEN = "f".repeat(64);
const LINK = "123517639363";
await db.query("insert into public.billing_intakes (provider, token_hash) values ('asaas', $1)", [sha(TOKEN)]);
await db.query("insert into public.billing_payment_links (provider, external_link_id, plan_code, label) values ('asaas', $1, 'base', 'Base mensal')", [LINK]);

const receber = (evento, email = null, token = TOKEN) =>
  como(null, "select public.nucleo_billing_asaas_receive($1, $2::jsonb, $3) r", [token, JSON.stringify(evento), email], "anon")
    .then((res) => res.rows[0].r);
const pagamento = (id, tipo, { sub = "sub_cliente1", link = LINK, due = "2026-09-20", pay = "pay_1" } = {}) => ({
  id, event: tipo,
  payment: { id: pay, customer: "cus_1", subscription: sub, paymentLink: link, value: 97, billingType: "PIX", status: "RECEIVED", dueDate: due },
});

// ------------------------------------------------------------- recusas
confere("token errado recusa", /intake token is invalid/.test(await erroDe(() => receber(pagamento("evt_x", "PAYMENT_RECEIVED"), "a@b.com", "0".repeat(64)))));
confere("token malformado recusa", /intake token is invalid/.test(await erroDe(() => receber(pagamento("evt_x", "PAYMENT_RECEIVED"), "a@b.com", "abc"))));
confere("evento sem id recusa", /billing event is invalid/.test(await erroDe(() => receber({ event: "PAYMENT_RECEIVED" }))));
confere("nada gravado nas recusas", (await um("select count(*)::int n from public.billing_events")).n === 0);

// ------------------------------------------------- cobrança de outro negócio
let r = await receber(pagamento("evt_outro", "PAYMENT_RECEIVED", { link: "999", sub: "sub_outro" }), "outro@exemplo.invalido");
confere("link não mapeado é ignorado", r.action === "none");
confere("link não mapeado registrado sem e-mail", (await um("select result from public.billing_events where event_id='evt_outro'")).result === "unmapped_link");
confere("link não mapeado não cria assinatura", (await um("select count(*)::int n from public.billing_subscriptions")).n === 0);
r = await receber({ id: "evt_avulso", event: "PAYMENT_RECEIVED", payment: { id: "pay_av", customer: "cus_9", dueDate: "2026-09-20" } });
confere("cobrança avulsa (sem assinatura) ignorada", r.action === "none" && (await um("select result from public.billing_events where event_id='evt_avulso'")).result === "no_subscription");
r = await receber({ id: "evt_sub_criada", event: "SUBSCRIPTION_CREATED", subscription: { id: "sub_cliente1", customer: "cus_1", status: "ACTIVE", paymentLink: LINK } });
confere("assinatura criada sem pagamento não libera nada", r.action === "none" && (await um("select count(*)::int n from public.billing_subscriptions")).n === 0);

// ------------------------------------------------------ o primeiro pagamento
r = await receber(pagamento("evt_conf_1", "PAYMENT_CONFIRMED"), "  Cliente@Exemplo.Invalido ");
confere("pagamento confirmado pede a ativação", r.action === "send_activation", JSON.stringify(r));
confere("código no formato NMxx", /^NM[0-9A-F]{2}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{2}$/.test(r.access_code || ""));
confere("e-mail normalizado", r.email === "cliente@exemplo.invalido");
const CODIGO = r.access_code;
const concessao = await um("select * from public.onboarding_access_grants where id=$1", [r.grant_id]);
confere("concessão de pagamento sem created_by", concessao.created_by === null && concessao.source === "payment" && concessao.plan_code === "base");
confere("concessão guarda a assinatura como referência", concessao.external_reference === "sub_cliente1");
confere("código guardado só como hash", !JSON.stringify(concessao).includes(CODIGO));

r = await receber(pagamento("evt_conf_1", "PAYMENT_CONFIRMED"), "cliente@exemplo.invalido");
confere("evento repetido não faz nada", r.duplicate === true && r.action === "none");
r = await receber(pagamento("evt_rec_1", "PAYMENT_RECEIVED"), "cliente@exemplo.invalido");
confere("compensação do mesmo pagamento não emite outro código", r.action === "none" && r.result === "activation_pending");
confere("uma concessão só", (await um("select count(*)::int n from public.onboarding_access_grants where source='payment'")).n === 1);

await como(null, "select public.nucleo_billing_activation_delivered($1, $2, true)", [TOKEN, concessao.id], "anon");
confere("entrega do e-mail marcada", (await um("select activation_sent_at from public.billing_subscriptions where external_subscription_id='sub_cliente1'")).activation_sent_at !== null);

// ------------------------------------------------------------ a ativação
confere("e-mail não confirmado não ativa", /confirmed email required/.test(await erroDe(() => como(SEM_CONFIRMAR, "select public.create_organization('Empresa X', $1)", [CODIGO]))));
confere("outro e-mail não ativa", /another email/.test(await erroDe(() => como(INTRUSO, "select public.create_organization('Empresa X', $1)", [CODIGO]))));
confere("anon não cria empresa", /permission denied/.test(await erroDe(() => como(null, "select public.create_organization('Empresa X', $1)", [CODIGO], "anon"))));

const orgCliente = (await como(CLIENTE, "select public.create_organization('Clínica do Cliente', $1) as id", [CODIGO.toLowerCase().replace(/-/g, " ")])).rows[0].id;
confere("cliente ativa a empresa (código com qualquer grafia)", Boolean(orgCliente));
const assinatura = await um("select * from public.organization_subscriptions where organization_id=$1", [orgCliente]);
confere("assinatura da empresa é base/payment/active", assinatura.plan_code === "base" && assinatura.source === "payment" && assinatura.status === "active");
confere("assinatura amarrada ao Asaas", assinatura.external_subscription_id === "sub_cliente1" && assinatura.external_customer_id === "cus_1");
confere("cobrança aponta para a empresa", (await um("select organization_id from public.billing_subscriptions where external_subscription_id='sub_cliente1'")).organization_id === orgCliente);
confere("código resgatado", (await um("select status from public.onboarding_access_grants where id=$1", [concessao.id])).status === "redeemed");
confere("código não serve duas vezes", /invalid or expired/.test(await erroDe(() => como(CLIENTE, "select public.create_organization('De novo', $1)", [CODIGO]))));

const contagens = await um(
  `select (select count(*)::int from public.stages where organization_id=$1) etapas,
          (select count(*)::int from public.tags where organization_id=$1) tags,
          (select count(*)::int from public.organization_calendars where organization_id=$1) agendas,
          (select count(*)::int from public.calendar_categories where organization_id=$1) categorias,
          (select count(*)::int from public.assistant_profiles where organization_id=$1) agentes,
          (select count(*)::int from public.assistant_profiles where organization_id=$1 and coalesce(process_config #>> '{rollout,mode}', 'off') <> 'off') ligados`,
  [orgCliente],
);
confere("gatilhos semeiam a empresa", contagens.etapas === 6 && contagens.tags === 4 && contagens.agendas === 1 && contagens.categorias === 6, JSON.stringify(contagens));
confere("dois agentes nascem desligados", contagens.agentes === 2 && contagens.ligados === 0);

let estado = (await como(CLIENTE, "select * from public.organization_access_state($1)", [orgCliente])).rows[0];
confere("estado ok com plano base", estado.state === "ok" && estado.plan_code === "base" && estado.features.assistant === false);
confere("intruso não lê o estado", /organization access required/.test(await erroDe(() => como(INTRUSO, "select * from public.organization_access_state($1)", [orgCliente]))));
confere("feature crm sim, assistant não", (await um("select private.org_has_feature($1,'crm') c, private.org_has_feature($1,'assistant') a", [orgCliente])).c === true
  && (await um("select private.org_has_feature($1,'assistant') a", [orgCliente])).a === false);

// ------------------------------------------------------------ a vida da assinatura
const periodoAntes = (await um("select current_period_ends_at p from public.organization_subscriptions where organization_id=$1", [orgCliente])).p;
r = await receber(pagamento("evt_rec_2", "PAYMENT_RECEIVED", { due: "2026-10-20", pay: "pay_2" }));
confere("mensalidade seguinte renova", r.result === "renewed");
const periodoDepois = (await um("select current_period_ends_at p from public.organization_subscriptions where organization_id=$1", [orgCliente])).p;
confere("período avança", new Date(periodoDepois) > new Date(periodoAntes));

r = await receber(pagamento("evt_venc_velho", "PAYMENT_OVERDUE", { due: "2026-10-20", pay: "pay_2" }));
confere("atraso fora de ordem não derruba quem pagou", r.result === "overdue_ignored");
confere("continua ok", (await um("select private.org_access_state($1) s", [orgCliente])).s === "ok");

r = await receber(pagamento("evt_venc_3", "PAYMENT_OVERDUE", { due: "2026-11-20", pay: "pay_3" }));
confere("atraso marca past_due", r.result === "past_due");
estado = (await como(CLIENTE, "select * from public.organization_access_state($1)", [orgCliente])).rows[0];
confere("estado past_due com data de bloqueio", estado.state === "past_due" && estado.blocks_at !== null);
await db.query("update public.organization_subscriptions set past_due_since = now() - interval '8 days' where organization_id=$1", [orgCliente]);
confere("8 dias de atraso bloqueia", (await um("select private.org_access_state($1) s", [orgCliente])).s === "blocked");
confere("bloqueada não tem feature nenhuma", (await um("select private.org_has_feature($1,'crm') c", [orgCliente])).c === false);

r = await receber(pagamento("evt_rec_3", "PAYMENT_RECEIVED", { due: "2026-11-20", pay: "pay_3" }));
confere("pagar o atraso desbloqueia", r.result === "renewed" && (await um("select private.org_access_state($1) s", [orgCliente])).s === "ok");
confere("relógio do atraso zerado", (await um("select past_due_since from public.organization_subscriptions where organization_id=$1", [orgCliente])).past_due_since === null);

r = await receber({ id: "evt_cancel", event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_cliente1", customer: "cus_1", deleted: true } });
confere("cancelamento registrado", r.result === "canceled");
confere("cancelada vale até o fim do período pago", (await um("select private.org_access_state($1) s", [orgCliente])).s === "ok");
await db.query("update public.organization_subscriptions set current_period_ends_at = now() - interval '1 day' where organization_id=$1", [orgCliente]);
confere("depois do período, bloqueia", (await um("select private.org_access_state($1) s", [orgCliente])).s === "blocked");

// ---------------------------------------------- estorno antes de ativar
r = await receber(pagamento("evt_c2_pago", "PAYMENT_RECEIVED", { sub: "sub_cliente2", pay: "pay_c2" }), "cliente2@exemplo.invalido");
const codigo2 = r.access_code;
confere("segunda venda emite código", r.action === "send_activation");
r = await receber(pagamento("evt_c2_estorno", "PAYMENT_REFUNDED", { sub: "sub_cliente2", pay: "pay_c2" }));
confere("estorno suspende", r.result === "suspended");
confere("código pendente do estorno é revogado", /invalid or expired/.test(await erroDe(() => como(CLIENTE_2, "select public.create_organization('Empresa Y', $1)", [codigo2]))));

// ---------------------------------------------- venda sem e-mail e reenvio
r = await receber(pagamento("evt_c3", "PAYMENT_RECEIVED", { sub: "sub_cliente3", pay: "pay_c3" }), "sem-arroba");
confere("venda sem e-mail válido fica registrada sem código", r.action === "none" && r.result === "missing_email");
const sub3 = (await um("select id from public.billing_subscriptions where external_subscription_id='sub_cliente3'")).id;
confere("não-admin não reenvia", /platform administrator/.test(await erroDe(() => como(CLIENTE, "select * from public.billing_activation_rotate($1, 'x@y.com')", [sub3]))));
confere("admin recusa e-mail inválido", /invalid email/.test(await erroDe(() => como(ADMIN, "select * from public.billing_activation_rotate($1, 'nada')", [sub3]))));
const rot1 = (await como(ADMIN, "select * from public.billing_activation_rotate($1, 'Terceiro@Exemplo.Invalido')", [sub3])).rows[0];
confere("admin emite com o e-mail informado", rot1.email === "terceiro@exemplo.invalido" && /^NM/.test(rot1.access_code));
const rot2 = (await como(ADMIN, "select * from public.billing_activation_rotate($1)", [sub3])).rows[0];
confere("reenviar troca o código", rot2.access_code !== rot1.access_code);
confere("código anterior revogado", (await um("select status from public.onboarding_access_grants where id=$1", [rot1.grant_id])).status === "revoked");
confere("admin não reenvia empresa já ativada", /already activated/.test(await erroDe(async () => {
  const s1 = (await um("select id from public.billing_subscriptions where external_subscription_id='sub_cliente1'")).id;
  await db.query("update public.billing_subscriptions set status='active' where id=$1", [s1]);
  await como(ADMIN, "select * from public.billing_activation_rotate($1)", [s1]);
})));

const lista = (await como(ADMIN, "select * from public.billing_subscriptions_admin_list()")).rows;
confere("admin lista as vendas", lista.length === 3 && lista.some((l) => l.organization_name === "Clínica do Cliente"));
confere("não-admin não lista", /platform administrator/.test(await erroDe(() => como(CLIENTE, "select * from public.billing_subscriptions_admin_list()"))));

// ---------------------------------------------- o caminho manual continua
const codigoManual = (await como(ADMIN, "select * from public.issue_onboarding_access('intruso@exemplo.invalido','full',7)")).rows[0].access_code;
const orgManual = (await como(INTRUSO, "select public.create_organization('Manual', $1) as id", [codigoManual])).rows[0].id;
const manual = await um("select plan_code, status, source from public.organization_subscriptions where organization_id=$1", [orgManual]);
confere("código manual continua criando full/active/manual", manual.plan_code === "full" && manual.status === "active" && manual.source === "manual");

// ---------------------------------------------------------- privilégios
for (const tabela of ["billing_intakes", "billing_payment_links", "billing_subscriptions", "billing_events"]) {
  confere(`anon não lê ${tabela}`, /permission denied/.test(await erroDe(() => como(null, `select * from public.${tabela}`, [], "anon"))));
  confere(`authenticated não lê ${tabela}`, /permission denied/.test(await erroDe(() => como(CLIENTE, `select * from public.${tabela}`, [], "authenticated"))));
}
confere("authenticated não chama o webhook", /permission denied/.test(await erroDe(() => como(CLIENTE, "select public.nucleo_billing_asaas_receive($1, '{}'::jsonb)", [TOKEN], "authenticated"))));

console.log(`\nPASS ${passou.length}`);
for (const p of passou) console.log("  ok  ", p);
if (falhas.length) {
  console.log(`\nFAIL ${falhas.length}`);
  for (const f of falhas) console.log("  FAIL", f);
  process.exit(1);
}
