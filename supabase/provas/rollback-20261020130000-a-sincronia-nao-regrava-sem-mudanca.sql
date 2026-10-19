-- Desfaz 20261020130000_a_sincronia_nao_regrava_sem_mudanca.sql. Colar no SQL Editor.
--
-- Volta as duas funções da sincronia aos corpos de 20260916110000 e
-- 20260910120000 (copiados abaixo, letra por letra): a VPS volta a regravar o
-- lote inteiro a cada 15 s. A VPS não sente nada: a assinatura é a mesma.
-- Aborta se a produção não estiver nem no corpo novo nem no antigo.

begin;

do $$
declare
  corpo_sem_fotos text;
  corpo_com_fotos text;
begin
  select pg_catalog.md5(pg_catalog.replace(p.prosrc, chr(13), '')) into corpo_sem_fotos
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.nucleo_conversation_sync_without_photos(jsonb)');
  select pg_catalog.md5(pg_catalog.replace(p.prosrc, chr(13), '')) into corpo_com_fotos
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.nucleo_conversation_sync(jsonb)');
  if corpo_sem_fotos is null or corpo_sem_fotos not in ('beac3e50f74dc2353460e4d22d60b7dc', '0e9b80f883c50fb5165ef35f6756d1ea')
    or corpo_com_fotos is null or corpo_com_fotos not in ('16b0fba867ef700650251279e8d7edec', 'e596fbdd6af16bd1396eecf8d83aaeaa') then
    raise exception 'abortado: a sincronia em produção não é a de 20261020130000 nem a de antes (md5 %, %)', corpo_sem_fotos, corpo_com_fotos;
  end if;
end;
$$;

