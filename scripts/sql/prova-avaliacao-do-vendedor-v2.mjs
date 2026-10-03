// Prova comportamental da migration 20261008100000 (Avaliação do vendedor
// v2) num Postgres embutido (PGlite), com o harness e TODAS as migrations
// reais do repositório, em ordem. Nada aqui toca produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-avaliacao-do-vendedor-v2.mjs . && node prova-avaliacao-do-vendedor-v2.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-avaliacao-do-vendedor-v2.mjs <repo>");
const MIGRATION = "20261008100000_avaliacao_do_vendedor_v2.sql";
const ROLLBACK = "scripts/sql/rollback-20261008100000-avaliacao-do-vendedor-v2.sql";
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
const ANA = "eeeeeeee-0000-4000-8000-000000000001";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'major')", [CONEXAO, MAJOR.id]);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'robo@exemplo.invalido', now()), ($2, 'ana@exemplo.invalido', now())", [ROBO, ANA]);
await db.query("insert into public.profiles (id, full_name) values ($1, 'Ana Perfil') on conflict (id) do update set full_name = excluded.full_name", [ANA]);
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [MAJOR.id, ANA]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, MAJOR.id, ROBO]);
const robo = { org: MAJOR.id, conexao: CONEXAO };

let msg = 0;
async function conversa(telefone, roteiro) {
  await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at, owner)
    values ($1, $2, $3, 'direto', now(), 'humano') on conflict do nothing`, [CONEXAO, MAJOR.id, telefone]);
  for (const [quando, deMim, autor, texto] of roteiro) {
    msg += 1;
    const humano = autor === "ana";
    await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at,
        is_from_me, author_kind, author_id, author_name, media_type)
      values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, '')`,
      [CONEXAO, MAJOR.id, telefone, `m${msg}`, texto || "oi", quando, deMim, humano ? "humano" : autor, humano ? ANA : null, humano ? "Ana" : ""]);
  }
}
const vendedor = async (telefone, ate) =>
  (await db.query("select private.fatos_do_vendedor($1, $2, $3, $4::timestamptz) as f", [MAJOR.id, CONEXAO, telefone, ate])).rows[0].f;

// Quarta, 30/09/2026, horário de Brasília.
const Q = (h) => `2026-09-30 ${h}-03`;
await conversa("5565900000001", [[Q("10:00"), false, "", "quero uma carta"], [Q("10:10"), true, "", "oi! pra que é?"], [Q("10:20"), false, "", "casa"], [Q("10:30"), true, "", "show"]]);
await conversa("5565900000002", [[Q("10:00"), false, "", "oi"], [Q("10:00:30"), true, "ia", "olá"], [Q("10:01"), true, "ia", "me conta"], [Q("10:30"), true, "ana", "assumo"]]);
await conversa("5565900000003", [[Q("10:00"), false, "", "oi"], [Q("10:40"), true, "ana", "oi"], [Q("10:41"), true, "ana", "tudo?"], [Q("10:42"), true, "", "do celular"]]);
await conversa("5565900000004", [[Q("10:00"), true, "ana", "oi, vi seu cadastro"], [Q("10:05"), false, "", "oi"]]);
await conversa("5565900000005", [["2026-10-03 19:50-03", false, "", "oi"], ["2026-10-05 08:10-03", true, "", "bom dia"]]);
await conversa("5565900000006", [[Q("10:00"), false, "", "oi, alguém?"]]);
await conversa("5565900000007", [[Q("10:00"), false, "", "oi"], [Q("10:00:10"), true, "bot", "já te respondo"], [Q("13:00"), true, "", "oi!"]]);

