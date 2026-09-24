// Prova comportamental da migration 20260915000000 num Postgres embutido (PGlite).
// Nada aqui toca produção: banco em memória, criado e destruído neste processo.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql/prova-lead-do-site.mjs . && node prova-lead-do-site.mjs <repo>
//
// As tabelas que a função toca saem dos arquivos REAIS das migrations
// (organization_campaigns, conversation_intelligence_contexts, a fila de
// comandos e o check dela), para a prova não passar contra uma cópia que
// divergiu. `extensions.digest` usa o sha256 nativo: a chave do contexto
// precisa ser byte a byte a que o runtime calcula em Python.
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const REPO = process.argv[2];
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const migration = ler("supabase/migrations/20260915000000_o_lead_do_site_chama_a_ia.sql");
const ligacao = ler("scripts/sql/ligar-campanha-do-site.sql");
const faseH = ler("supabase/migrations/20260823120000_fase_h_inteligencia_contextual.sql");
const fila = ler("supabase/migrations/20260826010000_vps_operator_verification_commands.sql");
const qr = ler("supabase/migrations/20260910010000_qr_do_whatsapp_pelo_portal.sql");
const novaConversa = ler("supabase/migrations/20260908120000_nova_conversa_e_verificacao_de_numero.sql");

const trecho = (texto, inicio, fim) => {
  const i = texto.indexOf(inicio);
  if (i < 0) throw new Error(`trecho não achado: ${inicio}`);
  const j = texto.indexOf(fim, i);
  return texto.slice(i, j + fim.length);
};

const tabelaCampanhas = trecho(faseH, "create table if not exists public.organization_campaigns (", "\n);");
const tabelaContextos = trecho(faseH, "create table if not exists public.conversation_intelligence_contexts (", "\n);");
const indiceContexto = trecho(faseH, "create unique index if not exists conversation_intelligence_active_key_idx", ";");
const tabelaFila = trecho(fila, "create table if not exists public.connection_runtime_commands (", "\n);");
const checkDaFila = trecho(qr, "alter table public.connection_runtime_commands\n  drop constraint", "));");
// O PGlite 0.2 é PostgreSQL 16, que não tem `min(uuid)`; produção tem, e a
// função está em uso lá desde 08/09. Só a cópia da prova troca o agregado.
const conexaoDaOrganizacao = trecho(novaConversa, "create or replace function private.conexao_da_organizacao", "$$;")
  .replace("min(connection.id)", "min(connection.id::text)::uuid");

const ORG = "11111111-1111-4111-8111-111111111111";
const DONO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OUTRO_AGENTE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONEXAO = "8ee1e6d0-a9d0-4041-b6ea-878716a34a71";
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

