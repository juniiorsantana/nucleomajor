// Prova comportamental da migration 20261018110000 (o Jev escolhe a opção do
// menu, Etapa 9 do construtor) num Postgres embutido (PGlite). Banco em
// memória, nada de produção, nenhuma chamada ao Jev.
//
// Mesmo método das provas anteriores: harness + TODAS as migrations reais até
// a anterior, um retrato do "antes", a migration, as perguntas, o rollback e a
// reaplicação. As perguntas:
//
//   1. a pergunta aceita "Usar IA quando não entender" só como booleano, e
//      salvá-la marcada exige ai_customer;
//   2. o robô só ouve "pode chamar o Jev" com a opção marcada e a IA no plano;
//   3. nucleo_flow_answer grava quem decidiu e recusa `ia` fora dessas
//      condições; o runtime de hoje (sem decided_by) segue igual;
//   4. o uso de IA é gravado só pelo robô, da própria empresa, e lido só por ela;
//   5. a empresa que perde a IA não tem a pergunta trancada ao rodar.
//
//   mkdir prova && cd prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-o-jev-escolhe-a-opcao-do-menu.mjs . && node prova-o-jev-escolhe-a-opcao-do-menu.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-o-jev-escolhe-a-opcao-do-menu.mjs <repo>");
const MIGRATION = "20261018110000_o_jev_escolhe_a_opcao_do_menu.sql";
const ROLLBACK = "scripts/sql/rollback-20261018110000-o-jev-escolhe-a-opcao-do-menu.sql";
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

// A guarda confere o corpo de nucleo_flow_answer pelo md5: este é o da cadeia.
const md5Antes = (await um(
  "select md5(replace(prosrc, chr(13), '')) v from pg_proc where oid='public.nucleo_flow_answer(uuid,uuid,text,text,text)'::regprocedure")).v;
console.log(`md5 do corpo de nucleo_flow_answer antes: ${md5Antes}`);
confere("a guarda da migration usa o md5 do corpo de 20260926160000", ler(`supabase/migrations/${MIGRATION}`).includes(md5Antes));

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

confere("pré: o Base não tem IA; o Atendimento e a Major têm",
  !(await tem(orgBase, "ai_customer")) && (await tem(orgAtend, "ai_customer")) && (await tem(orgFull, "ai_customer")));

// --------------------------------------------------------------- os fluxos
const MENU = (ia) => ({
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "menu", tipo: "perguntar", texto: "Como posso ajudar?", tentativas: 2, prazoHoras: 24,
      opcoes: [{ id: "agendar", rotulo: "Agendar", sinonimos: ["marcar"] }, { id: "precos", rotulo: "Preços" }],
      ...(ia === undefined ? {} : { iaQuandoNaoEntende: ia }) },
    { id: "fim", tipo: "encerrar" },
    { id: "equipe", tipo: "transferir", destino: "humano" },
  ],
  canvas: { versao: 3, nos: [], conexoes: [
    { source: "entrada", saida: "padrao", target: "condicoes" },
    { source: "condicoes", saida: "padrao", target: "menu" },
    { source: "menu", saida: "agendar", target: "fim" },
    { source: "menu", saida: "precos", target: "fim" },
    { source: "menu", saida: "nao_resolvido", target: "equipe" },
  ] },
});
const grava = (org, dono, nome, definicao, id = randomUUID()) =>
  db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,$3,$4,$4,$5::jsonb)",
    [id, org, nome, dono, JSON.stringify(definicao)]).then(() => id);
const versaoDe = async (id) => Number((await um("select version from public.chatbot_definitions where id=$1", [id])).version);
const rpc = async (quem, sql, params) => (await como(quem, sql, params)).rows[0].r;
// Começa o fluxo e deixa a pergunta suspensa esperando a resposta.
const ateAPergunta = async (quem, fluxo, telefone) => {
  let exec = await rpc(quem, "select public.nucleo_flow_start($1,$2,$3,$4,$5,0) r", [telefone, `m-${telefone}`, fluxo, await versaoDe(fluxo), randomUUID()]);
  const reserva = await rpc(quem, "select public.nucleo_flow_claim($1,$2) r", [exec.executionId, exec.revision]);
  exec = await rpc(quem, "select public.nucleo_flow_ack($1,$2,'','confirmed') r", [exec.executionId, reserva.claimToken]);
  return { exec, reserva };
};
const responde = (quem, exec, saida, decidiu) => decidiu === undefined
  ? rpc(quem, "select public.nucleo_flow_answer(execution_id => $1, suspension_id => $2, requester_phone => $3, selected_output => $4, answer_value => null) r",
    [exec.executionId, exec.suspensionId, exec.requesterPhone, saida])
  : rpc(quem, "select public.nucleo_flow_answer(execution_id => $1, suspension_id => $2, requester_phone => $3, selected_output => $4, answer_value => null, decided_by => $5) r",
    [exec.executionId, exec.suspensionId, exec.requesterPhone, saida, decidiu]);

