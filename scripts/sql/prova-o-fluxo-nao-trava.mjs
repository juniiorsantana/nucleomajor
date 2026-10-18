// Prova comportamental da migration 20261018150000 (o fluxo não trava: o
// Pacote 0 do executor e os pacotes P2 e P3 do review de 18/10) num Postgres
// embutido (PGlite). Banco em memória, nada de produção.
//
// Mesmo método das provas anteriores: harness + TODAS as migrations reais até
// a anterior, a migration, as perguntas, o rollback e a reaplicação.
//
//   1. 0.1  a execução viva que não está suspensa aparece como `running`;
//   2. 0.3  a resposta depois do prazo vale enquanto a execução está suspensa;
//   3. A7   o telefone nas duas formas do nono dígito acha a mesma execução;
//   4. P2   needs_review e ready parados fecham sozinhos, com flow.expired uma
//           vez, e o contato volta a poder começar; o prazo vem do fluxo, da
//           organização ou é 24 h;
//   5. P3   o manual devolve ao bot e diz o desfecho; a conexão é escolhida
//           por regra; o gatilho não cai sobre fluxo vivo; a etiqueta do
//           próprio motor não dispara outro fluxo;
//   6. permissões, rollback e reaplicação.
//
//   mkdir prova && cd prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-o-fluxo-nao-trava.mjs . && node prova-o-fluxo-nao-trava.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-o-fluxo-nao-trava.mjs <repo>");
const MIGRATION = "20261018150000_o_fluxo_nao_trava.sql";
const ROLLBACK = "scripts/sql/rollback-20261018150000-o-fluxo-nao-trava.sql";
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
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
`);
const migrations = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
if (!migrations.includes(MIGRATION)) throw new Error(`migration não achada: ${MIGRATION}`);
for (const f of migrations) {
  if (f >= MIGRATION) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}
// Opcional: a Etapa 9 (20261018110000, Major 2), que vem antes desta e troca a
// resposta pela de 6 argumentos. `node prova-o-fluxo-nao-trava.mjs <repo> <arquivo da 110000>`.
const ETAPA9 = process.argv[3];
if (ETAPA9) await db.exec(readFileSync(ETAPA9, "utf8").replace(/\r/g, ""));
const respostaAntes = (await db.query(`select md5(replace(prosrc, chr(13), '')) h, oid::regprocedure::text f from pg_proc
  where proname = 'nucleo_flow_answer' and pronamespace = 'public'::regnamespace`)).rows;

async function como(claims, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [claims?.sub || "", JSON.stringify(claims || { role: "anon" })],
    );
    await tx.exec(`set local role ${claims ? "authenticated" : "anon"}`);
    return tx.query(sql, params);
  });
}
const usuario = (sub) => ({ sub, role: "authenticated" });
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const quantos = async (sql, params = []) => Number((await um(sql, params)).n);

// ---------------------------------------------------------------- o mundo
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO = "aaaaaaaa-0000-4000-8000-000000000002";
const VENDEDORA = "aaaaaaaa-0000-4000-8000-000000000003";
const ESTRANHO = "aaaaaaaa-0000-4000-8000-000000000004";
const DONO_DUAS = "aaaaaaaa-0000-4000-8000-000000000005";
const ROBO = "dddddddd-0000-4000-8000-000000000005";
const ROBO_B = "dddddddd-0000-4000-8000-000000000006";
const ROBO_DUAS_A = "dddddddd-0000-4000-8000-000000000007";
const ROBO_DUAS_B = "dddddddd-0000-4000-8000-000000000008";
const CONEXAO = "eeeeeeee-0000-4000-8000-000000000008";
const CONEXAO_DUAS_A = "eeeeeeee-0000-4000-8000-000000000009";
const CONEXAO_DUAS_B = "eeeeeeee-0000-4000-8000-00000000000a";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO}', 'major@exemplo.invalido', now()),
    ('${VENDEDORA}', 'vendedora@exemplo.invalido', now()),
    ('${ESTRANHO}', 'estranho@exemplo.invalido', now()),
    ('${DONO_DUAS}', 'duas@exemplo.invalido', now()),
    ('${ROBO}', 'robot+a@invalid.emyleads.local', now()),
    ('${ROBO_B}', 'robot+b@invalid.emyleads.local', now()),
    ('${ROBO_DUAS_A}', 'robot+da@invalid.emyleads.local', now()),
    ('${ROBO_DUAS_B}', 'robot+db@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const empresaNoPlano = async (dono, email, plano, nome) => {
  const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, $2, 7)", [email, plano])).rows[0].access_code;
  return (await como(usuario(dono), "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
};
const org = await empresaNoPlano(DONO, "major@exemplo.invalido", "full", "Major");
const orgDuas = await empresaNoPlano(DONO_DUAS, "duas@exemplo.invalido", "full", "Duas conexões");
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [org, VENDEDORA]);
// A "Duas conexões" tem o número antigo desligado pela data (`revoked_at`) com
// o status e a credencial do robô ainda ativos — o banco só deixa uma conexão
// VIVA por empresa (`whatsapp_connections_one_live_per_org`), e é esse resto
// que a regra antiga (`order by updated_at`) podia escolher.
for (const [o, conexao, robo, desligada] of [
  [org, CONEXAO, ROBO, false], [orgDuas, CONEXAO_DUAS_B, ROBO_DUAS_B, true], [orgDuas, CONEXAO_DUAS_A, ROBO_DUAS_A, false],
]) {
  await db.query(`insert into public.whatsapp_connections (id, organization_id, name, revoked_at) values ($1, $2, $3, ${desligada ? "now()" : "null"})`,
    [conexao, o, `WhatsApp ${conexao.slice(-4)}`]);
  await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [conexao, o, robo]);
}
await db.query("update public.whatsapp_connections set updated_at = now() + interval '1 hour' where id = $1", [CONEXAO_DUAS_B]);
const robo = (sub, o, conexao) => ({ sub, role: "authenticated", app_metadata: { is_robot: "true", organization_id: o, connection_id: conexao } });
const roboA = robo(ROBO, org, CONEXAO);
const rpc = async (quem, sql, params) => (await como(quem, sql, params)).rows[0].r;

// --------------------------------------------------------------- os fluxos
const canvas = (conexoes) => ({ versao: 3, nos: [], conexoes });
const ESPERA = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "oi", tipo: "enviar_mensagem", texto: "Oi" },
    { id: "espera", tipo: "aguardar", duracao: 1, unidade: "horas" },
    { id: "cobra", tipo: "enviar_mensagem", texto: "Ficou alguma dúvida?" },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: canvas([
    { source: "entrada", saida: "padrao", target: "condicoes" },
    { source: "condicoes", saida: "padrao", target: "oi" },
    { source: "oi", saida: "padrao", target: "espera" },
    { source: "espera", saida: "respondeu", target: "fim" },
    { source: "espera", saida: "sem_resposta", target: "cobra" },
    { source: "cobra", saida: "padrao", target: "fim" },
  ]),
};
const MENU = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "menu", tipo: "perguntar", texto: "Escolha", opcoes: [{ id: "a", rotulo: "Agendar" }, { id: "b", rotulo: "Preços" }] },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: canvas([
    { source: "entrada", saida: "padrao", target: "condicoes" },
    { source: "condicoes", saida: "padrao", target: "menu" },
    { source: "menu", saida: "a", target: "fim" },
    { source: "menu", saida: "b", target: "fim" },
    { source: "menu", saida: "nao_resolvido", target: "fim" },
  ]),
};
const grava = (o, dono, nome, definicao, id = randomUUID()) =>
  db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,$3,$4,$4,$5::jsonb)",
    [id, o, nome, dono, JSON.stringify(definicao)]).then(() => id);
const versaoDe = async (id) => Number((await um("select version from public.chatbot_definitions where id=$1", [id])).version);

const fluxoEspera = await grava(org, DONO, "Espera", ESPERA);
const fluxoMenu = await grava(org, DONO, "Menu", MENU);

// ------------------------------------------------------ aplica a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
confere("a migration aplica sobre a cadeia inteira", true);
confere("a reaplicação é recusada pela guarda", /ja foi aplicada/.test(await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)))));
await db.exec("rollback");
const respostas = (await db.query(`select oid::regprocedure::text f, prosrc from pg_proc
  where proname = 'nucleo_flow_answer' and pronamespace = 'public'::regnamespace`)).rows;
confere("continua havendo uma resposta só, na mesma forma", respostas.length === 1 && respostas[0].f === respostaAntes[0].f,
  respostas.map((r) => r.f).join(" | "));
confere("a resposta tem a troca da robustez", respostas[0].prosrc.includes("Robustez (0.3)"));
if (ETAPA9) confere("com a Etapa 9, a resposta mantém o decided_by", respostas[0].prosrc.includes("last_decided_by=case"));

const comeca = (quem, fluxo, telefone, mensagem) =>
  versaoDe(fluxo).then((v) => rpc(quem, "select public.nucleo_flow_start($1,$2,$3,$4,$5,0) r", [telefone, mensagem, fluxo, v, randomUUID()]));
const reserva = (quem, exec) => rpc(quem, "select public.nucleo_flow_claim($1,$2) r", [exec.executionId, exec.revision]);
const confirma = (quem, exec, token, saida = "padrao", efeito = "confirmed") =>
  rpc(quem, "select public.nucleo_flow_ack($1,$2,$3,$4) r", [exec.executionId, token, saida, efeito]);
const atual = (quem, telefone) => rpc(quem, "select public.nucleo_flow_current($1) r", [telefone]);
const responde = (quem, exec, suspensao, telefone, saida, valor = null) =>
  rpc(quem, "select public.nucleo_flow_answer($1,$2,$3,$4,$5) r", [exec, suspensao, telefone, saida, valor]);

// ------------------------------------------------------ 1. 0.1 running
let e1 = await comeca(roboA, fluxoEspera, "5565900000001", "m-1");
let c1 = await atual(roboA, "5565900000001");
confere("0.1: execução ready aparece como running", c1.status === "running" && c1.executionStatus === "ready" && c1.executionId === e1.executionId, JSON.stringify(c1));
const r1 = await reserva(roboA, e1);
c1 = await atual(roboA, "5565900000001");
confere("0.1: execução executing aparece como running", c1.status === "running" && c1.executionStatus === "executing");
const incerto = await confirma(roboA, e1, r1.claimToken, "", "uncertain");
c1 = await atual(roboA, "5565900000001");
confere("0.1: execução needs_review aparece como running", incerto.status === "needs_review" && c1.executionStatus === "needs_review");
confere("0.1: running não traz nada além de ids e estado",
  JSON.stringify(Object.keys(c1).sort()) === JSON.stringify(["executionId", "executionStatus", "requesterPhone", "status"]));
confere("0.1: sem execução viva, none", (await atual(roboA, "5565900000099")).status === "none");

// ------------------------------------------------------ 2. 0.3 depois do prazo
const ateAEspera = async (telefone, msg) => {
  let e = await comeca(roboA, fluxoEspera, telefone, msg);
  let r = await reserva(roboA, e);
  e = await confirma(roboA, e, r.claimToken);
  r = await reserva(roboA, e);
  e = await confirma(roboA, e, r.claimToken, "");
  return e;
};
let e2 = await ateAEspera("5565900000002", "m-2");
confere("0.3: a espera suspende", e2.status === "suspended" && e2.waiting === "timer");
confere("0.3: sem_resposta antes do prazo continua recusado",
  /not expired/.test(await erroDe(() => responde(roboA, e2.executionId, e2.suspensionId, "5565900000002", "sem_resposta"))));
await db.query("update public.chatbot_flow_executions set suspension_expires_at=now()-interval '1 second' where id=$1", [e2.executionId]);
const c2 = await atual(roboA, "5565900000002");
confere("0.3: a suspensão vencida ainda não fechada é devolvida", c2.status === "suspended" && c2.waiting === "timer" && c2.step?.id === "espera");
const respondeu = await responde(roboA, e2.executionId, e2.suspensionId, "5565900000002", "respondeu");
confere("0.3: respondeu 1 s depois do prazo vence a cobrança", respondeu.status === "ready" && respondeu.cursor === "fim" && respondeu.reason === null,
  JSON.stringify({ s: respondeu.status, c: respondeu.cursor, r: respondeu.reason }));
confere("0.3: depois disso o relógio não cobra (a suspensão acabou)",
  /suspension invalid/.test(await erroDe(() => responde(roboA, e2.executionId, e2.suspensionId, "5565900000002", "sem_resposta"))));

let e3 = await ateAEspera("5565900000003", "m-3");
await db.query("update public.chatbot_flow_executions set suspension_expires_at=now()-interval '1 second' where id=$1", [e3.executionId]);
const cobrou = await responde(roboA, e3.executionId, e3.suspensionId, "5565900000003", "sem_resposta");
confere("0.3: sem ninguém responder, o relógio segue por sem_resposta", cobrou.cursor === "cobra" && cobrou.reason === "wait_elapsed");

let m4 = await comeca(roboA, fluxoMenu, "5565900000004", "m-4");
let rm4 = await reserva(roboA, m4);
m4 = await confirma(roboA, m4, rm4.claimToken, "");
await db.query("update public.chatbot_flow_executions set suspension_expires_at=now()-interval '1 second' where id=$1", [m4.executionId]);
const escolheu = await responde(roboA, m4.executionId, m4.suspensionId, "5565900000004", "b");
confere("0.3: a opção escolhida depois do prazo vale", escolheu.status === "ready" && escolheu.lastOutcome === "b" && escolheu.reason === null);

// ------------------------------------------------------ 3. A7 nono dígito
let e5 = await comeca(roboA, fluxoEspera, "5565999990005", "m-5");
const c5 = await atual(roboA, "556599990005");
confere("A7: o telefone sem o 9 acha a execução do telefone com o 9", c5.status === "running" && c5.executionId === e5.executionId);
confere("A7: e o start pela outra forma recusa (fluxo vivo)",
  /already running/.test(await erroDe(() => comeca(roboA, fluxoEspera, "556599990005", "m-5b"))));

// ------------------------------------------------------ 4. P2 prazo
const envelhece = (id, horas) => db.query(`update public.chatbot_flow_executions set updated_at=now()-interval '${horas} hours' where id=$1`, [id]);
const pendentes = () => rpc(roboA, "select public.nucleo_flow_pending() r", []);
const eventos = (id) => quantos("select count(*)::int n from public.contact_events where event_type='flow.expired' and payload->>'executionId'=$1", [id]);

await envelhece(e1.executionId, 23);
await pendentes();
confere("P2: needs_review com 23 h ainda não fecha",
  (await um("select status from public.chatbot_flow_executions where id=$1", [e1.executionId])).status === "needs_review");
await envelhece(e1.executionId, 25);
await pendentes();
let fechada = await um("select status, reason from public.chatbot_flow_executions where id=$1", [e1.executionId]);
confere("P2: needs_review com 25 h fecha como review_expired", fechada.status === "cancelled" && fechada.reason === "review_expired", JSON.stringify(fechada));
await pendentes();
confere("P2: flow.expired gravado uma vez só", (await eventos(e1.executionId)) === 1);
confere("P2: o contato volta a poder começar fluxo", (await erroDe(() => comeca(roboA, fluxoEspera, "5565900000001", "m-1b"))) === "");

const e6 = await comeca(roboA, fluxoEspera, "5565900000006", "m-6");
await envelhece(e6.executionId, 30);
const recomeco = await erroDe(() => comeca(roboA, fluxoEspera, "5565900000006", "m-6b"));
fechada = await um("select status, reason from public.chatbot_flow_executions where id=$1", [e6.executionId]);
confere("P2: ready parado fecha como execution_expired no próprio start", recomeco === "" && fechada.reason === "execution_expired", recomeco || JSON.stringify(fechada));
confere("P2: e grava flow.expired", (await eventos(e6.executionId)) === 1);

const e7 = await comeca(roboA, fluxoEspera, "5565900000007", "m-7");
await envelhece(e7.executionId, 30);
await como(usuario(DONO), "select public.nucleo_flow_settings_save($1, 48, null)", [org]);
await pendentes();
confere("P2: com 48 h na organização, 30 h não fecham",
  (await um("select status from public.chatbot_flow_executions where id=$1", [e7.executionId])).status === "ready");
await como(usuario(DONO), "select public.nucleo_flow_settings_save($1, 24, null)", [org]);

const fluxoCurto = await grava(org, DONO, "Prazo curto", { ...ESPERA, prazoExecucaoHoras: 2 });
const e8 = await comeca(roboA, fluxoCurto, "5565900000008", "m-8");
await envelhece(e8.executionId, 3);
await pendentes();
confere("P2: o prazo do fluxo (2 h) vale sobre o da organização",
  (await um("select reason from public.chatbot_flow_executions where id=$1", [e8.executionId])).reason === "execution_expired");

const e9 = await ateAEspera("5565900000009", "m-9");
await envelhece(e9.executionId, 100);
await pendentes();
confere("P2: suspensa não fecha pelo prazo da execução (tem o próprio)",
  (await um("select status from public.chatbot_flow_executions where id=$1", [e9.executionId])).status === "suspended");

const valida = (definicao) => erroDe(() => db.query("select private.flow_validate($1::jsonb)", [JSON.stringify(definicao)]));
confere("P2: flow_validate aceita prazoExecucaoHoras 6", (await valida({ ...ESPERA, prazoExecucaoHoras: 6 })) === "");
for (const ruim of [0, 721, "12", 1.5]) {
  confere(`P2: flow_validate recusa prazoExecucaoHoras ${JSON.stringify(ruim)}`,
    /deadline invalid/.test(await valida({ ...ESPERA, prazoExecucaoHoras: ruim })));
}
confere("P2: só quem administra grava o prazo",
  /management required/.test(await erroDe(() => como(usuario(VENDEDORA), "select public.nucleo_flow_settings_save($1, 12, null)", [org]))));
confere("P2: prazo fora de 1 a 720 é recusado",
  /deadline invalid/.test(await erroDe(() => como(usuario(DONO), "select public.nucleo_flow_settings_save($1, 0, null)", [org]))));
confere("P2: quem é da empresa lê a configuração",
  (await como(usuario(VENDEDORA), "select execution_timeout_hours h from public.organization_flow_settings where organization_id=$1", [org])).rows[0]?.h === 24);
confere("P2: quem não é não lê",
  (await como(usuario(ESTRANHO), "select 1 from public.organization_flow_settings where organization_id=$1", [org])).rows.length === 0);

// ------------------------------------------------------ 5. P3 gatilhos
const fluxoManual = await grava(org, DONO, "Follow-up", { ...ESPERA, gatilho: { tipo: "manual" } });
const contato = async (o, telefone) => (await um(
  "insert into public.contacts (organization_id, name, phone) values ($1, 'Cliente', $2) returning id", [o, telefone])).id;
const perfil = async (o) => (await um("select id from public.assistant_profiles where organization_id=$1 limit 1", [o]))?.id;
const conversa = async (o, conexao, contatoId, estado, quando = "now()") => db.query(
  `insert into public.conversation_intelligence_contexts (organization_id, connection_id, contact_id, assistant_profile_id, audience, channel,
     conversation_key_hash, state, last_message_at) values ($1,$2,$3,$4,'customer','whatsapp',$5,$6,${quando})`,
  [o, conexao, contatoId, await perfil(o), randomUUID().replace(/-/g, "").padEnd(64, "0"), estado]);
const comandos = (contatoId) => quantos(
  "select count(*)::int n from public.connection_runtime_commands where command_type='flow_trigger' and private_payload->>'contactId'=$1", [contatoId]);
const manual = (quem, contatoId, fluxo) => rpc(quem, "select public.nucleo_flow_trigger_manual($1,$2) r", [contatoId, fluxo]);

confere("P3: a empresa tem perfil de assistente para a conversa", Boolean(await perfil(org)));
const assumido = await contato(org, "5565900000010");
await conversa(org, CONEXAO, assumido, "handed_off");
const disparo = await manual(usuario(VENDEDORA), assumido, fluxoManual);
confere("P3: o manual com a conversa assumida enfileira e devolve ao bot",
  disparo.queued === 1 && disparo.returnedToBot === true && Boolean(disparo.commandId), JSON.stringify(disparo));
confere("P3: o handed_off encerrou", (await um(
  "select state from public.conversation_intelligence_contexts where contact_id=$1", [assumido])).state === "active");
const fila = await um("select connection_id, private_payload from public.connection_runtime_commands where id=$1", [disparo.commandId]);
confere("P3: o comando vai para a conexão da conversa", fila.connection_id === CONEXAO && fila.private_payload.manual === true);
const estado = await rpc(usuario(VENDEDORA), "select public.nucleo_flow_trigger_status($1) r", [disparo.commandId]);
confere("P3: o desfecho começa pendente", estado.status === "pending" && estado.started === null, JSON.stringify(estado));
await db.query("update public.connection_runtime_commands set status='completed', public_result='{\"started\": false, \"reason\": \"automation_paused\"}' where id=$1", [disparo.commandId]);
const final = await rpc(usuario(VENDEDORA), "select public.nucleo_flow_trigger_status($1) r", [disparo.commandId]);
confere("P3: o desfecho diz que não começou e por quê", final.status === "completed" && final.started === false && final.reason === "automation_paused");
confere("P3: quem não é da empresa não vê o desfecho",
  /not found/.test(await erroDe(() => como(usuario(ESTRANHO), "select public.nucleo_flow_trigger_status($1)", [disparo.commandId]))));
// O start da VPS aceita a conversa devolvida.
const startManual = await erroDe(() => comeca(roboA, fluxoManual, "5565900000010", `gatilho:${disparo.commandId}`));
confere("P3: a VPS consegue começar o fluxo na conversa devolvida", startManual === "", startManual);
const ocupado = await erroDe(() => manual(usuario(VENDEDORA), assumido, fluxoManual));
confere("P3: com fluxo vivo, o manual recusa com o motivo", /already running for contact/.test(ocupado), ocupado);
confere("0.5: o gatilho automático não enfileira sobre fluxo vivo", await (async () => {
  const antes = await comandos(assumido);
  const n = (await um("select private.flow_trigger_enqueue($1,$2,'manual',$3,$4,'manual') n", [org, assumido, fluxoManual, DONO])).n;
  return n === 0 && (await comandos(assumido)) === antes;
})());

// Conexão por regra explícita.
const fluxoDuas = await grava(orgDuas, DONO_DUAS, "Follow-up", { ...ESPERA, gatilho: { tipo: "manual" } });
const antiga = (await um(`select w.id from public.whatsapp_connections w where w.organization_id = $1 and w.status <> 'revoked'
  and exists (select 1 from public.connection_robot_credentials r where r.connection_id = w.id and r.status = 'active' and r.revoked_at is null)
  order by w.updated_at desc limit 1`, [orgDuas])).id;
confere("P3: (antes) a regra do updated_at escolheria o número desligado", antiga === CONEXAO_DUAS_B);
const cliente = await contato(orgDuas, "5565900000011");
await conversa(orgDuas, CONEXAO_DUAS_B, cliente, "active");
const disparoDuas = await manual(usuario(DONO_DUAS), cliente, fluxoDuas);
confere("P3: o número desligado nunca é escolhido, nem pela última conversa", (await um(
  "select connection_id from public.connection_runtime_commands where id=$1", [disparoDuas.commandId])).connection_id === CONEXAO_DUAS_A);
await db.query("update public.connection_runtime_commands set status='expired' where id=$1", [disparoDuas.commandId]);
confere("P3: o número desligado não é aceito na configuração",
  /connection unavailable/.test(await erroDe(() => como(usuario(DONO_DUAS), "select public.nucleo_flow_settings_save($1, 24, $2)", [orgDuas, CONEXAO_DUAS_B]))));
confere("P3: conexão de outra empresa não é aceita na configuração",
  /connection unavailable/.test(await erroDe(() => como(usuario(DONO_DUAS), "select public.nucleo_flow_settings_save($1, 24, $2)", [orgDuas, CONEXAO]))));
confere("P3: a conexão viva é aceita na configuração",
  (await erroDe(() => como(usuario(DONO_DUAS), "select public.nucleo_flow_settings_save($1, 24, $2)", [orgDuas, CONEXAO_DUAS_A]))) === "");
const configurada = await manual(usuario(DONO_DUAS), cliente, fluxoDuas);
confere("P3: com a conexão configurada, o comando vai por ela", (await um(
  "select connection_id from public.connection_runtime_commands where id=$1", [configurada.commandId])).connection_id === CONEXAO_DUAS_A);
await db.query("update public.connection_runtime_commands set status='expired' where id=$1", [configurada.commandId]);
await db.query("update public.connection_robot_credentials set status='revoked', revoked_at=now() where connection_id=$1", [CONEXAO_DUAS_A]);
const semConexao = await erroDe(() => manual(usuario(DONO_DUAS), cliente, fluxoDuas));
confere("P3: sem conexão que rode, o manual recusa com o motivo (sem adivinhar)", /connection unavailable/.test(semConexao), semConexao);
confere("P3: e o gatilho automático não enfileira", (await um(
  "select private.flow_trigger_enqueue($1,$2,'manual',$3,$4,'manual') n", [orgDuas, cliente, fluxoDuas, DONO_DUAS])).n === 0);
const assumidoSemConexao = await contato(orgDuas, "5565900000012");
await conversa(orgDuas, CONEXAO_DUAS_A, assumidoSemConexao, "handed_off");
await erroDe(() => manual(usuario(DONO_DUAS), assumidoSemConexao, fluxoDuas));
confere("P3: o manual recusado não devolve a conversa ao bot", (await um(
  "select state from public.conversation_intelligence_contexts where contact_id=$1", [assumidoSemConexao])).state === "handed_off");

// O freio da etiqueta (A6).
const tag = (await um("insert into public.tags (organization_id, name) values ($1, 'VIP') returning id", [org])).id;
await grava(org, DONO, "Pela etiqueta", { ...ESPERA, gatilho: { tipo: "etiqueta", etiquetaId: tag } });
const livre = await contato(org, "5565900000013");
await db.transaction(async (tx) => {
  await tx.query("select set_config('nucleo.flow_origin','motor',true)");
  await tx.query("insert into public.contact_tags (organization_id, contact_id, tag_id) values ($1,$2,$3)", [org, livre, tag]);
});
confere("A6: etiqueta aplicada pelo motor não dispara gatilho", (await comandos(livre)) === 0);
await db.query("delete from public.contact_tags where contact_id=$1", [livre]);
await como(usuario(DONO), "insert into public.contact_tags (organization_id, contact_id, tag_id) values ($1,$2,$3)", [org, livre, tag]);
confere("A6: a mesma etiqueta aplicada por gente dispara", (await comandos(livre)) === 1);

// O ack de "Editar etiquetas" marca a origem (e desmarca depois).
const ETIQUETA = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [{ id: "tag", tipo: "editar_etiquetas", adicionar: [tag], remover: [] }, { id: "fim", tipo: "encerrar" }],
  canvas: canvas([
    { source: "entrada", saida: "padrao", target: "condicoes" },
    { source: "condicoes", saida: "padrao", target: "tag" },
    { source: "tag", saida: "padrao", target: "fim" },
  ]),
};
const fluxoEtiqueta = await grava(org, DONO, "Etiqueta", ETIQUETA);
let et = await comeca(roboA, fluxoEtiqueta, "5565900000014", "m-14");
const contatoEt = (await um("select contact_id from public.chatbot_flow_executions where id=$1", [et.executionId])).contact_id;
const ret = await reserva(roboA, et);
et = await confirma(roboA, et, ret.claimToken);
confere("A6: o ack de Editar etiquetas aplica a etiqueta", (await quantos(
  "select count(*)::int n from public.contact_tags where contact_id=$1 and tag_id=$2", [contatoEt, tag])) === 1);
confere("A6: e não enfileira o fluxo de gatilho dessa etiqueta", (await comandos(contatoEt)) === 0);

// ------------------------------------------------------ 6. permissões
for (const assinatura of [
  "private.flow_expire_stale($1, $2, null)",
  "private.flow_trigger_connection($1, $2)",
  "private.flow_contact_busy($1, $2)",
]) {
  const deFora = await erroDe(() => como(usuario(DONO), `select ${assinatura}`, [org, CONEXAO]));
  confere(`${assinatura.split("(")[0]} não é executável de fora`, /permission denied/.test(deFora), deFora);
}
confere("anon não lê o desfecho", /permission denied/.test(await erroDe(() => como(null, "select public.nucleo_flow_trigger_status($1)", [randomUUID()]))));

// ------------------------------------------------------ 7. rollback e volta
await db.exec(ler(ROLLBACK));
confere("o rollback tira a configuração", (await um("select to_regclass('public.organization_flow_settings') v")).v === null);
const correnteDepois = (await um("select prosrc from pg_proc where oid='public.nucleo_flow_current(text)'::regprocedure")).prosrc;
confere("o current volta ao corpo de 20260907010000", !correnteDepois.includes("running"));
confere("depois do rollback, o fluxo ainda começa", (await erroDe(() => comeca(roboA, fluxoEspera, "5565900000015", "m-15"))) === "");
const respostaDepois = (await db.query(`select md5(replace(prosrc, chr(13), '')) h, oid::regprocedure::text f from pg_proc
  where proname = 'nucleo_flow_answer' and pronamespace = 'public'::regnamespace`)).rows;
confere("o rollback devolve a resposta exatamente como estava", JSON.stringify(respostaDepois) === JSON.stringify(respostaAntes),
  JSON.stringify(respostaDepois));
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
confere("a migration reaplica depois do rollback", (await um("select to_regclass('public.organization_flow_settings') v")).v !== null);

console.log(`${passou.length} conferências passaram, ${falhas.length} falharam`);
for (const item of falhas) console.log(`  FALHOU ${item}`);
process.exit(falhas.length ? 1 : 0);
