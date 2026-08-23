begin;

create table if not exists public.chatbot_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  definition jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  executions bigint not null default 0,
  last_execution_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id)
);

create table if not exists public.chatbot_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chatbot_id uuid not null,
  version bigint not null,
  name text not null,
  active boolean not null,
  definition jsonb not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (chatbot_id, organization_id)
    references public.chatbot_definitions(id, organization_id) on delete cascade,
  unique (chatbot_id, version)
);

create table if not exists public.chatbot_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chatbot_id uuid not null,
  connection_id uuid references public.whatsapp_connections(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  claimed_by uuid not null references public.profiles(id) on delete restrict,
  external_message_id text,
  status text not null check (status in ('claimed', 'sent', 'ignored', 'failed')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (chatbot_id, organization_id)
    references public.chatbot_definitions(id, organization_id) on delete cascade
);

create unique index if not exists chatbot_execution_idempotency
  on public.chatbot_executions (organization_id, connection_id, external_message_id, chatbot_id)
  where external_message_id is not null;

create table if not exists public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Nova conversa',
  channel text not null default 'web' check (channel in ('web', 'whatsapp')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (thread_id, organization_id)
    references public.assistant_threads(id, organization_id) on delete cascade
);

create table if not exists public.assistant_tool_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  message_id uuid references public.assistant_messages(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'confirmed', 'running', 'completed', 'rejected', 'failed')),
  idempotency_key text not null,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (thread_id, organization_id)
    references public.assistant_threads(id, organization_id) on delete cascade,
  unique (organization_id, idempotency_key)
);

create index if not exists chatbot_definitions_org_idx
  on public.chatbot_definitions (organization_id, updated_at desc) where deleted_at is null;
create index if not exists assistant_threads_user_idx
  on public.assistant_threads (organization_id, user_id, updated_at desc);
create index if not exists assistant_messages_thread_idx
  on public.assistant_messages (thread_id, created_at, id);

-- Canal de invalidação para o portal. A linha não carrega telefone, código,
-- token nem conteúdo: ela diz somente qual parte da organização mudou. Isso
-- permite Realtime com RLS mesmo quando a tabela de origem é deliberadamente
-- inacessível ao navegador (como os desafios de verificação de operadores).
create table if not exists public.portal_realtime_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  topic text not null check (topic in ('connections', 'operators')),
  entity_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists portal_realtime_events_org_idx
  on public.portal_realtime_events (organization_id, id desc);
create index if not exists portal_realtime_events_retention_idx
  on public.portal_realtime_events (created_at);

create or replace function private.portal_realtime_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      old.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(old)->>'id', '')::uuid,
        nullif(to_jsonb(old)->>'connection_id', '')::uuid
      )
    );
  else
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      new.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(new)->>'id', '')::uuid,
        nullif(to_jsonb(new)->>'connection_id', '')::uuid
      )
    );
  end if;

  -- A tabela é um sinal efêmero, não histórico de auditoria.
  delete from public.portal_realtime_events
  where created_at < now() - interval '7 days';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_connections_portal_realtime on public.whatsapp_connections;
create trigger whatsapp_connections_portal_realtime
after insert or update or delete on public.whatsapp_connections
for each row execute function private.portal_realtime_notify('connections');

drop trigger if exists connection_robot_credentials_portal_realtime on public.connection_robot_credentials;
create trigger connection_robot_credentials_portal_realtime
after insert or update or delete on public.connection_robot_credentials
for each row execute function private.portal_realtime_notify('connections');

drop trigger if exists whatsapp_connection_operators_portal_realtime on public.whatsapp_connection_operators;
create trigger whatsapp_connection_operators_portal_realtime
after insert or update or delete on public.whatsapp_connection_operators
for each row execute function private.portal_realtime_notify('operators');

drop trigger if exists whatsapp_operator_verifications_portal_realtime on public.whatsapp_operator_verifications;
create trigger whatsapp_operator_verifications_portal_realtime
after insert or update or delete on public.whatsapp_operator_verifications
for each row execute function private.portal_realtime_notify('operators');

alter table public.chatbot_definitions enable row level security;
alter table public.chatbot_versions enable row level security;
alter table public.chatbot_executions enable row level security;
alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_tool_runs enable row level security;
alter table public.portal_realtime_events enable row level security;

