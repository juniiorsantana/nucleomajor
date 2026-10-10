// Prova comportamental da migration 20261012100000 (a troca voluntária de
// WhatsApp pelo portal) num Postgres embutido (PGlite), com o harness e TODAS
// as migrations reais, em ordem. A fila é a real: o robô da conexão pega e
// conclui os comandos pelas RPCs nucleo_runtime_commands_claim e
// nucleo_runtime_command_complete. Nada aqui toca produção.
//
// Duas conexões, os dois modos de liberação:
//   M, da Major: 'direct', a operação controlada da ORCH-016, feita por um
//      administrador da plataforma que é dono da empresa;
//   C, de um cliente: 'whatsapp_code', o desenho da liberação geral, com o
//      código que a VPS mandaria ao WhatsApp antigo.
// As liberações são gravadas aqui como o SQL Editor gravaria: dublês do que o
// dono fará, não uma liberação real.
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

// Administrador da plataforma que emite os códigos de ativação. Não é de
// nenhuma das empresas.
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
const major = await empresa("Núcleo Major");
// O dono da Major também administra a plataforma.
await db.query("insert into public.platform_admins (user_id) values ($1)", [major.dono]);
const ADM2 = "eeeeeeee-0000-4000-8000-000000000002";
const MEMBRO = "eeeeeeee-0000-4000-8000-000000000003";
const MAJOR_ADM = "eeeeeeee-0000-4000-8000-000000000004";
await pessoa(ADM2, cliente.id, "admin");
await pessoa(MEMBRO, cliente.id, "member");
await pessoa(MAJOR_ADM, major.id, "admin");

const C = "cccccccc-0000-4000-8000-000000000001";
const M = "cccccccc-0000-4000-8000-000000000002";
const ANTIGO = "5565999991111";
const NOVO = "5565999992222";
// A Major como o WhatsApp a guarda: conta antiga, sem o nono dígito.
const MAJOR_ANTIGO = "556599998362";
const MAJOR_NOVO = "5565999997777";
await db.query(
  `insert into public.whatsapp_connections (id, organization_id, name, expected_phone_hash, expected_phone_last4)
   values ($1, $2, 'Recepção', $3, '1111'), ($4, $5, 'WhatsApp principal', $6, '8362')`,
  [C, cliente.id, sha(`${C}:${ANTIGO}`), M, major.id, sha(`${M}:${MAJOR_ANTIGO}`)],
);
// A Major tem a identidade verificada, como a reconciliação de 14/08 gravou.
await db.query(
  `update public.whatsapp_connections
   set verified_account_ref = $2, verified_phone_hash = $3, verified_phone_last4 = '8362', verified_at = now()
   where id = $1`,
  [M, sha(`emyleads:whatsapp-account:${MAJOR_ANTIGO}`), sha(`${M}:${MAJOR_ANTIGO}`)],
);
const ROBO_C = "dddddddd-0000-4000-8000-000000000001";
const WORKER = "dddddddd-0000-4000-8000-000000000002";
const ROBO_M = "dddddddd-0000-4000-8000-000000000003";
await db.query(
  `insert into auth.users (id, email, email_confirmed_at) values
   ($1, 'robo-c@invalid.emyleads.local', now()), ($2, 'worker@invalid.emyleads.local', now()), ($3, 'robo-m@invalid.emyleads.local', now())`,
  [ROBO_C, WORKER, ROBO_M],
);
await db.query(
  "insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3), ($4, $5, $6)",
  [C, cliente.id, ROBO_C, M, major.id, ROBO_M],
);
const robo = (sub, org, conn) => ({ sub, role: "authenticated", app_metadata: { is_robot: "true", organization_id: org, connection_id: conn } });
const worker = { sub: WORKER, role: "authenticated", app_metadata: { is_notification_worker: "true", organization_id: cliente.id, connection_id: C } };
for (const [conn, org] of [[C, cliente.id], [M, major.id]]) {
  await db.query(`
    insert into public.connection_runtime_status (
      connection_id, organization_id, instance_id, bridge_status, whatsapp_status, assistant_status,
      mcp_status, agenda_status, heartbeat_at
    ) values ($1, $2, gen_random_uuid(), 'online', 'connected', 'online', 'configured', 'available', now())`,
  [conn, org]);
}
const ctxC = { org: cliente.id, conn: C, robo: robo(ROBO_C, cliente.id, C), instancia: randomUUID() };
const ctxM = { org: major.id, conn: M, robo: robo(ROBO_M, major.id, M), instancia: randomUUID() };

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
const comecarSemEnvelhecer = (ctx, quem, tipo, telefone = null, chave = randomUUID(), historico = false) =>
  como(usuario(quem), "select public.nucleo_connection_change_start($1, $2, $3, $4, $5, $6) as r",
    [ctx.org, ctx.conn, tipo, telefone, historico, chave]).then((r) => r.rows[0].r);
const comecar = async (...args) => {
  await envelhecer();
  return comecarSemEnvelhecer(...args);
};
const confirmar = (ctx, quem, pedido, codigo = null) =>
  como(usuario(quem), "select public.nucleo_connection_change_confirm($1, $2, $3) as r", [ctx.org, pedido, codigo]).then((r) => r.rows[0].r);
const cancelar = (ctx, quem, pedido) =>
  como(usuario(quem), "select public.nucleo_connection_change_cancel($1, $2) as r", [ctx.org, pedido]).then((r) => r.rows[0].r);
const repetir = (ctx, quem, pedido) =>
  como(usuario(quem), "select public.nucleo_connection_change_retry($1, $2) as r", [ctx.org, pedido]).then((r) => r.rows[0].r);
