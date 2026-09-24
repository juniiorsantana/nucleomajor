// Prova comportamental da migration 20260926100000 (o plano Base roda fluxo)
// num Postgres embutido (PGlite). Banco em memória, nada de produção.
//
// Mesmo método das provas anteriores: harness + TODAS as migrations reais, em
// ordem. Duas perguntas centrais:
//
//   1. o porteiro passa a dizer `chatbotOnly` para quem tem chatbots e não tem
//      IA — e continua idêntico para todo o resto, inclusive a Major;
//   2. `nucleo_flow_start` cria o contato que não existe, e reaproveita o que
//      existe na outra forma do nono dígito.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-plano-base-roda-fluxo.mjs . && node prova-plano-base-roda-fluxo.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-plano-base-roda-fluxo.mjs <repo>");
const MIGRATION = "20260926100000_o_plano_base_roda_fluxo.sql";
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
const CLIENTE = "5565999990000";
// O mesmo celular sem o nono dígito, que é como muitas contas antigas estão
// gravadas — o WhatsApp entrega ora um, ora outro.
const CLIENTE_SEM_NOVE = "556599990000";
const DESCONHECIDO = "5565988887777";
const MARCADO = "5565977776666";

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

const acesso = async (quem, telefone) => (await como(quem, "select public.nucleo_customer_assistant_access($1) r", [telefone])).rows[0].r;

// ------------------------------------------------- antes de aplicar a nova
const antes = {
  full: await acesso(roboFull, CLIENTE),
  base: await acesso(roboBase, CLIENTE),
  atend: await acesso(roboAtend, CLIENTE),
};
confere("antes: base é recusado por plano", antes.base.reason === "plan_without_assistant", JSON.stringify(antes.base));
confere("antes: base não conhece chatbotOnly", antes.base.chatbotOnly === undefined);

// ------------------------------------------------------ aplica a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));

// ----------------------------------------------------- 1. o porteiro novo
const depois = {
  full: await acesso(roboFull, CLIENTE),
  base: await acesso(roboBase, CLIENTE),
  atend: await acesso(roboAtend, CLIENTE),
};
confere("a Major responde idêntico antes e depois", JSON.stringify(antes.full) === JSON.stringify(depois.full),
  `${JSON.stringify(antes.full)} -> ${JSON.stringify(depois.full)}`);
confere("o plano com IA responde idêntico antes e depois", JSON.stringify(antes.atend) === JSON.stringify(depois.atend),
  `${JSON.stringify(antes.atend)} -> ${JSON.stringify(depois.atend)}`);
confere("base sem chatbots continua plan_without_assistant", depois.base.reason === "plan_without_assistant", JSON.stringify(depois.base));

// Liga a função `chatbots` para a empresa Base, como o painel da plataforma faz.
await como(usuario(ADMIN), "select public.platform_entitlement_set($1, 'chatbots', true, null, null, 'prova', false)", [orgBase]);
confere("a função chatbots ficou ligada", (await um("select private.org_has_feature($1,'chatbots') v", [orgBase])).v === true);

const comChatbot = await acesso(roboBase, CLIENTE);
confere("base com chatbots recebe chatbotOnly", comChatbot.chatbotOnly === true, JSON.stringify(comChatbot));
confere("chatbotOnly mantém allowed false (runtime antigo segue recusando)", comChatbot.allowed === false, JSON.stringify(comChatbot));
confere("chatbotOnly traz o motivo próprio", comChatbot.reason === "chatbot_only", JSON.stringify(comChatbot));
confere("chatbotOnly não muda o plano com IA", (await acesso(roboAtend, CLIENTE)).chatbotOnly === undefined);

// A etiqueta "Não atender IA" vale no caminho novo.
const etiqueta = randomUUID();
const contatoMarcado = randomUUID();
await db.query("insert into public.tags (id, organization_id, name, legacy_id) values ($1, $2, 'Não atender IA', 'nao-atender-ia')", [etiqueta, orgBase]);
await db.query("insert into public.contacts (id, organization_id, name, phone) values ($1, $2, 'Marcado', $3)", [contatoMarcado, orgBase, MARCADO]);
await db.query("insert into public.contact_tags (organization_id, contact_id, tag_id) values ($1, $2, $3)", [orgBase, contatoMarcado, etiqueta]);
const marcado = await acesso(roboBase, MARCADO);
confere("contato com 'Não atender IA' não recebe chatbot", marcado.chatbotOnly === undefined, JSON.stringify(marcado));
confere("contato marcado volta a plan_without_assistant", marcado.reason === "plan_without_assistant", JSON.stringify(marcado));
confere("os outros contatos da mesma empresa seguem com chatbot", (await acesso(roboBase, CLIENTE)).chatbotOnly === true);

