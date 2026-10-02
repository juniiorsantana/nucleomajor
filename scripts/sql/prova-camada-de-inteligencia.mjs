// Prova comportamental da migration 20261003100000 (camada de inteligência)
// num Postgres embutido (PGlite), com o harness e TODAS as migrations reais
// do repositório, em ordem. Nada aqui toca produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-camada-de-inteligencia.mjs . && node prova-camada-de-inteligencia.mjs <repo>
//
// O que ela responde:
//   * os fatos de uma conversa conhecida batem, um a um (tempos, turnos,
//     retomadas, passagem IA -> equipe, quem está esperando, CRM);
//   * o motor de regras calcula as notas pelo esquema publicado (o da empresa
//     vale no lugar do padrão), e erro no motor não impede a leitura;
//   * o pedido de análise leva fatos, notas e o message_id de cada mensagem,
//     guarda a leitura usada, e não apaga mais o histórico;
//   * a visão dos números só mostra a própria empresa.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-camada-de-inteligencia.mjs <repo>");
const MIGRATION = "20261003100000_camada_de_inteligencia.sql";
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

async function como(sub, sql, params = [], { role = "authenticated" } = {}) {
  return db.transaction(async (tx) => {
    const claims = sub ? { sub, role: "authenticated" } : { role: "anon" };
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [sub || "", JSON.stringify(claims)]);
    if (role) await tx.exec(`set local role ${sub ? role : "anon"}`);
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
const CONEXAO_OUTRA = "cccccccc-0000-4000-8000-000000000002";
const MEMBRO = "eeeeeeee-0000-4000-8000-000000000001";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'major'), ($3, $4, 'outra')", [CONEXAO, MAJOR.id, CONEXAO_OUTRA, OUTRA.id]);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'membro@exemplo.invalido', now())", [MEMBRO]);
await db.query("insert into public.profiles (id, full_name) values ($1, 'Membro') on conflict (id) do nothing", [MEMBRO]);
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [MAJOR.id, MEMBRO]);

const T = "5565988887777";
const SEM_CRM = "5565911112222";
await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at, owner, attendant_id)
  values ($1, $2, $3, 'direto', now(), 'humano', $4), ($1, $2, $5, 'direto', now(), 'ia', null)`, [CONEXAO, MAJOR.id, T, MEMBRO, SEM_CRM]);
await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at)
  values ($1, $2, $3, 'direto', now())`, [CONEXAO_OUTRA, OUTRA.id, T]);

// A conversa conhecida (minutos desde o início, que foi há 40 horas):
//   0   contato  oi
//   2   contato  quanto custa?             (mesmo turno)
//   5   IA       resposta                  -> 1ª resposta 300 s
//   6   bot      lembrete                  (não é resposta)
//   60  contato  e o prazo?
//   70  equipe   resposta (Membro)         -> 600 s; IA -> equipe
//   1800 equipe  retomada                  (anterior da empresa, 28h50 depois)
//   1860 contato áudio                     -> esperando resposta
const INICIO = "now() - interval '40 hours'";
const roteiro = [
  [0, false, "", "", "oi"],
  [2, false, "", "", "quanto custa?"],
  [5, true, "ia", "", "Depende do escopo."],
  [6, true, "bot", "", "Lembrete"],
  [60, false, "", "", "e o prazo?"],
  [70, true, "humano", "", "Em 15 dias."],
  [1800, true, "humano", "", "Conseguiu ver?"],
  [1860, false, "", "ptt", ""],
];
for (const [i, [min, deMim, autor, midia, texto]] of roteiro.entries()) {
  await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind, author_id, media_type)
    values ($1, $2, $3, $4, $5, ${INICIO} + interval '${min} minutes', $6, $7, $8, $9)`,
    [CONEXAO, MAJOR.id, T, `m${i + 1}`, texto, deMim, autor, autor === "humano" ? MEMBRO : null, midia]);
}
await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me)
  values ($1, $2, $3, 'x1', 'oi', now() - interval '1 hour', false)`, [CONEXAO, MAJOR.id, SEM_CRM]);
