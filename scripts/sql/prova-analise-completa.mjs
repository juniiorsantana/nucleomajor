// Prova comportamental da migration 20261010100000 (Análise Completa) num
// Postgres embutido (PGlite), com o harness e TODAS as migrations reais do
// repositório, em ordem. Nada aqui toca produção.
//
//   cd /tmp/prova && node prova-analise-completa.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-analise-completa.mjs <repo>");
const MIGRATION = "20261010100000_analise_completa.sql";
const ROLLBACK = "scripts/sql/rollback-20261010100000-analise-completa.sql";
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
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const DONO = "bbbbbbbb-0000-4000-8000-000000000001";
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'dono@exemplo.invalido', now())", [DONO]);
const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access('dono@exemplo.invalido', 'full', 7)")).rows[0].access_code;
const ORG = (await como(DONO, "select public.create_organization('Major', $1) as id", [codigo])).rows[0].id;
const CONEXAO = "cccccccc-0000-4000-8000-000000000001";
const ROBO = "dddddddd-0000-4000-8000-000000000001";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'major')", [CONEXAO, ORG]);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'robo@exemplo.invalido', now())", [ROBO]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, ORG, ROBO]);
const robo = { org: ORG, conexao: CONEXAO };
// 3 créditos no ciclo.
await db.query(`insert into public.organization_entitlements (organization_id, key, limit_value, note)
  values ($1, 'analysis_credits', 3, 'prova') on conflict (organization_id, key) do update set limit_value = 3, enabled = null`, [ORG]);

let n = 0;
async function conversa(telefone) {
  await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at, owner)
    values ($1, $2, $3, 'direto', now(), 'humano')`, [CONEXAO, ORG, telefone]);
  for (const [min, deMim] of [[0, false], [5, true], [9, false], [12, true]]) {
    n += 1;
    await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind, author_id, media_type)
      values ($1, $2, $3, $4, 'texto', now() - interval '2 hours' + interval '${min} minutes', $5, '', null, '')`, [CONEXAO, ORG, telefone, `m${n}`, deMim]);
  }
}
const A = "5565900000001";
const B = "5565900000002";
const C = "5565900000003";
await conversa(A);
await conversa(B);
await conversa(C);
const pedir = (telefone, tipo) => como(DONO, "select public.conversation_analysis_request($1, $2, $3, $4) as r", [ORG, CONEXAO, telefone, tipo]);

// Uma análise de antes: conta 1 crédito depois da migration (coluna nova com 1).
const antiga = (await db.query(`insert into public.conversation_analyses (organization_id, connection_id, contact_phone, kind, status, requested_by, completed_at, cycle_start)
  values ($1, $2, $3, 'atendimento', 'done', $4, now(), now()) returning id`, [ORG, CONEXAO, A, DONO])).rows[0].id;

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna (lead 83 de 95; veredito em risco; sem conclusão abaixo de 50%)");

// 1. O modelo.
const esquemas = (await db.query("select version, status, definition ->> 'key' as chave from public.analysis_schemas where organization_id is null order by version")).rows;
confere("v3 entra como rascunho; o padrão não muda", esquemas.at(-1).chave === "atendimento.v3" && esquemas.at(-1).status === "draft"
  && esquemas.filter((e) => e.status === "published").length === 1, JSON.stringify(esquemas));
const v3 = (await um("select definition from public.analysis_schemas where definition ->> 'key' = 'atendimento.v3'")).definition;
confere("os 7 pontos do lead e os pesos aprovados", JSON.stringify(v3.scores.lead.dimensions.map((d) => [d.key, d.weight])) === JSON.stringify([
  ["need", 20], ["intent", 20], ["urgency", 15], ["decision", 15], ["engagement", 15], ["objection", 10], ["fit", 5]]));
confere("a parte do atendimento é a mesma da v2", v3.scores.atendimento.dimensions.length === 9 && v3.scores.atendimento.dimensions[0].key === "advance");

// 2. Créditos por análise.
let creditos = (await um("select private.creditos_de_analise($1) as c", [ORG])).c;
confere("a análise de antes conta 1 crédito", creditos.used === 1 && creditos.left === 2, JSON.stringify(creditos));
let erro = await erroDe(() => pedir(A, "relatorio"));
confere("tipo desconhecido é recusado", erro.includes("analysis kind must be"), erro);
const completa = (await pedir(A, "completa")).rows[0].r;
creditos = (await um("select private.creditos_de_analise($1) as c", [ORG])).c;
confere("a Completa custa 2 créditos", creditos.used === 3 && creditos.left === 0 && (await um("select credits from public.conversation_analyses where id = $1", [completa.analysisId])).credits === 2,
  JSON.stringify(creditos));