grant select, insert, update on public.chatbot_definitions to authenticated;
revoke delete on public.chatbot_definitions from authenticated;
grant select on public.chatbot_versions, public.chatbot_executions to authenticated;
grant select, insert, update on public.assistant_threads, public.assistant_messages, public.assistant_tool_runs to authenticated;
revoke all on public.portal_realtime_events from anon, authenticated;
grant select on public.portal_realtime_events to authenticated;

drop policy if exists portal_realtime_events_select on public.portal_realtime_events;
create policy portal_realtime_events_select on public.portal_realtime_events for select to authenticated
  using (private.is_org_member(organization_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'portal_realtime_events'
    ) then
    alter publication supabase_realtime add table public.portal_realtime_events;
  end if;
end;
$$;

drop policy if exists chatbot_definitions_select on public.chatbot_definitions;
create policy chatbot_definitions_select on public.chatbot_definitions for select to authenticated
  using (private.is_org_member(organization_id));
drop policy if exists chatbot_definitions_manage on public.chatbot_definitions;
drop policy if exists chatbot_definitions_insert on public.chatbot_definitions;
create policy chatbot_definitions_insert on public.chatbot_definitions for insert to authenticated
  with check (
    private.can_manage_org(organization_id)
    and created_by = auth.uid()
    and updated_by = auth.uid()
  );
drop policy if exists chatbot_definitions_update on public.chatbot_definitions;
create policy chatbot_definitions_update on public.chatbot_definitions for update to authenticated
  using (private.can_manage_org(organization_id))
  with check (private.can_manage_org(organization_id) and updated_by = auth.uid());

drop policy if exists chatbot_versions_select on public.chatbot_versions;
create policy chatbot_versions_select on public.chatbot_versions for select to authenticated
  using (private.is_org_member(organization_id));
drop policy if exists chatbot_executions_select on public.chatbot_executions;
create policy chatbot_executions_select on public.chatbot_executions for select to authenticated
  using (claimed_by = auth.uid() or private.can_manage_org(organization_id));

drop policy if exists assistant_threads_self on public.assistant_threads;
create policy assistant_threads_self on public.assistant_threads for all to authenticated
  using (user_id = auth.uid() and private.is_org_member(organization_id))
  with check (user_id = auth.uid() and private.is_org_member(organization_id));
drop policy if exists assistant_messages_self on public.assistant_messages;
create policy assistant_messages_self on public.assistant_messages for all to authenticated
  using (
    user_id = auth.uid() and private.is_org_member(organization_id)
    and exists (
      select 1 from public.assistant_threads thread
      where thread.id = assistant_messages.thread_id
        and thread.organization_id = assistant_messages.organization_id
        and thread.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid() and private.is_org_member(organization_id)
    and exists (
      select 1 from public.assistant_threads thread
      where thread.id = assistant_messages.thread_id
        and thread.organization_id = assistant_messages.organization_id
        and thread.user_id = auth.uid()
    )
  );
drop policy if exists assistant_tool_runs_self on public.assistant_tool_runs;
create policy assistant_tool_runs_self on public.assistant_tool_runs for all to authenticated
  using (
    user_id = auth.uid() and private.is_org_member(organization_id)
    and exists (
      select 1 from public.assistant_threads thread
      where thread.id = assistant_tool_runs.thread_id
        and thread.organization_id = assistant_tool_runs.organization_id
        and thread.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid() and private.is_org_member(organization_id)
    and exists (
      select 1 from public.assistant_threads thread
      where thread.id = assistant_tool_runs.thread_id
        and thread.organization_id = assistant_tool_runs.organization_id
        and thread.user_id = auth.uid()
    )
  );

create or replace function private.archive_chatbot_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.name is distinct from new.name
     or old.active is distinct from new.active
     or old.definition is distinct from new.definition then
    insert into public.chatbot_versions (
      organization_id, chatbot_id, version, name, active, definition, changed_by
    ) values (
      old.organization_id, old.id, old.version, old.name, old.active,
      old.definition, new.updated_by
    ) on conflict (chatbot_id, version) do nothing;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists chatbot_definition_versioning on public.chatbot_definitions;
create trigger chatbot_definition_versioning
before update on public.chatbot_definitions
for each row execute function private.archive_chatbot_definition();

drop trigger if exists chatbot_definitions_org_immutable on public.chatbot_definitions;
create trigger chatbot_definitions_org_immutable
before update on public.chatbot_definitions
for each row execute function private.prevent_organization_change();
drop trigger if exists assistant_threads_org_immutable on public.assistant_threads;
create trigger assistant_threads_org_immutable
before update on public.assistant_threads
for each row execute function private.prevent_organization_change();
drop trigger if exists assistant_messages_org_immutable on public.assistant_messages;
create trigger assistant_messages_org_immutable
before update on public.assistant_messages
for each row execute function private.prevent_organization_change();
drop trigger if exists assistant_tool_runs_org_immutable on public.assistant_tool_runs;
create trigger assistant_tool_runs_org_immutable
before update on public.assistant_tool_runs
for each row execute function private.prevent_organization_change();

create or replace function public.chatbot_execution_claim(
  target_organization uuid,
  target_chatbot uuid,
  target_contact uuid,
  target_external_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
  claimed_id uuid;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  if length(trim(coalesce(target_external_message, ''))) not between 1 and 500 then
    raise exception 'invalid external message id';
  end if;
  if not exists (
    select 1 from public.chatbot_definitions bot
    where bot.id = target_chatbot
      and bot.organization_id = target_organization
      and bot.active
      and bot.deleted_at is null
  ) then raise exception 'chatbot is not active'; end if;
  if target_contact is not null and not exists (
    select 1 from public.contacts contact
    where contact.id = target_contact
      and contact.organization_id = target_organization
      and contact.deleted_at is null
  ) then raise exception 'chatbot contact is not available'; end if;

  select connection.id into connection_id
  from public.whatsapp_connections connection
  where connection.organization_id = target_organization
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  order by case when connection.status = 'connected' then 0 else 1 end,
    connection.updated_at desc
  limit 1;
  if connection_id is null then raise exception 'whatsapp connection is not active'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    target_organization::text || ':' || connection_id::text || ':' ||
    target_external_message || ':' || target_chatbot::text, 0
  ));
  if exists (
    select 1 from public.chatbot_executions execution
    where execution.organization_id = target_organization
      and execution.connection_id = connection_id
      and execution.external_message_id = target_external_message
      and execution.chatbot_id = target_chatbot
  ) then return null; end if;

  insert into public.chatbot_executions (
    organization_id, chatbot_id, connection_id, contact_id, claimed_by,
    external_message_id, status
  ) values (
    target_organization, target_chatbot, connection_id, target_contact,
    auth.uid(), target_external_message, 'claimed'
  ) returning id into claimed_id;
  return claimed_id;
end;
$$;

create or replace function public.chatbot_execution_complete(
  target_organization uuid,
  target_execution uuid,
  target_status text,
  target_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  execution public.chatbot_executions%rowtype;
begin
  if target_status not in ('sent', 'ignored', 'failed') then
    raise exception 'invalid chatbot execution status';
  end if;
  select * into execution
  from public.chatbot_executions item
  where item.id = target_execution
    and item.organization_id = target_organization
    and item.claimed_by = auth.uid()
  for update;
  if not found then raise exception 'chatbot execution not found'; end if;
  if execution.status <> 'claimed' then return true; end if;
  update public.chatbot_executions
  set status = target_status,
      result = coalesce(target_result, '{}'::jsonb),
      completed_at = now()
  where id = execution.id;
  return true;
end;
$$;

revoke all on function public.chatbot_execution_claim(uuid, uuid, uuid, text) from public;
revoke all on function public.chatbot_execution_complete(uuid, uuid, text, jsonb) from public;
grant execute on function public.chatbot_execution_claim(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.chatbot_execution_complete(uuid, uuid, text, jsonb) to authenticated;

create or replace function public.migrate_local_chatbots(
  target_organization uuid,
  chatbot_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  inserted_count integer := 0;
  safe_name text;
begin
  if not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if jsonb_typeof(chatbot_payload) <> 'array'
    or jsonb_array_length(chatbot_payload) > 100 then
    raise exception 'invalid chatbot migration payload';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chatbot-migration:' || target_organization::text, 0)
  );
  if exists (
    select 1 from public.chatbot_definitions definition
    where definition.organization_id = target_organization
      and definition.deleted_at is null
  ) then return 0; end if;

  for item in select value from jsonb_array_elements(chatbot_payload)
  loop
    safe_name := trim(coalesce(item->>'name', ''));
    if length(safe_name) not between 1 and 120
      or jsonb_typeof(coalesce(item->'definition', '{}'::jsonb)) <> 'object' then
      raise exception 'invalid chatbot migration item';
    end if;
    insert into public.chatbot_definitions (
      organization_id, name, active, definition, created_by, updated_by
    ) values (
      target_organization,
      safe_name,
      coalesce((item->>'active')::boolean, true),
      coalesce(item->'definition', '{}'::jsonb),
      auth.uid(),
      auth.uid()
    );
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.migrate_local_chatbots(uuid, jsonb) from public;
grant execute on function public.migrate_local_chatbots(uuid, jsonb) to authenticated;

create or replace function public.assistant_calendar_event_confirm(
  target_organization uuid,
  target_tool_run uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.assistant_tool_runs%rowtype;
  member public.organization_members%rowtype;
  args jsonb;
  safe_title text;
  safe_description text;
  safe_location text;
  safe_visibility text;
  safe_responsible uuid;
  safe_contact uuid;
  safe_participants uuid[];
  safe_starts_at timestamptz;
  safe_ends_at timestamptz;
  safe_category_id uuid;
  created_event public.calendar_events%rowtype;
  conflict_payload jsonb;
  result_payload jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization::text || ':' || target_tool_run::text, 0)
  );
  select * into run
  from public.assistant_tool_runs item
  where item.id = target_tool_run
    and item.organization_id = target_organization
    and item.user_id = auth.uid()
  for update;
  if not found then raise exception 'assistant confirmation not found'; end if;
  if run.status = 'completed' then
    return coalesce(run.result, '{}'::jsonb) || jsonb_build_object('jaExistia', true);
  end if;
  if run.status <> 'pending_confirmation' or run.tool_name <> 'calendar.create' then
    raise exception 'assistant confirmation is closed';
  end if;

  select * into member
  from public.organization_members item
  where item.organization_id = target_organization
    and item.user_id = auth.uid()
    and item.status = 'active';
  if not found then raise exception 'organization membership required'; end if;

  args := coalesce(run.arguments, '{}'::jsonb);
  safe_title := trim(coalesce(args->>'title', ''));
  safe_description := trim(coalesce(args->>'description', ''));
  safe_location := trim(coalesce(args->>'location', ''));
  safe_visibility := coalesce(nullif(args->>'visibility', ''), 'personal');
  safe_responsible := coalesce(nullif(args->>'responsible_id', '')::uuid, auth.uid());
  safe_contact := nullif(args->>'contact_id', '')::uuid;
  safe_starts_at := (args->>'starts_at')::timestamptz;
  safe_ends_at := (args->>'ends_at')::timestamptz;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
    into safe_participants
  from jsonb_array_elements_text(coalesce(args->'participant_ids', '[]'::jsonb));
  if cardinality(safe_participants) = 0 then safe_participants := array[safe_responsible]; end if;
  if not (safe_responsible = any(safe_participants)) then
    safe_participants := array_append(safe_participants, safe_responsible);
  end if;

  if length(safe_title) not between 1 and 240
    or length(safe_description) > 4000
    or length(safe_location) > 500 then
    raise exception 'invalid calendar event text';
  end if;
  if safe_starts_at is null or safe_ends_at is null or safe_ends_at <= safe_starts_at
    or safe_starts_at < now() - interval '5 minutes'
    or safe_starts_at > now() + interval '366 days' then
    raise exception 'invalid calendar interval';
  end if;
  if safe_ends_at - safe_starts_at < interval '30 minutes'
    or safe_ends_at - safe_starts_at > interval '8 hours'
    or mod(extract(epoch from (safe_ends_at - safe_starts_at))::bigint, 1800) <> 0
    or extract(second from safe_starts_at) <> 0
    or mod(extract(minute from safe_starts_at)::integer, 30) <> 0
    or extract(second from safe_ends_at) <> 0
    or mod(extract(minute from safe_ends_at)::integer, 30) <> 0 then
    raise exception 'calendar interval must use 30-minute boundaries';
  end if;
  if safe_visibility not in ('personal', 'organization') then
    raise exception 'invalid calendar visibility';
  end if;
  if cardinality(safe_participants) > 20 then raise exception 'too many calendar participants'; end if;
  if member.role = 'member' and (
    safe_responsible <> auth.uid()
    or safe_visibility <> 'personal'
    or exists (select 1 from unnest(safe_participants) participant where participant <> auth.uid())
  ) then
    raise exception 'member calendar permission denied';
  end if;
  if exists (
    select 1 from unnest(safe_participants) participant
    where not exists (
      select 1 from public.organization_members active_member
      where active_member.organization_id = target_organization
        and active_member.user_id = participant
        and active_member.status = 'active'
    )
  ) then raise exception 'calendar participant is not active'; end if;
  if safe_contact is not null and not exists (
    select 1 from public.contacts contact
    where contact.id = safe_contact
      and contact.organization_id = target_organization
      and contact.deleted_at is null
  ) then raise exception 'calendar contact is not available'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', active_member.user_id,
    'nome', profile.full_name,
    'motivo', 'horario-ocupado'
  ) order by coalesce(profile.full_name, ''), active_member.user_id), '[]'::jsonb)
  into conflict_payload
  from public.organization_members active_member
  left join public.profiles profile on profile.id = active_member.user_id
  where active_member.organization_id = target_organization
    and active_member.user_id = any(safe_participants)
    and exists (
      select 1
      from public.calendar_events event
      left join public.calendar_event_participants event_participant
        on event_participant.event_id = event.id
       and event_participant.organization_id = event.organization_id
       and event_participant.participant_id = active_member.user_id
      where event.organization_id = target_organization
        and event.deleted_at is null
        and event.status in ('scheduled', 'tentative')
        and (event.owner_id = active_member.user_id or event_participant.participant_id is not null)
        and event.starts_at < safe_ends_at
        and event.ends_at > safe_starts_at
    );
  if jsonb_array_length(conflict_payload) > 0 then
    return jsonb_build_object('confirmado', false, 'conflito', true, 'participantesIndisponiveis', conflict_payload);
  end if;

  select category.id into safe_category_id
  from public.calendar_categories category
  where category.organization_id = target_organization and category.active
  order by category.position, category.id
  limit 1;
  if safe_category_id is null then raise exception 'organization has no active calendar category'; end if;

  begin
    insert into public.calendar_events (
      organization_id, owner_id, title, description, starts_at, ends_at,
      all_day, kind, visibility, contact_id, status, category_id, location, tags,
      reminder_minutes, created_by, updated_by
    ) values (
      target_organization, safe_responsible, safe_title, safe_description,
      safe_starts_at, safe_ends_at, false, 'appointment', safe_visibility, safe_contact, 'scheduled',
      safe_category_id, safe_location, array['Portal'], array[30], auth.uid(), auth.uid()
    ) returning * into created_event;
  exception when exclusion_violation then
    return jsonb_build_object('confirmado', false, 'conflito', true, 'participantesIndisponiveis', conflict_payload);
  end;

  insert into public.calendar_event_participants (organization_id, event_id, participant_id)
  select target_organization, created_event.id, participant
  from unnest(safe_participants) participant
  on conflict (event_id, participant_id) do nothing;

  result_payload := jsonb_build_object(
    'confirmado', true,
    'conflito', false,
    'eventoId', created_event.id,
    'titulo', created_event.title,
    'inicio', created_event.starts_at,
    'fim', created_event.ends_at,
    'responsavelId', created_event.owner_id,
    'participantesIds', safe_participants,
    'contatoId', created_event.contact_id
  );
  update public.assistant_tool_runs
  set status = 'completed', confirmed_at = now(), completed_at = now(), result = result_payload
  where id = run.id;
  return result_payload;
end;
$$;

revoke all on function public.assistant_calendar_event_confirm(uuid, uuid) from public;
grant execute on function public.assistant_calendar_event_confirm(uuid, uuid) to authenticated;

commit;
