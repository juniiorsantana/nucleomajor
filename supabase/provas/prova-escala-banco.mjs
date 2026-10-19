// Prova das migrations da escala das Conversas (20261020100000, 110000, 120000
// e 130000) num Postgres embutido (PGlite). Banco em memória, nada de produção,
// dados sintéticos.
//
// Harness + TODAS as migrations reais até a anterior, e então, para cada uma:
// o ensaio (a migration inteira com `raise exception` no lugar do `commit;`,
// que não pode deixar nada), a aplicação, as perguntas, a reaplicação (as
// guardas aceitam o próprio corpo) e, no fim, os rollbacks na ordem inversa e
// a reaplicação de tudo.
//
//   1. changed_at não anda quando só updated_at muda, com o upsert REAL de
//      nucleo_conversation_sync (o lote da VPS); anda quando muda prévia, dono,
//      não lidas ou nome; grupo sem nome não é mudança; mensagem e contato idem.
//   2. br_phone_key bate com a tabela casos-telefone-br.json; a lista casa o
//      mesmo contato que o portal (variantesBR) em cada conversa; RLS isola
//      empresas; delta por conversa e por contato; o cursor não repete.
//   3. Os nove gatilhos de realtime geram os mesmos eventos de antes (mesmo
//      tópico, mesmo entity_id, mesmo silêncio no update sem mudança); no
//      tópico conversas, entity_key = contact_phone.
//   4. A sincronia com lote sem mudança faz ZERO updates; com mudança, só nas
//      conversas que mudaram; foto igual não regrava.
//   5. Medição: explain (analyze, buffers) da lista com e sem cursor, no
//      tamanho da Adriani (461 conversas, 102 contatos, 3.225 mensagens) e com
//      10 mil conversas; tempo da sincronia do lote inteiro antes e depois.
//
//   mkdir prova && cd prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   node <repo>/supabase/provas/prova-escala-banco.mjs <repo>
//   (rodar de dentro de `prova`, para o import achar o pglite)
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-escala-banco.mjs <repo>");
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const { variantesBR } = await import(pathToFileURL(`${REPO}/apps/emyleads/src/lib/phone.js`).href);

const MIGRATIONS = [
  "20261020100000_conversas_mudaram_em.sql",
  "20261020110000_lista_de_conversas_com_contato.sql",
  "20261020120000_aviso_de_realtime_com_a_conversa.sql",
  "20261020130000_a_sincronia_nao_regrava_sem_mudanca.sql",
];
const ROLLBACKS = [
  "supabase/provas/rollback-20261020100000-conversas-mudaram-em.sql",
  "supabase/provas/rollback-20261020110000-lista-de-conversas-com-contato.sql",
  "supabase/provas/rollback-20261020120000-aviso-de-realtime-com-a-conversa.sql",
  "supabase/provas/rollback-20261020130000-a-sincronia-nao-regrava-sem-mudanca.sql",
];
const { casos } = JSON.parse(ler("supabase/provas/casos-telefone-br.json"));

const falhas = [];
const passou = [];
const medidas = [];
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
  -- Como no Supabase: o usuário logado lê auth.uid() (touch_versioned_record usa).
  grant usage on schema auth to authenticated;
  grant execute on all functions in schema auth to authenticated;
