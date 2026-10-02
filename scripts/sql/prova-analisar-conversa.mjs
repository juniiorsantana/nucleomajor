// Prova comportamental da migration 20261002100000 (analisar conversa) num
// Postgres embutido (PGlite), com o harness e TODAS as migrations reais do
// repositório, em ordem. Nada aqui toca produção.
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   cp <repo>/scripts/sql/prova-analisar-conversa.mjs . && node prova-analisar-conversa.mjs <repo>
//
// O que ela responde:
//   * os créditos por plano (30/100/200) e o ciclo que renova no dia da
//     assinatura, inclusive o dia 31 em mês curto;
//   * só dono e admin pedem; grupo não; dois cliques não gastam dois; sem
//     saldo, recusa; falha e pedido parado devolvem o crédito;
//   * a VPS recebe a conversa, a leitura do Jev, o playbook, o funil e as
//     etiquetas, e grava o resultado; só ela grava;
//   * rascunho só dono e admin veem; salvo, a equipe vê; outra empresa nunca.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-analisar-conversa.mjs <repo>");
const MIGRATION = "20261002100000_analisar_conversa.sql";
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

async function como(sub, sql, params = [], { role = "authenticated", robo = null } = {}) {
  return db.transaction(async (tx) => {
    const claims = sub
      ? { sub, role: "authenticated", ...(robo ? { app_metadata: { is_robot: "true", organization_id: robo.org, connection_id: robo.conexao } } : {}) }
      : { role: "anon" };
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [sub || "", JSON.stringify(claims)]);
    if (role) await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
let seq = 0;
async function empresa(nome, plano = "full") {
  seq += 1;
  const dono = `bbbbbbbb-0000-4000-8000-00000000000${seq}`;
  const email = `dono${seq}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [dono, email]);
  const codigo = (await como(ADMIN, `select * from public.issue_onboarding_access($1, '${plano}', 7)`, [email])).rows[0].access_code;
  const id = (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
  return { id, dono };
}

// ---------------------------------------------------------------- a migration (antes do mundo, que usa a tabela)
const MAJOR = await empresa("Major");
const OUTRA = await empresa("Outra");
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada, com a conferência interna");

// 1. Créditos por plano.
const planos = Object.fromEntries((await db.query("select code, (limits->>'analysis_credits')::int as c from public.saas_plans")).rows.map((r) => [r.code, r.c]));
confere("créditos por plano 30/100/200 (full = 200)", planos.base === 30 && planos.atendimento === 100 && planos.completo === 200 && planos.full === 200, JSON.stringify(planos));

// 2. O ciclo.
const ciclo = async (assinatura, agora) => {
  await db.query("update public.organization_subscriptions set started_at = $1 where organization_id = $2", [assinatura, MAJOR.id]);
  const r = (await db.query(
    "select to_char(private.ciclo_de_analise($1, $2) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as c, to_char(private.renovacao_de_analise($1, $2) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as r",
    [MAJOR.id, agora])).rows[0];
  return `${r.c}→${r.r}`;
};
confere("assinou dia 14: depois do dia 14, ciclo começa no mês", (await ciclo("2026-03-14T15:00:00Z", "2026-10-20T15:00:00Z")) === "2026-10-14→2026-11-14");
confere("assinou dia 14: antes do dia 14, ciclo é do mês anterior", (await ciclo("2026-03-14T15:00:00Z", "2026-10-05T15:00:00Z")) === "2026-09-14→2026-10-14");
confere("assinou dia 31: em fevereiro vira o último dia", (await ciclo("2026-01-31T15:00:00Z", "2027-03-10T15:00:00Z")) === "2027-02-28→2027-03-31",
  await ciclo("2026-01-31T15:00:00Z", "2027-03-10T15:00:00Z"));
await db.query("update public.organization_subscriptions set started_at = now() - interval '40 days' where organization_id = $1", [MAJOR.id]);

// O mundo: conexão, robô, conversas, membro, contato, leitura, playbook.
const CONEXAO = "cccccccc-0000-4000-8000-000000000001";
const ROBO = "dddddddd-0000-4000-8000-000000000001";
const MEMBRO = "eeeeeeee-0000-4000-8000-000000000001";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'major')", [CONEXAO, MAJOR.id]);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'robo@exemplo.invalido', now()), ($2, 'membro@exemplo.invalido', now())", [ROBO, MEMBRO]);
await db.query("insert into public.profiles (id, full_name) values ($1, 'Membro') on conflict (id) do nothing", [MEMBRO]);
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [MAJOR.id, MEMBRO]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, MAJOR.id, ROBO]);
const robo = { org: MAJOR.id, conexao: CONEXAO };
const T = "5565988887777";
const GRUPO = "120363000000000001";
const VAZIA = "5565911110000";
await db.query(`insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at)
  values ($1, $2, $3, 'direto', now()), ($1, $2, $4, 'grupo', now()), ($1, $2, $5, 'direto', now())`, [CONEXAO, MAJOR.id, T, GRUPO, VAZIA]);
for (const [i, texto, deMim] of [[1, "quanto custa?", false], [2, "R$ 289", true]]) {
  await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me)
    values ($1, $2, $3, $4, $5, now() - interval '${10 - i} minutes', $6)`, [CONEXAO, MAJOR.id, T, `m${i}`, texto, deMim]);
}
await db.query(`insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me)
  values ($1, $2, $3, 'g1', 'oi', now(), false)`, [CONEXAO, MAJOR.id, GRUPO]);
