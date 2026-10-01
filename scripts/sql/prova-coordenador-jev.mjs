// Prova comportamental da migration 20260930100000 (o coordenador lê as
// conversas) num Postgres embutido (PGlite), com o harness e TODAS as
// migrations reais do repositório, em ordem. Nada aqui toca produção.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-coordenador-jev.mjs . && node prova-coordenador-jev.mjs <repo>
//
// O que esta prova responde, e que a leitura do SQL não responde:
//
//   * com a função desligada, o robô não recebe conversa nenhuma e não grava;
//   * só o robô da conexão chama as RPCs; membro, anônimo e robô de outra
//     empresa são recusados;
//   * a seleção pega só conversa direta, quieta, recente, com mensagem do
//     contato, não lida ainda e sem falha na última hora;
//   * as mensagens vêm em ordem, só as últimas 80, cortadas em 1500 caracteres;
//   * gravar uma leitura `ok` aposenta a anterior (uma leitura em vigor por
//     conversa) e grava as respostas; mensagem nova pede leitura de novo;
//   * o membro da empresa lê as leituras, o de outra empresa não, e ninguém
//     escreve direto nas tabelas;
//   * leitura com mais de 180 dias é podada.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-coordenador-jev.mjs <repo>");
const MIGRATION = "20260930100000_o_coordenador_le_as_conversas.sql";
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

