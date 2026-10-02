// Prova comportamental da migration 20261001100000 (Equipe de IA: playbook e
// Jev por agente) num Postgres embutido (PGlite), com o harness e TODAS as
// migrations reais do repositório, em ordem. Nada aqui toca produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-equipe-de-ia.mjs . && node prova-equipe-de-ia.mjs <repo>
//
// O que ela responde:
//   * só dono/admin grava o playbook; o formato é conferido no banco; publicar
//     cria versão; membro lê, outra empresa não;
//   * a fila do coordenador entrega o agente da conversa (pelo contexto do
//     contato, ou a porta de entrada) com o jeito dele, e o playbook publicado;
//   * a gravação guarda agente, quem falou e a versão do playbook, e recusa
//     agente de outra empresa sem derrubar a leitura;
//   * o pedido de avaliação de teste: só dono/admin, com a função ligada,
//     guarda a conversa no payload privado e devolve o status;
//   * a fila de comandos continua com todos os tipos antigos.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-equipe-de-ia.mjs <repo>");
const MIGRATION = "20261001100000_equipe_de_ia_playbook_e_jev.sql";
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

async function como(sub, sql, params = [], { role = "authenticated", robo = null } = {}) {
  return db.transaction(async (tx) => {
    const claims = sub
      ? { sub, role: "authenticated", ...(robo ? { app_metadata: { is_robot: "true", organization_id: robo.org, connection_id: robo.conexao } } : {}) }
      : { role: "anon" };
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [sub || "", JSON.stringify(claims)]);
    if (role) await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
let seq = 0;
async function empresa(nome) {
  seq += 1;
  const dono = `bbbbbbbb-0000-4000-8000-00000000000${seq}`;
  const email = `dono${seq}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [dono, email]);
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, 'full', 7)", [email])).rows[0].access_code;
  const id = (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
  return { id, dono };
}
const MAJOR = await empresa("Major");
const OUTRA = await empresa("Outra");
const MEMBRO = "eeeeeeee-0000-4000-8000-000000000001";
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'membro@exemplo.invalido', now())", [MEMBRO]);
await db.query("insert into public.profiles (id, full_name) values ($1, 'Membro') on conflict (id) do nothing", [MEMBRO]);
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [MAJOR.id, MEMBRO]);

const CONEXAO = "cccccccc-0000-4000-8000-000000000001";
const ROBO = "dddddddd-0000-4000-8000-000000000001";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'major')", [CONEXAO, MAJOR.id]);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'robo@exemplo.invalido', now())", [ROBO]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, MAJOR.id, ROBO]);
const robo = { org: MAJOR.id, conexao: CONEXAO };

// Os agentes: a porta de entrada de clientes e um SDR.
const template = (await db.query("select id from public.assistant_templates limit 1")).rows[0]?.id;
const perfis = (await db.query("select id, audience, is_default, display_name, tone from public.assistant_profiles where organization_id = $1", [MAJOR.id])).rows;
let PORTA = perfis.find((p) => p.audience === "customer" && p.is_default)?.id;
if (!PORTA) {
  PORTA = (await db.query(
    `insert into public.assistant_profiles (organization_id, template_id, audience, display_name, tone, created_by, updated_by, is_default)
     values ($1, $2, 'customer', 'Recepção', 'cordial e objetivo', $3, $3, true) returning id`, [MAJOR.id, template, MAJOR.dono])).rows[0].id;
}
await db.query("update public.assistant_profiles set tone = 'acolhedor, uma pergunta por vez' where id = $1", [PORTA]);
const SDR = (await db.query(
  `insert into public.assistant_profiles (organization_id, template_id, audience, display_name, tone, created_by, updated_by, is_default, slug)
   values ($1, $2, 'customer', 'SDR', 'direto e consultivo', $3, $3, false, 'sdr') returning id`, [MAJOR.id, template, MAJOR.dono])).rows[0].id;

// Duas conversas paradas: uma com contexto apontando para o SDR, outra sem.
const T_SDR = "5565988887777";
const T_PORTA = "5565911112222";
for (const t of [T_SDR, T_PORTA]) {
  await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at)
    values ($1, $2, $3, 'direto', now() - interval '2 hours')`, [CONEXAO, MAJOR.id, t]);
  await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me)
    values ($1, $2, $3, $4, 'quanto custa?', now() - interval '2 hours', false)`, [CONEXAO, MAJOR.id, t, `m-${t}`]);
}
const contato = (await db.query(`insert into public.contacts (organization_id, name, phone) values ($1, 'Lead SDR', '(65) 9 8888-7777') returning id`, [MAJOR.id])).rows[0].id;
await db.query(
  `insert into public.conversation_intelligence_contexts (organization_id, connection_id, contact_id, assistant_profile_id, audience, channel, conversation_key_hash)
   values ($1, $2, $3, $4, 'customer', 'whatsapp', $5)`,
  [MAJOR.id, CONEXAO, contato, SDR, "a".repeat(64)],
);
await como(ADMIN, "select public.platform_entitlement_set($1, 'conversation_insights', true, null, null, 'teste', true)", [MAJOR.id]);

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna");

const tipos = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'connection_runtime_commands_command_type_check'")).rows[0].d;
confere("fila de comandos mantém os tipos antigos e ganha o novo",
  ["conversation_send", "flow_trigger", "site_lead_welcome", "insights_evaluate"].every((t) => tipos.includes(t)), tipos);

// 1. Playbook.
const PLAYBOOK = {
  segmento: "academia",
  oferta: [{ nome: "Plano trimestral", preco: "R$ 289/mês", inclui: "avaliação física e app" }],
  clienteIdeal: { atende: ["quer treinar com acompanhamento"], naoAtende: ["menor de 14 anos"] },
  objecoes: [{ chave: "preco", nome: "Preço", resposta: "ofereça a aula experimental" }, { chave: "horario", nome: "Horário", resposta: "mostre a grade" }],
  proximosPassos: [{ chave: "aula_experimental", nome: "Aula experimental", quando: "depois da objeção de preço" }],
  criterios: [{ chave: "ofereceu_aula", pergunta: "A empresa ofereceu a aula experimental?", sim: "Ofereceu com data." }],
};
const salvar = (quem, conteudo, publicar = false, org = MAJOR.id) =>
  como(quem, "select public.playbook_save($1, $2::jsonb, $3) as r", [org, JSON.stringify(conteudo), publicar]);

let erro = await erroDe(() => salvar(MEMBRO, PLAYBOOK));
confere("membro não grava o playbook", erro.includes("organization management required"), erro);
erro = await erroDe(() => salvar(OUTRA.dono, PLAYBOOK));
confere("dono de outra empresa não grava", erro.includes("organization management required"), erro);
erro = await erroDe(() => salvar(MAJOR.dono, { ...PLAYBOOK, objecoes: [{ chave: "Preço!", nome: "x" }] }));
confere("chave inválida é recusada", erro.includes("chave invalida"), erro);
erro = await erroDe(() => salvar(MAJOR.dono, { ...PLAYBOOK, objecoes: [{ chave: "preco", nome: "a" }, { chave: "preco", nome: "b" }] }));
confere("chave repetida é recusada", erro.includes("chave repetida"), erro);
erro = await erroDe(() => salvar(MAJOR.dono, { ...PLAYBOOK, proximosPassos: Array.from({ length: 7 }, (_, i) => ({ chave: `p${i}x`, nome: "x" })) }));
confere("limite de 6 próximos passos", erro.includes("limite"), erro);
erro = await erroDe(() => salvar(MAJOR.dono, { ...PLAYBOOK, criterios: [{ chave: "abc", pergunta: "" }] }));
confere("critério sem pergunta é recusado", erro.includes("pergunta"), erro);

let r = (await salvar(MAJOR.dono, PLAYBOOK)).rows[0].r;
confere("rascunho salvo sem publicar", r.saved && r.published === false && r.version === 0, JSON.stringify(r));
let pend = (await como(ROBO, "select public.nucleo_insights_pending(5, 60) as r", [], { robo })).rows[0].r;
confere("sem publicar, o Jev não recebe playbook", pend.playbook === null, JSON.stringify(pend.playbook));
r = (await salvar(MAJOR.dono, PLAYBOOK, true)).rows[0].r;
confere("publicar cria a versão 1", r.published && r.version === 1, JSON.stringify(r));
r = (await salvar(MAJOR.dono, { ...PLAYBOOK, segmento: "academia premium" }, true)).rows[0].r;
confere("publicar de novo cria a versão 2", r.version === 2, JSON.stringify(r));
const versoes = (await como(MEMBRO, "select count(*)::int as n from public.playbook_versions")).rows[0].n;
confere("membro lê as versões", versoes === 2, String(versoes));
const daOutra = (await como(OUTRA.dono, "select count(*)::int as n from public.organization_playbooks")).rows[0].n;
confere("outra empresa não lê o playbook", daOutra === 0, String(daOutra));
erro = await erroDe(() => como(MAJOR.dono, `update public.organization_playbooks set draft = '{}' where organization_id = '${MAJOR.id}'`));
confere("ninguém escreve direto na tabela", /permission denied/i.test(erro), erro);

// 2. A fila do coordenador.
pend = (await como(ROBO, "select public.nucleo_insights_pending(5, 60) as r", [], { robo })).rows[0].r;
const porTelefone = Object.fromEntries(pend.conversations.map((c) => [c.phone, c]));
confere("playbook publicado vai para o Jev", pend.playbook?.version === 2 && pend.playbook.objecoes.length === 2 && pend.playbook.criterios[0].chave === "ofereceu_aula", JSON.stringify(pend.playbook));
confere("o playbook do Jev não leva preço nem resposta", !JSON.stringify(pend.playbook).includes("R$") && !JSON.stringify(pend.playbook).includes("aula experimental\"") );
confere("conversa com contexto vai para o SDR, com o jeito dele",
  porTelefone[T_SDR]?.agent?.id === SDR && porTelefone[T_SDR].agent.tone === "direto e consultivo", JSON.stringify(porTelefone[T_SDR]?.agent));
confere("conversa sem contexto vai para a porta de entrada",
  porTelefone[T_PORTA]?.agent?.id === PORTA && porTelefone[T_PORTA].agent.tone === "acolhedor, uma pergunta por vez", JSON.stringify(porTelefone[T_PORTA]?.agent));

// 3. A gravação.
const ate = porTelefone[T_SDR].lastMessageAt;
r = (await como(ROBO, "select public.nucleo_insights_record($1::jsonb) as r", [JSON.stringify({
  phone: T_SDR, analyzedUntil: ate, status: "ok", messagesCount: 3, frameworkVersion: "major-v1",
  assistantProfileId: SDR, aiMessages: 1, teamMessages: 1, contactMessages: 1, playbookVersion: 2,
  answers: [{ question: "segue_o_jeito", answer: "sim", probability: 0.8 }, { question: "pb_ofereceu_aula", answer: "nao", probability: 0.9 }],
})], { robo })).rows[0].r;
let run = (await db.query("select * from public.conversation_insight_runs where id = $1", [r.id])).rows[0];
confere("grava agente, quem falou e versão do playbook",
  run.assistant_profile_id === SDR && run.ai_messages === 1 && run.team_messages === 1 && run.contact_messages === 1 && run.playbook_version === 2,
  JSON.stringify({ a: run.assistant_profile_id, ia: run.ai_messages, pb: run.playbook_version }));
r = (await como(ROBO, "select public.nucleo_insights_record($1::jsonb) as r", [JSON.stringify({
  phone: T_PORTA, analyzedUntil: ate, status: "ok", assistantProfileId: OUTRA.id,
  answers: [{ question: "temperatura", answer: "morno", probability: 0.7 }],
})], { robo })).rows[0].r;
run = (await db.query("select assistant_profile_id from public.conversation_insight_runs where id = $1", [r.id])).rows[0];
confere("agente que não é da empresa vira vazio, e a leitura vale", run.assistant_profile_id === null);

// 4. A avaliação de teste.
const pedir = (quem, texto = "Lead: quanto custa?\nEmpresa: R$ 289.", perfil = SDR, org = MAJOR.id) =>
  como(quem, "select public.nucleo_insights_evaluate_request($1, $2, $3) as r", [org, perfil, texto]);
erro = await erroDe(() => pedir(MEMBRO));
confere("membro não pede avaliação", erro.includes("organization management required"), erro);
erro = await erroDe(() => pedir(MAJOR.dono, "curto"));
confere("conversa curta demais é recusada", erro.includes("between 10"), erro);
erro = await erroDe(() => pedir(MAJOR.dono, undefined, OUTRA.id));
confere("agente de outra empresa é recusado", erro.includes("agent not found"), erro);
r = (await pedir(MAJOR.dono)).rows[0].r;
const cmd = (await db.query("select * from public.connection_runtime_commands where id = $1", [r.commandId])).rows[0];
confere("enfileira insights_evaluate na conexão da empresa", cmd.command_type === "insights_evaluate" && cmd.connection_id === CONEXAO && cmd.status === "pending");
confere("o payload leva conversa, jeito e playbook",
  cmd.private_payload.transcript.includes("quanto custa") && cmd.private_payload.agent.tone === "direto e consultivo" && cmd.private_payload.playbook.version === 2);
let st = (await como(MEMBRO, "select public.nucleo_insights_evaluate_status($1, $2) as r", [MAJOR.id, r.commandId])).rows[0].r;
confere("membro acompanha o status", st.status === "pending", JSON.stringify(st));
erro = await erroDe(() => como(OUTRA.dono, "select public.nucleo_insights_evaluate_status($1, $2)", [MAJOR.id, r.commandId]));
confere("outra empresa não vê o status", erro.includes("membership"), erro);
// O robô conclui, e o payload privado some.
const claim = (await como(ROBO, "select public.nucleo_runtime_commands_claim(10, gen_random_uuid()) as r", [], { robo })).rows[0].r;
const pegou = (claim.commands || []).find((c) => c.commandId === r.commandId);
confere("o robô recebe o comando com o payload", pegou?.commandType === "insights_evaluate" && pegou.payload?.transcript, JSON.stringify(claim).slice(0, 200));
await como(ROBO, "select public.nucleo_runtime_command_complete($1, 'completed', null, $2::jsonb, $3)",
  [r.commandId, JSON.stringify({ r: { temperatura: ["morno", 0.71] } }), pegou ? (await db.query("select claimed_instance from public.connection_runtime_commands where id = $1", [r.commandId])).rows[0].claimed_instance : null], { robo });
st = (await como(MAJOR.dono, "select public.nucleo_insights_evaluate_status($1, $2) as r", [MAJOR.id, r.commandId])).rows[0].r;
const depois = (await db.query("select private_payload from public.connection_runtime_commands where id = $1", [r.commandId])).rows[0];
confere("o resultado volta e a conversa de teste é apagada",
  st.status === "completed" && st.result?.r?.temperatura?.[0] === "morno" && JSON.stringify(depois.private_payload) === "{}", JSON.stringify(st));
// Função desligada: não pede.
await como(ADMIN, "select public.platform_entitlement_set($1, 'conversation_insights', false, null, null, 'teste', false)", [MAJOR.id]);
erro = await erroDe(() => pedir(MAJOR.dono));
confere("com a função desligada, não pede avaliação", erro.includes("disabled"), erro);

const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", reaplicar.includes("ja foi aplicada"), reaplicar);

for (const linha of passou) console.log(`PASS ${linha}`);
for (const linha of falhas) console.log(`FAIL ${linha}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
