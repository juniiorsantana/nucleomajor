// Prova comportamental da migration 20261007100000 (a transcrição dos áudios)
// num Postgres embutido (PGlite), com o harness e TODAS as migrations reais do
// repositório, em ordem. Nada aqui toca produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-transcricao-dos-audios.mjs . && node prova-transcricao-dos-audios.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-transcricao-dos-audios.mjs <repo>");
const MIGRATION = "20261007100000_transcricao_dos_audios.sql";
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
const CONEXAO_OUTRA = "cccccccc-0000-4000-8000-000000000002";
const ROBO = "dddddddd-0000-4000-8000-000000000001";
const ROBO_OUTRA = "dddddddd-0000-4000-8000-000000000002";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'major'), ($3, $4, 'outra')", [CONEXAO, MAJOR.id, CONEXAO_OUTRA, OUTRA.id]);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'robo@exemplo.invalido', now()), ($2, 'robo2@exemplo.invalido', now())", [ROBO, ROBO_OUTRA]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3), ($4, $5, $6)", [CONEXAO, MAJOR.id, ROBO, CONEXAO_OUTRA, OUTRA.id, ROBO_OUTRA]);
const robo = { org: MAJOR.id, conexao: CONEXAO };
const roboOutra = { org: OUTRA.id, conexao: CONEXAO_OUTRA };

const DIRETO = "5565988887777";
const GRUPO = "120363000000000001";
await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at, owner)
  values ($1, $2, $3, 'direto', now(), 'humano'), ($1, $2, $4, 'grupo', now(), 'humano')`, [CONEXAO, MAJOR.id, DIRETO, GRUPO]);
const mensagem = (telefone, id, conteudo, tipo) =>
  db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me, author_kind, media_type)
    values ($1, $2, $3, $4, $5, now(), false, 'contato', $6)`, [CONEXAO, MAJOR.id, telefone, id, conteudo, tipo]);
await mensagem(DIRETO, "a1", "", "ptt");
await mensagem(DIRETO, "a2", "", "audio");
await mensagem(DIRETO, "a3", "legenda digitada", "audio");
await mensagem(DIRETO, "a4", "", "ptt");
await mensagem(DIRETO, "t1", "", "");
await mensagem(DIRETO, "i1", "", "image");
await mensagem(GRUPO, "g1", "", "ptt");

// ---------------------------------------------------------------- a migration
const aplicada = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("a migration aplica", aplicada === "", aplicada);
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta pela guarda", reaplicar.includes("já existe"), reaplicar);
await db.exec("rollback");

const grava = (itens, quem = ROBO, r = robo) =>
  como(quem, "select public.nucleo_message_transcript_record($1::jsonb) as r", [JSON.stringify({ items: itens })], { robo: r }).then((x) => x.rows[0].r);
const linha = async (id) =>
  (await db.query("select content, transcribed_at from public.whatsapp_messages where connection_id = $1 and message_id = $2", [CONEXAO, id])).rows[0];

// O caminho feliz: áudio e ptt de conversa direta, sem texto.
const r1 = await grava([{ id: "a1", text: "  Oi, queria saber do consórcio  " }, { id: "a2", text: "Pode me ligar amanhã" }]);
confere("robô grava duas transcrições", r1.recorded === 2, JSON.stringify(r1));
const a1 = await linha("a1");
confere("o texto entra no content, aparado", a1.content === "Oi, queria saber do consórcio", a1.content);
confere("e a marca fica", a1.transcribed_at !== null);

// O que NÃO pode mudar.
const r2 = await grava([
  { id: "a1", text: "outra versão" },     // já transcrito
  { id: "a3", text: "sobrescreve legenda" }, // tem legenda
  { id: "t1", text: "texto" },             // não é áudio
  { id: "i1", text: "imagem" },            // não é áudio
  { id: "g1", text: "grupo" },             // conversa de grupo
  { id: "nao-existe", text: "x" },
  { id: "", text: "x" },
]);
confere("nada fora da regra é gravado", r2.recorded === 0, JSON.stringify(r2));
confere("transcrição não é reescrita", (await linha("a1")).content === "Oi, queria saber do consórcio");
confere("legenda digitada não é sobrescrita", (await linha("a3")).content === "legenda digitada");
confere("áudio de grupo fica sem texto", (await linha("g1")).content === "" && (await linha("g1")).transcribed_at === null);
confere("texto comum não ganha marca", (await linha("t1")).transcribed_at === null);

