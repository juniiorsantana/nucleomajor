-- A Leva 2 das Conversas: escrever, atribuir a alguém, e mostrar grupo.
--
-- A Leva 1 (20260902120000) abriu a travessia num sentido só: o runtime
-- empurra, o portal lê. Ler já funciona. O que faltava era o resto do trabalho
-- de uma caixa de entrada — responder, dizer quem assumiu, e enxergar mais da
-- metade das conversas, que são grupos e estavam de fora.
--
-- Três assuntos numa migration só porque são o mesmo assunto: as três coisas
-- que faltam para a tela de Conversas ser usável. Separá-las produziria três
-- deploys do mesmo arquivo do runtime.
--
--
-- 1. ESCREVER — pela fila que já existe, não por uma porta nova
--
-- `connection_runtime_commands` (20260826010000) já é exatamente isto: o
-- portal enfileira, a credencial de robô da conexão reivindica, o runtime
-- executa em loopback e publica um resultado sanitizado. A fase H já pendurou
-- `handoff_close` e `handoff_return_to_ai` nela pelo mesmo caminho. Esta
-- migration pendura mais dois tipos e nada mais — nenhuma tabela nova,
-- nenhuma porta nova na VPS, `ASSISTANT_HOST` continua em 127.0.0.1.
--
-- O texto da mensagem viaja em `private_payload`, que a RPC de conclusão apaga
-- (`private_payload = '{}'`). É a mesma regra de minimização que a Leva 1
-- obedece: o conteúdo existe enquanto é necessário e some quando deixa de ser.
--
-- Enfileirar exige conversa ESPELHADA. Sem essa guarda a fila viraria uma via
-- de envio frio para qualquer número — e envio frio é justamente o que
-- `allowed_recipients` no Bridge existe para barrar. Aqui a barreira é
-- declarada duas vezes, e de propósito: quem chama precisa ser membro da
-- organização E a conversa precisa já existir.
--
--
-- 2. ATRIBUIR — a coluna `owner` não bastava
--
-- `owner` responde "robô, IA ou gente?". Numa equipe de duas pessoas ela não
-- responde "gente QUEM?", e é essa a pergunta de quem abre a caixa de entrada
-- de manhã. O árbitro na VPS já guarda `atendente_id` e `atendente_nome` por
-- sessão desde a fase H — o que faltava era espelhá-los para cá.
--
-- Espelhados, e não escritos pelo portal: quem manda em quem atende continua
-- sendo o árbitro, que é o único lugar onde essa decisão vive. O portal pede
-- pela fila e lê o resultado de volta. Duas superfícies decidindo é o problema
-- que o árbitro existe para não ter.
--
--
-- 3. GRUPO — 94 das 169 conversas
--
-- A Leva 1 recusou grupo com uma frase honesta: "esta leva é atendimento
-- um-a-um". A conta medida em produção em 02/09/2026 é que 94 das 169
-- conversas do Bridge são grupos. Uma caixa de entrada que esconde 56% do que
-- chega não é uma caixa de entrada.
--
-- Entra o grupo e entra o NOME dele; não entra quem falou dentro dele. Mostrar
-- o remetente por bolha exigiria uma coluna a mais em `whatsapp_messages` e
-- outra rodada de decisão sobre guardar identidade de terceiro — fica para
-- quando for pedido.
--
-- `contact_phone` passa a guardar também identificador de grupo. O nome da
-- coluna fica: renomeá-la quebraria a Leva 1 inteira por cosmética, e
-- `chat_kind` diz sem ambiguidade como lê-la. O check afrouxa o mínimo — o
-- traço, que grupo antigo (`<telefone>-<carimbo>@g.us`) usa e telefone nunca.

begin;

-- ------------------------------------------------------------------ tabelas

alter table public.whatsapp_conversations
  add column if not exists chat_kind text not null default 'direto';

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_chat_kind;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_chat_kind
  check (chat_kind in ('direto', 'grupo'));

-- Quem assumiu, quando `owner = 'humano'`. Espelho do árbitro, e por isso sem
-- FK para `profiles`: o árbitro guarda o id que o portal lhe deu e não valida
-- nada contra o Supabase — ele não tem credencial para isso. Uma FK aqui faria
-- a sincronia inteira falhar por causa de uma sessão assumida por alguém que
-- saiu da equipe depois, o que é história, não erro.
alter table public.whatsapp_conversations
  add column if not exists attendant_id uuid;