async function mundo({ comConexao = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create schema private;
    create schema extensions;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function extensions.digest(text, text) returns bytea language sql immutable as
      $$ select sha256(convert_to($1, 'UTF8')) $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as
      $$ select decode(md5(random()::text) || md5(random()::text), 'hex') $$;

    create table public.organizations (id uuid primary key);
    create table public.profiles (id uuid primary key);
    create table public.organization_members (
      organization_id uuid not null, user_id uuid not null, status text not null default 'active'
    );
    create or replace function private.is_org_member(target_organization uuid)
    returns boolean language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.organization_members m
        where m.organization_id = target_organization and m.user_id = auth.uid() and m.status = 'active');
    $$;

    create table public.skill_definitions (id uuid primary key);
    create table public.assistant_profiles (
      id uuid primary key, organization_id uuid not null references public.organizations(id),
      audience text not null, active boolean not null default true,
      unique (id, organization_id)
    );
    create table public.whatsapp_connections (
      id uuid primary key, organization_id uuid not null references public.organizations(id),
      status text not null default 'active', revoked_at timestamptz,
      unique (id, organization_id)
    );
    create table public.contacts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id),
      name text not null default '', phone text not null default '', email text,
      source text not null default '',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      deleted_at timestamptz,
      unique (id, organization_id)
    );
    create unique index contacts_phone_unique on public.contacts (organization_id, phone)
      where phone <> '' and deleted_at is null;
    create table public.tags (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id),
      name text not null check (length(trim(name)) between 1 and 80),
      color text not null default '#626B7A',
      created_at timestamptz not null default now(), deleted_at timestamptz,
      unique (id, organization_id)
    );
    create table public.contact_tags (
      organization_id uuid not null, contact_id uuid not null, tag_id uuid not null,
      primary key (contact_id, tag_id),
      foreign key (contact_id, organization_id) references public.contacts(id, organization_id) on delete cascade,
      foreign key (tag_id, organization_id) references public.tags(id, organization_id) on delete cascade
    );
    create table public.contact_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id),
      contact_id uuid not null, event_type text not null, entity_type text, entity_id uuid,
      source text not null default 'app', payload jsonb not null default '{}'::jsonb,
      created_by uuid references public.profiles(id),
      foreign key (contact_id, organization_id) references public.contacts(id, organization_id)
    );

    ${tabelaCampanhas}
    ${tabelaContextos}
    ${indiceContexto}
    ${tabelaFila}
    ${checkDaFila}
    ${conexaoDaOrganizacao}

    insert into public.organizations values ('${ORG}');
    insert into public.profiles values ('${DONO}');
    insert into public.assistant_profiles values
      ('${AGENTE}', '${ORG}', 'customer', true),
      ('${OUTRO_AGENTE}', '${ORG}', 'customer', true);
    insert into public.organization_campaigns (organization_id, assistant_profile_id, name, status, created_by, updated_by)
    values ('${ORG}', '${AGENTE}', 'Diagnóstico do Site', 'test', '${DONO}', '${DONO}');
  `);
  if (comConexao) {
    await db.exec(`insert into public.whatsapp_connections (id, organization_id) values ('${CONEXAO}', '${ORG}')`);
  }
  return db;
}

const um = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const conta = async (db, sql, params = []) => Number((await um(db, sql, params)).n);

const LEAD = {
  nome: "ana souza",
  telefone: "(65) 99999-8164",
  email: "ana_souza@empresa.com.br",
  site: "empresa.com.br",
  consentimento: true,
  diagnostico: {
    notaGeral: 42.4,
    faixa: "Regular",
    servico: "Site Profissional",
    categorias: [
      { id: "desempenho", nome: "Desempenho", nota: 70 },
      { id: "seo", nome: "SEO", nota: "38" },
      { id: "ia", nome: "IA", nota: 300 },
      { id: "presenca", nome: "Presença", nota: "abc" },
    ],
    falhas: ["Sem meta description", "", "Bloqueia robôs de IA"],
  },
};

// ============================================================ o caminho feliz
const db = await mundo();

const erroMigration = await erroDe(() => db.exec(migration));
confere("A. migration aplica sem erro", !erroMigration, erroMigration);
const erroReaplicar = await erroDe(() => db.exec(migration));
confere("A2. migration reaplica sem erro (idempotente)", !erroReaplicar, erroReaplicar);

const resultadoLigacao = await um(db, ligacao.split("-- Trocar só a mensagem")[0]);
const TOKEN = resultadoLigacao.token_para_a_vercel;
confere("B. o SQL de ligação devolve um token de 64 hex", /^[0-9a-f]{64}$/.test(TOKEN), TOKEN);
confere(
  "B2. o banco guarda só o hash do token",
  (await conta(db, `select count(*) n from public.campaign_site_intakes where token_hash = $1`, [sha(TOKEN)])) === 1
);
confere(
  "B3. quem assina a fila é quem criou a campanha",
  (await um(db, `select enabled_by from public.campaign_site_intakes`)).enabled_by === DONO
);

const receber = async (lead, token = TOKEN) => {
  await db.exec("set role anon");
  try {
    return (await um(db, `select public.nucleo_site_lead_receive($1, $2::jsonb) as r`, [token, JSON.stringify(lead)])).r;
  } finally {
    await db.exec("reset role");
  }
};

confere("C. token errado é recusado", (await erroDe(() => receber(LEAD, "f".repeat(64)))).includes("intake token is invalid"));
confere("C2. token malformado é recusado", (await erroDe(() => receber(LEAD, "nao-e-token"))).includes("intake token is invalid"));

const r1 = await receber(LEAD);
confere("D. lead novo aceito, com mensagem", r1.accepted === true && r1.welcome === true && r1.repeated === false, JSON.stringify(r1));

const lead1 = await um(db, `select * from public.campaign_site_leads`);
confere("D2. telefone normalizado com 55", lead1.phone === "5565999998164", lead1.phone);
confere("D3. consentimento gravado", lead1.consent === true);

const contato = await um(db, `select * from public.contacts`);
confere("E. contato criado no CRM", contato && contato.phone === "5565999998164" && contato.email === LEAD.email, JSON.stringify(contato));
confere("E2. origem do contato diz a campanha", contato.source === "Site · Diagnóstico do Site", contato.source);
confere(
  "E3. etiqueta criada e aplicada",
  (await conta(db, `select count(*) n from public.contact_tags ct join public.tags t on t.id = ct.tag_id where t.name = 'Lead Diagnóstico'`)) === 1
);
confere(
  "E4. evento lead.site registrado",
  (await conta(db, `select count(*) n from public.contact_events where event_type = 'lead.site' and payload->>'notaGeral' = '42'`)) === 1
);

const contextos = (await db.query(`select * from public.conversation_intelligence_contexts order by conversation_key_hash`)).rows;
const hashesEsperados = [sha("5565999998164"), sha("556599998164")].sort();
confere(
  "F. dois contextos, um por forma do celular, com a MESMA chave do runtime (sha256 do telefone)",
  JSON.stringify(contextos.map((c) => c.conversation_key_hash).sort()) === JSON.stringify(hashesEsperados),
  JSON.stringify(contextos.map((c) => c.conversation_key_hash))
);
confere(
  "F2. contextos já com agente, campanha, público cliente e canal whatsapp",
  contextos.every((c) => c.assistant_profile_id === AGENTE && c.campaign_id && c.audience === "customer" && c.channel === "whatsapp" && c.state === "active")
);

const cmd1 = await um(db, `select * from public.connection_runtime_commands`);
const carga = cmd1.private_payload;
confere("G. comando site_lead_welcome na fila da conexão", cmd1.command_type === "site_lead_welcome" && cmd1.connection_id === CONEXAO && cmd1.status === "pending");
confere("G2. comando assinado por quem criou a campanha", cmd1.created_by === DONO);
confere("G3. carga manda a mensagem para o telefone do lead", carga.phone === "5565999998164" && carga.sendWelcome === true && carga.skipReason === "");
confere(
  "G4. {nome} vira o primeiro nome com inicial maiúscula e {site} vira o domínio",
  carga.text.startsWith("Oi, Ana! Aqui é da Major") && carga.text.includes("diagnóstico do site empresa.com.br."),
  carga.text
);
confere("G5. a carga não tem campo de destinatário da equipe", !("teamPhones" in carga) && !("notifyTo" in carga) && Object.keys(carga).sort().join() === "authorName,lead,phone,sendWelcome,skipReason,text");
confere(
  "G6. diagnóstico sanitizado: nota arredondada, categoria com nota fora de 0..100 ou texto descartada, falha vazia descartada",
  carga.lead.notaGeral === 42 &&
    JSON.stringify(carga.lead.categorias) === JSON.stringify([{ nome: "Desempenho", nota: 70 }, { nome: "SEO", nota: 38 }]) &&
    JSON.stringify(carga.lead.falhas) === JSON.stringify(["Sem meta description", "Bloqueia robôs de IA"]),
  JSON.stringify(carga.lead)
);
confere("G7. expira em 12 horas", Math.abs(new Date(cmd1.expires_at) - Date.now() - 12 * 3600 * 1000) < 60_000);

// ================================================================= repetido
const r2 = await receber({ ...LEAD, telefone: "556599998164", nome: "Ana" });
confere("H. mesmo celular sem o nono dígito é o mesmo lead", r2.repeated === true && r2.welcome === false, JSON.stringify(r2));
confere("H2. sem linha nova e com contagem de envios", (await conta(db, `select count(*) n from public.campaign_site_leads`)) === 1 && (await um(db, `select submissions from public.campaign_site_leads`)).submissions === 2);
confere("H3. dentro de 12 horas não avisa a equipe de novo", r2.teamNotified === false && (await conta(db, `select count(*) n from public.connection_runtime_commands`)) === 1);
await db.exec(`update public.campaign_site_leads set last_notified_at = now() - interval '13 hours'`);
const r3 = await receber(LEAD);
const cmd3 = await um(db, `select private_payload from public.connection_runtime_commands order by created_at desc limit 1`);
confere(
  "H4. depois de 12 horas avisa, mas não manda a mensagem de novo",
  r3.teamNotified === true && r3.welcome === false && cmd3.private_payload.sendWelcome === false && cmd3.private_payload.skipReason === "repeated",
  JSON.stringify(cmd3.private_payload)
);
confere("H5. não duplica contato nem contexto", (await conta(db, `select count(*) n from public.contacts`)) === 1 && (await conta(db, `select count(*) n from public.conversation_intelligence_contexts`)) === 2);

// ======================================================== sem consentimento
const semConsentimento = { ...LEAD, telefone: "65988887777", consentimento: "true" };
const r4 = await receber(semConsentimento);
const cmd4 = await um(db, `select private_payload from public.connection_runtime_commands order by created_at desc limit 1`);
confere("I. consentimento que não é true de verdade não conta", r4.welcome === false && r4.reason === "no_consent" && cmd4.private_payload.skipReason === "no_consent", JSON.stringify(r4));
confere(
  "I2. sem consentimento não cria contexto",
  (await conta(db, `select count(*) n from public.conversation_intelligence_contexts where conversation_key_hash in ($1, $2)`, [sha("5565988887777"), sha("556588887777")])) === 0
);
await db.exec(`update public.campaign_site_leads set last_notified_at = null where phone = '5565988887777'`);
const r5 = await receber({ ...semConsentimento, consentimento: true });
confere("I3. quem volta com consentimento é chamado agora", r5.repeated === true && r5.welcome === true, JSON.stringify(r5));

// =================================================== contato que já existia
await db.exec(`insert into public.contacts (organization_id, name, phone) values ('${ORG}', 'Cliente Antigo', '556591112222')`);
const r6 = await receber({ ...LEAD, nome: "Outro Nome", telefone: "65991112222", email: "novo@cliente.com" });
const antigo = await um(db, `select * from public.contacts where phone = '556591112222'`);
confere("J. contato existente com a outra forma do celular é reaproveitado", r6.welcome === true && (await conta(db, `select count(*) n from public.contacts where phone like '%91112222'`)) === 1);
confere("J2. nome do contato existente é preservado e e-mail vazio é preenchido", antigo.name === "Cliente Antigo" && antigo.email === "novo@cliente.com", JSON.stringify(antigo));

// ========================================== contexto de outra pessoa / gente
await db.exec(`
  insert into public.conversation_intelligence_contexts (organization_id, assistant_profile_id, audience, channel, conversation_key_hash, state)
  values ('${ORG}', '${OUTRO_AGENTE}', 'customer', 'whatsapp', '${sha("5565977776666")}', 'handed_off'),
         ('${ORG}', '${OUTRO_AGENTE}', 'customer', 'whatsapp', '${sha("556577776666")}', 'active');