`);
const todas = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
for (const m of MIGRATIONS) if (!todas.includes(m)) throw new Error(`migration não achada: ${m}`);
for (const f of todas) {
  if (f >= MIGRATIONS[0]) break;
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
const todos = async (sql, params = []) => (await db.query(sql, params)).rows;

// ------------------------------------------------------------- o cenário
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const DONO = "aaaaaaaa-0000-4000-8000-000000000002";
const OUTRO = "aaaaaaaa-0000-4000-8000-000000000005";
const ROBO = "dddddddd-0000-4000-8000-000000000003";
const CONEXAO = "eeeeeeee-0000-4000-8000-000000000004";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${ADMIN}', 'cmo@majorhub.com.br', now()),
    ('${DONO}', 'dono@exemplo.invalido', now()),
    ('${OUTRO}', 'outro@exemplo.invalido', now()),
    ('${ROBO}', 'robot+x@invalid.emyleads.local', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
const novaEmpresa = async (email, dono, nome) => {
  const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, 'base', 7)", [email])).rows[0].access_code;
  return (await como(usuario(dono), "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
};
const org = await novaEmpresa("dono@exemplo.invalido", DONO, "Clínica");
const orgOutra = await novaEmpresa("outro@exemplo.invalido", OUTRO, "Outra");
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [CONEXAO, org]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO, org, ROBO]);
const robo = { sub: ROBO, role: "authenticated", app_metadata: { is_robot: "true", organization_id: org, connection_id: CONEXAO } };

const sincronizar = (payload) => como(robo, "select public.nucleo_conversation_sync($1::jsonb) r", [JSON.stringify(payload)]);
// O lote e o número de updates que ele causou nas conversas, na MESMA
// transação. No PGlite (modo de usuário único) `pg_stat_xact` não zera entre
// transações, então a conta é a diferença entre antes e depois do lote.
const updatesDasConversas = async (tx) =>
  (await tx.query("select coalesce(n_tup_upd, 0)::int upd from pg_stat_xact_user_tables where relid = 'public.whatsapp_conversations'::regclass")).rows[0]?.upd ?? 0;
const sincronizarContando = (payload) =>
  db.transaction(async (tx) => {
    const antes = await updatesDasConversas(tx);
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [ROBO, JSON.stringify(robo)],
    );
    await tx.exec("set local role authenticated");
    const r = (await tx.query("select public.nucleo_conversation_sync($1::jsonb) r", [JSON.stringify(payload)])).rows[0].r;
    await tx.exec("reset role");
    return { r, updates: (await updatesDasConversas(tx)) - antes };
  });

const agora = Date.now();
const conversa = (phone, extra = {}) => ({
  phone, kind: "direto", name: `Pessoa ${phone.slice(-4)}`, preview: "oi", lastMessageAt: new Date(agora - 60_000).toISOString(),
  fromMe: false, unread: 1, owner: "bot", ...extra,
});
// Os telefones do cenário: o nono dígito nos dois sentidos, fixo, internacional
// e grupo. Os contatos ficam com a OUTRA forma, de propósito.
const CENA = [
  { conv: "5565992178164", contato: "556592178164", nome: "Ana" },
  { conv: "556581112222", contato: "5565981112222", nome: "Bruno" },
  { conv: "556532345678", contato: "556532345678", nome: "Clínica Fixo" },
  { conv: "5565932345678", contato: null },
  { conv: "14155552671", contato: "14155552671", nome: "Ed (EUA)" },
  { conv: "5565912345678", contato: "556512345678", nome: "Fábio sem 9" },
  { conv: "5565977776666", contato: null },
];
const GRUPO = "120363012345678901";
const lote = () => ({
  conversations: [
    ...CENA.map((c) => conversa(c.conv)),
    conversa(GRUPO, { kind: "grupo", name: "Equipe" }),
  ],
  messages: [],
});
for (const c of CENA) {
  if (c.contato) await db.query("insert into public.contacts (organization_id, name, phone) values ($1, $2, $3)", [org, c.nome, c.contato]);
}
// Fábio também salvo com o 9: o desempate tem que escolher este (igual à conversa).
await db.query("insert into public.contacts (organization_id, name, phone, created_at) values ($1, 'Fábio com 9', '5565912345678', now() + interval '1 second')", [org]);
// Um contato com o número do grupo não pode casar com o grupo.
await db.query("insert into public.contacts (organization_id, name, phone) values ($1, 'Não é o grupo', $2)", [org, GRUPO.slice(0, 13)]);
// A outra empresa tem uma conversa e um contato com o mesmo número da Ana.
await db.query("insert into public.contacts (organization_id, name, phone) values ($1, 'Ana da outra', '556592178164')", [orgOutra]);
await sincronizar({
  ...lote(),
  messages: [
    { phone: CENA[0].conv, id: "m-1", content: "oi", sentAt: new Date(agora - 120_000).toISOString(), fromMe: false },
    { phone: CENA[0].conv, id: "m-2", content: "", sentAt: new Date(agora - 60_000).toISOString(), fromMe: false, mediaType: "audio" },
  ],
});

// Retrato dos gatilhos de realtime antes de tudo.
const gatilhosDeRealtime = async () =>
  todos(`select t.tgrelid::regclass::text tabela, t.tgname, encode(t.tgargs, 'escape') args
         from pg_trigger t where t.tgfoid = 'private.portal_realtime_notify()'::regprocedure and not t.tgisinternal and t.tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
         order by 1, 2`);
const gatilhosAntes = await gatilhosDeRealtime();
confere("antes: são nove gatilhos de realtime", gatilhosAntes.length === 9, String(gatilhosAntes.length));

// Para provar que os nove continuam iguais sem precisar de uma linha válida de
// cada tabela: uma tabela-sombra por gatilho, com as colunas que a função lê
// (id, connection_id, contact_phone, updated_at, last_used_at) que a original
// tiver, e o mesmo argumento. O roteiro é o mesmo antes e depois da 120000.
await db.exec("create schema if not exists sombra");
for (const [i, g] of gatilhosAntes.entries()) {
  const colunas = (await todos(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1
       and column_name in ('id','connection_id','contact_phone','updated_at','last_used_at')`,
    [g.tabela.replace(/^public\./, "")],
  )).map((r) => r.column_name);
  const defs = [
    "organization_id uuid not null",
    colunas.includes("id") ? "id uuid" : null,
    colunas.includes("connection_id") ? "connection_id uuid" : null,
    colunas.includes("contact_phone") ? "contact_phone text" : null,
    colunas.includes("updated_at") ? "updated_at timestamptz" : null,
    colunas.includes("last_used_at") ? "last_used_at timestamptz" : null,
    "valor text",
  ].filter(Boolean);
  const topico = g.args.split("\\000")[0];
  g.sombra = `sombra.t${i}`;
  g.colunas = colunas;
  await db.exec(`create table ${g.sombra} (${defs.join(", ")});
    create trigger s after insert or update or delete on ${g.sombra}
    for each row execute function private.portal_realtime_notify('${topico}');`);
}
const roteiroDeRealtime = async () => {
  const saida = [];
  for (const g of gatilhosAntes) {
    await db.exec("delete from public.portal_realtime_events");
    const id = "11111111-1111-4111-8111-111111111111";
    const vals = { organization_id: org, valor: "a" };
    if (g.colunas.includes("id")) vals.id = id;
    if (g.colunas.includes("connection_id")) vals.connection_id = CONEXAO;
    if (g.colunas.includes("contact_phone")) vals.contact_phone = "5565900000001";
    if (g.colunas.includes("updated_at")) vals.updated_at = "2026-01-01T00:00:00Z";
    if (g.colunas.includes("last_used_at")) vals.last_used_at = "2026-01-01T00:00:00Z";
    const cols = Object.keys(vals);
    await db.query(`insert into ${g.sombra} (${cols.join(",")}) values (${cols.map((_, k) => `$${k + 1}`).join(",")})`, Object.values(vals));
    if (g.colunas.includes("updated_at")) await db.exec(`update ${g.sombra} set updated_at = updated_at + interval '1 minute'`);
    if (g.colunas.includes("last_used_at")) await db.exec(`update ${g.sombra} set last_used_at = last_used_at + interval '1 minute'`);
    await db.exec(`update ${g.sombra} set valor = 'b'`);
    await db.exec(`update ${g.sombra} set valor = valor`);
    await db.exec(`delete from ${g.sombra}`);
    const eventos = await todos("select topic, entity_id::text, to_jsonb(e) ->> 'entity_key' entity_key from public.portal_realtime_events e order by id");
    saida.push({ tabela: g.tabela, eventos });
  }
  return saida;
};
const realtimeAntes = await roteiroDeRealtime();

