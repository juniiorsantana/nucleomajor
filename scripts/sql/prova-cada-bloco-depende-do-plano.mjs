// Prova comportamental da migration 20261018100000 (cada bloco depende do
// plano, Etapa 10 do construtor) num Postgres embutido (PGlite). Banco em
// memória, nada de produção.
//
// Mesmo método das provas anteriores: harness + TODAS as migrations reais até
// a anterior, um retrato do "antes", a migration, as perguntas, o rollback e a
// reaplicação. As perguntas:
//
//   1. ao salvar: o fluxo v3 com bloco que a empresa não tem é recusado; o v2,
//      renomear, desligar e apagar continuam livres;
//   2. ao rodar: a empresa que perdeu a função não trava a conversa — o passo
//      sai pela Falha (ou a execução termina), sem nada ao contato;
//   3. a Major (plano full) e o plano com IA rodam idêntico ao de antes.
//
//   mkdir prova && cd prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-cada-bloco-depende-do-plano.mjs . && node prova-cada-bloco-depende-do-plano.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-cada-bloco-depende-do-plano.mjs <repo>");
const MIGRATION = "20261018100000_cada_bloco_depende_do_plano.sql";
const ROLLBACK = "scripts/sql/rollback-20261018100000-cada-bloco-depende-do-plano.sql";
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
  -- O padrão do Supabase que a 20261017100000 confere: toda função nova de
  -- public nasce executável por anon, authenticated e service_role.
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
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
const DONO_FULL = "aaaaaaaa-0000-4000-8000-000000000002";
const DONO_BASE = "bbbbbbbb-0000-4000-8000-000000000003";
const DONO_ATEND = "bbbbbbbb-0000-4000-8000-000000000004";
const ROBO_FULL = "dddddddd-0000-4000-8000-000000000005";
const ROBO_BASE = "dddddddd-0000-4000-8000-000000000006";
const ROBO_ATEND = "dddddddd-0000-4000-8000-000000000007";
const CONEXAO_FULL = "eeeeeeee-0000-4000-8000-000000000008";
const CONEXAO_BASE = "eeeeeeee-0000-4000-8000-000000000009";
const CONEXAO_ATEND = "eeeeeeee-0000-4000-8000-00000000000a";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO_FULL}', 'major@exemplo.invalido', now()),
    ('${DONO_BASE}', 'base@exemplo.invalido', now()),
    ('${DONO_ATEND}', 'atendimento@exemplo.invalido', now()),
    ('${ROBO_FULL}', 'robot+full@invalid.emyleads.local', now()),
    ('${ROBO_BASE}', 'robot+base@invalid.emyleads.local', now()),
    ('${ROBO_ATEND}', 'robot+atend@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const empresaNoPlano = async (dono, email, plano, nome) => {
  const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, $2, 7)", [email, plano])).rows[0].access_code;
  return (await como(usuario(dono), "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
};
const orgFull = await empresaNoPlano(DONO_FULL, "major@exemplo.invalido", "full", "Major");
const orgBase = await empresaNoPlano(DONO_BASE, "base@exemplo.invalido", "base", "Cliente Base");
const orgAtend = await empresaNoPlano(DONO_ATEND, "atendimento@exemplo.invalido", "atendimento", "Clínica Atendimento");
for (const [org, conexao, robo] of [
  [orgFull, CONEXAO_FULL, ROBO_FULL], [orgBase, CONEXAO_BASE, ROBO_BASE], [orgAtend, CONEXAO_ATEND, ROBO_ATEND],
]) {
  await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [conexao, org]);
  await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [conexao, org, robo]);
}
const robo = (sub, org, conexao) => ({
  sub, role: "authenticated",
  app_metadata: { is_robot: "true", organization_id: org, connection_id: conexao },
});
const roboFull = robo(ROBO_FULL, orgFull, CONEXAO_FULL);
const roboBase = robo(ROBO_BASE, orgBase, CONEXAO_BASE);
const roboAtend = robo(ROBO_ATEND, orgAtend, CONEXAO_ATEND);
const tem = async (org, funcao) => (await um("select private.org_has_feature($1,$2) v", [org, funcao])).v === true;
const ajusta = (org, funcao, ligado) =>
  como(usuario(ADMIN), "select public.platform_entitlement_set($1, $2, $3, null, null, 'prova', true)", [org, funcao, ligado]);