const reenviar = (ctx, quem, pedido) =>
  como(usuario(quem), "select public.nucleo_connection_change_resend($1, $2) as r", [ctx.org, pedido]).then((r) => r.rows[0].r);
const estado = (ctx, quem) =>
  como(usuario(quem), "select public.nucleo_connection_change_status($1, $2) as r", [ctx.org, ctx.conn]).then((r) => r.rows[0].r);
const pedidoDb = async (id) => (await db.query("select * from public.whatsapp_connection_change_requests where id = $1", [id])).rows[0];
const comandoDb = async (id) => (await db.query("select * from public.connection_runtime_commands where id = $1", [id])).rows[0];
const codigoDe = async (id) => (await comandoDb((await pedidoDb(id)).confirmation_command_id)).private_payload.code;
const roboPega = async (ctx) => (await como(ctx.robo, "select public.nucleo_runtime_commands_claim(20, $1) as r", [ctx.instancia])).rows[0].r.commands;
const roboConclui = (ctx, comando, status, erro = null, resultado = {}) =>
  como(ctx.robo, "select public.nucleo_runtime_command_complete($1, $2, $3, $4::jsonb, $5) as r", [comando, status, erro, JSON.stringify(resultado), ctx.instancia]);
const conexaoDb = async (id) => (await db.query("select * from public.whatsapp_connections where id = $1", [id])).rows[0];
const statusDoRuntime = (conn, valor) =>
  db.query("update public.connection_runtime_status set whatsapp_status = $2, heartbeat_at = now() where connection_id = $1", [conn, valor]);
const auditoria = async (conn) =>
  (await db.query("select action, after, note from public.platform_audit_log where target = $1 order by id", [conn])).rows;
// A VPS pega a ação do pedido e a conclui como aplicada, com a geração certa.
async function aplicar(ctx, pedidoId, extra = {}) {
  const pedido = await pedidoDb(pedidoId);
  const [comando] = (await roboPega(ctx)).filter((c) => c.commandId === pedido.action_command_id);
  await roboConclui(ctx, comando.commandId, "completed", null, { status: "applied", generation: Number(pedido.generation), ...extra });
  return comando;
}

// ------------------------------------------------- T0: o primeiro período
const inicial = (await db.query("select * from public.whatsapp_connection_identities order by phone_last4")).rows;
confere("T0 o número que cada conexão esperava vira o período inicial (geração 0, aplicado)",
  inicial.length === 2 && inicial.every((p) => Number(p.generation) === 0 && p.reason === "initial" && p.applied_at !== null)
  && inicial.map((p) => p.phone_last4).join() === "1111,8362");

// ---------------------------------------------- T1: sem liberação, ninguém
const semLiberacao = await erroDe(() => comecar(ctxM, major.dono, "disconnect"));
confere("T1 sem liberação, nada começa (nem para a Major)", semLiberacao.includes("connection change is not enabled for this connection"), semLiberacao);
const estadoSem = await estado(ctxM, major.dono);
confere("T1 o status diz 'off' e que ninguém pode", estadoSem.mode === "off" && estadoSem.actorAllowed === false);
const semPrazo = await erroDe(() => db.query("insert into private.connection_change_policies (connection_id, mode, reason) values ($1, 'direct', 'sem prazo')", [M]));
confere("T1 a operação direta sem prazo é recusada pelo banco", /check constraint/i.test(semPrazo), semPrazo);
const prazoLongo = await erroDe(() => db.query(
  "insert into private.connection_change_policies (connection_id, mode, reason, expires_at) values ($1, 'direct', 'prazo longo', now() + interval '8 days')", [M]));
confere("T1 nem com prazo de mais de 7 dias", /check constraint/i.test(prazoLongo), prazoLongo);
await db.exec("create or replace function private.connection_change_default_mode() returns text language sql stable set search_path = '' as $$ select 'direct'::text $$;");
confere("T1 um padrão 'direct' vale como desligado: sem código extra nunca é para todos", (await estado(ctxC, cliente.dono)).mode === "off");
await db.exec("create or replace function private.connection_change_default_mode() returns text language sql stable set search_path = '' as $$ select 'off'::text $$;");
const autoLiberacao = await erroDe(() => como(usuario(cliente.dono),
  "insert into private.connection_change_policies (connection_id, mode, reason) values ($1, 'whatsapp_code', 'eu mesmo')", [C]));
confere("T1 o cliente não se libera sozinho", /permission denied/i.test(autoLiberacao), autoLiberacao);

// DUBLÊS do que o dono gravará pelo SQL Editor.
await db.query(
  "insert into private.connection_change_policies (connection_id, mode, reason, expires_at) values ($1, 'direct', 'Teste da troca na Major (dublê)', now() + interval '1 day')", [M]);
await db.query(
  "insert into private.connection_change_policies (connection_id, mode, reason) values ($1, 'whatsapp_code', 'Desenho da liberação geral (dublê)')", [C]);
confere("T1 a liberação fica no histórico da plataforma",
  (await auditoria(M)).some((a) => a.action === "whatsapp.change_policy_insert" && a.note.includes("Major")));

