// Prova da migration 20260926160000 (o bloco "Aguardar", Etapa 8) num Postgres
// embutido (PGlite): harness + TODAS as migrations reais, em ordem.
//
// O follow-up do dono, de ponta a ponta, pelas mesmas funções que a VPS chama:
// mensagem → aguardar → (respondeu | sem resposta) → cobrança → aguardar → …
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-fluxo-aguardar.mjs . && node prova-fluxo-aguardar.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-fluxo-aguardar.mjs <repo>");
const MIGRATION = "20260926160000_o_fluxo_sabe_esperar.sql";
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

// ---------------------------------------------------------------- o mundo
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO = "aaaaaaaa-0000-4000-8000-000000000002";
const ROBO = "dddddddd-0000-4000-8000-000000000005";
const CONEXAO = "eeeeeeee-0000-4000-8000-000000000008";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO}', 'dono@exemplo.invalido', now()),
    ('${ROBO}', 'robot@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, $2, 7)", ["dono@exemplo.invalido", "base"])).rows[0].access_code;
const org = (await como(usuario(DONO), "select public.create_organization($1, $2) as id", ["Cliente Base", codigo])).rows[0].id;
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [CONEXAO, org]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, org, ROBO]);
const robo = { sub: ROBO, role: "authenticated", app_metadata: { is_robot: "true", organization_id: org, connection_id: CONEXAO } };
const rpc = async (sql, params) => (await como(robo, sql, params)).rows[0].r;
const valida = (definicao) => erroDe(() => db.query("select private.flow_validate($1::jsonb)", [JSON.stringify(definicao)]));

// O follow-up: cobra, espera 24h, cobra de novo, espera 2h, desiste.
const FOLLOWUP = {
  gatilho: { tipo: "manual" },
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "cobra1", tipo: "enviar_mensagem", texto: "Oi {nome}! Conseguiu ver a proposta?" },
    { id: "espera1", tipo: "aguardar", duracao: 24, unidade: "horas" },
    { id: "cobra2", tipo: "enviar_mensagem", texto: "Ficou alguma dúvida sobre os valores?" },
    { id: "espera2", tipo: "aguardar", duracao: 2, unidade: "horas" },
    { id: "equipe", tipo: "transferir", destino: "humano" },
    { id: "desiste", tipo: "encerrar" },
  ],
  canvas: {
    versao: 3, nos: [], conexoes: [
      { source: "entrada", saida: "padrao", target: "condicoes" },
      { source: "condicoes", saida: "padrao", target: "cobra1" },
      { source: "cobra1", saida: "padrao", target: "espera1" },
      { source: "espera1", saida: "respondeu", target: "equipe" },
      { source: "espera1", saida: "sem_resposta", target: "cobra2" },
      { source: "cobra2", saida: "padrao", target: "espera2" },
      { source: "espera2", saida: "respondeu", target: "equipe" },
      { source: "espera2", saida: "sem_resposta", target: "desiste" },
    ],
  },
};

// ---------------------------------------------------- antes da migration
confere("antes: o banco recusa o bloco aguardar", /node type invalid/.test(await valida(FOLLOWUP)), await valida(FOLLOWUP));

// ------------------------------------------------------ aplica a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));

