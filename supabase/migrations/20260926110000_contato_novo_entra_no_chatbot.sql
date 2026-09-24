-- O contato novo entra no chatbot, nos dois formatos de fluxo.
--
-- Continuação de 20260926100000. Aquela migration ensinou o início do fluxo
-- com caminhos (v3) a criar o contato que não existe. Ao ligar o executor,
-- apareceram mais duas portas fechadas antes dele:
--
--   * `nucleo_chatbot_runtime_context` devolve `contact: null` para um número
--     que não está no CRM, e o executor desiste com `contact_not_found` antes de
--     avaliar qualquer fluxo;
--   * `nucleo_chatbot_execution_claim`, que inicia o fluxo simples (v2), levanta
--     `chatbot contact is not available` pelo mesmo motivo.
--
-- E faltava um detalhe na primeira: o contato criado não levava o evento
-- `contact.created`, que é o que a regra "primeira conversa" lê.
--
-- Agora as três usam `private.flow_contact_for`: telefone exato, depois as duas
-- formas do nono dígito e, quando o fluxo vai de fato começar, a criação com o
-- evento. O contexto só procura, nunca cria — quem manda "oi" sem que fluxo
-- nenhum se aplique continua fora do CRM. O executor da VPS (release com o
-- plano Base) avalia os fluxos como um contato novo quando o contexto vem sem
-- contato.
--
-- Os corpos são os de 20260825130000 e 20260926100000 com uma única troca cada:
-- a busca do contato. A conferência no fim confirma que nenhuma das três ainda
-- tem a busca antiga.
--
-- Aplicar pelo SQL Editor, depois de 20260926100000.

begin;

do $$
begin
  if to_regprocedure('private.contact_opted_out_of_ai(uuid, text)') is null then
    raise exception 'abortado: aplicar 20260926100000 antes';
  end if;
  if to_regprocedure('public.nucleo_chatbot_execution_claim(text, text, uuid, bigint)') is null
     or to_regprocedure('public.nucleo_chatbot_runtime_context(text)') is null then
    raise exception 'abortado: aplicar 20260825130000 antes';
  end if;
end;
$$;

create or replace function private.flow_contact_for(
  target_organization uuid, requester_phone text, create_if_missing boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  safe_phone text := regexp_replace(coalesce(requester_phone, ''), '[^0-9]', '', 'g');
  found_id uuid;
begin
  if target_organization is null or length(safe_phone) not between 8 and 15 then
    return null;
  end if;

  -- 1. O telefone exato, como sempre foi.
  select contact.id into found_id
  from public.contacts contact
  where contact.organization_id = target_organization
    and contact.deleted_at is null
    and (
      regexp_replace(coalesce(contact.phone, ''), '[^0-9]', '', 'g') = safe_phone
      or regexp_replace(coalesce(contact.whatsapp_id, ''), '[^0-9]', '', 'g') = safe_phone
    )
  order by contact.updated_at desc
  limit 1;

  -- 2. As duas formas do celular brasileiro: o contato pode estar gravado sem o
  -- nono dígito e escrever com ele, ou o contrário.
  if found_id is null then
    select contact.id into found_id
    from public.contacts contact
    where contact.organization_id = target_organization
      and contact.deleted_at is null
      and (
        private.customer_phone_matches(safe_phone, contact.phone)
        or private.customer_phone_matches(safe_phone, contact.whatsapp_id)
      )
    order by contact.updated_at desc
    limit 1;
  end if;

  if found_id is not null or not create_if_missing then
    return found_id;
  end if;

  -- 3. Não existe: nasce, com o mesmo evento que o portal grava ao criar um
  -- contato. É esse evento que faz a regra "primeira conversa" valer para ele.
  insert into public.contacts (organization_id, phone, source)
  values (target_organization, safe_phone, 'WhatsApp')
  returning id into found_id;
  insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload)
  values (target_organization, found_id, 'contact.created', 'contact', found_id, 'chatbot', jsonb_build_object('origem', 'WhatsApp'));
  return found_id;
end;
$$;