// O retrato do "antes": a resposta pela regra na Major.
const fluxoMajorSem = await grava(orgFull, DONO_FULL, "Menu sem IA", MENU());
const antes = await ateAPergunta(roboFull, fluxoMajorSem, "5565900000001");
const respondidaAntes = await responde(roboFull, antes.exec, "precos");

// ------------------------------------------------------ aplica a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
confere("a migration aplica sobre a cadeia inteira", true);
confere("a reaplicação é recusada pela guarda", /ja foi aplicada/.test(await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)))));
await db.exec("rollback");

// ------------------------------------------------------ 1. a pergunta
const lista = (await um("select private.flow_block_requirements() v")).v;
confere("a lista diz que a IA na pergunta exige ai_customer", lista.ajustes?.["perguntar:iaQuandoNaoEntende"] === "ai_customer");
confere("os blocos não mudaram (a pergunta continua só chatbots)", lista.blocos.perguntar === "chatbots" && lista.blocos["transferir:ia"] === "ai_customer");
const validaPergunta = (passo) => erroDe(() => db.query("select private.flow_validate_question($1::jsonb)", [JSON.stringify(passo)]));
const menuIa = MENU(true).passos[0];
confere("a opção booleana é aceita", (await validaPergunta(menuIa)) === "");
confere("a opção como texto é recusada", /flow question invalid/.test(await validaPergunta({ ...menuIa, iaQuandoNaoEntende: "sim" })));
confere("a opção no 'digitar' é recusada", /flow question invalid/.test(await validaPergunta(
  { id: "n", tipo: "coletar", texto: "Seu nome?", variavel: "nome", iaQuandoNaoEntende: true })));
confere("a pergunta sem a opção continua valendo", (await validaPergunta(MENU().passos[0])) === "");

const valida = (definicao, org) => erroDe(() => db.query("select private.flow_validate($1::jsonb, $2)", [JSON.stringify(definicao), org]));
confere("flow_validate recusa a opção ligada no Base", /flow feature unavailable: ai_customer/.test(await valida(MENU(true), orgBase)));
confere("flow_validate aceita a opção desligada no Base", (await valida(MENU(false), orgBase)) === "");
confere("flow_validate aceita a opção ligada na Major", (await valida(MENU(true), orgFull)) === "");
const salvarNoBase = await erroDe(() => como(usuario(DONO_BASE),
  "insert into public.chatbot_definitions(organization_id,name,created_by,updated_by,definition) values($1,'Menu IA',$2,$2,$3::jsonb)",
  [orgBase, DONO_BASE, JSON.stringify(MENU(true))]));
confere("salvar a opção ligada no Base pelo portal é recusado", /flow feature unavailable: ai_customer/.test(salvarNoBase), salvarNoBase);
confere("salvar a opção desligada no Base passa", (await erroDe(() => grava(orgBase, DONO_BASE, "Menu", MENU(false)))) === "");
const fluxoMajorIa = await grava(orgFull, DONO_FULL, "Menu com IA", MENU(true));
const fluxoAtendIa = await grava(orgAtend, DONO_ATEND, "Menu com IA", MENU(true));
confere("salvar a opção ligada na Major e no Atendimento passa", Boolean(fluxoMajorIa && fluxoAtendIa));

// ------------------------------------------------------ 2 e 3. ao rodar
const pode = (quem, exec) => rpc(quem, "select public.nucleo_flow_ai_option_allowed($1,$2) r", [exec.executionId, exec.suspensionId]);
const major = await ateAPergunta(roboFull, fluxoMajorIa, "5565900000002");
confere("a pergunta com IA é entregue e fica esperando", major.reserva.step?.id === "menu" && major.exec.status === "suspended",
  JSON.stringify(major.exec.status));