// ------------------------------------------- 2. o fluxo e o contato novo
const FLUXO = `{"condicoes":[{"tipo":"primeira_conversa"}],"passos":[
    {"id":"msg","tipo":"enviar_mensagem","texto":"Oi"},
    {"id":"fim","tipo":"encerrar"}],
  "canvas":{"versao":3,"conexoes":[
    {"source":"entrada","target":"condicoes","saida":"padrao"},
    {"source":"condicoes","target":"msg","saida":"padrao"},
    {"source":"msg","target":"fim","saida":"padrao"}]}}`;
const fluxoBase = randomUUID();
await db.query(
  "insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Boas-vindas',$3,$3,$4::jsonb)",
  [fluxoBase, orgBase, DONO_BASE, FLUXO],
);
const versao = (await um("select version from public.chatbot_definitions where id=$1", [fluxoBase])).version;

const contatosDe = async (org, telefone) => Number((await um(
  "select count(*)::int n from public.contacts where organization_id=$1 and deleted_at is null and regexp_replace(coalesce(phone,''),'[^0-9]','','g')=$2",
  [org, telefone],
)).n);

confere("o desconhecido não está no CRM antes", await contatosDe(orgBase, DESCONHECIDO) === 0);
const inicio = await como(roboBase, "select public.nucleo_flow_start($1, $2, $3, $4, $5, 0) r",
  [DESCONHECIDO, "msg-1", fluxoBase, versao, randomUUID()]);
confere("o fluxo começa para um número desconhecido", Boolean(inicio.rows[0].r?.executionId || inicio.rows[0].r?.id),
  JSON.stringify(inicio.rows[0].r).slice(0, 120));
confere("o desconhecido virou contato", await contatosDe(orgBase, DESCONHECIDO) === 1);
const criado = await um(
  "select name, source from public.contacts where organization_id=$1 and regexp_replace(coalesce(phone,''),'[^0-9]','','g')=$2",
  [orgBase, DESCONHECIDO]);
confere("o contato criado tem origem WhatsApp e nome vazio", criado.source === "WhatsApp" && criado.name === "",
  JSON.stringify(criado));

// O mesmo celular na outra forma não pode virar um segundo contato.
const contatoAntigo = randomUUID();
await db.query("insert into public.contacts (id, organization_id, name, phone) values ($1, $2, 'Antigo', $3)", [contatoAntigo, orgBase, CLIENTE_SEM_NOVE]);
await como(roboBase, "select public.nucleo_flow_start($1, $2, $3, $4, $5, 0) r",
  [CLIENTE, "msg-2", fluxoBase, versao, randomUUID()]);
confere("não duplica contato quando só muda o nono dígito", await contatosDe(orgBase, CLIENTE) === 0,
  `contatos com ${CLIENTE}: ${await contatosDe(orgBase, CLIENTE)}`);
const execucaoDoAntigo = await um(
  "select contact_id from public.chatbot_flow_executions where organization_id=$1 and requester_phone=$2", [orgBase, CLIENTE]);
confere("a execução aponta para o contato que já existia", execucaoDoAntigo?.contact_id === contatoAntigo,
  `${execucaoDoAntigo?.contact_id} vs ${contatoAntigo}`);

// O que já funcionava continua: contato existente pelo telefone exato.
const contatoExato = randomUUID();
const EXATO = "5565911112222";
await db.query("insert into public.contacts (id, organization_id, name, phone) values ($1, $2, 'Exato', $3)", [contatoExato, orgBase, EXATO]);
await como(roboBase, "select public.nucleo_flow_start($1, $2, $3, $4, $5, 0) r",
  [EXATO, "msg-3", fluxoBase, versao, randomUUID()]);
confere("contato exato continua sendo reaproveitado",
  (await um("select contact_id from public.chatbot_flow_executions where organization_id=$1 and requester_phone=$2", [orgBase, EXATO]))?.contact_id === contatoExato);

