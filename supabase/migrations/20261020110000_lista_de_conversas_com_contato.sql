-- A lista de conversas vem pronta do banco, com o contato do CRM, e só o que
-- mudou.
--
-- Hoje o portal baixa todas as conversas e TODOS os contatos da empresa a cada
-- recarga e casa um com o outro na memória, pelo telefone, com `variantesBR`
-- (`apps/emyleads/src/lib/phone.js`): o celular brasileiro pode viver no
-- WhatsApp com ou sem o nono dígito, e o contato casa por qualquer das formas.
--
-- Três peças:
--
--   1. `private.br_phone_normalize(text)`: o `normalizePhone` do portal, linha
--      por linha (só dígitos, sem zeros à esquerda, 55 na frente de 10 ou 11
--      dígitos, nulo fora de 11 a 15 dígitos).
--   2. `private.br_phone_key(text)`: UMA chave por pessoa. Dois telefones têm
--      a mesma chave se e só se `variantesBR` dos dois tem alguma forma em
--      comum: celular brasileiro de 9 dígitos começando com 9 perde o 9; o
--      resto fica como está. A equivalência é provada pela tabela
--      `supabase/provas/casos-telefone-br.json`, lida pelo teste JS
--      (`test/casos-telefone-br.test.mjs`, contra `variantesBR`) e pela prova
--      SQL (`supabase/provas/prova-escala-banco.mjs`, contra esta função).
--      Índices de expressão em `contacts` e em `whatsapp_conversations`.
--   3. `public.nucleo_conversation_list(target_organization, changed_since,
--      max_rows)`: `security invoker` (a RLS de hoje decide), devolve as
--      colunas que o portal lê da conversa, `changed_at` e o contato casado
--      (`contact_id`, `crm_name`, `crm_company`, `crm_job_title`,
--      `crm_avatar_path`). Grupo não casa contato.
--
-- Com `changed_since`, volta a conversa que mudou OU cujo contato mudou
-- (`contacts.changed_at`, de 20261020100000; `contacts.updated_at` não anda
-- num update). O `changed_at` devolvido é o maior entre o da conversa e o dos
-- contatos com a mesma chave, apagados inclusive: assim o cursor do portal
-- (`max(changed_at) - 5 s`) passa pelo contato renomeado e não o recebe de
-- novo a cada pedido. Ordem: `changed_at` crescente com `changed_since`;
-- `last_message_at desc nulls last` sem ele.
--
-- Mais de um contato com a mesma chave (o mesmo número salvo com e sem o 9):
-- ganha o que tem o telefone igual ao da conversa, depois o mais antigo. O
-- portal de hoje fica com o primeiro que a consulta devolveu, que não tem
-- ordem; a tabela de casos prova que o CONJUNTO de candidatos é o mesmo.
--
-- Ensaio no SQL Editor: colar inteira trocando o `commit;` final por
--   do $$ begin raise exception 'ensaio ok'; end $$;
-- Prova: supabase/provas/prova-escala-banco.mjs. Conferência:
-- supabase/provas/conferir-escala-banco.sql. Desfazer:
-- supabase/provas/rollback-20261020110000-lista-de-conversas-com-contato.sql.

begin;

-- Pré-requisito: as colunas de 20261020100000.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.whatsapp_conversations'::regclass and attname = 'changed_at' and not attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.contacts'::regclass and attname = 'changed_at' and not attisdropped
  ) then
    raise exception 'abortado: aplicar antes 20261020100000_conversas_mudaram_em.sql';
  end if;
end;
$$;

-- ------------------------------------------------- 1. o telefone canônico