// ------------------------------------------------------------ T2: permissões
for (const [nome, claims, esperado] of [
  ["membro comum", usuario(MEMBRO), "organization management required"],
  ["dono de outra empresa", usuario(outra.dono), "organization management required"],
  ["administrador da plataforma de fora da empresa", usuario(ADMIN), "organization management required"],
  ["robô da conexão", ctxC.robo, "runtime credentials cannot change connections"],
  ["worker de avisos", worker, "runtime credentials cannot change connections"],
]) {
  const e = await erroDe(() => como(claims, "select public.nucleo_connection_change_start($1, $2, 'disconnect', null, false, $3)", [cliente.id, C, randomUUID()]));
  confere(`T2 ${nome} não começa troca`, e.includes(esperado), e);
}
const anonimo = await erroDe(() => como(null, "select public.nucleo_connection_change_start($1, $2, 'disconnect', null, false, $3)", [cliente.id, C, randomUUID()]));
confere("T2 anônimo não executa", /permission denied/i.test(anonimo), anonimo);
const estadoMembro = await erroDe(() => estado(ctxC, MEMBRO));
confere("T2 membro comum não lê o estado da troca", estadoMembro.includes("organization management required"), estadoMembro);
const estadoRobo = await erroDe(() => como(ctxC.robo, "select public.nucleo_connection_change_status($1, $2)", [cliente.id, C]));
confere("T2 o robô não lê o estado da troca", estadoRobo.includes("runtime credentials cannot read"), estadoRobo);
for (const tabela of ["whatsapp_connection_identities", "whatsapp_connection_change_requests"]) {
  const direta = await erroDe(() => como(usuario(cliente.dono), `select * from public.${tabela}`));
  confere(`T2 nem o dono lê ${tabela} direto`, /permission denied/i.test(direta), direta);
}
const admSemPlataforma = await erroDe(() => comecar(ctxM, MAJOR_ADM, "disconnect"));
confere("T2 operação direta: administrador da empresa que não é da plataforma não começa",
  admSemPlataforma.includes("requires a platform administrator"), admSemPlataforma);
const plataformaDeFora = await erroDe(() => comecar(ctxM, ADMIN, "disconnect"));
confere("T2 operação direta: administrador da plataforma de fora da empresa também não",
  plataformaDeFora.includes("organization management required"), plataformaDeFora);
const visaoAdm = await estado(ctxM, MAJOR_ADM);
confere("T2 o status mostra 'direct' e que esta pessoa não pode", visaoAdm.mode === "direct" && visaoAdm.actorAllowed === false);
confere("T2 para o dono da Major, que é da plataforma, pode", (await estado(ctxM, major.dono)).actorAllowed === true);

// ------------------------------------------------------ T3: validações do pedido
const invalido = await erroDe(() => comecar(ctxC, cliente.dono, "change_number", "123"));
confere("T3 número inválido", invalido.includes("invalid phone"), invalido);
const mesmo = await erroDe(() => comecar(ctxC, cliente.dono, "change_number", "65 99999-1111"));
confere("T3 o mesmo número não é troca (com e sem 55)", mesmo.includes("same number"), mesmo);
const mesmoSemNove = await erroDe(() => comecar(ctxM, major.dono, "change_number", "(65) 99999-8362"));
confere("T3 o mesmo número com o nono dígito, guardado sem ele, também não", mesmoSemNove.includes("same number"), mesmoSemNove);
const tipo = await erroDe(() => comecar(ctxC, cliente.dono, "outra-coisa"));
confere("T3 tipo inválido", tipo.includes("change kind is invalid"), tipo);
await statusDoRuntime(C, "logged_out");
const caido = await erroDe(() => comecar(ctxC, cliente.dono, "change_number", NOVO));
confere("T3 sem o WhatsApp antigo conectado, não há como confirmar", caido.includes("old whatsapp is not connected"), caido);
await db.query("update public.connection_runtime_status set whatsapp_status = 'connected', heartbeat_at = now() - interval '5 minutes' where connection_id = $1", [C]);
const calado = await erroDe(() => comecar(ctxC, cliente.dono, "change_number", NOVO));
confere("T3 VPS calada: recusa antes de enfileirar", calado.includes("runtime is not online"), calado);
await statusDoRuntime(C, "connected");

// ======================= A operação controlada da Major ('direct', ORCH-016)
const d1 = await comecar(ctxM, major.dono, "disconnect");
const d1db = await pedidoDb(d1.requestId);
confere("D1 desconectar na operação direta: aguarda a confirmação na tela, sem código",
  d1.status === "awaiting_confirmation" && d1.confirmationMethod === "direct" && d1db.code_hash === null && d1db.confirmation_command_id === null);
confere("D1 o pedido guarda a liberação sob a qual nasceu", d1db.policy_reason === "Teste da troca na Major (dublê)");
const filaAntes = (await db.query("select count(*)::int n from public.connection_runtime_commands where connection_id = $1", [M])).rows[0].n;
confere("D1 nada vai para a fila antes da confirmação", filaAntes === 0, String(filaAntes));
const outroConfirma = await erroDe(() => confirmar(ctxM, MAJOR_ADM, d1.requestId));
confere("D2 só quem pediu confirma", outroConfirma.includes("only the requester can confirm"), outroConfirma);
const d3 = await confirmar(ctxM, major.dono, d1.requestId);
const d3db = await pedidoDb(d1.requestId);
const acaoD = await comandoDb(d3db.action_command_id);
confere("D3 confirmar põe a desconexão na fila, com a geração 1",
  d3.confirmed === true && d3db.status === "queued" && Number(d3db.generation) === 1
  && acaoD.command_type === "connection_logout" && acaoD.private_payload.generation === 1);
confere("D3 a fila não é sucesso: a sessão só conta como liberada quando a VPS aplicar", (await conexaoDb(M)).session_released_at === null);
await aplicar(ctxM, d1.requestId, { remoteLogout: true });
const d4 = await pedidoDb(d1.requestId);
const mDesconectada = await conexaoDb(M);
confere("D4 a VPS aplica: pedido aplicado, sessão liberada, aparelho desligado no WhatsApp",
  d4.status === "applied" && d4.remote_logout === true && mDesconectada.session_released_at !== null);
