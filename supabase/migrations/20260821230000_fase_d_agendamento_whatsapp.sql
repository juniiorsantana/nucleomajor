-- Fase D.1: criação controlada de agendamentos pelo agente do WhatsApp.
--
-- O robô continua sem INSERT direto nas tabelas. A única escrita liberada é
-- esta RPC estreita: organização e conexão vêm da credencial, o profissional
-- vem da conversa roteada e o cliente precisa ter confirmado data e horário.

begin;

create table public.calendar_agent_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  event_id uuid not null,
  selected_agent_id uuid not null,
  contact_id uuid,
  request_key text not null check (request_key ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  requester_hash text not null check (requester_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, connection_id, request_key),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete restrict,
  foreign key (event_id, organization_id)
    references public.calendar_events(id, organization_id) on delete cascade,
  foreign key (organization_id, selected_agent_id)
    references public.organization_members(organization_id, user_id) on delete restrict,
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id) on delete restrict
);

create index calendar_agent_bookings_requester_idx
  on public.calendar_agent_bookings (
    organization_id, connection_id, requester_hash, created_at desc
  );

alter table public.calendar_agent_bookings enable row level security;

create policy calendar_agent_bookings_manage_select
on public.calendar_agent_bookings for select to authenticated
using (private.can_manage_org(organization_id));

revoke all on public.calendar_agent_bookings from anon, authenticated;
grant select on public.calendar_agent_bookings to authenticated;

