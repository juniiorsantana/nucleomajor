-- Operadores pessoais no WhatsApp principal e agendamento interno multiusuário.
--
-- Os números pessoais não são conexões WhatsApp. Eles são identidades
-- verificadas que podem falar com a conexão corporativa da organização.

begin;

create table public.whatsapp_connection_operators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  user_id uuid not null,
  phone_e164 text not null check (phone_e164 ~ '^[0-9]{10,15}$'),
  phone_hash text not null check (phone_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'blocked', 'revoked')),
  verified_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, phone_hash),
  unique (connection_id, user_id),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade,
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

-- Um número ativo não pode representar duas organizações ao mesmo tempo.
-- Revogar e verificar novamente cria uma nova prova de posse.
create unique index whatsapp_operator_one_active_phone
  on public.whatsapp_connection_operators (phone_hash)
  where status = 'active';

create index whatsapp_operator_connection_status_idx
  on public.whatsapp_connection_operators (organization_id, connection_id, status);

create table public.whatsapp_operator_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  user_id uuid not null,
  phone_e164 text not null check (phone_e164 ~ '^[0-9]{10,15}$'),
  phone_hash text not null check (phone_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 10),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade,
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create index whatsapp_operator_verifications_lookup_idx
  on public.whatsapp_operator_verifications
    (organization_id, connection_id, phone_hash, created_at desc);

create table public.calendar_event_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  participant_id uuid not null,
  participation_role text not null default 'required'
    check (participation_role in ('required', 'optional')),
  created_at timestamptz not null default now(),
  unique (event_id, participant_id),
  foreign key (event_id, organization_id)
    references public.calendar_events(id, organization_id) on delete cascade,
  foreign key (organization_id, participant_id)
    references public.organization_members(organization_id, user_id) on delete restrict
);

create index calendar_event_participants_member_idx
  on public.calendar_event_participants (organization_id, participant_id, event_id);

create table public.calendar_operator_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  event_id uuid not null,
  operator_id uuid not null,
  responsible_id uuid not null,
  participant_ids uuid[] not null default '{}',
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
  foreign key (organization_id, operator_id)
    references public.organization_members(organization_id, user_id) on delete restrict,
  foreign key (organization_id, responsible_id)
    references public.organization_members(organization_id, user_id) on delete restrict,
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id) on delete restrict
);

create index calendar_operator_bookings_requester_idx
  on public.calendar_operator_bookings
    (organization_id, connection_id, requester_hash, created_at desc);

alter table public.whatsapp_connection_operators enable row level security;
alter table public.whatsapp_operator_verifications enable row level security;
alter table public.calendar_event_participants enable row level security;
alter table public.calendar_operator_bookings enable row level security;

revoke all on public.whatsapp_connection_operators from anon, authenticated;
revoke all on public.whatsapp_operator_verifications from anon, authenticated;
revoke all on public.calendar_operator_bookings from anon, authenticated;
revoke all on public.calendar_event_participants from anon, authenticated;

-- Usuários humanos podem ver apenas a participação de eventos aos quais já
-- teriam acesso pela agenda. O robô usa as RPCs abaixo e nunca recebe SELECT
-- direto nessas tabelas.
create policy calendar_event_participants_human_select
on public.calendar_event_participants for select to authenticated
using (
  private.is_org_member(organization_id)
  and exists (
    select 1
    from public.calendar_events event
    where event.id = calendar_event_participants.event_id
      and event.organization_id = calendar_event_participants.organization_id
      and event.deleted_at is null
      and (
        event.owner_id = auth.uid()
        or calendar_event_participants.participant_id = auth.uid()
        or event.visibility = 'organization'
        or private.can_manage_org(event.organization_id)
      )
  )
);

create policy calendar_operator_bookings_human_select
on public.calendar_operator_bookings for select to authenticated
using (private.can_manage_org(organization_id));