confere("D4 desconectar não muda o número esperado",
  mDesconectada.expected_phone_last4 === "8362" && mDesconectada.expected_phone_hash === sha(`${M}:${MAJOR_ANTIGO}`));
confere("D4 nem a identidade verificada: o número continua sendo o mesmo",
  mDesconectada.verified_phone_last4 === "8362" && mDesconectada.verified_account_ref !== null);
const trilha = (await auditoria(M)).map((a) => a.action);
confere("D4 o histórico da plataforma tem pedido, confirmação e aplicação",
  ["whatsapp.change_requested", "whatsapp.change_confirmed", "whatsapp.change_applied"].every((x) => trilha.includes(x)), trilha.join(","));
const historico = JSON.stringify(await auditoria(M));
confere("D4 o histórico não guarda hash nem telefone", !historico.includes(sha(`${M}:${MAJOR_ANTIGO}`)) && !historico.includes(MAJOR_ANTIGO));

// O Bridge reinicia sem sessão e espera o portal.
await statusDoRuntime(M, "whatsapp_disconnected");
const d5 = await comecar(ctxM, major.dono, "change_number", "65 99999-7777");
confere("D5 desconectada por escolha, a conexão aceita outro número", d5.status === "awaiting_confirmation" && d5.newLast4 === "7777" && d5.oldLast4 === "8362");
await confirmar(ctxM, major.dono, d5.requestId);
const d5db = await pedidoDb(d5.requestId);
const acaoTroca = await comandoDb(d5db.action_command_id);
confere("D5 a troca vai à fila com o hash e o final do número novo, nunca o telefone",
  acaoTroca.command_type === "connection_identity_replace" && acaoTroca.private_payload.newPhoneHash === sha(`${M}:${MAJOR_NOVO}`)
  && acaoTroca.private_payload.newLast4 === "7777" && !JSON.stringify(acaoTroca.private_payload).includes(MAJOR_NOVO)
  && Number(d5db.generation) === 2);
await aplicar(ctxM, d5.requestId, { remoteLogout: false });
const mTrocada = await conexaoDb(M);
const periodosM = (await db.query("select * from public.whatsapp_connection_identities where connection_id = $1 order by generation", [M])).rows;
confere("D6 aplicada: o número esperado vira o novo, o período antigo fecha e o novo abre voluntário",
  mTrocada.expected_phone_last4 === "7777" && mTrocada.expected_phone_hash === sha(`${M}:${MAJOR_NOVO}`)
  && periodosM.length === 2 && periodosM[0].active_until !== null && periodosM[1].active_until === null
  && periodosM[1].reason === "voluntary" && Number(periodosM[1].generation) === 2);
confere("D6 a identidade verificada do número antigo deixa de valer (e solta o índice único)",
  mTrocada.verified_account_ref === null && mTrocada.verified_phone_hash === null
  && mTrocada.verified_phone_last4 === null && mTrocada.verified_at === null);
confere("D6 a conexão continua liberada até o número novo conectar", mTrocada.session_released_at !== null);
await statusDoRuntime(M, "awaiting_qr");
confere("D7 o QR na tela não encerra a liberação", (await conexaoDb(M)).session_released_at !== null);
await statusDoRuntime(M, "connected");
confere("D7 o número novo conectou: a liberação acaba", (await conexaoDb(M)).session_released_at === null);
await statusDoRuntime(M, "logged_out");
const caiu = await erroDe(() => comecar(ctxM, major.dono, "change_number", "65 99999-6666"));
confere("D8 o que caiu sozinho não vira troca voluntária", caiu.includes("old whatsapp is not connected"), caiu);
const desconectarCaido = await erroDe(() => comecar(ctxM, major.dono, "disconnect"));
confere("D8 nem desconexão voluntária de quem já caiu", desconectarCaido.includes("old whatsapp is not connected"), desconectarCaido);
await statusDoRuntime(M, "connected");
const d8 = await comecar(ctxM, major.dono, "disconnect");
const reenvioDireto = await erroDe(() => reenviar(ctxM, major.dono, d8.requestId));
confere("D8 na operação direta não há código para reenviar", reenvioDireto.includes("not confirmed by code"), reenvioDireto);
await db.query("update public.whatsapp_connection_change_requests set confirm_until = now() - interval '1 second' where id = $1", [d8.requestId]);
const vencidoNaTela = await confirmar(ctxM, major.dono, d8.requestId);
confere("D9 a confirmação na tela também vence em 10 minutos", vencidoNaTela.confirmed === false && vencidoNaTela.result === "expired");
await cancelar(ctxM, major.dono, d8.requestId);
const d10 = await comecar(ctxM, major.dono, "disconnect");
await db.query("update private.connection_change_policies set granted_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where connection_id = $1", [M]);
const liberacaoVencida = await erroDe(() => confirmar(ctxM, major.dono, d10.requestId));
confere("D10 a liberação venceu no meio: a confirmação é recusada", liberacaoVencida.includes("not enabled for this connection"), liberacaoVencida);
confere("D10 e o status volta a 'off'", (await estado(ctxM, major.dono)).mode === "off");
const cancelSemLiberacao = await cancelar(ctxM, major.dono, d10.requestId);
confere("D10 cancelar continua possível sem liberação", cancelSemLiberacao.cancelled === true);
confere("D10 a mudança da liberação também fica no histórico", (await auditoria(M)).some((a) => a.action === "whatsapp.change_policy_update"));

// =================== O desenho da liberação geral ('whatsapp_code', D2)
const CHAVE = randomUUID();
const p1 = await comecar(ctxC, cliente.dono, "change_number", NOVO, CHAVE);
confere("T4 o pedido nasce aguardando o código",
  p1.status === "awaiting_confirmation" && p1.confirmationMethod === "whatsapp_code" && p1.newLast4 === "2222" && p1.oldLast4 === "1111");