// Executa como um usuário. `robo` = { org, conexao } monta o JWT do robô.
async function como(sub, sql, params = [], { role = "authenticated", robo = null } = {}) {
  return db.transaction(async (tx) => {
    const claims = sub
      ? {
          sub,
          role: "authenticated",
          ...(robo
            ? { app_metadata: { is_robot: "true", organization_id: robo.org, connection_id: robo.conexao } }
            : {}),
        }
      : { role: "anon" };
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [sub || "", JSON.stringify(claims)],
    );
    if (role) await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

let sequencia = 0;
async function empresa(nome) {
  sequencia += 1;
  const dono = `bbbbbbbb-0000-4000-8000-00000000000${sequencia}`;
  const email = `dono${sequencia}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [dono, email]);
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, 'full', 7)", [email])).rows[0].access_code;
  const id = (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
  return { id, dono };
}

const MAJOR = await empresa("Major");
const OUTRA = await empresa("Outra");
const CONEXAO_MAJOR = "cccccccc-0000-4000-8000-000000000001";
const CONEXAO_OUTRA = "cccccccc-0000-4000-8000-000000000002";
const ROBO_MAJOR = "dddddddd-0000-4000-8000-000000000001";
const ROBO_OUTRA = "dddddddd-0000-4000-8000-000000000002";
for (const [conexao, org, robo, nome] of [
  [CONEXAO_MAJOR, MAJOR.id, ROBO_MAJOR, "major"],
  [CONEXAO_OUTRA, OUTRA.id, ROBO_OUTRA, "outra"],
]) {
  await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, $3)", [conexao, org, nome]);
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [robo, `robo-${nome}@exemplo.invalido`]);
  await db.query(
    "insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)",
    [conexao, org, robo],
  );
}
const roboMajor = { org: MAJOR.id, conexao: CONEXAO_MAJOR };
const roboOutra = { org: OUTRA.id, conexao: CONEXAO_OUTRA };

// As conversas da Major, uma por situação.
const T = {
  pronta: "5565900000001", // quieta há 2 h, contato falou: pede leitura
  agora: "5565900000002", // última mensagem há 10 min: ainda conversando
  grupo: "120363000000000001", // grupo: fica de fora
  soEmpresa: "5565900000003", // só a empresa escreveu
  velha: "5565900000004", // última mensagem há 10 dias
  falhou: "5565900000005", // falhou há pouco
};
async function conversa(conexao, org, telefone, ultima, { tipo = "direto" } = {}) {
  await db.query(
    `insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at)
     values ($1, $2, $3, $4, ${ultima})`,
    [conexao, org, telefone, tipo],
  );
}
async function mensagem(conexao, org, telefone, id, quando, { deMim = false, texto = "oi", autor = "" } = {}) {
  await db.query(
    `insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind)
     values ($1, $2, $3, $4, $5, ${quando}, $6, $7)`,
    [conexao, org, telefone, id, texto, deMim, autor],
  );
}

await conversa(CONEXAO_MAJOR, MAJOR.id, T.pronta, "now() - interval '2 hours'");
// 100 mensagens: a mais nova é a última da conversa; a 100ª tem 3000 caracteres.
for (let i = 1; i <= 100; i++) {
  const minutos = 2 * 60 + (100 - i);
  await mensagem(CONEXAO_MAJOR, MAJOR.id, T.pronta, `p${String(i).padStart(3, "0")}`, `now() - interval '${minutos} minutes'`, {
    deMim: i % 2 === 0,
    texto: i === 100 ? "x".repeat(3000) : `mensagem ${i}`,
    autor: i % 2 === 0 ? "ia" : "contato",
  });
}
await conversa(CONEXAO_MAJOR, MAJOR.id, T.agora, "now() - interval '10 minutes'");
await mensagem(CONEXAO_MAJOR, MAJOR.id, T.agora, "a1", "now() - interval '10 minutes'");
await conversa(CONEXAO_MAJOR, MAJOR.id, T.grupo, "now() - interval '3 hours'", { tipo: "grupo" });
await mensagem(CONEXAO_MAJOR, MAJOR.id, T.grupo, "g1", "now() - interval '3 hours'");
await conversa(CONEXAO_MAJOR, MAJOR.id, T.soEmpresa, "now() - interval '3 hours'");
await mensagem(CONEXAO_MAJOR, MAJOR.id, T.soEmpresa, "e1", "now() - interval '3 hours'", { deMim: true });
await conversa(CONEXAO_MAJOR, MAJOR.id, T.velha, "now() - interval '10 days'");
await mensagem(CONEXAO_MAJOR, MAJOR.id, T.velha, "v1", "now() - interval '10 days'");
await conversa(CONEXAO_MAJOR, MAJOR.id, T.falhou, "now() - interval '4 hours'");
await mensagem(CONEXAO_MAJOR, MAJOR.id, T.falhou, "f1", "now() - interval '4 hours'");
// A conversa da outra empresa, pronta para leitura também.
await conversa(CONEXAO_OUTRA, OUTRA.id, T.pronta, "now() - interval '2 hours'");
await mensagem(CONEXAO_OUTRA, OUTRA.id, T.pronta, "o1", "now() - interval '2 hours'");

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna");

const pendentes = async (robo, sub, max = 5, quieto = 60) =>
  (await como(sub, "select public.nucleo_insights_pending($1, $2) as r", [max, quieto], { robo })).rows[0].r;
const grava = async (robo, sub, payload) =>
  (await como(sub, "select public.nucleo_insights_record($1::jsonb) as r", [JSON.stringify(payload)], { robo })).rows[0].r;

const respostasOk = [
  { question: "temperatura", answer: "morno", probability: 0.71, distribution: { "0": 0.1, "1": 0.71, "2": 0.19 } },
  { question: "insatisfeito", answer: "nao", probability: 0.93 },
  { question: "intencao", answer: "pesquisando", probability: 0.66, distribution: { pesquisando: 0.66, comprar_agora: 0.34 } },
];
const leitura = (telefone, ate, extra = {}) => ({
  phone: telefone,
  analyzedUntil: ate,
  messagesCount: 80,
  status: "ok",
  model: "typesafe/jev-1.13-20260917",
  frameworkVersion: "major-v1",
  inputTokens: 4005,
  costUsd: 0.000168,
  latencyMs: 917,
  answers: respostasOk,
  ...extra,
});

// 1. Desligada: nada sai, nada entra.
let r = await pendentes(roboMajor, ROBO_MAJOR);
confere("desligada: enabled=false e lista vazia", r.enabled === false && r.conversations.length === 0, JSON.stringify(r));
let erro = await erroDe(() => grava(roboMajor, ROBO_MAJOR, leitura(T.pronta, new Date().toISOString())));
confere("desligada: gravar é recusado", erro.includes("disabled"), erro);

// 2. Quem pode chamar.
erro = await erroDe(() => como(MAJOR.dono, "select public.nucleo_insights_pending(5, 60)"));
confere("membro humano não chama a RPC do robô", erro.includes("robot credential"), erro);
erro = await erroDe(() => como(null, "select public.nucleo_insights_pending(5, 60)", [], { role: "anon" }));
confere("anônimo não executa", /permission denied/i.test(erro), erro);
erro = await erroDe(() => como(MAJOR.dono, "select public.nucleo_insights_record('{}'::jsonb)"));
confere("membro humano não grava", erro.includes("robot credential"), erro);

// 3. Ligar só para a Major, como o painel faz.
erro = await erroDe(() =>
  como(ADMIN, "select public.platform_entitlement_set($1, 'conversation_insights', true, null, null, 'teste', false)", [MAJOR.id]),
);
confere("ligar exige confirm_ai (é função de IA)", erro.includes("confirm_ai"), erro);
await como(ADMIN, "select public.platform_entitlement_set($1, 'conversation_insights', true, null, null, 'teste', true)", [MAJOR.id]);

// Uma falha recente para a conversa `falhou`.
await grava(roboMajor, ROBO_MAJOR, {
  phone: T.falhou,
  analyzedUntil: new Date(Date.now() - 4 * 3600e3).toISOString(),
  status: "failed",
  errorCode: "jev_http_503",
  answers: [],
});

r = await pendentes(roboMajor, ROBO_MAJOR);
const telefones = r.conversations.map((c) => c.phone);
confere("ligada: enabled=true", r.enabled === true);
confere("pega a conversa quieta com mensagem do contato", telefones.includes(T.pronta), JSON.stringify(telefones));
confere("não pega conversa ainda em andamento", !telefones.includes(T.agora));
confere("não pega grupo", !telefones.includes(T.grupo));
confere("não pega conversa só da empresa", !telefones.includes(T.soEmpresa));
confere("não pega conversa de mais de 7 dias", !telefones.includes(T.velha));
confere("não pega conversa que falhou na última hora", !telefones.includes(T.falhou));
confere("só a conversa certa", telefones.length === 1, JSON.stringify(telefones));
const pronta = r.conversations.find((c) => c.phone === T.pronta);
confere("só as últimas 80 mensagens", pronta?.messages.length === 80, String(pronta?.messages.length));
confere(
  "em ordem, da mais velha para a mais nova",
  pronta?.messages[0].content === "mensagem 21" && pronta?.messages[79].content.startsWith("xxx"),
  `${pronta?.messages[0].content} … ${pronta?.messages[79].content.slice(0, 5)}`,
);
confere("texto cortado em 1500 caracteres", pronta?.messages[79].content.length === 1500, String(pronta?.messages[79].content.length));
confere("leva quem escreveu", pronta?.messages[1].authorKind === "ia" && pronta?.messages[0].fromMe === false);

// A janela de silêncio é parâmetro: com 5 minutos, a de 10 minutos entra.
r = await pendentes(roboMajor, ROBO_MAJOR, 5, 5);
confere("quiet_minutes menor pega a conversa recente", r.conversations.some((c) => c.phone === T.agora));

// A outra empresa continua desligada.
r = await pendentes(roboOutra, ROBO_OUTRA);
confere("outra empresa segue desligada", r.enabled === false);

// 4. Gravar.
const ate = pronta.lastMessageAt;
let gravado = await grava(roboMajor, ROBO_MAJOR, leitura(T.pronta, ate));
confere("grava a leitura", gravado.recorded === true && gravado.id);
let runs = (await db.query("select * from public.conversation_insight_runs where contact_phone = $1 and status = 'ok'", [T.pronta])).rows;
confere("uma leitura em vigor", runs.length === 1 && runs[0].is_latest === true);
confere("resumo compacto para o portal", runs[0].summary?.temperatura?.a === "morno" && Number(runs[0].summary.temperatura.p) === 0.71, JSON.stringify(runs[0].summary));
confere("custo e modelo guardados", Number(runs[0].cost_usd) === 0.000168 && runs[0].model === "typesafe/jev-1.13-20260917");
let respostas = (await db.query("select * from public.conversation_insight_answers where run_id = $1", [gravado.id])).rows;
confere("as respostas separadas, uma por pergunta", respostas.length === 3);
r = await pendentes(roboMajor, ROBO_MAJOR);
confere("conversa lida sai da fila", !r.conversations.some((c) => c.phone === T.pronta), JSON.stringify(r.conversations.map((c) => c.phone)));

// Mensagem nova do contato: pede leitura de novo.
await mensagem(CONEXAO_MAJOR, MAJOR.id, T.pronta, "p101", "now() - interval '70 minutes'");
await db.query("update public.whatsapp_conversations set last_message_at = now() - interval '70 minutes' where contact_phone = $1 and connection_id = $2", [T.pronta, CONEXAO_MAJOR]);
r = await pendentes(roboMajor, ROBO_MAJOR);
const denovo = r.conversations.find((c) => c.phone === T.pronta);
confere("mensagem nova pede leitura de novo", Boolean(denovo));
gravado = await grava(roboMajor, ROBO_MAJOR, leitura(T.pronta, denovo.lastMessageAt, {
  answers: [{ question: "temperatura", answer: "quente", probability: 0.88 }],
}));
runs = (await db.query("select is_latest, summary from public.conversation_insight_runs where contact_phone = $1 and connection_id = $2 order by created_at", [T.pronta, CONEXAO_MAJOR])).rows;
confere(
  "a nova aposenta a anterior",
  runs.length === 2 && runs[0].is_latest === false && runs[1].is_latest === true && runs[1].summary.temperatura.a === "quente",
  JSON.stringify(runs),
);

// 5. O que é recusado.
const agoraIso = new Date().toISOString();
erro = await erroDe(() => grava(roboMajor, ROBO_MAJOR, leitura("5565911111111", agoraIso)));
confere("conversa que não é desta conexão é recusada", erro.includes("conversation not found"), erro);
erro = await erroDe(() => grava(roboOutra, ROBO_OUTRA, leitura(T.agora, agoraIso)));
confere("robô de outra empresa não grava na conversa da Major", erro.length > 0, erro);
erro = await erroDe(() => grava(roboMajor, ROBO_MAJOR, leitura(T.agora, agoraIso, { answers: [{ question: "Tem Espaço", answer: "x", probability: 0.5 }] })));
confere("pergunta com nome inválido é recusada", erro.includes("answer is invalid"), erro);
erro = await erroDe(() => grava(roboMajor, ROBO_MAJOR, leitura(T.agora, agoraIso, { answers: [{ question: "temperatura", answer: "x", probability: 1.5 }] })));
confere("probabilidade fora de 0..1 é recusada", erro.includes("answer is invalid"), erro);
erro = await erroDe(() => grava(roboMajor, ROBO_MAJOR, leitura(T.agora, agoraIso, { answers: [] })));
confere("leitura ok sem respostas é recusada", erro.includes("needs answers"), erro);
erro = await erroDe(() => grava(roboMajor, ROBO_MAJOR, leitura(T.agora, agoraIso, { status: "talvez" })));
confere("status inventado é recusado", erro.includes("status"), erro);
erro = await erroDe(() => grava(roboMajor, ROBO_MAJOR, leitura(T.agora, "amanha")));
confere("data inválida é recusada", erro.includes("analyzedUntil"), erro);

// 6. Quem lê.
const doDono = (await como(MAJOR.dono, "select count(*)::int as n from public.conversation_insight_runs")).rows[0].n;
confere("o dono da Major lê as leituras", doDono >= 3, String(doDono));
const daOutra = (await como(OUTRA.dono, "select count(*)::int as n from public.conversation_insight_runs")).rows[0].n;
confere("o dono de outra empresa não lê nada", daOutra === 0, String(daOutra));
const respostasDoDono = (await como(MAJOR.dono, "select count(*)::int as n from public.conversation_insight_answers")).rows[0].n;
confere("o dono lê as respostas", respostasDoDono === 4, String(respostasDoDono));
erro = await erroDe(() =>
  como(MAJOR.dono, `insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status)
    values ('${MAJOR.id}', '${CONEXAO_MAJOR}', '${T.agora}', now(), 'ok')`),
);
confere("ninguém escreve direto na tabela", /permission denied/i.test(erro), erro);

// 7. Poda de 180 dias.
await db.query(
  `insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, created_at)
   values ($1, $2, $3, now() - interval '200 days', 'failed', now() - interval '200 days')`,
  [MAJOR.id, CONEXAO_MAJOR, T.velha],
);
gravado = await grava(roboMajor, ROBO_MAJOR, leitura(T.agora, agoraIso));
confere("a leitura velha é podada", gravado.pruned === 1, JSON.stringify(gravado));

// 8. Desligar volta a calar.
await como(ADMIN, "select public.platform_entitlement_set($1, 'conversation_insights', false, null, null, 'teste', false)", [MAJOR.id]);
r = await pendentes(roboMajor, ROBO_MAJOR);
confere("desligar de novo cala o coordenador", r.enabled === false);

// 9. Reaplicar aborta.
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", reaplicar.includes("ja foi aplicada"), reaplicar);

for (const linha of passou) console.log(`PASS ${linha}`);
for (const linha of falhas) console.log(`FAIL ${linha}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
