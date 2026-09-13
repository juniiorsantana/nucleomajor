// Prova comportamental da migration 20260913230000 num Postgres embutido (PGlite).
// Nada aqui toca produção: banco em memória, criado e destruído neste processo.
//
// PGlite não é dependência do projeto, de propósito. Para rodar:
//
//   mkdir /tmp/prova && cd /tmp/prova && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql/prova-o-nome-de-quem-escreveu.mjs . && node prova-o-nome-de-quem-escreveu.mjs <repo>
//
// O que esta prova existe para responder, e que a leitura do SQL não responde:
//
//   * o `do update` novo preenche autoria vazia E NÃO sobrescreve autoria que
//     já está gravada — nem com outro nome, nem (principalmente) com vazio. É
//     o coração da migration: a corrida entre o Bridge e a anotação do runtime
//     depende disso para não virar perda permanente;
//   * o conteúdo da mensagem continua IMUTÁVEL depois de gravado. O `do update`
//     tinha de ser o mais estreito possível, e "estreito" é uma afirmação que
//     só um teste sustenta;
//   * o reoferecimento de uma mensagem que não ganhou nada não escreve linha
//     nenhuma (o `where` do fim) — sem isso, o gatilho de realtime acordaria a
//     cada ciclo, que é o defeito que 11/09 passou a semana consertando;
//   * o `enqueue` põe no payload o nome de quem chamou, resolvido do
//     `auth.uid()`, e ignora qualquer nome que o navegador tente mandar.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-o-nome-de-quem-escreveu.mjs <caminho do repo>");
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const migration = ler("supabase/migrations/20260913230000_o_nome_de_quem_escreveu.sql");

const ORG = "11111111-1111-4111-8111-111111111111";
const CONEXAO = "33333333-3333-4333-8333-333333333333";
const MEMBRO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROBO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHAT = "5565999990001";

const db = new PGlite();
const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") =>
  (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);

// O mínimo do mundo em que a migration roda. As tabelas têm só as colunas que
// a sincronia e o enqueue tocam: o resto não muda o que está sendo provado.
await db.exec(`
  create schema auth;
  create schema private;
  create schema extensions;
  create role anon nologin;
  create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function extensions.digest(text, text) returns bytea language sql immutable as
    $$ select decode(md5($1), 'hex') $$;

  create table public.organizations (id uuid primary key);
  create table public.profiles (
    id uuid primary key, display_name text, full_name text
  );
  create table public.organization_members (
    organization_id uuid not null, user_id uuid not null, status text not null default 'active'
  );
  create table public.whatsapp_connections (
    id uuid not null, organization_id uuid not null,
    status text not null default 'active', revoked_at timestamptz,
    primary key (id), unique (id, organization_id)
  );
  create table public.connection_robot_credentials (
    auth_user_id uuid not null, organization_id uuid not null, connection_id uuid not null,
    status text not null default 'active', revoked_at timestamptz, last_used_at timestamptz
  );
  create table public.whatsapp_conversations (
    connection_id uuid not null, organization_id uuid not null,
    contact_phone text not null, chat_kind text not null default 'direto',
    contact_name text not null default '', last_message_preview text not null default '',
    last_message_at timestamptz, last_message_from_me boolean not null default false,
    unread_count integer not null default 0, owner text not null default 'bot',
    attendant_id uuid, attendant_name text not null default '',
    updated_at timestamptz not null default now(),
    primary key (connection_id, contact_phone)
  );
  create table public.whatsapp_messages (
    connection_id uuid not null, organization_id uuid not null,
    contact_phone text not null, message_id text not null,
    content text not null default '', sent_at timestamptz not null,
    is_from_me boolean not null default false,
    media_type text not null default '', media_filename text not null default '',
    created_at timestamptz not null default now(),
    primary key (connection_id, contact_phone, message_id)
  );
  create table public.connection_runtime_commands (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null, connection_id uuid not null,
    command_type text not null, private_payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending', created_by uuid,
    idempotency_key text not null, available_at timestamptz not null default now(),
    expires_at timestamptz, error_code text, updated_at timestamptz not null default now(),
    unique (organization_id, idempotency_key)
  );

  create function private.is_org_member(target_organization uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.organization_members m
      where m.organization_id = target_organization and m.user_id = auth.uid()
        and m.status = 'active');
  $$;
  create function private.robot_organization() returns uuid
  language sql stable security definer set search_path = '' as $$
    select c.organization_id from public.connection_robot_credentials c
    where c.auth_user_id = auth.uid() and c.status = 'active' and c.revoked_at is null
    limit 1;
  $$;
  create function private.conexao_da_organizacao(alvo uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
    select id from public.whatsapp_connections where organization_id = alvo limit 1;
  $$;

  -- O invólucro das fotos, reduzido ao que a guarda da migration exige: chamar
  -- o corpo. É isto que a migration não pode ter apagado.
  create function public.nucleo_conversation_sync_without_photos(sync_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $f$
  begin return jsonb_build_object('accepted', true); end; $f$;
  create function public.nucleo_conversation_sync(sync_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $f$
  declare resultado jsonb;
  begin
    resultado := public.nucleo_conversation_sync_without_photos(sync_payload);
    return resultado;
  end; $f$;

  insert into public.organizations values ('${ORG}');
  insert into public.profiles (id, display_name, full_name)
    values ('${MEMBRO}', 'Marina', 'Marina Souza'), ('${ROBO}', null, null);
  insert into public.organization_members (organization_id, user_id)
    values ('${ORG}', '${MEMBRO}'), ('${ORG}', '${ROBO}');
  insert into public.whatsapp_connections (id, organization_id) values ('${CONEXAO}', '${ORG}');
  insert into public.connection_robot_credentials (auth_user_id, organization_id, connection_id)
    values ('${ROBO}', '${ORG}', '${CONEXAO}');
  insert into public.whatsapp_conversations (connection_id, organization_id, contact_phone, last_message_at)
    values ('${CONEXAO}', '${ORG}', '${CHAT}', now());
`);