create or replace function private.normalize_whatsapp_operator_phone(raw_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g');
$$;

create or replace function private.whatsapp_operator_phone_hash(raw_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(private.normalize_whatsapp_operator_phone(raw_phone), 'sha256'),
    'hex'
  );
$$;

create or replace function public.whatsapp_operator_verification_begin(
  target_organization uuid,
  target_connection uuid,
  target_user uuid,
  target_phone text
)
returns table (
  verification_id uuid,
  target_phone_e164 text,
  verification_code text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_phone text := private.normalize_whatsapp_operator_phone(target_phone);
  phone_hash_value text := private.whatsapp_operator_phone_hash(target_phone);
  raw_code text := encode(extensions.gen_random_bytes(4), 'hex');
  saved_id uuid;
  saved_expiry timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if length(normalized_phone) < 10 or length(normalized_phone) > 15 then
    raise exception 'invalid operator phone';
  end if;
  if not exists (
    select 1
    from public.whatsapp_connections connection
    where connection.id = target_connection
      and connection.organization_id = target_organization
      and connection.status <> 'revoked'
      and connection.revoked_at is null
  ) then
    raise exception 'connection is not active in this organization';
  end if;
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization
      and member.user_id = target_user
      and member.status = 'active'
  ) then
    raise exception 'operator must be an active member of this organization';
  end if;
  if exists (
    select 1
    from public.whatsapp_connection_operators op
    where op.phone_hash = phone_hash_value
      and op.status = 'active'
      and op.organization_id <> target_organization
  ) then
    raise exception 'operator phone is active in another organization; verify again after revocation';
  end if;

  update public.whatsapp_operator_verifications verification
  set consumed_at = coalesce(consumed_at, now())
  where verification.organization_id = target_organization
    and verification.connection_id = target_connection
    and verification.user_id = target_user
    and verification.consumed_at is null;

  insert into public.whatsapp_operator_verifications (
    organization_id, connection_id, user_id, phone_e164, phone_hash,
    code_hash, expires_at, created_by
  ) values (
    target_organization, target_connection, target_user, normalized_phone,
    phone_hash_value,
    encode(extensions.digest(raw_code, 'sha256'), 'hex'),
    saved_expiry, auth.uid()
  ) returning id into saved_id;

  return query select saved_id, normalized_phone, raw_code, saved_expiry;
end;
$$;

-- Esta função é a confirmação feita pelo runtime do WhatsApp. A organização
-- e a conexão vêm da credencial de robô; o telefone vem do remetente real.
create or replace function public.nucleo_operator_verification_confirm(
  requester_phone text,
  verification_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  normalized_phone text := private.normalize_whatsapp_operator_phone(requester_phone);
  phone_hash_value text := private.whatsapp_operator_phone_hash(requester_phone);
  challenge public.whatsapp_operator_verifications%rowtype;
  member public.organization_members%rowtype;
  operator_id uuid;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;
  if length(normalized_phone) < 10 or length(normalized_phone) > 15
    or verification_code is null or verification_code !~ '^[0-9a-fA-F]{8}$' then
    return jsonb_build_object('confirmado', false, 'motivo', 'codigo-invalido');
  end if;

  select verification.* into challenge
  from public.whatsapp_operator_verifications verification
  where verification.organization_id = robot_org
    and verification.connection_id = robot_connection
    and verification.phone_hash = phone_hash_value
    and verification.consumed_at is null
    and verification.expires_at > now()
    and verification.attempts < 5
  order by verification.created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('confirmado', false, 'motivo', 'codigo-expirado-ou-inexistente');
  end if;

  if challenge.code_hash <> encode(
    extensions.digest(lower(trim(verification_code)), 'sha256'), 'hex'
  ) then
    update public.whatsapp_operator_verifications
    set attempts = attempts + 1
    where id = challenge.id;
    return jsonb_build_object('confirmado', false, 'motivo', 'codigo-incorreto');
  end if;

  select * into member
  from public.organization_members
  where organization_id = robot_org
    and user_id = challenge.user_id
    and status = 'active';
  if not found then
    raise exception 'operator membership is no longer active';
  end if;

  update public.whatsapp_operator_verifications
  set consumed_at = now()
  where id = challenge.id;

  insert into public.whatsapp_connection_operators (
    organization_id, connection_id, user_id, phone_e164, phone_hash,
    status, verified_at, created_by, updated_by
  ) values (
    robot_org, robot_connection, challenge.user_id, challenge.phone_e164,
    challenge.phone_hash, 'active', now(), challenge.created_by, challenge.created_by
  )
  on conflict (connection_id, user_id) do update
  set phone_e164 = excluded.phone_e164,
      phone_hash = excluded.phone_hash,
      status = 'active',
      verified_at = now(),
      updated_by = excluded.updated_by,
      updated_at = now()
  returning id into operator_id;

  return jsonb_build_object(
    'confirmado', true,
    'operadorId', operator_id,
    'organizacaoId', robot_org,
    'conexaoId', robot_connection,
    'usuarioId', member.user_id,
    'papel', member.role,
    'responsabilidade', coalesce(member.responsibility, '')
  );
end;
$$;

create or replace function public.nucleo_operator_context(requester_phone text)
returns table (
  organization_id uuid,
  organization_name text,
  connection_id uuid,
  connection_name text,
  operator_id uuid,
  user_id uuid,
  operator_name text,
  operator_role public.organization_role,
  responsibility text,
  team jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  phone_hash_value text := private.whatsapp_operator_phone_hash(requester_phone);
  current_operator public.whatsapp_connection_operators%rowtype;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;

  select op.* into current_operator
  from public.whatsapp_connection_operators op
  where op.organization_id = robot_org
    and op.connection_id = robot_connection
    and op.phone_hash = phone_hash_value
    and op.status = 'active';
  if not found then
    raise exception 'sender is not a verified operator for this connection';
  end if;

  update public.connection_robot_credentials credential
  set last_used_at = now()
  where credential.connection_id = robot_connection
    and credential.auth_user_id = auth.uid();

  return query
  select
    organization.id,
    organization.name,
    connection.id,
    connection.name,
    current_operator.id,
    member.user_id,
    profile.full_name,
    member.role,
    coalesce(member.responsibility, ''),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', team_member.user_id,
        'nome', team_profile.full_name,
        'papel', team_member.role,
        'responsabilidade', coalesce(team_member.responsibility, '')
      ) order by coalesce(team_profile.full_name, ''), team_member.user_id), '[]'::jsonb)
      from public.organization_members team_member
      left join public.profiles team_profile on team_profile.id = team_member.user_id
      where team_member.organization_id = organization.id
        and team_member.status = 'active'
    )
  from public.organizations organization
  join public.whatsapp_connections connection
    on connection.id = robot_connection
   and connection.organization_id = organization.id
  join public.organization_members member
    on member.organization_id = organization.id
   and member.user_id = current_operator.user_id
   and member.status = 'active'
  left join public.profiles profile on profile.id = member.user_id
  where organization.id = robot_org;
