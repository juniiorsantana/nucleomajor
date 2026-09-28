// Prova comportamental da migration 20260926180000 (o formulário chama pelo
// fluxo) num Postgres embutido (PGlite). Banco em memória, nada de produção.
//
// Mesmo método das provas recentes: harness + TODAS as migrations reais, em
// ordem, até a anterior; o mundo é montado; aplica-se a nova; e o lead entra
// pela função real, como o webhook do Meta chama (anon + token da campanha).
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-formulario-pelo-fluxo.mjs . && node prova-formulario-pelo-fluxo.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-formulario-pelo-fluxo.mjs <repo>");
const MIGRATION = "20260926180000_o_formulario_chama_pelo_fluxo.sql";
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const sha = (texto) => createHash("sha256").update(texto, "utf8").digest("hex");

const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") => (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);

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
const DONO = "bbbbbbbb-0000-4000-8000-000000000002";
const ROBO = "dddddddd-0000-4000-8000-000000000003";
const CONEXAO = "eeeeeeee-0000-4000-8000-000000000004";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO}', 'adriani@exemplo.invalido', now()),
    ('${ROBO}', 'robot+base@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, 'base', 7)", ["adriani@exemplo.invalido"])).rows[0].access_code;
const org = (await como(usuario(DONO), "select public.create_organization('Adriani', $1) as id", [codigo])).rows[0].id;
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [CONEXAO, org]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, org, ROBO]);

const perfil = (await um(
  "select id from public.assistant_profiles where organization_id=$1 and audience='customer' order by created_at limit 1", [org])).id;
const campanha = async (nome, status = "test") => (await um(
  `insert into public.organization_campaigns (organization_id, assistant_profile_id, name, status, created_by, updated_by)
   values ($1, $2, $3, $4, $5, $5) returning id`, [org, perfil, nome, status, DONO])).id;
const ligar = async (campanhaId) => {
  const token = randomBytes(32).toString("hex");
  await db.query(
    `insert into public.campaign_site_intakes (campaign_id, organization_id, token_hash, welcome_template, tag_name, hourly_limit, enabled_by)
     values ($1, $2, $3, 'Oi, {nome}!', 'Lead Meta', 10, $4)`, [campanhaId, org, sha(token), DONO]);
  return token;
};

const META = await campanha("Formulário Meta · teste");
const SITE = await campanha("Diagnóstico do Site");
const PAUSADA = await campanha("Formulário pausado", "paused");
const tokenMeta = await ligar(META);
const tokenSite = await ligar(SITE);
const tokenPausada = await ligar(PAUSADA);

// ------------------------------------------------------- aplica a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));

const modos = (await db.query("select first_message m from public.campaign_site_intakes")).rows.map((r) => r.m);
confere("as ligações que já existiam continuam 'agent'", modos.length === 3 && modos.every((m) => m === "agent"), modos.join(","));
confere("modo desconhecido é recusado", await db.query(
  "update public.campaign_site_intakes set first_message='ia' where campaign_id=$1", [META]).then(() => false, () => true));
await db.query("update public.campaign_site_intakes set first_message='flow' where campaign_id in ($1, $2)", [META, PAUSADA]);

// O fluxo de gatilho "campanha" da Adriani, só com mensagem e pergunta.
const FLUXO = (campanhaId) => ({
  gatilho: { tipo: "campanha", campanhaId },
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "oi", tipo: "enviar_mensagem", texto: "Oi, {nome}! Aqui é a Adriani." },
    { id: "objetivo", tipo: "perguntar", texto: "Imóvel ou veículo?", opcoes: [{ id: "imovel", rotulo: "Imóvel" }, { id: "veiculo", rotulo: "Veículo" }] },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: { versao: 3, conexoes: [
    { source: "entrada", target: "condicoes", saida: "padrao" },
    { source: "condicoes", target: "oi", saida: "padrao" },
    { source: "oi", target: "objetivo", saida: "padrao" },
    { source: "objetivo", target: "fim", saida: "imovel" },
    { source: "objetivo", target: "fim", saida: "veiculo" },
    { source: "objetivo", target: "fim", saida: "nao_resolvido" },
  ] },
});
const erroDoFluxo = await db.query("select private.flow_validate($1::jsonb)", [JSON.stringify(FLUXO(META))]).then(() => "", (e) => e.message);
confere("o fluxo da Adriani é um fluxo válido", erroDoFluxo === "", erroDoFluxo);
const fluxoMeta = randomUUID();
await db.query(
  "insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Lead do Meta',$3,$3,$4::jsonb)",
  [fluxoMeta, org, DONO, JSON.stringify(FLUXO(META))]);