const codigo1 = await codigoDe(p1.requestId);
confere("T4 o código existe só na carga privada do comando (8 hex)", /^[0-9a-f]{8}$/.test(codigo1));
const visto = JSON.stringify(await estado(ctxC, cliente.dono));
confere("T4 o estado não traz o código nem o telefone inteiro", !visto.includes(codigo1) && !visto.includes(NOVO) && !visto.includes(ANTIGO));
confere("T4 o banco guarda o hash, não o código", (await pedidoDb(p1.requestId)).code_hash === sha(`${p1.requestId}:${codigo1}`));
const repetido = await comecar(ctxC, cliente.dono, "change_number", NOVO, CHAVE);
confere("T5 duplo clique (mesma chave): o mesmo pedido, sem código novo",
  repetido.requestId === p1.requestId && repetido.repeated === true && (await codigoDe(p1.requestId)) === codigo1);
const envios = (await db.query("select count(*)::int n from public.connection_runtime_commands where command_type = 'connection_confirmation_send'")).rows[0].n;
confere("T5 um envio de código só", envios === 1, String(envios));

const pegos = await roboPega(ctxC);
const envio = pegos.find((c) => c.commandType === "connection_confirmation_send");
confere("T6 o robô recebe o envio com o código, o tipo e o final novo",
  envio?.payload?.code === codigo1 && envio.payload.kind === "change_number" && envio.payload.newLast4 === "2222");
await roboConclui(ctxC, envio.commandId, "completed", null, { status: "sent" });
confere("T6 concluído o envio, a carga com o código é apagada", JSON.stringify((await comandoDb(envio.commandId)).private_payload) === "{}");
confere("T6 o pedido continua aguardando o código", (await pedidoDb(p1.requestId)).status === "awaiting_confirmation");

const outroAdmin = await erroDe(() => confirmar(ctxC, ADM2, p1.requestId, codigo1));
confere("T7 só quem pediu confirma", outroAdmin.includes("only the requester can confirm"), outroAdmin);
const errado = await confirmar(ctxC, cliente.dono, p1.requestId, "00000000");
confere("T8 código errado: não confirma e conta a tentativa", errado.confirmed === false && errado.result === "invalid-code" && errado.attemptsLeft === 4);
const lixo = await confirmar(ctxC, cliente.dono, p1.requestId, "zz");
confere("T8 formato inválido conta como tentativa", lixo.result === "invalid-code" && lixo.attemptsLeft === 3);
const semCodigo = await confirmar(ctxC, cliente.dono, p1.requestId, null);
confere("T8 sem código, no modo com código, também não confirma", semCodigo.result === "invalid-code" && semCodigo.attemptsLeft === 2);

const ok = await confirmar(ctxC, cliente.dono, p1.requestId, codigo1.toUpperCase());
const depois = await pedidoDb(p1.requestId);
confere("T9 código certo (maiúsculas valem): fila com a geração 1", ok.confirmed === true && depois.status === "queued" && Number(depois.generation) === 1);
confere("T9 o código é consumido", depois.code_hash === null);
confere("T9 a conexão sobe a geração", Number((await conexaoDb(C)).control_generation) === 1);
confere("T9 o número esperado SÓ muda quando a VPS aplicar", (await conexaoDb(C)).expected_phone_last4 === "1111");
const acao = await comandoDb(depois.action_command_id);
confere("T9 a ação leva geração, finais e o hash do número novo",
  acao.command_type === "connection_identity_replace" && acao.private_payload.generation === 1
  && acao.private_payload.newLast4 === "2222" && acao.private_payload.previousLast4 === "1111"
  && acao.private_payload.newPhoneHash === sha(`${C}:${NOVO}`) && acao.private_payload.importHistory === false);
confere("T9 a ação não leva o telefone inteiro", !JSON.stringify(acao.private_payload).includes(NOVO));
const replay = await confirmar(ctxC, cliente.dono, p1.requestId, codigo1);
confere("T10 o mesmo código de novo não faz nada (replay)", replay.confirmed === false && replay.result === "not-awaiting-confirmation");
const durante = await erroDe(() => comecar(ctxC, ADM2, "disconnect"));
confere("T11 com uma troca confirmada na fila, outra não começa", durante.includes("a confirmed change is already in progress"), durante);

const [acaoPega] = (await roboPega(ctxC)).filter((c) => c.commandId === depois.action_command_id);
confere("T12 o robô pega a ação", !!acaoPega && acaoPega.payload.generation === 1);
confere("T12 pega pela VPS, o pedido fica em execução", (await pedidoDb(p1.requestId)).status === "running");
const cancelarDurante = await cancelar(ctxC, cliente.dono, p1.requestId);
confere("T15c em execução não se cancela", cancelarDurante.cancelled === false && cancelarDurante.result === "in-progress");
await roboConclui(ctxC, acaoPega.commandId, "completed", null, { status: "applied", generation: 1, remoteLogout: true });
const aplicado = await pedidoDb(p1.requestId);
confere("T12 aplicado", aplicado.status === "applied" && aplicado.applied_at !== null && aplicado.remote_logout === true);
const periodos = (await db.query("select * from public.whatsapp_connection_identities where connection_id = $1 order by generation", [C])).rows;
confere("T12 o período antigo fecha e o novo abre aplicado, com o motivo voluntário",
  periodos.length === 2 && periodos[0].active_until !== null && periodos[1].active_until === null
  && periodos[1].phone_last4 === "2222" && periodos[1].reason === "voluntary" && Number(periodos[1].generation) === 1 && periodos[1].applied_at !== null);