// ------------------------------------------------------------- a migration

try {
  await db.exec(migration);
  confere("A. a migration aplica inteira", true);
} catch (erro) {
  confere("A. a migration aplica inteira", false, erro.message);
  console.log(`\nFAIL 1 / PASS 0\n  ✗ ${falhas[0]}`);
  process.exit(1);
}

const como = async (usuario) =>
  db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario || ""]);
const sincroniza = async (mensagens) => {
  await como(ROBO);
  const r = await db.query(
    `select public.nucleo_conversation_sync_without_photos($1::jsonb) as r`,
    [JSON.stringify({ conversations: [], messages: mensagens })],
  );
  return r.rows[0].r;
};
const linha = async (id) =>
  (await db.query(
    `select content, author_kind, author_name, author_id from public.whatsapp_messages
     where message_id = $1`, [id],
  )).rows[0];

const msg = (id, extra = {}) => ({
  phone: CHAT, id, content: "Oi! Tudo bem?", sentAt: new Date().toISOString(),
  fromMe: true, mediaType: "", mediaFilename: "", ...extra,
});

// B. a coluna existe e o invólucro das fotos sobreviveu
confere(
  "B. as tres colunas de autoria existem",
  (await db.query(`select column_name from information_schema.columns
    where table_name = 'whatsapp_messages'
      and column_name in ('author_kind','author_name','author_id')`)).rows.length === 3,
);
confere(
  "C. o involucro das fotos continua chamando o corpo",
  (await db.query(`select prosrc from pg_proc where proname = 'nucleo_conversation_sync'`))
    .rows[0].prosrc.includes("nucleo_conversation_sync_without_photos"),
);

// D. a autoria sobe junto com a mensagem
await sincroniza([msg("m1", { authorKind: "ia", authorName: "Bia", authorId: AGENTE })]);
let l = await linha("m1");
confere("D. mensagem nova grava a autoria",
  l.author_kind === "ia" && l.author_name === "Bia" && l.author_id === AGENTE,
  JSON.stringify(l));

// E. mensagem sem autoria fica vazia — e isso é resposta, não erro
await sincroniza([msg("m2", { content: "bom dia" })]);
l = await linha("m2");
confere("E. saida sem anotacao fica sem autor", l.author_kind === "" && l.author_name === "",
  JSON.stringify(l));

// F. o reparo preenche o que estava vazio — a corrida de milissegundos
const antes = await sincroniza([msg("m3", { content: "já te respondo" })]);
const reparo = await sincroniza([
  msg("m3", { content: "já te respondo", authorKind: "humano", authorName: "Marina", authorId: MEMBRO }),
]);
l = await linha("m3");
confere("F. o reparo preenche autoria que estava vazia",
  l.author_kind === "humano" && l.author_name === "Marina" && l.author_id === MEMBRO,
  JSON.stringify(l));
confere("F2. e o reparo conta como escrita", Number(reparo.messages) === 1,
  `antes=${antes.messages} reparo=${reparo.messages}`);

