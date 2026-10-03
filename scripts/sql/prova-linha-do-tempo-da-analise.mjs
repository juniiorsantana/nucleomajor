// Prova comportamental da migration 20261005100000 (a linha do tempo do
// relatório da análise) num Postgres embutido (PGlite), com o harness e TODAS
// as migrations reais do repositório, em ordem. Nada aqui toca produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-linha-do-tempo-da-analise.mjs . && node prova-linha-do-tempo-da-analise.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-linha-do-tempo-da-analise.mjs <repo>");
const MIGRATION = "20261005100000_linha_do_tempo_da_analise.sql";
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

async function como(sub, sql, params = [], { robo = null } = {}) {
  return db.transaction(async (tx) => {
    const claims = sub
      ? { sub, role: "authenticated", ...(robo ? { app_metadata: { is_robot: "true", organization_id: robo.org, connection_id: robo.conexao } } : {}) }
      : { role: "anon" };
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [sub || "", JSON.stringify(claims)]);
    await tx.exec(`set local role ${sub ? "authenticated" : "anon"}`);
    return tx.query(sql, params);
  });
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
let seq = 0;
async function empresa(nome, plano = "full") {
  seq += 1;
  const dono = `bbbbbbbb-0000-4000-8000-00000000000${seq}`;
  const email = `dono${seq}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [dono, email]);
  const codigo = (await como(ADMIN, `select * from public.issue_onboarding_access($1, '${plano}', 7)`, [email])).rows[0].access_code;
  const id = (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
  return { id, dono };
}

// ---------------------------------------------------------------- o mundo
const MAJOR = await empresa("Major");
const OUTRA = await empresa("Outra");
const CONEXAO = "cccccccc-0000-4000-8000-000000000001";
const ROBO = "dddddddd-0000-4000-8000-000000000001";
const MEMBRO = "eeeeeeee-0000-4000-8000-000000000001";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'major')", [CONEXAO, MAJOR.id]);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'robo@exemplo.invalido', now()), ($2, 'membro@exemplo.invalido', now())", [ROBO, MEMBRO]);
await db.query("insert into public.profiles (id, full_name) values ($1, 'Membro') on conflict (id) do nothing", [MEMBRO]);
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [MAJOR.id, MEMBRO]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, MAJOR.id, ROBO]);
const robo = { org: MAJOR.id, conexao: CONEXAO };

const T = "5565988887777";
await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at, owner)
  values ($1, $2, $3, 'direto', now(), 'humano')`, [CONEXAO, MAJOR.id, T]);

// 85 mensagens: a janela do pedido pega só as 80 últimas.
const INICIO = "now() - interval '3 days'";
for (let i = 1; i <= 85; i += 1) {
  const deMim = i % 2 === 0;
  const texto = i === 84 ? "  Vou   pensar\ne te falo  " + "x".repeat(200) : `mensagem ${i}`;
  await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind, media_type)
    values ($1, $2, $3, $4, $5, ${INICIO} + interval '${i * 10} minutes', $6, $7, $8)`,
    [CONEXAO, MAJOR.id, T, `m${i}`, texto, deMim, deMim ? (i % 4 === 0 ? "ia" : "humano") : "contato", i === 3 ? "ptt" : ""]);
}

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna");

const pedido = (await como(MAJOR.dono, "select public.conversation_analysis_request($1, $2, $3, 'atendimento') as r", [MAJOR.id, CONEXAO, T])).rows[0].r;

// Uma mensagem que chega DEPOIS do pedido não entra na linha do tempo.
await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind)
  values ($1, $2, $3, 'depois', 'chegou depois', now() + interval '1 minute', false, 'contato')`, [CONEXAO, MAJOR.id, T]);

const pendente = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, pedido.analysisId])).rows[0].r;
confere("pendente: sem linha do tempo (como o relatório)", pendente.status === "pending" && pendente.timeline === null);

const diagnostico = {
  schema_version: "analysis_report.v1",
  formatVersion: 3,
  summary: "Ficou sem próximo passo.",
  main_bottleneck: { criterion: "next_step", title: "Sem próximo passo", explanation: "", evidence_message_ids: ["m84"] },
  why_this_score: [{ criterion: "next_step", explanation: "Terminou sem ação.", evidence_message_ids: ["m84", "m80"] }],
  what_to_do_now: [{ priority: "alta", action_type: "reply", title: "Retomar", instruction: "", reason: "", due_at: null, evidence_message_ids: ["m10"] }],
  suggested_message: { applicable: false, text: "" },
  red_flags: [{ code: "playbook_violation", severity: null, criterion: "playbook_adherence", reason: "", evidence_message_ids: ["m3"] }],
};
await como(ROBO, "select public.nucleo_analysis_record($1::jsonb)", [JSON.stringify({ analysisId: pedido.analysisId, status: "done", result: diagnostico })], { robo });
const st = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, pedido.analysisId])).rows[0].r;
const linha = st.timeline;
const msgs = linha?.messages || [];
confere("pronta: devolve o que já devolvia, o relatório e a linha do tempo",
  st.status === "done" && st.report?.schema_version === "analysis.v1" && st.result.summary.startsWith("Ficou") && Array.isArray(msgs));