const conexaoNova = await conexaoDb(C);
confere("T12 o número esperado da conexão passa a ser o novo (hash e final)",
  conexaoNova.expected_phone_last4 === "2222" && conexaoNova.expected_phone_hash === sha(`${C}:${NOVO}`));
const vistoDepois = await estado(ctxC, cliente.dono);
confere("T12 o estado mostra a identidade nova (só o final) e a sessão liberada",
  vistoDepois.identity.last4 === "2222" && vistoDepois.request.status === "applied" && vistoDepois.sessionReleasedAt !== null);
await statusDoRuntime(C, "whatsapp_disconnected");
const semSessao = await erroDe(() => comecar(ctxC, cliente.dono, "disconnect"));
confere("T12 no modo com código, sem a sessão antiga não há como confirmar, mesmo liberada", semSessao.includes("old whatsapp is not connected"), semSessao);
await statusDoRuntime(C, "connected");

let p2 = await comecar(ctxC, cliente.dono, "disconnect");
await confirmar(ctxC, cliente.dono, p2.requestId, await codigoDe(p2.requestId));
let p2db = await pedidoDb(p2.requestId);
const [acao2] = (await roboPega(ctxC)).filter((c) => c.commandId === p2db.action_command_id);
await roboConclui(ctxC, acao2.commandId, "completed", null, { status: "stale", reason: "stale-generation", generation: 0 });
p2db = await pedidoDb(p2.requestId);
confere("T13 resposta de geração velha: o pedido falha com o motivo", p2db.status === "failed" && p2db.error_code === "stale-generation", `${p2db.status}/${p2db.error_code}`);
confere("T13 nada muda na identidade", (await conexaoDb(C)).expected_phone_last4 === "2222");

const r14 = await repetir(ctxC, cliente.dono, p2.requestId);
const p2r = await pedidoDb(p2.requestId);
confere("T14 repetir sem código novo: geração nova, fila de novo", r14.status === "queued" && Number(p2r.generation) === Number(p2db.generation) + 1);
const [acao3] = (await roboPega(ctxC)).filter((c) => c.commandId === p2r.action_command_id);
await roboConclui(ctxC, acao3.commandId, "failed", "bridge_offline");
confere("T14 Bridge fora: falha com o motivo", (await pedidoDb(p2.requestId)).error_code === "bridge_offline");
await repetir(ctxC, cliente.dono, p2.requestId);
const p2r2 = await pedidoDb(p2.requestId);
await aplicar(ctxC, p2.requestId);
confere("T14 a desconexão aplicada", (await pedidoDb(p2.requestId)).status === "applied");
confere("T14 desconectar não muda o número esperado", (await conexaoDb(C)).expected_phone_last4 === "2222");
confere("T14 a geração da conexão só subiu", Number((await conexaoDb(C)).control_generation) === Number(p2r2.generation));

const p3 = await comecar(ctxC, cliente.dono, "disconnect");
const c1 = await cancelar(ctxC, cliente.dono, p3.requestId);
const p3db = await pedidoDb(p3.requestId);
confere("T15a cancelar aguardando o código", c1.cancelled === true && p3db.status === "cancelled" && p3db.code_hash === null);
confere("T15a o envio do código, se ainda na fila, expira", (await comandoDb(p3db.confirmation_command_id)).status === "expired");
const p4 = await comecar(ctxC, cliente.dono, "disconnect");
await confirmar(ctxC, cliente.dono, p4.requestId, await codigoDe(p4.requestId));
const c2 = await cancelar(ctxC, cliente.dono, p4.requestId);
const p4db = await pedidoDb(p4.requestId);
confere("T15b cancelar confirmado mas ainda na fila: a ação expira e não roda",
  c2.cancelled === true && p4db.status === "cancelled" && (await comandoDb(p4db.action_command_id)).status === "expired");
confere("T15b o robô não recebe a ação cancelada", !(await roboPega(ctxC)).some((c) => c.commandId === p4db.action_command_id));

const pA = await comecar(ctxC, cliente.dono, "change_number", "5565999993333");
const codigoA = await codigoDe(pA.requestId);
const pB = await comecar(ctxC, ADM2, "change_number", "5565999994444");
confere("T16 o pedido do segundo administrador substitui o do primeiro (ainda sem código)",
  (await pedidoDb(pA.requestId)).status === "superseded" && pB.status === "awaiting_confirmation");
const tardio = await confirmar(ctxC, cliente.dono, pA.requestId, codigoA);
confere("T16 o código do pedido substituído não vale mais", tardio.confirmed === false && tardio.result === "not-awaiting-confirmation");

const codigoB = await codigoDe(pB.requestId);
await db.query("update public.whatsapp_connections set expected_phone_last4 = '9999' where id = $1", [C]);
const mudou = await confirmar(ctxC, ADM2, pB.requestId, codigoB);
confere("T17 identidade mudou: o pedido cai e nada se aplica",
  mudou.confirmed === false && mudou.result === "identity-changed" && (await pedidoDb(pB.requestId)).status === "cancelled");
await db.query("update public.whatsapp_connections set expected_phone_last4 = '2222' where id = $1", [C]);

const p5 = await comecar(ctxC, cliente.dono, "disconnect");
await db.query("update public.whatsapp_connection_change_requests set confirm_until = now() - interval '1 second' where id = $1", [p5.requestId]);
const vencido = await confirmar(ctxC, cliente.dono, p5.requestId, await codigoDe(p5.requestId));
confere("T18 código vencido não confirma", vencido.confirmed === false && vencido.result === "expired");
await cancelar(ctxC, cliente.dono, p5.requestId);
const p6 = await comecar(ctxC, cliente.dono, "disconnect");
for (let i = 0; i < 5; i += 1) await confirmar(ctxC, cliente.dono, p6.requestId, "ffffffff");
const travado = await confirmar(ctxC, cliente.dono, p6.requestId, await codigoDe(p6.requestId));
confere("T18 depois de 5 erros, nem o código certo confirma", travado.confirmed === false && travado.result === "too-many-attempts");

