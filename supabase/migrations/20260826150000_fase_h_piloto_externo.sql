-- Fase H — rollout controlado do assistente externo e fila humana operacional.
--
-- O navegador escolhe apenas contatos já pertencentes à organização. A VPS
-- deriva organização e conexão da credencial de robô e decide o acesso pelo
-- telefone real recebido do WhatsApp. Telefones nunca entram em logs públicos.

begin;

create table if not exists public.customer_assistant_pilot_contacts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  contact_id uuid not null,
  added_by uuid not null references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (profile_id, contact_id),
  foreign key (profile_id, organization_id)
    references public.assistant_profiles(id, organization_id) on delete cascade,
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id) on delete cascade
);

alter table public.customer_assistant_pilot_contacts enable row level security;
revoke all on public.customer_assistant_pilot_contacts from anon, authenticated;
grant select, insert, update, delete on public.customer_assistant_pilot_contacts to authenticated;

drop policy if exists customer_assistant_pilot_contacts_read
  on public.customer_assistant_pilot_contacts;
create policy customer_assistant_pilot_contacts_read
  on public.customer_assistant_pilot_contacts for select to authenticated
  using (private.can_manage_org(organization_id));
drop policy if exists customer_assistant_pilot_contacts_insert
  on public.customer_assistant_pilot_contacts;
create policy customer_assistant_pilot_contacts_insert
  on public.customer_assistant_pilot_contacts for insert to authenticated
  with check (private.can_manage_org(organization_id) and added_by = auth.uid());
drop policy if exists customer_assistant_pilot_contacts_update
  on public.customer_assistant_pilot_contacts;
create policy customer_assistant_pilot_contacts_update
  on public.customer_assistant_pilot_contacts for update to authenticated
  using (private.can_manage_org(organization_id))
  with check (private.can_manage_org(organization_id));
drop policy if exists customer_assistant_pilot_contacts_delete
  on public.customer_assistant_pilot_contacts;
create policy customer_assistant_pilot_contacts_delete
  on public.customer_assistant_pilot_contacts for delete to authenticated
  using (private.can_manage_org(organization_id));

create or replace function private.customer_phone_matches(left_phone text, right_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select
      regexp_replace(coalesce(left_phone, ''), '[^0-9]', '', 'g') as left_value,
      regexp_replace(coalesce(right_phone, ''), '[^0-9]', '', 'g') as right_value
  ), aliases as (
    select left_value, right_value,
      case when length(left_value) = 13 and left_value like '55__9%'
        then substring(left_value from 1 for 4) || substring(left_value from 6)
        else left_value end as left_legacy,
      case when length(right_value) = 13 and right_value like '55__9%'
        then substring(right_value from 1 for 4) || substring(right_value from 6)
        else right_value end as right_legacy
    from normalized
  )
  select length(left_value) between 10 and 15
    and length(right_value) between 10 and 15
    and (left_value = right_value or left_legacy = right_value
      or left_value = right_legacy or left_legacy = right_legacy)
  from aliases;
$$;

create or replace function private.robot_connection()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select credential.connection_id
  from public.connection_robot_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = private.robot_organization()
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  limit 1;
$$;