// Retrato do custo da sincronia de hoje (para a medição do fim).
const semEntityKey = (r) => r.map((t) => ({ ...t, eventos: t.eventos.map(({ entity_key, ...e }) => e) }));

// Ensaio: a migration com `raise exception` no lugar do `commit;` final.
const ensaiar = async (arquivo) => {
  const texto = ler(`supabase/migrations/${arquivo}`);
  const fim = texto.lastIndexOf("commit;");
  const ensaio = texto.slice(0, fim) + "do $$ begin raise exception 'ensaio ok'; end $$;\n";
  const erro = await erroDe(() => db.exec(ensaio));
  await db.exec("rollback");
  return erro;
};
const assinaturaDoBanco = async () =>
  JSON.stringify(await todos(`
    select 'col' k, table_name || '.' || column_name v from information_schema.columns
      where table_schema = 'public' and table_name in ('whatsapp_conversations','whatsapp_messages','contacts','portal_realtime_events')
    union all select 'fn', p.oid::regprocedure::text || md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private') and (p.proname like 'nucleo_conversation%' or p.proname in ('portal_realtime_notify','br_phone_key','br_phone_normalize','marcar_mudou_em'))
    union all select 'idx', indexname from pg_indexes where schemaname = 'public' and tablename in ('whatsapp_conversations','whatsapp_messages','contacts')
    union all select 'trg', tgname from pg_trigger where not tgisinternal
    order by 1, 2`));

