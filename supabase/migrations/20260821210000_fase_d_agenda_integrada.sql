-- Fase D: Agenda Major integrada ao EmyLeads.
--
-- A fonte de verdade continua no Supabase. Esta migration adiciona a camada
-- visual/operacional da agenda, preferências por profissional e uma fila de
-- lembretes. O robô MCP da Fase C permanece somente leitura; a entrega de
-- notificações usa uma identidade Auth separada e só opera por RPCs estreitos.

begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------
-- Categorias e preferências de calendário

create table public.calendar_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer not null default 0 check (position >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

create table public.calendar_member_preferences (
  organization_id uuid not null,
  user_id uuid not null,
  timezone text not null default 'America/Sao_Paulo'
    check (length(trim(timezone)) between 1 and 80),
  day_start time not null default '08:00',
  day_end time not null default '18:00',
  default_view text not null default 'week'
    check (default_view in ('day', 'week', 'month')),
  default_reminder_minutes integer[] not null default array[30],
  in_app_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  phone_e164 text,
  phone_last4 text,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade,
  check (day_end > day_start),
  check (
    cardinality(default_reminder_minutes) <= 5
    and array_position(default_reminder_minutes, null) is null
    and 0 <= all(default_reminder_minutes)
    and 10080 >= all(default_reminder_minutes)
  ),
  check (
    (phone_e164 is null and phone_last4 is null and phone_verified_at is null and whatsapp_enabled = false)
    or (
      phone_e164 ~ '^\+[1-9][0-9]{9,14}$'
      and phone_last4 ~ '^[0-9]{4}$'
      and phone_verified_at is not null
    )
  )
);

alter table public.organization_calendars
  add column if not exists timezone text not null default 'America/Sao_Paulo',
  add column if not exists day_start time not null default '05:00',
  add column if not exists day_end time not null default '23:59';

alter table public.organization_calendars
  drop constraint if exists organization_calendars_day_window_check;
alter table public.organization_calendars
  add constraint organization_calendars_day_window_check check (day_end > day_start);

alter table public.calendar_events
  add column if not exists category_id uuid,
  add column if not exists location text not null default '',
  add column if not exists tags text[] not null default '{}',
  add column if not exists reminder_minutes integer[] not null default array[30];

alter table public.calendar_events
  drop constraint if exists calendar_events_reminder_minutes_check;
alter table public.calendar_events
  add constraint calendar_events_reminder_minutes_check check (
    cardinality(reminder_minutes) <= 5
    and array_position(reminder_minutes, null) is null
    and 0 <= all(reminder_minutes)
    and 10080 >= all(reminder_minutes)
  ),
  add constraint calendar_events_location_length_check check (length(location) <= 500),
  add constraint calendar_events_tags_count_check check (cardinality(tags) <= 12);

alter table public.tasks
  add column if not exists reminder_minutes integer[] not null default array[30];

alter table public.tasks
  drop constraint if exists tasks_reminder_minutes_check;
alter table public.tasks
  add constraint tasks_reminder_minutes_check check (
    cardinality(reminder_minutes) <= 5
    and array_position(reminder_minutes, null) is null
    and 0 <= all(reminder_minutes)
    and 10080 >= all(reminder_minutes)
  );

create or replace function private.seed_calendar_categories(target_organization uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.calendar_categories (organization_id, name, color, position)
  values
    (target_organization, 'Atividade', '#34D399', 0),
    (target_organization, 'Reunião', '#FB923C', 1),
    (target_organization, 'Prioridade', '#A78BFA', 2),
    (target_organization, 'Atendimento', '#60A5FA', 3),
    (target_organization, 'Pessoal', '#FDA4AF', 4),
    (target_organization, 'Deslocamento', '#CBD5E1', 5)
  on conflict (organization_id, name) do nothing;
$$;

create or replace function private.seed_organization_calendar_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_calendar_categories(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_calendar_categories_seed on public.organizations;
create trigger organizations_calendar_categories_seed
after insert on public.organizations
for each row execute function private.seed_organization_calendar_categories();

select private.seed_calendar_categories(id) from public.organizations;

update public.calendar_events event
set category_id = category.id
from public.calendar_categories category
where event.category_id is null
  and category.organization_id = event.organization_id
  and category.name = 'Atividade';

alter table public.calendar_events
  alter column category_id set not null;

alter table public.calendar_events
  drop constraint if exists calendar_events_category_fk;
alter table public.calendar_events
  add constraint calendar_events_category_fk
  foreign key (category_id, organization_id)
  references public.calendar_categories(id, organization_id);

alter table public.calendar_events
  drop constraint if exists calendar_events_status_check;
alter table public.calendar_events
  add constraint calendar_events_status_check
  check (status in ('scheduled', 'tentative', 'cancelled'));

-- Provisório também ocupa horário. A constraint antiga cobria apenas scheduled.
alter table public.calendar_events
  drop constraint if exists calendar_events_no_owner_overlap;
alter table public.calendar_events
  add constraint calendar_events_no_owner_overlap
  exclude using gist (
    organization_id with =,
    owner_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (deleted_at is null and status in ('scheduled', 'tentative'));

create index if not exists calendar_categories_org_idx
  on public.calendar_categories (organization_id, active, position);

create trigger calendar_categories_touch
before update on public.calendar_categories
for each row execute function private.touch_timestamp();

create trigger calendar_member_preferences_touch
before update on public.calendar_member_preferences
for each row execute function private.touch_timestamp();

alter table public.calendar_categories enable row level security;
alter table public.calendar_member_preferences enable row level security;

-- Nem owner/admin pode consultar os detalhes pessoais de outra pessoa pela
-- tabela base. A disponibilidade da equipe passa exclusivamente pelo RPC
-- mascarado; cargos maiores administram somente eventos corporativos.
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
for select using (
  private.is_org_member(organization_id)
  and deleted_at is null
  and (owner_id = auth.uid() or visibility = 'organization')
);

create policy calendar_categories_select on public.calendar_categories
for select using (private.is_org_member(organization_id));

create policy calendar_categories_manage on public.calendar_categories
for all using (private.can_manage_org(organization_id))
with check (private.can_manage_org(organization_id));

create policy calendar_member_preferences_select_self on public.calendar_member_preferences
for select using (private.is_org_member(organization_id) and user_id = auth.uid());

create policy calendar_member_preferences_insert_self on public.calendar_member_preferences
for insert with check (private.is_org_member(organization_id) and user_id = auth.uid());

create policy calendar_member_preferences_update_self on public.calendar_member_preferences
for update using (private.is_org_member(organization_id) and user_id = auth.uid())
with check (private.is_org_member(organization_id) and user_id = auth.uid());

-- -------------------------------------------------------------------------
-- Identidade separada do trabalhador de notificações

create table public.connection_notification_credentials (
  connection_id uuid primary key,
  organization_id uuid not null,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade,
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

alter table public.connection_notification_credentials enable row level security;

create policy connection_notification_credentials_select on public.connection_notification_credentials
for select using (private.can_manage_org(organization_id));

create or replace function private.is_notification_worker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'is_notification_worker', 'false') = 'true';
$$;

create or replace function private.notification_worker_organization()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select credential.organization_id
  from public.connection_notification_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
    and private.is_notification_worker()
    and auth.jwt() -> 'app_metadata' ->> 'organization_id' = credential.organization_id::text
    and auth.jwt() -> 'app_metadata' ->> 'connection_id' = credential.connection_id::text
  limit 1;
$$;

create or replace function private.notification_worker_connection()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select credential.connection_id
  from public.connection_notification_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.status = 'active'
    and credential.organization_id = private.notification_worker_organization()
  limit 1;
$$;

-- A regra de produto é uma conta WhatsApp por organização. Histórico revogado
-- continua permitido; duas conexões operacionais simultâneas não.
do $$
begin
  if exists (
    select organization_id
    from public.whatsapp_connections
    where revoked_at is null and status <> 'revoked'
    group by organization_id
    having count(*) > 1
  ) then
    raise exception 'fase D: há organizações com mais de uma conexão WhatsApp não revogada';
  end if;
end;
$$;

create unique index if not exists whatsapp_connections_one_live_per_org
  on public.whatsapp_connections (organization_id)
  where revoked_at is null and status <> 'revoked';

-- -------------------------------------------------------------------------
-- Verificação do telefone e fila de lembretes

create table public.calendar_phone_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{9,14}$'),
  code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'verified', 'failed', 'expired')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  claimed_by_connection uuid,
  claim_expires_at timestamptz,
  sent_at timestamptz,
  verified_at timestamptz,
  error_code text,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade,
  foreign key (claimed_by_connection, organization_id)
    references public.whatsapp_connections(id, organization_id)
);

create table public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  event_id uuid references public.calendar_events(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  source_version bigint not null,
  title_snapshot text not null,
  starts_at_snapshot timestamptz not null,
  remind_at timestamptz not null,
  channel text not null check (channel in ('in_app', 'whatsapp')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'review')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_by_connection uuid,
  claim_expires_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((event_id is not null)::integer + (task_id is not null)::integer = 1),
  foreign key (claimed_by_connection, organization_id)
    references public.whatsapp_connections(id, organization_id)
);

create unique index calendar_reminders_event_live_idx
  on public.calendar_reminders (event_id, channel, remind_at)
  where event_id is not null and status <> 'cancelled';

create unique index calendar_reminders_task_live_idx
  on public.calendar_reminders (task_id, channel, remind_at)
  where task_id is not null and status <> 'cancelled';

create index calendar_reminders_due_idx
  on public.calendar_reminders (organization_id, channel, status, next_attempt_at, remind_at);

create index calendar_reminders_owner_idx
  on public.calendar_reminders (organization_id, owner_id, created_at desc);

create index calendar_phone_verifications_claim_idx
  on public.calendar_phone_verifications (organization_id, status, created_at);

create trigger calendar_reminders_touch
before update on public.calendar_reminders
for each row execute function private.touch_timestamp();

alter table public.calendar_phone_verifications enable row level security;
alter table public.calendar_reminders enable row level security;

-- Solicitações de telefone só passam pelas funções abaixo. Nem o próprio
-- usuário recebe code_hash ou telefone por SELECT direto.
create policy calendar_reminders_select_owner on public.calendar_reminders
for select using (private.is_org_member(organization_id) and owner_id = auth.uid());

create or replace function private.enqueue_calendar_reminders(
  target_organization uuid,
  target_owner uuid,
  target_event uuid,
  target_task uuid,
  target_version bigint,
  target_title text,
  target_starts_at timestamptz,
  target_minutes integer[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  minutes_before integer;
  target_remind_at timestamptz;
  send_in_app boolean := true;
  send_whatsapp boolean := false;
begin
  if target_owner is null or target_starts_at <= now() - interval '1 minute' then
    return;
  end if;

  select preference.in_app_enabled, preference.whatsapp_enabled
  into send_in_app, send_whatsapp
  from public.calendar_member_preferences preference
  where preference.organization_id = target_organization
    and preference.user_id = target_owner;
  if not found then
    send_in_app := true;
    send_whatsapp := false;
  end if;

  foreach minutes_before in array coalesce(target_minutes, '{}'::integer[])
  loop
    target_remind_at := target_starts_at - make_interval(mins => minutes_before);
    if send_in_app then
      insert into public.calendar_reminders (
        organization_id, owner_id, event_id, task_id, source_version,
        title_snapshot, starts_at_snapshot, remind_at, channel
      ) values (
        target_organization, target_owner, target_event, target_task, target_version,
        target_title, target_starts_at, target_remind_at, 'in_app'
      ) on conflict do nothing;
    end if;
    if send_whatsapp then
      insert into public.calendar_reminders (
        organization_id, owner_id, event_id, task_id, source_version,
        title_snapshot, starts_at_snapshot, remind_at, channel
      ) values (
        target_organization, target_owner, target_event, target_task, target_version,
        target_title, target_starts_at, target_remind_at, 'whatsapp'
      ) on conflict do nothing;
    end if;
  end loop;
end;
$$;

create or replace function private.rebuild_member_calendar_reminders(
  target_organization uuid,
  target_owner uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
begin
  update public.calendar_reminders reminder
  set status = 'cancelled', error_code = 'preferences-updated'
  where reminder.organization_id = target_organization
    and reminder.owner_id = target_owner
    and reminder.status in ('pending', 'failed');

  for item in
    select event.id, null::uuid task_id, event.version, event.title,
      event.starts_at starts_at, event.reminder_minutes
    from public.calendar_events event
    where event.organization_id = target_organization
      and event.owner_id = target_owner
      and event.deleted_at is null
      and event.status in ('scheduled', 'tentative')
      and event.starts_at > now()
    union all
    select null::uuid, task.id, task.version, task.title,
      task.due_at, task.reminder_minutes
    from public.tasks task
    where task.organization_id = target_organization
      and coalesce(task.owner_id, task.created_by) = target_owner
      and task.deleted_at is null and not task.completed
      and task.due_at > now()
  loop
    perform private.enqueue_calendar_reminders(
      target_organization, target_owner, item.id, item.task_id, item.version,
      item.title, item.starts_at, item.reminder_minutes
    );
  end loop;
end;
$$;

create or replace function private.calendar_event_reschedule_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    update public.calendar_reminders
    set status = 'cancelled', error_code = 'source-updated'
    where event_id = new.id and status in ('pending', 'processing', 'failed');
  end if;

  if new.deleted_at is null and new.status in ('scheduled', 'tentative') then
    perform private.enqueue_calendar_reminders(
      new.organization_id, new.owner_id, new.id, null, new.version,
      new.title, new.starts_at, new.reminder_minutes
    );
  end if;
  return new;
end;
$$;

create or replace function private.task_reschedule_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  responsible uuid := coalesce(new.owner_id, new.created_by);
begin
  if tg_op = 'UPDATE' then
    update public.calendar_reminders
    set status = 'cancelled', error_code = 'source-updated'
    where task_id = new.id and status in ('pending', 'processing', 'failed');
  end if;

  if new.deleted_at is null and not new.completed and new.due_at is not null then
    perform private.enqueue_calendar_reminders(
      new.organization_id, responsible, null, new.id, new.version,
      new.title, new.due_at, new.reminder_minutes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_reminders_schedule on public.calendar_events;
create trigger calendar_events_reminders_schedule
after insert or update of starts_at, owner_id, title, status, deleted_at, reminder_minutes
on public.calendar_events
for each row execute function private.calendar_event_reschedule_reminders();

drop trigger if exists tasks_reminders_schedule on public.tasks;
create trigger tasks_reminders_schedule
after insert or update of due_at, owner_id, title, completed, deleted_at, reminder_minutes
on public.tasks
for each row execute function private.task_reschedule_reminders();

-- Backfill somente itens futuros. A função é idempotente pelos índices únicos.
select private.enqueue_calendar_reminders(
  organization_id, owner_id, id, null, version, title, starts_at, reminder_minutes
)
from public.calendar_events
where deleted_at is null and status in ('scheduled', 'tentative') and starts_at > now();

select private.enqueue_calendar_reminders(
  organization_id, coalesce(owner_id, created_by), null, id, version, title, due_at, reminder_minutes
)
from public.tasks
where deleted_at is null and not completed and due_at > now()
  and coalesce(owner_id, created_by) is not null;

-- -------------------------------------------------------------------------
-- RPCs da interface

create or replace function public.calendar_context(target_organization uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization access denied';
  end if;

  insert into public.calendar_member_preferences (organization_id, user_id)
  values (target_organization, auth.uid())
  on conflict (organization_id, user_id) do nothing;

  select jsonb_build_object(
    'calendar', jsonb_build_object(
      'organizationId', calendar.organization_id,
      'displayName', calendar.display_name,
      'timezone', calendar.timezone,
      'dayStart', calendar.day_start,
      'dayEnd', calendar.day_end,
      'googleEnabled', calendar.enabled
    ),
    'preference', jsonb_build_object(
      'timezone', preference.timezone,
      'dayStart', preference.day_start,
      'dayEnd', preference.day_end,
      'defaultView', preference.default_view,
      'defaultReminderMinutes', preference.default_reminder_minutes,
      'inAppEnabled', preference.in_app_enabled,
      'whatsappEnabled', preference.whatsapp_enabled,
      'phoneLast4', preference.phone_last4,
      'phoneVerified', preference.phone_verified_at is not null
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', member.user_id,
        'name', profile.full_name,
        'role', member.role,
        'responsibility', coalesce(member.responsibility, ''),
        'phoneVerified', case when member.user_id = auth.uid()
          then own_preference.phone_verified_at is not null else null end
      ) order by profile.full_name), '[]'::jsonb)
      from public.organization_members member
      join public.profiles profile on profile.id = member.user_id
      left join public.calendar_member_preferences own_preference
        on own_preference.organization_id = member.organization_id
       and own_preference.user_id = member.user_id
      where member.organization_id = target_organization and member.status = 'active'
    ),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', category.id,
        'name', category.name,
        'color', category.color,
        'position', category.position
      ) order by category.position, category.name), '[]'::jsonb)
      from public.calendar_categories category
      where category.organization_id = target_organization and category.active
    )
  ) into result
  from public.organization_calendars calendar
  join public.calendar_member_preferences preference
    on preference.organization_id = calendar.organization_id
   and preference.user_id = auth.uid()
  where calendar.organization_id = target_organization;

  return result;
