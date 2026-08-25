-- Executor de chatbots no runtime 24/7.
-- O robô recebe somente a ficha necessária para avaliar regras e conclui uma
-- execução por RPC idempotente. Organização e conexão sempre vêm da credencial.

begin;

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

  select contact.* into contact_row
  from public.contacts contact
  where contact.organization_id = robot_org
    and contact.deleted_at is null
    and (
      regexp_replace(coalesce(contact.phone, ''), '[^0-9]', '', 'g') = normalized_phone
      or regexp_replace(coalesce(contact.whatsapp_id, ''), '[^0-9]', '', 'g') = normalized_phone
    )
  order by contact.updated_at desc
  limit 1;

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

  select contact.id into contact_id
  from public.contacts contact
  where contact.organization_id = robot_org and contact.deleted_at is null
    and (
      regexp_replace(coalesce(contact.phone, ''), '[^0-9]', '', 'g') = normalized_phone
      or regexp_replace(coalesce(contact.whatsapp_id, ''), '[^0-9]', '', 'g') = normalized_phone
    )
  order by contact.updated_at desc limit 1;
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

create or replace function public.nucleo_chatbot_execution_complete(
  execution_id uuid,
  completion_status text,
  completion_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  execution public.chatbot_executions%rowtype;
  tag_text text;
  safe_add uuid[] := array[]::uuid[];
  safe_remove uuid[] := array[]::uuid[];
begin
  if robot_org is null then raise exception 'robot credential is inactive or revoked'; end if;
  if completion_status not in ('sent', 'ignored', 'failed')
    or jsonb_typeof(coalesce(completion_result, '{}'::jsonb)) <> 'object'
    or pg_catalog.octet_length(coalesce(completion_result, '{}'::jsonb)::text) > 8192 then
    raise exception 'chatbot completion is invalid';
  end if;
  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid() and credential.organization_id = robot_org
    and credential.status = 'active' and credential.revoked_at is null limit 1;

  select * into execution from public.chatbot_executions item
  where item.id = execution_id and item.organization_id = robot_org
    and item.connection_id = robot_connection and item.claimed_by = auth.uid()
  for update;
  if not found then raise exception 'chatbot execution is not available'; end if;
  if execution.status <> 'claimed' then
    return jsonb_build_object('status', execution.status, 'executionId', execution.id);
  end if;

  if completion_status = 'sent' then
    if jsonb_typeof(coalesce(completion_result -> 'addTags', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(completion_result -> 'removeTags', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(completion_result -> 'addTags', '[]'::jsonb)) > 100
      or jsonb_array_length(coalesce(completion_result -> 'removeTags', '[]'::jsonb)) > 100 then
      raise exception 'chatbot tags are invalid';
    end if;
    for tag_text in select jsonb_array_elements_text(coalesce(completion_result -> 'addTags', '[]'::jsonb)) loop
      begin safe_add := array_append(safe_add, tag_text::uuid);
      exception when others then raise exception 'chatbot tag is invalid'; end;
    end loop;
    for tag_text in select jsonb_array_elements_text(coalesce(completion_result -> 'removeTags', '[]'::jsonb)) loop
      begin safe_remove := array_append(safe_remove, tag_text::uuid);
      exception when others then raise exception 'chatbot tag is invalid'; end;
    end loop;
    if exists (
      select 1 from unnest(safe_add || safe_remove) requested(tag_id)
      where not exists (select 1 from public.tags tag where tag.id = requested.tag_id
        and tag.organization_id = robot_org and tag.deleted_at is null)
    ) then raise exception 'chatbot tag belongs to another organization or was removed'; end if;

    delete from public.contact_tags link
    where link.organization_id = robot_org and link.contact_id = execution.contact_id
      and link.tag_id = any(safe_remove);
    insert into public.contact_tags (organization_id, contact_id, tag_id)
    select robot_org, execution.contact_id, requested.tag_id from unnest(safe_add) requested(tag_id)
    on conflict (contact_id, tag_id) do nothing;

    update public.chatbot_definitions bot
    set executions = bot.executions + 1, last_execution_at = now(), updated_at = bot.updated_at
    where bot.id = execution.chatbot_id and bot.organization_id = robot_org;
    insert into public.contact_events (
      organization_id, contact_id, event_type, entity_type, entity_id,
      source, payload, occurred_at, created_by
    ) values (
      robot_org, execution.contact_id, 'chatbot.executado', 'chatbot', execution.chatbot_id,
      'runtime', jsonb_build_object(
        'mensagemRecebidaId', execution.external_message_id,
        'etiquetas', to_jsonb(safe_add || safe_remove),
        'runtime', 'vps'
      ), now(), auth.uid()
    );
  end if;

  update public.chatbot_executions item
  set status = completion_status,
      result = coalesce(completion_result, '{}'::jsonb),
      completed_at = now()
  where item.id = execution.id;
  return jsonb_build_object('status', completion_status, 'executionId', execution.id);
end;
$$;

revoke all on function public.nucleo_chatbot_runtime_context(text) from public;
revoke all on function public.nucleo_chatbot_execution_claim(text, text, uuid, bigint) from public;
revoke all on function public.nucleo_chatbot_execution_complete(uuid, text, jsonb) from public;
grant execute on function public.nucleo_chatbot_runtime_context(text) to authenticated;
grant execute on function public.nucleo_chatbot_execution_claim(text, text, uuid, bigint) to authenticated;
grant execute on function public.nucleo_chatbot_execution_complete(uuid, text, jsonb) to authenticated;

commit;