confere("pré: o Base tem chatbots e não tem IA", (await tem(orgBase, "chatbots")) && !(await tem(orgBase, "ai_customer")));
confere("pré: o Atendimento tem chatbots e IA", (await tem(orgAtend, "chatbots")) && (await tem(orgAtend, "ai_customer")));
confere("pré: a Major tem chatbots e IA", (await tem(orgFull, "chatbots")) && (await tem(orgFull, "ai_customer")));

// --------------------------------------------------------------- os fluxos
const canvas = (conexoes) => ({ versao: 3, nos: [], conexoes });
// Mensagem, IA (Falha vai para a equipe), encerrar.
const COM_IA = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "oi", tipo: "enviar_mensagem", texto: "Oi" },
    { id: "ia", tipo: "transferir", destino: "ia", alvoIa: "reception", objetivoIa: "Qualificar" },
    { id: "fim", tipo: "encerrar" },
    { id: "equipe", tipo: "transferir", destino: "humano" },
  ],
  canvas: canvas([
    { source: "entrada", saida: "padrao", target: "condicoes" },
    { source: "condicoes", saida: "padrao", target: "oi" },
    { source: "oi", saida: "padrao", target: "ia" },
    { source: "ia", saida: "sucesso", target: "fim" },
    { source: "ia", saida: "falha", target: "equipe" },
  ]),
};
const SEM_IA = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "oi", tipo: "enviar_mensagem", texto: "Oi" },
    { id: "espera", tipo: "aguardar", duracao: 1, unidade: "horas" },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: canvas([
    { source: "entrada", saida: "padrao", target: "condicoes" },
    { source: "condicoes", saida: "padrao", target: "oi" },
    { source: "oi", saida: "padrao", target: "espera" },
    { source: "espera", saida: "respondeu", target: "fim" },
    { source: "espera", saida: "sem_resposta", target: "fim" },
  ]),
};
const V2_COM_IA = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [{ id: "ia", tipo: "transferir", destino: "ia", objetivoIa: "Qualificar" }],
  canvas: { versao: 2, nos: [], conexoes: [] },
};
const grava = (org, dono, nome, definicao, id = randomUUID()) =>
  db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,$3,$4,$4,$5::jsonb)",
    [id, org, nome, dono, JSON.stringify(definicao)]).then(() => id);
const versaoDe = async (id) => Number((await um("select version from public.chatbot_definitions where id=$1", [id])).version);

// Antes da migration: o Base já tem um fluxo com IA salvo (como hoje é possível).
const fluxoBaseAntigo = await grava(orgBase, DONO_BASE, "Antigo com IA", COM_IA);
const fluxoFull = await grava(orgFull, DONO_FULL, "Major com IA", COM_IA);
const fluxoAtend = await grava(orgAtend, DONO_ATEND, "Atendimento com IA", COM_IA);

// O retrato do "antes" na Major: o claim da etapa de IA.
const rpc = async (quem, sql, params) => (await como(quem, sql, params)).rows[0].r;
const ateAIa = async (quem, fluxo, telefone, mensagem) => {
  let exec = await rpc(quem, "select public.nucleo_flow_start($1,$2,$3,$4,$5,0) r", [telefone, mensagem, fluxo, await versaoDe(fluxo), randomUUID()]);
  const reserva = await rpc(quem, "select public.nucleo_flow_claim($1,$2) r", [exec.executionId, exec.revision]);
  exec = await rpc(quem, "select public.nucleo_flow_ack($1,$2,'padrao','confirmed') r", [exec.executionId, reserva.claimToken]);
  return { exec, primeira: reserva };
};
const majorAntes = await ateAIa(roboFull, fluxoFull, "5565900000001", "antes-1");
const claimIaAntes = await rpc(roboFull, "select public.nucleo_flow_claim($1,$2) r", [majorAntes.exec.executionId, majorAntes.exec.revision]);