revoke all on function private.customer_phone_matches(text, text) from public;
revoke all on function private.robot_connection() from public;
create or replace function public.customer_assistant_rollout_update(
  target_profile uuid,
  rollout_mode text,
  selected_contacts uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.assistant_profiles%rowtype;
  safe_mode text := lower(trim(coalesce(rollout_mode, '')));
  requested_count integer;
  inserted_count integer;
  pilot_campaign uuid;
  skill_row record;
begin
  if safe_mode not in ('off', 'pilot', 'active') then
    raise exception 'customer assistant rollout mode is invalid';
  end if;

  select profile.* into profile_row
  from public.assistant_profiles profile
  where profile.id = target_profile and profile.audience = 'customer'
  for update;
  if not found or not private.can_manage_org(profile_row.organization_id) then
    raise exception 'customer assistant management required';
  end if;

  select count(distinct contact_id) into requested_count
  from unnest(coalesce(selected_contacts, '{}'::uuid[])) contact_id;
  if safe_mode = 'pilot' and requested_count = 0 then
    raise exception 'select at least one contact for pilot mode';
  end if;

  delete from public.customer_assistant_pilot_contacts pilot
  where pilot.organization_id = profile_row.organization_id
    and pilot.profile_id = profile_row.id;

  insert into public.customer_assistant_pilot_contacts (
    organization_id, profile_id, contact_id, added_by
  )
  select profile_row.organization_id, profile_row.id, contact.id, auth.uid()
  from public.contacts contact
  join (
    select distinct value as id
    from unnest(coalesce(selected_contacts, '{}'::uuid[])) value
  ) chosen on chosen.id = contact.id
  where contact.organization_id = profile_row.organization_id
    and contact.deleted_at is null;
  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then
    raise exception 'one or more pilot contacts are invalid';
  end if;

  update public.assistant_profiles profile
  set process_config = jsonb_set(
        coalesce(profile.process_config, '{}'::jsonb),
        '{rollout}',
        jsonb_build_object('mode', safe_mode, 'updatedAt', now()),
        true
      ),
      updated_by = auth.uid(),
      updated_at = now()
  where profile.id = profile_row.id;

  if safe_mode = 'pilot' then
    select campaign.id into pilot_campaign
    from public.organization_campaigns campaign
    where campaign.organization_id = profile_row.organization_id
      and campaign.name = 'Piloto Atendimento Major'
    order by campaign.created_at
    limit 1;

    if pilot_campaign is null then
      insert into public.organization_campaigns (
        organization_id, assistant_profile_id, name, status, objective,
        offer, audience_description, desired_outcome, is_default,
        configuration, created_by, updated_by
      ) values (
        profile_row.organization_id, profile_row.id,
        'Piloto Atendimento Major', 'test',
        'Validar recepção, qualificação, vendas, suporte, agenda e transferência humana.',
        '', 'Contatos selecionados para o piloto controlado.',
        'Qualificar, agendar ou transferir com segurança.', false,
        jsonb_build_object('rollout', 'pilot', 'managedBy', 'nucleo-major'),
        auth.uid(), auth.uid()
      ) returning id into pilot_campaign;
    else
      update public.organization_campaigns campaign
      set assistant_profile_id = profile_row.id,
          status = 'test',
          configuration = coalesce(campaign.configuration, '{}'::jsonb)
            || jsonb_build_object('rollout', 'pilot', 'managedBy', 'nucleo-major'),
          updated_by = auth.uid(),
          updated_at = now()
      where campaign.id = pilot_campaign;
    end if;

    for skill_row in
      select skill.id, skill.slug,
        case skill.slug
          when 'recepcao' then 10 when 'pre-qualificacao' then 20
          when 'vendas' then 30 when 'suporte' then 40 else 50 end as priority
      from public.skill_definitions skill
      where skill.owner_type = 'platform' and skill.status = 'published'
        and skill.slug in ('recepcao', 'pre-qualificacao', 'vendas', 'suporte', 'agenda')
    loop
      insert into public.assistant_profile_skills (
        organization_id, profile_id, skill_id, enabled, priority, updated_by
      ) values (
        profile_row.organization_id, profile_row.id, skill_row.id, true,
        skill_row.priority, auth.uid()
      ) on conflict (profile_id, skill_id) do update
        set enabled = true, priority = excluded.priority,
            updated_by = auth.uid(), updated_at = now();

      insert into public.campaign_skills (
        organization_id, campaign_id, skill_id, priority
      ) values (
        profile_row.organization_id, pilot_campaign, skill_row.id, skill_row.priority
      ) on conflict (campaign_id, skill_id) do update
        set priority = excluded.priority;
    end loop;

    if (select count(*) from public.campaign_skills binding
        join public.skill_definitions skill on skill.id = binding.skill_id
        where binding.campaign_id = pilot_campaign
          and skill.slug in ('recepcao', 'pre-qualificacao', 'vendas', 'suporte', 'agenda')) <> 5 then
      raise exception 'publish the five official customer skills before enabling the pilot';
    end if;

    insert into public.campaign_knowledge_collections (
      organization_id, campaign_id, collection_id
    )
    select collection.organization_id, pilot_campaign, collection.id
    from public.knowledge_collections collection
    where collection.organization_id = profile_row.organization_id
      and collection.audience = 'external'
      and collection.scope_type <> 'personal'
    on conflict (campaign_id, collection_id) do nothing;
  end if;

  return jsonb_build_object(
    'status', 'updated', 'mode', safe_mode,
    'pilotContacts', inserted_count, 'campaignId', pilot_campaign
  );
end;
$$;

create or replace function public.nucleo_customer_assistant_access(requester_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid := private.robot_connection();
  profile_row public.assistant_profiles%rowtype;
  safe_mode text;
  matched_contacts uuid[];
  pilot_campaign uuid;
begin
  if robot_org is null or robot_connection is null then
    raise exception 'active robot credential required';
  end if;

  select profile.* into profile_row
  from public.assistant_profiles profile
  where profile.organization_id = robot_org and profile.audience = 'customer'
  limit 1;
  if not found or not profile_row.active then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', 'off', 'reason', 'profile_inactive'
    );
  end if;

  safe_mode := coalesce(profile_row.process_config #>> '{rollout,mode}', 'off');
  if safe_mode not in ('off', 'pilot', 'active') then safe_mode := 'off'; end if;
  if safe_mode = 'off' then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode, 'reason', 'rollout_off'
    );
  end if;
  if safe_mode = 'active' then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', true,
      'mode', safe_mode, 'reason', 'active'
    );
  end if;

  select coalesce(array_agg(distinct contact.id), '{}'::uuid[])
  into matched_contacts
  from public.customer_assistant_pilot_contacts pilot
  join public.contacts contact
    on contact.id = pilot.contact_id
   and contact.organization_id = pilot.organization_id
  where pilot.organization_id = robot_org
    and pilot.profile_id = profile_row.id
    and pilot.active
    and contact.deleted_at is null
    and (
      private.customer_phone_matches(requester_phone, contact.phone)
      or private.customer_phone_matches(requester_phone, contact.whatsapp_id)
    );

  if cardinality(matched_contacts) <> 1 then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode,
      'reason', case when cardinality(matched_contacts) = 0
        then 'contact_not_selected' else 'contact_ambiguous' end
    );
  end if;

  select campaign.id into pilot_campaign
  from public.organization_campaigns campaign
  where campaign.organization_id = robot_org
    and campaign.assistant_profile_id = profile_row.id
    and campaign.name = 'Piloto Atendimento Major'
    and campaign.status = 'test'
  order by campaign.created_at
  limit 1;
  if pilot_campaign is null then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode, 'reason', 'pilot_campaign_unavailable'
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', 'customer-rollout-1', 'allowed', true,
    'mode', safe_mode, 'reason', 'pilot_contact',
    'contactId', matched_contacts[1],
    'sourceData', jsonb_build_object(
      'targetMode', 'campaign', 'targetCampaignId', pilot_campaign
    )
  );