// ------------------------------------------------------------ validação
confere("o follow-up com duas esperas é aceito", (await valida(FOLLOWUP)) === "", await valida(FOLLOWUP));
const comEspera = (troca) => ({ ...FOLLOWUP, passos: FOLLOWUP.passos.map((p) => (p.id === "espera1" ? { ...p, ...troca } : p)) });
for (const [nome, troca] of [
  ["sem duração", { duracao: undefined }],
  ["duração zero", { duracao: 0 }],
  ["duração fracionada", { duracao: 1.5 }],
  ["duração como texto", { duracao: "24" }],
  ["unidade desconhecida", { unidade: "semanas" }],
  ["mais de 30 dias", { duracao: 31, unidade: "dias" }],
  ["mais de 720 horas", { duracao: 721, unidade: "horas" }],
  ["mais de 1440 minutos", { duracao: 1441, unidade: "minutos" }],
]) {
  confere(`espera recusada: ${nome}`, /wait invalid/.test(await valida(comEspera(troca))), await valida(comEspera(troca)));
}
confere("espera de 1 minuto é aceita (para testar)", (await valida(comEspera({ duracao: 1, unidade: "minutos" }))) === "");
confere("espera de 30 dias é aceita", (await valida(comEspera({ duracao: 30, unidade: "dias" }))) === "");
confere("espera sem a saída 'respondeu' é recusada", /ports incomplete/.test(await valida({
  ...FOLLOWUP, canvas: { ...FOLLOWUP.canvas, conexoes: FOLLOWUP.canvas.conexoes.filter((c) => !(c.source === "espera1" && c.saida === "respondeu")) },
})));
confere("espera com saída 'padrao' é recusada", /ports incomplete/.test(await valida({
  ...FOLLOWUP, canvas: { ...FOLLOWUP.canvas, conexoes: [...FOLLOWUP.canvas.conexoes, { source: "espera1", saida: "padrao", target: "desiste" }] },
})));

// O freio: no máximo 10 esperas.
const muitas = (n) => {
  const passos = [];
  const conexoes = [{ source: "entrada", saida: "padrao", target: "condicoes" }];
  let anterior = "condicoes";
  let saida = "padrao";
  for (let i = 0; i < n; i += 1) {
    passos.push({ id: `e${i}`, tipo: "aguardar", duracao: 1, unidade: "horas" });
    conexoes.push({ source: anterior, saida, target: `e${i}` });
    conexoes.push({ source: `e${i}`, saida: "respondeu", target: "fim" });
    anterior = `e${i}`;
    saida = "sem_resposta";
  }
  passos.push({ id: "fim", tipo: "encerrar" });
  conexoes.push({ source: anterior, saida, target: "fim" });
  return { condicoes: [{ tipo: "primeira_conversa" }], passos, canvas: { versao: 3, nos: [], conexoes } };
};
confere("10 esperas num fluxo são aceitas", (await valida(muitas(10))) === "", await valida(muitas(10)));
confere("11 esperas num fluxo são recusadas", /waits exceeded/.test(await valida(muitas(11))));

// Os blocos de antes continuam valendo.
const PERGUNTA = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "menu", tipo: "perguntar", texto: "Como posso ajudar?", opcoes: [{ id: "a", rotulo: "A" }] },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: { versao: 3, nos: [], conexoes: [
    { source: "entrada", saida: "padrao", target: "condicoes" },
    { source: "condicoes", saida: "padrao", target: "menu" },
    { source: "menu", saida: "a", target: "fim" },
    { source: "menu", saida: "nao_resolvido", target: "fim" },
  ] },
};
confere("pergunta continua aceita", (await valida(PERGUNTA)) === "");

// ------------------------------------------------------------ execução
const fluxo = randomUUID();
await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Follow-up',$3,$3,$4::jsonb)",
  [fluxo, org, DONO, JSON.stringify(FOLLOWUP)]);
const versao = (await um("select version from public.chatbot_definitions where id=$1", [fluxo])).version;
let n = 0;
const iniciar = async (telefone) => rpc("select public.nucleo_flow_start($1,$2,$3,$4,$5,0) r",
  [telefone, `gatilho:${(n += 1)}`, fluxo, versao, randomUUID()]);
// Um passo: reserva e confirma, como a VPS.
const passo = async (exec, saida = "padrao") => {
  const reserva = await rpc("select public.nucleo_flow_claim($1,$2) r", [exec.executionId, exec.revision]);
  const depois = await rpc("select public.nucleo_flow_ack($1,$2,$3,'confirmed') r", [exec.executionId, reserva.claimToken, saida]);
  return { reserva, depois };
};
const vencer = (exec, intervalo) => db.query(`update public.chatbot_flow_executions set suspension_expires_at=now()-interval '${intervalo}' where id=$1`, [exec.executionId]);