// O fluxo continua recusando o que já recusava.
const semFluxo = await erroDe(() => como(roboBase, "select public.nucleo_flow_start($1, $2, $3, $4, $5, 0) r",
  ["123", "msg-4", fluxoBase, versao, randomUUID()]));
confere("telefone inválido continua sendo recusado", /flow identity invalid/.test(semFluxo), semFluxo);

// ---------------------------------- 3. 20260926110000: o contato novo no chatbot
const MIGRATION_2 = "20260926110000_contato_novo_entra_no_chatbot.sql";
const contexto = async (telefone) => (await como(roboBase, "select public.nucleo_chatbot_runtime_context($1) r", [telefone])).rows[0].r;

// Antes: o contato gravado sem o nono dígito não é achado pelo contexto.
const contextoAntes = await contexto(CLIENTE);
confere("antes da 2: o contexto não acha o contato pela outra forma do celular", contextoAntes.contact === null,
  JSON.stringify(contextoAntes.contact));
const contextoExatoAntes = await contexto(EXATO);

await db.exec(ler(`supabase/migrations/${MIGRATION_2}`));

const contextoExatoDepois = await contexto(EXATO);
const semHorario = (c) => JSON.stringify({ ...c, chatbots: (c.chatbots || []).map((b) => ({ ...b, updatedAt: null })) });
confere("contexto do contato exato é idêntico antes e depois", semHorario(contextoExatoAntes) === semHorario(contextoExatoDepois));
confere("o contexto passa a achar o contato pela outra forma do celular", (await contexto(CLIENTE)).contact?.id === contatoAntigo);

const NOVO_V2 = "5565966665555";
const ctxNovo = await contexto(NOVO_V2);
confere("o contexto não cria contato para quem só escreveu", ctxNovo.contact === null && await contatosDe(orgBase, NOVO_V2) === 0);

// Fluxo simples (v2): a reserva cria o contato que não existe.
const FLUXO_V2 = `{"condicoes":[{"tipo":"primeira_conversa"}],"passos":[{"id":"oi","tipo":"enviar_mensagem","texto":"Oi"}]}`;
const fluxoV2 = randomUUID();
await db.query(
  "insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Boas-vindas v2',$3,$3,$4::jsonb)",
  [fluxoV2, orgBase, DONO_BASE, FLUXO_V2],
);
const versaoV2 = (await um("select version from public.chatbot_definitions where id=$1", [fluxoV2])).version;
const reserva = (await como(roboBase, "select public.nucleo_chatbot_execution_claim($1, 'msg-v2', $2, $3) r", [NOVO_V2, fluxoV2, versaoV2])).rows[0].r;
confere("a reserva do fluxo v2 funciona para um número desconhecido", reserva.status === "claimed", JSON.stringify(reserva));
confere("o desconhecido do v2 virou contato", await contatosDe(orgBase, NOVO_V2) === 1);
const eventoV2 = await um(
  "select string_agg(e.event_type, ',') t from public.contact_events e join public.contacts c on c.id=e.contact_id where c.organization_id=$1 and regexp_replace(c.phone,'[^0-9]','','g')=$2",
  [orgBase, NOVO_V2]);
confere("o contato criado pelo v2 leva o evento contact.created", eventoV2.t === "contact.created", eventoV2.t);
confere("o contexto do contato criado tem 'primeira conversa'", JSON.stringify((await contexto(NOVO_V2)).contact?.eventTypes) === '["contact.created"]');

// Fluxo com caminhos (v3), pela função auxiliar.
const NOVO_V3 = "5565955554444";
await como(roboBase, "select public.nucleo_flow_start($1, 'msg-v3', $2, $3, $4, 0) r", [NOVO_V3, fluxoBase, versao, randomUUID()]);
const eventoV3 = await um(
  "select string_agg(e.event_type, ',') t from public.contact_events e join public.contacts c on c.id=e.contact_id where c.organization_id=$1 and regexp_replace(c.phone,'[^0-9]','','g')=$2",
  [orgBase, NOVO_V3]);
confere("o contato criado pelo v3 leva o evento contact.created", eventoV3.t === "contact.created", eventoV3.t);
await como(roboBase, "select public.nucleo_chatbot_execution_claim($1, 'msg-v2b', $2, $3) r", [NOVO_V2, fluxoV2, versaoV2]);
confere("o mesmo número não vira dois contatos", await contatosDe(orgBase, NOVO_V2) === 1);