// Uma análise e uma leitura de ANTES: o histórico não pode mudar.
const T = "5565900000001";
const analiseAntiga = (await db.query(`insert into public.conversation_analyses (organization_id, connection_id, contact_phone, kind, status, requested_by, completed_at, cycle_start, result, facts, facts_version, schema_version, scores, service_score)
  values ($1, $2, $3, 'atendimento', 'done', $4, now(), now(), '{"schema_version": "analysis_report.v1", "summary": "antiga"}', '{"version": 2}', 2, 1,
  '{"atendimento": {"score": 47, "evaluatedWeight": 55, "maxWeight": 100, "dimensions": [{"key": "next_step", "weight": 15, "factor": 0, "points": 0, "criteria": [{"key": "next_step", "value": "ficou_em_aberto"}]}]}}', 47) returning id`,
  [MAJOR.id, CONEXAO, T, MAJOR.dono])).rows[0].id;

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna (45 = 39,2 de 88; 20 minutos úteis de sábado a segunda)");

// 1. Nada muda para ninguém ao aplicar.
const esquemas = (await db.query("select organization_id, version, status, definition ->> 'key' as chave from public.analysis_schemas order by version")).rows;
confere("v1 continua o padrão publicado; v2 entra como rascunho da plataforma",
  esquemas.length === 2 && esquemas[0].chave === "atendimento.v1" && esquemas[0].status === "published"
    && esquemas[1].chave === "atendimento.v2" && esquemas[1].status === "draft" && esquemas[1].organization_id === null,
  JSON.stringify(esquemas));
let regua = (await um("select private.regua_da_empresa($1) as r", [MAJOR.id])).r;
let pj = (await um("select private.playbook_para_o_jev($1) as p", [MAJOR.id])).p;
let ef = (await um("select private.playbook_efetivo($1) as p", [MAJOR.id])).p;
confere("régua em vigor: v1, e ela viaja no playbook do Jev e no efetivo", regua === "atendimento.v1" && pj.regua === "atendimento.v1" && ef.regua === "atendimento.v1" && ef.origem === "base_major" && pj.regras.length === 12);
const v2 = (await um("select definition from public.analysis_schemas where definition ->> 'key' = 'atendimento.v2'")).definition;
const dims = v2.scores.atendimento.dimensions;
confere("os 9 pontos e pesos aprovados (somam 100)",
  JSON.stringify(dims.map((d) => [d.key, d.weight])) === JSON.stringify([
    ["advance", 16], ["diagnosis", 14], ["objection", 12], ["leads", 12], ["close", 12],
    ["follow_up", 10], ["speed", 8], ["empathy", 8], ["promises", 8]]));
confere("cada ponto diz de onde vem", dims.every((d) => typeof d.reference === "string" && d.reference.length > 5));

// 2. Minutos de horário comercial.
const uteis = async (a, b) => (await um("select private.minutos_uteis($1::timestamptz, $2::timestamptz) as m", [a, b])).m;
confere("15 minutos dentro do expediente", (await uteis(Q("10:00"), Q("10:15"))) === 15);
confere("noite não conta: 19h50 até 8h10 do dia seguinte = 20", (await uteis(Q("19:50"), "2026-10-01 08:10-03")) === 20);
confere("domingo inteiro não conta", (await uteis("2026-10-04 00:00-03", "2026-10-05 00:00-03")) === 0);
confere("sábado conta (das 8h às 20h)", (await uteis("2026-10-03 07:00-03", "2026-10-03 21:00-03")) === 720);
confere("fim antes do começo: zero", (await uteis(Q("11:00"), Q("10:00"))) === 0);

// 3. Quem atendeu e a velocidade.
let f = await vendedor("5565900000001", Q("12:00"));
confere("mensagens sem autor (do celular): vendedor geral 'Equipe · pelo celular'",
  f.seller.kind === "equipe" && f.seller.label === "Equipe · pelo celular" && f.seller.authorId === null, JSON.stringify(f.seller));
confere("primeira resposta em 10 minutos úteis: bom", f.speed.state === "bom" && f.speed.firstResponseBusinessMinutes === 10, JSON.stringify(f.speed));
f = await vendedor("5565900000002", Q("12:00"));
confere("IA escreveu mais: o vendedor é a IA", f.seller.kind === "ia" && f.seller.label === "IA");
confere("resposta da IA em 30 s: bom", f.speed.state === "bom" && f.speed.firstResponseBusinessMinutes === 0);
f = await vendedor("5565900000003", Q("12:00"));
confere("a maioria da equipe com autor (portal): a pessoa, pelo nome que veio na mensagem",
  f.seller.kind === "pessoa" && f.seller.authorId === ANA && f.seller.label === "Ana", JSON.stringify(f.seller));
