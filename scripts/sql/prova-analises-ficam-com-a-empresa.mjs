// Prova da migration 20261013100000 (as análises ficam com a empresa) num
// Postgres embutido (PGlite), com o harness e TODAS as migrations reais
// anteriores. Nada aqui toca produção: o DELETE da conexão é num banco
// sintético, que só existe nesta execução.
//
//   node prova-analises-ficam-com-a-empresa.mjs <repo>
//
// O que prende (ADR-0007, etapa 1):
//   - o contato vem do telefone inteiro, um só; colisão dos 8 últimos dígitos
//     e número repetido ficam sem contato;
//   - as linhas antigas: o contato é refeito, e o que contradiz os fatos fica
//     nulo (os fatos não são reescritos);
//   - a coluna e os fatos das leituras novas apontam para a mesma pessoa;
//   - contato de outra empresa é recusado;
//   - apagar a conexão mantém a análise, a leitura e as respostas, com a
//     empresa, o nome e o final do número;
//   - o relatório abre sem a conexão; a RLS de salvas/rascunhos continua.

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-analises-ficam-com-a-empresa.mjs <repo>");
const MIGRATION = "20261013100000_analises_ficam_com_a_empresa.sql";
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

async function como(sub, sql, params = []) {
  return db.transaction(async (tx) => {
    const claims = { sub, role: "authenticated" };
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [sub, JSON.stringify(claims)]);
    await tx.exec("set local role authenticated");
    return tx.query(sql, params);
  });
}

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
let seq = 0;
async function empresa(nome) {
  seq += 1;
  const dono = `bbbbbbbb-0000-4000-8000-00000000000${seq}`;
  const email = `dono${seq}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [dono, email]);
  const codigo = (await como(ADMIN, "select * from public.issue_onboarding_access($1, 'full', 7)", [email])).rows[0].access_code;
  const id = (await como(dono, "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
  return { id, dono };
}

const MAJOR = await empresa("Major");
const OUTRA = await empresa("Outra");
const CONEXAO = "cccccccc-0000-4000-8000-000000000001";
const MEMBRO = "eeeeeeee-0000-4000-8000-000000000001";
await db.query(
  "insert into public.whatsapp_connections (id, organization_id, name, expected_phone_last4) values ($1, $2, 'WhatsApp principal (8362)', '5324')",
  [CONEXAO, MAJOR.id]
);
await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'membro@exemplo.invalido', now())", [MEMBRO]);
await db.query("insert into public.profiles (id, full_name) values ($1, 'Membro') on conflict (id) do nothing", [MEMBRO]);
await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [MAJOR.id, MEMBRO]);

// Os telefones da conversa (como o WhatsApp manda) e os contatos do CRM.
const UNICO = "5565988887777"; // um contato, cadastrado com DDD e sem o 55
const COLIDE = "5511988887777"; // os mesmos 8 últimos dígitos do UNICO, outro DDD, sem contato
const REPETIDO = "5565977776666"; // dois contatos com o mesmo número em formatos diferentes
const SEM9 = "556588885555"; // a conversa chega sem o nono dígito
const contato = async (nome, fone, org = MAJOR.id) =>
  (await db.query("insert into public.contacts (organization_id, name, phone) values ($1, $2, $3) returning id", [org, nome, fone])).rows[0].id;
const cUnico = await contato("Único", "(65) 9 8888-7777");
const cRep1 = await contato("Repetido 1", "(65) 97777-6666");
const cRep2 = await contato("Repetido 2", "+55 65 97777-6666");
const cSem9 = await contato("Sem nove", "65 98888-5555");
const cOutra = await contato("De outra empresa", "(65) 9 8888-7777", OUTRA.id);
const NOVE = "5565988884444"; // dois contatos: um com o nono dígito, outro sem
await contato("Com nove", "(65) 98888-4444");
await contato("Sem nove, mesmo número", "(65) 8888-4444");
const APAGADO = "5565966665555";
const cApagado = await contato("Apagado", "(65) 96666-5555");
await db.query("update public.contacts set deleted_at = now() where id = $1", [cApagado]);
const CONEXAO_OUTRA = "cccccccc-0000-4000-8000-000000000002";
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'da outra')", [CONEXAO_OUTRA, OUTRA.id]);

for (const chat of [UNICO, COLIDE, REPETIDO, SEM9, NOVE]) {
  await db.query(
    "insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, chat_kind, last_message_at) values ($1, $2, $3, 'direto', now())",
    [CONEXAO, MAJOR.id, chat]
  );
  await db.query(
    "insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me) values ($1, $2, $3, $4, 'quanto custa?', now() - interval '5 minutes', false)",
    [CONEXAO, MAJOR.id, chat, `m-${chat}`]
  );
}

// Linhas antigas, gravadas como antes da migration: o contato escolhido pelos
// 8 últimos dígitos (a colisão aponta para o Único, que é outra pessoa).
const analiseAntiga = async (chat, contatoId, fatos = {}, salva = true) =>
  (await db.query(
    `insert into public.conversation_analyses
       (organization_id, connection_id, contact_phone, contact_id, kind, status, requested_by, cycle_start, completed_at, saved_at, saved_by, result, facts)
     values ($1, $2, $3, $4, 'comercial', 'done', $5, now() - interval '1 day', now(), ${salva ? "now()" : "null"}, ${salva ? "$5" : "null"},
             '{"summary": "resumo citando o que foi dito: quanto custa?"}', $6::jsonb)
     returning id`,
    [MAJOR.id, CONEXAO, chat, contatoId, MAJOR.dono, JSON.stringify(fatos)]
  )).rows[0].id;
const aUnico = await analiseAntiga(UNICO, cUnico, { contactId: cUnico });
const aColide = await analiseAntiga(COLIDE, cUnico, {});
const aRepetido = await analiseAntiga(REPETIDO, cRep1, {});
const aSem9 = await analiseAntiga(SEM9, null, {});
const aContradiz = await analiseAntiga(UNICO, cUnico, { contactId: cRep2 }, false);

const leituraAntiga = async (chat, fatos) =>
  (await db.query(
    `insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
     values ($1, $2, $3, now(), 'failed', '{}', false) returning id`,
    [MAJOR.id, CONEXAO, chat]
  ).then(async (r) => {
    await db.query("update public.conversation_insight_runs set facts = $2::jsonb where id = $1", [r.rows[0].id, JSON.stringify(fatos)]);
    return r;
  })).rows[0].id;
const lUnico = await leituraAntiga(UNICO, { contactId: cUnico });
const lColide = await leituraAntiga(COLIDE, { contactId: cUnico });
await db.query(
  "insert into public.conversation_insight_answers (run_id, organization_id, question, answer, probability) values ($1, $2, 'temperatura', 'morno', 0.7)",
  [lUnico, MAJOR.id]
);

// A leitura em vigor da colisão, feita pela regra antiga: os fatos escolhem o
// Único pelos 8 últimos dígitos, e a visão dos números diria que é ele.
const lColideEmVigor = (await db.query(
  `insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
   values ($1, $2, $3, now(), 'ok', '{}', true) returning id`,
  [MAJOR.id, CONEXAO, COLIDE]
)).rows[0].id;
const fatosAntigos = (await db.query("select facts from public.conversation_insight_runs where id = $1", [lColideEmVigor])).rows[0].facts;
confere("antes: a regra antiga escolhia o Único para a colisão", fatosAntigos.contactId === cUnico, JSON.stringify(fatosAntigos.contactId));

// ---------------------------------------------------------------- a migration
await db.exec(ler(`supabase/migrations/${MIGRATION}`));
passou.push("migration aplicada sobre todas as anteriores");
const erroRepetida = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATION}`)));
confere("aplicar de novo aborta", erroRepetida.includes("ja foi aplicada"), erroRepetida);