const auxiliarDeFora = await erroDe(() => como(roboBase, "select private.flow_contact_for($1, '5565944443333', true)", [orgBase]));
confere("a função auxiliar não é executável de fora", /permission denied/.test(auxiliarDeFora), auxiliarDeFora);

// ---------------------- 4. 20260926120000: o fluxo pergunta e tem gatilhos
const MIGRATION_3 = "20260926120000_o_fluxo_pergunta_e_tem_gatilhos.sql";

// A tabela de leads do site vem de 20260915000000. Se a cadeia não a tiver, um
// retrato mínimo basta para o gatilho de campanha nascer.
await db.exec(`create table if not exists public.campaign_site_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, campaign_id uuid not null, contact_id uuid)`);
const tiposAntes = (await um(`select pg_get_constraintdef(c.oid) d from pg_constraint c
  where c.conrelid='public.connection_runtime_commands'::regclass and c.conname='connection_runtime_commands_command_type_check'`)).d;

await db.exec(ler(`supabase/migrations/${MIGRATION_3}`));

const tiposDepois = (await um(`select pg_get_constraintdef(c.oid) d from pg_constraint c
  where c.conrelid='public.connection_runtime_commands'::regclass and c.conname='connection_runtime_commands_command_type_check'`)).d;
confere("a fila passa a aceitar flow_trigger", tiposDepois.includes("flow_trigger"));
const tiposQueJaExistiam = [...tiposAntes.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
confere("nenhum tipo de comando que existia se perdeu", tiposQueJaExistiam.every((t) => tiposDepois.includes(`'${t}'`)),
  tiposQueJaExistiam.join(","));

const valida = (definicao) => erroDe(() => db.query("select private.flow_validate($1::jsonb)", [JSON.stringify(definicao)]));
const canvas = (conexoes) => ({ versao: 3, conexoes });
const PERGUNTA = {
  gatilho: { tipo: "palavra", palavras: ["quero agendar", "horário"] },
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "menu", tipo: "perguntar", texto: "Como posso ajudar?", tentativas: 2, prazoHoras: 24,
      opcoes: [{ id: "agendar", rotulo: "Agendar", sinonimos: ["marcar"] }, { id: "precos", rotulo: "Preços" }] },
    { id: "nome", tipo: "coletar", texto: "Qual é o seu nome?", variavel: "nome_cliente" },
    { id: "oi", tipo: "enviar_mensagem", texto: "Obrigado, {nome_cliente}!" },
    { id: "tabela", tipo: "enviar_mensagem", texto: "Nossa tabela..." },
    { id: "equipe", tipo: "transferir", destino: "humano" },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: canvas([
    { source: "entrada", target: "condicoes", saida: "padrao" },
    { source: "condicoes", target: "menu", saida: "padrao" },
    { source: "menu", target: "nome", saida: "agendar" },
    { source: "menu", target: "tabela", saida: "precos" },
    { source: "menu", target: "equipe", saida: "nao_resolvido" },
    { source: "nome", target: "oi", saida: "padrao" },
    { source: "nome", target: "equipe", saida: "nao_resolvido" },
    { source: "oi", target: "fim", saida: "padrao" },
    { source: "tabela", target: "fim", saida: "padrao" },
  ]),
};
confere("um fluxo com pergunta, coleta e gatilho por palavra é aceito", (await valida(PERGUNTA)) === "", await valida(PERGUNTA));
const comPassos = (troca) => ({ ...PERGUNTA, passos: PERGUNTA.passos.map((p) => (p.id === "menu" ? { ...p, ...troca } : p)) });
confere("opção com id repetido é recusada", /question invalid/.test(await valida(comPassos({
  opcoes: [{ id: "agendar", rotulo: "A" }, { id: "agendar", rotulo: "B" }] }))));
confere("opção chamada nao_resolvido é recusada", /question invalid/.test(await valida(comPassos({
  opcoes: [{ id: "nao_resolvido", rotulo: "A" }, { id: "precos", rotulo: "Preços" }] }))));