// Áudio sem fala: só a marca.
const r3 = await grava([{ id: "a4", text: "   " }]);
const a4 = await linha("a4");
confere("áudio sem fala grava só a marca", r3.recorded === 1 && a4.content === "" && a4.transcribed_at !== null, JSON.stringify(a4));
confere("e não é gravado de novo", (await grava([{ id: "a4", text: "agora com fala" }])).recorded === 0);

// Teto do texto.
await mensagem(DIRETO, "a5", "", "audio");
await grava([{ id: "a5", text: "y".repeat(9000) }]);
confere("texto cortado em 8000", (await linha("a5")).content.length === 8000);

// Quem não pode.
await mensagem(DIRETO, "a6", "", "audio");
const deOutra = await grava([{ id: "a6", text: "invasão" }], ROBO_OUTRA, roboOutra);
confere("robô de outra empresa não grava aqui", deOutra.recorded === 0 && (await linha("a6")).content === "", JSON.stringify(deOutra));
const dono = await erroDe(() => grava([{ id: "a6", text: "dono" }], MAJOR.dono, null));
confere("membro (não robô) é recusado", dono.includes("robot credential"), dono);
const anon = await erroDe(() => como(null, "select public.nucleo_message_transcript_record('{\"items\":[]}'::jsonb)"));
confere("anon não executa", anon.includes("permission denied"), anon);
const direto = await erroDe(() => como(MAJOR.dono, "update public.whatsapp_messages set content = 'x' where message_id = 'a6'"));
const a6 = await linha("a6");
confere("membro não escreve direto na tabela", direto !== "" || a6.content === "", direto);

// Formato.
const grande = await erroDe(() => grava(Array.from({ length: 51 }, (_, i) => ({ id: `x${i}`, text: "x" }))));
confere("lote acima de 50 é recusado", grande.includes("too large"), grande);
const torto = await erroDe(() => como(ROBO, "select public.nucleo_message_transcript_record('[]'::jsonb)", [], { robo }));
confere("payload que não é objeto é recusado", torto.includes("invalid"), torto);

// Credencial revogada.
await db.query("update public.connection_robot_credentials set status = 'revoked', revoked_at = now() where auth_user_id = $1", [ROBO]);
const revogado = await erroDe(() => grava([{ id: "a6", text: "x" }]));
confere("credencial revogada é recusada", revogado !== "", revogado);
await db.query("update public.connection_robot_credentials set status = 'active', revoked_at = null where auth_user_id = $1", [ROBO]);

// A análise lê a transcrição: o pedido monta as mensagens a partir do content.
const LEITURA = (await db.query(
  "select m.content from public.whatsapp_messages m where m.connection_id = $1 and m.contact_phone = $2 and m.message_id = 'a2'",
  [CONEXAO, DIRETO])).rows[0].content;
confere("o que a análise lê do áudio é o texto", LEITURA === "Pode me ligar amanhã", LEITURA);
const pedido = (await como(MAJOR.dono, "select public.conversation_analysis_request($1, $2, $3, 'atendimento') as r", [MAJOR.id, CONEXAO, DIRETO])).rows[0].r;
const carga = (await db.query(
  "select private_payload as payload from public.connection_runtime_commands where connection_id = $1 and command_type = 'conversation_analyze' order by created_at desc limit 1",
  [CONEXAO])).rows[0]?.payload;
const naCarga = (carga?.messages || []).find((m) => m.id === "a2");
confere("o pedido de análise leva a transcrição para a VPS", naCarga?.content === "Pode me ligar amanhã" && naCarga?.mediaType === "audio",
  JSON.stringify({ pedido, naCarga }));

// Rollback.
await db.exec(ler("scripts/sql/rollback-20261007100000-transcricao-dos-audios.sql"));
const coluna = (await db.query("select count(*)::int as n from information_schema.columns where table_name = 'whatsapp_messages' and column_name = 'transcribed_at'")).rows[0].n;
confere("rollback: a coluna sai", coluna === 0);
confere("rollback: o áudio volta sem texto", (await db.query("select content from public.whatsapp_messages where message_id = 'a1'")).rows[0].content === "");
confere("rollback: a legenda digitada fica", (await db.query("select content from public.whatsapp_messages where message_id = 'a3'")).rows[0].content === "legenda digitada");
const funcao = (await db.query("select to_regprocedure('public.nucleo_message_transcript_record(jsonb)') as f")).rows[0].f;
confere("rollback: a função sai", funcao === null);
const reaplicada = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("depois do rollback, a migration aplica de novo", reaplicada === "", reaplicada);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