// ------------------------------------------------------ aplica a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
confere("a migration aplica sobre a cadeia inteira", true);
confere("a reaplicação é recusada pela guarda", /ja foi aplicada/.test(await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)))));
await db.exec("rollback"); // o `begin` da tentativa recusada ficou aberto

// ------------------------------------------------------ 1. a lista no banco
const lista = (await um("select private.flow_block_requirements() v")).v;
confere("a lista diz que transferir:ia exige ai_customer", lista.blocos["transferir:ia"] === "ai_customer");
confere("a lista diz que transferir:humano exige só chatbots", lista.blocos["transferir:humano"] === "chatbots");
confere("nenhum outro bloco exige IA",
  Object.entries(lista.blocos).every(([k, v]) => k === "transferir:ia" || v === "chatbots"), JSON.stringify(lista.blocos));
const features = async (step) => (await um("select private.flow_step_features($1::jsonb) v", [JSON.stringify(step)])).v;
confere("condição com regra de horário exige chatbots", JSON.stringify(await features({
  tipo: "condicao", expressao: { operador: "e", itens: [{ tipo: "janela_de_horario", inicio: "08:00", fim: "18:00" }] } })) === '["chatbots"]');

// ------------------------------------------------------ 2. ao salvar
const valida = (definicao, org) => erroDe(() => db.query("select private.flow_validate($1::jsonb, $2)", [JSON.stringify(definicao), org]));
confere("flow_validate(spec, org) recusa IA no Base", /flow feature unavailable: ai_customer/.test(await valida(COM_IA, orgBase)), await valida(COM_IA, orgBase));
confere("flow_validate(spec, org) aceita IA na Major", (await valida(COM_IA, orgFull)) === "");
confere("flow_validate(spec, org) aceita o fluxo sem IA no Base", (await valida(SEM_IA, orgBase)) === "");
confere("flow_validate(spec, org) continua recusando o que a estrutura recusa",
  /ports incomplete/.test(await valida({ ...SEM_IA, canvas: canvas(SEM_IA.canvas.conexoes.slice(0, 3)) }, orgFull)));

const gravarIaNoBase = await erroDe(() => grava(orgBase, DONO_BASE, "Novo com IA", COM_IA));
confere("salvar fluxo v3 com IA no Base é recusado", /flow feature unavailable: ai_customer/.test(gravarIaNoBase), gravarIaNoBase);
confere("pelo portal (authenticated) também", /flow feature unavailable: ai_customer/.test(await erroDe(() =>
  como(usuario(DONO_BASE), "insert into public.chatbot_definitions(organization_id,name,created_by,updated_by,definition) values($1,'Pelo portal',$2,$2,$3::jsonb)",
    [orgBase, DONO_BASE, JSON.stringify(COM_IA)]))));
confere("salvar fluxo v3 sem IA no Base passa", (await erroDe(() => grava(orgBase, DONO_BASE, "Sem IA", SEM_IA))) === "");
confere("salvar fluxo v3 com IA na Major passa", (await erroDe(() => grava(orgFull, DONO_FULL, "Major 2", COM_IA))) === "");
confere("o v2 com IA no Base não muda (Etapa 11)", (await erroDe(() => grava(orgBase, DONO_BASE, "V2", V2_COM_IA))) === "");

// O fluxo antigo do Base: renomear, desligar e apagar seguem livres.
const atualiza = (sql, params) => erroDe(() => db.query(sql, params));
confere("renomear o fluxo antigo com IA passa",
  (await atualiza("update public.chatbot_definitions set name='Renomeado' where id=$1", [fluxoBaseAntigo])) === "");
confere("mudar o desenho do fluxo antigo com IA é recusado", /flow feature unavailable/.test(await atualiza(
  "update public.chatbot_definitions set definition=jsonb_set(definition,'{passos,0,texto}','\"Olá\"') where id=$1", [fluxoBaseAntigo])));
const reativar = randomUUID();
await grava(orgFull, DONO_FULL, "Para mover", COM_IA, reativar);
await db.query("update public.chatbot_definitions set active=false where id=$1", [fluxoBaseAntigo]);
confere("desligar o fluxo antigo com IA passa",
  (await um("select active from public.chatbot_definitions where id=$1", [fluxoBaseAntigo])).active === false);