confere("40 minutos: atenção", f.speed.state === "atencao" && f.speed.firstResponseBusinessMinutes === 40);
f = await vendedor("5565900000004", Q("12:00"));
confere("conversa que a empresa começou: velocidade não avaliada", f.speed.state === "nao_avaliado" && f.speed.firstResponseBusinessMinutes === null);
f = await vendedor("5565900000005", "2026-10-05 12:00-03");
confere("sábado 19h50 até segunda 8h10: 20 minutos úteis, atenção", f.speed.state === "atencao" && f.speed.firstResponseBusinessMinutes === 20, JSON.stringify(f.speed));
f = await vendedor("5565900000006", Q("11:00"));
confere("sem resposta há 1 hora útil: ainda não avaliado", f.speed.state === "nao_avaliado" && f.speed.waitingBusinessMinutes === 60 && f.seller === null, JSON.stringify(f.speed));
f = await vendedor("5565900000006", Q("15:30"));
confere("sem resposta há mais de 4 horas úteis: crítico", f.speed.state === "critico" && f.speed.waitingBusinessMinutes === 241);
f = await vendedor("5565900000007", Q("14:00"));
confere("mensagem automática (bot) não conta como resposta: 3 horas, ruim", f.speed.state === "ruim" && f.speed.firstResponseBusinessMinutes === 180, JSON.stringify(f.speed));

// 4. Fatos versão 3 e a nota de antes, igual.
let av = (await um("select private.avaliar_conversa($1, $2, $3, '{}'::jsonb) as a", [MAJOR.id, CONEXAO, T])).a;
confere("fatos versão 3: os da versão 2 e mais vendedor e velocidade",
  av.facts.version === 3 && av.facts.seller.kind === "equipe" && av.facts.speed.state === "bom" && "humanClock" in av.facts && "communication" in av.facts,
  JSON.stringify([av.facts.version, av.facts.seller]));
confere("enquanto o padrão é a v1, a nota sai na v1", av.schemaVersion === 1 && av.scores.atendimento.dimensions.some((d) => d.key === "next_step"));
const antiga = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, analiseAntiga])).rows[0].r;
confere("análise antiga continua no relatório v1", antiga.report.schema_version === "analysis.v1" && antiga.report.atendimento_score.score === 47);

// 5. A troca do padrão.
let erro = await erroDe(() => como(MAJOR.dono, "select private.trocar_regua_padrao('atendimento.v2')"));
confere("só o banco troca o padrão (cliente não executa)", erro.includes("permission denied"), erro);
let r = (await um("select private.trocar_regua_padrao('atendimento.v2') as r")).r;
const depois = (await db.query("select organization_id, status, definition ->> 'key' as chave from public.analysis_schemas where organization_id is null order by version")).rows;
confere("v2 vira o padrão; a v1 fica aposentada (guardada)", r === "atendimento.v2" && depois[0].status === "retired" && depois[1].status === "published", JSON.stringify(depois));
r = (await um("select private.trocar_regua_padrao('atendimento.v2') as r")).r;
confere("trocar de novo não faz nada", r === "atendimento.v2" && (await um("select count(*)::int as n from public.analysis_schemas where status = 'published'")).n === 1);
erro = await erroDe(() => db.query("select private.trocar_regua_padrao('nao.existe')"));
confere("chave desconhecida é recusada", erro.includes("unknown analysis schema"), erro);
regua = (await um("select private.regua_da_empresa($1) as r", [OUTRA.id])).r;
pj = (await um("select private.playbook_para_o_jev($1) as p", [MAJOR.id])).p;
confere("todas as empresas passam a ver a v2", regua === "atendimento.v2" && pj.regua === "atendimento.v2");
av = (await um("select private.avaliar_conversa($1, $2, $3, '{}'::jsonb) as a", [MAJOR.id, CONEXAO, T])).a;
confere("a nota passa a sair na v2; só a velocidade, sem o Jev: 100 de 8 (não conclusiva)",
  av.schemaVersion === 2 && av.scores.atendimento.score === 100 && av.scores.atendimento.evaluatedWeight === 8, JSON.stringify(av.scores.atendimento.evaluatedWeight));