confere("pergunta sem opções é recusada", /question invalid/.test(await valida(comPassos({ opcoes: [] }))));
confere("tentativas fora de 1 a 5 são recusadas", /question invalid/.test(await valida(comPassos({ tentativas: 9 }))));
confere("saída de opção faltando é recusada", /ports incomplete/.test(await valida({
  ...PERGUNTA, canvas: canvas(PERGUNTA.canvas.conexoes.filter((c) => !(c.source === "menu" && c.saida === "precos"))) })));
confere("variável com nome inválido é recusada", /question invalid/.test(await valida({
  ...PERGUNTA, passos: PERGUNTA.passos.map((p) => (p.id === "nome" ? { ...p, variavel: "Nome Cliente" } : p)) })));
confere("gatilho desconhecido é recusado", /trigger invalid/.test(await valida({ ...PERGUNTA, gatilho: { tipo: "horoscopo" } })));
confere("gatilho de etiqueta sem etiqueta é recusado", /trigger invalid/.test(await valida({ ...PERGUNTA, gatilho: { tipo: "etiqueta" } })));
confere("fluxo sem gatilho continua aceito", (await valida({ ...PERGUNTA, gatilho: undefined })) === "");

// A execução da pergunta, de ponta a ponta, como a VPS faz.
const fluxoPergunta = randomUUID();
await db.query(
  "insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Menu',$3,$3,$4::jsonb)",
  [fluxoPergunta, orgBase, DONO_BASE, JSON.stringify(PERGUNTA)],
);
const versaoPergunta = (await um("select version from public.chatbot_definitions where id=$1", [fluxoPergunta])).version;
const rpc = async (sql, params) => (await como(roboBase, sql, params)).rows[0].r;
const PERGUNTADO = "5565933332222";
let exec = await rpc("select public.nucleo_flow_start($1,'q-1',$2,$3,$4,0) r", [PERGUNTADO, fluxoPergunta, versaoPergunta, randomUUID()]);
let reserva3 = await rpc("select public.nucleo_flow_claim($1,$2) r", [exec.executionId, exec.revision]);
confere("a pergunta ganha uma suspensão ao ser reservada", Boolean(reserva3.suspensionId));
exec = await rpc("select public.nucleo_flow_ack($1,$2,'','confirmed') r", [exec.executionId, reserva3.claimToken]);
confere("depois de perguntar, a execução espera a resposta", exec.status === "suspended" && exec.waiting === "reply", JSON.stringify(exec));
const prazo = new Date(exec.suspensionExpiresAt).getTime() - Date.now();
confere("o prazo da pergunta é o do bloco (24h)", prazo > 23.9 * 3600e3 && prazo <= 24 * 3600e3, String(prazo));
confere("a etapa de IA não encerra uma pergunta", /suspension invalid/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_finish_ai($1,$2,$3,'falha') r", [exec.executionId, reserva3.suspensionId, PERGUNTADO]))));

exec = await rpc("select public.nucleo_flow_answer_retry($1,$2,$3) r", [exec.executionId, reserva3.suspensionId, PERGUNTADO]);
confere("uma resposta não entendida conta uma tentativa", exec.attempts === 1 && exec.status === "suspended");
confere("sem tentativa sobrando, a repetição é recusada", /attempts exhausted/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer_retry($1,$2,$3) r", [exec.executionId, reserva3.suspensionId, PERGUNTADO]))));
confere("resposta com saída inexistente é recusada", /output invalid/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer($1,$2,$3,'cancelar',null) r", [exec.executionId, reserva3.suspensionId, PERGUNTADO]))));

exec = await rpc("select public.nucleo_flow_answer($1,$2,$3,'agendar',null) r", [exec.executionId, reserva3.suspensionId, PERGUNTADO]);
confere("a resposta leva à saída da opção escolhida", exec.cursor === "nome" && exec.status === "ready" && exec.attempts === 0,
  JSON.stringify(exec));
const repetida = await rpc("select public.nucleo_flow_answer($1,$2,$3,'agendar',null) r", [exec.executionId, reserva3.suspensionId, PERGUNTADO]);
confere("a mesma resposta duas vezes não anda duas casas", repetida.cursor === "nome" && repetida.revision === exec.revision);

// Coletar: guarda o que o contato escreveu.
reserva3 = await rpc("select public.nucleo_flow_claim($1,$2) r", [exec.executionId, exec.revision]);
exec = await rpc("select public.nucleo_flow_ack($1,$2,'','confirmed') r", [exec.executionId, reserva3.claimToken]);
confere("coletar também espera a resposta", exec.waiting === "reply");
exec = await rpc("select public.nucleo_flow_answer($1,$2,$3,'padrao',$4) r",
  [exec.executionId, reserva3.suspensionId, PERGUNTADO, "  Maria Souza  "]);
confere("a resposta de coletar vira variável da execução", exec.variables?.nome_cliente === "Maria Souza" && exec.cursor === "oi",
  JSON.stringify(exec.variables));

// Prazo vencido: só a desistência vale.
const PRAZO = "5565922221111";
let execPrazo = await rpc("select public.nucleo_flow_start($1,'q-2',$2,$3,$4,0) r", [PRAZO, fluxoPergunta, versaoPergunta, randomUUID()]);
const reservaPrazo = await rpc("select public.nucleo_flow_claim($1,$2) r", [execPrazo.executionId, execPrazo.revision]);
execPrazo = await rpc("select public.nucleo_flow_ack($1,$2,'','confirmed') r", [execPrazo.executionId, reservaPrazo.claimToken]);
await db.query("update public.chatbot_flow_executions set suspension_expires_at=now()-interval '1 minute' where id=$1", [execPrazo.executionId]);
confere("depois do prazo, escolher uma opção é recusado", /expired/.test(await erroDe(() =>
  rpc("select public.nucleo_flow_answer($1,$2,$3,'agendar',null) r", [execPrazo.executionId, reservaPrazo.suspensionId, PRAZO]))));
execPrazo = await rpc("select public.nucleo_flow_answer($1,$2,$3,'nao_resolvido',null) r", [execPrazo.executionId, reservaPrazo.suspensionId, PRAZO]);
confere("depois do prazo, a pergunta sai por nao_resolvido", execPrazo.cursor === "equipe" && execPrazo.reason === "reply_timeout");

// A etapa de IA continua como sempre.
const IA_FLUXO = {
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [{ id: "ia", tipo: "transferir", destino: "ia", objetivoIa: "Qualificar" }, { id: "ok", tipo: "encerrar" }, { id: "ruim", tipo: "encerrar" }],
  canvas: canvas([{ source: "entrada", target: "condicoes", saida: "padrao" }, { source: "condicoes", target: "ia", saida: "padrao" },
    { source: "ia", target: "ok", saida: "sucesso" }, { source: "ia", target: "ruim", saida: "falha" }]),
};
const fluxoIa = randomUUID();
await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'IA',$3,$3,$4::jsonb)",
  [fluxoIa, orgBase, DONO_BASE, JSON.stringify(IA_FLUXO)]);
const COM_IA = "5565911110000";
let execIa = await rpc("select public.nucleo_flow_start($1,'ia-1',$2,1,$3,0) r", [COM_IA, fluxoIa, randomUUID()]);
const reservaIa = await rpc("select public.nucleo_flow_claim($1,$2) r", [execIa.executionId, execIa.revision]);
execIa = await rpc("select public.nucleo_flow_ack($1,$2,'','confirmed') r", [execIa.executionId, reservaIa.claimToken]);
confere("a etapa de IA espera a IA, não a resposta", execIa.waiting === "ia");
execIa = await rpc("select public.nucleo_flow_finish_ai($1,$2,$3,'falha') r", [execIa.executionId, reservaIa.suspensionId, COM_IA]);
confere("a etapa de IA continua saindo pela falha", execIa.cursor === "ruim");

// ------------------------------------------------------------ os gatilhos
const comandos = async () => (await db.query(
  "select private_payload p, created_by from public.connection_runtime_commands where command_type='flow_trigger' order by created_at, id")).rows;
const etiquetaGatilho = randomUUID();
await db.query("insert into public.tags (id, organization_id, name) values ($1, $2, 'Quente')", [etiquetaGatilho, orgBase]);
const FIM_SIMPLES = (gatilho) => ({
  gatilho, condicoes: [{ tipo: "primeira_conversa" }],
  passos: [{ id: "oi", tipo: "enviar_mensagem", texto: "Oi" }, { id: "fim", tipo: "encerrar" }],
  canvas: canvas([{ source: "entrada", target: "condicoes", saida: "padrao" }, { source: "condicoes", target: "oi", saida: "padrao" },
    { source: "oi", target: "fim", saida: "padrao" }]),
});
const fluxoEtiqueta = randomUUID();
await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Quente',$3,$3,$4::jsonb)",
  [fluxoEtiqueta, orgBase, DONO_BASE, JSON.stringify(FIM_SIMPLES({ tipo: "etiqueta", etiquetaId: etiquetaGatilho }))]);