confere("o envelope da pergunta continua requerendo só chatbots", JSON.stringify(major.reserva.requer) === '["chatbots"]');
confere("na Major o robô pode chamar o Jev", (await pode(roboFull, major.exec)).allowed === true);
confere("outro robô não fica sabendo de nada", (await pode(roboAtend, major.exec)).allowed === false);
const errada = await erroDe(() => responde(roboFull, major.exec, "nao_resolvido", "ia"));
confere("a IA não pode escolher nao_resolvido", /flow decided_by invalid/.test(errada), errada);
confere("decided_by fora da lista é recusado", /flow decided_by invalid/.test(await erroDe(() => responde(roboFull, major.exec, "precos", "jev"))));
const pelaIa = await responde(roboFull, major.exec, "precos", "ia");
confere("a resposta da IA anda o fluxo pela opção", pelaIa.status === "ready" && pelaIa.cursor === "fim", JSON.stringify(pelaIa));
confere("e fica gravado que foi a IA",
  (await um("select last_decided_by v from public.chatbot_flow_executions where id=$1", [major.exec.executionId])).v === "ia");
confere("a mesma resposta repetida não anda duas casas", (await responde(roboFull, major.exec, "precos", "ia")).revision === pelaIa.revision);
confere("depois de respondida, o robô não pode mais chamar", (await pode(roboFull, major.exec)).allowed === false);

const semOpcao = await ateAPergunta(roboFull, fluxoMajorSem, "5565900000003");
confere("pergunta sem a opção: o robô não pode chamar", (await pode(roboFull, semOpcao.exec)).reason === "option_off");
confere("pergunta sem a opção: decided_by=ia é recusado",
  /flow decided_by invalid/.test(await erroDe(() => responde(roboFull, semOpcao.exec, "precos", "ia"))));
const pelaRegra = await responde(roboFull, semOpcao.exec, "agendar");
confere("o runtime de hoje (sem decided_by) responde como antes",
  pelaRegra.status === respondidaAntes.status && pelaRegra.cursor === respondidaAntes.cursor);
confere("e fica gravado como regra",
  (await um("select last_decided_by v from public.chatbot_flow_executions where id=$1", [semOpcao.exec.executionId])).v === "regra");
confere("a assinatura antiga (5 argumentos) não existe mais",
  (await um("select to_regprocedure('public.nucleo_flow_answer(uuid,uuid,text,text,text)') v")).v === null);

// ------------------------------------------------------ 5. perder a IA
await ajusta(orgAtend, "ai_customer", false);
const atend = await ateAPergunta(roboAtend, fluxoAtendIa, "5565900000004");
confere("sem IA, a pergunta com a opção não é trancada ao rodar",
  atend.reserva.status === "executing" && atend.reserva.step?.id === "menu" && atend.reserva.bloqueado === undefined,
  JSON.stringify(atend.reserva.bloqueado));
confere("sem IA, o robô não pode chamar o Jev", (await pode(roboAtend, atend.exec)).reason === "plan_feature_missing");
confere("sem IA, decided_by=ia é recusado",
  /flow decided_by invalid/.test(await erroDe(() => responde(roboAtend, atend.exec, "precos", "ia"))));
confere("sem IA, a escada de sempre responde", (await responde(roboAtend, atend.exec, "nao_resolvido")).cursor === "equipe");
await ajusta(orgAtend, "ai_customer", true);

// ------------------------------------------------------ 4. o uso
const registra = (quem, payload) => rpc(quem, "select public.nucleo_ai_usage_record($1::jsonb) r", [JSON.stringify(payload)]);
const uso = { executionId: major.exec.executionId, nodeId: "menu", kind: "flow_option", model: "typesafe/jev-1.13",
  inputTokens: 412, outputTokens: 9, costUsd: 0.0000181, latencyMs: 640, decision: "decidiu", confidence: 0.93 };
confere("o robô grava o uso da própria execução", (await registra(roboFull, uso)).recorded === true);
await registra(roboFull, { ...uso, decision: "incerta", confidence: 0.6 });
confere("o robô de outra empresa não grava na execução alheia",
  /ai usage execution unavailable/.test(await erroDe(() => registra(roboAtend, uso))));