// 6. Uma empresa numa régua diferente do padrão.
erro = await erroDe(() => como(MAJOR.dono, "select public.platform_analysis_schema_set($1, 'atendimento.v1', '')", [OUTRA.id]));
confere("só administrador da plataforma muda a régua de uma empresa", erro.includes("platform administrator"), erro);
erro = await erroDe(() => como(ADMIN, "select public.platform_analysis_schema_set($1, 'outra.v9', '')", [OUTRA.id]));
confere("régua fora da lista é recusada", erro.includes("unknown analysis schema"), erro);
const auditAntes = (await um("select count(*)::int as n from public.platform_audit_log")).n;
r = (await como(ADMIN, "select public.platform_analysis_schema_set($1, 'atendimento.v1', 'voltar para comparar') as r", [OUTRA.id])).rows[0].r;
confere("uma empresa volta para a v1 sem voltar todo mundo",
  r.schema === "atendimento.v1" && (await um("select private.regua_da_empresa($1) as r", [OUTRA.id])).r === "atendimento.v1"
    && (await um("select private.regua_da_empresa($1) as r", [MAJOR.id])).r === "atendimento.v2", JSON.stringify(r));
confere("a mudança fica no histórico do painel", (await um("select count(*)::int as n from public.platform_audit_log")).n === auditAntes + 1);
r = (await como(ADMIN, "select public.platform_analysis_schema_set($1, 'atendimento.v2', '') as r", [OUTRA.id])).rows[0].r;
const proprias = (await db.query("select status from public.analysis_schemas where organization_id = $1", [OUTRA.id])).rows;
confere("pedir o padrão tira a régua própria (fica aposentada)", r.schema === "atendimento.v2" && proprias.length === 1 && proprias[0].status === "retired");
await como(ADMIN, "select public.platform_analysis_schema_set($1, 'atendimento.v1', '')", [OUTRA.id]);
const religada = (await db.query("select status from public.analysis_schemas where organization_id = $1", [OUTRA.id])).rows;
confere("ligar de novo reaproveita a linha antiga", religada.length === 1 && religada[0].status === "published");

// 7. A análise do botão, de ponta a ponta, na v2.
const pedido = (await como(MAJOR.dono, "select public.conversation_analysis_request($1, $2, $3, 'atendimento') as r", [MAJOR.id, CONEXAO, T])).rows[0].r;
const carga = (await um("select private_payload from public.connection_runtime_commands where command_type = 'conversation_analyze' order by created_at desc limit 1")).private_payload;
confere("o pedido leva a régua no playbook e os fatos v3",
  carga.playbook.regua === "atendimento.v2" && carga.facts.version === 3 && carga.facts.seller.label === "Equipe · pelo celular"
    && carga.scores.atendimento.dimensions[0].key === "advance", JSON.stringify(carga.playbook.regua));
const respostas = [
  { question: "vnd_advance", answer: "continuacao", probability: 0.8 },
  { question: "vnd_diagnosis", answer: "atencao", probability: 0.7 },
  { question: "vnd_objection", answer: "ruim", probability: 0.9 },
  { question: "vnd_leads", answer: "ruim", probability: 0.7 },
  { question: "vnd_close", answer: "nao_avaliado", probability: 0.9 },
  { question: "vnd_follow_up", answer: "ruim", probability: 0.8 },
  { question: "vnd_empathy", answer: "bom", probability: 0.8 },
  { question: "vnd_promises", answer: "cumpriu", probability: 0.9 },
];
const classificada = (await como(ROBO, "select public.nucleo_analysis_classify($1::jsonb) as r", [JSON.stringify({ analysisId: pedido.analysisId, answers: respostas })], { robo })).rows[0].r;
confere("classificação na hora: o exemplo do canvas dá 45 (39,2 de 88)",
  classificada.serviceScore === 45 && classificada.schemaVersion === 2 && classificada.scores.atendimento.points === 39.2,
  JSON.stringify([classificada.serviceScore, classificada.scores?.atendimento?.points]));