// ================================================== 20261020100000
{
  const antes = await assinaturaDoBanco();
  const erro = await ensaiar(MIGRATIONS[0]);
  confere("100000 ensaio: termina no raise", /ensaio ok/.test(erro), erro);
  confere("100000 ensaio: não deixa nada", (await assinaturaDoBanco()) === antes);
  await db.exec(ler(`supabase/migrations/${MIGRATIONS[0]}`));

  const msg = await todos("select message_id, changed_at = created_at igual from public.whatsapp_messages order by 1");
  confere("100000: mensagens preenchidas com created_at", msg.length === 2 && msg.every((m) => m.igual));
  const conv = async (phone) => um("select changed_at, updated_at, contact_name from public.whatsapp_conversations where contact_phone = $1", [phone]);

  const a0 = await conv(CENA[0].conv);
  const g0 = await conv(GRUPO);
  await sincronizar(lote());
  const a1 = await conv(CENA[0].conv);
  confere("1. o upsert real da sincronia regrava updated_at (antes da 130000)", a1.updated_at > a0.updated_at);
  confere("1. mas changed_at não anda quando só updated_at muda", +a1.changed_at === +a0.changed_at);

  await sincronizar({ conversations: [conversa(GRUPO, { kind: "grupo", name: "" })], messages: [] });
  const g1 = await conv(GRUPO);
  confere("1. grupo sem nome no lote: o nome fica e changed_at não anda", g1.contact_name === "Equipe" && +g1.changed_at === +g0.changed_at);

  for (const [campo, extra] of [
    ["prévia", { preview: "nova" }],
    ["dono", { owner: "humano", attendantId: DONO, attendantName: "Dono" }],
    ["não lidas", { unread: 7 }],
    ["nome", { name: "Ana Paula" }],
  ]) {
    const antesDela = await conv(CENA[0].conv);
    const outra = await conv(CENA[1].conv);
    const l = lote();
    l.conversations[0] = { ...l.conversations[0], ...extra };
    await sincronizar(l);
    confere(`1. muda ${campo}: changed_at anda`, (await conv(CENA[0].conv)).changed_at > antesDela.changed_at);
    confere(`1. muda ${campo}: as outras não andam`, +(await conv(CENA[1].conv)).changed_at === +outra.changed_at);
    // volta ao lote padrão para o próximo caso começar do mesmo lugar
    await sincronizar(lote());
  }

  const m0 = await um("select changed_at from public.whatsapp_messages where message_id = 'm-2'");
  const reenvio = { phone: CENA[0].conv, id: "m-2", content: "", sentAt: new Date(agora - 60_000).toISOString(), fromMe: false, mediaType: "audio" };
  await sincronizar({ conversations: [], messages: [reenvio] });
  confere("1. mensagem reenviada igual: changed_at não anda", +(await um("select changed_at from public.whatsapp_messages where message_id = 'm-2'")).changed_at === +m0.changed_at);
  await sincronizar({ conversations: [], messages: [{ ...reenvio, mediaPath: `${org}/${CONEXAO}/${CENA[0].conv}/m-2.ogg`, mediaMime: "audio/ogg" }] });
  confere("1. a mídia chega depois: changed_at da mensagem anda", (await um("select changed_at from public.whatsapp_messages where message_id = 'm-2'")).changed_at > m0.changed_at);
  const m3 = await um("select changed_at from public.whatsapp_messages where message_id = 'm-2'");
  await db.exec("update public.whatsapp_messages set content = 'transcrito', transcribed_at = now() where message_id = 'm-2'");
  confere("1. a transcrição: changed_at da mensagem anda", (await um("select changed_at from public.whatsapp_messages where message_id = 'm-2'")).changed_at > m3.changed_at);

  const k0 = await um("select id, changed_at, version from public.contacts where phone = $1 and organization_id = $2", [CENA[0].contato, org]);
  // Como o portal grava: `updated_by` sempre vai, mesmo sem mudar nada.
  await como(usuario(DONO), "update public.contacts set updated_by = $2, name = name where id = $1", [k0.id, DONO]);
  const k1 = await um("select changed_at, version from public.contacts where id = $1", [k0.id]);
  confere("1. contato salvo sem mudança: version sobe, changed_at não", +k1.version > +k0.version && +k1.changed_at === +k0.changed_at);
  await como(usuario(DONO), "update public.contacts set updated_by = $2, name = 'Ana Souza' where id = $1", [k0.id, DONO]);
  confere("1. contato renomeado: changed_at anda", (await um("select changed_at from public.contacts where id = $1", [k0.id])).changed_at > k1.changed_at);

  const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATIONS[0]}`)));
  confere("100000: colar de novo passa", reaplicar === "", reaplicar);
}

// ================================================== 20261020110000
const listar = (quem, desde = null, teto = 1000, alvo = org) =>
  como(usuario(quem), "select * from public.nucleo_conversation_list($1, $2, $3)", [alvo, desde, teto]).then((r) => r.rows);
{
  const antes = await assinaturaDoBanco();
  const erro = await ensaiar(MIGRATIONS[1]);
  confere("110000 ensaio: termina no raise", /ensaio ok/.test(erro), erro);
  confere("110000 ensaio: não deixa nada", (await assinaturaDoBanco()) === antes);
  await db.exec(ler(`supabase/migrations/${MIGRATIONS[1]}`));

  const errados = [];
  for (const c of casos) {
    const banco = (await um("select private.br_phone_key($1) k", [c.entrada])).k;
    if (banco !== c.chave) errados.push(`${JSON.stringify(c.entrada)}: ${banco} ≠ ${c.chave}`);
  }
  confere(`2. br_phone_key bate com os ${casos.length} casos da tabela`, errados.length === 0, errados.join("; "));

  const lista = await listar(DONO);
  confere("2. a lista traz todas as conversas da empresa", lista.length === CENA.length + 1, String(lista.length));
  const campos = Object.keys(lista[0]).sort().join(",");
  confere("2. as colunas do contrato", campos === [
    "connection_id", "contact_phone", "chat_kind", "contact_name", "contact_photo_url", "last_message_preview",
    "last_message_at", "last_message_from_me", "unread_count", "owner", "attendant_id", "attendant_name",
    "changed_at", "contact_id", "crm_name", "crm_company", "crm_job_title", "crm_avatar_path",
  ].sort().join(","), campos);

  // O portal de hoje: índice por todas as formas, acha pela conversa.
  const contatos = await todos("select id, name, phone from public.contacts where organization_id = $1 and deleted_at is null order by created_at, id", [org]);
  const indice = new Map();
  for (const k of contatos) for (const f of variantesBR(k.phone)) if (!indice.has(f)) indice.set(f, k);
  const doPortal = (linha) => {
    if (linha.chat_kind === "grupo") return null;
    for (const f of variantesBR(linha.contact_phone)) if (indice.get(f)) return indice.get(f).id;
    return null;
  };
  const diferentes = lista.filter((l) => (l.contact_id || null) !== doPortal(l)).map((l) => `${l.contact_phone}: ${l.crm_name} × portal`);
  confere("2. cada conversa casa o mesmo contato que o portal (variantesBR)", diferentes.length === 0, diferentes.join("; "));
  const porTel = Object.fromEntries(lista.map((l) => [l.contact_phone, l]));
  confere("2. nono dígito nos dois sentidos", porTel[CENA[0].conv].crm_name === "Ana Souza" && porTel[CENA[1].conv].crm_name === "Bruno");
  confere("2. desempate: o contato com o telefone igual ao da conversa", porTel[CENA[5].conv].crm_name === "Fábio com 9", porTel[CENA[5].conv].crm_name);
  confere("2. grupo não casa contato", porTel[GRUPO].contact_id === null);
  confere("2. sem contato a conversa aparece", porTel[CENA[6].conv] && porTel[CENA[6].conv].contact_id === null);
  confere("2. ordem sem cursor: última mensagem primeiro", lista.every((l, i) => i === 0 || +lista[i - 1].last_message_at >= +l.last_message_at || l.last_message_at === null));

  const outra = await erroDe(() => listar(OUTRO));
  confere("2. quem não é da empresa é recusado", /organization membership required/.test(outra), outra);
  // O mesmo número da Ana existe nas duas empresas: cada uma casa só o seu contato.
  const daOutra = await listar(OUTRO, null, 1000, orgOutra);
  confere("2. a outra empresa casa só o contato dela", daOutra.every((l) => !l.contact_id || l.crm_name === "Ana da outra"),
    JSON.stringify(daOutra.map((l) => l.crm_name)));
  const anon = await erroDe(() => como(null, "select * from public.nucleo_conversation_list($1)", [org]));
  confere("2. anon não chama a lista", /permission denied/.test(anon), anon);

  const cursor = new Date(Math.max(...lista.map((l) => +l.changed_at)));
  confere("2. com cursor e nada mudou: vazio", (await listar(DONO, cursor)).length === 0);
  const l = lote();
  l.conversations[2] = { ...l.conversations[2], preview: "chegou agora" };
  await sincronizar(l);
  const delta = await listar(DONO, cursor);
  confere("2. delta: só a conversa que mudou", delta.length === 1 && delta[0].contact_phone === CENA[2].conv, delta.map((d) => d.contact_phone).join(","));
  const cursor2 = new Date(Math.max(...delta.map((d) => +d.changed_at)));
  await como(usuario(DONO), "update public.contacts set updated_by = $2, name = 'Bruno Lima' where organization_id = $1 and phone = $3", [org, DONO, CENA[1].contato]);
  const delta2 = await listar(DONO, cursor2);
  confere("2. contato renomeado chega no delta, com o nome novo", delta2.length === 1 && delta2[0].crm_name === "Bruno Lima", JSON.stringify(delta2.map((d) => d.crm_name)));
  const cursor3 = new Date(Math.max(...delta2.map((d) => +d.changed_at)));
  confere("2. o cursor passa pelo contato (não repete no próximo pedido)", (await listar(DONO, cursor3)).length === 0);
  await como(usuario(DONO), "update public.contacts set updated_by = $2, deleted_at = now() where organization_id = $1 and phone = $3", [org, DONO, CENA[4].contato]);
  const delta3 = await listar(DONO, cursor3);
  confere("2. contato apagado: a conversa chega sem contato", delta3.length === 1 && delta3[0].contact_id === null && delta3[0].contact_phone === CENA[4].conv);
  const cursor4 = new Date(Math.max(...delta3.map((d) => +d.changed_at)));
  confere("2. e não repete", (await listar(DONO, cursor4)).length === 0);
  confere("2. teto de linhas", (await listar(DONO, null, 2)).length === 2);

  const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATIONS[1]}`)));
  confere("110000: colar de novo passa", reaplicar === "", reaplicar);
}