const contatoGatilho = randomUUID();
await db.query("insert into public.contacts (id, organization_id, name, phone) values ($1, $2, 'Lead', '5565900001111')", [contatoGatilho, orgBase]);
const antesDaEtiqueta = (await comandos()).length;
await db.query("insert into public.contact_tags (organization_id, contact_id, tag_id) values ($1, $2, $3)", [orgBase, contatoGatilho, etiquetaGatilho]);
const depoisDaEtiqueta = await comandos();
confere("aplicar a etiqueta enfileira o fluxo dela", depoisDaEtiqueta.length === antesDaEtiqueta + 1
  && depoisDaEtiqueta.at(-1).p.chatbotId === fluxoEtiqueta && depoisDaEtiqueta.at(-1).p.phone === "5565900001111",
  JSON.stringify(depoisDaEtiqueta.at(-1)?.p));
confere("sem autor na sessão, o comando fica em nome de quem criou o fluxo", depoisDaEtiqueta.at(-1).created_by === DONO_BASE);

// Quem pediu "Não atender IA" não recebe o gatilho automático.
await db.query("insert into public.contact_tags (organization_id, contact_id, tag_id) values ($1, $2, $3)", [orgBase, contatoMarcado, etiquetaGatilho]);
confere("contato com 'Não atender IA' não recebe gatilho automático", (await comandos()).length === depoisDaEtiqueta.length);