create or replace function public.nucleo_calendar_booking_create(
  selected_agent uuid,
  request_key text,
  requester_hash text,
  requester_phone text,
  booking_title text,
  booking_description text,
  booking_starts_at timestamptz,
  booking_ends_at timestamptz,
  booking_location text,
  booking_reminder_minutes integer[],
  customer_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  category_id uuid;
  matched_contact_id uuid;
  matched_contact_name text;
  existing_booking public.calendar_agent_bookings%rowtype;
  existing_event public.calendar_events%rowtype;
  created_event public.calendar_events%rowtype;
  normalized_phone text := regexp_replace(coalesce(requester_phone, ''), '[^0-9]', '', 'g');
  safe_title text := trim(coalesce(booking_title, ''));
  safe_description text := trim(coalesce(booking_description, ''));
  safe_location text := trim(coalesce(booking_location, ''));
  safe_reminders integer[] := coalesce(booking_reminder_minutes, array[30]);
  operation_hash text;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
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
  if customer_confirmed is not true then
    raise exception 'customer confirmation is required before creating a booking';
  end if;
  if request_key is null or request_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid booking request key';
  end if;
  if requester_hash is null or requester_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid booking requester';
  end if;
  if selected_agent is null or not exists (
    select 1
    from public.organization_members member
    where member.organization_id = robot_org
      and member.user_id = selected_agent
      and member.status = 'active'
  ) then
    raise exception 'selected agent is not an active member of this organization';
  end if;
  if length(safe_title) < 1 or length(safe_title) > 240 then
    raise exception 'booking title must have between 1 and 240 characters';
  end if;
  if length(safe_description) > 2000 then
    raise exception 'booking description is too long';
  end if;
  if length(safe_location) > 500 then
    raise exception 'booking location is too long';
  end if;
  if booking_starts_at is null or booking_ends_at is null
    or booking_ends_at <= booking_starts_at then
    raise exception 'booking interval is invalid';
  end if;
  if booking_starts_at < now() - interval '5 minutes'
    or booking_starts_at > now() + interval '366 days' then
    raise exception 'booking must be in the next 366 days';
  end if;
  if booking_ends_at - booking_starts_at < interval '30 minutes'
    or booking_ends_at - booking_starts_at > interval '8 hours'
    or mod(extract(epoch from (booking_ends_at - booking_starts_at))::bigint, 1800) <> 0 then
    raise exception 'booking duration must use 30-minute steps and be at most 8 hours';
  end if;
  if extract(second from booking_starts_at) <> 0
    or mod(extract(minute from booking_starts_at)::integer, 30) <> 0
    or extract(second from booking_ends_at) <> 0
    or mod(extract(minute from booking_ends_at)::integer, 30) <> 0 then
    raise exception 'booking times must use 30-minute boundaries';
  end if;
  if cardinality(safe_reminders) > 5
    or array_position(safe_reminders, null) is not null
    or not (0 <= all(safe_reminders) and 10080 >= all(safe_reminders)) then
    raise exception 'invalid reminder minutes';
  end if;

  operation_hash := encode(
    extensions.digest(
      concat_ws(
        '|', selected_agent::text, safe_title, safe_description,
        booking_starts_at::text, booking_ends_at::text, safe_location,
        array_to_string(safe_reminders, ','), requester_hash
      ),
      'sha256'
    ),
    'hex'
  );

  -- Serializa reexecuções do mesmo turno antes de conferir a chave.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(robot_connection::text || ':' || request_key, 0)
  );

  select * into existing_booking
  from public.calendar_agent_bookings booking
  where booking.organization_id = robot_org
    and booking.connection_id = robot_connection
    and booking.request_key = nucleo_calendar_booking_create.request_key;

  if found then
    if existing_booking.payload_hash <> operation_hash then
      raise exception 'booking request key was already used with different data';
    end if;
    select * into existing_event
    from public.calendar_events event
    where event.id = existing_booking.event_id
      and event.organization_id = robot_org;
    return jsonb_build_object(
      'criado', false,
      'jaExistia', true,
      'conflito', false,
      'eventoId', existing_event.id,
      'titulo', existing_event.title,
      'inicio', existing_event.starts_at,
      'fim', existing_event.ends_at,
      'responsavelId', existing_event.owner_id,
      'contatoId', existing_event.contact_id
    );
  end if;

  -- Uma nova mensagem de confirmação gera outro turn_id. Se a resposta do
  -- primeiro turno se perdeu depois do commit, o mesmo conteúdo ainda deve
  -- devolver o compromisso existente em vez de parecer apenas um conflito.
  select booking.* into existing_booking
  from public.calendar_agent_bookings booking
  join public.calendar_events event
    on event.id = booking.event_id
   and event.organization_id = booking.organization_id
  where booking.organization_id = robot_org
    and booking.connection_id = robot_connection
    and booking.requester_hash = nucleo_calendar_booking_create.requester_hash
    and booking.payload_hash = operation_hash
    and event.deleted_at is null
    and event.status in ('scheduled', 'tentative')
  order by booking.created_at desc
  limit 1;

  if found then
    select * into existing_event
    from public.calendar_events event
    where event.id = existing_booking.event_id
      and event.organization_id = robot_org;
    return jsonb_build_object(
      'criado', false,
      'jaExistia', true,
      'conflito', false,
      'eventoId', existing_event.id,
      'titulo', existing_event.title,
      'inicio', existing_event.starts_at,
      'fim', existing_event.ends_at,
      'responsavelId', existing_event.owner_id,
      'contatoId', existing_event.contact_id
    );
  end if;

  if (
    select count(*)
    from public.calendar_agent_bookings booking
    where booking.organization_id = robot_org
      and booking.connection_id = robot_connection
      and booking.requester_hash = nucleo_calendar_booking_create.requester_hash
      and booking.created_at > now() - interval '1 hour'
  ) >= 8 then
    raise exception 'booking rate limit exceeded for this conversation';
  end if;

  if exists (
    select 1
    from public.calendar_events event
    where event.organization_id = robot_org
      and event.owner_id = selected_agent
      and event.deleted_at is null
      and event.status in ('scheduled', 'tentative')
      and event.starts_at < booking_ends_at
      and event.ends_at > booking_starts_at
  ) then
    return jsonb_build_object(
      'criado', false,
      'jaExistia', false,
      'conflito', true,
      'motivo', 'horario-indisponivel'
    );
  end if;

  select category.id into category_id
  from public.calendar_categories category
  where category.organization_id = robot_org and category.active
  order by case when category.name = 'Atendimento' then 0 else 1 end,
    category.position, category.id
  limit 1;
  if category_id is null then
    raise exception 'organization has no active calendar category';
  end if;

  if length(normalized_phone) >= 10 then
    select contact.id, contact.name
      into matched_contact_id, matched_contact_name
    from public.contacts contact
    where contact.organization_id = robot_org
      and contact.deleted_at is null
      and (
        regexp_replace(coalesce(contact.phone, ''), '[^0-9]', '', 'g') = normalized_phone
        or regexp_replace(coalesce(contact.whatsapp_id, ''), '[^0-9]', '', 'g') = normalized_phone
      )
    order by contact.updated_at desc nulls last, contact.id
    limit 1;
  end if;

  begin
    insert into public.calendar_events (
      organization_id, owner_id, title, description, starts_at, ends_at,
      all_day, kind, visibility, contact_id, status, category_id, location,
      tags, reminder_minutes, created_by, updated_by
    ) values (
      robot_org, selected_agent, safe_title, safe_description,
      booking_starts_at, booking_ends_at, false, 'appointment', 'organization',
      matched_contact_id, 'scheduled', category_id, safe_location,
      array['WhatsApp'], safe_reminders, selected_agent, selected_agent
    ) returning * into created_event;
  exception when exclusion_violation then
    return jsonb_build_object(
      'criado', false,
      'jaExistia', false,
      'conflito', true,
      'motivo', 'horario-indisponivel'
    );
  end;

  insert into public.calendar_agent_bookings (
    organization_id, connection_id, event_id, selected_agent_id, contact_id,
    request_key, payload_hash, requester_hash
  ) values (
    robot_org, robot_connection, created_event.id, selected_agent,
    matched_contact_id, request_key, operation_hash, requester_hash
  );

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = robot_org
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object(
    'criado', true,
    'jaExistia', false,
    'conflito', false,
    'eventoId', created_event.id,
    'titulo', created_event.title,
    'inicio', created_event.starts_at,
    'fim', created_event.ends_at,
    'responsavelId', created_event.owner_id,
    'contatoId', created_event.contact_id,
    'contatoNome', matched_contact_name,
    'lembretesMinutos', to_jsonb(created_event.reminder_minutes)
  );
end;
$$;

revoke all on function public.nucleo_calendar_booking_create(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  text, integer[], boolean
) from public;

grant execute on function public.nucleo_calendar_booking_create(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  text, integer[], boolean
) to authenticated;

commit;