const semPressa = await erroDe(() => reenviar(ctxC, cliente.dono, p6.requestId));
confere("T19 reenviar exige 30 s", semPressa.includes("wait before resending"), semPressa);
await db.query("update public.whatsapp_connection_change_requests set code_sent_at = now() - interval '1 minute' where id = $1", [p6.requestId]);
const naoSou = await erroDe(() => reenviar(ctxC, ADM2, p6.requestId));
confere("T19 só quem pediu reenvia", naoSou.includes("only the requester can resend"), naoSou);
const codigoVelho = await codigoDe(p6.requestId);
const reenviado = await reenviar(ctxC, cliente.dono, p6.requestId);
const codigoNovo = await codigoDe(p6.requestId);
confere("T19 reenviar gera código novo e zera as tentativas", reenviado.attemptsLeft === 5 && codigoNovo !== codigoVelho && reenviado.sendsLeft === 1);
const velhoNaoVale = await confirmar(ctxC, cliente.dono, p6.requestId, codigoVelho);
confere("T19 o código anterior não vale mais", velhoNaoVale.result === "invalid-code");
await db.query("update public.whatsapp_connection_change_requests set code_sent_at = now() - interval '1 minute' where id = $1", [p6.requestId]);
await reenviar(ctxC, cliente.dono, p6.requestId);
await db.query("update public.whatsapp_connection_change_requests set code_sent_at = now() - interval '1 minute' where id = $1", [p6.requestId]);
const limite = await erroDe(() => reenviar(ctxC, cliente.dono, p6.requestId));
confere("T19 no máximo três envios por pedido", limite.includes("code send limit reached"), limite);
await cancelar(ctxC, cliente.dono, p6.requestId);

const p7 = await comecar(ctxC, cliente.dono, "disconnect");
await confirmar(ctxC, cliente.dono, p7.requestId, await codigoDe(p7.requestId));
let p7db = await pedidoDb(p7.requestId);
await db.query("update public.connection_runtime_commands set expires_at = now() - interval '1 second' where id = $1", [p7db.action_command_id]);
await roboPega(ctxC); // o claim marca o que venceu
p7db = await pedidoDb(p7.requestId);
confere("T20 ação vencida na fila: pedido expirado, recuperável", p7db.status === "expired");
await db.query("update public.whatsapp_connection_change_requests set confirmed_at = now() - interval '25 hours' where id = $1", [p7.requestId]);
const velho = await erroDe(() => repetir(ctxC, cliente.dono, p7.requestId));
confere("T20 confirmação com mais de 24 h não se repete: pede troca nova", velho.includes("confirmation is too old"), velho);

await db.query("delete from public.whatsapp_connection_change_requests where connection_id = $1", [C]);
for (let i = 0; i < 5; i += 1) {
  const p = await comecarSemEnvelhecer(ctxC, cliente.dono, "disconnect");
  await cancelar(ctxC, cliente.dono, p.requestId);
}
const demais = await erroDe(() => comecarSemEnvelhecer(ctxC, cliente.dono, "disconnect"));
confere("T21 no máximo cinco pedidos por hora por conexão", demais.includes("too many change requests"), demais);

await db.query("delete from public.whatsapp_connection_change_requests where connection_id = $1", [C]);
const p8 = await comecar(ctxC, cliente.dono, "change_number", "5565999995555");
await confirmar(ctxC, cliente.dono, p8.requestId, await codigoDe(p8.requestId));
const p8db = await pedidoDb(p8.requestId);
const [acao8] = (await roboPega(ctxC)).filter((c) => c.commandId === p8db.action_command_id);
await db.exec("alter table public.whatsapp_connection_identities rename to identidades_quebradas");
const quebrada = await erroDe(() => roboConclui(ctxC, acao8.commandId, "completed", null, { status: "applied", generation: Number(p8db.generation) }));
await db.exec("alter table public.identidades_quebradas rename to whatsapp_connection_identities");
confere("T22 um erro no gatilho não derruba a conclusão do runtime", quebrada === "", quebrada);
confere("T22 e o pedido não finge sucesso: continua em execução", (await pedidoDb(p8.requestId)).status === "running");

await db.query("delete from public.whatsapp_connection_change_requests where connection_id = $1", [C]);
const p9 = await comecar(ctxC, cliente.dono, "disconnect");
const p9db = await pedidoDb(p9.requestId);
const [envio9] = (await roboPega(ctxC)).filter((c) => c.commandId === p9db.confirmation_command_id);
await roboConclui(ctxC, envio9.commandId, "failed", "unsupported_command");
const p9depois = await pedidoDb(p9.requestId);
confere("T23 runtime ainda sem o transporte do código: a tela vê o motivo e nada é confirmado",
  p9depois.status === "awaiting_confirmation" && p9depois.error_code === "confirmation-unsupported_command");

// =========================== O aviso de segurança por e-mail (servidor)
// O servidor do portal chama estas duas RPCs com a chave publicável (anon) e
// o token dele. Aqui, `como(null, ...)` é exatamente essa chamada.
const TOKEN_DO_SERVIDOR = "ab".repeat(32);
const pegarAvisos = (token, max = 20) =>
  como(null, "select public.nucleo_connection_change_notices_claim($1, $2) as r", [token, max]).then((r) => r.rows[0].r.notices);
