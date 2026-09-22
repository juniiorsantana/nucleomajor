// Prova comportamental da migration 20260921110000 (empresa nova nasce com as
// habilidades que a Major tem) num Postgres embutido (PGlite). Banco em memória.
//
// Mesmo método das outras provas do checkout: harness + TODAS as migrations
// reais. `recepcao` e `solicitacao-agenda` não nascem por migration (quem as
// publica é scripts/intelligence-skills.mjs), então a prova as publica aqui,
// copiando a linha de `vendas` — só para existirem como em produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-habilidades-de-empresa-nova.mjs . && node prova-habilidades-de-empresa-nova.mjs <repo>
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-habilidades-de-empresa-nova.mjs <repo>");
const MIGRATION = "20260921110000_empresa_nova_nasce_com_as_habilidades.sql";
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");

const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") => (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);

const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
await db.exec(ler("scripts/sql/harness-supabase-minimo.sql"));
await db.exec("alter table auth.users add column if not exists email_confirmed_at timestamptz;");
const migrations = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
if (!migrations.includes(MIGRATION)) throw new Error(`migration não achada: ${MIGRATION}`);
for (const f of migrations) {
  if (f >= MIGRATION) break;
  await db.exec(ler(`supabase/migrations/${f}`));
}

async function como(sub, sql, params = [], role = null) {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [sub || "", JSON.stringify(sub ? { sub, role: "authenticated" } : { role: "anon" })],
    );
    if (role) await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}
async function erroDe(fn) {
  try { await fn(); return ""; } catch (e) { return String(e.message || e); }
}

// As duas habilidades que só o publicador cria, publicadas como em produção.
for (const [slug, id] of [["recepcao", "20000000-0000-4000-8000-0000000000a1"], ["solicitacao-agenda", "20000000-0000-4000-8000-0000000000a2"]]) {
  await db.query(
    `insert into public.skill_definitions (id, owner_type, slug, name, description, audience, status, current_version, spec)
     select $1, 'platform', $2, initcap(replace($2, '-', ' ')), description, 'customer', 'published', 1, spec
     from public.skill_definitions where owner_type = 'platform' and slug = 'vendas'
     on conflict do nothing`,
    [id, slug],
  );
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO_ANTIGO = "aaaaaaaa-0000-4000-8000-000000000002";
const DONO_NOVO = "bbbbbbbb-0000-4000-8000-000000000003";
const DONO_SEM_RECEPCAO = "bbbbbbbb-0000-4000-8000-000000000004";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO_ANTIGO}', 'antigo@exemplo.invalido', now()),
    ('${DONO_NOVO}', 'novo@exemplo.invalido', now()),
    ('${DONO_SEM_RECEPCAO}', 'semrecepcao@exemplo.invalido', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);

const criarEmpresa = async (dono, email, nome) => {
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, 'completo', 7)", [email])).rows[0].access_code;
  return (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
};

const vinculos = async (org, audiencia) => (await db.query(
  `select skill.slug, binding.priority, binding.enabled
   from public.assistant_profiles profile
   join public.assistant_profile_skills binding on binding.profile_id = profile.id
   join public.skill_definitions skill on skill.id = binding.skill_id
   where profile.organization_id = $1 and profile.audience = $2 and profile.is_default
   order by binding.priority, skill.slug`,
  [org, audiencia],
)).rows.map((l) => `${l.slug}:${l.priority}${l.enabled ? "" : "(off)"}`).join(",");

// ------------------------------------------------ antes: a empresa que já existe
const orgAntiga = await criarEmpresa(DONO_ANTIGO, "antigo@exemplo.invalido", "Empresa Antiga");
const antigaInterno = await vinculos(orgAntiga, "internal");
const antigaClientes = await vinculos(orgAntiga, "customer");
confere("antes: empresa nova nascia sem recepção", !antigaClientes.includes("recepcao"), antigaClientes);
confere("antes: e sem tarefas no interno", !antigaInterno.includes("tarefas"), antigaInterno);

// ---------------------------------------------------------------- a migration
const migration = ler(`supabase/migrations/${MIGRATION}`);
await db.exec(migration);
confere("migration aplica", true);
const reaplicar = await erroDe(() => db.exec(migration));
await db.exec("rollback");
confere("reaplicar é recusado pela guarda", /ja foi aplicada/.test(reaplicar), reaplicar);

confere("a empresa antiga não é tocada (interno)", (await vinculos(orgAntiga, "internal")) === antigaInterno);
confere("a empresa antiga não é tocada (clientes)", (await vinculos(orgAntiga, "customer")) === antigaClientes);

// ---------------------------------------------------------------- empresa nova
const orgNova = await criarEmpresa(DONO_NOVO, "novo@exemplo.invalido", "Empresa Nova");
const interno = await vinculos(orgNova, "internal");
const clientes = await vinculos(orgNova, "customer");
confere("interno nasce com agenda e tarefas", interno === "agenda:10,tarefas:20", interno);
confere(
  "clientes nasce com recepção, qualificação, vendas, suporte e solicitação de agenda, sem agenda",
  clientes === "recepcao:10,pre-qualificacao:20,vendas:30,suporte:40,solicitacao-agenda:50",
  clientes,
);

// Habilidade não publicada é pulada, e o resto entra.
await db.query("update public.skill_definitions set status = 'draft' where owner_type = 'platform' and slug = 'recepcao'");
const orgSemRecepcao = await criarEmpresa(DONO_SEM_RECEPCAO, "semrecepcao@exemplo.invalido", "Empresa Sem Recepção");
const semRecepcao = await vinculos(orgSemRecepcao, "customer");
confere("recepção não publicada é pulada, o resto entra",
  semRecepcao === "pre-qualificacao:20,vendas:30,suporte:40,solicitacao-agenda:50", semRecepcao);

// ---------------------------------------------------------- privilégios
confere("usuário logado não chama a função",
  /permission denied/.test(await erroDe(() => como(DONO_NOVO, "select private.provision_intelligence_vinculos($1, $2)", [orgNova, DONO_NOVO], "authenticated"))));

console.log(`\nPASS ${passou.length}`);
for (const p of passou) console.log("  ok  ", p);
if (falhas.length) {
  console.log(`\nFAIL ${falhas.length}`);
  for (const f of falhas) console.log("  FAIL", f);
  process.exit(1);
}
