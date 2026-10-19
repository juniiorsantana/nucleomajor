-- A conversa, a mensagem e o contato guardam quando mudaram de verdade.
--
-- O portal relê a lista inteira de conversas a cada 20 s, a cada aviso de
-- realtime e a cada conversa aberta (plano da escala das Conversas, 19/10/2026).
-- Para buscar só o que mudou falta uma coluna que diga "mudou depois de X", e
-- nenhuma das que existem serve:
--
--   * `whatsapp_conversations.updated_at` é regravado pela sincronia da VPS a
--     cada 15 s em todas as conversas do lote, mudando ou não (20260926140000).
--   * `whatsapp_messages` não tem coluna de alteração, e a mensagem muda depois
--     de chegar: o arquivo da mídia, a autoria e a transcrição chegam depois.
--   * `contacts.updated_at` não anda num update: `private.touch_versioned_record`
--     faz `coalesce(new.updated_at, now())`, e o `new` de um update já traz o
--     valor velho. Conferido em produção em 19/10/2026: 63 dos 102 contatos
--     foram editados (`version > 1`) e nenhum tem `updated_at > created_at`.
--     Trocar a função mexeria em todas as tabelas versionadas; aqui o contato
--     ganha a sua própria coluna, como as outras duas.
--
-- Por isso as três tabelas ganham `changed_at`, mantida por um gatilho
-- `before update` que compara a linha nova com a velha sem as colunas de
-- carimbo: se só o carimbo mudou, `changed_at` fica como estava; se mudou
-- qualquer outra coisa, anda para `clock_timestamp()`. No insert vale o
-- default `clock_timestamp()`. Nada muda na VPS: ela continua mandando o que
-- manda, e o banco decide o que é mudança.
--
-- O gatilho tem que ser o ÚLTIMO `before update` da tabela, para comparar o
-- que vai ser gravado de fato (o Postgres dispara os do mesmo momento em ordem
-- alfabética). Nas conversas, `preservar_nome_grupo` desfaz o nome vazio de
-- grupo; nos contatos, `touch_versioned_record` sobe `version` e
-- `contact_lead_mark` mexe em `lead_at`. Daí o `zz_` no nome.
--
-- Preenchimento: as conversas e os contatos nascem com o instante da
-- migration (`add column ... default now()`, sem reescrever a tabela e sem
-- acordar gatilho nenhum: um update nas 463 conversas viraria 463 avisos de
-- realtime para cada portal aberto). Nas conversas isso é o mesmo que
-- `updated_at`, que a sincronia regrava a cada 15 s. As mensagens recebem o
-- `created_at` (sem gatilho de realtime nelas).
--
-- Índices para o delta: `(organization_id, changed_at)` nas conversas e nos
-- contatos, `(organization_id, connection_id, contact_phone, changed_at)` nas
-- mensagens. O update sem mudança continua HOT: `changed_at` não muda nele.
--
-- Ensaio no SQL Editor: colar inteira trocando o `commit;` final por
--   do $$ begin raise exception 'ensaio ok'; end $$;
-- Prova: supabase/provas/prova-escala-banco.mjs. Conferência:
-- supabase/provas/conferir-escala-banco.sql. Desfazer:
-- supabase/provas/rollback-20261020100000-conversas-mudaram-em.sql.

begin;

-- ------------------------------------------------------------- 1. o gatilho

-- Genérico: ignora `changed_at` e as colunas passadas como argumento.
create or replace function private.marcar_mudou_em()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ignorar text[] := array['changed_at'] || coalesce(tg_argv::text[], '{}'::text[]);
begin
  if (pg_catalog.to_jsonb(new) - ignorar) = (pg_catalog.to_jsonb(old) - ignorar) then
    new.changed_at := old.changed_at;
  else
    new.changed_at := pg_catalog.clock_timestamp();
  end if;
  return new;
end;
$$;

comment on function private.marcar_mudou_em() is
  'Gatilho before update: changed_at só anda quando muda alguma coluna além dela e das passadas em tg_argv. Ver 20261020100000.';

revoke all on function private.marcar_mudou_em() from public, anon;

-- ------------------------------------------------------------- 2. as colunas

alter table public.whatsapp_conversations
  add column if not exists changed_at timestamptz not null default now();
alter table public.whatsapp_conversations
  alter column changed_at set default pg_catalog.clock_timestamp();

alter table public.contacts
  add column if not exists changed_at timestamptz not null default now();
alter table public.contacts
  alter column changed_at set default pg_catalog.clock_timestamp();

alter table public.whatsapp_messages
  add column if not exists changed_at timestamptz not null default now();
-- Antes do gatilho existir: este update não é mudança de conteúdo.
update public.whatsapp_messages
set changed_at = created_at
where changed_at > created_at;
alter table public.whatsapp_messages
  alter column changed_at set default pg_catalog.clock_timestamp();

comment on column public.whatsapp_conversations.changed_at is
  'Quando a conversa mudou de verdade (não anda com a regravação da sincronia). Cursor do delta do portal. Ver 20261020100000.';
comment on column public.whatsapp_messages.changed_at is
  'Quando a mensagem chegou ou mudou (mídia, autoria, transcrição). Cursor do delta do portal. Ver 20261020100000.';
comment on column public.contacts.changed_at is
  'Quando o contato mudou de verdade (updated_at não anda em update). Usado pela lista de conversas. Ver 20261020100000.';

create or replace trigger whatsapp_conversations_zz_mudou_em
before update on public.whatsapp_conversations
for each row execute function private.marcar_mudou_em('updated_at');

create or replace trigger whatsapp_messages_zz_mudou_em
before update on public.whatsapp_messages
for each row execute function private.marcar_mudou_em();

create or replace trigger contacts_zz_mudou_em
before update on public.contacts
for each row execute function private.marcar_mudou_em('updated_at', 'version', 'updated_by');

-- ------------------------------------------------------------- 3. os índices

create index if not exists whatsapp_conversations_changed_idx
  on public.whatsapp_conversations (organization_id, changed_at);
create index if not exists whatsapp_messages_changed_idx
  on public.whatsapp_messages (organization_id, connection_id, contact_phone, changed_at);
create index if not exists contacts_changed_idx
  on public.contacts (organization_id, changed_at);

-- ------------------------------------------------------------- 4. confere

do $$
declare
  faltando text;
begin
  select pg_catalog.string_agg(alvo.nome, ', ') into faltando
  from (values
    ('whatsapp_conversations_zz_mudou_em'), ('whatsapp_messages_zz_mudou_em'), ('contacts_zz_mudou_em')
  ) as alvo(nome)
  where not exists (select 1 from pg_catalog.pg_trigger t where t.tgname = alvo.nome and not t.tgisinternal);
  if faltando is not null then
    raise exception 'abortado: gatilho faltando: %', faltando;
  end if;

  select pg_catalog.string_agg(alvo.nome, ', ') into faltando
  from (values
    ('whatsapp_conversations_changed_idx'), ('whatsapp_messages_changed_idx'), ('contacts_changed_idx')
  ) as alvo(nome)
  where pg_catalog.to_regclass('public.' || alvo.nome) is null;
  if faltando is not null then
    raise exception 'abortado: índice faltando: %', faltando;
  end if;

  if exists (select 1 from public.whatsapp_messages m where m.changed_at < m.created_at) then
    raise exception 'abortado: mensagem com changed_at antes de created_at';
  end if;
end;
$$;

commit;