await db.query(
  "insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Pausada',$3,$3,$4::jsonb)",
  [randomUUID(), org, DONO, JSON.stringify(FLUXO(PAUSADA))]);

const receber = async (token, lead) =>
  (await como(null, "select public.nucleo_site_lead_receive($1, $2::jsonb) r", [token, JSON.stringify(lead)])).rows[0].r;
const fila = async (tipo) => (await db.query(
  "select private_payload p from public.connection_runtime_commands where command_type=$1 order by created_at, id", [tipo])).rows.map((r) => r.p);
const contextos = async () => Number((await um("select count(*)::int n from public.conversation_intelligence_contexts where organization_id=$1", [org])).n);

// ------------------------------------------------ 1. o lead novo, com consentimento
const ANA = "5565999998164";
let r = await receber(tokenMeta, { nome: "Ana Souza", telefone: ANA, consentimento: true });
confere("o lead é aceito", r.accepted === true, JSON.stringify(r));
confere("o motivo é 'flow' e nenhuma mensagem sai da função", r.flow === true && r.welcome === false && r.reason === "flow", JSON.stringify(r));
confere("ninguém da equipe é avisado pela VPS", r.teamNotified === false);
let gatilhos = await fila("flow_trigger");
confere("um flow_trigger, para o fluxo da campanha", gatilhos.length === 1 && gatilhos[0].chatbotId === fluxoMeta, JSON.stringify(gatilhos));
confere("o flow_trigger leva o telefone do lead", gatilhos[0]?.phone === ANA);
confere("nenhum site_lead_welcome na fila", (await fila("site_lead_welcome")).length === 0);
confere("nenhum contexto da IA foi criado", (await contextos()) === 0);
const contato = await um("select c.id, c.name, (select count(*)::int from public.contact_tags t join public.tags g on g.id=t.tag_id where t.contact_id=c.id and g.name='Lead Meta') etiqueta from public.contacts c where c.organization_id=$1 and c.phone=$2", [org, ANA]);
confere("o contato está no CRM, com a etiqueta", contato?.name === "Ana Souza" && contato.etiqueta === 1, JSON.stringify(contato));
confere("o lead fica marcado como chamado", (await um("select welcome_requested w from public.campaign_site_leads where phone=$1", [ANA])).w === true);

// ------------------------------------------------ 2. o mesmo lead de novo
r = await receber(tokenMeta, { nome: "Ana Souza", telefone: "65999998164", consentimento: true });
confere("o lead repetido volta como repetido", r.repeated === true && r.reason === "repeated", JSON.stringify(r));
r = await receber(tokenMeta, { nome: "Ana", telefone: "556599998164", consentimento: true });
confere("sem o nono dígito também é o mesmo lead", r.repeated === true, JSON.stringify(r));
confere("o repetido não dispara o fluxo de novo", (await fila("flow_trigger")).length === 1);

// ------------------------------------------------ 3. sem consentimento, depois com
const BIA = "5565988887777";
r = await receber(tokenMeta, { nome: "Bia", telefone: BIA, consentimento: false });
confere("sem consentimento o lead entra e ninguém chama", r.accepted === true && r.reason === "no_consent", JSON.stringify(r));
confere("sem consentimento não há flow_trigger", (await fila("flow_trigger")).length === 1);
r = await receber(tokenMeta, { nome: "Bia", telefone: BIA, consentimento: true });
confere("quem volta com consentimento é chamado agora", r.reason === "flow", JSON.stringify(r));
gatilhos = await fila("flow_trigger");
confere("e o fluxo dispara uma vez para ela", gatilhos.length === 2 && gatilhos[1].phone === BIA, JSON.stringify(gatilhos));

// ------------------------------------------------ 4. campanha pausada
r = await receber(tokenPausada, { nome: "Caio", telefone: "5565977776666", consentimento: true });
confere("campanha pausada não chama", r.reason === "campaign_paused", JSON.stringify(r));
confere("campanha pausada não dispara o fluxo", (await fila("flow_trigger")).length === 2);
confere("campanha pausada em modo fluxo também não avisa pela VPS", (await fila("site_lead_welcome")).length === 0);