// 1. O resolvedor.
const resolve = async (chat, org = MAJOR.id) => (await db.query("select private.contato_pelo_telefone($1, $2) as id", [org, chat])).rows[0].id;
confere("telefone inteiro acha o contato cadastrado sem o 55", (await resolve(UNICO)) === cUnico);
confere("mesmos 8 últimos dígitos com outro DDD: sem contato", (await resolve(COLIDE)) === null);
confere("número repetido em dois contatos: sem contato", (await resolve(REPETIDO)) === null);
confere("conversa sem o nono dígito acha o contato com o nono", (await resolve(SEM9)) === cSem9);
confere("a outra empresa acha só o contato dela", (await resolve(UNICO, OUTRA.id)) === cOutra);
confere("dois contatos que só diferem pelo nono dígito: sem contato", (await resolve(NOVE)) === null);
confere("contato apagado não é achado", (await resolve(APAGADO)) === null);
confere("telefone vazio ou curto não acha ninguém", (await resolve("")) === null && (await resolve("8888")) === null && (await resolve(null)) === null);

// 2. As linhas antigas.
const analise = async (id) => (await db.query("select * from public.conversation_analyses where id = $1", [id])).rows[0];
const leitura = async (id) => (await db.query("select * from public.conversation_insight_runs where id = $1", [id])).rows[0];
let a = await analise(aUnico);
confere("antiga: o nome e o final do número entram", a.connection_name === "WhatsApp principal (8362)" && a.connection_last4 === "5324", `${a.connection_name} ${a.connection_last4}`);
confere("antiga: contato único continua", a.contact_id === cUnico);
confere("antiga: a colisão dos 8 dígitos perde o contato errado", (await analise(aColide)).contact_id === null);
confere("antiga: número repetido fica sem contato", (await analise(aRepetido)).contact_id === null);
confere("antiga: a conversa sem o nono dígito ganha o contato", (await analise(aSem9)).contact_id === cSem9);
a = await analise(aContradiz);
confere("antiga: fatos apontando para outra pessoa deixam sem contato, e os fatos ficam", a.contact_id === null && a.facts.contactId === cRep2);
let l = await leitura(lUnico);
confere("leitura antiga: contato preenchido igual aos fatos", l.contact_id === cUnico && l.connection_last4 === "5324");
confere("leitura antiga: colisão com fatos errados fica sem contato", (await leitura(lColide)).contact_id === null);