end;
$$;

revoke all on function public.customer_assistant_rollout_update(uuid, text, uuid[]) from public;
revoke all on function public.nucleo_customer_assistant_access(text) from public;
grant execute on function public.customer_assistant_rollout_update(uuid, text, uuid[]) to authenticated;
grant execute on function public.nucleo_customer_assistant_access(text) to authenticated;

-- A fila deixa de aceitar updates diretos: toda transição passa por RPC,
-- valida cargo, trava a linha e enfileira efeitos locais na VPS.
alter table public.customer_handoff_requests
  add column if not exists accepted_by uuid references public.profiles(id) on delete set null,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists routing_address text
    check (routing_address is null or routing_address ~ '^[0-9]{10,15}$'),
  add column if not exists last_error_code text
    check (last_error_code is null or last_error_code ~ '^[a-z0-9_-]{1,80}$');

alter table public.customer_handoff_requests
  drop constraint if exists customer_handoff_requests_status_check;
alter table public.customer_handoff_requests
  add constraint customer_handoff_requests_status_check
  check (status in (
    'requested', 'accepted', 'completing', 'returning',
    'completed', 'returned', 'cancelled'
  ));

revoke update on public.customer_handoff_requests from authenticated;
drop policy if exists customer_handoff_requests_read on public.customer_handoff_requests;
drop policy if exists customer_handoff_requests_update on public.customer_handoff_requests;
create policy customer_handoff_requests_read
  on public.customer_handoff_requests for select to authenticated
  using (private.can_manage_org(organization_id));