// Etapa do funil.
const etapaA = randomUUID(); const etapaB = randomUUID();
await db.query("insert into public.stages (id, organization_id, name, position) values ($1,$2,'Contato',100),($3,$2,'Proposta',101)", [etapaA, orgBase, etapaB]);
const fluxoEtapa = randomUUID();
await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Proposta',$3,$3,$4::jsonb)",
  [fluxoEtapa, orgBase, DONO_BASE, JSON.stringify(FIM_SIMPLES({ tipo: "etapa", stageId: etapaB }))]);
const negocio = randomUUID();
await db.query("insert into public.deals (id, organization_id, contact_id, stage_id, title) values ($1,$2,$3,$4,'Negócio')", [negocio, orgBase, contatoGatilho, etapaA]);
const antesDaEtapa = (await comandos()).length;
await db.query("update public.deals set stage_id=$1 where id=$2", [etapaB, negocio]);
confere("mover o negócio para a etapa enfileira o fluxo dela", (await comandos()).length === antesDaEtapa + 1
  && (await comandos()).at(-1).p.chatbotId === fluxoEtapa);
await db.query("update public.deals set title='Outro nome' where id=$1", [negocio]);
confere("mexer no negócio sem mudar a etapa não dispara nada", (await comandos()).length === antesDaEtapa + 1);

// Campanha (lead do site).
const campanhaGatilho = randomUUID();
const fluxoCampanha = randomUUID();
await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Campanha',$3,$3,$4::jsonb)",
  [fluxoCampanha, orgBase, DONO_BASE, JSON.stringify(FIM_SIMPLES({ tipo: "campanha", campanhaId: campanhaGatilho }))]);
const antesDaCampanha = (await comandos()).length;
const leadSite = randomUUID();
// Com a tabela de verdade, o lead pede telefone e nome, e a campanha de verdade
// pede agente e perfil — nada disso é o que esta prova confere. Só a chave para
// a campanha sai, neste banco descartável.
const leadDeVerdade = (await db.query(`select 1 from information_schema.columns
  where table_schema='public' and table_name='campaign_site_leads' and column_name='phone'`)).rows.length > 0;