// 3. Leitura nova: a coluna e os fatos são a mesma pessoa.
const lNova = (await db.query(
  `insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
   values ($1, $2, $3, now(), 'ok', '{}', true) returning id`,
  [MAJOR.id, CONEXAO, UNICO]
)).rows[0].id;
l = await leitura(lNova);
confere("leitura nova: os fatos usam o contato único", l.facts.contactId === cUnico, JSON.stringify(l.facts.contactId));
confere("leitura nova: a coluna é a mesma pessoa dos fatos", l.contact_id === cUnico);
confere("leitura nova: a origem é gravada", l.connection_name === "WhatsApp principal (8362)" && l.connection_last4 === "5324");
const lColideNova = (await db.query(
  `insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
   values ($1, $2, $3, now(), 'ok', '{}', false) returning id`,
  [MAJOR.id, CONEXAO, COLIDE]
)).rows[0].id;
l = await leitura(lColideNova);
confere("leitura nova na colisão: nem fatos nem coluna escolhem alguém", l.contact_id === null && (l.facts.contactId ?? null) === null);

// A visão dos números: a leitura em vigor da colisão deixa de dizer que é o Único.
const visao = (await db.query("select contact_id, is_lead, deal_status, meetings_scheduled, tasks_overdue from public.conversation_intelligence where reading_id = $1", [lColideEmVigor])).rows[0];
confere("visão: a leitura antiga da colisão fica sem contato e sem os fatos do contato",
  visao && visao.contact_id === null && visao.is_lead === null && visao.deal_status === null && visao.meetings_scheduled === null && visao.tasks_overdue === null,
  JSON.stringify(visao));