alter table public.whatsapp_conversations
  add column if not exists attendant_name text not null default '';

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attendant_name;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attendant_name
  check (length(attendant_name) <= 120);

-- O check do identificador, agora com nome próprio nas duas tabelas. O
-- anterior era anônimo (`_contact_phone_check`), e constraint anônima é o que
-- torna a mensagem de erro ilegível — a lição de 20260829190000.
alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_contact_phone_check;
alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_contact_phone;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_contact_phone
  check (contact_phone ~ '^[0-9][0-9-]{5,39}$');

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_contact_phone_check;
alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_contact_phone;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_contact_phone
  check (contact_phone ~ '^[0-9][0-9-]{5,39}$');

-- ------------------------------------------------------------- a sincronia

/*
 * Mesma RPC da Leva 1, com três campos a mais. Reescrita por inteiro porque
 * `create or replace` de função é isso — e porque o corpo dela é o contrato
 * com o runtime, que precisa ser lido de uma vez.
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
    where entrada.phone ~ '^[0-9][0-9-]{5,39}$'
      and entrada.message_id <> ''
      and entrada.sent_at is not null
    on conflict (connection_id, contact_phone, message_id) do nothing
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
    'pruned', podadas,
    'syncedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------- a fila

-- O check reescrito por inteiro, com a lista toda. Mesma disciplina do tópico
-- de realtime: a lista mora num lugar só e é reescrita, nunca "acrescentada".
alter table public.connection_runtime_commands
  drop constraint if exists connection_runtime_commands_command_type_check;
alter table public.connection_runtime_commands
  add constraint connection_runtime_commands_command_type_check
  check (command_type in (
    'operator_verification_send', 'handoff_return_to_ai', 'handoff_close',
    'conversation_send', 'conversation_owner'
  ));

/*
 * Enfileirar um comando de conversa.
 *
 * `private.is_org_member` e não `private.can_manage_org`: responder cliente é
 * o trabalho de quem atende, e exigir cargo de administrador para escrever uma
 * mensagem transformaria a caixa de entrada em privilégio de dono.
 *
 * A idempotência sai de `clientId`, que o navegador gera por clique, e não do
 * conteúdo. Chavear pelo texto faria a segunda mensagem "ok" de uma conversa
 * ser silenciosamente engolida como repetição da primeira — e "ok" é
 * exatamente o que mais se digita duas vezes num atendimento.
 *
 * O nome do atendente é resolvido AQUI, do perfil, e não aceito do chamador. É
 * a única forma de a faixa não poder dizer "Atendente · Lucas" numa conversa
 * que outra pessoa assumiu.
 */
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
  conversa public.whatsapp_conversations%rowtype;
  cliente text := trim(coalesce(command_payload ->> 'clientId', ''));
  texto text := trim(coalesce(command_payload ->> 'text', ''));
  dono text := lower(trim(coalesce(command_payload ->> 'owner', '')));
  atendente uuid;
  atendente_nome text := '';
  carga jsonb;
  validade interval;
  chave text;
  comando_id uuid;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  if comando not in ('conversation_send', 'conversation_owner') then
    raise exception 'conversation command is invalid';
  end if;
  if cliente !~ '^[0-9a-fA-F-]{8,64}$' then
    raise exception 'conversation command needs a client id';
  end if;

  -- A conversa precisa já existir no espelho. Esta é a guarda que impede a
  -- fila de virar envio para número arbitrário — quem nunca falou com a
  -- organização não tem linha aqui, e portanto não tem como receber.
  select conversation.* into conversa
  from public.whatsapp_conversations conversation
  where conversation.organization_id = target_organization
    and conversation.connection_id = target_connection
    and conversation.contact_phone = chat;
  if not found then
    raise exception 'conversation is not mirrored for this connection';
  end if;

  if comando = 'conversation_send' then
    if texto = '' or length(texto) > 4000 then
      raise exception 'message text is invalid';
    end if;
    carga := jsonb_build_object('chat', chat, 'kind', conversa.chat_kind, 'text', texto);
    -- Dez minutos. Uma mensagem que ficou parada na fila além disso não deve
    -- sair sozinha: quem a escreveu já saiu da tela, e a conversa já mudou.
    validade := interval '10 minutes';
  else
    if dono not in ('bot', 'ia', 'humano') then
      raise exception 'conversation owner is invalid';
    end if;
    if dono = 'humano' then
      -- Sem `attendantId` a transição continua válida e significa "alguém
      -- pegue" — é o que um fluxo automático diz quando pede gente sem saber
      -- quem. Com id, ele precisa ser de alguém ativo NESTA organização.
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

  chave := encode(
    extensions.digest(
      concat_ws(':', 'conversation-command', comando, target_connection::text, chat, cliente),
      'sha256'
    ),
    'hex'
  );

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload,
    created_by, idempotency_key, expires_at
  ) values (
    target_organization, target_connection, comando, carga,
    auth.uid(), chave, now() + validade
  )
  -- Reenviar o MESMO clique depois de uma falha volta a valer; reenviá-lo
  -- enquanto o comando ainda está de pé devolve o comando existente sem
  -- duplicar a mensagem no WhatsApp de quem recebe.
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