end;
$$;

create or replace function public.whatsapp_operator_list(
  target_organization uuid,
  target_connection uuid
)
returns table (
  id uuid,
  user_id uuid,
  operator_name text,
  phone_e164 text,
  status text,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  return query
  select op.id, op.user_id, profile.full_name, op.phone_e164,
    op.status, op.verified_at
  from public.whatsapp_connection_operators op
  left join public.profiles profile on profile.id = op.user_id
  where op.organization_id = target_organization
    and op.connection_id = target_connection
  order by coalesce(profile.full_name, ''), op.id;
end;
$$;

create or replace function public.whatsapp_operator_revoke(
  target_organization uuid,
  target_operator uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  update public.whatsapp_connection_operators
  set status = 'revoked', updated_by = auth.uid(), updated_at = now()
  where id = target_operator and organization_id = target_organization;
end;
$$;

create or replace function public.nucleo_calendar_operator_availability(
  operator_phone text,
  participant_ids uuid[],
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  requested_ids uuid[] := array(
    select distinct participant_id
    from unnest(coalesce(participant_ids, '{}'::uuid[])) participant_id
    where participant_id is not null
  );
  participants_payload jsonb;
begin
  select * into context_row
  from public.nucleo_operator_context(operator_phone)
  limit 1;
  if not found then raise exception 'operator context unavailable'; end if;
  if range_end <= range_start or range_end - range_start > interval '62 days' then
    raise exception 'availability range must be positive and at most 62 days';
  end if;
  if cardinality(requested_ids) < 1 or cardinality(requested_ids) > 20 then
    raise exception 'availability requires between 1 and 20 participants';
  end if;
  if context_row.operator_role = 'member' and not (context_row.user_id = any(requested_ids)) then
    raise exception 'member can only consult their own availability';
  end if;
  if exists (
    select 1 from unnest(requested_ids) requested(id)
    where not exists (
      select 1 from public.organization_members member
      where member.organization_id = context_row.organization_id
        and member.user_id = requested.id
        and member.status = 'active'
    )
  ) then
    raise exception 'participant is not an active member of this organization';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', member.user_id,
    'nome', profile.full_name,
    'disponivel', not exists (
      select 1
      from public.calendar_events event
      left join public.calendar_event_participants event_participant
        on event_participant.event_id = event.id
       and event_participant.organization_id = event.organization_id
       and event_participant.participant_id = member.user_id
      where event.organization_id = context_row.organization_id
        and event.deleted_at is null
        and event.status = 'scheduled'
        and (event.owner_id = member.user_id or event_participant.participant_id is not null)
        and event.starts_at < range_end
        and event.ends_at > range_start
    ),
    'motivo', case when exists (
      select 1
      from public.calendar_events event
      left join public.calendar_event_participants event_participant
        on event_participant.event_id = event.id
       and event_participant.organization_id = event.organization_id
       and event_participant.participant_id = member.user_id
      where event.organization_id = context_row.organization_id
        and event.deleted_at is null
        and event.status = 'scheduled'
        and (event.owner_id = member.user_id or event_participant.participant_id is not null)
        and event.starts_at < range_end
        and event.ends_at > range_start
    ) then 'horario-ocupado' else null end
  ) order by coalesce(profile.full_name, ''), member.user_id), '[]'::jsonb)
  into participants_payload
  from public.organization_members member
  left join public.profiles profile on profile.id = member.user_id
  where member.organization_id = context_row.organization_id
    and member.user_id = any(requested_ids)
    and member.status = 'active';

  return jsonb_build_object(
    'organizacaoId', context_row.organization_id,
    'inicio', range_start,
    'fim', range_end,
    'participantes', participants_payload
  );