`);
const r7 = await receber({ ...LEAD, telefone: "65977776666" });
confere("K. lead aceito mesmo com contextos existentes", r7.welcome === true);
confere(
  "K2. conversa transferida para gente não ganha contexto ativo ao lado",
  (await conta(db, `select count(*) n from public.conversation_intelligence_contexts where conversation_key_hash = $1 and state = 'active'`, [sha("5565977776666")])) === 0
);
const outro = await um(db, `select * from public.conversation_intelligence_contexts where conversation_key_hash = $1`, [sha("556577776666")]);
confere("K3. conversa de outro agente continua dele, sem campanha colada", outro.assistant_profile_id === OUTRO_AGENTE && outro.campaign_id === null);

// ========================================== campanha pausada / agente desligado
await db.exec(`update public.organization_campaigns set status = 'paused'`);
const r8 = await receber({ ...LEAD, telefone: "65966665555" });
confere("L. campanha pausada grava e avisa, sem mensagem", r8.welcome === false && r8.reason === "campaign_paused" && r8.teamNotified === true, JSON.stringify(r8));
await db.exec(`update public.organization_campaigns set status = 'active'; update public.assistant_profiles set active = false where id = '${AGENTE}'`);
const r9 = await receber({ ...LEAD, telefone: "65955554444" });
confere("L2. agente da campanha desligado não chama o lead", r9.welcome === false && r9.reason === "agent_inactive", JSON.stringify(r9));
await db.exec(`update public.assistant_profiles set active = true`);

// ================================================================ recusas
confere("M. telefone inválido", (await erroDe(() => receber({ ...LEAD, telefone: "123" }))).includes("phone number is invalid"));
confere("M2. telefone de outro país não entra", (await erroDe(() => receber({ ...LEAD, telefone: "14155550123" }))).includes("phone number is invalid"));
confere("M2b. telefone vazio tem a mesma recusa", (await erroDe(() => receber({ ...LEAD, telefone: "" }))).includes("phone number is invalid"));
confere("M2c. DDD abaixo de 11 não entra", (await erroDe(() => receber({ ...LEAD, telefone: "(05) 99999-8164" }))).includes("phone number is invalid"));
const comPais = await receber({ ...LEAD, telefone: "+55 65 98888-1234" });
confere(
  "M2d. número já com +55 é aceito e não ganha outro 55",
  comPais.accepted === true && (await conta(db, `select count(*) n from public.campaign_site_leads where phone = '5565988881234'`)) === 1
);
confere("M3. nome obrigatório", (await erroDe(() => receber({ ...LEAD, telefone: "65944443333", nome: "   " }))).includes("lead name is required"));
confere("M4. carga gigante", (await erroDe(() => receber({ ...LEAD, telefone: "65944443333", lixo: "x".repeat(20000) }))).includes("lead payload is invalid"));
const golpe = await receber({ ...LEAD, telefone: "65977001100", nome: "www.golpe.com/pix clique", site: "golpe.com <b>clique aqui</b> http://x" });
const textoGolpe = (await um(db, `select private_payload->>'text' as t from public.connection_runtime_commands where private_payload->>'phone' = '5565977001100'`)).t;
confere(
  "M6. nome e site do visitante não levam link nem frase para a mensagem da Major",
  golpe.welcome === true &&
    textoGolpe.startsWith("Oi, Wwwgolpecompix! ") &&
    // Sobra uma palavra colada e sem esquema, barra, espaço nem tag: não é
    // clicável e não forma frase.
    !/https?:|<|>|\//i.test(textoGolpe) &&
    /diagnóstico do site golpe\.combcliqueaquibhttpx\./.test(textoGolpe),
  textoGolpe
);
const siteQuebrado = await receber({ ...LEAD, telefone: "65977001103", site: "<script>" });
const textoSiteQuebrado = (await um(db, `select private_payload->>'text' as t from public.connection_runtime_commands where private_payload->>'phone' = '5565977001103'`)).t;
confere("M6b. site sem formato de domínio vira 'da sua empresa'", siteQuebrado.welcome === true && textoSiteQuebrado.includes("diagnóstico do site da sua empresa."), textoSiteQuebrado);
const semNome = await receber({ ...LEAD, telefone: "65977001101", nome: "123 !!!" });
const textoSemNome = (await um(db, `select private_payload->>'text' as t from public.connection_runtime_commands where private_payload->>'phone' = '5565977001101'`)).t;
confere("M7. nome sem letras vira 'tudo bem'", semNome.welcome === true && textoSemNome.startsWith("Oi, tudo bem!"), textoSemNome);
const acentos = await receber({ ...LEAD, telefone: "65977001102", nome: "joão d'ávila" });
const textoAcentos = (await um(db, `select private_payload->>'text' as t from public.connection_runtime_commands where private_payload->>'phone' = '5565977001102'`)).t;
confere("M8. acento e apóstrofo no nome continuam", acentos.welcome === true && textoAcentos.startsWith("Oi, João!"), textoAcentos);
const e5 = await receber({ ...LEAD, telefone: "65944443333", email: "isso nao e email" });
confere("M5. e-mail inválido vira vazio em vez de recusar o lead", e5.accepted === true && (await um(db, `select email from public.campaign_site_leads where phone = '5565944443333'`)).email === null);

await db.exec(`update public.campaign_site_intakes set hourly_limit = (select count(*) from public.campaign_site_leads)`);
confere("N. teto por hora recusa lead novo", (await erroDe(() => receber({ ...LEAD, telefone: "65933332222" }))).includes("too many leads"));
confere("N2. lead repetido passa mesmo no teto", (await receber(LEAD)).accepted === true);
await db.exec(`update public.campaign_site_intakes set hourly_limit = 30`);

await db.exec(`update public.campaign_site_intakes set enabled = false`);
confere("O. ligação desligada recusa", (await erroDe(() => receber({ ...LEAD, telefone: "65922221111" }))).includes("intake token is invalid"));
await db.exec(`update public.campaign_site_intakes set enabled = true`);

// ============================================================== permissões
await db.exec("set role anon");
confere("P. anon não lê a tabela de ligação", (await erroDe(() => db.query(`select * from public.campaign_site_intakes`))).includes("permission denied"));
confere("P2. anon não lê os leads", (await erroDe(() => db.query(`select * from public.campaign_site_leads`))).includes("permission denied"));
confere("P3. anon não escreve na fila", (await erroDe(() => db.query(`insert into public.campaign_site_leads (organization_id, campaign_id, phone, name) values ('${ORG}', gen_random_uuid(), '5565900000000', 'x')`))).includes("permission denied"));
await db.exec("reset role");
await db.exec("set role authenticated");
confere("P4. authenticated não executa a função (só o servidor do site, como anon)", (await erroDe(() => db.query(`select public.nucleo_site_lead_receive('${TOKEN}', '{}'::jsonb)`))).includes("permission denied"));
await db.exec("reset role");

const tokenAntigo = TOKEN;
const novo = (await um(db, ligacao.split("-- Trocar só a mensagem")[0])).token_para_a_vercel;
confere("Q. rodar a ligação de novo troca o token e invalida o antigo", novo !== tokenAntigo && (await erroDe(() => receber({ ...LEAD, telefone: "65911110000" }, tokenAntigo))).includes("intake token is invalid"));
confere("Q2. o token novo funciona", (await receber({ ...LEAD, telefone: "65911110000" }, novo)).accepted === true);

// ============================================================ sem conexão
const semConexao = await mundo({ comConexao: false });
await semConexao.exec(migration);
const tokenSemConexao = (await um(semConexao, ligacao.split("-- Trocar só a mensagem")[0])).token_para_a_vercel;
const erroSemConexao = await erroDe(() => semConexao.query(`select public.nucleo_site_lead_receive($1, $2::jsonb)`, [tokenSemConexao, JSON.stringify(LEAD)]));
confere(
  "R. sem conexão recusa antes de gravar qualquer coisa",
  erroSemConexao.includes("connection is not available") && (await conta(semConexao, `select count(*) n from public.campaign_site_leads`)) === 0,
  erroSemConexao
);

// ================================= guarda: lista de comandos mudou por fora
const outraLista = await mundo();
await outraLista.exec(`
  alter table public.connection_runtime_commands drop constraint connection_runtime_commands_command_type_check;
  alter table public.connection_runtime_commands add constraint connection_runtime_commands_command_type_check
  check (command_type in ('operator_verification_send', 'handoff_return_to_ai', 'handoff_close',
    'conversation_send', 'conversation_owner', 'conversation_check', 'connection_pair_start',
    'connection_pair_qr', 'um_tipo_novo', 'outro_tipo_novo'));
`);
const erroGuarda = await erroDe(() => outraLista.exec(migration));
confere("S. a migration aborta se a lista de comandos mudou por fora", erroGuarda.includes("a lista de comandos mudou"), erroGuarda);

console.log(`PASS ${passou.length}`);
for (const item of passou) console.log(`  ok   ${item}`);
if (falhas.length) {
  console.log(`FAIL ${falhas.length}`);
  for (const item of falhas) console.log(`  FAIL ${item}`);
  process.exit(1);
}
