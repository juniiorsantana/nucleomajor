-- Fase B: agenda compartilhada da organização.
--
-- O calendário da empresa é único por organização. Eventos pessoais e
-- bloqueios continuam no mesmo conjunto de dados, mas a função de leitura
-- mascara o título e a descrição para os demais profissionais.

create table public.organization_calendars (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  calendar_id text,
  display_name text not null default 'Agenda compartilhada',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  title text not null check (length(trim(title)) between 1 and 240),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  kind text not null default 'appointment'
    check (kind in ('appointment', 'block', 'event')),
  visibility text not null default 'personal'
    check (visibility in ('personal', 'organization')),
  contact_id uuid,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled')),
  google_event_id text,
  google_calendar_id text,
  google_etag text,
  google_updated_at timestamptz,
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id),
  check (ends_at > starts_at),
  check (visibility = 'personal' or kind in ('appointment', 'event'))
);

create extension if not exists btree_gist;

alter table public.calendar_events
  add constraint calendar_events_no_owner_overlap
  exclude using gist (
    organization_id with =,
    owner_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (deleted_at is null and status = 'scheduled');

alter table public.tasks
  add column if not exists owner_id uuid references public.profiles(id);

create index if not exists calendar_events_range_idx
  on public.calendar_events (organization_id, starts_at, ends_at)
  where deleted_at is null and status = 'scheduled';
create index if not exists calendar_events_owner_idx
  on public.calendar_events (organization_id, owner_id, starts_at)
  where deleted_at is null;
create index if not exists tasks_agenda_due_idx
  on public.tasks (organization_id, due_at)
  where deleted_at is null and completed = false and due_at is not null;

create or replace function private.seed_organization_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_calendars (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_calendar_seed on public.organizations;
create trigger organizations_calendar_seed
after insert on public.organizations
for each row execute function private.seed_organization_calendar();

insert into public.organization_calendars (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

create or replace function private.calendar_event_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  if auth.uid() is not null then new.updated_by = auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists organization_calendars_touch on public.organization_calendars;
create trigger organization_calendars_touch
before update on public.organization_calendars
for each row execute function private.touch_timestamp();

drop trigger if exists calendar_events_touch on public.calendar_events;
create trigger calendar_events_touch
before update on public.calendar_events
for each row execute function private.calendar_event_touch();

drop trigger if exists calendar_events_org_immutable on public.calendar_events;
create trigger calendar_events_org_immutable
before update on public.calendar_events
for each row execute function private.prevent_organization_change();

alter table public.organization_calendars enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists organization_calendars_select on public.organization_calendars;
create policy organization_calendars_select on public.organization_calendars
for select using (private.is_org_member(organization_id));

drop policy if exists organization_calendars_manage on public.organization_calendars;
create policy organization_calendars_manage on public.organization_calendars
for all using (private.can_manage_org(organization_id))
with check (private.can_manage_org(organization_id));

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
for select using (
  private.is_org_member(organization_id)
  and deleted_at is null
  and (
    owner_id = auth.uid()
    or (visibility = 'organization' and status = 'scheduled')
    or private.can_manage_org(organization_id)
  )
);

drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events
for insert with check (
  private.is_org_member(organization_id)
  and created_by = auth.uid()
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization' and private.can_manage_org(organization_id))
  )
);

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events
for update using (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization' and private.can_manage_org(organization_id))
  )
)
with check (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization' and private.can_manage_org(organization_id))
  )
);

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events
for delete using (
  private.is_org_member(organization_id)
  and (
    (visibility = 'personal' and owner_id = auth.uid())
    or (visibility = 'organization' and private.can_manage_org(organization_id))
  )
);

-- A leitura sempre passa por esta função. Assim o colega consegue montar a
-- disponibilidade da equipe sem receber o assunto ou a descrição pessoal.
create or replace function public.calendar_events_list(
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
  google_calendar_id text
)
language sql
security definer
set search_path = ''
as $$
  select
    e.id,
    'event'::text,
    null::uuid,
    e.organization_id,
    e.owner_id,
    p.full_name,
    case
      when e.visibility = 'organization'
        or e.owner_id = auth.uid()
        then e.title
      else 'Indisponível'
    end,
    case when e.visibility = 'organization' or e.owner_id = auth.uid()
      then e.description else '' end,
    e.starts_at,
    e.ends_at,
    e.all_day,
    e.kind,
    e.visibility,
    e.contact_id,
    e.status,
    e.google_event_id,
    e.google_calendar_id
  from public.calendar_events e
  join public.profiles p on p.id = e.owner_id
  where e.organization_id = target_organization
    and e.deleted_at is null
    and e.status = 'scheduled'
    and e.starts_at < range_end
    and e.ends_at > range_start
    and private.is_org_member(target_organization)

  union all

  select
    t.id,
    'task'::text,
    t.id,
    t.organization_id,
    coalesce(t.owner_id, t.created_by),
    coalesce(p.full_name, t.owner_label),
    t.title,
    ''::text,
    t.due_at,
    t.due_at + interval '30 minutes',
    false,
    'task'::text,
    'organization'::text,
    t.contact_id,
    case when t.completed then 'completed' else 'scheduled' end,
    null::text,
    null::text
  from public.tasks t
  left join public.profiles p on p.id = t.owner_id
  where t.organization_id = target_organization
    and t.deleted_at is null
    and t.due_at is not null
    and t.due_at >= range_start
    and t.due_at < range_end
    and private.is_org_member(target_organization)

  order by starts_at;
$$;

revoke all on function public.calendar_events_list(uuid, timestamptz, timestamptz) from public;
grant execute on function public.calendar_events_list(uuid, timestamptz, timestamptz) to authenticated;

grant select, insert, update, delete on public.calendar_events to authenticated;
grant select, insert, update, delete on public.organization_calendars to authenticated;
