// Prova comportamental da migration 20261004100000 (Analysis Schema v1:
// Atendimento Score) num Postgres embutido (PGlite), com o harness e TODAS as
// migrations reais do repositório, em ordem. Nada aqui toca produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-atendimento-score-v1.mjs . && node prova-atendimento-score-v1.mjs <repo>
//
// Os números entre colchetes são os cenários da seção 17 da especificação
// que dependem do banco e das regras. Os cenários semânticos (o Jev
// entender a conversa) são cobertos pelas instruções das perguntas, nos
// testes do runtime, e precisam de calibração com conversas reais.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-atendimento-score-v1.mjs <repo>");
const MIGRATION = "20261004100000_atendimento_score_v1.sql";
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

// ---------------------------------------------------------------- o mundo, antes da migration
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

// A conversa (minutos desde o início, há 5 horas):
//   0   contato  texto curto                    "quero um site"
//   1   IA       resposta imediata              (não conta como humana)
//   2   bot      lembrete
//   3   contato  áudio
//   10  -- handoff para pessoa (pedido gravado pelo runtime)
//   11  IA       "já te passo para alguém"      (ainda não é humana)
//   30  equipe   primeira resposta humana       -> 20 min depois do handoff [1]
//   31  equipe   áudio
const INICIO = "now() - interval '5 hours'";
const roteiro = [
  [0, false, "", "", "quero um site"],
  [1, true, "ia", "", "Olá! Me conta mais sobre o seu negócio, por favor."],
  [2, true, "bot", "", "Lembrete"],
  [3, false, "", "ptt", ""],
  [11, true, "ia", "", "Já te passo para alguém da equipe."],
  [30, true, "humano", "", "Oi, sou da equipe. Vamos marcar um diagnóstico?"],
  [31, true, "humano", "ptt", ""],
];
for (const [i, [min, deMim, autor, midia, texto]] of roteiro.entries()) {
  await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind, author_id, media_type)
    values ($1, $2, $3, $4, $5, ${INICIO} + interval '${min} minutes', $6, $7, $8, $9)`,
    [CONEXAO, MAJOR.id, T, `m${i + 1}`, texto, deMim, autor, autor === "humano" ? MEMBRO : null, midia]);
}
const contato = (await db.query("insert into public.contacts (organization_id, name, phone, lead_at) values ($1, 'Lead', '(65) 9 8888-7777', now()) returning id", [MAJOR.id])).rows[0].id;
const agente = (await db.query("select id from public.assistant_profiles where organization_id = $1 order by created_at limit 1", [MAJOR.id])).rows[0]?.id;
if (!agente) throw new Error("a empresa de teste não tem agente");
const contexto = (await db.query(`insert into public.conversation_intelligence_contexts
  (organization_id, connection_id, contact_id, assistant_profile_id, audience, channel, conversation_key_hash)
  values ($1, $2, $3, $4, 'customer', 'whatsapp', $5) returning id`, [MAJOR.id, CONEXAO, contato, agente, "a".repeat(64)])).rows[0].id;
await db.query(`insert into public.customer_handoff_requests (organization_id, connection_id, contact_id, context_id, reason_code, routing_address, created_at)
  values ($1, $2, $3, $4, 'requested_human', $5, ${INICIO} + interval '10 minutes')`, [MAJOR.id, CONEXAO, contato, contexto, T]);

// Uma leitura e uma análise de ANTES da v1: o histórico não pode mudar [29].
await db.query(`insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
  values ($1, $2, $3, now(), 'ok', '{"att_discovery": {"a": "bom", "p": 0.9}}', true)`, [MAJOR.id, CONEXAO, T]);
const leituraAntiga = (await db.query("select id, schema_version, service_score, facts_version from public.conversation_insight_runs where is_latest")).rows[0];
const analiseAntiga = (await db.query(`insert into public.conversation_analyses (organization_id, connection_id, contact_phone, kind, status, requested_by, completed_at, cycle_start, result, facts, facts_version, schema_version)
  values ($1, $2, $3, 'comercial', 'done', $4, now(), now(), '{"resumo": "antiga", "formatVersion": 2}', '{"version": 1}', 1, 0) returning id`, [MAJOR.id, CONEXAO, T, MAJOR.dono])).rows[0].id;

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna (53 de 45 avaliados no exemplo)");

// 1. O esquema.
const esquemas = (await db.query("select organization_id, version, status, definition from public.analysis_schemas")).rows;
const v1 = esquemas.find((e) => e.definition.key === "atendimento.v1");
const dims = v1.definition.scores.atendimento.dimensions;
confere("atendimento.v1 publicado como padrão da plataforma, versão 1", esquemas.length === 1 && v1.organization_id === null && v1.status === "published" && v1.version === 1);
confere("os 8 critérios e pesos da especificação (somam 100)",
  JSON.stringify(dims.map((d) => [d.key, d.weight])) === JSON.stringify([
    ["responsiveness", 10], ["discovery", 15], ["conversation_coherence", 15], ["communication_adaptation", 10],
    ["qualification", 10], ["playbook_adherence", 15], ["next_step", 15], ["follow_up", 10]]));
confere("sem família lead: Lead Score fica nulo", !("lead" in v1.definition.scores));

// 2. O histórico não muda [29].
const leituraDepois = (await db.query("select schema_version, service_score, facts_version from public.conversation_insight_runs where id = $1", [leituraAntiga.id])).rows[0];
const analiseDepois = (await db.query("select schema_version, service_score, facts_version, result from public.conversation_analyses where id = $1", [analiseAntiga])).rows[0];
confere("leitura antiga não é recalculada [29]", leituraDepois.schema_version === leituraAntiga.schema_version && leituraDepois.service_score === null && leituraDepois.facts_version === leituraAntiga.facts_version);
confere("análise antiga não é recalculada [29]", analiseDepois.schema_version === 0 && analiseDepois.service_score === null && analiseDepois.facts_version === 1 && analiseDepois.result.resumo === "antiga");

// 3. O motor com o esquema publicado.
const nota = async (classificacao, fatos = {}) =>
  (await db.query("select private.pontuar($1::jsonb, $2::jsonb, $3::jsonb) as p", [JSON.stringify(v1.definition), JSON.stringify(fatos), JSON.stringify(classificacao)])).rows[0].p;
const dim = (p, chave) => p.atendimento.dimensions.find((d) => d.key === chave);
const tudoBom = {
  att_discovery: { a: "bom", p: 0.9 }, att_conversation_coherence: { a: "bom", p: 0.9 },
  att_communication_adaptation: { a: "bom", p: 0.9 }, att_qualification: { a: "bom", p: 0.9 },
  att_playbook_adherence: { a: "bom", p: 0.9 }, att_next_step: { a: "avancou_com_acao", p: 0.9 },
  att_follow_up: { a: "done", p: 0.9 },
};
let p = await nota(tudoBom);
confere("tudo bom: 100, com 90 de peso avaliado (responsividade fora)", p.atendimento.score === 100 && p.atendimento.evaluatedWeight === 90 && p.atendimento.maxWeight === 100, JSON.stringify([p.atendimento.score, p.atendimento.evaluatedWeight]));
p = await nota({ ...tudoBom, att_discovery: { a: "nao_avaliado", p: 0.9 }, att_qualification: { a: "nao_avaliado", p: 0.9 } });
confere("nao_avaliado sai do denominador, não vira zero [26]", p.atendimento.score === 100 && p.atendimento.evaluatedWeight === 65 && dim(p, "discovery").score === null, JSON.stringify(p.atendimento.evaluatedWeight));
p = await nota({ att_discovery: { a: "bom", p: 0.9 }, att_conversation_coherence: { a: "atencao", p: 0.9 }, att_next_step: { a: "avancou_com_acao", p: 0.9 }, att_communication_adaptation: { a: "ruim", p: 0.9 } });
confere("nota parcial normaliza: (15 + 9 + 15 + 2) / 55 = 75 [28]", p.atendimento.score === 75 && p.atendimento.points === 41 && dim(p, "communication_adaptation").points === 2, JSON.stringify([p.atendimento.score, p.atendimento.points]));
p = await nota({ att_discovery: { a: "critico", p: 0.9 } });
confere("crítico vale 0", p.atendimento.score === 0 && dim(p, "discovery").points === 0);
p = await nota({ att_discovery: { a: "ruim", p: 0.55 } });
confere("confiança abaixo de 0,6 (a do portal) não conta", p.atendimento.score === null && p.atendimento.evaluatedWeight === 0);
p = await nota({ att_discovery: { a: "uma_opcao_que_nao_existe", p: 0.9 } });
confere("estado desconhecido não conta", p.atendimento.score === null);

// 3b. Critérios booleanos (o motor de 20261003100000) dão o mesmo que antes.
const pontuarCom = async (def, fatos, cls) => (await db.query("select private.pontuar($1::jsonb, $2::jsonb, $3::jsonb) as p", [JSON.stringify(def), JSON.stringify(fatos), JSON.stringify(cls)])).rows[0].p;
let b = await pontuarCom({ scores: { lead: { dimensions: [{ key: "d", criteria: [
  { key: "a", when: { source: "fact", path: "messages.total", op: "gte", value: 2 } },
  { key: "b", when: { source: "classification", path: "temperatura", op: "in", value: ["morno", "quente"] } },
  { key: "c", weight: 2, when: { source: "fact", path: "waitingReply", op: "false" } },
  { key: "x", when: { source: "fact", path: "naoExiste", op: "eq", value: 1 } },
] }] } } }, { messages: { total: 3 }, waitingReply: true }, { temperatura: { a: "morno", p: 0.8 } });
confere("motor anterior: o exemplo de 20261003100000 continua 50", b.lead.score === 50 && b.lead.dimensions[0].criteria[3].result === "unknown");
b = await pontuarCom({ scores: { lead: { dimensions: [
  { key: "a", weight: 3, criteria: [{ key: "x", when: { source: "fact", path: "v", op: "true" } }] },
  { key: "b", weight: 1, criteria: [{ key: "y", when: { source: "fact", path: "v", op: "false" } }] },
  { key: "c", weight: 5, criteria: [{ key: "z", when: { source: "fact", path: "nada", op: "eq", value: 1 } }] },
] } } }, { v: true }, {});
confere("motor anterior: média das dimensões pelo peso continua 75", b.lead.score === 75 && b.lead.dimensions[2].score === null);
b = await pontuarCom({ scores: { lead: { dimensions: [{ key: "d", fromPlaybook: true, criteria: [
  { key: "a", unknownAs: "missed", when: { source: "fact", path: "nada", op: "eq", value: 1 } }] }] } } },
  {}, { pb_icp: { a: "sim", p: 0.9 }, pb_ads: { a: "nao", p: 0.8 } });
confere("motor anterior: unknownAs e critérios do playbook (1 de 3 = 33)", b.lead.score === 33 && b.lead.dimensions[0].criteria.length === 3);

// 4. Próximo passo [19-22].
for (const [estado, pontos, rotulo] of [
  ["avancou_com_acao", 15, "reunião/ação definida é positivo [19]"],
  ["aguardando_acao_do_lead", 15, "aguardando o lead não é punido [20]"],
  ["desqualificado_com_motivo", 15, "desqualificado com motivo é encerramento válido [21]"],
  ["ficou_em_aberto", 0, "havia condição e ficou no limbo: crítico [22]"],
]) {
  p = await nota({ att_next_step: { a: estado, p: 0.9 } });
  confere(`próximo passo: ${rotulo}`, dim(p, "next_step").points === pontos, JSON.stringify(dim(p, "next_step").points));
}
p = await nota({ att_next_step: { a: "ainda_em_descoberta", p: 0.9 } });
confere("próximo passo: ainda em descoberta não é avaliado", dim(p, "next_step").score === null);

// 5. Follow-up [23-25].
p = await nota({ att_follow_up: { a: "not_due", p: 0.9 } });
confere("follow-up combinado, prazo futuro: sem perda, não avaliado [23]", dim(p, "follow_up").score === null && p.atendimento.score === null);
p = await nota({ att_follow_up: { a: "done", p: 0.9 } });
confere("follow-up feito: positivo [24]", dim(p, "follow_up").points === 10);
p = await nota({ att_follow_up: { a: "overdue", p: 0.9 } });
confere("follow-up vencido e não feito: negativo (ruim, 2 de 10) [25]", dim(p, "follow_up").points === 2);
p = await nota({ att_follow_up: { a: "not_applicable", p: 0.9 } });
confere("sem follow-up aplicável: não avaliado", dim(p, "follow_up").score === null);

// 6. Objeções: detalhe sem peso dentro de playbook.
p = await nota({ att_playbook_adherence: { a: "bom", p: 0.9 }, att_objection_handling: { a: "critico", p: 0.9 } });
confere("objeções entram como detalhe (peso 0) do critério de playbook", dim(p, "playbook_adherence").points === 15
  && dim(p, "playbook_adherence").criteria.find((c) => c.key === "objection_handling").value === "critico");

// 7. Os fatos, versão 2.
const fatos = (await db.query("select private.fatos_da_conversa($1, $2, $3) as f", [MAJOR.id, CONEXAO, T])).rows[0].f;
confere("fatos versão 2", fatos.version === 2);
confere("relógio humano começa no handoff; IA e bot não contam: 20 min [1]",
  fatos.humanClock.source === "handoff_request" && fatos.humanClock.firstHumanResponseSeconds === 1200 && fatos.humanClock.waitingHuman === false,
  JSON.stringify(fatos.humanClock));
confere("primeira resposta geral continua sendo a da IA (fato à parte)", fatos.firstResponseSeconds === 60, String(fatos.firstResponseSeconds));
confere("sem régua de tempo: fatos existem, responsividade não avaliada [3][4]",
  fatos.humanClock.slaStatus === null && fatos.responseRules.first_human_response_minutes === null && fatos.responseRules.business_hours === null);
p = await nota(tudoBom, fatos);
confere("com os fatos reais, a responsividade continua fora da conta [4]", dim(p, "responsiveness").score === null && p.atendimento.evaluatedWeight === 90);
confere("estilo de comunicação: texto e áudio de cada lado, tamanho médio",
  fatos.communication.contactText === 1 && fatos.communication.contactAudio === 1 && fatos.communication.companyText === 3 && fatos.communication.companyAudio === 1
    && fatos.communication.contactAvgChars === 13,
  JSON.stringify(fatos.communication));
const semHandoff = (await db.query("select private.fatos_da_conversa($1, $2, $3, now() - interval '4 hours 55 minutes') as f", [MAJOR.id, CONEXAO, T])).rows[0].f;
confere("antes do handoff não há relógio humano", semHandoff.humanClock.startedAt === null && semHandoff.humanClock.waitingHuman === false);

// 8. Playbook efetivo [16][17].
let pj = (await db.query("select private.playbook_para_o_jev($1) as p", [MAJOR.id])).rows[0].p;
confere("sem playbook da empresa, o Jev recebe o Base Major (12 regras)", pj.origem === "base_major" && pj.version === 0 && pj.regras.length === 12);
confere("o Base Major não cria regra de preço [17]", !JSON.stringify(pj).match(/R\$|valor fechado|faixa de/i) && pj.oferta.length === 0 && pj.regras[10].startsWith("Não criar regra específica de preço"));
await como(MAJOR.dono, "select public.playbook_save($1, $2::jsonb, true)", [MAJOR.id, JSON.stringify({
  oferta: [{ nome: "Site", preco: "Faixa de R$ 3 a 6 mil; valor fechado só no diagnóstico" }],
  objecoes: [{ chave: "preco", nome: "Preço", resposta: "Passar a faixa e levar ao diagnóstico" }],
  criterios: [{ chave: "perguntou_ads", pergunta: "Perguntou quanto investe em anúncios?", sim: "Perguntou" }],
})]);
pj = (await db.query("select private.playbook_para_o_jev($1) as p", [MAJOR.id])).rows[0].p;
confere("com playbook publicado, o da empresa prevalece [16]", pj.origem === "empresa" && pj.version === 1 && pj.regras.length === 0
  && pj.oferta[0].preco.includes("valor fechado só no diagnóstico") && pj.objecoes[0].resposta.includes("faixa"));
const outra = (await db.query("select private.playbook_para_o_jev($1) as p", [OUTRA.id])).rows[0].p;
confere("outra empresa continua no Base Major", outra.origem === "base_major");

// 9. A leitura do Jev nova ganha a nota pelo gatilho.
await db.query("update public.conversation_insight_runs set is_latest = false");
const nova = (await db.query(`insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
  values ($1, $2, $3, now(), 'ok', $4, true) returning service_score, lead_score, schema_version, facts_version`, [MAJOR.id, CONEXAO, T, JSON.stringify(tudoBom)])).rows[0];
confere("leitura nova: Atendimento Score 100, Lead nulo, esquema 1, fatos 2", nova.service_score === 100 && nova.lead_score === null && nova.schema_version === 1 && nova.facts_version === 2, JSON.stringify(nova));

// 10. O pedido de análise e a classificação na hora.
await db.query("update public.conversation_insight_runs set summary = $1 where is_latest", [JSON.stringify({ att_discovery: { a: "bom", p: 0.9 } })]);
const pedido = (await como(MAJOR.dono, "select public.conversation_analysis_request($1, $2, $3, 'atendimento') as r", [MAJOR.id, CONEXAO, T])).rows[0].r;
const carga = (await db.query("select private_payload from public.connection_runtime_commands where command_type = 'conversation_analyze' order by created_at desc limit 1")).rows[0].private_payload;
confere("a carga leva o playbook efetivo, os fatos v2 e a nota da leitura em vigor",
  carga.playbook.origem === "empresa" && carga.facts.version === 2 && carga.scores.atendimento.score === 100 && carga.messages[0].id === "m1",
  JSON.stringify(carga.scores.atendimento.score));
const classificar = (payload, quem = ROBO) => como(quem, "select public.nucleo_analysis_classify($1::jsonb) as r", [JSON.stringify(payload)], quem === ROBO ? { robo } : {});
const respostas = [
  { question: "att_discovery", answer: "bom", probability: 0.9 },
  { question: "att_conversation_coherence", answer: "atencao", probability: 0.8 },
  { question: "att_next_step", answer: "ficou_em_aberto", probability: 0.85 },
  { question: "att_follow_up", answer: "overdue", probability: 0.9 },
];
let erro = await erroDe(() => classificar({ analysisId: pedido.analysisId, answers: respostas }, MAJOR.dono));
confere("só o robô grava a classificação", erro.includes("robot credential"), erro);
erro = await erroDe(() => classificar({ analysisId: pedido.analysisId, answers: [{ question: "Att", answer: "x" }] }));
confere("resposta fora do formato é recusada", erro.includes("invalid"), erro);
const classificada = (await classificar({ analysisId: pedido.analysisId, answers: respostas })).rows[0].r;
// (15 + 9 + 0 + 2) / (15 + 15 + 15 + 10) = 26 / 55 = 47
confere("classificação na hora: a nota é recalculada no banco (47) e volta pronta", classificada.recorded === true && classificada.serviceScore === 47 && classificada.leadScore === null,
  JSON.stringify([classificada.serviceScore, classificada.scores?.atendimento?.points]));
const gravada = (await db.query("select classification, service_score, lead_score, schema_version from public.conversation_analyses where id = $1", [pedido.analysisId])).rows[0];
confere("a análise guarda a classificação usada e a nota", gravada.classification.att_next_step.a === "ficou_em_aberto" && gravada.service_score === 47 && gravada.lead_score === null && gravada.schema_version === 1);

// 11. O relatório agregado.
const diagnostico = {
  schema_version: "analysis_report.v1",
  formatVersion: 3,
  summary: "Boa descoberta, mas a conversa ficou sem próximo passo.",
  main_bottleneck: { criterion: "next_step", title: "Sem próximo passo", explanation: "Havia condição de avançar.", evidence_message_ids: ["m6"] },
  why_this_score: [{ criterion: "next_step", explanation: "Terminou sem ação definida.", evidence_message_ids: ["m6"] }],
  what_to_do_now: [{ priority: "alta", action_type: "create_follow_up", title: "Retomar", instruction: "Propor data", reason: "Limbo", due_at: null, evidence_message_ids: [] }],
  suggested_message: { applicable: true, text: "Podemos marcar o diagnóstico para quinta?" },
  red_flags: [{ code: "conversation_left_open", severity: "alta", criterion: "next_step", reason: "Limbo", evidence_message_ids: ["m6"] }],
};
await como(ROBO, "select public.nucleo_analysis_record($1::jsonb)", [JSON.stringify({ analysisId: pedido.analysisId, status: "done", result: diagnostico })], { robo });
const st = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, pedido.analysisId])).rows[0].r;
const rel = st.report;
confere("andamento devolve o que já devolvia e mais as notas", st.status === "done" && st.result.summary.startsWith("Boa") && st.serviceScore === 47 && st.leadScore === null && st.schemaVersion === 1);
confere("relatório analysis.v1: nota, peso avaliado e rótulo parcial",
  rel.schema_version === "analysis.v1" && rel.lead_score === null && rel.atendimento_score.score === 47 && rel.atendimento_score.evaluated_weight === 55
    && rel.atendimento_score.label === "47/100 até aqui",
  JSON.stringify(rel.atendimento_score?.label));
const crit = (k) => rel.atendimento_score.criteria.find((c) => c.key === k);
confere("critérios com estado, fator e pontos; não avaliado nunca é zero",
  crit("next_step").status === "critico" && crit("next_step").points_awarded === 0 && crit("next_step").state === "ficou_em_aberto"
    && crit("conversation_coherence").status === "atencao" && crit("conversation_coherence").points_awarded === 9
    && crit("follow_up").status === "ruim" && crit("qualification").status === "nao_avaliado" && crit("qualification").points_awarded === null);
confere("o motivo do critério vem do diagnóstico, com a evidência", crit("next_step").reason === "Terminou sem ação definida." && crit("next_step").evidence_message_ids[0] === "m6");
const codigos = rel.red_flags.map((f) => f.code);
confere("alertas: o do Claude e o de regra, sem repetir", codigos.filter((c) => c === "conversation_left_open").length === 1 && codigos.includes("overdue_follow_up"),
  JSON.stringify(codigos));
const semAlerta = await nota({ att_discovery: { a: "bom", p: 0.9 }, att_conversation_coherence: { a: "atencao", p: 0.8 }, att_next_step: { a: "ficou_em_aberto", p: 0.85 }, att_follow_up: { a: "overdue", p: 0.9 } });
confere("alerta não desconta de novo: a nota é a mesma do motor [27]", semAlerta.atendimento.score === rel.atendimento_score.score);
confere("diagnóstico no relatório", rel.diagnosis.what_to_do_now[0].action_type === "create_follow_up" && rel.diagnosis.suggested_message.text.includes("quinta"));
const antigo = (await como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, analiseAntiga])).rows[0].r;
confere("análise antiga: relatório sem diagnóstico v1 e sem nota, o resultado antigo intacto",
  antigo.report.diagnosis === null && antigo.report.atendimento_score === null && antigo.report.atendimento_score === null && antigo.result.resumo === "antiga");
erro = await erroDe(() => classificar({ analysisId: pedido.analysisId, answers: respostas }));
confere("análise pronta não aceita reclassificação", erro === "");
const depois = (await db.query("select service_score from public.conversation_analyses where id = $1", [pedido.analysisId])).rows[0];
confere("e a nota dela não muda", depois.service_score === 47);

// 12. Esquema próprio de uma empresa vale para ela e não muda o histórico [29].
await db.query("insert into public.analysis_schemas (organization_id, version, status, definition, published_at) values ($1, 2, 'published', $2, now())",
  [MAJOR.id, JSON.stringify({ key: "teste.v2", scores: { atendimento: { dimensions: [{ key: "x", weight: 10, criteria: [{ key: "x", when: { source: "fact", path: "isLead", op: "false" } }] }] } } })]);
const naoMudou = (await db.query("select service_score, schema_version from public.conversation_analyses where id = $1", [pedido.analysisId])).rows[0];
confere("versão nova não altera a nota gravada [29]", naoMudou.service_score === 47 && naoMudou.schema_version === 1);

// 13. Reaplicar aborta.
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", reaplicar.includes("ja foi aplicada"), reaplicar);
await db.exec("rollback");

// 14. O rollback volta as funções, aposenta o esquema e mantém o histórico.
const notaAntes = (await db.query("select service_score from public.conversation_analyses where id = $1", [pedido.analysisId])).rows[0].service_score;
await db.exec(ler("scripts/sql/rollback-20261004100000-atendimento-score-v1.sql"));
const v1Depois = (await db.query("select status from public.analysis_schemas where definition ->> 'key' = 'atendimento.v1'")).rows[0];
confere("rollback: atendimento.v1 aposentado, não apagado", v1Depois.status === "retired");
const fatosRollback = (await db.query("select private.fatos_da_conversa($1, $2, $3) as f", [MAJOR.id, CONEXAO, T])).rows[0].f;
confere("rollback: fatos voltam à versão 1", fatosRollback.version === 1 && !("humanClock" in fatosRollback));
const pjRollback = (await db.query("select private.playbook_para_o_jev($1) as p", [OUTRA.id])).rows[0].p;
confere("rollback: sem playbook da empresa, o Jev volta a receber nulo", pjRollback === null);
const notaDepois = (await db.query("select service_score from public.conversation_analyses where id = $1", [pedido.analysisId])).rows[0].service_score;
confere("rollback: nota gravada fica", notaDepois === notaAntes);
await db.query("update public.conversation_analyses set status = 'failed' where status in ('pending', 'running')");
erro = await erroDe(() => como(MAJOR.dono, "select public.conversation_analysis_request($1, $2, $3, 'comercial')", [MAJOR.id, CONEXAO, T]));
const stRollback = await erroDe(() => como(MAJOR.dono, "select public.conversation_analysis_status($1, $2)", [MAJOR.id, pedido.analysisId]));
confere("rollback: pedido e andamento funcionam como antes", erro === "" && stRollback === "", erro || stRollback);
await db.exec("delete from public.analysis_schemas where definition ->> 'key' = 'atendimento.v1'");
const reaplicada = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("depois do rollback, a migration aplica de novo", reaplicada === "", reaplicada);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