const visaoNova = (await db.query("select contact_id, is_lead from public.conversation_intelligence where reading_id = $1", [lNova])).rows[0];
confere("visão: a leitura nova mostra o contato validado", visaoNova && visaoNova.contact_id === cUnico && visaoNova.is_lead !== null, JSON.stringify(visaoNova));

// 4. O pedido de análise usa o mesmo resolvedor.
const corpoDoPedido = (await db.query("select pg_get_functiondef('public.conversation_analysis_request(uuid,uuid,text,text)'::regprocedure) as d")).rows[0].d;
confere("o pedido escolhe o contato pelo resolvedor, não pelos 8 dígitos",
  corpoDoPedido.includes("private.contato_pelo_telefone(target_organization, chat)") && !corpoDoPedido.includes("right(chat, 8)"));
const corpoDosFatos = (await db.query("select pg_get_functiondef('private.fatos_da_conversa(uuid,uuid,text,timestamptz)'::regprocedure) as d")).rows[0].d;
confere("os fatos escolhem o contato pelo resolvedor", corpoDosFatos.includes("private.contato_pelo_telefone(target_organization, telefone)") && !corpoDosFatos.includes("right(telefone, 8)"));

// 5. Contato de outra empresa é recusado.
const erroOutra = await erroDe(() => db.query("update public.conversation_analyses set contact_id = $1 where id = $2", [cOutra, aUnico]));
confere("contato de outra empresa não entra na análise", erroOutra.includes("conversation_analyses_contato"), erroOutra);
const erroOutraLeitura = await erroDe(() => db.query("update public.conversation_insight_runs set contact_id = $1 where id = $2", [cOutra, lUnico]));
confere("contato de outra empresa não entra na leitura", erroOutraLeitura.includes("conversation_insight_runs_contato"), erroOutraLeitura);

// Inserção direta com conexão ou contato de outra empresa.
const inserir = (conexao, contatoId) => db.query(
  `insert into public.conversation_analyses (organization_id, connection_id, contact_phone, contact_id, kind, requested_by, cycle_start)
   values ($1, $2, $3, $4, 'comercial', $5, now())`, [MAJOR.id, conexao, UNICO, contatoId, MAJOR.dono]);
let erroDireto = await erroDe(() => inserir(CONEXAO_OUTRA, null));
confere("análise da empresa com conexão de outra empresa é recusada", erroDireto.includes("conversation_analyses_conexao"), erroDireto);
erroDireto = await erroDe(() => inserir(CONEXAO, cOutra));
confere("análise da empresa com contato de outra empresa é recusada", erroDireto.includes("conversation_analyses_contato"), erroDireto);
erroDireto = await erroDe(() => db.query(
  `insert into public.conversation_insight_runs (organization_id, connection_id, contact_phone, analyzed_until, status, summary, is_latest)
   values ($1, $2, $3, now(), 'failed', '{}', false)`, [MAJOR.id, CONEXAO_OUTRA, UNICO]));
confere("leitura da empresa com conexão de outra empresa é recusada", erroDireto.includes("conversation_insight_runs_conexao"), erroDireto);

// 6. A RLS de antes: a equipe vê as salvas, o dono vê também o rascunho.
const pelaEquipe = (await como(MEMBRO, "select id from public.conversation_analyses where organization_id = $1 and contact_id = $2", [MAJOR.id, cUnico])).rows.map((r) => r.id);
confere("equipe lê pelo contato as análises salvas", pelaEquipe.includes(aUnico));
const pelaOutra = (await como(OUTRA.dono, "select id from public.conversation_analyses where contact_id = $1", [cUnico])).rows;
confere("outra empresa não lê nada", pelaOutra.length === 0);
const rascunhos = (await como(MAJOR.dono, "select count(*)::int as n from public.conversation_analyses where saved_at is null and organization_id = $1", [MAJOR.id])).rows[0].n;
const rascunhosEquipe = (await como(MEMBRO, "select count(*)::int as n from public.conversation_analyses where saved_at is null and organization_id = $1", [MAJOR.id])).rows[0].n;
confere("rascunho: o dono vê, a equipe não", rascunhos >= 1 && rascunhosEquipe === 0, `${rascunhos}/${rascunhosEquipe}`);

