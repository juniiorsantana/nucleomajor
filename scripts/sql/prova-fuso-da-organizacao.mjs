// Prova da migration 20261018130000 (o fuso da organização, Etapa 4 na
// variante segura) num Postgres embutido (PGlite). Banco em memória, nada de
// produção.
//
// Harness + TODAS as migrations reais até a anterior, a migration, as
// perguntas, a reaplicação (idempotente), o rollback e a reaplicação:
//
//   1. toda empresa que já existe fica em America/Sao_Paulo, e a nova também;
//   2. o dono e o administrador mudam o fuso; o atendente não (zero linhas);
//   3. o banco recusa fuso fora da lista do Brasil;
//   4. nenhum fluxo gravado muda: a regra guarda o próprio fuso.
//
//   mkdir prova && cd prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-fuso-da-organizacao.mjs . && node prova-fuso-da-organizacao.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-fuso-da-organizacao.mjs <repo>");
const MIGRATION = "20261018130000_fuso_da_organizacao.sql";
const ROLLBACK = "scripts/sql/rollback-20261018130000-fuso-da-organizacao.sql";
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

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO = "aaaaaaaa-0000-4000-8000-000000000002";
const GERENTE = "aaaaaaaa-0000-4000-8000-000000000003";
const ATENDENTE = "aaaaaaaa-0000-4000-8000-000000000004";
const DONO_NOVA = "aaaaaaaa-0000-4000-8000-000000000005";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO}', 'dono@exemplo.invalido', now()),
    ('${GERENTE}', 'gerente@exemplo.invalido', now()),
    ('${ATENDENTE}', 'atendente@exemplo.invalido', now()),
    ('${DONO_NOVA}', 'nova@exemplo.invalido', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const empresa = async (dono, email, nome) => {
  const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, 'base', 7)", [email])).rows[0].access_code;
  return (await como(usuario(dono), "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
};
const org = await empresa(DONO, "dono@exemplo.invalido", "Clínica Antiga");
await db.query(
  "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')",
  [org, GERENTE, ATENDENTE],
);
// Um fluxo gravado antes, com o horário de Recife.
const REGRA = { tipo: "janela_de_horario", inicio: "08:00", fim: "18:00", fuso: "America/Recife" };
const fluxo = (await db.query(
  `insert into public.chatbot_definitions (organization_id, name, active, definition, created_by, updated_by)
   values ($1, 'Horário', false, $2::jsonb, $3, $3) returning id, definition::text as def`,
  [org, JSON.stringify({ condicoes: [REGRA], passos: [{ id: "oi", tipo: "enviar_mensagem", texto: "Oi" }] }), DONO],
)).rows[0];

confere("pré: a coluna ainda não existe",
  !(await um("select exists(select 1 from information_schema.columns where table_name='organizations' and column_name='timezone') v")).v);

// ------------------------------------------------------------ a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
const fusoDe = async (id) => (await um("select timezone from public.organizations where id=$1", [id])).timezone;

confere("1. a empresa que já existia fica em São Paulo", (await fusoDe(org)) === "America/Sao_Paulo");
const orgNova = await empresa(DONO_NOVA, "nova@exemplo.invalido", "Empresa Nova");
confere("1. a empresa nova nasce em São Paulo", (await fusoDe(orgNova)) === "America/Sao_Paulo");

const atualizar = (quem, fuso, id = org) =>
  como(usuario(quem), "update public.organizations set timezone=$2 where id=$1 returning timezone", [id, fuso]);
confere("2. o dono muda para Manaus", (await atualizar(DONO, "America/Manaus")).rows[0]?.timezone === "America/Manaus");
confere("2. o administrador muda para Cuiabá", (await atualizar(GERENTE, "America/Cuiaba")).rows[0]?.timezone === "America/Cuiaba");
confere("2. o atendente não muda (zero linhas)", (await atualizar(ATENDENTE, "America/Belem")).rows.length === 0);
confere("2. e o fuso continua o do administrador", (await fusoDe(org)) === "America/Cuiaba");
confere("2. o dono de outra empresa não muda esta", (await atualizar(DONO_NOVA, "America/Belem")).rows.length === 0);

const fora = await erroDe(() => atualizar(DONO, "Europe/Lisbon"));
confere("3. fuso fora da lista é recusado pelo check", /organizations_timezone_do_brasil/.test(fora), fora);
const nulo = await erroDe(() => atualizar(DONO, null));
confere("3. fuso nulo é recusado", /null/.test(nulo), nulo);

const depois = (await um("select definition::text as def from public.chatbot_definitions where id=$1", [fluxo.id])).def;
confere("4. o fluxo gravado não mudou", depois === fluxo.def);
confere("4. a regra continua com o fuso de Recife", JSON.parse(depois).condicoes[0].fuso === "America/Recife");

// ------------------------------------------------- colar de novo não estraga
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("idempotente: colar de novo passa", reaplicar === "", reaplicar);
confere("idempotente: e não volta o fuso ao padrão", (await fusoDe(org)) === "America/Cuiaba");

// ---------------------------------------------------- rollback e reaplicação
await db.exec(ler(ROLLBACK));
confere("rollback: a coluna sai",
  !(await um("select exists(select 1 from information_schema.columns where table_name='organizations' and column_name='timezone') v")).v);
confere("rollback: o fluxo continua igual",
  (await um("select definition::text as def from public.chatbot_definitions where id=$1", [fluxo.id])).def === fluxo.def);
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
confere("reaplicação: volta com o padrão", (await fusoDe(org)) === "America/Sao_Paulo");

console.log(passou.map((p) => `PASS ${p}`).join("\n"));
if (falhas.length) {
  console.log(falhas.map((f) => `FALHA ${f}`).join("\n"));
  console.log(`\n${passou.length} conferências, ${falhas.length} falhas`);
  process.exit(1);
}
console.log(`\n${passou.length} conferências, 0 falhas`);