comment on function private.flow_contact_for(uuid, text, boolean) is
  'Contato da organizacao pelo telefone: exato, depois as duas formas do nono digito; com create_if_missing cria com origem WhatsApp e o evento contact.created. Usada pelo contexto do chatbot (sem criar) e pelo inicio do fluxo v2 e v3 (criando). Ver 20260926110000.';

revoke all on function private.flow_contact_for(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.nucleo_chatbot_runtime_context(requester_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  normalized_phone text := regexp_replace(coalesce(requester_phone, ''), '[^0-9]', '', 'g');
  contact_row public.contacts%rowtype;
  bots jsonb := '[]'::jsonb;
  contact_payload jsonb;
begin
  if robot_org is null then raise exception 'robot credential is inactive or revoked'; end if;
  if length(normalized_phone) not between 8 and 15 then raise exception 'requester phone is invalid'; end if;

  -- O telefone exato primeiro, depois as duas formas do nono dígito. Não cria:
  -- quem só escreveu não entra no CRM. Sem contato, o executor avalia os fluxos
  -- como um contato novo e só o fluxo que dispara o cria (20260926110000).
  select contact.* into contact_row
  from public.contacts contact
  where contact.id = private.flow_contact_for(robot_org, normalized_phone, false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', bot.id,
    'name', bot.name,
    'version', bot.version,
    'definition', bot.definition,
    'createdAt', bot.created_at,
    'updatedAt', bot.updated_at
  ) order by bot.created_at, bot.id), '[]'::jsonb) into bots
  from public.chatbot_definitions bot
  where bot.organization_id = robot_org
    and bot.active
    and bot.deleted_at is null;

  if contact_row.id is not null then
    contact_payload := jsonb_build_object(
      'id', contact_row.id,
      'name', contact_row.name,
      'company', contact_row.company,
      'createdAt', contact_row.created_at,
      'updatedAt', contact_row.updated_at,
      'lastInteractionAt', contact_row.last_interaction_at,
      'tags', coalesce((
        select jsonb_agg(link.tag_id order by link.tag_id)
        from public.contact_tags link
        where link.organization_id = robot_org and link.contact_id = contact_row.id
      ), '[]'::jsonb),
      'deals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', deal.id, 'stageId', deal.stage_id, 'status', deal.status,
          'updatedAt', deal.updated_at
        ) order by deal.created_at, deal.id)
        from public.deals deal
        where deal.organization_id = robot_org
          and deal.contact_id = contact_row.id and deal.deleted_at is null
      ), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', task.id, 'dueAt', task.due_at, 'completed', task.completed,
          'completedAt', task.completed_at
        ) order by task.created_at, task.id)
        from public.tasks task
        where task.organization_id = robot_org
          and task.contact_id = contact_row.id and task.deleted_at is null
      ), '[]'::jsonb),
      'eventTypes', coalesce((
        select jsonb_agg(event.event_type order by event.occurred_at, event.id)
        from public.contact_events event
        where event.organization_id = robot_org and event.contact_id = contact_row.id
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', 'chatbot-runtime-1',
    'contact', contact_payload,
    'chatbots', bots
  );
end;
$$;

create or replace function public.nucleo_chatbot_execution_claim(
  requester_phone text,
  external_message text,
  selected_chatbot uuid,
  expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  robot_user uuid := auth.uid();
  normalized_phone text := regexp_replace(coalesce(requester_phone, ''), '[^0-9]', '', 'g');
  contact_id uuid;
  claimed_id uuid;
  existing public.chatbot_executions%rowtype;
begin
  if robot_org is null then raise exception 'robot credential is inactive or revoked'; end if;
  if length(normalized_phone) not between 8 and 15
    or length(trim(coalesce(external_message, ''))) not between 1 and 500 then
    raise exception 'chatbot claim identity is invalid';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = robot_user
    and credential.organization_id = robot_org
    and credential.status = 'active' and credential.revoked_at is null
  limit 1;

  -- O fluxo disparou: o contato que ainda não existe nasce aqui, com o evento
  -- `contact.created` (20260926110000). Lead de anúncio chega desconhecido.
  contact_id := private.flow_contact_for(robot_org, normalized_phone, true);
  if contact_id is null then raise exception 'chatbot contact is not available'; end if;

  if not exists (
    select 1 from public.chatbot_definitions bot
    where bot.id = selected_chatbot and bot.organization_id = robot_org
      and bot.active and bot.deleted_at is null and bot.version = expected_version
  ) then raise exception 'chatbot definition changed before execution'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    robot_org::text || ':' || robot_connection::text || ':' || external_message || ':' || selected_chatbot::text, 0
  ));
  select * into existing from public.chatbot_executions execution
  where execution.organization_id = robot_org
    and execution.connection_id = robot_connection
    and execution.external_message_id = external_message
    and execution.chatbot_id = selected_chatbot
  limit 1;
  if found then
    return jsonb_build_object('status', 'already_processed', 'executionId', existing.id);
  end if;

  insert into public.chatbot_executions (
    organization_id, chatbot_id, connection_id, contact_id, claimed_by,
    external_message_id, status, result
  ) values (
    robot_org, selected_chatbot, robot_connection, contact_id, robot_user,
    external_message, 'claimed', jsonb_build_object('chatbotVersion', expected_version)
  ) returning id into claimed_id;
  return jsonb_build_object('status', 'claimed', 'executionId', claimed_id, 'contactId', contact_id);