confere("religar o fluxo antigo com IA é recusado", /flow feature unavailable/.test(await atualiza(
  "update public.chatbot_definitions set active=true where id=$1", [fluxoBaseAntigo])));
confere("tirar a IA do desenho libera o salvamento", (await atualiza(
  "update public.chatbot_definitions set definition=$2::jsonb, active=true where id=$1", [fluxoBaseAntigo, JSON.stringify(SEM_IA)])) === "");

// ------------------------------------------------------ 3. ao rodar
// A Major: idêntico ao antes, e o envelope diz de que o passo depende.
const majorDepois = await ateAIa(roboFull, fluxoFull, "5565900000002", "depois-1");
const claimIaDepois = await rpc(roboFull, "select public.nucleo_flow_claim($1,$2) r", [majorDepois.exec.executionId, majorDepois.exec.revision]);
confere("na Major a etapa de IA é entregue como antes", claimIaDepois.status === "executing" && claimIaDepois.step?.id === "ia"
  && claimIaAntes.status === "executing" && Boolean(claimIaDepois.suspensionId) === Boolean(claimIaAntes.suspensionId));
confere("o envelope diz que a etapa de IA requer ai_customer", JSON.stringify(claimIaDepois.requer) === '["ai_customer"]', JSON.stringify(claimIaDepois.requer));
confere("o envelope não traz bloqueio quando liberado", claimIaDepois.bloqueado === undefined);
confere("a mensagem requer chatbots", JSON.stringify(majorDepois.primeira.requer) === '["chatbots"]');

// O Atendimento perde a IA no meio da execução: a etapa sai pela Falha.
const atend = await ateAIa(roboAtend, fluxoAtend, "5565900000003", "atend-1");
await ajusta(orgAtend, "ai_customer", false);
confere("o painel tirou a IA do Atendimento", !(await tem(orgAtend, "ai_customer")));
const eventosAntes = Number((await um("select count(*)::int n from public.contact_events where event_type='flow.step_blocked'")).n);
const desviado = await rpc(roboAtend, "select public.nucleo_flow_claim($1,$2) r", [atend.exec.executionId, atend.exec.revision]);
confere("o claim não entrega a etapa de IA trancada", desviado.status === "ready" && desviado.step === undefined, JSON.stringify(desviado));
confere("a execução segue pela Falha", desviado.cursor === "equipe", desviado.cursor);
confere("o motivo é plan_feature_missing", desviado.reason === "plan_feature_missing");
confere("o envelope conta o desvio", desviado.bloqueado?.requer === "ai_customer" && desviado.bloqueado?.saida === "falha"
  && desviado.bloqueado?.nodeId === "ia", JSON.stringify(desviado.bloqueado));
confere("nenhuma suspensão de IA foi aberta", desviado.suspensionId === null);
confere("o histórico do contato registra o desvio",
  Number((await um("select count(*)::int n from public.contact_events where event_type='flow.step_blocked'")).n) === eventosAntes + 1);
const seguinte = await rpc(roboAtend, "select public.nucleo_flow_claim($1,$2) r", [desviado.executionId, desviado.revision]);
confere("o passo da Falha (equipe) é entregue normalmente", seguinte.status === "executing" && seguinte.step?.id === "equipe");
await ajusta(orgAtend, "ai_customer", true);

// O Base com o fluxo antigo que ainda tem IA gravada na execução: mesma coisa.
const execBaseComIa = await (async () => {
  // Um fluxo salvo antes da migration, já na versão que o runtime tem.
  const id = randomUUID();
  await db.query("alter table public.chatbot_definitions disable trigger chatbot_definitions_plan_guard");
  await grava(orgBase, DONO_BASE, "Gravado antes", COM_IA, id);
  await db.query("alter table public.chatbot_definitions enable trigger chatbot_definitions_plan_guard");
  return ateAIa(roboBase, id, "5565900000004", "base-1");
})();
const desviadoBase = await rpc(roboBase, "select public.nucleo_flow_claim($1,$2) r", [execBaseComIa.exec.executionId, execBaseComIa.exec.revision]);
confere("no Base a etapa de IA sai pela Falha no banco", desviadoBase.cursor === "equipe" && desviadoBase.reason === "plan_feature_missing");