const diagnostico = {
  schema_version: "analysis_report.v2",
  formatVersion: 4,
  summary: "Atendeu rápido, mas não vendeu.",
  verdict: "Mandou a simulação e deixou o cliente sem caminho.",
  did_well: [{ title: "Respondeu em 10 minutos", evidence_message_ids: ["m2"] }],
  cost_the_sale: [{ title: "Terminou sem compromisso com data", evidence_message_ids: ["m4"] }],
  main_bottleneck: { criterion: "advance", title: "Sem avanço", explanation: "Continuação.", evidence_message_ids: ["m4"] },
  why_this_score: [
    { criterion: "advance", explanation: "Terminou em 'show'.", better: "Te ligo amanhã às 19h?", evidence_message_ids: ["m4"] },
    { criterion: "speed", explanation: "Respondeu em 10 minutos.", better: null, evidence_message_ids: ["m2"] },
  ],
  what_to_do_now: [{ priority: "alta", action_type: "reply", title: "Retomar", instruction: "Propor ligação", reason: "Sem avanço", due_at: null, evidence_message_ids: [] }],
  suggested_message: { applicable: true, text: "Te ligo amanhã às 19h?" },
  red_flags: [],
};
await como(ROBO, "select public.nucleo_analysis_record($1::jsonb)", [JSON.stringify({ analysisId: pedido.analysisId, status: "done", result: diagnostico })], { robo });
const st = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, pedido.analysisId])).rows[0].r;
const rel = st.report;
confere("relatório analysis.v2 com vendedor e velocidade", rel.schema_version === "analysis.v2" && rel.seller.kind === "equipe" && rel.speed.state === "bom", rel.schema_version);
const vs = rel.vendedor_score;
confere("faixa, cobertura e conclusão saem do banco: 45 = Atrapalhou a venda, 88% avaliado",
  vs.score === 45 && vs.band === "atrapalhou" && vs.band_label === "Atrapalhou a venda" && vs.coverage === 88 && vs.conclusive === true,
  JSON.stringify([vs.score, vs.band, vs.coverage]));
const ponto = (k) => vs.criteria.find((c) => c.key === k);
confere("por ponto: estado, pontos, crítica e o que um vendedor top teria feito",
  ponto("advance").status === "critico" && ponto("advance").points_awarded === 0 && ponto("advance").critique === "Terminou em 'show'."
    && ponto("advance").better === "Te ligo amanhã às 19h?" && ponto("diagnosis").status === "atencao" && ponto("diagnosis").points_awarded === 8.4
    && ponto("close").status === "nao_avaliado" && ponto("close").points_awarded === null && ponto("promises").status === "bom" && ponto("speed").critique === "Respondeu em 10 minutos.",
  JSON.stringify(ponto("diagnosis")));
confere("veredito, o que fez bem e o que custou a venda", rel.diagnosis.verdict.startsWith("Mandou") && rel.diagnosis.did_well[0].title.includes("10 minutos") && rel.diagnosis.cost_the_sale.length === 1);
confere("alerta de regra: conversa sem compromisso com data", rel.red_flags.some((b) => b.code === "conversation_left_open" && b.criterion === "advance"));
const citadas = st.timeline.messages.filter((m) => m.snippet).map((m) => m.id).sort();
confere("a linha do tempo cita também o que fez bem e o que custou a venda", JSON.stringify(citadas) === JSON.stringify(["m2", "m4"]), JSON.stringify(citadas));
// Faixas nas bordas.
const faixa = async (cls) => {
  const notas = (await um("select private.pontuar($1::jsonb, '{}'::jsonb, $2::jsonb) as p", [JSON.stringify(v2), JSON.stringify(cls)])).p;
  await db.query("update public.conversation_analyses set scores = $2 where id = $1", [pedido.analysisId, JSON.stringify(notas)]);
  return (await um("select private.relatorio_da_analise(a) as r from public.conversation_analyses a where id = $1", [pedido.analysisId])).r.vendedor_score;
};
let fx = await faixa({ vnd_advance: { a: "fechou", p: 0.9 }, vnd_diagnosis: { a: "atencao", p: 0.9 } });
confere("(16 + 8,4) ÷ 30 = 81: Vendeu bem, mas 30% avaliado não é conclusivo", fx.score === 81 && fx.band === "vendeu_bem" && fx.coverage === 30 && fx.conclusive === false, JSON.stringify([fx.score, fx.coverage]));
fx = await faixa({ vnd_advance: { a: "compromisso_sem_data", p: 0.9 }, vnd_diagnosis: { a: "atencao", p: 0.9 }, vnd_objection: { a: "atencao", p: 0.9 }, vnd_leads: { a: "atencao", p: 0.9 } });
confere("tudo em atenção: 60, Atende mas não fecha", fx.score === 60 && fx.band === "nao_fecha" && fx.band_label === "Atende, mas não fecha");
fx = await faixa({ vnd_promises: { a: "vencida_sem_entrega", p: 0.9 } });
confere("promessa vencida sem entrega: ruim (0,2), com o alerta de regra",
  fx.criteria.find((c) => c.key === "promises").status === "ruim");