const contato = (await db.query("insert into public.contacts (organization_id, name, phone) values ($1, 'Lead', '(65) 9 8888-7777') returning id", [MAJOR.id])).rows[0].id;
await db.query(`insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
  values ($1, $2, $3, now(), 'ok', '{"temperatura": {"a": "morno", "p": 0.7}}', true)`, [MAJOR.id, CONEXAO, T]);
await como(MAJOR.dono, "select public.playbook_save($1, $2::jsonb, true)", [MAJOR.id, JSON.stringify({ objecoes: [{ chave: "preco", nome: "Preço" }] })]);

const pedir = (quem, chat = T, tipo = "comercial", org = MAJOR.id) =>
  como(quem, "select public.conversation_analysis_request($1, $2, $3, $4) as r", [org, CONEXAO, chat, tipo]);
const status = (quem, id, org = MAJOR.id) => como(quem, "select public.conversation_analysis_status($1, $2) as r", [org, id]);
const gravar = (payload) => como(ROBO, "select public.nucleo_analysis_record($1::jsonb) as r", [JSON.stringify(payload)], { robo });

// 3. Quem pede e o que é recusado.
let erro = await erroDe(() => pedir(MEMBRO));
confere("membro não pede análise", erro.includes("organization management required"), erro);
erro = await erroDe(() => pedir(OUTRA.dono));
confere("dono de outra empresa não pede", erro.includes("organization management required"), erro);
erro = await erroDe(() => pedir(MAJOR.dono, T, "vendas"));
confere("tipo inventado é recusado", erro.includes("kind"), erro);
erro = await erroDe(() => pedir(MAJOR.dono, GRUPO));
confere("grupo não é analisado", erro.includes("group"), erro);
erro = await erroDe(() => pedir(MAJOR.dono, VAZIA));
confere("conversa sem mensagens é recusada", erro.includes("no messages"), erro);
erro = await erroDe(() => pedir(null, T, "comercial"));
confere("anônimo não executa", /permission denied|organization management/i.test(erro), erro);

// 4. Pedir.
let r = (await pedir(MAJOR.dono)).rows[0].r;
const primeira = r.analysisId;
confere("pede, gasta 1 crédito e fica pendente", r.status === "pending" && r.reused === false && r.credits.used === 1 && r.credits.limit === 200, JSON.stringify(r.credits));
const cmd = (await db.query("select * from public.connection_runtime_commands where command_type = 'conversation_analyze'")).rows[0];
const carga = cmd.private_payload;
confere("o comando vai para a conexão com a conversa inteira",
  cmd.connection_id === CONEXAO && carga.analysisId === primeira && carga.messages.length === 2 && carga.messages[0].content === "quanto custa?");
confere("leva leitura do Jev, playbook, funil, etiquetas e se há contato",
  carga.reading?.temperatura?.a === "morno" && carga.playbook?.objecoes?.[0]?.chave === "preco" && carga.stages.length >= 6 && carga.tags.length >= 1 && carga.hasContact === true,
  JSON.stringify({ stages: carga.stages, tags: carga.tags }));
const linha = (await db.query("select contact_id from public.conversation_analyses where id = $1", [primeira])).rows[0];
confere("liga a análise ao contato do CRM", linha.contact_id === contato);
r = (await pedir(MAJOR.dono)).rows[0].r;
confere("dois cliques: devolve a mesma análise, sem outro crédito", r.analysisId === primeira && r.reused === true && r.credits.used === 1);

// 5. A VPS grava.
erro = await erroDe(() => como(MAJOR.dono, "select public.nucleo_analysis_record($1::jsonb)", [JSON.stringify({ analysisId: primeira, status: "done" })]));
confere("só o robô grava", erro.includes("robot credential"), erro);
await gravar({ analysisId: primeira, status: "running" });
let st = (await status(MAJOR.dono, primeira)).rows[0].r;
confere("fica em andamento", st.status === "running");
await gravar({ analysisId: primeira, status: "done", model: "claude-sonnet-5", latencyMs: 31000, result: { resumo: "Lead morno, objeção de preço.", sugestoes: [{ tipo: "etiqueta", valor: "Lead quente" }] } });
st = (await status(MAJOR.dono, primeira)).rows[0].r;
confere("o dono vê o resultado", st.status === "done" && st.result.resumo.startsWith("Lead morno") && st.contactId === contato, JSON.stringify(st).slice(0, 160));
r = (await gravar({ analysisId: primeira, status: "failed", errorCode: "x" })).rows[0].r;
confere("análise pronta não volta a falhar", r.recorded === false && r.status === "done");
erro = await erroDe(() => gravar({ analysisId: primeira, status: "done", result: { x: "y".repeat(40000) } }));
confere("resultado grande demais é recusado", erro.includes("invalid"), erro);