alter table public.connection_runtime_commands
  drop constraint if exists connection_runtime_commands_command_type_check;
alter table public.connection_runtime_commands
  add constraint connection_runtime_commands_command_type_check
  check (command_type in (
    'operator_verification_send', 'handoff_return_to_ai', 'handoff_close'
  ));

drop index if exists public.customer_handoff_one_open_idx;
create unique index customer_handoff_one_open_idx
  on public.customer_handoff_requests (organization_id, context_id)
  where status in ('requested', 'accepted', 'completing', 'returning');

create or replace function public.customer_handoff_transition(
  target_request uuid,
  requested_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.customer_handoff_requests%rowtype;
  action text := lower(trim(coalesce(requested_action, '')));
  contact_phone text;
  command_id uuid;
  command_key text;
begin
  select request.* into request_row
  from public.customer_handoff_requests request
  where request.id = target_request
  for update;
  if not found or not private.can_manage_org(request_row.organization_id) then
    raise exception 'handoff management required';
  end if;

  if action = 'accept' then
    if request_row.status = 'accepted' and request_row.accepted_by = auth.uid() then
      return jsonb_build_object('status', 'accepted', 'requestId', request_row.id);
    end if;
    if request_row.status <> 'requested' then
      raise exception 'handoff is no longer available';
    end if;
    update public.customer_handoff_requests
    set status = 'accepted', accepted_by = auth.uid(), accepted_at = now(),
        last_error_code = null, updated_at = now()
    where id = request_row.id;
    return jsonb_build_object('status', 'accepted', 'requestId', request_row.id);
  end if;

  if action not in ('complete', 'return_to_ai') then
    raise exception 'handoff action is invalid';
  end if;
  if request_row.status not in ('requested', 'accepted') then
    raise exception 'handoff cannot transition from its current status';
  end if;
  if request_row.connection_id is null or request_row.contact_id is null then
    raise exception 'handoff does not have a routable conversation';
  end if;

  select coalesce(
    request_row.routing_address,
    regexp_replace(coalesce(nullif(contact.phone, ''), contact.whatsapp_id, ''), '[^0-9]', '', 'g')
  )
  into contact_phone
  from public.contacts contact
  where contact.id = request_row.contact_id
    and contact.organization_id = request_row.organization_id
    and contact.deleted_at is null;
  if length(contact_phone) not between 10 and 15 then
    raise exception 'handoff contact phone is invalid';
  end if;

  command_key := encode(extensions.digest(
    concat_ws(':', 'customer-handoff', request_row.id::text, action), 'sha256'
  ), 'hex');
  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload,
    created_by, idempotency_key, expires_at
  ) values (
    request_row.organization_id, request_row.connection_id,
    case when action = 'complete' then 'handoff_close' else 'handoff_return_to_ai' end,
    jsonb_build_object(
      'requestId', request_row.id,
      'contact', contact_phone,
      'previousStatus', request_row.status
    ),
    auth.uid(), command_key, now() + interval '5 minutes'
  ) on conflict (organization_id, idempotency_key) do update
    set available_at = case
          when connection_runtime_commands.status in ('failed', 'expired') then now()
          else connection_runtime_commands.available_at end,
        expires_at = case
          when connection_runtime_commands.status in ('failed', 'expired') then now() + interval '5 minutes'
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
  returning id into command_id;

  update public.customer_handoff_requests
  set status = case when action = 'complete' then 'completing' else 'returning' end,
      accepted_by = coalesce(accepted_by, auth.uid()),
      accepted_at = coalesce(accepted_at, now()),
      last_error_code = null,
      updated_at = now()
  where id = request_row.id;

  return jsonb_build_object(
    'status', case when action = 'complete' then 'completing' else 'returning' end,
    'requestId', request_row.id, 'commandId', command_id
  );