if (leadDeVerdade) {
  for (const { conname } of (await db.query(`select conname from pg_constraint
    where conrelid='public.campaign_site_leads'::regclass and confrelid='public.organization_campaigns'::regclass`)).rows) {
    await db.exec(`alter table public.campaign_site_leads drop constraint "${conname}"`);
  }
  await db.query("insert into public.campaign_site_leads (id, organization_id, campaign_id, phone, name) values ($1,$2,$3,'5565911112222','Lead do site')",
    [leadSite, orgBase, campanhaGatilho]);
} else {
  await db.query("insert into public.campaign_site_leads (id, organization_id, campaign_id) values ($1,$2,$3)", [leadSite, orgBase, campanhaGatilho]);
}
await db.query("update public.campaign_site_leads set contact_id=$1 where id=$2", [contatoGatilho, leadSite]);
confere("o lead que entra na campanha enfileira o fluxo dela", (await comandos()).length === antesDaCampanha + 1
  && (await comandos()).at(-1).p.chatbotId === fluxoCampanha);

// Manual.
const fluxoManual = randomUUID();
await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Follow-up',$3,$3,$4::jsonb)",
  [fluxoManual, orgBase, DONO_BASE, JSON.stringify(FIM_SIMPLES({ tipo: "manual" }))]);
const manual = (await como(usuario(DONO_BASE), "select public.nucleo_flow_trigger_manual($1,$2) r", [contatoGatilho, fluxoManual])).rows[0].r;
confere("alguém da equipe inicia o follow-up manual", manual.queued === 1 && (await comandos()).at(-1).p.manual === true
  && (await comandos()).at(-1).created_by === DONO_BASE);
confere("o manual passa mesmo com 'Não atender IA'", (await como(usuario(DONO_BASE), "select public.nucleo_flow_trigger_manual($1,$2) r",
  [contatoMarcado, fluxoManual])).rows[0].r.queued === 1);
confere("quem não é da empresa não dispara", /contact unavailable/.test(await erroDe(() =>
  como(usuario(DONO_ATEND), "select public.nucleo_flow_trigger_manual($1,$2) r", [contatoGatilho, fluxoManual]))));
confere("fluxo que não é manual não é disparado à mão", /flow unavailable/.test(await erroDe(() =>
  como(usuario(DONO_BASE), "select public.nucleo_flow_trigger_manual($1,$2) r", [contatoGatilho, fluxoEtiqueta]))));
confere("o robô não dispara fluxo manual", /contact unavailable/.test(await erroDe(() =>
  como(roboBase, "select public.nucleo_flow_trigger_manual($1,$2) r", [contatoGatilho, fluxoManual]))));

// Sem a função chatbots, nada é enfileirado.
await como(usuario(ADMIN), "select public.platform_entitlement_set($1, 'chatbots', false, null, null, 'prova', false)", [orgBase]);
const antesSemChatbot = (await comandos()).length;
await db.query("delete from public.contact_tags where contact_id=$1 and tag_id=$2", [contatoGatilho, etiquetaGatilho]);
await db.query("insert into public.contact_tags (organization_id, contact_id, tag_id) values ($1, $2, $3)", [orgBase, contatoGatilho, etiquetaGatilho]);
confere("sem a função chatbots, a etiqueta não dispara fluxo", (await comandos()).length === antesSemChatbot);
confere("a etiqueta continua aplicada mesmo sem disparar", Number((await um(
  "select count(*)::int n from public.contact_tags where contact_id=$1 and tag_id=$2", [contatoGatilho, etiquetaGatilho])).n) === 1);

// ------------------------------- 5. 20260926130000: o plano Base tem chatbot
await db.exec(ler("supabase/migrations/20260926130000_o_plano_base_tem_chatbot.sql"));
await como(usuario(ADMIN), "select public.platform_entitlement_clear($1, 'chatbots', 'prova')", [orgBase]);
confere("o plano Base passa a ter chatbots sem ajuste nenhum", (await um("select private.org_has_feature($1,'chatbots') v", [orgBase])).v === true);
confere("o plano Base continua sem IA", (await um("select private.org_has_feature($1,'ai_customer') v", [orgBase])).v === false);
confere("o porteiro do Base responde chatbotOnly pelo plano", (await acesso(roboBase, "5565977770000")).chatbotOnly === true);
confere("a Major continua igual", JSON.stringify(await acesso(roboFull, CLIENTE)) === JSON.stringify(antes.full));

// -------------------------------------------------------------- resultado
console.log(`\nPASS ${passou.length}`);
for (const p of passou) console.log("  ok  " + p);
if (falhas.length) {
  console.log(`\nFAIL ${falhas.length}`);
  for (const f of falhas) console.log("  X   " + f);
  process.exit(1);
}
console.log("\nTudo certo.");
