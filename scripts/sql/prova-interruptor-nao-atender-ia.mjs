// Prova comportamental da migration 20260913150000 num Postgres embutido (PGlite).
// Nada aqui toca produção: banco em memória, criado e destruído neste processo.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql/prova-interruptor-nao-atender-ia.mjs . && node prova-interruptor-nao-atender-ia.mjs <repo>
//
// Resultado de referência (13/09/2026): PASS 30, nenhum FAIL. O item K compara,
// número a número, a consulta nova com o bloco REAL do gate de 20260911150000.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const REPO = process.argv[2];
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const migration = ler("supabase/migrations/20260913150000_interruptor_nao_atender_ia_grava_no_banco.sql");
const fasesH = ler("supabase/migrations/20260826150000_fase_h_piloto_externo.sql");
const gateSql = ler("supabase/migrations/20260911150000_contato_marcado_nao_atender_ia.sql");

const trecho = (texto, inicio, fim) => {
  const i = texto.indexOf(inicio);
  if (i < 0) throw new Error(`trecho não achado: ${inicio}`);
  const j = texto.indexOf(fim, i);
  return texto.slice(i, j + fim.length);
};

const phoneMatches = trecho(fasesH, "create or replace function private.customer_phone_matches", "$$;");
// O bloco real do gate que decide a etiqueta, copiado do arquivo aplicado em produção.
const blocoGate = trecho(gateSql, "select exists (\n    select 1\n    from public.contacts contact", ") into opted_out;");

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const MEMBRO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ESTRANHO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const db = new PGlite();
const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") => (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create schema private;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create table public.organizations (id uuid primary key);
  create table public.profiles (id uuid primary key);
  create table public.organization_members (
    organization_id uuid not null, user_id uuid not null, status text not null default 'active'
  );
  create table public.contacts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id),
    legacy_id text, name text not null default '', phone text not null default '',
    whatsapp_id text, source text not null default '',
    version bigint not null default 1,
    created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, organization_id), unique (organization_id, legacy_id)
  );
  create unique index contacts_phone_unique on public.contacts (organization_id, phone)
    where phone <> '' and deleted_at is null;
  create table public.tags (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id),
    legacy_id text, name text not null check (length(trim(name)) between 1 and 80),
    color text not null default '#626B7A',
    created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, organization_id), unique (organization_id, legacy_id)
  );
  create table public.contact_tags (
    organization_id uuid not null, contact_id uuid not null, tag_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (contact_id, tag_id),
    foreign key (contact_id, organization_id) references public.contacts(id, organization_id) on delete cascade,
    foreign key (tag_id, organization_id) references public.tags(id, organization_id) on delete cascade
  );
  create table public.whatsapp_conversations (
    connection_id uuid not null, organization_id uuid not null,
    contact_phone text not null, contact_name text not null default '', last_message_at timestamptz
  );

  create or replace function private.is_org_member(target_organization uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.organization_members m
      where m.organization_id = target_organization and m.user_id = auth.uid() and m.status = 'active');
  $$;
  ${phoneMatches}

  -- O gate de verdade só importa aqui pelo bloco da etiqueta. O corpo precisa
  -- conter 'contact_opted_out' para a guarda da migration aceitar.
  create or replace function public.nucleo_customer_assistant_access(requester_phone text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $f$
  declare
    robot_org uuid := nullif(current_setting('prova.robot_org', true), '')::uuid;
    opted_out boolean;
  begin
    ${blocoGate}
    if opted_out then
      return jsonb_build_object('allowed', false, 'reason', 'contact_opted_out');
    end if;
    return jsonb_build_object('allowed', true, 'reason', 'active');
  end;
  $f$;

  insert into public.organizations values ('${ORG}'), ('${OUTRA_ORG}');
  insert into public.profiles values ('${MEMBRO}'), ('${ESTRANHO}');
  insert into public.organization_members (organization_id, user_id) values ('${ORG}', '${MEMBRO}');
  insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, contact_name, last_message_at)
  values (gen_random_uuid(), '${ORG}', '5565999990001', 'Amigo do Dono', now());