// 1) Ninguém responde: cobra, espera, cobra de novo, espera, desiste.
const SUMIU = "5565911112222";
let exec = await iniciar(SUMIU);
({ depois: exec } = await passo(exec));
confere("depois da primeira cobrança o cursor vai para a espera", exec.cursor === "espera1" && exec.status === "ready");
let { reserva, depois } = await passo(exec, "");
exec = depois;
confere("a espera ganha uma suspensão ao ser reservada", Boolean(reserva.suspensionId));
confere("a espera suspende esperando o relógio", exec.status === "suspended" && exec.waiting === "timer", JSON.stringify(exec));
const prazo = new Date(exec.suspensionExpiresAt).getTime() - Date.now();
confere("o prazo é o do bloco (24 h)", prazo > 23.9 * 3600e3 && prazo <= 24 * 3600e3, String(prazo));
const atual = await rpc("select public.nucleo_flow_current($1) r", [SUMIU]);
confere("a espera aparece como a execução atual do contato", atual.executionId === exec.executionId && atual.waiting === "timer" && atual.step?.tipo === "aguardar");
confere("cobrar antes do prazo é recusado", /not expired/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, SUMIU]))));
confere("a etapa de IA não encerra uma espera", /suspension invalid/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_finish_ai($1,$2,$3,'falha') r", [exec.executionId, reserva.suspensionId, SUMIU]))));
confere("repetir pergunta não vale para a espera", /suspension invalid/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer_retry($1,$2,$3) r", [exec.executionId, reserva.suspensionId, SUMIU]))));
confere("saída inexistente é recusada", /output invalid/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer($1,$2,$3,'padrao',null) r", [exec.executionId, reserva.suspensionId, SUMIU]))));

await vencer(exec, "1 minute");
confere("vencido, 'respondeu' é recusado", /expired/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer($1,$2,$3,'respondeu',null) r", [exec.executionId, reserva.suspensionId, SUMIU]))));
exec = await rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, SUMIU]);
confere("vencido o prazo, segue para a segunda cobrança", exec.cursor === "cobra2" && exec.status === "ready" && exec.reason === "wait_elapsed", JSON.stringify(exec));
const repetida = await rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, SUMIU]);
confere("o relógio disparando duas vezes não anda duas casas", repetida.cursor === "cobra2" && repetida.revision === exec.revision);

({ depois: exec } = await passo(exec));
({ reserva, depois: exec } = await passo(exec, ""));
const prazo2 = new Date(exec.suspensionExpiresAt).getTime() - Date.now();
confere("a segunda espera usa o prazo dela (2 h)", prazo2 > 1.9 * 3600e3 && prazo2 <= 2 * 3600e3, String(prazo2));
await vencer(exec, "1 minute");
exec = await rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, SUMIU]);
confere("sem resposta de novo, vai para a desistência", exec.cursor === "desiste");
({ depois: exec } = await passo(exec, ""));
confere("o fluxo termina", exec.status === "completed", JSON.stringify(exec));

// 2) O contato responde durante a espera: a cobrança não sai.
const RESPONDEU = "5565933334444";
exec = await iniciar(RESPONDEU);
({ depois: exec } = await passo(exec));
({ reserva, depois: exec } = await passo(exec, ""));
exec = await rpc("select public.nucleo_flow_answer($1,$2,$3,'respondeu',null) r", [exec.executionId, reserva.suspensionId, RESPONDEU]);
confere("respondeu: vai para a equipe, não para a cobrança", exec.cursor === "equipe" && exec.status === "ready" && exec.reason === null, JSON.stringify(exec));
confere("depois de responder, o relógio não cobra mais", /suspension invalid/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, RESPONDEU]))));

// 3) A VPS ficou fora do ar: cobrança com mais de 6 h de atraso não sai.
const ATRASADO = "5565955556666";
exec = await iniciar(ATRASADO);
({ depois: exec } = await passo(exec));
({ reserva, depois: exec } = await passo(exec, ""));
await vencer(exec, "7 hours");
exec = await rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, ATRASADO]);
confere("atraso de 7 h: o fluxo fecha sem cobrar", exec.status === "cancelled" && exec.reason === "wait_missed", JSON.stringify(exec));
const evento = await um(`select e.event_type, e.source, e.entity_id, e.payload from public.contact_events e
  where e.contact_id=$1 and e.event_type='flow.expired'`, [exec.contactId]);
