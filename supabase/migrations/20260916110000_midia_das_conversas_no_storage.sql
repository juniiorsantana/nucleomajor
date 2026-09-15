begin;

/*
 * A mídia das conversas passa a ter arquivo, e não só rótulo.
 *
 * Até aqui o espelho guardava de uma mensagem de mídia só `media_type` e
 * `media_filename` — "sem bytes, sem chave, sem URL", decisão de
 * `20260902120000`. A tela dizia "🎤 Áudio" e ninguém conseguia ouvir. Em
 * 15/09/2026 o dono decidiu o contrário, com prazo: os arquivos ficam num
 * bucket PRIVADO, lidos só por membro da organização por URL assinada de uma
 * hora, e somem com a mesma janela de 90 dias das mensagens.
 *
 * As três peças:
 *
 *   1. O bucket `whatsapp-media`. Caminho `<org>/<conexão>/<chat>/<id>.<ext>`
 *      para o que chega, e `<org>/<conexão>/outbox/<clientId>.<ext>` para o
 *      que a equipe manda pelo portal. A primeira pasta É a organização, e as
 *      policies leem a autorização dali: membro lê tudo da sua organização e
 *      escreve só no `outbox`; o robô da conexão escreve em qualquer caminho
 *      da sua organização, relê o `outbox` para entregar, e apaga na poda.
 *      Robô não é membro (`private.is_org_member` o exclui de propósito), e é
 *      `private.robot_organization()` que o reconhece.
 *
 *   2. `whatsapp_messages.media_path` e `media_mime`. O arquivo chega uma
 *      sincronia DEPOIS da mensagem — o runtime espelha o texto no ciclo em
 *      que a mensagem aparece, e baixa/sobe o arquivo em seguida —, então o
 *      `on conflict` passa a preencher os dois sobre valor VAZIO, na mesma
 *      regra estreita da autoria. Um caminho fora da organização e conexão
 *      do robô é descartado, não recusado.
 *
 *   3. `conversation_send` com `mediaPath` e `mediaMime`. O texto vira legenda
 *      e pode ser vazio; o caminho tem que estar no `outbox` desta
 *      organização e conexão, o objeto tem que existir e ter sido enviado por
 *      quem enfileira. É a RPC, e não o navegador, que garante que a fila só
 *      manda o que a própria pessoa acabou de subir.
 *
 * Fora do escopo: documento, vídeo e figurinha continuam como rótulo.
 */

-- ------------------------------------------------------------- 1. o bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media', 'whatsapp-media', false, 16777216,
  array[
    'audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A organização é a primeira pasta do caminho. Fora do formato devolve nulo, e
-- nulo não é membro de nada nem é a organização de robô nenhum.
create or replace function private.organizacao_do_caminho(caminho text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.split_part(coalesce(caminho, ''), '/', 1)
      ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then pg_catalog.split_part(caminho, '/', 1)::uuid
  end;
$$;

revoke all on function private.organizacao_do_caminho(text) from public;
grant execute on function private.organizacao_do_caminho(text) to authenticated;

drop policy if exists whatsapp_media_select on storage.objects;
create policy whatsapp_media_select on storage.objects for select to authenticated
using (
  bucket_id = 'whatsapp-media'
  and (
    private.is_org_member(private.organizacao_do_caminho(name))
    or private.organizacao_do_caminho(name) = private.robot_organization()
  )
);

drop policy if exists whatsapp_media_insert on storage.objects;
create policy whatsapp_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'whatsapp-media'
  and (
    private.organizacao_do_caminho(name) = private.robot_organization()
    or (
      private.is_org_member(private.organizacao_do_caminho(name))
      and pg_catalog.array_length(storage.foldername(name), 1) = 3
      and (storage.foldername(name))[3] = 'outbox'
    )
  )
);

-- O robô sobe com `x-upsert`: reenviar o mesmo arquivo depois de uma falha no
-- meio não pode virar recusa por "já existe".
drop policy if exists whatsapp_media_update on storage.objects;
create policy whatsapp_media_update on storage.objects for update to authenticated
using (
  bucket_id = 'whatsapp-media'
  and private.organizacao_do_caminho(name) = private.robot_organization()
)
with check (
  bucket_id = 'whatsapp-media'
  and private.organizacao_do_caminho(name) = private.robot_organization()
);

drop policy if exists whatsapp_media_delete on storage.objects;
create policy whatsapp_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'whatsapp-media'
  and private.organizacao_do_caminho(name) = private.robot_organization()
);

-- --------------------------------------------------- 2. as colunas novas

alter table public.whatsapp_messages
  add column if not exists media_path text not null default ''
    check (length(media_path) <= 300),
  add column if not exists media_mime text not null default ''
    check (length(media_mime) <= 80);

comment on column public.whatsapp_messages.media_path is
  'Caminho no bucket whatsapp-media. Vazio: só o rótulo, como antes de 16/09/2026.';

-- A RPC de sincronia, com `mediaPath`/`mediaMime` nas mensagens. Fora isso, o
-- corpo é o de `20260916100000` (com `aliases`) letra por letra.
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

revoke all on function public.nucleo_conversation_sync_without_photos(jsonb) from public;

-- ------------------------------------------ 3. enviar mídia pelo portal
--
-- Corpo idêntico ao de `20260913230000`, com o ramo de `conversation_send`
-- aceitando `mediaPath` e `mediaMime`. O resto — associação, espelho
-- obrigatório, idempotência, prazos e `conversation_owner` — como estava.

