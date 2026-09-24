// Prova da migration 20260926140000 (o aviso de realtime só quando muda) num
// Postgres embutido (PGlite): harness + TODAS as migrations reais, em ordem.
//
// Pergunta central: a sincronia que regrava a mesma conversa deixa de gerar
// aviso, e toda mudança de verdade continua gerando — inclusive nos outros
// gatilhos que usam a mesma função.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-aviso-de-realtime.mjs . && node prova-aviso-de-realtime.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-aviso-de-realtime.mjs <repo>");
const MIGRATION = "20260926140000_o_aviso_de_realtime_so_quando_muda.sql";
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
if (!migrations.includes(MIGRATION)) throw new Error(`migration não achada: ${MIGRATION}`);
for (const f of migrations) {
  if (f >= MIGRATION) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}

const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const avisos = async () => Number((await um("select count(*) n from public.portal_realtime_events")).n);

// ---------------------------------------------------------------- o mundo
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO = "aaaaaaaa-0000-4000-8000-000000000002";
const CONEXAO = "eeeeeeee-0000-4000-8000-000000000008";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()), ('${DONO}', 'dono@exemplo.invalido', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const como = (sub, sql, params) => db.transaction(async (tx) => {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
    [sub, JSON.stringify({ sub, role: "authenticated" })]);
  await tx.exec("set local role authenticated");
  return tx.query(sql, params);
});
const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, $2, 7)", ["dono@exemplo.invalido", "full"])).rows[0].access_code;
const org = (await como(DONO, "select public.create_organization($1, $2) as id", ["Major", codigo])).rows[0].id;
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [CONEXAO, org]);

// A conversa não tem id próprio: a chave é conexão + telefone, e o aviso leva
// o id da conexão.
const TELEFONE = "5565999990000";
const conversa = CONEXAO;
await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, contact_name, last_message_preview)
  values ($1, $2, $3, 'Cliente', 'oi')`, [CONEXAO, org, TELEFONE]);
const DESTA = `connection_id = '${CONEXAO}' and contact_phone = '${TELEFONE}'`;

// A regravação que a sincronia faz a cada 15 s: os mesmos valores, updated_at novo.
const regravar = () => db.query(`update public.whatsapp_conversations
  set contact_name = 'Cliente', last_message_preview = 'oi', updated_at = now() where ${DESTA}`);

// ---------------------------------------------------- antes da migration
let antes = await avisos();
await regravar();
confere("antes: regravar sem mudança gerava aviso (o defeito)", (await avisos()) === antes + 1);

// Um aviso de 3 dias: a faxina antiga (7 dias) o guardava.
await db.query("insert into public.portal_realtime_events (organization_id, topic, entity_id, created_at) values ($1, 'conversas', $2, now() - interval '3 days')", [org, conversa]);
confere("antes: há avisos acumulados", (await avisos()) > 0);

// ------------------------------------------------------ aplica a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));

confere("a migration esvazia a tabela de avisos", (await avisos()) === 0);

await regravar();
await regravar();
await regravar();
confere("regravar sem mudança não gera aviso", (await avisos()) === 0);

await db.query(`update public.whatsapp_conversations set last_message_preview = 'mensagem nova', updated_at = now() where ${DESTA}`);
const novo = await um("select topic, organization_id, entity_id from public.portal_realtime_events order by id desc limit 1");
confere("mensagem nova gera um aviso", (await avisos()) === 1);
confere("o aviso é de conversas, da empresa e da conversa certas",
  novo?.topic === "conversas" && novo?.organization_id === org && novo?.entity_id === conversa, JSON.stringify(novo));

await db.query(`update public.whatsapp_conversations set unread_count = 3 where ${DESTA}`);
confere("mudança sem tocar updated_at também avisa", (await avisos()) === 2);

await db.query(`update public.whatsapp_conversations set owner = 'humano', updated_at = now() where ${DESTA}`);
confere("troca de dono avisa", (await avisos()) === 3);

await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone)
  values ($1, $2, '5565988887777')`, [CONEXAO, org]);
confere("conversa nova avisa", (await avisos()) === 4);
await db.query(`delete from public.whatsapp_conversations where connection_id = $1 and contact_phone = '5565988887777'`, [CONEXAO]);
confere("conversa apagada avisa", (await avisos()) === 5);

// Os outros gatilhos usam a mesma função. A conexão é versionada
// (`touch_versioned_record` sobe `version` a cada update), então até regravar
// igual é mudança de verdade e continua avisando — o corte só vale para o que
// muda apenas `updated_at`.
await db.query("update public.whatsapp_connections set name = 'WhatsApp' where id = $1", [CONEXAO]);
confere("conexão versionada regravada igual continua avisando", (await avisos()) === 6);
await db.query("update public.whatsapp_connections set name = 'WhatsApp da Major' where id = $1", [CONEXAO]);
confere("conexão renomeada avisa", (await avisos()) === 7);

// A faxina agora guarda 1 dia.
await db.query("insert into public.portal_realtime_events (organization_id, topic, entity_id, created_at) values ($1, 'conversas', $2, now() - interval '2 days')", [org, conversa]);
await db.query("insert into public.portal_realtime_events (organization_id, topic, entity_id, created_at) values ($1, 'conversas', $2, now() - interval '2 hours')", [org, conversa]);
await db.query(`update public.whatsapp_conversations set unread_count = 4 where ${DESTA}`);
const velhos = Number((await um("select count(*) n from public.portal_realtime_events where created_at < now() - interval '1 day'")).n);
const recente = Number((await um("select count(*) n from public.portal_realtime_events where created_at between now() - interval '3 hours' and now() - interval '1 hour'")).n);
confere("a faxina apaga o aviso de 2 dias", velhos === 0);
confere("a faxina guarda o aviso de 2 horas", recente === 1);

// A trava: rodar de novo, com a função já trocada, aborta.
let erro = "";
try { await db.exec(ler(`supabase/migrations/${MIGRATION}`)); } catch (e) { erro = String(e.message || e); }
confere("rodar de novo aborta pela trava", /nao e a de 20260911050000/.test(erro), erro);

// Nenhum outro tipo de gatilho ficou sem a função.
const gatilhos = Number((await um(`select count(*) n from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where p.oid = 'private.portal_realtime_notify()'::regprocedure and not t.tgisinternal`)).n);
confere("os gatilhos de realtime continuam ligados", gatilhos >= 9, `gatilhos=${gatilhos}`);

for (const item of passou) console.log(`  ok   ${item}`);
for (const item of falhas) console.log(`  FALHA ${item}`);
console.log(`\nPASS ${passou.length}${falhas.length ? `, FALHA ${falhas.length}` : ""}`);
process.exit(falhas.length ? 1 : 0);