confere("o histórico do contato registra o follow-up perdido",
  evento?.source === "chatbot" && evento?.entity_id === fluxo && evento?.payload?.reason === "wait_missed", JSON.stringify(evento));
const ATRASO_PEQUENO = "5565977778888";
exec = await iniciar(ATRASO_PEQUENO);
({ depois: exec } = await passo(exec));
({ reserva, depois: exec } = await passo(exec, ""));
await vencer(exec, "5 hours");
exec = await rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, ATRASO_PEQUENO]);
confere("atraso de 5 h ainda cobra", exec.cursor === "cobra2" && exec.status === "ready");

// 4) A equipe assumiu a conversa durante a espera: cancela.
const ASSUMIDO = "5565999990000";
exec = await iniciar(ASSUMIDO);
({ depois: exec } = await passo(exec));
({ reserva, depois: exec } = await passo(exec, ""));
// O contexto de conversa que a VPS marca quando alguém da equipe assume; o
// gatilho `flow_cancel_on_human_handoff` (20260907010000) cancela a execução.
const perfil = await um("select id from public.assistant_profiles where organization_id=$1 order by created_at limit 1", [org]);
await db.query(`insert into public.conversation_intelligence_contexts
    (organization_id, assistant_profile_id, audience, channel, conversation_key_hash, contact_id, state)
  values ($1, $2, 'customer', 'whatsapp', encode(sha256(convert_to($3, 'UTF8')), 'hex'), $4, 'handed_off')`,
  [org, perfil?.id, ASSUMIDO, exec.contactId]);
const depoisDeAssumir = await um("select status, reason from public.chatbot_flow_executions where id=$1", [exec.executionId]);
confere("a equipe assumir cancela a espera", depoisDeAssumir.status === "cancelled" && depoisDeAssumir.reason === "human_takeover",
  JSON.stringify(depoisDeAssumir));
confere("depois de assumida, o relógio não cobra", /suspension invalid/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer($1,$2,$3,'sem_resposta',null) r", [exec.executionId, reserva.suspensionId, ASSUMIDO]))));

// 5) A pergunta continua funcionando igual (nada quebrou na Etapa 6).
const fluxoPergunta = randomUUID();
await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Menu',$3,$3,$4::jsonb)",
  [fluxoPergunta, org, DONO, JSON.stringify(PERGUNTA)]);
const PERGUNTADO = "5565922223333";
let execP = await rpc("select public.nucleo_flow_start($1,'q-1',$2,1,$3,0) r", [PERGUNTADO, fluxoPergunta, randomUUID()]);
const resP = await rpc("select public.nucleo_flow_claim($1,$2) r", [execP.executionId, execP.revision]);
execP = await rpc("select public.nucleo_flow_ack($1,$2,'','confirmed') r", [execP.executionId, resP.claimToken]);
confere("a pergunta ainda espera a resposta", execP.waiting === "reply");
await db.query("update public.chatbot_flow_executions set suspension_expires_at=now()-interval '1 minute' where id=$1", [execP.executionId]);
execP = await rpc("select public.nucleo_flow_answer($1,$2,$3,'nao_resolvido',null) r", [execP.executionId, resP.suspensionId, PERGUNTADO]);
confere("a pergunta vencida ainda sai por nao_resolvido com reply_timeout", execP.reason === "reply_timeout" && execP.cursor === "fim");

// A trava: rodar de novo aborta.
const erro = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("rodar de novo aborta pela trava", /nao e o de 20260926120000/.test(erro), erro);

for (const item of passou) console.log(`  ok   ${item}`);
for (const item of falhas) console.log(`  FALHA ${item}`);
console.log(`\nPASS ${passou.length}${falhas.length ? `, FALHA ${falhas.length}` : ""}`);
process.exit(falhas.length ? 1 : 0);