// G. autoria gravada NÃO é sobrescrita — nem por outro nome, nem por vazio
await sincroniza([msg("m3", { content: "já te respondo", authorKind: "ia", authorName: "Bia", authorId: AGENTE })]);
l = await linha("m3");
confere("G. autoria gravada nao e trocada por outra", l.author_name === "Marina", JSON.stringify(l));
await sincroniza([msg("m3", { content: "já te respondo" })]);
l = await linha("m3");
confere("G2. autoria gravada nao e apagada por vazio", l.author_name === "Marina", JSON.stringify(l));

// H. o conteúdo continua imutável — o do update é só de autoria
await sincroniza([msg("m1", { content: "TEXTO TROCADO", authorKind: "ia", authorName: "Bia" })]);
l = await linha("m1");
confere("H. o conteudo da mensagem nao e reescrito", l.content === "Oi! Tudo bem?", l.content);

// I. reoferecer sem novidade não escreve linha nenhuma (o `where` do fim)
const repetido = await sincroniza([
  msg("m3", { content: "já te respondo", authorKind: "humano", authorName: "Marina", authorId: MEMBRO }),
]);
confere("I. reoferecer sem novidade nao escreve", Number(repetido.messages) === 0,
  `messages=${repetido.messages}`);

// J. tipo desconhecido vira vazio em vez de derrubar o lote
const estranho = await sincroniza([msg("m4", { authorKind: "extraterrestre", authorName: "X" })]);
l = await linha("m4");
confere("J. tipo desconhecido vira vazio e o lote passa",
  Number(estranho.messages) === 1 && l.author_kind === "", JSON.stringify(l));

// K. id fora de formato é descartado, não derruba o lote
const idRuim = await sincroniza([msg("m5", { authorKind: "ia", authorName: "Bia", authorId: "nao-e-uuid" })]);
l = await linha("m5");
confere("K. authorId fora de formato e descartado sem derrubar o lote",
  Number(idRuim.messages) === 1 && l.author_id === null && l.author_name === "Bia",
  JSON.stringify(l));

// L. o contato entra como contato
await sincroniza([msg("m6", { fromMe: false, content: "e o meu pedido?", authorKind: "contato" })]);
l = await linha("m6");
confere("L. a mensagem do contato entra como contato", l.author_kind === "contato", JSON.stringify(l));

// ------------------------------------------------------- o enqueue assina

const enfileira = async (usuario, carga) => {
  await como(usuario);
  const r = await db.query(
    `select public.nucleo_conversation_command_enqueue($1, $2, $3, 'conversation_send', $4::jsonb) as r`,
    [ORG, CONEXAO, CHAT, JSON.stringify(carga)],
  );
  return r.rows[0].r;
};
const cargaDe = async (comandoId) =>
  (await db.query(`select private_payload from public.connection_runtime_commands where id = $1`,
    [comandoId])).rows[0].private_payload;

const cmd = await enfileira(MEMBRO, { clientId: crypto.randomUUID(), text: "Bom dia!" });
let carga = await cargaDe(cmd.commandId);
confere("M. o enqueue poe o nome curto de quem chamou",
  carga.authorName === "Marina" && carga.authorId === MEMBRO, JSON.stringify(carga));
confere("M2. e nao perde nada do que ja mandava",
  carga.text === "Bom dia!" && carga.chat === CHAT && carga.kind === "direto", JSON.stringify(carga));

// N. o nome que o navegador tentar mandar é ignorado
const cmd2 = await enfileira(MEMBRO, {
  clientId: crypto.randomUUID(), text: "Bom dia!", authorName: "Júnior", authorId: AGENTE,
});
carga = await cargaDe(cmd2.commandId);
confere("N. nome vindo do navegador e ignorado",
  carga.authorName === "Marina" && carga.authorId === MEMBRO, JSON.stringify(carga));

// O. perfil sem nome nenhum devolve vazio, e o envio continua valendo
await db.exec(`update public.profiles set display_name = null, full_name = null where id = '${MEMBRO}'`);
const cmd3 = await enfileira(MEMBRO, { clientId: crypto.randomUUID(), text: "Sem nome" });
carga = await cargaDe(cmd3.commandId);
confere("O. perfil sem nome nao impede o envio",
  carga.authorName === "" && carga.text === "Sem nome", JSON.stringify(carga));

// ----------------------------------------------------------------- placar

console.log(`\nPASS ${passou.length} / FAIL ${falhas.length}\n`);
for (const nome of passou) console.log(`  ✓ ${nome}`);
for (const nome of falhas) console.log(`  ✗ ${nome}`);
process.exit(falhas.length ? 1 : 0);