// 7. Com a conexão ativa, o relatório continua como antes.
const statusDe = (id) => como(MAJOR.dono, "select public.conversation_analysis_status($1, $2) as r", [MAJOR.id, id]);
let antes = (await statusDe(aUnico)).rows[0].r;
confere("relatório com a conexão ativa abre", antes && antes.status === "done", JSON.stringify(antes)?.slice(0, 120));

// 8. Apagar a conexão (só neste banco sintético) mantém tudo da empresa.
const totais = async () => (await db.query(`select
  (select count(*) from public.conversation_analyses where organization_id = $1)::int as analises,
  (select count(*) from public.conversation_insight_runs where organization_id = $1)::int as leituras,
  (select count(*) from public.conversation_insight_answers where organization_id = $1)::int as respostas,
  (select count(*) from public.contacts where organization_id = $1)::int as contatos`, [MAJOR.id])).rows[0];
const antesDeApagar = await totais();
const erroApagar = await erroDe(() => db.query("delete from public.whatsapp_connections where id = $1", [CONEXAO]));
confere("a conexão sintética sai", erroApagar === "", erroApagar);
const depois = await totais();
confere("análises, leituras, respostas e contatos ficam", JSON.stringify(depois) === JSON.stringify(antesDeApagar), `${JSON.stringify(antesDeApagar)} → ${JSON.stringify(depois)}`);
a = await analise(aUnico);
confere("a análise fica com a empresa, sem a conexão, com a origem guardada",
  a.organization_id === MAJOR.id && a.connection_id === null && a.connection_name === "WhatsApp principal (8362)" && a.connection_last4 === "5324" && a.contact_id === cUnico);
l = await leitura(lUnico);
confere("a leitura fica com a empresa e o contato", l.organization_id === MAJOR.id && l.connection_id === null && l.contact_id === cUnico);
const conversas = (await db.query("select count(*)::int as n from public.whatsapp_messages where organization_id = $1", [MAJOR.id])).rows[0].n;
confere("as mensagens da conexão saem com ela", conversas === 0, String(conversas));
const depoisDeApagar = (await statusDe(aUnico)).rows[0].r;
confere("o relatório abre sem a conexão", depoisDeApagar && depoisDeApagar.status === "done", JSON.stringify(depoisDeApagar)?.slice(0, 160));
confere("sem a conexão, não há linha do tempo", (depoisDeApagar.timeline ?? null) === null, JSON.stringify(depoisDeApagar.timeline));
confere("com a conexão, a análise antiga tinha linha do tempo para comparar", antes.timeline !== undefined, Object.keys(antes).join(","));
confere("o relatório guarda o texto como foi feito", JSON.stringify(depoisDeApagar).includes("quanto custa?") || a.result.summary.includes("quanto custa?"));
const pelaEquipeDepois = (await como(MEMBRO, "select id from public.conversation_analyses where organization_id = $1 and contact_id = $2", [MAJOR.id, cUnico])).rows.map((r) => r.id);
confere("depois de apagar, a equipe ainda lê pelo contato", pelaEquipeDepois.includes(aUnico));

console.log(`passou: ${passou.length}`);
for (const p of passou) console.log(`  ok  ${p}`);
if (falhas.length) {
  console.log(`FALHOU: ${falhas.length}`);
  for (const f of falhas) console.log(`  XX  ${f}`);
  process.exit(1);
}