end;
$$;

create or replace function public.calendar_preferences_update(
  target_organization uuid,
  target_default_view text,
  target_day_start time,
  target_day_end time,
  target_default_reminders integer[],
  target_in_app_enabled boolean,
  target_whatsapp_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization access denied';
  end if;
  if target_default_view not in ('day', 'week', 'month') or target_day_end <= target_day_start then
    raise exception 'invalid calendar preferences';
  end if;
  if target_default_reminders is null
    or cardinality(target_default_reminders) > 5
    or array_position(target_default_reminders, null) is not null
    or not (0 <= all(target_default_reminders) and 10080 >= all(target_default_reminders)) then
    raise exception 'invalid reminder minutes';
  end if;
  if target_whatsapp_enabled and not exists (
    select 1
    from public.calendar_member_preferences preference
    where preference.organization_id = target_organization
      and preference.user_id = auth.uid()
      and preference.phone_verified_at is not null
  ) then
    raise exception 'verify the notification phone before enabling WhatsApp reminders';
  end if;

  insert into public.calendar_member_preferences (
    organization_id, user_id, default_view, day_start, day_end,
    default_reminder_minutes, in_app_enabled, whatsapp_enabled
  ) values (
    target_organization, auth.uid(), target_default_view, target_day_start, target_day_end,
    target_default_reminders, target_in_app_enabled, target_whatsapp_enabled
  )
  on conflict (organization_id, user_id) do update set
    default_view = excluded.default_view,
    day_start = excluded.day_start,
    day_end = excluded.day_end,
    default_reminder_minutes = excluded.default_reminder_minutes,
    in_app_enabled = excluded.in_app_enabled,
    whatsapp_enabled = excluded.whatsapp_enabled;

  perform private.rebuild_member_calendar_reminders(target_organization, auth.uid());
end;
$$;

create or replace function public.calendar_phone_verification_begin(
  target_organization uuid,
  target_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := '+' || regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g');
  request_id uuid;
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization access denied';
  end if;
  if normalized !~ '^\+[1-9][0-9]{9,14}$' then
    raise exception 'invalid phone; include country and area code';
  end if;
  if exists (
    select 1 from public.calendar_phone_verifications verification
    where verification.organization_id = target_organization
      and verification.user_id = auth.uid()
      and verification.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'wait 60 seconds before requesting another code';
  end if;
  if (
    select count(*) from public.calendar_phone_verifications verification
    where verification.organization_id = target_organization
      and verification.user_id = auth.uid()
      and verification.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'phone verification rate limit exceeded';
  end if;

  update public.calendar_phone_verifications
  set status = 'expired'
  where organization_id = target_organization and user_id = auth.uid()
    and status in ('pending', 'processing', 'sent');

  insert into public.calendar_phone_verifications (organization_id, user_id, phone_e164)
  values (target_organization, auth.uid(), normalized)
  returning id into request_id;
  return request_id;
end;
$$;

create or replace function public.calendar_phone_verification_confirm(
  verification_id uuid,
  verification_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  verification public.calendar_phone_verifications%rowtype;
begin
  select * into verification
  from public.calendar_phone_verifications
  where id = verification_id and user_id = auth.uid()
  for update;
  if not found or verification.status <> 'sent' or verification.expires_at <= now() then
    raise exception 'verification code invalid or expired';
  end if;
  if verification.attempts >= 5 then
    raise exception 'verification code invalid or expired';
  end if;

  if verification.code_hash is null
    or verification.code_hash <> encode(digest(trim(verification_code), 'sha256'), 'hex') then
    update public.calendar_phone_verifications
    set attempts = attempts + 1,
        status = case when attempts + 1 >= 5 then 'failed' else status end,
        error_code = case when attempts + 1 >= 5 then 'too-many-attempts' else error_code end
    where id = verification_id;
    return false;
  end if;

  insert into public.calendar_member_preferences (
    organization_id, user_id, phone_e164, phone_last4, phone_verified_at, whatsapp_enabled
  ) values (
    verification.organization_id, verification.user_id, verification.phone_e164,
    right(verification.phone_e164, 4), now(), true
  )
  on conflict (organization_id, user_id) do update set
    phone_e164 = excluded.phone_e164,
    phone_last4 = excluded.phone_last4,
    phone_verified_at = excluded.phone_verified_at,
    whatsapp_enabled = true;

  update public.calendar_phone_verifications
  set status = 'verified', verified_at = now()
  where id = verification_id;

  perform private.rebuild_member_calendar_reminders(
    verification.organization_id, verification.user_id
  );
  return true;
end;
$$;

create or replace function public.calendar_notifications_list(
  target_organization uuid,
  max_items integer default 50
)
returns table (
  id uuid,
  source_type text,
  source_id uuid,
  title text,
  starts_at timestamptz,
  remind_at timestamptz,
  channel text,
  status text,
  delivered_at timestamptz,
  read_at timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization access denied';
  end if;
  max_items := greatest(1, least(coalesce(max_items, 50), 100));

  update public.calendar_reminders reminder
  set status = 'sent', delivered_at = coalesce(reminder.delivered_at, now())
  where reminder.organization_id = target_organization
    and reminder.owner_id = auth.uid()
    and reminder.channel = 'in_app'
    and reminder.status = 'pending'
    and reminder.remind_at <= now();

  return query
  select reminder.id,
    case when reminder.event_id is not null then 'event' else 'task' end,
    coalesce(reminder.event_id, reminder.task_id),
    reminder.title_snapshot,
    reminder.starts_at_snapshot,
    reminder.remind_at,
    reminder.channel,
    reminder.status,
    reminder.delivered_at,
    reminder.read_at,
    reminder.error_code
  from public.calendar_reminders reminder
  where reminder.organization_id = target_organization
    and reminder.owner_id = auth.uid()
    and reminder.status <> 'cancelled'
  order by coalesce(reminder.delivered_at, reminder.remind_at) desc
  limit max_items;
end;
$$;

create or replace function public.calendar_notification_mark_read(
  target_organization uuid,
  notification_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.calendar_reminders
  set read_at = now()
  where id = notification_id
    and organization_id = target_organization
    and owner_id = auth.uid()
    and private.is_org_member(target_organization);
$$;

-- A assinatura anterior é descartada porque o retorno ganhou colunas. Os
-- nomes antigos e sua semântica permanecem iguais para clientes existentes.
drop function if exists public.calendar_events_list(uuid, timestamptz, timestamptz);
create function public.calendar_events_list(
  target_organization uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  id uuid,
  source_type text,
  task_id uuid,
  organization_id uuid,
  owner_id uuid,
  owner_name text,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  kind text,
  visibility text,
  contact_id uuid,
  status text,
  google_event_id text,
  google_calendar_id text,
  category_id uuid,
  category_name text,
  category_color text,
  location text,
  tags text[],
  reminder_minutes integer[]
)
language sql
security definer
set search_path = ''
as $$
  select
    event.id,
    'event'::text,
    null::uuid,
    event.organization_id,
    event.owner_id,
    profile.full_name,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.title else 'Indisponível' end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.description else '' end,
    event.starts_at,
    event.ends_at,
    event.all_day,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.kind else 'blocked' end,
    event.visibility,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.contact_id else null end,
    event.status,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.google_event_id else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.google_calendar_id else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.category_id else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then category.name else null end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then category.color else '#CBD5E1' end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.location else '' end,
    case when event.visibility = 'organization' or event.owner_id = auth.uid()
      then event.tags else '{}'::text[] end,
    case when event.owner_id = auth.uid()
      then event.reminder_minutes else '{}'::integer[] end
  from public.calendar_events event
  join public.profiles profile on profile.id = event.owner_id
  join public.calendar_categories category on category.id = event.category_id
  where event.organization_id = target_organization
    and event.deleted_at is null
    and event.status in ('scheduled', 'tentative')
    and event.starts_at < range_end
    and event.ends_at > range_start
    and private.is_org_member(target_organization)

  union all

  select
    task.id,
    'task'::text,
    task.id,
    task.organization_id,
    coalesce(task.owner_id, task.created_by),
    coalesce(profile.full_name, task.owner_label),
    task.title,
    ''::text,
    task.due_at,
    task.due_at + interval '30 minutes',
    false,
    'task'::text,
    'organization'::text,
    task.contact_id,
    case when task.completed then 'completed' else 'scheduled' end,
    null::text,
    null::text,
    null::uuid,
    'Tarefa'::text,
    '#F59E0B'::text,
    ''::text,
    '{}'::text[],
    case when coalesce(task.owner_id, task.created_by) = auth.uid()
      then task.reminder_minutes else '{}'::integer[] end
  from public.tasks task
  left join public.profiles profile on profile.id = task.owner_id
  where task.organization_id = target_organization
    and task.deleted_at is null
    and not task.completed
    and task.due_at is not null
    and task.due_at >= range_start
    and task.due_at < range_end
    and private.is_org_member(target_organization)

  order by starts_at;
$$;

-- -------------------------------------------------------------------------
-- RPCs estreitos do trabalhador de notificações

create or replace function public.notification_worker_claim_verifications(max_items integer default 5)
returns table (verification_id uuid, phone_e164 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
begin
  if worker_org is null or worker_connection is null then
    raise exception 'notification worker credential is inactive';
  end if;
  max_items := greatest(1, least(coalesce(max_items, 5), 20));

  update public.calendar_phone_verifications verification
  set status = 'expired'
  where verification.organization_id = worker_org
    and verification.status in ('pending', 'processing', 'sent')
    and verification.expires_at <= now();

  update public.calendar_phone_verifications verification
  set status = 'pending', claimed_by_connection = null, claim_expires_at = null
  where verification.organization_id = worker_org
    and verification.status = 'processing'
    and verification.claim_expires_at <= now()
    and verification.code_hash is null;

  return query
  with candidates as (
    select verification.id
    from public.calendar_phone_verifications verification
    where verification.organization_id = worker_org
      and verification.status = 'pending'
      and verification.expires_at > now()
    order by verification.created_at
    for update skip locked
    limit max_items
  )
  update public.calendar_phone_verifications verification
  set status = 'processing', claimed_by_connection = worker_connection,
      claim_expires_at = now() + interval '2 minutes'
  from candidates
  where verification.id = candidates.id
  returning verification.id, verification.phone_e164;
end;
$$;

create or replace function public.notification_worker_set_verification_code(
  verification_id uuid,
  target_code_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
begin
  if target_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid verification hash';
  end if;
  update public.calendar_phone_verifications
  set code_hash = target_code_hash
  where id = verification_id and organization_id = worker_org
    and claimed_by_connection = worker_connection and status = 'processing';
  if not found then raise exception 'verification claim not found'; end if;
end;
$$;

create or replace function public.notification_worker_complete_verification(
  verification_id uuid,
  result_status text,
  result_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
begin
  if result_status not in ('sent', 'failed') then raise exception 'invalid verification result'; end if;
  update public.calendar_phone_verifications
  set status = result_status,
      sent_at = case when result_status = 'sent' then now() else sent_at end,
      error_code = left(result_error, 160),
      claim_expires_at = null
  where id = verification_id and organization_id = worker_org
    and claimed_by_connection = worker_connection and status = 'processing';
  if not found then raise exception 'verification claim not found'; end if;
end;
$$;

create or replace function public.notification_worker_claim_reminders(max_items integer default 20)
returns table (
  reminder_id uuid,
  recipient_phone text,
  title text,
  starts_at timestamptz,
  source_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
begin
  if worker_org is null or worker_connection is null then
    raise exception 'notification worker credential is inactive';
  end if;
  max_items := greatest(1, least(coalesce(max_items, 20), 50));

  update public.calendar_reminders reminder
  set status = case when reminder.attempt_count >= 3 then 'review' else 'pending' end,
      claimed_by_connection = null,
      claim_expires_at = null,
      error_code = case when reminder.attempt_count >= 3 then 'lease-expired' else reminder.error_code end
  where reminder.organization_id = worker_org
    and reminder.channel = 'whatsapp'
    and reminder.status = 'processing'
    and reminder.claim_expires_at <= now();

  update public.calendar_reminders reminder
  set status = 'failed', error_code = 'phone-not-verified'
  where reminder.organization_id = worker_org
    and reminder.channel = 'whatsapp'
    and reminder.status = 'pending'
    and reminder.remind_at <= now()
    and not exists (
      select 1 from public.calendar_member_preferences preference
      where preference.organization_id = reminder.organization_id
        and preference.user_id = reminder.owner_id
        and preference.whatsapp_enabled
        and preference.phone_verified_at is not null
    );

  return query
  with candidates as (
    select reminder.id
    from public.calendar_reminders reminder
    join public.calendar_member_preferences preference
      on preference.organization_id = reminder.organization_id
     and preference.user_id = reminder.owner_id
     and preference.whatsapp_enabled
     and preference.phone_verified_at is not null
    where reminder.organization_id = worker_org
      and reminder.channel = 'whatsapp'
      and reminder.status = 'pending'
      and reminder.attempt_count < 3
      and reminder.remind_at <= now()
      and reminder.next_attempt_at <= now()
    order by reminder.remind_at
    for update of reminder skip locked
    limit max_items
  )
  update public.calendar_reminders reminder
  set status = 'processing', attempt_count = reminder.attempt_count + 1,
      claimed_by_connection = worker_connection,
      claim_expires_at = now() + interval '5 minutes'
  from candidates, public.calendar_member_preferences preference
  where reminder.id = candidates.id
    and preference.organization_id = reminder.organization_id
    and preference.user_id = reminder.owner_id
  returning reminder.id, preference.phone_e164, reminder.title_snapshot,
    reminder.starts_at_snapshot,
    case when reminder.event_id is not null then 'event' else 'task' end;
end;
$$;

create or replace function public.notification_worker_complete_reminder(
  reminder_id uuid,
  result_status text,
  result_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
begin
  if result_status not in ('sent', 'retry', 'review', 'simulate') then
    raise exception 'invalid reminder result';
  end if;
  update public.calendar_reminders
  set status = case
        when result_status = 'retry' and attempt_count >= 3 then 'failed'
        when result_status in ('retry', 'simulate') then 'pending'
        else result_status
      end,
      delivered_at = case when result_status = 'sent' then now() else delivered_at end,
      attempt_count = case
        when result_status = 'simulate' then greatest(attempt_count - 1, 0)
        else attempt_count
      end,
      next_attempt_at = case
        when result_status = 'retry' and attempt_count < 3 then now() + interval '1 minute'
        when result_status = 'simulate' then now() + interval '5 minutes'
        else next_attempt_at
      end,
      error_code = left(result_error, 160),
      claim_expires_at = null
  where id = reminder_id and organization_id = worker_org
    and claimed_by_connection = worker_connection and status = 'processing';
  if not found then raise exception 'reminder claim not found'; end if;

  update public.connection_notification_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid() and organization_id = worker_org and status = 'active';
end;
$$;

create or replace function public.revoke_connection_notification_worker(target_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
begin
  select organization_id into target_org
  from public.connection_notification_credentials
  where connection_id = target_connection;
  if target_org is null or not private.can_manage_org(target_org) then
    raise exception 'notification credential not found or permission denied';
  end if;
  update public.connection_notification_credentials
  set status = 'revoked', revoked_at = now()
  where connection_id = target_connection and status = 'active';
end;
$$;

-- Mantém o MCP da Fase C compatível e inclui os novos metadados somente
-- quando a visibilidade permite. A ferramenta continua estritamente leitura.
create or replace function public.nucleo_calendar_list(
  selected_agent uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  events_payload jsonb;
  tasks_payload jsonb;
begin
  if robot_org is null then raise exception 'robot credential is inactive or connection was revoked'; end if;
  if range_end <= range_start or range_end - range_start > interval '62 days' then
    raise exception 'calendar range must be positive and at most 62 days';
  end if;
  if selected_agent is not null and not exists (
    select 1 from public.organization_members member
    where member.organization_id = robot_org and member.user_id = selected_agent and member.status = 'active'
  ) then
    raise exception 'selected agent is not an active member of this organization';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'inicio'), '[]'::jsonb)
  into events_payload
  from (
    select jsonb_build_object(
      'id', event.id,
      'fonte', 'evento',
      'titulo', case when event.visibility = 'organization' or event.owner_id = selected_agent then event.title else 'Indisponível' end,
      'descricao', case when event.visibility = 'organization' or event.owner_id = selected_agent then event.description else '' end,
      'inicio', event.starts_at,
      'fim', event.ends_at,
      'diaInteiro', event.all_day,
      'tipo', case when event.visibility = 'organization' or event.owner_id = selected_agent then event.kind else 'blocked' end,
      'visibilidade', event.visibility,
      'status', event.status,
      'responsavelId', event.owner_id,
      'responsavelNome', profile.full_name,
      'contatoId', case when event.visibility = 'organization' or event.owner_id = selected_agent then event.contact_id else null end,
      'categoria', case when event.visibility = 'organization' or event.owner_id = selected_agent then category.name else null end,
      'local', case when event.visibility = 'organization' or event.owner_id = selected_agent then event.location else '' end,
      'tags', case when event.visibility = 'organization' or event.owner_id = selected_agent then to_jsonb(event.tags) else '[]'::jsonb end
    ) item
    from public.calendar_events event
    join public.profiles profile on profile.id = event.owner_id
    join public.calendar_categories category on category.id = event.category_id
    where event.organization_id = robot_org
      and event.deleted_at is null
      and event.status in ('scheduled', 'tentative')
      and event.starts_at < range_end and event.ends_at > range_start
  ) events;

  select coalesce(jsonb_agg(item order by item ->> 'inicio'), '[]'::jsonb)
  into tasks_payload
  from (
    select jsonb_build_object(
      'id', task.id,
      'fonte', 'tarefa',
      'titulo', task.title,
      'inicio', task.due_at,
      'fim', task.due_at + interval '30 minutes',
      'concluida', task.completed,
      'responsavelId', task.owner_id,
      'responsavelNome', coalesce(profile.full_name, task.owner_label),
      'contatoId', task.contact_id,
      'negocioId', task.deal_id
    ) item
    from public.tasks task
    left join public.profiles profile on profile.id = task.owner_id
    where task.organization_id = robot_org
      and task.deleted_at is null and not task.completed and task.due_at is not null
      and task.due_at >= range_start and task.due_at < range_end
  ) tasks;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid() and organization_id = robot_org and status = 'active';

  return jsonb_build_object(
    'organizationId', robot_org,
    'selectedAgentId', selected_agent,
    'periodo', jsonb_build_object('de', range_start, 'ate', range_end),
    'eventos', events_payload,
    'tarefas', tasks_payload
  );
end;
$$;

-- -------------------------------------------------------------------------
-- Grants. Dados sensíveis continuam inacessíveis por tabela.

revoke all on public.calendar_phone_verifications from anon, authenticated;
revoke all on public.connection_notification_credentials from anon;
revoke all on public.calendar_reminders from anon;

grant select, insert, update, delete on public.calendar_categories to authenticated;
grant select, insert, update on public.calendar_member_preferences to authenticated;
grant select on public.connection_notification_credentials to authenticated;
grant select on public.calendar_reminders to authenticated;
grant select, insert, update, delete on public.calendar_events to authenticated;

revoke all on function public.calendar_context(uuid) from public;
revoke all on function public.calendar_preferences_update(uuid, text, time, time, integer[], boolean, boolean) from public;
revoke all on function public.calendar_phone_verification_begin(uuid, text) from public;
revoke all on function public.calendar_phone_verification_confirm(uuid, text) from public;
revoke all on function public.calendar_notifications_list(uuid, integer) from public;
revoke all on function public.calendar_notification_mark_read(uuid, uuid) from public;
revoke all on function public.calendar_events_list(uuid, timestamptz, timestamptz) from public;
revoke all on function public.notification_worker_claim_verifications(integer) from public;
revoke all on function public.notification_worker_set_verification_code(uuid, text) from public;
revoke all on function public.notification_worker_complete_verification(uuid, text, text) from public;
revoke all on function public.notification_worker_claim_reminders(integer) from public;
revoke all on function public.notification_worker_complete_reminder(uuid, text, text) from public;
revoke all on function public.revoke_connection_notification_worker(uuid) from public;
revoke all on function public.nucleo_calendar_list(uuid, timestamptz, timestamptz) from public;

grant execute on function public.calendar_context(uuid) to authenticated;
grant execute on function public.calendar_preferences_update(uuid, text, time, time, integer[], boolean, boolean) to authenticated;
grant execute on function public.calendar_phone_verification_begin(uuid, text) to authenticated;
grant execute on function public.calendar_phone_verification_confirm(uuid, text) to authenticated;
grant execute on function public.calendar_notifications_list(uuid, integer) to authenticated;
grant execute on function public.calendar_notification_mark_read(uuid, uuid) to authenticated;
grant execute on function public.calendar_events_list(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.notification_worker_claim_verifications(integer) to authenticated;
grant execute on function public.notification_worker_set_verification_code(uuid, text) to authenticated;
grant execute on function public.notification_worker_complete_verification(uuid, text, text) to authenticated;
grant execute on function public.notification_worker_claim_reminders(integer) to authenticated;
grant execute on function public.notification_worker_complete_reminder(uuid, text, text) to authenticated;
grant execute on function public.revoke_connection_notification_worker(uuid) to authenticated;
grant execute on function public.nucleo_calendar_list(uuid, timestamptz, timestamptz) to authenticated;

commit;