end;
$$;

create or replace function public.nucleo_flow_start(
  requester_phone text, external_message text, selected_chatbot uuid,
  expected_version bigint, conversation_session uuid, conversation_epoch bigint default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org uuid:=private.robot_organization(); conn uuid:=private.flow_connection();
  safe_phone text:=regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g');
  bot public.chatbot_definitions%rowtype; run public.chatbot_flow_executions%rowtype;
  contact uuid;
begin
  if length(safe_phone) not between 10 and 15 or conversation_session is null or conversation_epoch is null or conversation_epoch<0
    or length(trim(coalesce(external_message,''))) not between 1 and 500 then
    raise exception 'flow identity invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||conn::text||':'||safe_phone,0));
  select * into run from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.external_message_id=external_message;
  if found then
    if run.requester_phone<>safe_phone or run.chatbot_id<>selected_chatbot
      or run.conversation_session_id<>conversation_session or run.conversation_epoch<>conversation_epoch then raise exception 'flow identity mismatch'; end if;
    return private.flow_envelope(run);
  end if;
  if exists(select 1 from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.requester_phone=safe_phone
    and f.status in ('ready','executing','suspended','needs_review')) then
    raise exception 'flow conversation already running';
  end if;
  select * into bot from public.chatbot_definitions b where b.id=selected_chatbot
    and b.organization_id=org and b.active and b.deleted_at is null and b.version=expected_version for share;
  if not found then raise exception 'flow definition changed'; end if;
  perform private.flow_validate(bot.definition);
  -- Acha pelo telefone exato ou pelas duas formas do nono dígito; se não houver,
  -- cria com o evento `contact.created` (20260926110000).
  contact:=private.flow_contact_for(org, safe_phone, true);
  if contact is null then raise exception 'flow contact unavailable'; end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=contact and c.channel='whatsapp' and c.state='handed_off') then
    raise exception 'flow conversation with human';
  end if;
  insert into public.chatbot_flow_executions(organization_id,connection_id,contact_id,chatbot_id,
    chatbot_version,definition_snapshot,requester_phone,conversation_session_id,conversation_epoch,external_message_id,cursor_node_id)
  values(org,conn,contact,bot.id,bot.version,bot.definition,safe_phone,conversation_session,nucleo_flow_start.conversation_epoch,external_message,
    private.flow_target(bot.definition,'condicoes','padrao')) returning * into run;
  return private.flow_envelope(run);
end;
$$;

-- Conferência: nenhuma das três ainda procura o contato do jeito antigo, e a
-- função auxiliar não é executável de fora.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('nucleo_chatbot_runtime_context', 'nucleo_chatbot_execution_claim', 'nucleo_flow_start')
      and position('flow_contact_for' in p.prosrc) = 0
  ) then
    raise exception 'conferencia: alguma funcao ainda nao usa private.flow_contact_for';
  end if;
  if has_function_privilege('anon', 'private.flow_contact_for(uuid, text, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_contact_for(uuid, text, boolean)', 'EXECUTE') then
    raise exception 'conferencia: private.flow_contact_for nao pode ser executavel de fora';
  end if;
end;
$$;

commit;
