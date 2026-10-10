// Prova comportamental da migration 20261012100000 (a troca voluntária de
// WhatsApp pelo portal, com confirmação no WhatsApp antigo) num Postgres
// embutido (PGlite), com o harness e TODAS as migrations reais, em ordem. A
// fila é a real: o robô da conexão pega e conclui os comandos pelas RPCs
// nucleo_runtime_commands_claim e nucleo_runtime_command_complete. Nada aqui
// toca produção.
//
// Limite: uma conexão de banco só. "Dois administradores" e "duplo clique"
// são chamadas em sequência; provam o estado de cada ordem, não a trava sob
// concorrência real.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-troca-voluntaria.mjs . && node prova-troca-voluntaria.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-troca-voluntaria.mjs <repo>");
const ALVO = "20261012100000_a_troca_voluntaria_de_numero.sql";
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const sha = (texto) => createHash("sha256").update(texto, "utf8").digest("hex");

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
if (!migrations.includes(ALVO)) throw new Error(`migration não achada: ${ALVO}`);
for (const f of migrations) {
  if (f >= ALVO) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}

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
  const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, 'full', 7)", [email])).rows[0].access_code;
  const id = (await como(usuario(dono), "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
  return { id, dono };
}
async function pessoa(id, org, papel) {
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, `${id.slice(-4)}@exemplo.invalido`]);
  await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)", [org, id, papel]);
}

const cliente = await empresa("Clínica Cliente");
const outra = await empresa("Outra Empresa");
const ADM2 = "eeeeeeee-0000-4000-8000-000000000002";
const MEMBRO = "eeeeeeee-0000-4000-8000-000000000003";
await pessoa(ADM2, cliente.id, "admin");
await pessoa(MEMBRO, cliente.id, "member");