-- Espelho de `normalizePhone`. Lá: `55` + 12/13 dígitos volta; 11 a 15 dígitos
-- volta; o resto é nulo. O primeiro caso está contido no segundo.
create or replace function private.br_phone_normalize(raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.length(com_ddi.d) between 11 and 15 then com_ddi.d
  end
  from (
    select case
      when pg_catalog.length(digitos.d) in (10, 11) then '55' || digitos.d
      else digitos.d
    end as d
    from (
      select pg_catalog.ltrim(
        pg_catalog.regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g'), '0'
      ) as d
    ) digitos
  ) com_ddi;
$$;

-- ------------------------------------------------- 2. a chave da pessoa

create or replace function private.br_phone_key(raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when n.p like '55%'
      and pg_catalog.length(n.p) = 13
      and pg_catalog.substr(n.p, 5, 1) = '9'
    then pg_catalog.substr(n.p, 1, 4) || pg_catalog.substr(n.p, 6)
    else n.p
  end
  from (select private.br_phone_normalize(raw) as p) n;
$$;

comment on function private.br_phone_normalize(text) is
  'Espelho de normalizePhone (apps/emyleads/src/lib/phone.js). Ver 20261020110000.';
comment on function private.br_phone_key(text) is
  'Mesma chave se e só se variantesBR dos dois telefones se cruzam (nono dígito). Prova: supabase/provas/casos-telefone-br.json. Ver 20261020110000.';

-- A RPC é `security invoker`: quem chama precisa executar as duas.
revoke all on function private.br_phone_normalize(text) from public, anon;
revoke all on function private.br_phone_key(text) from public, anon;
grant execute on function private.br_phone_normalize(text) to authenticated, service_role;
grant execute on function private.br_phone_key(text) to authenticated, service_role;

create index if not exists contacts_phone_key_idx
  on public.contacts (organization_id, private.br_phone_key(phone));
create index if not exists whatsapp_conversations_phone_key_idx
  on public.whatsapp_conversations (organization_id, private.br_phone_key(contact_phone));

-- ------------------------------------------------- 3. a lista

create or replace function public.nucleo_conversation_list(
  target_organization uuid,
  changed_since timestamptz default null,
  max_rows integer default 1000
)
returns table (
  connection_id uuid,
  contact_phone text,
  chat_kind text,
  contact_name text,
  contact_photo_url text,
  last_message_preview text,
  last_message_at timestamptz,
  last_message_from_me boolean,
  unread_count integer,
  owner text,
  attendant_id uuid,
  attendant_name text,
  changed_at timestamptz,
  contact_id uuid,
  crm_name text,
  crm_company text,
  crm_job_title text,
  crm_avatar_path text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  teto integer := least(greatest(coalesce(max_rows, 1000), 1), 5000);
begin
  if target_organization is null then
    return;
  end if;

  if changed_since is null then
    return query
    select
      c.connection_id, c.contact_phone, c.chat_kind, c.contact_name, c.contact_photo_url,
      c.last_message_preview, c.last_message_at, c.last_message_from_me,
      c.unread_count, c.owner, c.attendant_id, c.attendant_name,
      greatest(c.changed_at, mudanca.contato_em),
      contato.id, contato.name, contato.company, contato.job_title, contato.avatar_path
    from public.whatsapp_conversations c
    left join lateral (
      select k.id, k.name, k.company, k.job_title, k.avatar_path
      from public.contacts k
      where c.chat_kind <> 'grupo'
        and k.organization_id = c.organization_id
        and private.br_phone_key(k.phone) = private.br_phone_key(c.contact_phone)
        and k.deleted_at is null
      order by (private.br_phone_normalize(k.phone) = private.br_phone_normalize(c.contact_phone)) desc,
        k.created_at, k.id
      limit 1
    ) contato on true
    left join lateral (
      select pg_catalog.max(k.changed_at) as contato_em
      from public.contacts k
      where c.chat_kind <> 'grupo'
        and k.organization_id = c.organization_id
        and private.br_phone_key(k.phone) = private.br_phone_key(c.contact_phone)
    ) mudanca on true
    where c.organization_id = target_organization
    order by c.last_message_at desc nulls last, c.connection_id, c.contact_phone
    limit teto;
    return;
  end if;

  return query
  with mudadas as (
    select c.connection_id, c.contact_phone
    from public.whatsapp_conversations c
    where c.organization_id = target_organization
      and c.changed_at > changed_since
    union
    select c.connection_id, c.contact_phone
    from public.contacts k
    join public.whatsapp_conversations c
      on c.organization_id = k.organization_id
     and private.br_phone_key(c.contact_phone) = private.br_phone_key(k.phone)
     and c.chat_kind <> 'grupo'
    where k.organization_id = target_organization
      and k.changed_at > changed_since
  )
  select
    c.connection_id, c.contact_phone, c.chat_kind, c.contact_name, c.contact_photo_url,
    c.last_message_preview, c.last_message_at, c.last_message_from_me,
    c.unread_count, c.owner, c.attendant_id, c.attendant_name,
    greatest(c.changed_at, mudanca.contato_em) as mudou_em,
    contato.id, contato.name, contato.company, contato.job_title, contato.avatar_path
  from mudadas
  join public.whatsapp_conversations c
    on c.connection_id = mudadas.connection_id
   and c.contact_phone = mudadas.contact_phone
  left join lateral (
    select k.id, k.name, k.company, k.job_title, k.avatar_path
    from public.contacts k
    where c.chat_kind <> 'grupo'
      and k.organization_id = c.organization_id
      and private.br_phone_key(k.phone) = private.br_phone_key(c.contact_phone)
      and k.deleted_at is null
    order by (private.br_phone_normalize(k.phone) = private.br_phone_normalize(c.contact_phone)) desc,
      k.created_at, k.id
    limit 1
  ) contato on true
  left join lateral (
    select pg_catalog.max(k.changed_at) as contato_em
    from public.contacts k
    where c.chat_kind <> 'grupo'
      and k.organization_id = c.organization_id
      and private.br_phone_key(k.phone) = private.br_phone_key(c.contact_phone)
  ) mudanca on true
  where c.organization_id = target_organization
  order by mudou_em, c.connection_id, c.contact_phone
  limit teto;
end;
$$;

comment on function public.nucleo_conversation_list(uuid, timestamptz, integer) is
  'Lista de conversas com o contato do CRM casado por private.br_phone_key; com changed_since, só o que mudou (conversa ou contato). security invoker: vale a RLS. Ver 20261020110000.';

revoke all on function public.nucleo_conversation_list(uuid, timestamptz, integer) from public, anon;
grant execute on function public.nucleo_conversation_list(uuid, timestamptz, integer) to authenticated, service_role;

-- ------------------------------------------------- 4. confere

do $$
begin
  if private.br_phone_key('(65) 99217-8164') is distinct from '556592178164'
    or private.br_phone_key('556592178164') is distinct from '556592178164'
    or private.br_phone_key('12345') is not null
    or private.br_phone_key('120363000000000000-1') is distinct from null then
    raise exception 'abortado: br_phone_key não devolve o esperado';
  end if;
  if pg_catalog.to_regclass('public.contacts_phone_key_idx') is null
    or pg_catalog.to_regclass('public.whatsapp_conversations_phone_key_idx') is null then
    raise exception 'abortado: índice de chave de telefone faltando';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.nucleo_conversation_list(uuid, timestamptz, integer)', 'execute') then
    raise exception 'abortado: anon executa a lista de conversas';
  end if;
end;
$$;

commit;