end;
$$;

revoke all on function public.customer_handoff_transition(uuid, text) from public;
grant execute on function public.customer_handoff_transition(uuid, text) to authenticated;

-- Garante que toda transferência tenha um contato operacional no CRM.
create or replace function public.nucleo_customer_handoff_request(
  conversation_key_hash text,
  requester_phone text,
  handoff_reason text,
  handoff_summary text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  request_id uuid;
  resolved_contact_id uuid;
  normalized_phone text := regexp_replace(coalesce(requester_phone, ''), '[^0-9]', '', 'g');
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if handoff_reason not in ('requested_human', 'low_confidence', 'sensitive_topic', 'commercial_exception', 'tool_unavailable', 'skill_limit') then
    raise exception 'invalid handoff reason';
  end if;
  if length(normalized_phone) not between 10 and 15 then
    raise exception 'valid customer phone required';
  end if;

  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_handoff_request.conversation_key_hash
    and context.state in ('active', 'handed_off') and context.audience = 'customer'
  order by case when context.state = 'active' then 0 else 1 end
  limit 1 for update;
  if not found then raise exception 'customer intelligence context required'; end if;

  resolved_contact_id := context_row.contact_id;
  if resolved_contact_id is null then
    select contact.id into resolved_contact_id
    from public.contacts contact
    where contact.organization_id = robot_org and contact.deleted_at is null
      and (private.customer_phone_matches(normalized_phone, contact.phone)
        or private.customer_phone_matches(normalized_phone, contact.whatsapp_id))
    order by contact.updated_at desc limit 1;
    if resolved_contact_id is null then
      insert into public.contacts (
        organization_id, name, phone, source, created_by, updated_by
      ) values (
        robot_org, 'Contato WhatsApp', normalized_phone,
        case when context_row.campaign_id is null then 'WhatsApp' else 'Campanha WhatsApp' end,
        auth.uid(), auth.uid()
      ) returning id into resolved_contact_id;
    end if;
    update public.conversation_intelligence_contexts
    set contact_id = resolved_contact_id, updated_at = now()
    where id = context_row.id;
  end if;

  if context_row.state = 'handed_off' then
    select request.id into request_id
    from public.customer_handoff_requests request
    where request.organization_id = robot_org and request.context_id = context_row.id
      and request.status in ('requested', 'accepted', 'completing', 'returning')
    limit 1;
    return jsonb_build_object(
      'status', 'handoff_requested', 'handoffId', request_id,
      'reason', handoff_reason, 'alreadyRequested', true,
      'message', 'A transferência humana já estava solicitada.'
    );
  end if;

  update public.conversation_intelligence_contexts
  set state = 'handed_off', contact_id = resolved_contact_id, updated_at = now()
  where id = context_row.id;
  insert into public.customer_handoff_requests (
    organization_id, connection_id, contact_id, context_id, reason_code, summary,
    routing_address
  ) values (
    robot_org, context_row.connection_id, resolved_contact_id, context_row.id,
    handoff_reason, left(trim(coalesce(handoff_summary, '')), 1000),
    normalized_phone
  ) on conflict (organization_id, context_id)
      where status in ('requested', 'accepted', 'completing', 'returning')
    do update set reason_code = excluded.reason_code, summary = excluded.summary,
      routing_address = excluded.routing_address,
      updated_at = now()
  returning id into request_id;
  return jsonb_build_object(
    'status', 'handoff_requested', 'handoffId', request_id,
    'reason', handoff_reason,
    'message', 'Transferência humana solicitada; a automação deve encerrar este atendimento.'
  );
end;
$$;

-- Conclusão estendida: aplica o resultado da VPS à fila e ao contexto.
create or replace function public.nucleo_runtime_command_complete(
  target_command uuid,
  completion_status text,
  completion_error_code text default null,
  completion_result jsonb default '{}'::jsonb,
  runtime_instance uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid := private.robot_connection();
  safe_status text := lower(trim(coalesce(completion_status, '')));
  safe_error text := lower(trim(coalesce(completion_error_code, '')));
  command_row public.connection_runtime_commands%rowtype;
  handoff_id uuid;
  previous_status text;
  context_id uuid;
begin
  if robot_org is null or robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;
  if safe_status not in ('completed', 'failed') then
    raise exception 'runtime command completion status is invalid';
  end if;
  if safe_error <> '' and safe_error !~ '^[a-z0-9_-]{1,80}$' then
    raise exception 'runtime command error code is invalid';
  end if;
  if jsonb_typeof(coalesce(completion_result, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(completion_result, '{}'::jsonb)::text) > 2048 then
    raise exception 'runtime command result is invalid';
  end if;

  select command.* into command_row
  from public.connection_runtime_commands command
  where command.id = target_command
    and command.organization_id = robot_org
    and command.connection_id = robot_connection
    and command.status = 'claimed'
    and command.claimed_by = auth.uid()
    and (runtime_instance is null or command.claimed_instance = runtime_instance)
  for update;
  if not found then raise exception 'runtime command is not claimed by this runtime'; end if;

  if command_row.command_type in ('handoff_close', 'handoff_return_to_ai') then
    handoff_id := nullif(command_row.private_payload ->> 'requestId', '')::uuid;
    previous_status := coalesce(nullif(command_row.private_payload ->> 'previousStatus', ''), 'accepted');
  end if;

  update public.connection_runtime_commands command
  set status = safe_status,
      private_payload = '{}'::jsonb,
      error_code = nullif(safe_error, ''),
      public_result = coalesce(completion_result, '{}'::jsonb),
      completed_at = now(), updated_at = now()
  where command.id = command_row.id;

  if handoff_id is not null then
    select request.context_id into context_id
    from public.customer_handoff_requests request
    where request.id = handoff_id and request.organization_id = robot_org;
    if safe_status = 'completed' then
      update public.customer_handoff_requests
      set status = case when command_row.command_type = 'handoff_close'
            then 'completed' else 'returned' end,
          completed_at = now(), last_error_code = null, updated_at = now()
      where id = handoff_id and organization_id = robot_org;
      update public.conversation_intelligence_contexts
      set state = case when command_row.command_type = 'handoff_close'
            then 'closed' else 'active' end,
          updated_at = now()
      where id = context_id and organization_id = robot_org;
    else
      update public.customer_handoff_requests
      set status = case when previous_status in ('requested', 'accepted')
            then previous_status else 'accepted' end,
          last_error_code = coalesce(nullif(safe_error, ''), 'runtime_failed'),
          updated_at = now()
      where id = handoff_id and organization_id = robot_org;
    end if;
  end if;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid() and organization_id = robot_org
    and connection_id = robot_connection and status = 'active';
  return jsonb_build_object(
    'commandId', command_row.id, 'status', safe_status, 'completedAt', now()
  );
end;
$$;

drop trigger if exists customer_assistant_pilot_realtime
  on public.customer_assistant_pilot_contacts;
create trigger customer_assistant_pilot_realtime
after insert or update or delete on public.customer_assistant_pilot_contacts
for each row execute function private.portal_realtime_notify('intelligence');

drop trigger if exists customer_handoff_requests_realtime
  on public.customer_handoff_requests;
create trigger customer_handoff_requests_realtime
after insert or update or delete on public.customer_handoff_requests
for each row execute function private.portal_realtime_notify('handoffs');

commit;