create or replace function public.nucleo_conversation_command_enqueue(
  target_organization uuid,
  target_connection uuid,
  target_chat text,
  requested_command text,
  command_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comando text := lower(trim(coalesce(requested_command, '')));
  chat text := pg_catalog.regexp_replace(coalesce(target_chat, ''), '[^0-9-]', '', 'g');
  conexao uuid := target_connection;
  conversa public.whatsapp_conversations%rowtype;
  cliente text := trim(coalesce(command_payload ->> 'clientId', ''));
  texto text := trim(coalesce(command_payload ->> 'text', ''));
  midia_caminho text := trim(coalesce(command_payload ->> 'mediaPath', ''));
  midia_mime text := lower(trim(coalesce(command_payload ->> 'mediaMime', '')));
  dono text := lower(trim(coalesce(command_payload ->> 'owner', '')));
  atendente uuid;
  atendente_nome text := '';
  autor_nome text := '';
  carga jsonb;
  validade interval;
  chave text;
  comando_id uuid;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  if comando not in ('conversation_send', 'conversation_owner', 'conversation_check') then
    raise exception 'conversation command is invalid';
  end if;
  if cliente !~ '^[0-9a-fA-F-]{8,64}$' then
    raise exception 'conversation command needs a client id';
  end if;

  if comando = 'conversation_check' then
    if chat !~ '^[0-9]{10,15}$' then
      raise exception 'phone number is invalid';
    end if;
    if conexao is null then
      conexao := private.conexao_da_organizacao(target_organization);
    else
      perform 1
      from public.whatsapp_connections connection
      where connection.id = conexao
        and connection.organization_id = target_organization
        and connection.status <> 'revoked'
        and connection.revoked_at is null;
      if not found then
        raise exception 'connection is not available for this organization';
      end if;
    end if;
    carga := jsonb_build_object('phone', chat);
    validade := interval '2 minutes';
  else
    select conversation.* into conversa
    from public.whatsapp_conversations conversation
    where conversation.organization_id = target_organization
      and conversation.connection_id = conexao
      and conversation.contact_phone = chat;
    if not found then
      raise exception 'conversation is not mirrored for this connection';
    end if;

    if comando = 'conversation_send' then
      /*
       * Com mídia o texto é legenda e pode faltar; sem mídia continua
       * obrigatório. O caminho tem que ser o `outbox` DESTA organização e
       * conexão, e o objeto tem que existir no bucket com quem enfileira como
       * dono: é o que impede a fila de mandar um arquivo que outra pessoa
       * subiu, ou que ninguém subiu.
       */
      if length(texto) > 4000 or (texto = '' and midia_caminho = '') then
        raise exception 'message text is invalid';
      end if;
      if midia_caminho <> '' then
        if midia_caminho !~ ('^' || target_organization::text || '/' || conexao::text
            || '/outbox/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$')
          or midia_mime not in (
            'audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav',
            'image/jpeg', 'image/png', 'image/webp'
          ) then
          raise exception 'media path is invalid';
        end if;
        perform 1
        from storage.objects objeto
        where objeto.bucket_id = 'whatsapp-media'
          and objeto.name = midia_caminho
          and (objeto.owner = auth.uid() or objeto.owner_id = auth.uid()::text);
        if not found then
          raise exception 'media path is invalid';
        end if;
      end if;
      select coalesce(nullif(trim(profile.display_name), ''), profile.full_name, '')
      into autor_nome
      from public.profiles profile
      where profile.id = auth.uid();
      carga := jsonb_build_object(
        'chat', chat, 'kind', conversa.chat_kind, 'text', texto,
        'mediaPath', midia_caminho, 'mediaMime', midia_mime,
        'authorId', auth.uid()::text,
        'authorName', left(coalesce(autor_nome, ''), 120)
      );
      validade := interval '10 minutes';
    else
      if dono not in ('bot', 'ia', 'humano') then
        raise exception 'conversation owner is invalid';
      end if;
      if dono = 'humano' then
        atendente := nullif(trim(coalesce(command_payload ->> 'attendantId', '')), '')::uuid;
        if atendente is not null then
          select coalesce(nullif(trim(profile.display_name), ''), profile.full_name, '')
          into atendente_nome
          from public.organization_members membro
          join public.profiles profile on profile.id = membro.user_id
          where membro.organization_id = target_organization
            and membro.user_id = atendente
            and membro.status = 'active';
          if not found then
            raise exception 'attendant is not an active member of this organization';
          end if;
        end if;
      end if;
      carga := jsonb_build_object(
        'chat', chat, 'kind', conversa.chat_kind, 'owner', dono,
        'attendantId', coalesce(atendente::text, ''),
        'attendantName', left(atendente_nome, 120)
      );
      validade := interval '5 minutes';
    end if;
  end if;

  chave := encode(
    extensions.digest(
      concat_ws(':', 'conversation-command', comando, conexao::text, chat, cliente),
      'sha256'
    ),
    'hex'
  );

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload,
    created_by, idempotency_key, expires_at
  ) values (
    target_organization, conexao, comando, carga,
    auth.uid(), chave, now() + validade
  )
  on conflict (organization_id, idempotency_key) do update
    set available_at = case
          when connection_runtime_commands.status in ('failed', 'expired') then now()
          else connection_runtime_commands.available_at end,
        expires_at = case
          when connection_runtime_commands.status in ('failed', 'expired') then now() + validade
          else connection_runtime_commands.expires_at end,
        status = case
          when connection_runtime_commands.status in ('failed', 'expired') then 'pending'
          else connection_runtime_commands.status end,
        private_payload = case
          when connection_runtime_commands.status in ('failed', 'expired') then excluded.private_payload
          else connection_runtime_commands.private_payload end,
        error_code = case
          when connection_runtime_commands.status in ('failed', 'expired') then null
          else connection_runtime_commands.error_code end,
        updated_at = now()
  returning id into comando_id;

  return jsonb_build_object(
    'commandId', comando_id,
    'command', comando,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) to authenticated;

commit;
