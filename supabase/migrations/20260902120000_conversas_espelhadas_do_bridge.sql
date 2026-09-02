-- Conversas do WhatsApp espelhadas do Bridge para o portal.
--
-- A tela de Conversas nasceu do desenho em `docs/design/conversas/` e subiu com
-- histórico de demonstração, porque não havia caminho entre o disco da VPS e o
-- navegador. O Bridge já captura e grava toda mensagem num SQLite local; o que
-- faltava era a travessia.
--
-- A travessia NÃO é uma porta nova na VPS. `ASSISTANT_HOST` é fixo em
-- 127.0.0.1, o Bridge escuta em loopback, e o `HARDENING.md` daquele repositório
-- existe para manter assim. O runtime EMPURRA, com a credencial de robô da
-- própria conexão, exatamente como `nucleo_runtime_heartbeat` já faz desde
-- 20260825120000 — esta migration é a mesma forma aplicada a outro assunto.
--
-- Sobre guardar conteúdo de conversa aqui: `SPEC-DATA-SECURITY.md` classifica
-- mensagem como *Sensível*, tratamento "minimizar, mascarar e limitar
-- retenção" — a mesma classe de `telefone`, que já mora em `contacts`. É regra
-- de COMO guardar, e não proibição. O que os comentários de
-- `20260814140000_whatsapp_connections.sql` recusam é conteúdo dentro das
-- tabelas de conexão e de eventos, que são telemetria; a recusa é daquelas
-- tabelas, não do produto.
--
-- Esta migration obedece a regra por construção:
--   * só texto — `media_key`, `file_sha256` e a URL do CDN ficam na VPS, e da
--     mídia sobra o tipo e o nome de arquivo, o bastante para a tela dizer
--     "📎 Imagem" sem poder reconstruir o conteúdo;
--   * janela de 90 dias, podada pela própria RPC a cada sincronia;
--   * RLS por organização, leitura apenas, e nenhuma policy de escrita: quem
--     escreve é a RPC `security definer`, que deriva organização e conexão da
--     credencial e ignora o que o chamador alegar;
--   * idempotência por chave natural, como a spec exige para mensagens.

begin;