erro = await erroDe(() => pedir(B, "lead"));
confere("sem crédito, o pedido é recusado", erro.includes("no analysis credits left"), erro);
await db.query("update public.organization_entitlements set limit_value = 4 where organization_id = $1 and key = 'analysis_credits'", [ORG]);
erro = await erroDe(() => pedir(B, "completa"));
confere("com 1 crédito sobrando, a Completa (2) é recusada", erro.includes("no analysis credits left"), erro);
const lead = (await pedir(B, "lead")).rows[0].r;
confere("e o Lead (1) passa", lead.status === "pending" && lead.credits.left === 0, JSON.stringify(lead.credits));
await db.query("update public.organization_entitlements set limit_value = 20 where organization_id = $1 and key = 'analysis_credits'", [ORG]);
await db.query("update public.conversation_analyses set status = 'failed' where id = $1", [lead.analysisId]);
creditos = (await um("select private.creditos_de_analise($1) as c", [ORG])).c;
confere("análise que falhou devolve o crédito", creditos.used === 3, JSON.stringify(creditos));

// 3. Com a v3 em vigor, a Completa de ponta a ponta.
await db.query("select private.trocar_regua_padrao('atendimento.v3')");
await db.query("update public.conversation_analyses set status = 'failed' where id = $1", [completa.analysisId]);
const pedido = (await pedir(C, "completa")).rows[0].r;
const carga = (await um("select private_payload from public.connection_runtime_commands where command_type = 'conversation_analyze' order by created_at desc limit 1")).private_payload;
confere("o pedido leva o tipo e a régua v3", carga.kind === "completa" && carga.playbook.regua === "atendimento.v3" && "lead" in carga.scores, JSON.stringify(Object.keys(carga.scores)));
const respostas = [
  ["vnd_advance", "continuacao", 0.8], ["vnd_diagnosis", "atencao", 0.7], ["vnd_objection", "ruim", 0.9], ["vnd_leads", "ruim", 0.7],
  ["vnd_close", "nao_avaliado", 0.9], ["vnd_follow_up", "ruim", 0.8], ["vnd_empathy", "bom", 0.8], ["vnd_promises", "cumpriu", 0.9],
  ["disse_necessidade", "sim", 0.9], ["intencao", "comprar_agora", 0.8], ["prazo", "este_mes", 0.7], ["decisor", "outra_pessoa", 0.9],
  ["temperatura", "quente", 0.8], ["lead_objection", "contornavel", 0.8], ["lead_fit", "nao_avaliado", 0.9],
].map(([question, answer, probability]) => ({ question, answer, probability }));
const classificada = (await como(ROBO, "select public.nucleo_analysis_classify($1::jsonb) as r", [JSON.stringify({ analysisId: pedido.analysisId, answers: respostas })], { robo })).rows[0].r;
// O fato da velocidade nesta conversa: resposta em 5 minutos úteis ou fora do expediente.
const atendimento = classificada.scores.atendimento;
confere("as duas notas saem do banco: lead 83", classificada.leadScore === 83 && classificada.schemaVersion === 3 && atendimento.score != null,
  JSON.stringify([classificada.leadScore, classificada.serviceScore, classificada.schemaVersion]));
const diagnostico = {
  schema_version: "analysis_report.v2", formatVersion: 5,
  summary: "Lead bom, venda parada.",
  verdict: "Deixou o cliente sem caminho.",
  did_well: [], cost_the_sale: [{ title: "Sem data", evidence_message_ids: [`m${n - 1}`] }],
  lead_verdict: "Quer comprar e tem pressa, mas depende do sócio.",
  lead_why: [{ criterion: "decision", explanation: "Precisa ver com o sócio.", evidence_message_ids: [`m${n - 3}`] }],
  matrix_explanation: "Lead bom e atendimento abaixo do corte: venda escorrendo.",
  why_this_score: [], what_to_do_now: [], suggested_message: { applicable: false, text: null }, red_flags: [],
};
await como(ROBO, "select public.nucleo_analysis_record($1::jsonb)", [JSON.stringify({ analysisId: pedido.analysisId, status: "done", result: diagnostico })], { robo });
const st = (await como(DONO, "select public.conversation_analysis_status($1, $2) as r", [ORG, pedido.analysisId])).rows[0].r;
const rel = st.report;
confere("relatório: as duas notas, o tipo e o custo", rel.schema_version === "analysis.v2" && rel.kind === "completa" && rel.credits === 2
  && rel.lead_score.score === 83 && rel.lead_score.band === "bom" && rel.lead_score.coverage === 95 && rel.vendedor_score.score === atendimento.score,
  JSON.stringify([rel.lead_score?.score, rel.lead_score?.band, rel.lead_score?.coverage]));