confere("a janela é a do pedido: as 80 últimas, em ordem, sem a que chegou depois",
  msgs.length === 80 && msgs[0].id === "m6" && msgs[79].id === "m85" && !msgs.some((m) => m.id === "depois"),
  JSON.stringify([msgs.length, msgs[0]?.id, msgs[79]?.id]));
confere("em ordem cronológica", msgs.every((m, i) => i === 0 || new Date(m.at) >= new Date(msgs[i - 1].at)));
confere("lado e autor de cada mensagem", msgs.find((m) => m.id === "m7").fromMe === false && msgs.find((m) => m.id === "m8").author === "ia"
  && msgs.find((m) => m.id === "m10").author === "humano" && msgs.find((m) => m.id === "m7").author === "contato");
confere("`until` é o momento do pedido", new Date(linha.until).getTime() === new Date(st.requestedAt).getTime());
const comTrecho = msgs.filter((m) => m.snippet != null).map((m) => m.id).sort();
confere("trecho só das mensagens citadas como evidência (gargalo, porquê, ações e alertas, dentro da janela)",
  JSON.stringify(comTrecho) === JSON.stringify(["m10", "m80", "m84"]), JSON.stringify(comTrecho));
const trecho = msgs.find((m) => m.id === "m84").snippet;
confere("trecho com espaços normalizados e no máximo 90 caracteres", trecho.startsWith("Vou pensar e te falo x") && trecho.length === 90, JSON.stringify(trecho));
confere("as outras mensagens não levam conteúdo", msgs.filter((m) => m.snippet == null).every((m) => !("content" in m)) && msgs.find((m) => m.id === "m7").snippet === null);

// Permissões.
let erro = await erroDe(() => como(MEMBRO, "select public.conversation_analysis_status($1, $2)", [MAJOR.id, pedido.analysisId]));
confere("membro não vê rascunho (como antes)", erro.includes("analysis not found"), erro);
await como(MAJOR.dono, "select public.conversation_analysis_save($1, $2)", [MAJOR.id, pedido.analysisId]);
const doMembro = (await como(MEMBRO, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, pedido.analysisId])).rows[0].r;
confere("análise salva: o membro vê a linha do tempo", doMembro.timeline.messages.length === 80);
erro = await erroDe(() => como(OUTRA.dono, "select public.conversation_analysis_status($1, $2)", [MAJOR.id, pedido.analysisId]));
confere("outra empresa não vê", erro.includes("organization membership required"), erro);
erro = await erroDe(() => como(MAJOR.dono, "select private.linha_do_tempo_da_analise(a) from public.conversation_analyses a"));
confere("a função da linha do tempo não é chamável de fora", erro !== "", erro);

// Análise antiga (formato anterior, sem evidências): linha do tempo sem trechos.
const antiga = (await db.query(`insert into public.conversation_analyses (organization_id, connection_id, contact_phone, kind, status, requested_by, requested_at, completed_at, cycle_start, result)
  values ($1, $2, $3, 'comercial', 'done', $4, now() - interval '1 day', now() - interval '1 day', now(), '{"resumo": "antiga", "formatVersion": 2}') returning id`, [MAJOR.id, CONEXAO, T, MAJOR.dono])).rows[0].id;
const stAntiga = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, antiga])).rows[0].r;
const msgsAntiga = stAntiga.timeline.messages;
confere("análise antiga: janela até o pedido dela, sem trechos", msgsAntiga.length > 0 && msgsAntiga.length <= 80
  && msgsAntiga.every((m) => m.snippet === null && new Date(m.at) <= new Date(stAntiga.requestedAt)) && stAntiga.result.resumo === "antiga");

// Reaplicar aborta.
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", reaplicar.includes("ja foi aplicada"), reaplicar);
await db.exec("rollback");

// Rollback.
await db.exec(ler("scripts/sql/rollback-20261005100000-linha-do-tempo-da-analise.sql"));
const depois = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, pedido.analysisId])).rows[0].r;
confere("rollback: andamento volta ao de antes (sem timeline, com relatório)", !("timeline" in depois) && depois.report?.schema_version === "analysis.v1");
const funcao = (await db.query("select to_regprocedure('private.linha_do_tempo_da_analise(public.conversation_analyses)') as f")).rows[0].f;
confere("rollback: a função sai", funcao === null);
const reaplicada = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("depois do rollback, a migration aplica de novo", reaplicada === "", reaplicada);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