end;
$$;

create or replace function public.nucleo_calendar_operator_booking_create(
  operator_phone text,
  request_key text,
  requester_hash text,
  booking_title text,
  booking_description text,
  booking_starts_at timestamptz,
  booking_ends_at timestamptz,
  booking_location text,
  booking_reminder_minutes integer[],
  responsible_id uuid,
  participant_ids uuid[],
  contact_id uuid,
  visibility text,
  operator_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  robot_connection uuid;
  safe_title text := trim(coalesce(booking_title, ''));
  safe_description text := trim(coalesce(booking_description, ''));
  safe_location text := trim(coalesce(booking_location, ''));
  safe_reminders integer[] := coalesce(booking_reminder_minutes, array[30]);
  safe_responsible uuid;
  safe_participants uuid[] := array(
    select distinct participant_id
    from unnest(coalesce(participant_ids, '{}'::uuid[])) participant_id
    where participant_id is not null
  );
  operation_hash text;
  existing_booking public.calendar_operator_bookings%rowtype;
  existing_event public.calendar_events%rowtype;
  created_event public.calendar_events%rowtype;
  category_id uuid;
  conflict_payload jsonb;
  matched_contact public.contacts%rowtype;
  operator_id uuid;
begin
  if not operator_confirmed then
    raise exception 'operator confirmation is required before creating a booking';
  end if;
  if request_key is null or request_key !~ '^[0-9a-f]{64}$'
    or requester_hash is null or requester_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid operator booking idempotency key';
  end if;

  select * into context_row
  from public.nucleo_operator_context(operator_phone)
  limit 1;
  if not found then raise exception 'operator context unavailable'; end if;
  operator_id := context_row.user_id;
  safe_responsible := coalesce(responsible_id, operator_id);
  if context_row.operator_role = 'member' and safe_responsible <> operator_id then
    raise exception 'member can only create events owned by themselves';
  end if;
  if visibility not in ('personal', 'organization') then
    raise exception 'invalid event visibility';
  end if;
  if visibility = 'organization' and context_row.operator_role = 'member' then
    raise exception 'member cannot create organization events';
  end if;
  if cardinality(safe_participants) > 20 then
    raise exception 'a booking can have at most 20 participants';
  end if;
  if cardinality(safe_participants) = 0 then
    safe_participants := array[safe_responsible];
  end if;
  if not (safe_responsible = any(safe_participants)) then
    safe_participants := array_append(safe_participants, safe_responsible);
  end if;
  if context_row.operator_role = 'member'
    and exists (select 1 from unnest(safe_participants) p where p <> operator_id) then
    raise exception 'member can only include themselves in a booking';
  end if;
  if exists (
    select 1 from unnest(safe_participants) requested(id)
    where not exists (
      select 1 from public.organization_members member
      where member.organization_id = context_row.organization_id
        and member.user_id = requested.id
        and member.status = 'active'
    )
  ) then
    raise exception 'participant is not an active member of this organization';
  end if;
  if contact_id is not null and not exists (
    select 1 from public.contacts contact
    where contact.id = contact_id and contact.organization_id = context_row.organization_id
      and contact.deleted_at is null
  ) then
    raise exception 'contact is not in this organization';
  end if;
  if length(safe_title) < 1 or length(safe_title) > 240 then
    raise exception 'booking title must have between 1 and 240 characters';
  end if;
  if length(safe_description) > 2000 or length(safe_location) > 500 then
    raise exception 'booking text is too long';
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

  operation_hash := encode(extensions.digest(
    concat_ws('|', operator_id::text, safe_responsible::text, safe_title,
      safe_description, booking_starts_at::text, booking_ends_at::text,
      safe_location, array_to_string(safe_reminders, ','),
      array_to_string(array(select p::text from unnest(safe_participants) p order by 1), ','),
      coalesce(contact_id::text, ''), visibility, requester_hash), 'sha256'), 'hex');

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = context_row.organization_id
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;
  if robot_connection is null then raise exception 'robot connection is inactive or revoked'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(robot_connection::text || ':' || request_key, 0)
  );

  select * into existing_booking
  from public.calendar_operator_bookings booking
  where booking.organization_id = context_row.organization_id
    and booking.connection_id = robot_connection
    and booking.request_key = nucleo_calendar_operator_booking_create.request_key;
  if found then
    if existing_booking.payload_hash <> operation_hash then
      raise exception 'booking request key was already used with different data';
    end if;
    select * into existing_event
    from public.calendar_events event
    where event.id = existing_booking.event_id
      and event.organization_id = context_row.organization_id;
    return jsonb_build_object(
      'criado', false, 'jaExistia', true, 'conflito', false,
      'eventoId', existing_event.id, 'titulo', existing_event.title,
      'inicio', existing_event.starts_at, 'fim', existing_event.ends_at,
      'responsavelId', existing_event.owner_id,
      'participantesIds', existing_booking.participant_ids,
      'contatoId', existing_event.contact_id
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', member.user_id,
    'nome', profile.full_name,
    'disponivel', false,
    'motivo', 'horario-ocupado'
  ) order by coalesce(profile.full_name, ''), member.user_id), '[]'::jsonb)
  into conflict_payload
  from public.organization_members member
  left join public.profiles profile on profile.id = member.user_id
  where member.organization_id = context_row.organization_id
    and member.user_id = any(safe_participants)
    and exists (
      select 1
      from public.calendar_events event
      left join public.calendar_event_participants event_participant
        on event_participant.event_id = event.id
       and event_participant.organization_id = event.organization_id
       and event_participant.participant_id = member.user_id
      where event.organization_id = context_row.organization_id
        and event.deleted_at is null
        and event.status in ('scheduled', 'tentative')
        and (event.owner_id = member.user_id or event_participant.participant_id is not null)
        and event.starts_at < booking_ends_at
        and event.ends_at > booking_starts_at
    );
  if jsonb_array_length(conflict_payload) > 0 then
    return jsonb_build_object(
      'criado', false, 'jaExistia', false, 'conflito', true,
      'participantesIndisponiveis', conflict_payload
    );
  end if;

  select category.id into category_id
  from public.calendar_categories category
  where category.organization_id = context_row.organization_id and category.active
  order by case when category.name = 'Atendimento' then 0 else 1 end,
    category.position, category.id
  limit 1;
  if category_id is null then raise exception 'organization has no active calendar category'; end if;

  begin
    insert into public.calendar_events (
      organization_id, owner_id, title, description, starts_at, ends_at,
      all_day, kind, visibility, contact_id, status, category_id, location,
      tags, reminder_minutes, created_by, updated_by
    ) values (
      context_row.organization_id, safe_responsible, safe_title, safe_description,
      booking_starts_at, booking_ends_at, false, 'appointment', visibility,
      contact_id, 'scheduled', category_id, safe_location,
      array['WhatsApp'], safe_reminders, operator_id, operator_id
    ) returning * into created_event;
  exception when exclusion_violation then
    return jsonb_build_object(
      'criado', false, 'jaExistia', false, 'conflito', true,
      'participantesIndisponiveis', jsonb_build_array(
        jsonb_build_object('id', safe_responsible, 'disponivel', false, 'motivo', 'horario-ocupado')
      )
    );
  end;

  insert into public.calendar_event_participants
    (organization_id, event_id, participant_id)
  select context_row.organization_id, created_event.id, p
  from unnest(safe_participants) p;

  insert into public.calendar_operator_bookings (
    organization_id, connection_id, event_id, operator_id, responsible_id,
    participant_ids, contact_id, request_key, payload_hash, requester_hash
  ) values (
    context_row.organization_id, robot_connection, created_event.id, operator_id,
    safe_responsible, safe_participants, contact_id, request_key, operation_hash,
    requester_hash
  );

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = context_row.organization_id
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object(
    'criado', true, 'jaExistia', false, 'conflito', false,
    'eventoId', created_event.id, 'titulo', created_event.title,
    'inicio', created_event.starts_at, 'fim', created_event.ends_at,
    'responsavelId', created_event.owner_id,
    'participantesIds', safe_participants,
    'contatoId', created_event.contact_id,
    'lembretesMinutos', to_jsonb(created_event.reminder_minutes)
  );