confere("decisão fora da lista é recusada", /ai usage invalid/.test(await erroDe(() => registra(roboFull, { ...uso, decision: "talvez" }))));
confere("execução que não é uuid é recusada", /ai usage invalid/.test(await erroDe(() => registra(roboFull, { ...uso, executionId: "x" }))));
const exagero = await registra(roboFull, { ...uso, inputTokens: 1e12, latencyMs: -5, confidence: 7 });
const linha = await um("select input_tokens, latency_ms, confidence from public.ai_usage_events where id=$1", [exagero.id]);
confere("números fora da faixa são cortados", linha.input_tokens === 1000000 && linha.latency_ms === 0 && Number(linha.confidence) === 1);
const doDono = (await como(usuario(DONO_FULL), "select count(*)::int n from public.ai_usage_events")).rows[0].n;
const doOutro = (await como(usuario(DONO_BASE), "select count(*)::int n from public.ai_usage_events")).rows[0].n;
confere("a empresa vê o próprio uso, e só ele", doDono === 3 && doOutro === 0, `${doDono}/${doOutro}`);
const resumo = (await como(usuario(DONO_FULL), "select * from public.ai_usage_summary()")).rows;
confere("o resumo conta chamadas, decididas e tokens", resumo.length === 1 && Number(resumo[0].calls) === 3
  && Number(resumo[0].decided) === 2 && Number(resumo[0].input_tokens) === 412 + 412 + 1000000, JSON.stringify(resumo));
confere("o resumo de outra empresa vem vazio", (await como(usuario(DONO_BASE), "select * from public.ai_usage_summary()")).rows.length === 0);
confere("ninguém do portal grava uso direto", /permission denied/.test(await erroDe(() => como(usuario(DONO_FULL),
  "insert into public.ai_usage_events (organization_id, connection_id, kind, decision) values ($1, $2, 'flow_option', 'decidiu')",
  [orgFull, CONEXAO_FULL]))));
confere("o portal não chama a função do robô", /robot|permission denied/.test(await erroDe(() => registra(usuario(DONO_FULL), uso))));

// ------------------------------------------------------ permissões
for (const [sql, params] of [
  ["select public.nucleo_flow_ai_option_allowed($1,$2)", [major.exec.executionId, major.exec.suspensionId]],
  ["select public.nucleo_ai_usage_record($1::jsonb)", [JSON.stringify(uso)]],
  ["select * from public.ai_usage_summary()", []],
]) {
  confere(`anon não executa ${sql.split("(")[0].split(" ").pop()}`, /permission denied/.test(await erroDe(() => como(null, sql, params))));
}
confere("o ajuste interno não é executável de fora", /permission denied/.test(await erroDe(() =>
  como(usuario(DONO_FULL), "select private.flow_step_adjustment_features($1::jsonb)", [JSON.stringify(menuIa)]))));

// ------------------------------------------------------ rollback e volta
await db.exec(ler(ROLLBACK));
confere("o rollback volta a assinatura antiga",
  (await um("select to_regprocedure('public.nucleo_flow_answer(uuid,uuid,text,text,text)') v")).v !== null);
confere("o rollback volta o corpo exato de 20260926160000", (await um(
  "select md5(replace(prosrc, chr(13), '')) v from pg_proc where oid='public.nucleo_flow_answer(uuid,uuid,text,text,text)'::regprocedure")).v === md5Antes);
confere("o rollback tira a tabela de uso", (await um("select to_regclass('public.ai_usage_events') v")).v === null);
const depoisDoRollback = await ateAPergunta(roboFull, fluxoMajorIa, "5565900000005");
confere("depois do rollback, a pergunta com a opção gravada roda pela regra",
  (await responde(roboFull, depoisDoRollback.exec, "agendar")).cursor === "fim");
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
confere("a migration reaplica depois do rollback", (await um("select to_regclass('public.ai_usage_events') v")).v !== null);

console.log(`${passou.length} conferências passaram, ${falhas.length} falharam`);
for (const item of falhas) console.log(`  FALHOU ${item}`);
process.exit(falhas.length ? 1 : 0);