/*
 * O desfecho de um comando, para a tela parar de dizer "enviando".
 *
 * Devolve `error_code` cru — slug estável, como o `MOTIVOS` do diário. O texto
 * em português vive no portal, e melhorar uma frase nunca pode depender de
 * migration.
 */
create or replace function public.nucleo_conversation_command_status(
  target_organization uuid,
  target_command uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comando public.connection_runtime_commands%rowtype;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;

  update public.connection_runtime_commands
  set status = 'expired',
      private_payload = '{}'::jsonb,
      error_code = 'expired',
      completed_at = now(),
      updated_at = now()
  where id = target_command
    and organization_id = target_organization
    and command_type in ('conversation_send', 'conversation_owner')
    and status in ('pending', 'claimed')
    and expires_at <= now();

  select command.* into comando
  from public.connection_runtime_commands command
  where command.id = target_command
    and command.organization_id = target_organization
    and command.command_type in ('conversation_send', 'conversation_owner');
  if not found then
    raise exception 'conversation command not found';
  end if;

  return jsonb_build_object(
    'commandId', comando.id,
    'command', comando.command_type,
    'status', comando.status,
    'errorCode', comando.error_code,
    'completedAt', comando.completed_at
  );
end;
$$;

revoke all on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.nucleo_conversation_command_status(uuid, uuid) from public;
grant execute on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.nucleo_conversation_command_status(uuid, uuid) to authenticated;

/*
 * A prova, na mesma transação.
 *
 * O check antigo era anônimo, e o nome que o Postgres dá a um check de coluna
 * (`<tabela>_<coluna>_check`) é convenção, não garantia. Se o `drop` não
 * casasse com o nome real, o check estrito SOBREVIVERIA ao lado do novo — os
 * dois valem juntos, e nenhum grupo com traço entraria. Não haveria erro de
 * migration: só uma funcionalidade que não funciona, descoberta dias depois.
 *
 * Um check por coluna é o que se afirma aqui, e um grupo de verdade é o que se
 * testa: `120363402768343021`, medido em produção em 02/09/2026.
 */
do $$
declare
  quantos integer;
begin
  select count(*) into quantos
  from pg_constraint restricao
  join pg_class tabela on tabela.oid = restricao.conrelid
  join pg_namespace esquema on esquema.oid = tabela.relnamespace
  where esquema.nspname = 'public'
    and tabela.relname in ('whatsapp_conversations', 'whatsapp_messages')
    and restricao.contype = 'c'
    and pg_get_constraintdef(restricao.oid) like '%contact_phone%';
  if quantos <> 2 then
    raise exception 'esperado um check de contact_phone por tabela, encontrado %', quantos;
  end if;

  if not ('120363402768343021' ~ '^[0-9][0-9-]{5,39}$') then
    raise exception 'o identificador de grupo novo não passa no check';
  end if;
  if not ('556592178164-1600000000' ~ '^[0-9][0-9-]{5,39}$') then
    raise exception 'o identificador de grupo antigo não passa no check';
  end if;
  if '' ~ '^[0-9][0-9-]{5,39}$' then
    raise exception 'o check aceita identificador vazio';
  end if;
end;
$$;

commit;