await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me)
  values ($1, $2, $3, 'o1', 'oi', now() - interval '1 hour', false)`, [CONEXAO_OUTRA, OUTRA.id, T]);

// O CRM do contato: lead, negócio aberto, tarefa atrasada, compromisso marcado.
const contato = (await db.query("insert into public.contacts (organization_id, name, phone, lead_at) values ($1, 'Lead', '(65) 9 8888-7777', now()) returning id", [MAJOR.id])).rows[0].id;
const etapa = (await db.query("select id, name from public.stages where organization_id = $1 order by position limit 1 offset 1", [MAJOR.id])).rows[0];
await db.query("insert into public.deals (organization_id, contact_id, stage_id, title, value) values ($1, $2, $3, 'Site', 1500)", [MAJOR.id, contato, etapa.id]);
await db.query("insert into public.tasks (organization_id, contact_id, title, due_at) values ($1, $2, 'Ligar', now() - interval '1 day')", [MAJOR.id, contato]);
const categoria = (await db.query("select id from public.calendar_categories where organization_id = $1 limit 1", [MAJOR.id])).rows[0]?.id
  ?? (await db.query("insert into public.calendar_categories (organization_id, name) values ($1, 'Reunião') returning id", [MAJOR.id])).rows[0].id;
await db.query(`insert into public.calendar_events (organization_id, owner_id, title, starts_at, ends_at, contact_id, category_id)
  values ($1, $2, 'Diagnóstico', now() + interval '2 days', now() + interval '2 days 30 minutes', $3, $4)`, [MAJOR.id, MAJOR.dono, contato, categoria]);

// Uma leitura em vigor de antes da migration: tem de ganhar fatos na hora.
await db.query(`insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
  values ($1, $2, $3, now(), 'ok', '{"temperatura": {"a": "morno", "p": 0.7}}', true)`, [MAJOR.id, CONEXAO, T]);
await db.query(`insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
  values ($1, $2, $3, now(), 'ok', '{}', true)`, [OUTRA.id, CONEXAO_OUTRA, T]);

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna (motor dá 50 no exemplo)");

// 1. Os fatos, um a um.
const f = (await db.query("select facts from public.conversation_insight_runs where connection_id = $1 and contact_phone = $2 and is_latest", [CONEXAO, T])).rows[0].facts;
confere("a leitura antiga ganhou fatos na migration", f.version === 1, JSON.stringify(f).slice(0, 120));
confere("mensagens por lado", f.messages.total === 8 && f.messages.contact === 4 && f.messages.ai === 1 && f.messages.team === 2 && f.messages.bot === 1 && f.messages.contactAudio === 1, JSON.stringify(f.messages));
confere("primeira resposta 300 s (o turno começa na 1ª do contato)", f.firstResponseSeconds === 300, String(f.firstResponseSeconds));
confere("respostas: 2, mediana 300, máxima 600 (bot não é resposta)", f.responses.count === 2 && f.responses.medianSeconds === 300 && f.responses.maxSeconds === 600, JSON.stringify(f.responses));
confere("uma retomada depois de 24 h", f.followUps === 1, String(f.followUps));
confere("passou da IA para a equipe uma vez", f.handoff.aiToTeam === 1 && f.handoff.teamToAi === 0 && f.handoff.firstTeamAt !== null, JSON.stringify(f.handoff));
confere("contato começou, falou por último e está esperando", f.startedBy === "contact" && f.lastSpeaker === "contact" && f.waitingReply === true && f.hoursWaiting > 8 && f.hoursWaiting < 10, `${f.lastSpeaker} ${f.hoursWaiting}`);
confere("quem atendeu: dono humano, atendente e autor da equipe", f.owner === "humano" && f.attendantId === MEMBRO && f.teamAuthors.length === 1 && f.teamAuthors[0] === MEMBRO);
confere("CRM: lead, negócio aberto na etapa, tarefa atrasada, compromisso marcado",
  f.contactId === contato && f.isLead === true && f.deal?.status === "aberto" && f.deal?.stage === etapa.name && Number(f.deal?.value) === 1500
    && f.tasks.open === 1 && f.tasks.overdue === 1 && f.meetings.scheduled === 1 && f.meetings.next !== null,
  JSON.stringify({ deal: f.deal, tasks: f.tasks, meetings: f.meetings }));
const sem = (await db.query("select private.fatos_da_conversa($1, $2, $3) as f", [MAJOR.id, CONEXAO, SEM_CRM])).rows[0].f;
confere("sem contato no CRM: fatos de mensagem, CRM vazio", sem.messages.total === 1 && sem.contactId === null && sem.deal === null && sem.tasks.open === 0 && sem.firstResponseSeconds === null && sem.waitingReply === true);
const ninguem = (await db.query("select private.fatos_da_conversa($1, $2, '5500000000000') as f", [MAJOR.id, CONEXAO])).rows[0].f;
confere("conversa que não existe: vazio", JSON.stringify(ninguem) === "{}");
const atras = (await db.query("select private.fatos_da_conversa($1, $2, $3, now() - interval '39 hours 30 minutes') as f", [MAJOR.id, CONEXAO, T])).rows[0].f;
confere("fatos até uma data: só o que aconteceu até ali", atras.messages.total === 4 && atras.lastSpeaker === "bot", `${atras.messages.total} ${atras.lastSpeaker}`);

// 2. Sem esquema publicado, notas nulas.
let r = (await db.query("select lead_score, service_score, schema_version, scores from public.conversation_insight_runs where connection_id = $1 and contact_phone = $2 and is_latest", [CONEXAO, T])).rows[0];
confere("sem esquema: notas nulas, versão 0", r.lead_score === null && r.service_score === null && r.schema_version === 0 && JSON.stringify(r.scores) === "{}");

// 3. O motor, nos detalhes.
const pontuar = async (def, fatos, cls) => (await db.query("select private.pontuar($1::jsonb, $2::jsonb, $3::jsonb) as p", [JSON.stringify(def), JSON.stringify(fatos), JSON.stringify(cls)])).rows[0].p;
const dim = (criteria, extra = {}) => ({ scores: { lead: { dimensions: [{ key: "d", criteria, ...extra }] } } });
let p = await pontuar(dim([{ key: "a", when: { source: "classification", path: "temperatura", op: "eq", value: "quente", minConfidence: 0.9 } }]), {}, { temperatura: { a: "quente", p: 0.6 } });
confere("confiança abaixo do mínimo não conta", p.lead.score === null && p.lead.dimensions[0].criteria[0].result === "unknown", JSON.stringify(p));
p = await pontuar(dim([{ key: "a", unknownAs: "missed", when: { source: "fact", path: "nada", op: "eq", value: 1 } }, { key: "b", when: { source: "fact", path: "n", op: "lt", value: 10 } }]), { n: 5 }, {});
confere("unknownAs = missed conta como erro", p.lead.score === 50, JSON.stringify(p.lead));
p = await pontuar(dim([], { fromPlaybook: true }), {}, { pb_icp: { a: "sim", p: 0.9 }, pb_ads: { a: "nao", p: 0.8 }, temperatura: { a: "morno" } });
confere("critérios do playbook entram sozinhos (pb_*)", p.lead.score === 50 && p.lead.dimensions[0].criteria.length === 2, JSON.stringify(p.lead));
p = await pontuar({ scores: { lead: { dimensions: [
  { key: "a", weight: 3, criteria: [{ key: "x", when: { source: "fact", path: "v", op: "true" } }] },
  { key: "b", weight: 1, criteria: [{ key: "y", when: { source: "fact", path: "v", op: "false" } }] },
  { key: "c", weight: 5, criteria: [{ key: "z", when: { source: "fact", path: "nada", op: "eq", value: 1 } }] },
] } } }, { v: true }, {});
confere("família = média das dimensões pelo peso; dimensão sem dado fica fora", p.lead.score === 75 && p.lead.dimensions[2].score === null, JSON.stringify(p.lead));
p = await pontuar(dim([{ key: "a", when: { source: "fact", path: "s", op: "nin", value: ["x", "y"] } }]), { s: "z" }, {});
confere("nin", p.lead.score === 100);

// 4. Esquema publicado: a leitura nova ganha notas; o da empresa vence o padrão.
const ESQUEMA = { scores: {
  lead: { dimensions: [{ key: "temperatura", criteria: [{ key: "quente", when: { source: "classification", path: "temperatura", op: "in", value: ["morno", "quente"] } }] }] },
  atendimento: { dimensions: [{ key: "agilidade", criteria: [
    { key: "rapida", when: { source: "fact", path: "firstResponseSeconds", op: "lte", value: 600 } },
    { key: "sem_espera", when: { source: "fact", path: "waitingReply", op: "false" } },
  ] }] },
} };
await db.query("insert into public.analysis_schemas (organization_id, version, status, definition, published_at) values (null, 1, 'published', $1, now())", [JSON.stringify(ESQUEMA)]);
const novaLeitura = async (summary = { temperatura: { a: "morno", p: 0.7 } }) => {
  await db.query("update public.conversation_insight_runs set is_latest = false where connection_id = $1 and contact_phone = $2", [CONEXAO, T]);
  return (await db.query(`insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
    values ($1, $2, $3, now(), 'ok', $4, true) returning lead_score, service_score, schema_version, facts_version, scores`, [MAJOR.id, CONEXAO, T, JSON.stringify(summary)])).rows[0];
};
r = await novaLeitura();
confere("leitura nova: lead 100, atendimento 50, esquema 1", r.lead_score === 100 && r.service_score === 50 && r.schema_version === 1 && r.facts_version === 1, JSON.stringify(r));
await db.query("insert into public.analysis_schemas (organization_id, version, status, definition, published_at) values ($1, 1, 'published', $2, now())",
  [MAJOR.id, JSON.stringify({ scores: { lead: { dimensions: [{ key: "x", criteria: [{ key: "y", when: { source: "fact", path: "isLead", op: "false" } }] }] } } })]);
r = await novaLeitura();
confere("o esquema da empresa vale no lugar do padrão", r.lead_score === 0 && r.service_score === null, JSON.stringify(r));
let erro = await erroDe(() => db.query("insert into public.analysis_schemas (organization_id, version, status, definition, published_at) values ($1, 2, 'published', '{}', now())", [MAJOR.id]));
confere("só um esquema publicado por empresa", /duplicate|unique/i.test(erro), erro);
const falhada = (await db.query(`insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, error_code)
  values ($1, $2, $3, now(), 'failed', 'jev_http_500') returning facts`, [MAJOR.id, CONEXAO, T])).rows[0];
confere("leitura que falhou não calcula fatos", JSON.stringify(falhada.facts) === "{}");

// 5. Erro no motor não impede a leitura.
await db.query("update public.analysis_schemas set definition = $2 where organization_id = $1", [MAJOR.id, JSON.stringify({ scores: { lead: { dimensions: [{ key: "x", weight: "muito", criteria: [{ key: "y", when: { source: "fact", path: "isLead", op: "true" } }] }] } } })]);
erro = await erroDe(() => novaLeitura());
confere("esquema quebrado: a leitura é gravada mesmo assim", erro === "", erro);
await db.query("update public.analysis_schemas set status = 'retired' where organization_id = $1", [MAJOR.id]);

// 6. O pedido de análise.
await como(MAJOR.dono, "select public.playbook_save($1, $2::jsonb, true)", [MAJOR.id, JSON.stringify({ objecoes: [{ chave: "preco", nome: "Preço" }] })]);
r = await novaLeitura({ temperatura: { a: "quente", p: 0.9 } });
const leituraId = (await db.query("select id from public.conversation_insight_runs where connection_id = $1 and contact_phone = $2 and is_latest", [CONEXAO, T])).rows[0].id;
const pedido = (await como(MAJOR.dono, "select public.conversation_analysis_request($1, $2, $3, 'comercial') as r", [MAJOR.id, CONEXAO, T])).rows[0].r;
confere("o pedido continua com o mesmo contrato", pedido.status === "pending" && pedido.reused === false && pedido.credits.used === 1, JSON.stringify(pedido));
const carga = (await db.query("select private_payload from public.connection_runtime_commands where command_type = 'conversation_analyze'")).rows[0].private_payload;
confere("a carga leva o message_id de cada mensagem", carga.messages.length === 8 && carga.messages[0].id === "m1" && carga.messages[7].id === "m8", JSON.stringify(carga.messages[0]));
confere("a carga leva fatos e notas", carga.facts.version === 1 && carga.facts.followUps === 1 && carga.scores.lead.score === 100 && carga.scores.atendimento.score === 50, JSON.stringify(carga.scores));
confere("e o que já levava", carga.reading.temperatura.a === "quente" && carga.playbook?.objecoes?.[0]?.chave === "preco" && carga.hasContact === true);
const a = (await db.query("select facts_version, classification, reading_id, schema_version, playbook_version, lead_score, service_score from public.conversation_analyses where id = $1", [pedido.analysisId])).rows[0];
confere("a análise guarda a leitura usada, as notas e as versões",
  a.facts_version === 1 && a.classification.temperatura.a === "quente" && a.reading_id === leituraId && a.schema_version === 1 && a.playbook_version === 1 && a.lead_score === 100 && a.service_score === 50,
  JSON.stringify(a));

// 7. O histórico fica.
const velha = (await db.query(`insert into public.conversation_analyses (organization_id, connection_id, contact_phone, kind, status, requested_by, requested_at, completed_at, cycle_start, result, facts, lead_score)
  values ($1, $2, $3, 'comercial', 'done', $4, now() - interval '130 days', now() - interval '130 days', now() - interval '140 days', '{"resumo": "velha"}', '{"version": 1}', 40) returning id`, [MAJOR.id, CONEXAO, T, MAJOR.dono])).rows[0].id;
await db.query("update public.conversation_analyses set status = 'failed' where id = $1", [pedido.analysisId]);
await como(MAJOR.dono, "select public.conversation_analysis_request($1, $2, $3, 'atendimento')", [MAJOR.id, CONEXAO, T]);
const v = (await db.query("select status, result, facts, lead_score from public.conversation_analyses where id = $1", [velha])).rows[0];
confere("análise de 130 dias não é apagada; perde o texto, guarda fatos e nota", v && v.status === "expired" && JSON.stringify(v.result) === "{}" && v.facts.version === 1 && v.lead_score === 40, JSON.stringify(v));

// 8. Quem vê.
let n = (await como(MEMBRO, "select count(*)::int as n, min(follow_ups) as f from public.conversation_intelligence")).rows[0];
confere("a equipe vê os números da própria empresa (a conversa com leitura)", n.n === 1 && n.f === 1, JSON.stringify(n));
const linha = (await como(MAJOR.dono, "select * from public.conversation_intelligence where contact_phone = $1", [T])).rows[0];
confere("colunas tipadas na visão", linha.follow_ups === 1 && linha.first_response_seconds === 300 && linha.attendant_id === MEMBRO && linha.deal_status === "aberto" && linha.lead_score === 100 && linha.waiting_reply === true, JSON.stringify(linha).slice(0, 200));
n = (await como(OUTRA.dono, "select count(*)::int as n from public.conversation_intelligence")).rows[0].n;
confere("outra empresa só vê a dela", n === 1, String(n));
erro = await erroDe(() => como(null, "select * from public.conversation_intelligence"));
confere("anônimo não lê a visão", /permission denied/i.test(erro), erro);
n = (await como(OUTRA.dono, "select count(*)::int as n from public.analysis_schemas")).rows[0].n;
confere("esquema da Major não aparece para outra empresa (só o padrão)", n === 1, String(n));
erro = await erroDe(() => como(MAJOR.dono, "insert into public.analysis_schemas (version, definition) values (9, '{}')"));
confere("ninguém escreve esquema direto", /permission denied/i.test(erro), erro);
erro = await erroDe(() => como(MAJOR.dono, "select private.fatos_da_conversa($1, $2, $3)", [MAJOR.id, CONEXAO, T]));
confere("fatos não são chamados de fora", /permission denied/i.test(erro), erro);

// 9. Reaplicar aborta.
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", reaplicar.includes("ja foi aplicada"), reaplicar);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