-- Uma linha por conversa. É a tabela quente: a lista inteira da tela sai daqui,
-- e é ela — não a de mensagens — que dispara o aviso de realtime.
create table if not exists public.whatsapp_conversations (
  connection_id uuid not null,
  organization_id uuid not null,
  -- Só dígitos. JID de grupo ("...@g.us") não entra: esta leva é atendimento
  -- um-a-um, e deixar grupo cair aqui encheria a lista de coisa que a tela não
  -- sabe abrir.
  contact_phone text not null check (contact_phone ~ '^[0-9]{6,20}$'),
  contact_name text not null default '' check (length(contact_name) <= 120),
  last_message_preview text not null default '' check (length(last_message_preview) <= 200),
  last_message_at timestamptz,
  last_message_from_me boolean not null default false,
  unread_count integer not null default 0 check (unread_count >= 0),
  owner text not null default 'bot' check (owner in ('bot', 'ia', 'humano')),
  updated_at timestamptz not null default now(),
  primary key (connection_id, contact_phone),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

create index if not exists whatsapp_conversations_org_idx
  on public.whatsapp_conversations (organization_id, last_message_at desc);

-- O histórico. Cresce, e por isso tem janela.
create table if not exists public.whatsapp_messages (
  connection_id uuid not null,
  organization_id uuid not null,
  contact_phone text not null check (contact_phone ~ '^[0-9]{6,20}$'),
  -- O id que o WhatsApp deu à mensagem. É ele que torna a sincronia idempotente:
  -- reenviar o mesmo lote não duplica nada.
  message_id text not null check (length(message_id) between 1 and 128),
  content text not null default '' check (length(content) <= 8000),
  sent_at timestamptz not null,
  is_from_me boolean not null default false,
  -- Da mídia fica só o rótulo. Sem bytes, sem chave, sem URL do CDN.
  media_type text not null default '' check (length(media_type) <= 32),
  media_filename text not null default '' check (length(media_filename) <= 200),
  created_at timestamptz not null default now(),
  primary key (connection_id, contact_phone, message_id),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

create index if not exists whatsapp_messages_thread_idx
  on public.whatsapp_messages (organization_id, connection_id, contact_phone, sent_at desc);

create index if not exists whatsapp_messages_retention_idx
  on public.whatsapp_messages (connection_id, sent_at);

alter table public.whatsapp_conversations enable row level security;
revoke all on public.whatsapp_conversations from anon, authenticated;
grant select on public.whatsapp_conversations to authenticated;

drop policy if exists whatsapp_conversations_select on public.whatsapp_conversations;
create policy whatsapp_conversations_select
on public.whatsapp_conversations for select to authenticated
using (private.is_org_member(organization_id));

alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;

drop policy if exists whatsapp_messages_select on public.whatsapp_messages;
create policy whatsapp_messages_select
on public.whatsapp_messages for select to authenticated
using (private.is_org_member(organization_id));

/*
 * A sincronia.
 *
 * Recebe um lote — conversas e mensagens juntas — porque o runtime lê as duas
 * coisas da mesma varredura do SQLite e mandá-las separadas abriria janela para
 * a lista apontar uma prévia cuja mensagem ainda não chegou.
 *
 * O teto de payload é maior que o do heartbeat (4 KB): ali cabe um punhado de
 * estados, aqui cabe um lote de mensagens. 256 KB segura algumas centenas de
 * mensagens de texto e ainda impede que um lote sem limite vire negação de
 * serviço; o runtime é quem fatia.
 */
create or replace function public.nucleo_conversation_sync(sync_payload jsonb)
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
  conversas_gravadas integer := 0;
  mensagens_gravadas integer := 0;
  podadas integer := 0;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if jsonb_typeof(sync_payload) <> 'object'
    or pg_catalog.octet_length(sync_payload::text) > 262144 then
    raise exception 'conversation sync payload is invalid';
  end if;
  if jsonb_typeof(conversas) <> 'array' or jsonb_typeof(mensagens) <> 'array' then
    raise exception 'conversation sync payload is invalid';
  end if;
  if pg_catalog.jsonb_array_length(conversas) > 500
    or pg_catalog.jsonb_array_length(mensagens) > 2000 then
    raise exception 'conversation sync batch is too large';
  end if;

  -- A conexão sai da credencial, nunca do payload. Mesma consulta do heartbeat:
  -- credencial ativa, não revogada, e conexão viva.
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
   * Texto longo é truncado, e não recusado. Um lote que morre inteiro porque
   * uma prévia passou de 200 caracteres deixaria a tela parada por um detalhe
   * cosmético; truncar entrega a lista e perde só o excedente. Já o telefone é
   * FILTRO, não truncamento: o que não for dígito é grupo ou JID estranho, e
   * conversa que a tela não sabe abrir não deve ocupar linha na lista.
   */
  with bruta as (
    select
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9]', '', 'g') as phone,
      left(trim(coalesce(item ->> 'name', '')), 120) as name,
      left(trim(coalesce(item ->> 'preview', '')), 200) as preview,
      (item ->> 'lastMessageAt')::timestamptz as last_at,
      coalesce((item ->> 'fromMe')::boolean, false) as from_me,
      greatest(0, least(coalesce((item ->> 'unread')::integer, 0), 100000)) as unread,
      case when coalesce(item ->> 'owner', 'bot') in ('bot', 'ia', 'humano')
        then item ->> 'owner' else 'bot' end as owner
    from pg_catalog.jsonb_array_elements(conversas) as item
  ), entrada as (
    -- Um telefone repetido no mesmo lote faria o `do update` tocar a mesma
    -- linha duas vezes, e o Postgres aborta a instrução inteira com "cannot
    -- affect row a second time" — a sincronia toda morreria por um lote mal
    -- montado. Fica a ocorrência mais recente.
    select distinct on (bruta.phone) bruta.*
    from bruta
    order by bruta.phone, bruta.last_at desc nulls last
  ), gravadas as (
    insert into public.whatsapp_conversations (
      connection_id, organization_id, contact_phone, contact_name,
      last_message_preview, last_message_at, last_message_from_me,
      unread_count, owner, updated_at
    )
    select
      robot_connection, robot_org, entrada.phone, entrada.name,
      entrada.preview, entrada.last_at, entrada.from_me,
      entrada.unread, entrada.owner, now()
    from entrada
    where entrada.phone ~ '^[0-9]{6,20}$'
    on conflict (connection_id, contact_phone) do update set
      contact_name = excluded.contact_name,
      last_message_preview = excluded.last_message_preview,
      last_message_at = excluded.last_message_at,
      last_message_from_me = excluded.last_message_from_me,
      unread_count = excluded.unread_count,
      owner = excluded.owner,
      updated_at = now()
    returning 1
  )
  select pg_catalog.count(*)::integer into conversas_gravadas from gravadas;

  /*
   * `do nothing` e não `do update`: mensagem entregue não muda de conteúdo, e
   * reenviar o mesmo lote — o que acontece toda vez que a marca d'água do
   * runtime recua depois de uma falha — precisa ser inócuo.
   */
  with entrada as (
    select
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9]', '', 'g') as phone,
      left(trim(coalesce(item ->> 'id', '')), 128) as message_id,
      left(coalesce(item ->> 'content', ''), 8000) as content,
      (item ->> 'sentAt')::timestamptz as sent_at,
      coalesce((item ->> 'fromMe')::boolean, false) as from_me,
      left(trim(coalesce(item ->> 'mediaType', '')), 32) as media_type,
      left(trim(coalesce(item ->> 'mediaFilename', '')), 200) as media_filename
    from pg_catalog.jsonb_array_elements(mensagens) as item
  ), gravadas as (
    insert into public.whatsapp_messages (
      connection_id, organization_id, contact_phone, message_id,
      content, sent_at, is_from_me, media_type, media_filename
    )
    select
      robot_connection, robot_org, entrada.phone, entrada.message_id,
      entrada.content, entrada.sent_at, entrada.from_me,
      entrada.media_type, entrada.media_filename
    from entrada
    where entrada.phone ~ '^[0-9]{6,20}$'
      and entrada.message_id <> ''
      and entrada.sent_at is not null
    on conflict (connection_id, contact_phone, message_id) do nothing
    returning 1
  )
  select pg_catalog.count(*)::integer into mensagens_gravadas from gravadas;

  /*
   * A janela de 90 dias, podada em lotes de 500.
   *
   * Sem o limite, a primeira sincronia depois de um período parado varreria a
   * tabela inteira dentro da transação de quem está só publicando mensagem
   * nova. Podar um pedaço por chamada esvazia o excedente ao longo de alguns
   * ciclos e mantém cada chamada barata — o índice
   * `whatsapp_messages_retention_idx` existe para isso.
   */
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
    'pruned', podadas,
    'syncedAt', now()
  );