// Sem chatbots no meio do caminho: bloco sem Falha encerra, sem mensagem.
const fluxoEspera = await grava(orgBase, DONO_BASE, "Espera", SEM_IA);
let execEspera = await rpc(roboBase, "select public.nucleo_flow_start($1,'esp-1',$2,$3,$4,0) r",
  ["5565900000005", fluxoEspera, await versaoDe(fluxoEspera), randomUUID()]);
const r1 = await rpc(roboBase, "select public.nucleo_flow_claim($1,$2) r", [execEspera.executionId, execEspera.revision]);
execEspera = await rpc(roboBase, "select public.nucleo_flow_ack($1,$2,'padrao','confirmed') r", [execEspera.executionId, r1.claimToken]);
await ajusta(orgBase, "chatbots", false);
const encerrada = await rpc(roboBase, "select public.nucleo_flow_claim($1,$2) r", [execEspera.executionId, execEspera.revision]);
confere("sem chatbots, o passo sem Falha encerra a execução", encerrada.status === "cancelled" && encerrada.reason === "plan_feature_missing",
  JSON.stringify(encerrada));
confere("e o envelope diz que encerrou", encerrada.bloqueado?.saida === null && encerrada.bloqueado?.requer === "chatbots");
confere("a execução cancelada não prende a conversa (cabe outra)",
  Number((await um("select count(*)::int n from public.chatbot_flow_executions where id=$1 and status in ('ready','executing','suspended','needs_review')",
    [execEspera.executionId])).n) === 0);

// Sem chatbots, o fluxo nem começa (o runtime entrega à equipe).
const semComeco = await erroDe(async () => rpc(roboBase, "select public.nucleo_flow_start($1,'esp-2',$2,$3,$4,0) r",
  ["5565900000006", fluxoEspera, await versaoDe(fluxoEspera), randomUUID()]));
confere("sem chatbots, nucleo_flow_start recusa com o motivo", /flow feature unavailable: chatbots/.test(semComeco), semComeco);
confere("e não cria execução nem contato", Number((await um(
  "select count(*)::int n from public.contacts where organization_id=$1 and phone='5565900000006'", [orgBase])).n) === 0);
await ajusta(orgBase, "chatbots", true);
confere("com chatbots de volta, o mesmo fluxo começa", (await erroDe(async () => rpc(roboBase, "select public.nucleo_flow_start($1,'esp-3',$2,$3,$4,0) r",
  ["5565900000006", fluxoEspera, await versaoDe(fluxoEspera), randomUUID()]))) === "");


// ------------------------------------------------------ 4. permissões
for (const assinatura of ["private.flow_validate($1::jsonb, $2)", "private.flow_locked_feature($2, $1::jsonb)"]) {
  const deFora = await erroDe(() => como(usuario(DONO_BASE), `select ${assinatura}`, [JSON.stringify(SEM_IA), orgBase]));
  confere(`${assinatura.split("(")[0]} não é executável de fora`, /permission denied/.test(deFora), deFora);
}

// ------------------------------------------------------ 5. rollback e volta
await db.exec(ler(ROLLBACK));
confere("o rollback tira a validação com a empresa",
  (await um("select to_regprocedure('private.flow_validate(jsonb, uuid)') v")).v === null);
confere("depois do rollback, salvar IA no Base volta a passar", (await erroDe(() => grava(orgBase, DONO_BASE, "Pós-rollback", COM_IA))) === "");
const claimPosRollback = (await um("select prosrc from pg_proc where oid='public.nucleo_flow_claim(uuid,bigint)'::regprocedure")).prosrc;
confere("o claim volta ao corpo de 20260926160000", !claimPosRollback.includes("plan_feature_missing"));
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
confere("a migration reaplica depois do rollback", (await um("select to_regprocedure('private.flow_validate(jsonb, uuid)') v")).v !== null);

console.log(`${passou.length} conferências passaram, ${falhas.length} falharam`);
for (const item of falhas) console.log(`  FALHOU ${item}`);
process.exit(falhas.length ? 1 : 0);