// 6. Rascunho e salvar.
erro = await erroDe(() => status(MEMBRO, primeira));
confere("a equipe não vê o rascunho", erro.includes("analysis not found"), erro);
let vistas = (await como(MEMBRO, "select count(*)::int as n from public.conversation_analyses")).rows[0].n;
confere("a equipe não lista rascunhos", vistas === 0, String(vistas));
erro = await erroDe(() => como(MEMBRO, "select public.conversation_analysis_save($1, $2)", [MAJOR.id, primeira]));
confere("membro não salva", erro.includes("organization management required"), erro);
await como(MAJOR.dono, "select public.conversation_analysis_save($1, $2)", [MAJOR.id, primeira]);
st = (await status(MEMBRO, primeira)).rows[0].r;
confere("salva, a equipe vê", st.savedAt !== null && st.result.resumo.length > 0);
vistas = (await como(OUTRA.dono, "select count(*)::int as n from public.conversation_analyses")).rows[0].n;
confere("outra empresa não vê nada", vistas === 0, String(vistas));
erro = await erroDe(() => como(MAJOR.dono, `update public.conversation_analyses set kind = 'atendimento' where id = '${primeira}'`));
confere("ninguém escreve direto na tabela", /permission denied/i.test(erro), erro);

// 7. Falha e pedido parado devolvem o crédito.
r = (await pedir(MAJOR.dono, T, "atendimento")).rows[0].r;
confere("refazer gasta outro crédito", r.credits.used === 2, JSON.stringify(r.credits));
await gravar({ analysisId: r.analysisId, status: "failed", errorCode: "analysis_account_missing" });
let saldo = (await como(MAJOR.dono, "select public.conversation_analysis_credits($1) as r", [MAJOR.id])).rows[0].r;
confere("falha devolve o crédito", saldo.used === 1, JSON.stringify(saldo));
r = (await pedir(MAJOR.dono)).rows[0].r;
await db.query("update public.conversation_analyses set requested_at = now() - interval '20 minutes' where id = $1", [r.analysisId]);
st = (await status(MAJOR.dono, r.analysisId)).rows[0].r;
confere("pedido parado há 15 min vira falha e devolve", st.status === "failed" && st.errorCode === "expired" && st.credits.used === 1, JSON.stringify(st.credits));

// 8. Sem saldo.
await como(ADMIN, "select public.platform_entitlement_set($1, 'analysis_credits', null, 1, null, 'teste', false)", [MAJOR.id]);
erro = await erroDe(() => pedir(MAJOR.dono, T, "atendimento"));
confere("sem saldo, recusa", erro.includes("no analysis credits left"), erro);
await como(ADMIN, "select public.platform_entitlement_set($1, 'analysis_credits', null, null, null, 'sob medida', false)", [MAJOR.id]);
saldo = (await como(MAJOR.dono, "select public.conversation_analysis_credits($1) as r", [MAJOR.id])).rows[0].r;
confere("limite nulo no painel é sem limite", saldo.limit === null && saldo.left === null, JSON.stringify(saldo));

// 9. Rascunho velho perde o conteúdo e continua contando.
await como(ADMIN, "select public.platform_entitlement_clear($1, 'analysis_credits', 'volta ao plano')", [MAJOR.id]).catch(() => null);
const velho = (await db.query(`insert into public.conversation_analyses (organization_id, connection_id, contact_phone, kind, status, requested_by, requested_at, completed_at, cycle_start, result)
  values ($1, $2, $3, 'comercial', 'done', $4, now() - interval '8 days', now() - interval '8 days', now() - interval '20 days', '{"resumo": "velho"}') returning id`, [MAJOR.id, CONEXAO, T, MAJOR.dono])).rows[0].id;
const antes = (await como(MAJOR.dono, "select public.conversation_analysis_credits($1) as r", [MAJOR.id])).rows[0].r.used;
await pedir(MAJOR.dono, T, "atendimento");
const v = (await db.query("select status, result from public.conversation_analyses where id = $1", [velho])).rows[0];
confere("rascunho com mais de 7 dias perde o conteúdo", v.status === "expired" && JSON.stringify(v.result) === "{}", JSON.stringify(v));
const depois = (await como(MAJOR.dono, "select public.conversation_analysis_credits($1) as r", [MAJOR.id])).rows[0].r.used;
confere("e continua contando no ciclo", depois === antes + 1, `${antes} → ${depois}`);

// 10. Reaplicar aborta.
const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("reaplicar aborta", reaplicar.includes("ja foi aplicada"), reaplicar);

for (const l of passou) console.log(`PASS ${l}`);
for (const l of falhas) console.log(`FAIL ${l}`);
console.log(`\n${passou.length} PASS, ${falhas.length} FAIL`);
process.exit(falhas.length ? 1 : 0);