`);
await db.exec(`select set_config('prova.robot_org', '${ORG}', false)`);

const como = async (usuario) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario || ""]);
const set = async (chat, optOut, nome = "") =>
  (await db.query(`select public.nucleo_contact_ai_opt_out_set($1, $2, $3, $4) as r`, [ORG, chat, optOut, nome])).rows[0].r;
const status = async (chat) =>
  (await db.query(`select public.nucleo_contact_ai_opt_out_status($1, $2) as r`, [ORG, chat])).rows[0].r;
const gate = async (telefone) =>
  (await db.query(`select public.nucleo_customer_assistant_access($1) as r`, [telefone])).rows[0].r;
const conta = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
const erroDe = async (fn) => {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e.message || e);
  }
};

// 1. A migration aplica inteira (guardas, funções, grants e conferência final).
const erroMigration = await erroDe(() => db.exec(migration));
confere("A. migration aplica sem erro", !erroMigration, erroMigration);

await como(MEMBRO);

// B. Número sem contato: cria contato com o nome da conversa, cria a etiqueta, e o gate passa a recusar.
let r = await set("5565999990001", true);
confere("B1. devolve optedOut=true", r.optedOut === true, JSON.stringify(r));
confere("B2. criou um contato", (await conta(`select count(*) n from public.contacts where phone='5565999990001'`)) === 1);
const nomeCriado = (await db.query(`select name from public.contacts where phone='5565999990001'`)).rows[0]?.name;
confere("B3. contato nasce com o nome da conversa", nomeCriado === "Amigo do Dono", nomeCriado);
confere("B4. criou a etiqueta com slug", (await conta(`select count(*) n from public.tags where legacy_id='nao-atender-ia'`)) === 1);
confere("B5. o GATE recusa o telefone canônico", (await gate("5565999990001")).reason === "contact_opted_out");
confere("B6. status diz o mesmo que o gate", (await status("5565999990001")).optedOut === true);

// C. Idempotente: repetir não duplica.
await set("5565999990001", true);
confere("C. repetir não duplica marca", (await conta(`select count(*) n from public.contact_tags`)) === 1);

// D. Contato antigo sem o nono dígito, e outro com: os dois são marcados, e o gate pega pelo canônico.
await db.exec(`insert into public.contacts (organization_id, name, phone) values
  ('${ORG}', 'Parceiro velho', '556588887777'), ('${ORG}', 'Parceiro novo', '5565988887777')`);
r = await set("5565988887777", true);
confere("D1. marcou os dois cadastros do número", r.contactIds?.length === 2, JSON.stringify(r));
confere("D2. gate recusa", (await gate("5565988887777")).reason === "contact_opted_out");
r = await set("5565988887777", false);
confere("D3. desligar tira dos dois", r.optedOut === false && (await conta(
  `select count(*) n from public.contact_tags ct join public.contacts c on c.id=ct.contact_id where c.phone in ('556588887777','5565988887777')`
)) === 0);
confere("D4. gate volta a permitir", (await gate("5565988887777")).allowed === true);
confere("D5. etiqueta continua existindo", (await conta(`select count(*) n from public.tags where legacy_id='nao-atender-ia' and deleted_at is null`)) === 1);

// E. Etiqueta criada pela tela (sem slug, só o nome) é reaproveitada — o gate já a reconhecia.
await db.exec(`update public.tags set legacy_id = null where legacy_id = 'nao-atender-ia'`);
await set("5565977776666", true, "Fornecedor");
confere("E. reaproveita etiqueta só com o nome", (await conta(`select count(*) n from public.tags`)) === 1);

// F. Etiqueta apagada com slug volta à vida em vez de bater na unicidade.
await db.exec(`delete from public.contact_tags; delete from public.tags;`);
await db.exec(`insert into public.tags (organization_id, legacy_id, name, deleted_at) values ('${ORG}', 'nao-atender-ia', 'Não atender IA', now())`);
const erroF = await erroDe(() => set("5565966665555", true));
confere("F1. etiqueta apagada não quebra", !erroF, erroF);
confere("F2. volta à vida, sem duplicar", (await conta(`select count(*) n from public.tags where deleted_at is null`)) === 1);
confere("F3. gate recusa", (await gate("5565966665555")).reason === "contact_opted_out");

// G. Nome que é só o número vira nome vazio.
await set("5565955554444", true, "5565955554444");
const nomeNumero = (await db.query(`select name from public.contacts where phone='5565955554444'`)).rows[0]?.name;
confere("G. número no lugar do nome vira vazio", nomeNumero === "", JSON.stringify(nomeNumero));

// H. Quem não é membro não liga nem consulta; telefone inválido é recusado.
await como(ESTRANHO);
confere("H1. estranho não liga", (await erroDe(() => set("5565999990001", false))).includes("organization membership required"));
confere("H2. estranho não consulta", (await erroDe(() => status("5565999990001"))).includes("organization membership required"));
await como(MEMBRO);
confere("H3. telefone inválido", (await erroDe(() => set("123", true))).includes("phone number is invalid"));
await como("");
confere("H4. sem sessão não liga", (await erroDe(() => set("5565999990001", false))).includes("organization membership required"));
await como(MEMBRO);

// I. Outra organização não enxerga nem marca contatos daqui.
await db.exec(`insert into public.organization_members (organization_id, user_id) values ('${OUTRA_ORG}', '${ESTRANHO}')`);
await como(ESTRANHO);
const deFora = (await db.query(`select public.nucleo_contact_ai_opt_out_status($1, $2) as r`, [OUTRA_ORG, "5565999990001"])).rows[0].r;
confere("I. outra organização não vê a marca daqui", deFora.optedOut === false && deFora.contactFound === false, JSON.stringify(deFora));
await como(MEMBRO);

// J. Privilégios.
const priv = (await db.query(`select
  has_function_privilege('anon', 'public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text)', 'execute') as anon_set,
  has_function_privilege('authenticated', 'public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text)', 'execute') as auth_set,
  has_function_privilege('anon', 'public.nucleo_contact_ai_opt_out_status(uuid, text)', 'execute') as anon_status`)).rows[0];
confere("J. só authenticated executa", !priv.anon_set && priv.auth_set && !priv.anon_status, JSON.stringify(priv));

// K. O status e o gate concordam em todos os números usados.
for (const numero of ["5565999990001", "5565988887777", "5565977776666", "5565966665555", "5565955554444", "5565900000000"]) {
  const s = (await status(numero)).optedOut;
  const g = (await gate(numero)).reason === "contact_opted_out";
  confere(`K. status == gate para ${numero.slice(-4)}`, s === g, `status=${s} gate=${g}`);
}

await db.close();
console.log(`PASS ${passou.length}`);
for (const p of passou) console.log(`  ok  ${p}`);
if (falhas.length) {
  console.log(`FAIL ${falhas.length}`);
  for (const f of falhas) console.log(`  !!  ${f}`);
  process.exit(1);
}