const decisao = rel.lead_score.criteria.find((c) => c.key === "decision");
confere("por ponto do lead: estado, pontos e o porquê do Claude", decisao.status === "atencao" && decisao.points_awarded === 9 && decisao.reason === "Precisa ver com o sócio."
  && rel.lead_score.criteria.find((c) => c.key === "fit").status === "nao_avaliado");
const esperado = atendimento.score >= 75 ? "avancar" : "em_risco";
confere("veredito do cruzamento pelo corte de 75", rel.matrix.key === esperado && rel.matrix.lead_good === true, JSON.stringify(rel.matrix));
confere("diagnóstico com o veredito do lead e a explicação do cruzamento",
  rel.diagnosis.lead_verdict.startsWith("Quer comprar") && rel.diagnosis.matrix_explanation.includes("escorrendo") && rel.diagnosis.lead_why.length === 1);
const citadas = st.timeline.messages.filter((m) => m.snippet).map((m) => m.id).sort();
confere("a linha do tempo cita também o porquê do lead", citadas.includes(`m${n - 3}`), JSON.stringify(citadas));

// 4. Atendimento na v3: sem veredito do cruzamento.
const soAtendimento = (await pedir(A, "atendimento")).rows[0].r;
await como(ROBO, "select public.nucleo_analysis_record($1::jsonb)", [JSON.stringify({ analysisId: soAtendimento.analysisId, status: "done", result: { ...diagnostico, lead_why: [] } })], { robo });
const relAtendimento = (await como(DONO, "select public.conversation_analysis_status($1, $2) as r", [ORG, soAtendimento.analysisId])).rows[0].r.report;
confere("análise de atendimento não tem veredito do cruzamento", relAtendimento.matrix === null && relAtendimento.kind === "atendimento");

// 5. O veredito nas quatro casas e sem base.
const casa = async (vend, ld, coberturaVend = 100) =>
  (await um("select private.veredito_do_cruzamento($1::jsonb, $2::jsonb) ->> 'key' as k", [
    JSON.stringify({ score: vend, evaluatedWeight: coberturaVend, maxWeight: 100 }), JSON.stringify({ score: ld, evaluatedWeight: 100, maxWeight: 100 })])).k;
confere("as quatro casas e o sem conclusão",
  (await casa(80, 80)) === "avancar" && (await casa(60, 80)) === "em_risco" && (await casa(80, 60)) === "nutrir_ou_soltar"
    && (await casa(60, 60)) === "revisar_processo" && (await casa(80, 80, 49)) === "sem_conclusao" && (await casa(75, 75)) === "avancar");

// 6. Painel e permissões.
const painel = (await como(ADMIN, "select public.platform_analysis_schema_set($1, 'atendimento.v3', '') as r", [ORG])).rows[0].r;
confere("o painel aceita a v3", painel.schema === "atendimento.v3");
for (const [funcao, papel] of [["private.veredito_do_cruzamento(jsonb, jsonb)", "authenticated"], ["public.conversation_analysis_request(uuid, uuid, text, text)", "anon"]]) {
  confere(`${papel} não executa ${funcao}`, (await um(`select has_function_privilege('${papel}', '${funcao}', 'execute') as t`)).t === false);
}

// 7. Reaplicar aborta.
erro = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", erro.includes("ja foi aplicada"), erro);
await db.exec("rollback");

// 8. Rollback.
await db.exec(ler(ROLLBACK));
const padrao = (await db.query("select definition ->> 'key' as chave from public.analysis_schemas where organization_id is null and status = 'published'")).rows;
confere("rollback: a v2 volta a ser o padrão", padrao.length === 1 && padrao[0].chave === "atendimento.v2", JSON.stringify(padrao));
confere("rollback: a coluna de créditos sai e o uso volta a contar linhas",
  (await um("select count(*)::int as n from information_schema.columns where table_name = 'conversation_analyses' and column_name = 'credits'")).n === 0
    && (await um("select private.creditos_de_analise($1) as c", [ORG])).c.used >= 1);
confere("rollback: com análises de lead e completa guardadas, a trava de tipos continua aceitando-as",
  (await um("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'conversation_analyses_kind_check'")).d.includes("completa"));
confere("rollback: a função do veredito sai", (await um("select to_regprocedure('private.veredito_do_cruzamento(jsonb, jsonb)') is null as x")).x);
erro = await erroDe(() => como(DONO, "select public.conversation_analysis_status($1, $2)", [ORG, pedido.analysisId]));
confere("rollback: a Completa feita continua abrindo", erro === "", erro);
erro = await erroDe(() => pedir(B, "completa"));
confere("rollback: o pedido volta a aceitar só comercial e atendimento", erro.includes("comercial or atendimento"), erro);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