const C = "cccccccc-0000-4000-8000-000000000001";
const ANTIGO = "5565999991111";
const NOVO = "5565999992222";
await db.query(
  "insert into public.whatsapp_connections (id, organization_id, name, expected_phone_hash, expected_phone_last4) values ($1, $2, 'Recepção', $3, '1111')",
  [C, cliente.id, sha(`${C}:${ANTIGO}`)],
);
const ROBO = "dddddddd-0000-4000-8000-000000000001";
const WORKER = "dddddddd-0000-4000-8000-000000000002";
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'robo@invalid.emyleads.local', now()), ($2, 'worker@invalid.emyleads.local', now())", [ROBO, WORKER]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [C, cliente.id, ROBO]);
const robo = { sub: ROBO, role: "authenticated", app_metadata: { is_robot: "true", organization_id: cliente.id, connection_id: C } };
const worker = { sub: WORKER, role: "authenticated", app_metadata: { is_notification_worker: "true", organization_id: cliente.id, connection_id: C } };
await db.query(`
  insert into public.connection_runtime_status (
    connection_id, organization_id, instance_id, bridge_status, whatsapp_status, assistant_status,
    mcp_status, agenda_status, heartbeat_at
  ) values ($1, $2, gen_random_uuid(), 'online', 'connected', 'online', 'configured', 'available', now())`,
[C, cliente.id]);
const INSTANCIA = randomUUID();

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${ALVO}`));
passou.push("migration aplicada sobre todas as anteriores");
const repete = await erroDe(() => db.exec(ler(`supabase/migrations/${ALVO}`)));
await db.exec("rollback");
confere("aplicar de novo aborta pela guarda", repete.includes("esta migration ja foi aplicada"), repete);

// --------------------------------------------------------------- utilitários
// O limite é de 5 pedidos por hora. Fora do teste do limite (T21), os pedidos
// anteriores "envelhecem" duas horas antes de cada pedido novo.
const envelhecer = () => db.query("update public.whatsapp_connection_change_requests set created_at = created_at - interval '2 hours'");
const comecarSemEnvelhecer = (quem, tipo, telefone = null, chave = randomUUID(), historico = false) =>
  como(usuario(quem), "select public.nucleo_connection_change_start($1, $2, $3, $4, $5, $6) as r",
    [cliente.id, C, tipo, telefone, historico, chave]).then((r) => r.rows[0].r);
const comecar = async (...args) => {
  await envelhecer();
  return comecarSemEnvelhecer(...args);
};
const confirmar = (quem, pedido, codigo) =>
  como(usuario(quem), "select public.nucleo_connection_change_confirm($1, $2, $3) as r", [cliente.id, pedido, codigo]).then((r) => r.rows[0].r);
const cancelar = (quem, pedido) =>
  como(usuario(quem), "select public.nucleo_connection_change_cancel($1, $2) as r", [cliente.id, pedido]).then((r) => r.rows[0].r);
const repetir = (quem, pedido) =>
  como(usuario(quem), "select public.nucleo_connection_change_retry($1, $2) as r", [cliente.id, pedido]).then((r) => r.rows[0].r);
const reenviar = (quem, pedido) =>
  como(usuario(quem), "select public.nucleo_connection_change_resend($1, $2) as r", [cliente.id, pedido]).then((r) => r.rows[0].r);
const estado = (quem) =>
  como(usuario(quem), "select public.nucleo_connection_change_status($1, $2) as r", [cliente.id, C]).then((r) => r.rows[0].r);
const pedidoDb = async (id) => (await db.query("select * from public.whatsapp_connection_change_requests where id = $1", [id])).rows[0];
const comandoDb = async (id) => (await db.query("select * from public.connection_runtime_commands where id = $1", [id])).rows[0];
const codigoDe = async (id) => (await comandoDb((await pedidoDb(id)).confirmation_command_id)).private_payload.code;
const roboPega = async () => (await como(robo, "select public.nucleo_runtime_commands_claim(20, $1) as r", [INSTANCIA])).rows[0].r.commands;
const roboConclui = (comando, status, erro = null, resultado = {}) =>
  como(robo, "select public.nucleo_runtime_command_complete($1, $2, $3, $4::jsonb, $5) as r", [comando, status, erro, JSON.stringify(resultado), INSTANCIA]);
const conexaoDb = async () => (await db.query("select * from public.whatsapp_connections where id = $1", [C])).rows[0];
const limparPedidos = () => db.query("update public.whatsapp_connection_change_requests set status = 'cancelled' where status in ('awaiting_confirmation', 'queued', 'running')");

// ------------------------------------------------- T0: o primeiro período
const inicial = (await db.query("select * from public.whatsapp_connection_identities where connection_id = $1", [C])).rows;
confere("T0 o número que a conexão esperava vira o período inicial (geração 0, aplicado)",
  inicial.length === 1 && inicial[0].generation === 0 && inicial[0].phone_last4 === "1111" && inicial[0].reason === "initial" && inicial[0].applied_at !== null);

// --------------------------------------------- T1: o interruptor nasce desligado
const desligado = await erroDe(() => comecar(cliente.dono, "change_number", NOVO));
confere("T1 com o interruptor desligado, nada começa", desligado.includes("connection change is not enabled"), desligado);
confere("T1 o status diz que a troca não está liberada", (await estado(cliente.dono)).enabled === false);
// DUBLÊ: o que o dono fará ao liberar, depois de revisar o contrato.
await db.exec("create or replace function private.connection_change_enabled() returns boolean language sql stable set search_path = '' as $$ select true $$;");

// ------------------------------------------------------------ T2: permissões
for (const [nome, claims, esperado] of [
  ["membro comum", usuario(MEMBRO), "organization management required"],
  ["dono de outra empresa", usuario(outra.dono), "organization management required"],
  ["robô da conexão", robo, "runtime credentials cannot change connections"],
  ["worker de avisos", worker, "runtime credentials cannot change connections"],
]) {
  const e = await erroDe(() => como(claims, "select public.nucleo_connection_change_start($1, $2, 'disconnect', null, false, $3)", [cliente.id, C, randomUUID()]));
  confere(`T2 ${nome} não começa troca`, e.includes(esperado), e);
}
const anonimo = await erroDe(() => como(null, "select public.nucleo_connection_change_start($1, $2, 'disconnect', null, false, $3)", [cliente.id, C, randomUUID()]));
confere("T2 anônimo não executa", /permission denied/i.test(anonimo), anonimo);
const estadoMembro = await erroDe(() => estado(MEMBRO));
confere("T2 membro comum não lê o estado da troca", estadoMembro.includes("organization management required"), estadoMembro);
const leituraDireta = await erroDe(() => como(usuario(cliente.dono), "select * from public.whatsapp_connection_identities"));
confere("T2 nem o dono lê a tabela de identidades direto (hash de telefone)", /permission denied/i.test(leituraDireta), leituraDireta);

// ------------------------------------------------------ T3: validações do pedido
const invalido = await erroDe(() => comecar(cliente.dono, "change_number", "123"));
confere("T3 número inválido", invalido.includes("invalid phone"), invalido);
const mesmo = await erroDe(() => comecar(cliente.dono, "change_number", "65 99999-1111"));
confere("T3 o mesmo número não é troca (com e sem 55)", mesmo.includes("same number"), mesmo);
const tipo = await erroDe(() => comecar(cliente.dono, "outra-coisa"));
confere("T3 tipo inválido", tipo.includes("change kind is invalid"), tipo);
await db.query("update public.connection_runtime_status set whatsapp_status = 'logged_out' where connection_id = $1", [C]);
const caido = await erroDe(() => comecar(cliente.dono, "change_number", NOVO));
confere("T3 sem o WhatsApp antigo conectado, não há como confirmar", caido.includes("old whatsapp is not connected"), caido);
await db.query("update public.connection_runtime_status set whatsapp_status = 'connected', heartbeat_at = now() - interval '5 minutes' where connection_id = $1", [C]);
const calado = await erroDe(() => comecar(cliente.dono, "change_number", NOVO));
confere("T3 sinal velho da VPS também recusa", calado.includes("old whatsapp is not connected"), calado);
await db.query("update public.connection_runtime_status set heartbeat_at = now() where connection_id = $1", [C]);

// ------------------------------------------------ T4/T5: começar, duplo clique
const CHAVE = randomUUID();
const p1 = await comecar(cliente.dono, "change_number", NOVO, CHAVE);
confere("T4 o pedido nasce aguardando o código", p1.status === "awaiting_confirmation" && p1.newLast4 === "2222" && p1.oldLast4 === "1111");
const codigo1 = await codigoDe(p1.requestId);
confere("T4 o código existe só na carga privada do comando (8 hex)", /^[0-9a-f]{8}$/.test(codigo1));
const visto = JSON.stringify(await estado(cliente.dono));
confere("T4 o estado não traz o código nem o telefone inteiro", !visto.includes(codigo1) && !visto.includes(NOVO) && !visto.includes(ANTIGO));
confere("T4 o banco guarda o hash, não o código", (await pedidoDb(p1.requestId)).code_hash === sha(`${p1.requestId}:${codigo1}`));
const repetido = await comecar(cliente.dono, "change_number", NOVO, CHAVE);
confere("T5 duplo clique (mesma chave): o mesmo pedido, sem código novo",
  repetido.requestId === p1.requestId && repetido.repeated === true && (await codigoDe(p1.requestId)) === codigo1);
const envios = (await db.query("select count(*)::int n from public.connection_runtime_commands where command_type = 'connection_confirmation_send'")).rows[0].n;
confere("T5 um envio de código só", envios === 1, String(envios));

// --------------------------------- T6: o robô envia o código (fila real)
const pegos = await roboPega();
const envio = pegos.find((c) => c.commandType === "connection_confirmation_send");
confere("T6 o robô recebe o envio com o código, o tipo e o final novo",
  envio?.payload?.code === codigo1 && envio.payload.kind === "change_number" && envio.payload.newLast4 === "2222");
await roboConclui(envio.commandId, "completed", null, { status: "sent" });
confere("T6 concluído o envio, a carga com o código é apagada", JSON.stringify((await comandoDb(envio.commandId)).private_payload) === "{}");
confere("T6 o pedido continua aguardando o código", (await pedidoDb(p1.requestId)).status === "awaiting_confirmation");

// --------------------------------------------------- T7/T8: confirmação errada
const outroAdmin = await erroDe(() => confirmar(ADM2, p1.requestId, codigo1));
confere("T7 só quem pediu confirma", outroAdmin.includes("only the requester can confirm"), outroAdmin);
const errado = await confirmar(cliente.dono, p1.requestId, "00000000");
confere("T8 código errado: não confirma e conta a tentativa", errado.confirmed === false && errado.result === "invalid-code" && errado.attemptsLeft === 4);
const lixo = await confirmar(cliente.dono, p1.requestId, "zz");
confere("T8 formato inválido conta como tentativa", lixo.result === "invalid-code" && lixo.attemptsLeft === 3);

// -------------------------------------------------------- T9: confirmação certa
const ok = await confirmar(cliente.dono, p1.requestId, codigo1.toUpperCase());
const depois = await pedidoDb(p1.requestId);
confere("T9 código certo (maiúsculas valem): fila com a geração 1", ok.confirmed === true && depois.status === "queued" && Number(depois.generation) === 1);
confere("T9 o código é consumido", depois.code_hash === null);
confere("T9 a conexão sobe a geração", Number((await conexaoDb()).control_generation) === 1);
confere("T9 o número esperado SÓ muda quando a VPS aplicar", (await conexaoDb()).expected_phone_last4 === "1111");
const acao = await comandoDb(depois.action_command_id);
confere("T9 a ação é connection_identity_replace com geração, final novo e antigo",
  acao.command_type === "connection_identity_replace" && acao.private_payload.generation === 1
  && acao.private_payload.newLast4 === "2222" && acao.private_payload.previousLast4 === "1111" && acao.private_payload.importHistory === false);
confere("T9 a ação não leva o telefone inteiro", !JSON.stringify(acao.private_payload).includes(NOVO));
const replay = await confirmar(cliente.dono, p1.requestId, codigo1);
confere("T10 o mesmo código de novo não faz nada (replay)", replay.confirmed === false && replay.result === "not-awaiting-confirmation");
const durante = await erroDe(() => comecar(ADM2, "disconnect"));
confere("T11 com uma troca confirmada na fila, outra não começa", durante.includes("a confirmed change is already in progress"), durante);

// ---------------------------------- T12: a VPS aplica; a identidade muda junto
const [acaoPega] = (await roboPega()).filter((c) => c.commandId === depois.action_command_id);
confere("T12 o robô pega a ação", !!acaoPega && acaoPega.payload.generation === 1);
confere("T12 pega pela VPS, o pedido fica em execução", (await pedidoDb(p1.requestId)).status === "running");
const cancelarDurante = await cancelar(cliente.dono, p1.requestId);
confere("T15c em execução não se cancela", cancelarDurante.cancelled === false && cancelarDurante.result === "in-progress");
await roboConclui(acaoPega.commandId, "completed", null, { status: "applied", generation: 1 });
const aplicado = await pedidoDb(p1.requestId);
confere("T12 aplicado", aplicado.status === "applied" && aplicado.applied_at !== null);
const periodos = (await db.query("select * from public.whatsapp_connection_identities where connection_id = $1 order by generation", [C])).rows;
confere("T12 o período antigo fecha e o novo abre aplicado, com o motivo voluntário",
  periodos.length === 2 && periodos[0].active_until !== null && periodos[1].active_until === null
  && periodos[1].phone_last4 === "2222" && periodos[1].reason === "voluntary" && Number(periodos[1].generation) === 1 && periodos[1].applied_at !== null);
const conexaoNova = await conexaoDb();
confere("T12 o número esperado da conexão passa a ser o novo (hash e final)",
  conexaoNova.expected_phone_last4 === "2222" && conexaoNova.expected_phone_hash === sha(`${C}:${NOVO}`));
const vistoDepois = await estado(cliente.dono);
confere("T12 o estado mostra a identidade nova (só o final)", vistoDepois.identity.last4 === "2222" && vistoDepois.request.status === "applied");

// ------------------------- T13: resultado com outra geração não aplica nada
let p2 = await comecar(cliente.dono, "disconnect");
await confirmar(cliente.dono, p2.requestId, await codigoDe(p2.requestId));
let p2db = await pedidoDb(p2.requestId);
const [acao2] = (await roboPega()).filter((c) => c.commandId === p2db.action_command_id);
await roboConclui(acao2.commandId, "completed", null, { status: "stale", reason: "stale-generation", generation: 0 });
p2db = await pedidoDb(p2.requestId);
confere("T13 resposta de geração velha: o pedido falha com o motivo", p2db.status === "failed" && p2db.error_code === "stale-generation", `${p2db.status}/${p2db.error_code}`);
confere("T13 nada muda na identidade", (await conexaoDb()).expected_phone_last4 === "2222");

// ---------------------------- T14: VPS fora do ar → falha recuperável → repetir
const r14 = await repetir(cliente.dono, p2.requestId);
const p2r = await pedidoDb(p2.requestId);
confere("T14 repetir sem código novo: geração nova, fila de novo", r14.status === "queued" && Number(p2r.generation) === Number(p2db.generation) + 1);
const [acao3] = (await roboPega()).filter((c) => c.commandId === p2r.action_command_id);
await roboConclui(acao3.commandId, "failed", "bridge_offline");
confere("T14 Bridge fora: falha com o motivo", (await pedidoDb(p2.requestId)).error_code === "bridge_offline");
await repetir(cliente.dono, p2.requestId);
const p2r2 = await pedidoDb(p2.requestId);
const [acao4] = (await roboPega()).filter((c) => c.commandId === p2r2.action_command_id);
await roboConclui(acao4.commandId, "completed", null, { status: "applied", generation: Number(p2r2.generation) });
confere("T14 a desconexão aplicada", (await pedidoDb(p2.requestId)).status === "applied");
confere("T14 desconectar não muda o número esperado", (await conexaoDb()).expected_phone_last4 === "2222");
// O comando velho (já concluído) não volta: geração e fila protegem.
confere("T14 a geração da conexão só subiu", Number((await conexaoDb()).control_generation) === Number(p2r2.generation));

// ------------------------------------------------------------ T15: cancelar
let p3 = await comecar(cliente.dono, "disconnect");
const c1 = await cancelar(cliente.dono, p3.requestId);
const p3db = await pedidoDb(p3.requestId);
confere("T15a cancelar aguardando o código", c1.cancelled === true && p3db.status === "cancelled" && p3db.code_hash === null);
confere("T15a o envio do código, se ainda na fila, expira", (await comandoDb(p3db.confirmation_command_id)).status === "expired");
let p4 = await comecar(cliente.dono, "disconnect");
await confirmar(cliente.dono, p4.requestId, await codigoDe(p4.requestId));
const c2 = await cancelar(cliente.dono, p4.requestId);
const p4db = await pedidoDb(p4.requestId);
confere("T15b cancelar confirmado mas ainda na fila: a ação expira e não roda",
  c2.cancelled === true && p4db.status === "cancelled" && (await comandoDb(p4db.action_command_id)).status === "expired");
confere("T15b o robô não recebe a ação cancelada", !(await roboPega()).some((c) => c.commandId === p4db.action_command_id));

// --------------------------------------------------- T16: dois administradores
const pA = await comecar(cliente.dono, "change_number", "5565999993333");
const codigoA = await codigoDe(pA.requestId);
const pB = await comecar(ADM2, "change_number", "5565999994444");
confere("T16 o pedido do segundo administrador substitui o do primeiro (ainda sem código)",
  (await pedidoDb(pA.requestId)).status === "superseded" && pB.status === "awaiting_confirmation");
const tardio = await confirmar(cliente.dono, pA.requestId, codigoA);
confere("T16 o código do pedido substituído não vale mais", tardio.confirmed === false && tardio.result === "not-awaiting-confirmation");

// -------------------------------- T17: identidade mudou entre pedido e código
const codigoB = await codigoDe(pB.requestId);
await db.query("update public.whatsapp_connections set expected_phone_last4 = '9999' where id = $1", [C]);
const mudou = await confirmar(ADM2, pB.requestId, codigoB);
confere("T17 identidade mudou: o pedido cai e nada se aplica", mudou.confirmed === false && mudou.result === "identity-changed" && (await pedidoDb(pB.requestId)).status === "cancelled");
await db.query("update public.whatsapp_connections set expected_phone_last4 = '2222' where id = $1", [C]);

// -------------------------------------------- T18: código vencido, tentativas
let p5 = await comecar(cliente.dono, "disconnect");
await db.query("update public.whatsapp_connection_change_requests set code_expires_at = now() - interval '1 second' where id = $1", [p5.requestId]);
const vencido = await confirmar(cliente.dono, p5.requestId, await codigoDe(p5.requestId));
confere("T18 código vencido não confirma", vencido.confirmed === false && vencido.result === "code-expired");
await cancelar(cliente.dono, p5.requestId);
let p6 = await comecar(cliente.dono, "disconnect");
for (let i = 0; i < 5; i += 1) await confirmar(cliente.dono, p6.requestId, "ffffffff");
const travado = await confirmar(cliente.dono, p6.requestId, await codigoDe(p6.requestId));
confere("T18 depois de 5 erros, nem o código certo confirma", travado.confirmed === false && travado.result === "too-many-attempts");

// ---------------------------------------------------------------- T19: reenviar
const semPressa = await erroDe(() => reenviar(cliente.dono, p6.requestId));
confere("T19 reenviar exige 30 s", semPressa.includes("wait before resending"), semPressa);
await db.query("update public.whatsapp_connection_change_requests set code_sent_at = now() - interval '1 minute' where id = $1", [p6.requestId]);
const naoSou = await erroDe(() => reenviar(ADM2, p6.requestId));
confere("T19 só quem pediu reenvia", naoSou.includes("only the requester can resend"), naoSou);
const codigoVelho = await codigoDe(p6.requestId);
const reenviado = await reenviar(cliente.dono, p6.requestId);
const codigoNovo = await codigoDe(p6.requestId);
confere("T19 reenviar gera código novo e zera as tentativas", reenviado.attemptsLeft === 5 && codigoNovo !== codigoVelho && reenviado.sendsLeft === 1);
const velhoNaoVale = await confirmar(cliente.dono, p6.requestId, codigoVelho);
confere("T19 o código anterior não vale mais", velhoNaoVale.result === "invalid-code");
await db.query("update public.whatsapp_connection_change_requests set code_sent_at = now() - interval '1 minute' where id = $1", [p6.requestId]);
await reenviar(cliente.dono, p6.requestId);
await db.query("update public.whatsapp_connection_change_requests set code_sent_at = now() - interval '1 minute' where id = $1", [p6.requestId]);
const limite = await erroDe(() => reenviar(cliente.dono, p6.requestId));
confere("T19 no máximo três envios por pedido", limite.includes("code send limit reached"), limite);
await cancelar(cliente.dono, p6.requestId);

// ------------------------------------- T20: a ação expira na fila (VPS parada)
await db.query("delete from public.whatsapp_connection_change_requests where created_at > now() - interval '2 hours' and status in ('cancelled', 'superseded')");
let p7 = await comecar(cliente.dono, "disconnect");
await confirmar(cliente.dono, p7.requestId, await codigoDe(p7.requestId));
let p7db = await pedidoDb(p7.requestId);
await db.query("update public.connection_runtime_commands set expires_at = now() - interval '1 second' where id = $1", [p7db.action_command_id]);
await roboPega(); // o claim marca o que venceu
p7db = await pedidoDb(p7.requestId);
confere("T20 ação vencida na fila: pedido expirado, recuperável", p7db.status === "expired");
await db.query("update public.whatsapp_connection_change_requests set confirmed_at = now() - interval '25 hours' where id = $1", [p7.requestId]);
const velho = await erroDe(() => repetir(cliente.dono, p7.requestId));
confere("T20 confirmação com mais de 24 h não se repete: pede troca nova", velho.includes("confirmation is too old"), velho);

// ----------------------------------------------------------- T21: limite por hora
await db.query("delete from public.whatsapp_connection_change_requests");
for (let i = 0; i < 5; i += 1) {
  const p = await comecarSemEnvelhecer(cliente.dono, "disconnect");
  await cancelar(cliente.dono, p.requestId);
}
const demais = await erroDe(() => comecarSemEnvelhecer(cliente.dono, "disconnect"));
confere("T21 no máximo cinco pedidos por hora por conexão", demais.includes("too many change requests"), demais);

// ------------------------------- T22: a conclusão do runtime nunca falha por causa da tela
await db.query("delete from public.whatsapp_connection_change_requests");
let p8 = await comecar(cliente.dono, "change_number", "5565999995555");
await confirmar(cliente.dono, p8.requestId, await codigoDe(p8.requestId));
const p8db = await pedidoDb(p8.requestId);
const [acao8] = (await roboPega()).filter((c) => c.commandId === p8db.action_command_id);
await db.exec("alter table public.whatsapp_connection_identities rename to identidades_quebradas");
const quebrada = await erroDe(() => roboConclui(acao8.commandId, "completed", null, { status: "applied", generation: Number(p8db.generation) }));
await db.exec("alter table public.identidades_quebradas rename to whatsapp_connection_identities");
confere("T22 um erro no gatilho não derruba a conclusão do runtime", quebrada === "", quebrada);
confere("T22 e o pedido não finge sucesso: continua em execução", (await pedidoDb(p8.requestId)).status === "running");

console.log(`\n${passou.length} ok, ${falhas.length} falhas\n`);
for (const p of passou) console.log(`  ok  ${p}`);
for (const f of falhas) console.log(`  FALHOU  ${f}`);
process.exit(falhas.length ? 1 : 0);