// ------------------------------------------------ 5. sem fluxo, o lead não se perde
await db.query("update public.chatbot_definitions set active=false where id=$1", [fluxoMeta]);
const DUDA = "5565966665555";
r = await receber(tokenMeta, { nome: "Duda", telefone: DUDA, consentimento: true });
confere("sem fluxo ativo o lead entra mesmo assim", r.accepted === true && r.reason === "flow", JSON.stringify(r));
confere("sem fluxo ativo nada vai para a fila", (await fila("flow_trigger")).length === 2);
confere("o contato sem fluxo está no CRM", Boolean(await um("select 1 from public.contacts where organization_id=$1 and phone=$2", [org, DUDA])));
await db.query("update public.chatbot_definitions set active=true where id=$1", [fluxoMeta]);

// ------------------------------------------------ 6. o modo antigo não mudou
const EVA = "5565955554444";
r = await receber(tokenSite, { nome: "Eva", telefone: EVA, consentimento: true });
confere("no modo 'agent' a função manda a mensagem, como antes", r.welcome === true && r.reason === null && r.flow === false, JSON.stringify(r));
const boasVindas = await fila("site_lead_welcome");
confere("no modo 'agent' o site_lead_welcome sai com o texto", boasVindas.length === 1 && boasVindas[0].text === "Oi, Eva!" && boasVindas[0].sendWelcome === true, JSON.stringify(boasVindas));
confere("no modo 'agent' a conversa nasce com a IA", (await contextos()) === 2);

// Um fluxo de campanha numa ligação 'agent' segue a regra antiga: dispara
// quando o contato entra, sem olhar a marca.
await db.query(
  "insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Site',$3,$3,$4::jsonb)",
  [randomUUID(), org, DONO, JSON.stringify(FLUXO(SITE))]);
r = await receber(tokenSite, { nome: "Fábio", telefone: "5565944443333", consentimento: false });
confere("no modo 'agent' o gatilho de campanha segue disparando como antes", (await fila("flow_trigger")).length === 3, JSON.stringify(r));

// ------------------------------------------------ 7. o SQL de ligação, o real
// Rodado como o SQL Editor roda, trocando só o nome da organização.
const ligacao = ler("scripts/sql/ligar-formulario-meta.sql").replace("'Adriani Ademicon'", "'Adriani'");
const rodar = async () => (await db.query(ligacao)).rows[0];
let ligou = await rodar();
confere("a ligação devolve um token de 64 hexadecimais", /^[0-9a-f]{64}$/.test(ligou.token_para_o_servidor), JSON.stringify(ligou));
const criada = await um(
  "select c.id, c.status, c.created_by, i.first_message, i.tag_name, i.enabled from public.organization_campaigns c join public.campaign_site_intakes i on i.campaign_id=c.id where c.name='Formulário Meta · Adriani' and c.id <> $1", [META]);
confere("a ligação cria a campanha ativa, em modo fluxo", criada?.status === "active" && criada.first_message === "flow"
  && criada.created_by === DONO && criada.id === ligou.campanha, JSON.stringify(criada));
r = await receber(ligou.token_para_o_servidor, { nome: "Gabi", telefone: "5565933332222", consentimento: true });
confere("o token da ligação recebe lead em modo fluxo", r.reason === "flow", JSON.stringify(r));
const primeiro = ligou.token_para_o_servidor;
ligou = await rodar();
confere("rodar de novo reaproveita a campanha", ligou.campanha === criada.id, JSON.stringify(ligou));
confere("rodar de novo invalida o token anterior", await receber(primeiro, { nome: "Hugo", telefone: "5565922221111", consentimento: true })
  .then(() => false, (e) => /intake token is invalid/.test(e.message)));

// ------------------------------------------------ 8. o que ninguém de fora faz
confere("anon não chama o gatilho diretamente", await como(null, "select private.flow_trigger_on_campaign_lead()").then(() => false, () => true));

console.log(`\n${passou.length} passaram, ${falhas.length} falharam\n`);
for (const p of passou) console.log(`  ok  ${p}`);
for (const f of falhas) console.log(`  FALHOU  ${f}`);
process.exit(falhas.length ? 1 : 0);