// ================================================== 20261020120000
{
  const antes = await assinaturaDoBanco();
  const erro = await ensaiar(MIGRATIONS[2]);
  confere("120000 ensaio: termina no raise", /ensaio ok/.test(erro), erro);
  confere("120000 ensaio: não deixa nada", (await assinaturaDoBanco()) === antes);
  await db.exec(ler(`supabase/migrations/${MIGRATIONS[2]}`));

  // Só tabela, nome e argumento: `gatilhosAntes` ganhou `sombra` e `colunas` para o roteiro.
  const retrato = (lista) => JSON.stringify(lista.map(({ tabela, tgname, args }) => ({ tabela, tgname, args })));
  const gatilhosDepois = retrato(await gatilhosDeRealtime());
  confere("3. os nove gatilhos continuam os mesmos", gatilhosDepois === retrato(gatilhosAntes), `${retrato(gatilhosAntes)} => ${gatilhosDepois}`);
  const realtimeDepois = await roteiroDeRealtime();
  confere("3. os nove geram os mesmos eventos (tópico, entity_id, silêncio no update sem mudança)",
    JSON.stringify(semEntityKey(realtimeDepois)) === JSON.stringify(semEntityKey(realtimeAntes)));
  const chaves = realtimeDepois.flatMap((t) => t.eventos.map((e) => [e.topic, e.entity_key]));
  confere("3. entity_key só no tópico conversas, com o contact_phone",
    chaves.every(([topico, chave]) => (topico === "conversas" ? chave === "5565900000001" : chave === null)) &&
      chaves.some(([topico]) => topico === "conversas"));
  const porTabela = realtimeDepois.map((t) => `${t.tabela.replace("public.", "")}:${t.eventos.length}`).join(" ");
  medidas.push(`eventos do roteiro por gatilho (insert, mudança, só carimbo, sem mudança, delete): ${porTabela}`);

  await sincronizar(lote()); // volta ao lote padrão (a seção 2 mexeu numa prévia)
  await db.exec("delete from public.portal_realtime_events");
  await sincronizar(lote());
  confere("3. lote sem mudança: nenhum aviso", (await um("select count(*)::int n from public.portal_realtime_events")).n === 0);
  const l = lote();
  l.conversations[3] = { ...l.conversations[3], unread: 3 };
  await sincronizar(l);
  const avisos = await todos("select topic, entity_id::text, entity_key from public.portal_realtime_events");
  confere("3. conversa que mudou: um aviso com a conexão e a conversa",
    avisos.length === 1 && avisos[0].entity_id === CONEXAO && avisos[0].entity_key === CENA[3].conv, JSON.stringify(avisos));

  const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATIONS[2]}`)));
  confere("120000: colar de novo passa", reaplicar === "", reaplicar);
}

// ================================================== 20261020130000
{
  await sincronizar(lote());
  const antesSemMudanca = await sincronizarContando(lote());
  confere("4. antes da 130000: o lote sem mudança regrava todas", antesSemMudanca.updates === CENA.length + 1, String(antesSemMudanca.updates));

  const antes = await assinaturaDoBanco();
  const erro = await ensaiar(MIGRATIONS[3]);
  confere("130000 ensaio: termina no raise", /ensaio ok/.test(erro), erro);
  confere("130000 ensaio: não deixa nada", (await assinaturaDoBanco()) === antes);
  await db.exec(ler(`supabase/migrations/${MIGRATIONS[3]}`));

  const semMudanca = await sincronizarContando(lote());
  confere("4. lote sem mudança: zero updates", semMudanca.updates === 0, String(semMudanca.updates));
  confere("4. o retorno tem o mesmo formato", JSON.stringify(Object.keys(semMudanca.r).sort()) === JSON.stringify(Object.keys(antesSemMudanca.r).sort()) && semMudanca.r.accepted === true);
  confere("4. e conta só as gravadas de fato", semMudanca.r.conversations === 0, String(semMudanca.r.conversations));

  for (const [campo, extra] of [
    ["prévia", { preview: "outra" }],
    ["dono", { owner: "ia" }],
    ["não lidas", { unread: 9 }],
    ["nome", { name: "Nome novo" }],
    ["atendente", { owner: "humano", attendantId: DONO, attendantName: "Dono" }],
    ["última mensagem", { lastMessageAt: new Date(agora).toISOString(), fromMe: true }],
  ]) {
    const l = lote();
    l.conversations[1] = { ...l.conversations[1], ...extra };
    const r = await sincronizarContando(l);
    const linha = await um("select last_message_preview, owner, unread_count, contact_name from public.whatsapp_conversations where contact_phone = $1", [CENA[1].conv]);
    confere(`4. muda ${campo}: um update, só nela`, r.updates === 1 && r.r.conversations === 1, `${r.updates}`);
    confere(`4. muda ${campo}: gravado`, !!linha);
    const volta = await sincronizarContando(lote());
    confere(`4. volta ${campo}: um update`, volta.updates === 1, `${volta.updates}`);
  }
  const grupoVazio = await sincronizarContando({ conversations: [conversa(GRUPO, { kind: "grupo", name: "" })], messages: [] });
  confere("4. grupo sem nome no lote: zero updates", grupoVazio.updates === 0, String(grupoVazio.updates));
  const nova = await sincronizarContando({ conversations: [conversa("5565955554444")], messages: [] });
  confere("4. conversa nova entra (insert, zero updates)", nova.updates === 0 && nova.r.conversations === 1);

  const foto = "https://pps.whatsapp.net/v/foto-1.jpg";
  const comFoto = () => ({ conversations: lote().conversations.map((c, i) => (i === 0 ? { ...c, photoUrl: foto } : c)), messages: [] });
  const primeiraFoto = await sincronizarContando(comFoto());
  confere("4. foto nova: um update", primeiraFoto.updates === 1, String(primeiraFoto.updates));
  const mesmaFoto = await sincronizarContando(comFoto());
  confere("4. a mesma foto: zero updates", mesmaFoto.updates === 0, String(mesmaFoto.updates));

  const reaplicar = await erroDe(() => db.exec(ler(`supabase/migrations/${MIGRATIONS[3]}`)));
  confere("130000: colar de novo passa", reaplicar === "", reaplicar);
}

// =================================== rollbacks fora de ordem, na ordem e de novo
{
  const foraDeOrdem = await erroDe(() => db.exec(ler(ROLLBACKS[0])));
  await db.exec("rollback").catch(() => {});
  confere("rollback 100000 antes do 110000: aborta", /desfazer antes 20261020110000/.test(foraDeOrdem), foraDeOrdem);

  const fn = async (nome) => (await um("select md5(replace(prosrc, chr(13), '')) m from pg_proc where oid = to_regprocedure($1)", [nome]))?.m || null;
  await db.exec(ler(ROLLBACKS[3]));
  confere("rollback 130000: a sincronia volta ao corpo de antes",
    (await fn("public.nucleo_conversation_sync_without_photos(jsonb)")) === "0e9b80f883c50fb5165ef35f6756d1ea" &&
      (await fn("public.nucleo_conversation_sync(jsonb)")) === "e596fbdd6af16bd1396eecf8d83aaeaa");
  confere("rollback 130000: e volta a regravar", (await sincronizarContando(lote())).updates === CENA.length + 1);
  await db.exec(ler(ROLLBACKS[2]));
  confere("rollback 120000: o aviso volta ao corpo de 20260926150000", (await fn("private.portal_realtime_notify()")) === "0657def6aa8b59bf17853baa21268cf8");
  confere("rollback 120000: a coluna sai", !(await um("select 1 x from information_schema.columns where table_name = 'portal_realtime_events' and column_name = 'entity_key'")));
  confere("rollback 120000: os nove eventos iguais aos de antes", JSON.stringify(await roteiroDeRealtime()) === JSON.stringify(realtimeAntes));
  await db.exec(ler(ROLLBACKS[1]));
  confere("rollback 110000: a lista sai", (await fn("public.nucleo_conversation_list(uuid, timestamptz, integer)")) === null);
  await db.exec(ler(ROLLBACKS[0]));
  confere("rollback 100000: as colunas saem",
    // Só as três tabelas desta leva: `deal_stage_history` já tinha `changed_at` (20260926170000).
    !(await um("select 1 x from information_schema.columns where table_schema = 'public' and column_name = 'changed_at' and table_name in ('whatsapp_conversations', 'whatsapp_messages', 'contacts')")));
  const depois = await erroDe(() => sincronizar(lote()));
  confere("rollback: a sincronia continua funcionando", depois === "", depois);

  for (const m of MIGRATIONS) {
    const e = await erroDe(() => db.exec(ler(`supabase/migrations/${m}`)));
    confere(`reaplicação: ${m.slice(0, 14)} passa`, e === "", e);
  }
  confere("reaplicação: zero updates de novo", (await sincronizarContando(lote())).updates === 0);
}

// ================================================== 5. medição
// O tamanho da Adriani: 461 conversas, 102 contatos, 3.225 mensagens; um terço
// dos contatos salvos na outra forma do nono dígito.
const CONEXAO_M = "eeeeeeee-0000-4000-8000-0000000000aa";
const ROBO_M = "dddddddd-0000-4000-8000-0000000000aa";
const DONO_M = "aaaaaaaa-0000-4000-8000-0000000000aa";
await db.exec(`insert into auth.users (id, email, email_confirmed_at) values
  ('${DONO_M}', 'medida@exemplo.invalido', now()), ('${ROBO_M}', 'robot+m@invalid.emyleads.local', now());`);
const orgM = await novaEmpresa("medida@exemplo.invalido", DONO_M, "Medida");
await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [CONEXAO_M, orgM]);
await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [CONEXAO_M, orgM, ROBO_M]);
const roboM = { sub: ROBO_M, role: "authenticated", app_metadata: { is_robot: "true", organization_id: orgM, connection_id: CONEXAO_M } };
const telM = (i) => `55659${String(80000000 + i)}`;
const loteM = (n) => ({
  conversations: Array.from({ length: n }, (_, i) => ({
    phone: telM(i), kind: "direto", name: `P${i}`, preview: `m${i}`, lastMessageAt: new Date(agora - i * 60_000).toISOString(),
    fromMe: i % 2 === 0, unread: i % 3, owner: "bot",
  })),
  messages: [],
});
const sincronizarM = async (payload) => {
  const t0 = performance.now();
  await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [ROBO_M, JSON.stringify(roboM)]);
    await tx.exec("set local role authenticated");
    for (let i = 0; i < payload.conversations.length; i += 450) {
      await tx.query("select public.nucleo_conversation_sync($1::jsonb)", [JSON.stringify({ conversations: payload.conversations.slice(i, i + 450), messages: [] })]);
    }
  });
  return performance.now() - t0;
};
const semear = async (n, contatos, mensagens) => {
  await sincronizarM(loteM(n));
  await db.query(
    `insert into public.contacts (organization_id, name, phone)
     select $1, 'C' || i, case when i % 3 = 0 then '55659' || (80000000 + i)::text else '5565' || (80000000 + i)::text end
     from generate_series(0, $2 - 1) i
     on conflict do nothing`,
    [orgM, contatos],
  );
  await db.query(
    `insert into public.whatsapp_messages (connection_id, organization_id, contact_phone, message_id, content, sent_at, is_from_me)
     select $1, $2, '55659' || (80000000 + (i % $4))::text, 'mm-' || i, 'texto', now() - (i || ' seconds')::interval, i % 2 = 0
     from generate_series(0, $3 - 1) i on conflict do nothing`,
    [CONEXAO_M, orgM, mensagens, n],
  );
  await db.exec("analyze public.whatsapp_conversations; analyze public.contacts; analyze public.whatsapp_messages;");
};

// As duas consultas da RPC, tiradas do texto da migration (o mesmo corpo).
const corpoRpc = (() => {
  const t = ler(`supabase/migrations/${MIGRATIONS[1]}`);
  const i = t.indexOf("create or replace function public.nucleo_conversation_list");
  const a = t.indexOf("$$", i) + 2;
  const corpo = t.slice(a, t.indexOf("$$;", a));
  const blocos = corpo.split("return query").slice(1).map((b) => b.slice(0, b.indexOf(";")));
  const trocar = (q) => q.replace(/target_organization/g, "$1::uuid").replace(/changed_since/g, "$2::timestamptz").replace(/\bteto\b/g, "$3::int");
  // Sem cursor não há `changed_since`: o teto vira o segundo parâmetro.
  const semCursor = blocos[0].replace(/target_organization/g, "$1::uuid").replace(/\bteto\b/g, "$2::int");
  return { semCursor, comCursor: trocar(blocos[1]) };
})();
// Como a dona da função: a lista é `security definer`, então as consultas
// dela rodam sem a RLS (a conferência de membro fica na entrada).
const explicar = async (sql, params) => {
  const plano = (await db.query(`explain (analyze, buffers, format json) ${sql}`, params)).rows[0]["QUERY PLAN"][0];
  const nos = [];
  const andar = (n) => { nos.push(n); (n.Plans || []).forEach(andar); };
  andar(plano.Plan);
  const seq = nos.filter((n) => n["Node Type"] === "Seq Scan").map((n) => n["Relation Name"]);
  const idx = [...new Set(nos.filter((n) => /Index/.test(n["Node Type"])).map((n) => n["Index Name"]).filter(Boolean))];
  const buffers = (plano.Plan["Shared Hit Blocks"] || 0) + (plano.Plan["Shared Read Blocks"] || 0);
  return { ms: plano["Execution Time"], linhas: plano.Plan["Actual Rows"], seq, idx, buffers };
};
const medir = async (rotulo, n, contatos, mensagens) => {
  await semear(n, contatos, mensagens);
  const total = (await um("select count(*)::int n from public.whatsapp_conversations where organization_id = $1", [orgM])).n;
  const semCursor = await explicar(corpoRpc.semCursor, [orgM, 5000]);
  // O regime normal do portal: um cursor, e 5 conversas mudaram depois dele.
  const desde = (await um("select clock_timestamp() t")).t;
  await db.query("update public.whatsapp_conversations set unread_count = unread_count + 1 where organization_id = $1 and contact_phone in (select contact_phone from public.whatsapp_conversations where organization_id = $1 order by contact_phone limit 5)", [orgM]);
  const comCursor = await explicar(corpoRpc.comCursor, [orgM, desde, 1000]);
  const msgs = await explicar(
    "select message_id from public.whatsapp_messages where organization_id = $1 and connection_id = $2 and contact_phone = $3 and changed_at > $4",
    [orgM, CONEXAO_M, telM(0), desde],
  );
  const sync = await sincronizarM(loteM(n));
  const upd = await db.transaction(async (tx) => {
    const antes = await updatesDasConversas(tx);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [ROBO_M, JSON.stringify(roboM)]);
    await tx.exec("set local role authenticated");
    for (let i = 0; i < n; i += 450) await tx.query("select public.nucleo_conversation_sync($1::jsonb)", [JSON.stringify({ conversations: loteM(n).conversations.slice(i, i + 450), messages: [] })]);
    await tx.exec("reset role");
    return (await updatesDasConversas(tx)) - antes;
  });
  medidas.push(
    `${rotulo} (${total} conversas, ${contatos} contatos, ${mensagens} mensagens):\n` +
    `  lista sem cursor: ${semCursor.linhas} linhas, ${semCursor.ms.toFixed(2)} ms, ${semCursor.buffers} buffers, seq scan: ${semCursor.seq.join(",") || "nenhum"}, índices: ${semCursor.idx.join(",")}\n` +
    `  lista com cursor (5 mudadas): ${comCursor.linhas} linhas, ${comCursor.ms.toFixed(2)} ms, ${comCursor.buffers} buffers, seq scan: ${comCursor.seq.join(",") || "nenhum"}, índices: ${comCursor.idx.join(",")}\n` +
    `  mensagens da conversa aberta com cursor: ${msgs.linhas} linhas, ${msgs.ms.toFixed(2)} ms, seq scan: ${msgs.seq.join(",") || "nenhum"}, índices: ${msgs.idx.join(",")}\n` +
    `  sincronia do lote inteiro sem mudança: ${sync.toFixed(0)} ms, ${upd} updates`,
  );
  return { semCursor, comCursor, msgs, upd };
};
const adriani = await medir("tamanho da Adriani", 461, 102, 3225);
confere("5. Adriani: lista com cursor devolve só as 5", adriani.comCursor.linhas === 5, String(adriani.comCursor.linhas));
// Com 102 contatos a tabela cabe em 2 blocos e o planejador lê inteira, com
// razão; o que importa no tamanho da Adriani é ler pouco. "Sem seq scan" é
// conferido no tamanho de 10 mil, onde ele faria diferença.
confere("5. Adriani: lista com cursor lê menos de 100 blocos", adriani.comCursor.buffers < 100, String(adriani.comCursor.buffers));
confere("5. Adriani: lote sem mudança, zero updates", adriani.upd === 0, String(adriani.upd));
const grande = await medir("10 mil conversas", 10000, 20000, 50000);
confere("5. 10 mil: lista com cursor usa o índice de changed_at", grande.comCursor.idx.includes("whatsapp_conversations_changed_idx"), grande.comCursor.idx.join(","));
confere("5. 10 mil: lista com cursor sem seq scan", grande.comCursor.seq.length === 0, grande.comCursor.seq.join(","));
confere("5. 10 mil: mensagens com cursor por índice, sem seq scan", grande.msgs.idx.length > 0 && grande.msgs.seq.length === 0, grande.msgs.idx.join(","));

console.log(passou.map((p) => `PASS ${p}`).join("\n"));
console.log("\nMEDIDAS (PGlite, Postgres 17 em WASM; número absoluto não é o de produção, a forma do plano é)\n" + medidas.join("\n"));
if (falhas.length) {
  console.log(falhas.map((f) => `FALHA ${f}`).join("\n"));
  console.log(`\n${passou.length} conferências, ${falhas.length} falhas`);
  process.exit(1);
}
console.log(`\n${passou.length} conferências, 0 falhas`);