const concluirAviso = (token, pedido, entregues, falhasNoEnvio) =>
  como(null, "select public.nucleo_connection_change_notice_done($1, $2, $3, $4) as r", [token, pedido, entregues, falhasNoEnvio])
    .then((r) => r.rows[0].r);
const aplicados = (await db.query("select notice_status from public.whatsapp_connection_change_requests where status = 'applied'")).rows;
confere("N1 toda troca ou desconexão aplicada deixa um aviso pendente",
  aplicados.length === 2 && aplicados.every((p) => p.notice_status === "pending"), String(aplicados.length));
const semToken = await erroDe(() => pegarAvisos("cd".repeat(32)));
confere("N2 sem o token gravado no banco, nada sai", semToken.includes("notice token is invalid"), semToken);
await db.query("insert into private.connection_change_notifier (token_hash) values ($1)", [sha(TOKEN_DO_SERVIDOR)]);
const tokenErrado = await erroDe(() => pegarAvisos("cd".repeat(32)));
confere("N2 com outro token, também não", tokenErrado.includes("notice token is invalid"), tokenErrado);
const tokenTorto = await erroDe(() => pegarAvisos("nao-e-um-token"));
confere("N2 nem com token fora do formato", tokenTorto.includes("notice token is invalid"), tokenTorto);
const avisos = await pegarAvisos(TOKEN_DO_SERVIDOR);
const daMajor = avisos.filter((a) => [d1.requestId, d5.requestId].includes(a.requestId));
confere("N3 o servidor pega os dois avisos da Major, a desconexão e a troca", avisos.length === 2 && daMajor.length === 2);
const avisoDaTroca = daMajor.find((a) => a.kind === "change_number");
confere("N3 o aviso traz empresa, finais e quem pediu",
  avisoDaTroca.organizationName === "Núcleo Major" && avisoDaTroca.oldLast4 === "8362"
  && avisoDaTroca.newLast4 === "7777" && avisoDaTroca.requesterEmail === "dono3@exemplo.invalido");
confere("N3 destinatários: os donos e administradores ativos da Major, e só eles",
  JSON.stringify(avisoDaTroca.recipients) === JSON.stringify(["0004@exemplo.invalido", "dono3@exemplo.invalido"]),
  JSON.stringify(avisoDaTroca.recipients));
confere("N3 sem hash nem telefone inteiro",
  !JSON.stringify(avisos).includes(MAJOR_NOVO) && !JSON.stringify(avisos).includes(sha(`${M}:${MAJOR_NOVO}`)));
confere("N4 pegar de novo logo em seguida não repete o aviso", (await pegarAvisos(TOKEN_DO_SERVIDOR)).length === 0);
const enviado = await concluirAviso(TOKEN_DO_SERVIDOR, avisoDaTroca.requestId, 2, 0);
confere("N5 com entrega: 'sent'", enviado.recorded === true && enviado.noticeStatus === "sent");
confere("N5 concluir de novo não muda nada", (await concluirAviso(TOKEN_DO_SERVIDOR, avisoDaTroca.requestId, 2, 0)).recorded === false);
const avisoDaDesconexao = daMajor.find((a) => a.kind === "disconnect");
const naoEntregue = await concluirAviso(TOKEN_DO_SERVIDOR, avisoDaDesconexao.requestId, 0, 2);
confere("N6 sem nenhuma entrega: 'failed'", naoEntregue.noticeStatus === "failed");
confere("N6 a falha não volta antes de 10 minutos", (await pegarAvisos(TOKEN_DO_SERVIDOR)).length === 0);
const envelhecerAviso = () => db.query(
  "update public.whatsapp_connection_change_requests set notice_claimed_at = now() - interval '11 minutes' where id = $1",
  [avisoDaDesconexao.requestId]);
await envelhecerAviso();
const segunda = await pegarAvisos(TOKEN_DO_SERVIDOR);
confere("N6 depois, volta para nova tentativa", segunda.length === 1 && segunda[0].requestId === avisoDaDesconexao.requestId);
await concluirAviso(TOKEN_DO_SERVIDOR, avisoDaDesconexao.requestId, 0, 2);
await envelhecerAviso();
await pegarAvisos(TOKEN_DO_SERVIDOR);
await concluirAviso(TOKEN_DO_SERVIDOR, avisoDaDesconexao.requestId, 0, 2);
await envelhecerAviso();
confere("N6 no máximo 3 tentativas", (await pegarAvisos(TOKEN_DO_SERVIDOR)).length === 0);
const concluirSemToken = await erroDe(() => concluirAviso("cd".repeat(32), avisoDaTroca.requestId, 1, 0));
confere("N7 concluir também exige o token", concluirSemToken.includes("notice token is invalid"), concluirSemToken);
const trilhaDoAviso = await auditoria(M);
confere("N7 o desfecho vai para o histórico, só com contagens",
  trilhaDoAviso.some((a) => a.action === "whatsapp.change_notice_sent" && a.note.includes("2 entregue"))
  && trilhaDoAviso.some((a) => a.action === "whatsapp.change_notice_failed")
  && !JSON.stringify(trilhaDoAviso).includes("@exemplo.invalido"));
const tabelaDoToken = await erroDe(() => como(usuario(major.dono), "select * from private.connection_change_notifier"));
confere("N7 ninguém lê o hash do token", /permission denied/i.test(tabelaDoToken), tabelaDoToken);

console.log(`\n${passou.length} ok, ${falhas.length} falhas\n`);
for (const p of passou) console.log(`  ok  ${p}`);
for (const f of falhas) console.log(`  FALHOU  ${f}`);
process.exit(falhas.length ? 1 : 0);
