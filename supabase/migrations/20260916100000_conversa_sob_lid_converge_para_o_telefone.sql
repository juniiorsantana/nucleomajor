begin;

/*
 * A conversa que subiu sob o LID converge para a linha do telefone.
 *
 * O caso, em 15/09/2026: um lead escreveu quatro mensagens às 15:11; o runtime
 * traduz LID→telefone com um mapa em cache de cinco minutos, o par do contato
 * ainda não estava nele, e as mensagens subiram com o LID (`20525648752707`)
 * no lugar do telefone. Às 20:52 o cache já sabia o par, e o resto da conversa
 * caiu na linha certa. Resultado: duas conversas "Juliano Arruda" no painel —
 * a que a equipe abria não tinha o que ele escreveu, e a que tinha ninguém
 * abria. Sete das vinte e três conversas diretas estavam assim.
 *
 * O runtime agora pergunta ao store na hora quando um LID falta no cache (ver
 * `chat_identity.py`), o que fecha a janela para conversas novas. Esta
 * migration cuida do que já ficou dividido, e do que ainda vier a dividir por
 * um par que o WhatsApp só informe depois da primeira mensagem: o lote de
 * sincronia ganha `aliases` — pares `{lid, phone}` que o Bridge desta conexão
 * consegue traduzir agora — e, para cada par com linha sob o LID, o banco:
 *
 *   1. move as mensagens para o telefone (chave natural: reenviar é inócuo,
 *      e a mesma mensagem que já exista lá fica como está);
 *   2. se não há linha do telefone, renomeia a do LID; se há, funde as duas —
 *      a prévia e a hora vêm da mais recente, `unread_count` soma, e a DONA
 *      fica a da linha do telefone, porque é a que a equipe abriu.
 *
 * Nada disto depende do payload dizer qual é a organização: a conexão sai da
 * credencial do robô, como em todo o resto da função. Um alias para uma linha
 * que não existe não faz nada, então repetir o mesmo par a cada ciclo custa
 * uma consulta por chave primária.
 *
 * O resto do corpo — conversas, mensagens, autoria, poda, credencial — está
 * letra por letra como em `20260913230000_o_nome_de_quem_escreveu.sql`.
 */

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

  /*
   * A dobra, ANTES da lista: a linha do LID some e só então a lista fresca é
   * gravada — senão a prévia deste ciclo viria de uma linha que acabou de
   * sumir. Todas as CTEs enxergam o mesmo instantâneo, e é isso que torna as
   * duas saídas (renomear ou fundir) mutuamente exclusivas por linha.
   */
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
      author_kind, author_name, author_id, created_at
    )
    select
      mensagem.connection_id, mensagem.organization_id, valido.phone, mensagem.message_id,
      mensagem.content, mensagem.sent_at, mensagem.is_from_me,
      mensagem.media_type, mensagem.media_filename,
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

  /*
   * Texto longo continua truncado, e não recusado. O identificador continua
   * sendo FILTRO — o que muda é o que passa por ele: agora o traço do grupo
   * antigo também passa, e `kind` diz como a tela deve ler o que passou.
   *
   * `attendant` só sobrevive quando o dono é `humano`, e é a mesma regra que o
   * árbitro aplica do outro lado. Repeti-la aqui não é redundância: sem ela,
   * um lote fora de ordem gravaria "Atendente · Lucas" numa conversa que já
   * tinha voltado para a IA, e a lista mentiria sobre quem responde.
   */
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
      -- Um id de atendente que não seja UUID é descartado em vez de derrubar o
      -- lote: o árbitro aceita qualquer texto ali, e uma sessão antiga pode
      -- carregar um identificador de outro formato.
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
      -- Autoria. Um valor que esta versão não conheça vira vazio, e vazio é
      -- "ninguém anotou" — nunca um erro, que derrubaria o lote inteiro e
      -- travaria a marca d'água no mesmo ponto para sempre.
      case when coalesce(item ->> 'authorKind', '') in ('contato', 'ia', 'humano', 'bot')
        then item ->> 'authorKind' else '' end as author_kind,
      left(trim(coalesce(item ->> 'authorName', '')), 120) as author_name,
      -- Mesmo cuidado do id de atendente: identificador fora do formato é
      -- descartado, não derruba o lote.
      case when trim(coalesce(item ->> 'authorId', '')) ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (trim(item ->> 'authorId'))::uuid end as author_id
    from pg_catalog.jsonb_array_elements(mensagens) as item
  ), gravadas as (
    insert into public.whatsapp_messages (
      connection_id, organization_id, contact_phone, message_id,
      content, sent_at, is_from_me, media_type, media_filename,
      author_kind, author_name, author_id
    )
    select
      robot_connection, robot_org, entrada.phone, entrada.message_id,
      entrada.content, entrada.sent_at, entrada.from_me,
      entrada.media_type, entrada.media_filename,
      entrada.author_kind, entrada.author_name, entrada.author_id
    from entrada
    where entrada.phone ~ '^[0-9][0-9-]{5,39}$'
      and entrada.message_id <> ''
      and entrada.sent_at is not null
    -- Estreito de propósito. Ver o tópico 3 do cabeçalho de 20260913230000: o
    -- conteúdo da mensagem continua imutável depois de gravado, autoria só é
    -- escrita sobre autoria VAZIA, e o `where` impede o UPDATE inútil que
    -- acordaria o gatilho de realtime a cada ciclo.
    on conflict (connection_id, contact_phone, message_id) do update
    set author_kind = case
          when public.whatsapp_messages.author_kind = '' and excluded.author_kind <> ''
          then excluded.author_kind else public.whatsapp_messages.author_kind end,
        author_name = case
          when public.whatsapp_messages.author_name = '' and excluded.author_name <> ''
          then excluded.author_name else public.whatsapp_messages.author_name end,
        author_id = coalesce(public.whatsapp_messages.author_id, excluded.author_id)
    where (public.whatsapp_messages.author_kind = '' and excluded.author_kind <> '')
       or (public.whatsapp_messages.author_name = '' and excluded.author_name <> '')
       or (public.whatsapp_messages.author_id is null and excluded.author_id is not null)
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

commit;