end;
$$;

revoke all on function public.nucleo_conversation_sync(jsonb) from public;
grant execute on function public.nucleo_conversation_sync(jsonb) to authenticated;

/*
 * O aviso de realtime vai SÓ na tabela de conversas.
 *
 * `private.portal_realtime_notify` faz uma varredura de retenção a cada linha
 * inserida. No volume de conexões isso é irrelevante; no volume de mensagens
 * seria uma varredura por mensagem recebida. A lista é o que precisa piscar na
 * tela — o interior da conversa recarrega quando alguém a abre.
 */
drop trigger if exists whatsapp_conversations_portal_realtime
  on public.whatsapp_conversations;
create trigger whatsapp_conversations_portal_realtime
after insert or update or delete on public.whatsapp_conversations
for each row execute function private.portal_realtime_notify('conversas');

-- O check precisa ser reescrito por inteiro, com a lista toda, na mesma
-- migration que instala o gatilho novo. É a lição de 20260829190000: o gatilho
-- roda dentro da transação de quem escreveu, então um tópico fora da lista não
-- derruba o aviso — derruba a mensagem que o causou.
alter table public.portal_realtime_events
  drop constraint if exists portal_realtime_events_topico;
alter table public.portal_realtime_events
  add constraint portal_realtime_events_topico
  check (topic in ('connections', 'operators', 'intelligence', 'handoffs', 'conversas'));

-- Prova, na mesma transação, de que a lista cobre todos os tópicos que os
-- gatilhos instalados realmente passam para a função — inclusive o que esta
-- migration acabou de pendurar. Consulta idêntica à de 20260829190000, e de
-- propósito: é a que já rodou contra esta base.
do $$
declare
  faltando text;
begin
  select string_agg(distinct emitido.topico, ', ')
  into faltando
  from (
    select split_part(
             encode(trigger_row.tgargs, 'escape'),
             '\000',
             1
           ) as topico
    from pg_trigger trigger_row
    join pg_proc funcao on funcao.oid = trigger_row.tgfoid
    join pg_namespace esquema on esquema.oid = funcao.pronamespace
    where not trigger_row.tgisinternal
      and esquema.nspname = 'private'
      and funcao.proname = 'portal_realtime_notify'
  ) emitido
  where emitido.topico is not null
    and emitido.topico <> ''
    and emitido.topico not in ('connections', 'operators', 'intelligence', 'handoffs', 'conversas');

  if faltando is not null then
    raise exception 'gatilho emite tópico fora do check: %', faltando;
  end if;
end;
$$;

commit;