end;
$$;

revoke all on function public.whatsapp_operator_verification_begin(uuid, uuid, uuid, text) from public;
revoke all on function public.nucleo_operator_verification_confirm(text, text) from public;
revoke all on function public.nucleo_operator_context(text) from public;
revoke all on function public.whatsapp_operator_list(uuid, uuid) from public;
revoke all on function public.whatsapp_operator_revoke(uuid, uuid) from public;
revoke all on function public.nucleo_calendar_operator_availability(text, uuid[], timestamptz, timestamptz) from public;
revoke all on function public.nucleo_calendar_operator_booking_create(text, text, text, text, text, timestamptz, timestamptz, text, integer[], uuid, uuid[], uuid, text, boolean) from public;

grant execute on function public.whatsapp_operator_verification_begin(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.nucleo_operator_verification_confirm(text, text) to authenticated;
grant execute on function public.nucleo_operator_context(text) to authenticated;
grant execute on function public.whatsapp_operator_list(uuid, uuid) to authenticated;
grant execute on function public.whatsapp_operator_revoke(uuid, uuid) to authenticated;
grant execute on function public.nucleo_calendar_operator_availability(text, uuid[], timestamptz, timestamptz) to authenticated;
grant execute on function public.nucleo_calendar_operator_booking_create(text, text, text, text, text, timestamptz, timestamptz, text, integer[], uuid, uuid[], uuid, text, boolean) to authenticated;

commit;