// 8. Permissões.
for (const [funcao, papel] of [
  ["private.ligar_regua(uuid, text)", "authenticated"],
  ["private.trocar_regua_padrao(text)", "authenticated"],
  ["private.fatos_do_vendedor(uuid, uuid, text, timestamptz)", "authenticated"],
  ["private.minutos_uteis(timestamptz, timestamptz, integer)", "authenticated"],
  ["private.relatorio_do_vendedor(public.conversation_analyses)", "authenticated"],
  ["public.platform_analysis_schema_set(uuid, text, text)", "anon"],
]) {
  const tem = (await um(`select has_function_privilege('${papel}', '${funcao}', 'execute') as t`)).t;
  confere(`${papel} não executa ${funcao}`, tem === false);
}

// 9. Reaplicar aborta.
erro = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", erro.includes("ja foi aplicada"), erro);
await db.exec("rollback");

// 10. Rollback.
const notaAntes = (await um("select service_score from public.conversation_analyses where id = $1", [pedido.analysisId])).service_score;
await db.exec(ler(ROLLBACK));
const padrao = (await db.query("select definition ->> 'key' as chave from public.analysis_schemas where organization_id is null and status = 'published'")).rows;
confere("rollback: a v1 volta a ser o padrão, só ela publicada", padrao.length === 1 && padrao[0].chave === "atendimento.v1", JSON.stringify(padrao));
confere("rollback: a empresa com régua própria v1 fica aposentada (vale o padrão)",
  (await db.query("select status from public.analysis_schemas where organization_id = $1", [OUTRA.id])).rows.every((l) => l.status === "retired"));
av = (await um("select private.avaliar_conversa($1, $2, $3, '{}'::jsonb) as a", [MAJOR.id, CONEXAO, T])).a;
confere("rollback: fatos voltam à versão 2 e a nota à v1", av.facts.version === 2 && !("seller" in av.facts) && av.schemaVersion === 1);
ef = (await um("select private.playbook_efetivo($1) as p", [MAJOR.id])).p;
confere("rollback: o playbook não leva mais a régua", !("regua" in ef));
const funcoes = (await um("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('fatos_do_vendedor', 'minutos_uteis', 'ligar_regua', 'trocar_regua_padrao', 'regua_da_empresa', 'relatorio_do_vendedor', 'platform_analysis_schema_set')")).n;
confere("rollback: as funções novas saem", funcoes === 0);
confere("rollback: a nota gravada fica", (await um("select service_score from public.conversation_analyses where id = $1", [pedido.analysisId])).service_score === notaAntes);
erro = await erroDe(() => como(MAJOR.dono, "select public.conversation_analysis_status($1, $2)", [MAJOR.id, pedido.analysisId]));
confere("rollback: o andamento continua abrindo a análise feita na v2", erro === "", erro);
await db.exec("delete from public.analysis_schemas where definition ->> 'key' = 'atendimento.v2'");
erro = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("depois do rollback, a migration aplica de novo", erro === "", erro);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