create or replace function public.nucleo_conversation_sync_without_photos(sync_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  conversas jsonb := coalesce(sync_payload -> 'conversations', '[]'::jsonb);
  mensagens jsonb := coalesce(sync_payload -> 'messages', '[]'::jsonb);
  aliases jsonb := coalesce(sync_payload -> 'aliases', '[]'::jsonb);
  prefixo_de_midia text;
  conversas_gravadas integer := 0;
  mensagens_gravadas integer := 0;
  dobradas integer := 0;
  podadas integer := 0;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if jsonb_typeof(sync_payload) <> 'object'
    or pg_catalog.octet_length(sync_payload::text) > 262144 then
    raise exception 'conversation sync payload is invalid';
  end if;
  if jsonb_typeof(conversas) <> 'array'
    or jsonb_typeof(mensagens) <> 'array'
    or jsonb_typeof(aliases) <> 'array' then
    raise exception 'conversation sync payload is invalid';
  end if;
  if pg_catalog.jsonb_array_length(conversas) > 500
    or pg_catalog.jsonb_array_length(mensagens) > 2000
    or pg_catalog.jsonb_array_length(aliases) > 500 then
    raise exception 'conversation sync batch is too large';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;

  -- Só caminhos DESTA organização e conexão entram no espelho. Qualquer outro
  -- é descartado em silêncio: o robô não consegue subir arquivo fora do seu
  -- prefixo (policy do bucket), então um caminho estranho é só um payload
  -- errado, e payload errado não derruba o lote.
  prefixo_de_midia := robot_org::text || '/' || robot_connection::text || '/';

  with par as (
    select distinct
      pg_catalog.regexp_replace(coalesce(item ->> 'lid', ''), '[^0-9]', '', 'g') as lid,
      pg_catalog.regexp_replace(coalesce(item ->> 'phone', ''), '[^0-9-]', '', 'g') as phone
    from pg_catalog.jsonb_array_elements(aliases) as item
  ), valido as (
    select par.lid, par.phone,
      exists (
        select 1 from public.whatsapp_conversations destino
        where destino.connection_id = robot_connection
          and destino.contact_phone = par.phone
      ) as tem_destino
    from par
    where par.lid ~ '^[0-9]{6,40}$'
      and par.phone ~ '^[0-9][0-9-]{5,39}$'
      and par.lid <> par.phone
      and exists (
        select 1 from public.whatsapp_conversations origem
        where origem.connection_id = robot_connection
          and origem.contact_phone = par.lid
      )
  ), movidas as (
    insert into public.whatsapp_messages (
      connection_id, organization_id, contact_phone, message_id,
      content, sent_at, is_from_me, media_type, media_filename,
      media_path, media_mime,
      author_kind, author_name, author_id, created_at
    )
    select
      mensagem.connection_id, mensagem.organization_id, valido.phone, mensagem.message_id,
      mensagem.content, mensagem.sent_at, mensagem.is_from_me,
      mensagem.media_type, mensagem.media_filename,
      mensagem.media_path, mensagem.media_mime,
      mensagem.author_kind, mensagem.author_name, mensagem.author_id, mensagem.created_at
    from public.whatsapp_messages mensagem
    join valido on valido.lid = mensagem.contact_phone
    where mensagem.connection_id = robot_connection
    on conflict (connection_id, contact_phone, message_id) do nothing
    returning 1
  ), apagadas as (
    delete from public.whatsapp_messages mensagem
    using valido
    where mensagem.connection_id = robot_connection
      and mensagem.contact_phone = valido.lid
    returning 1
  ), renomeadas as (
    update public.whatsapp_conversations conversation
    set contact_phone = valido.phone,
        updated_at = now()
    from valido
    where conversation.connection_id = robot_connection
      and conversation.contact_phone = valido.lid
      and not valido.tem_destino
    returning 1
  ), fundidas as (
    update public.whatsapp_conversations destino
    set last_message_preview = case
          when origem.last_message_at is not null
           and (destino.last_message_at is null or origem.last_message_at > destino.last_message_at)
          then origem.last_message_preview else destino.last_message_preview end,
        last_message_from_me = case
          when origem.last_message_at is not null
           and (destino.last_message_at is null or origem.last_message_at > destino.last_message_at)
          then origem.last_message_from_me else destino.last_message_from_me end,
        last_message_at = greatest(destino.last_message_at, origem.last_message_at),
        unread_count = least(destino.unread_count + origem.unread_count, 100000),
        contact_name = case
          when pg_catalog.btrim(destino.contact_name) = '' then origem.contact_name
          else destino.contact_name end,
        contact_photo_url = coalesce(destino.contact_photo_url, origem.contact_photo_url),
        updated_at = now()
    from valido
    join public.whatsapp_conversations origem
      on origem.connection_id = robot_connection
     and origem.contact_phone = valido.lid
    where destino.connection_id = robot_connection
      and destino.contact_phone = valido.phone
      and valido.tem_destino
    returning 1
  ), removidas as (
    delete from public.whatsapp_conversations conversation
    using valido
    where conversation.connection_id = robot_connection
      and conversation.contact_phone = valido.lid
      and valido.tem_destino
    returning 1
  )
  select
    (select pg_catalog.count(*) from renomeadas)::integer
    + (select pg_catalog.count(*) from removidas)::integer
  into dobradas;

  with bruta as (
    select
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9-]', '', 'g') as phone,
      case when coalesce(item ->> 'kind', 'direto') = 'grupo'
        then 'grupo' else 'direto' end as kind,
      left(trim(coalesce(item ->> 'name', '')), 120) as name,
      left(trim(coalesce(item ->> 'preview', '')), 200) as preview,
      (item ->> 'lastMessageAt')::timestamptz as last_at,
      coalesce((item ->> 'fromMe')::boolean, false) as from_me,
      greatest(0, least(coalesce((item ->> 'unread')::integer, 0), 100000)) as unread,
      case when coalesce(item ->> 'owner', 'bot') in ('bot', 'ia', 'humano')
        then item ->> 'owner' else 'bot' end as owner,
      case when coalesce(item ->> 'owner', 'bot') = 'humano'
        then nullif(trim(coalesce(item ->> 'attendantId', '')), '') end as attendant_id,
      case when coalesce(item ->> 'owner', 'bot') = 'humano'
        then left(trim(coalesce(item ->> 'attendantName', '')), 120) else '' end as attendant_name
    from pg_catalog.jsonb_array_elements(conversas) as item
  ), entrada as (
    select distinct on (bruta.phone) bruta.*
    from bruta
    order by bruta.phone, bruta.last_at desc nulls last
  ), gravadas as (
    insert into public.whatsapp_conversations (
      connection_id, organization_id, contact_phone, chat_kind, contact_name,
      last_message_preview, last_message_at, last_message_from_me,
      unread_count, owner, attendant_id, attendant_name, updated_at
    )
    select
      robot_connection, robot_org, entrada.phone, entrada.kind, entrada.name,
      entrada.preview, entrada.last_at, entrada.from_me,
      entrada.unread, entrada.owner,
      case when entrada.attendant_id ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then entrada.attendant_id::uuid end,
      entrada.attendant_name, now()
    from entrada
    where entrada.phone ~ '^[0-9][0-9-]{5,39}$'
    on conflict (connection_id, contact_phone) do update set
      chat_kind = excluded.chat_kind,
      contact_name = excluded.contact_name,
      last_message_preview = excluded.last_message_preview,
      last_message_at = excluded.last_message_at,
      last_message_from_me = excluded.last_message_from_me,
      unread_count = excluded.unread_count,
      owner = excluded.owner,
      attendant_id = excluded.attendant_id,
      attendant_name = excluded.attendant_name,
      updated_at = now()
    returning 1
  )
  select pg_catalog.count(*)::integer into conversas_gravadas from gravadas;

  with entrada as (
    select
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9-]', '', 'g') as phone,
      left(trim(coalesce(item ->> 'id', '')), 128) as message_id,
      left(coalesce(item ->> 'content', ''), 8000) as content,
      (item ->> 'sentAt')::timestamptz as sent_at,
      coalesce((item ->> 'fromMe')::boolean, false) as from_me,
      left(trim(coalesce(item ->> 'mediaType', '')), 32) as media_type,
      left(trim(coalesce(item ->> 'mediaFilename', '')), 200) as media_filename,
      case when left(trim(coalesce(item ->> 'mediaPath', '')), 300) like prefixo_de_midia || '%'
        then left(trim(item ->> 'mediaPath'), 300) else '' end as media_path,
      left(lower(trim(coalesce(item ->> 'mediaMime', ''))), 80) as media_mime,
      case when coalesce(item ->> 'authorKind', '') in ('contato', 'ia', 'humano', 'bot')
        then item ->> 'authorKind' else '' end as author_kind,
      left(trim(coalesce(item ->> 'authorName', '')), 120) as author_name,
      case when trim(coalesce(item ->> 'authorId', '')) ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (trim(item ->> 'authorId'))::uuid end as author_id
    from pg_catalog.jsonb_array_elements(mensagens) as item
  ), gravadas as (
    insert into public.whatsapp_messages (
      connection_id, organization_id, contact_phone, message_id,
      content, sent_at, is_from_me, media_type, media_filename,
      media_path, media_mime,
      author_kind, author_name, author_id
    )
    select
      robot_connection, robot_org, entrada.phone, entrada.message_id,
      entrada.content, entrada.sent_at, entrada.from_me,
      entrada.media_type, entrada.media_filename,
      entrada.media_path, entrada.media_mime,
      entrada.author_kind, entrada.author_name, entrada.author_id
    from entrada
    where entrada.phone ~ '^[0-9][0-9-]{5,39}$'
      and entrada.message_id <> ''
      and entrada.sent_at is not null
    -- Estreito de propósito: conteúdo imutável, autoria e arquivo só escritos
    -- sobre valor VAZIO, e o `where` impede o UPDATE inútil que acordaria o
    -- gatilho de realtime a cada ciclo.
    on conflict (connection_id, contact_phone, message_id) do update
    set author_kind = case
          when public.whatsapp_messages.author_kind = '' and excluded.author_kind <> ''
          then excluded.author_kind else public.whatsapp_messages.author_kind end,
        author_name = case
          when public.whatsapp_messages.author_name = '' and excluded.author_name <> ''
          then excluded.author_name else public.whatsapp_messages.author_name end,
        author_id = coalesce(public.whatsapp_messages.author_id, excluded.author_id),
        media_path = case
          when public.whatsapp_messages.media_path = '' and excluded.media_path <> ''
          then excluded.media_path else public.whatsapp_messages.media_path end,
        media_mime = case
          when public.whatsapp_messages.media_path = '' and excluded.media_path <> ''
          then excluded.media_mime else public.whatsapp_messages.media_mime end
    where (public.whatsapp_messages.author_kind = '' and excluded.author_kind <> '')
       or (public.whatsapp_messages.author_name = '' and excluded.author_name <> '')
       or (public.whatsapp_messages.author_id is null and excluded.author_id is not null)
       or (public.whatsapp_messages.media_path = '' and excluded.media_path <> '')
    returning 1
  )
  select pg_catalog.count(*)::integer into mensagens_gravadas from gravadas;

  with alvo as (
    select mensagem.ctid
    from public.whatsapp_messages mensagem
    where mensagem.connection_id = robot_connection
      and mensagem.sent_at < now() - interval '90 days'
    limit 500
  ), removidas as (
    delete from public.whatsapp_messages
    where ctid in (select alvo.ctid from alvo)
    returning 1
  )
  select pg_catalog.count(*)::integer into podadas from removidas;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = robot_org
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object(
    'accepted', true,
    'connectionId', robot_connection,
    'conversations', conversas_gravadas,
    'messages', mensagens_gravadas,
    'merged', dobradas,
    'pruned', podadas,
    'syncedAt', now()
  );
end;
$$;

create or replace function public.nucleo_conversation_sync(sync_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resultado jsonb;
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
begin
  resultado := public.nucleo_conversation_sync_without_photos(sync_payload);

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;

  with fotos as (
    select distinct on (phone)
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9-]', '', 'g') as phone,
      nullif(left(trim(item ->> 'photoUrl'), 2048), '') as photo_url
    from pg_catalog.jsonb_array_elements(coalesce(sync_payload -> 'conversations', '[]'::jsonb)) item
    where item ? 'photoUrl'
      and trim(item ->> 'photoUrl') ~ '^https://'
    order by phone
  )
  update public.whatsapp_conversations conversation
  set contact_photo_url = fotos.photo_url,
      updated_at = now()
  from fotos
  where conversation.organization_id = robot_org
    and conversation.connection_id = robot_connection
    and conversation.contact_phone = fotos.phone;

  return resultado;
end;
$$;

commit;
