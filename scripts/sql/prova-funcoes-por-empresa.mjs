// Prova comportamental da migration 20260924100000 (funções e limites por
// empresa) num Postgres embutido (PGlite), com o harness e TODAS as migrations
// reais do repositório, em ordem. Nada aqui toca produção.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-funcoes-por-empresa.mjs . && node prova-funcoes-por-empresa.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-funcoes-por-empresa.mjs <repo>");
const MIGRATION = "20260924100000_funcoes_e_limites_por_empresa.sql";
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
await db.exec("alter table auth.users add column if not exists email_confirmed_at timestamptz;");

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
    ('${DONO_A}', 'cliente.a@exemplo.invalido', now()),
    ('${DONO_B}', 'cliente.b@exemplo.invalido', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

async function empresa(dono, email, plano, nome) {
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, $2, 7)", [email, plano])).rows[0].access_code;
  return (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
}
const MAJOR = await empresa(DONO_MAJOR, "major@exemplo.invalido", "full", "Major");
const ORG_A = await empresa(DONO_A, "cliente.a@exemplo.invalido", "base", "Cliente A");
const ORG_B = await empresa(DONO_B, "cliente.b@exemplo.invalido", "base", "Cliente B");

// O que o portal e o servidor leem, antes da migration.
const estadoAntes = async (dono, org) => (await como(dono, "select * from public.organization_access_state($1)", [org])).rows[0];
const majorAntes = await estadoAntes(DONO_MAJOR, MAJOR);
const aAntes = await estadoAntes(DONO_A, ORG_A);

// ---------------------------------------------------------------- a migration
const migration = ler(`supabase/migrations/${MIGRATION}`);
await db.exec(migration);
confere("migration aplica", true);
confere("reaplicar é recusado pela guarda", /ja foi aplicada/.test(await erroDe(() => db.exec(migration))));
await db.exec("rollback");

// ------------------------------------------------------- sem ajuste, tudo igual
const majorDepois = await estadoAntes(DONO_MAJOR, MAJOR);
confere("Major: features idênticas", JSON.stringify(majorDepois.features) === JSON.stringify(majorAntes.features));
confere("Major: limites idênticos", JSON.stringify(majorDepois.limits) === JSON.stringify(majorAntes.limits));
confere("Major: estado ok", majorDepois.state === "ok");
const aDepois = await estadoAntes(DONO_A, ORG_A);
confere("Base: features idênticas", JSON.stringify(aDepois.features) === JSON.stringify(aAntes.features));
confere("Base: sem chatbot", aDepois.features.chatbots === false);
confere("Base: 1 número de WhatsApp", aDepois.limits.connections === 1);

const tem = async (org, chave) => (await um("select private.org_has_feature($1, $2) v", [org, chave])).v;
confere("Major tem ai_customer e ai_team", (await tem(MAJOR, "ai_customer")) && (await tem(MAJOR, "ai_team")));
confere("Base não tem chatbots nem IA", !(await tem(ORG_A, "chatbots")) && !(await tem(ORG_A, "ai_customer")));

// ---------------------------------------------------------------- o catálogo
const catalogo = (await como(ADMIN, "select * from public.platform_features_list()")).rows;
confere("catálogo com 10 itens para o admin", catalogo.length === 10);
confere("catálogo em ordem, crm primeiro, connections por último", catalogo[0].key === "crm" && catalogo.at(-1).key === "connections");
confere("catálogo marca a IA", catalogo.filter((l) => l.is_ai).map((l) => l.key).sort().join(",") === "ai_customer,ai_team,knowledge");
confere("não-admin não lê o catálogo", /platform administrator/.test(await erroDe(() => como(DONO_A, "select * from public.platform_features_list()"))));

// ------------------------------------------------------ ligar chatbot para A
const ajustar = (quem, sql, params) => como(quem, sql, params).then((r) => r.rows[0]);
let r = await ajustar(ADMIN, "select public.platform_entitlement_set($1, 'chatbots', true, null, null, 'piloto') v", [ORG_A]);
confere("ajuste devolve o combinado", r.v.features.chatbots === true && r.v.organizationId === ORG_A);
confere("A passa a ter chatbots", await tem(ORG_A, "chatbots"));
confere("B continua sem chatbots", !(await tem(ORG_B, "chatbots")));
confere("o portal de A vê chatbots", (await estadoAntes(DONO_A, ORG_A)).features.chatbots === true);
confere("o portal de B não vê", (await estadoAntes(DONO_B, ORG_B)).features.chatbots === false);

// -------------------------------------------------- desligar o que o plano dá
await ajustar(ADMIN, "select public.platform_entitlement_set($1, 'agenda', false) v", [ORG_B]);
confere("desligar agenda de B", !(await tem(ORG_B, "agenda")) && (await tem(ORG_A, "agenda")));

// ------------------------------------------------------------- prazo do ajuste
await ajustar(ADMIN, "select public.platform_entitlement_set($1, 'chatbots', true, null, now() + interval '15 days', 'teste 15 dias') v", [ORG_B]);
confere("ajuste com prazo vale", await tem(ORG_B, "chatbots"));
await db.query("update public.organization_entitlements set expires_at = now() - interval '1 minute' where organization_id = $1 and key = 'chatbots'", [ORG_B]);
confere("ajuste vencido volta ao plano", !(await tem(ORG_B, "chatbots")));
confere("prazo no passado é recusado",
  /must be in the future/.test(await erroDe(() => ajustar(ADMIN, "select public.platform_entitlement_set($1, 'chatbots', true, null, now() - interval '1 day') v", [ORG_A]))));

// ------------------------------------------------------------------------ IA
confere("ligar IA sem confirmar é recusado",
  /requires confirm_ai/.test(await erroDe(() => ajustar(ADMIN, "select public.platform_entitlement_set($1, 'ai_customer', true) v", [ORG_A]))));
confere("recusa não gravou nada", !(await tem(ORG_A, "ai_customer")));
r = await ajustar(ADMIN, "select public.platform_entitlement_set($1, 'ai_customer', true, null, null, 'cliente com VPS pronta', true) v", [ORG_A]);
confere("IA ligada com confirmação", await tem(ORG_A, "ai_customer"));
confere("assistant acompanha a IA ligada", r.v.features.assistant === true);
confere("desligar IA não pede confirmação",
  (await ajustar(ADMIN, "select public.platform_entitlement_set($1, 'ai_customer', false) v", [ORG_A])).v.features.assistant === false);

// --------------------------------------------------------------- entradas ruins
const recusa = async (sql, params, padrao, nome) =>
  confere(nome, padrao.test(await erroDe(() => ajustar(ADMIN, sql, params))));
await recusa("select public.platform_entitlement_set($1, 'inexistente', true) v", [ORG_A], /unknown feature/, "chave desconhecida é recusada");
await recusa("select public.platform_entitlement_set($1, 'chatbots', null) v", [ORG_A], /needs enabled/, "função sem enabled é recusada");
await recusa("select public.platform_entitlement_set($1, 'chatbots', true, 3) v", [ORG_A], /needs enabled and no limit_value/, "função com limite é recusada");
await recusa("select public.platform_entitlement_set($1, 'connections', true) v", [ORG_A], /takes limit_value/, "limite com enabled é recusado");
await recusa("select public.platform_entitlement_set('00000000-0000-4000-8000-000000000000', 'chatbots', true) v", [], /organization not found/, "empresa inexistente é recusada");

// ---------------------------------------------------------------- quem ajusta
confere("dono da empresa não ajusta a própria",
  /platform administrator/.test(await erroDe(() => ajustar(DONO_A, "select public.platform_entitlement_set($1, 'chatbots', true) v", [ORG_A]))));
confere("anônimo não ajusta",
  /permission denied|platform administrator/.test(await erroDe(() => como(null, "select public.platform_entitlement_set($1, 'chatbots', true)", [ORG_A], "anon"))));
confere("tabela de ajustes não é lida direto",
  /permission denied/.test(await erroDe(() => como(DONO_A, "select * from public.organization_entitlements"))));
confere("tabela de ajustes não é escrita direto",
  /permission denied/.test(await erroDe(() => como(DONO_A, "insert into public.organization_entitlements (organization_id, key, enabled) values ($1, 'chatbots', true)", [ORG_A]))));
confere("histórico não é lido direto",
  /permission denied/.test(await erroDe(() => como(DONO_A, "select * from public.platform_audit_log"))));

// -------------------------------------------------------- limite de WhatsApp
const pedir = (dono, org, fone) => como(dono, "select public.nucleo_connection_request($1, 'WhatsApp', $2) v", [org, fone]).then((x) => x.rows[0].v);
confere("1º número de A entra", (await pedir(DONO_A, ORG_A, "65999990001")).created === true);
confere("2º número de A barrado pelo plano", /connection limit reached/.test(await erroDe(() => pedir(DONO_A, ORG_A, "65999990002"))));
// Um WhatsApp por empresa é regra do banco (whatsapp_connections_one_live_per_org).
await recusa("select public.platform_entitlement_set($1, 'connections', null, 2) v", [ORG_A], /more than one WhatsApp/, "limite 2 é recusado (um número por empresa)");
await recusa("select public.platform_entitlement_set($1, 'connections', null, null) v", [ORG_A], /more than one WhatsApp/, "limite ilimitado é recusado");
r = await ajustar(ADMIN, "select public.platform_entitlement_set($1, 'connections', null, 0, null, 'sem WhatsApp por enquanto') v", [ORG_B]);
confere("ajuste de limite aparece no combinado", r.v.limits.connections === 0);
confere("com limite 0, B não pede WhatsApp", /connection limit reached/.test(await erroDe(() => pedir(DONO_B, ORG_B, "65999990009"))));
await ajustar(ADMIN, "select public.platform_entitlement_clear($1, 'connections') v", [ORG_B]);
confere("sem o ajuste, B volta a 1 e pede", (await pedir(DONO_B, ORG_B, "65999990009")).created === true);
confere("A segue com 1", (await estadoAntes(DONO_A, ORG_A)).limits.connections === 1);

// ---------------------------------------------------------- função sob medida
await db.query("insert into public.platform_features (key, kind, name, category) values ('relatorios', 'feature', 'Relatórios', 'sob_medida')");
confere("função nova nasce desligada para todos",
  !(await tem(MAJOR, "relatorios")) && !(await tem(ORG_A, "relatorios")) && !(await tem(ORG_B, "relatorios")));
await ajustar(ADMIN, "select public.platform_entitlement_set($1, 'relatorios', true) v", [ORG_B]);
confere("ligada só para quem recebeu", (await tem(ORG_B, "relatorios")) && !(await tem(ORG_A, "relatorios")));

// ---------------------------------------------------------------- voltar ao plano
r = await ajustar(ADMIN, "select public.platform_entitlement_clear($1, 'agenda', 'volta ao plano') v", [ORG_B]);
confere("clear devolve ao plano", r.v.features.agenda === true && (await tem(ORG_B, "agenda")));
const clearsAntes = (await um("select count(*)::int n from public.platform_audit_log where action = 'entitlement.clear'")).n;
confere("clear sem ajuste não falha", Boolean(await ajustar(ADMIN, "select public.platform_entitlement_clear($1, 'agenda') v", [ORG_B])));
confere("clear sem ajuste não gera linha", (await um("select count(*)::int n from public.platform_audit_log where action = 'entitlement.clear'")).n === clearsAntes);

// ------------------------------------------------------------ empresa bloqueada
await db.query("update public.organization_subscriptions set status = 'canceled', current_period_ends_at = now() - interval '1 day' where organization_id = $1", [ORG_B]);
confere("bloqueada perde tudo, mesmo com ajuste", !(await tem(ORG_B, "relatorios")) && !(await tem(ORG_B, "crm")));

// -------------------------------------------------------------------- histórico
const historico = (await db.query("select action, target, actor, actor_email, before, after, note from public.platform_audit_log order by id")).rows;
confere("cada uma das 9 ações que mudaram algo gravou uma linha", historico.length === 9, `linhas=${historico.length}`);
confere("histórico com autor", historico.every((l) => l.actor === ADMIN && l.actor_email === "cmo@majorhub.com.br"));
const primeira = historico[0];
confere("1º ajuste sem 'antes' e com 'depois'", primeira.action === "entitlement.set" && primeira.before === null && primeira.after.enabled === true);
confere("reajuste guarda o antes", historico.some((l) => l.target === "ai_customer" && l.before?.enabled === true && l.after.enabled === false));
confere("clear guarda o antes e não o depois", historico.some((l) => l.action === "entitlement.clear" && l.before?.enabled === false && l.after === null));
confere("histórico não aceita update", /append-only/.test(await erroDe(() => db.query("update public.platform_audit_log set note = 'x'"))));
confere("histórico não aceita delete", /append-only/.test(await erroDe(() => db.query("delete from public.platform_audit_log"))));

// ----------------------------------------------------------- leitura antiga
const antiga = (await como(DONO_A, "select * from public.organization_entitlement($1)", [ORG_A])).rows[0];
confere("organization_entitlement devolve o combinado", antiga.features.chatbots === true && antiga.limits.connections === 1);

console.log(`PASS ${passou.length}`);
for (const p of passou) console.log("  ok  " + p);
if (falhas.length) {
  console.log(`FAIL ${falhas.length}`);
  for (const f of falhas) console.log("  XX  " + f);
  process.exit(1);
}
