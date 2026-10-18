// Prova da migration 20261018140000 (a conexão diz se roda fluxo, e a visão
// de observação das execuções; Etapa 11, pacotes 11.1 e 11.4) num Postgres
// embutido (PGlite). Banco em memória, nada de produção.
//
// Harness + TODAS as migrations reais até a anterior, um retrato do "antes",
// a migration, as perguntas, a reaplicação, o rollback e a reaplicação:
//
//   1. o runtime novo informa online/not_configured e o banco guarda;
//   2. o runtime antigo (sem a chave) continua aceito, com o estado nulo;
//   3. valor estranho é recusado, e o resto do heartbeat segue igual ao antes;
//   4. a visão conta as execuções por empresa, status e motivo, e ninguém de
//      fora do banco a lê;
//   5. depois do rollback o runtime novo continua aceito (a chave é ignorada).
//
//   mkdir prova && cd prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-a-conexao-diz-se-roda-fluxo.mjs . && node prova-a-conexao-diz-se-roda-fluxo.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-a-conexao-diz-se-roda-fluxo.mjs <repo>");
const MIGRATION = "20261018140000_a_conexao_diz_se_roda_fluxo.sql";
const ROLLBACK = "scripts/sql/rollback-20261018140000-a-conexao-diz-se-roda-fluxo.sql";
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
const ROBO = "dddddddd-0000-4000-8000-000000000003";
const CONEXAO = "eeeeeeee-0000-4000-8000-000000000004";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO}', 'dono@exemplo.invalido', now()),
    ('${ROBO}', 'robot+x@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access('dono@exemplo.invalido', 'base', 7)")).rows[0].access_code;
const org = (await como(usuario(DONO), "select public.create_organization('Clínica', $1) as id", [codigo])).rows[0].id;
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [CONEXAO, org]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, org, ROBO]);
const robo = { sub: ROBO, role: "authenticated", app_metadata: { is_robot: "true", organization_id: org, connection_id: CONEXAO } };

const INSTANCIA = randomUUID();
const batida = (extra = {}) => ({
  instanceId: INSTANCIA, runtimeKind: "vps", hostLabel: "VPS", bridge: "online", whatsapp: "connected",
  assistant: "online", chatbot: "online", automationEnabled: true, defaultOwner: "bot", ...extra,
});
const bater = (payload) => como(robo, "select public.nucleo_runtime_heartbeat($1::jsonb) r", [JSON.stringify(payload)]);
const linha = () => um("select * from public.connection_runtime_status where connection_id=$1", [CONEXAO]);
const semDatas = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !/_at$|flow_runtime_status/.test(k)));

// O retrato do "antes": o heartbeat de hoje, com a chave nova (que ele ignora).
await bater(batida({ flowRuntime: "online" }));
const antes = semDatas(await linha());

// ------------------------------------------------------------ a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));

await bater(batida({ flowRuntime: "online" }));
confere("1. online é guardado", (await linha()).flow_runtime_status === "online");
confere("1. o resto do heartbeat é igual ao de antes", JSON.stringify(semDatas(await linha())) === JSON.stringify(antes));
await bater(batida({ flowRuntime: "not_configured" }));
confere("1. not_configured é guardado", (await linha()).flow_runtime_status === "not_configured");

const antigo = await erroDe(() => bater(batida()));
confere("2. runtime antigo (sem a chave) continua aceito", antigo === "", antigo);
confere("2. e o estado fica nulo (não informa)", (await linha()).flow_runtime_status === null);

const estranho = await erroDe(() => bater(batida({ flowRuntime: "talvez" })));
confere("3. valor fora da lista é recusado", /runtime heartbeat state is invalid/.test(estranho), estranho);
const anonimo = await erroDe(() => como(null, "select public.nucleo_runtime_heartbeat('{}'::jsonb)"));
confere("3. anon não chama o heartbeat", /permission denied/.test(anonimo), anonimo);

// Execuções para a visão: dois fluxos começados pelo robô.
const fluxo = randomUUID();
await db.query(
  "insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,'Oi',$3,$3,$4::jsonb)",
  [fluxo, org, DONO, JSON.stringify({
    condicoes: [{ tipo: "primeira_conversa" }],
    passos: [{ id: "oi", tipo: "enviar_mensagem", texto: "Oi" }, { id: "fim", tipo: "encerrar" }],
    canvas: { versao: 3, nos: [], conexoes: [
      { source: "entrada", saida: "padrao", target: "condicoes" },
      { source: "condicoes", saida: "padrao", target: "oi" },
      { source: "oi", saida: "padrao", target: "fim" },
    ] },
  })],
);
for (const [telefone, mensagem] of [["5565900000001", "m-1"], ["5565900000002", "m-2"]]) {
  await como(robo, "select public.nucleo_flow_start($1,$2,$3,1,$4,0)", [telefone, mensagem, fluxo, randomUUID()]);
}
await db.query("update public.chatbot_flow_executions set status='cancelled', reason='human_takeover' where requester_phone='5565900000002'");
const visao = (await db.query("select status, reason, executions::int n from private.flow_execution_overview where organization_id=$1 order by status", [org])).rows;
confere("4. a visão conta por status e motivo",
  JSON.stringify(visao) === JSON.stringify([{ status: "cancelled", reason: "human_takeover", n: 1 }, { status: "ready", reason: "", n: 1 }]),
  JSON.stringify(visao));
const lerVisao = await erroDe(() => como(usuario(DONO), "select * from private.flow_execution_overview"));
confere("4. o dono da empresa não lê a visão pelo portal", /permission denied/.test(lerVisao), lerVisao);
const sem = (await db.query("select * from private.flow_execution_overview limit 1")).rows[0];
confere("4. a visão não traz telefone nem conteúdo", !Object.keys(sem).some((k) => /phone|snapshot|variables|text/.test(k)), Object.keys(sem).join(","));

// ------------------------------------------------- colar de novo não estraga
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("idempotente: colar de novo passa", reaplicar === "", reaplicar);

// ---------------------------------------------------- rollback e reaplicação
await db.exec(ler(ROLLBACK));
confere("rollback: a coluna sai", !("flow_runtime_status" in (await linha())));
const depois = await erroDe(() => bater(batida({ flowRuntime: "online" })));
confere("5. depois do rollback, o runtime novo continua aceito", depois === "", depois);
confere("rollback: a visão sai", (await um("select to_regclass('private.flow_execution_overview') v")).v === null);
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
await bater(batida({ flowRuntime: "online" }));
confere("reaplicação: volta a guardar", (await linha()).flow_runtime_status === "online");

console.log(passou.map((p) => `PASS ${p}`).join("\n"));
if (falhas.length) {
  console.log(falhas.map((f) => `FALHA ${f}`).join("\n"));
  console.log(`\n${passou.length} conferências, ${falhas.length} falhas`);
  process.exit(1);
}
console.log(`\n${passou.length} conferências, 0 falhas`);
