begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create type public.organization_role as enum ('owner', 'admin', 'member');
create type public.membership_status as enum ('active', 'suspended');
create type public.deal_status as enum ('aberto', 'ganho', 'perdido');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null default 'member',
  status public.membership_status not null default 'active',
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.organization_role not null default 'member' check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_id text,
  name text not null check (length(trim(name)) between 1 and 80),
  position integer not null check (position >= 0),
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, legacy_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_id text,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default '#626B7A',
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, legacy_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_id text,
  name text not null default '',
  phone text not null default '',
  whatsapp_id text,
  company text not null default '',
  job_title text not null default '',
  email text,
  source text not null default '',
  owner_label text not null default '',
  avatar_path text,
  avatar_hash text,
  last_interaction_at timestamptz,
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, legacy_id)
);

create table public.contact_tags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id),
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id) on delete cascade,
  foreign key (tag_id, organization_id)
    references public.tags(id, organization_id) on delete cascade
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_id text,
  contact_id uuid not null,
  stage_id uuid not null,
  title text not null default '',
  value numeric(14,2),
  source text not null default '',
  status public.deal_status not null default 'aberto',
  loss_reason text not null default '',
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, legacy_id),
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id),
  foreign key (stage_id, organization_id)
    references public.stages(id, organization_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_id text,
  contact_id uuid not null,
  deal_id uuid,
  title text not null default '',
  due_at timestamptz,
  completed boolean not null default false,
  completed_at timestamptz,
  owner_label text not null default '',
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, legacy_id),
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id),
  foreign key (deal_id, organization_id)
    references public.deals(id, organization_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_id text,
  contact_id uuid not null,
  body text not null default '',
  author_label text not null default '',
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, legacy_id),
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id)
);

create table public.contact_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_id text,
  contact_id uuid not null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  source text not null default 'app',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id),
  unique (organization_id, legacy_id)
);

create unique index contacts_phone_unique
  on public.contacts (organization_id, phone) where phone <> '' and deleted_at is null;
create unique index contacts_whatsapp_unique
  on public.contacts (organization_id, whatsapp_id) where whatsapp_id is not null and deleted_at is null;
create unique index stages_position_unique
  on public.stages (organization_id, position) where deleted_at is null;
create index contacts_sync_idx on public.contacts (organization_id, updated_at, id);
create index deals_sync_idx on public.deals (organization_id, updated_at, id);
create index tasks_sync_idx on public.tasks (organization_id, updated_at, id);
create index notes_sync_idx on public.notes (organization_id, updated_at, id);
create index events_contact_idx on public.contact_events (organization_id, contact_id, occurred_at desc);

create or replace function private.is_org_member(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_organization
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function private.org_role(target_organization uuid)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.organization_members m
  where m.organization_id = target_organization
    and m.user_id = auth.uid()
    and m.status = 'active';
$$;

create or replace function private.can_manage_org(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.org_role(target_organization) in ('owner', 'admin'), false);
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.org_role(uuid) to authenticated;
grant execute on function private.can_manage_org(uuid) to authenticated;

create or replace function private.touch_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- O cliente envia o timestamp original na migração e na sincronização.
  -- Só usa o relógio do banco quando a operação não informa um valor.
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_timestamp();
create trigger organizations_touch before update on public.organizations
for each row execute function private.touch_timestamp();

create or replace function private.touch_versioned_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = coalesce(new.updated_at, now());
  new.version = old.version + 1;
  if auth.uid() is not null then new.updated_by = auth.uid(); end if;
  return new;
end;
$$;

create trigger stages_touch before update on public.stages
for each row execute function private.touch_versioned_record();
create trigger tags_touch before update on public.tags
for each row execute function private.touch_versioned_record();
create trigger contacts_touch before update on public.contacts
for each row execute function private.touch_versioned_record();
create trigger deals_touch before update on public.deals
for each row execute function private.touch_versioned_record();
create trigger tasks_touch before update on public.tasks
for each row execute function private.touch_versioned_record();
create trigger notes_touch before update on public.notes
for each row execute function private.touch_versioned_record();

create or replace function private.prevent_organization_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id then raise exception 'organization_id is immutable'; end if;
  return new;
end;
$$;

create trigger stages_org_immutable before update on public.stages
for each row execute function private.prevent_organization_change();
create trigger tags_org_immutable before update on public.tags
for each row execute function private.prevent_organization_change();
create trigger contacts_org_immutable before update on public.contacts
for each row execute function private.prevent_organization_change();
create trigger deals_org_immutable before update on public.deals
for each row execute function private.prevent_organization_change();
create trigger tasks_org_immutable before update on public.tasks
for each row execute function private.prevent_organization_change();
create trigger notes_org_immutable before update on public.notes
for each row execute function private.prevent_organization_change();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_profile
after insert on auth.users
for each row execute function private.handle_new_user();

insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', '') from auth.users
on conflict (id) do nothing;

create or replace function public.create_organization(organization_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid := extensions.gen_random_uuid();
  organization_slug text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if length(trim(organization_name)) < 2 then raise exception 'invalid organization name'; end if;

  organization_slug := trim(both '-' from regexp_replace(lower(trim(organization_name)), '[^a-z0-9]+', '-', 'g'))
    || '-' || substr(organization_id::text, 1, 8);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, trim(organization_name), organization_slug, auth.uid());
  insert into public.organization_members (organization_id, user_id, role)
  values (organization_id, auth.uid(), 'owner');

  insert into public.stages (organization_id, legacy_id, name, position, created_by, updated_by)
  values
    (organization_id, 'novo-lead', 'Novo lead', 0, auth.uid(), auth.uid()),
    (organization_id, 'contato', 'Contato', 1, auth.uid(), auth.uid()),
    (organization_id, 'qualificacao', 'Qualificação', 2, auth.uid(), auth.uid()),
    (organization_id, 'proposta', 'Proposta', 3, auth.uid(), auth.uid()),
    (organization_id, 'negociacao', 'Negociação', 4, auth.uid(), auth.uid()),
    (organization_id, 'fechado', 'Fechado', 5, auth.uid(), auth.uid());

  insert into public.tags (organization_id, legacy_id, name, color, created_by, updated_by)
  values
    (organization_id, 'cliente', 'Cliente', '#147A52', auth.uid(), auth.uid()),
    (organization_id, 'lead-quente', 'Lead quente', '#C0362C', auth.uid(), auth.uid()),
    (organization_id, 'indicacao', 'Indicação', '#0A7CD4', auth.uid(), auth.uid()),
    (organization_id, 'sem-interesse', 'Sem interesse', '#626B7A', auth.uid(), auth.uid());

  return organization_id;
end;
$$;

revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

create or replace function public.create_organization_invite(
  target_organization uuid,
  target_email text,
  target_role public.organization_role default 'member'
)
returns table (invite_id uuid, invited_email text, invited_role public.organization_role, invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  saved_id uuid;
  saved_email text;
  saved_role public.organization_role;
  saved_expires timestamptz;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if target_role = 'owner' then raise exception 'owner invitations are not allowed'; end if;
  if length(trim(target_email)) < 3 then raise exception 'invalid invite email'; end if;

  insert into public.organization_invites (organization_id, email, role, token_hash, invited_by)
  values (
    target_organization, lower(trim(target_email)), target_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'), auth.uid()
  )
  on conflict (organization_id, email) do update set
    role = excluded.role,
    token_hash = excluded.token_hash,
    invited_by = excluded.invited_by,
    expires_at = now() + interval '7 days',
    accepted_at = null
  returning id, email, role, expires_at
  into saved_id, saved_email, saved_role, saved_expires;

  return query select saved_id, saved_email, saved_role, raw_token, saved_expires;
end;
$$;

create or replace function public.accept_organization_invite(target_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  convite public.organization_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into convite
  from public.organization_invites
  where token_hash = encode(extensions.digest(target_token, 'sha256'), 'hex')
    and accepted_at is null and expires_at > now()
  for update;
  if convite.id is null then raise exception 'invite invalid or expired'; end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (convite.organization_id, auth.uid(), convite.role)
  on conflict (organization_id, user_id) do update set status = 'active', role = excluded.role;
  update public.organization_invites set accepted_at = now() where id = convite.id;
  return convite.organization_id;
end;
$$;

create or replace function public.change_organization_member_role(
  target_organization uuid,
  target_user uuid,
  target_role public.organization_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.org_role(target_organization) <> 'owner' then
    raise exception 'owner permission required';
  end if;
  if target_role = 'owner' and target_user <> auth.uid() then
    raise exception 'owner transfer requires a separate flow';
  end if;
  update public.organization_members set role = target_role
  where organization_id = target_organization and user_id = target_user;
  if not found then raise exception 'member not found'; end if;
end;
$$;

create or replace function public.remove_organization_member(target_organization uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if target_user = auth.uid() and private.org_role(target_organization) = 'owner' then
    raise exception 'owner cannot remove self';
  end if;
  delete from public.organization_members
  where organization_id = target_organization and user_id = target_user and role <> 'owner';
end;
$$;

revoke all on function public.create_organization_invite(uuid, text, public.organization_role) from public;
revoke all on function public.accept_organization_invite(text) from public;
revoke all on function public.change_organization_member_role(uuid, uuid, public.organization_role) from public;
revoke all on function public.remove_organization_member(uuid, uuid) from public;
grant execute on function public.create_organization_invite(uuid, text, public.organization_role) to authenticated;
grant execute on function public.accept_organization_invite(text) to authenticated;
grant execute on function public.change_organization_member_role(uuid, uuid, public.organization_role) to authenticated;
grant execute on function public.remove_organization_member(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;
alter table public.stages enable row level security;
alter table public.tags enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_tags enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.contact_events enable row level security;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid() or exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs using (organization_id)
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = profiles.id and theirs.status = 'active'
  )
);
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_select on public.organizations for select to authenticated
using (private.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
using (private.can_manage_org(id)) with check (private.can_manage_org(id));
create policy organizations_delete on public.organizations for delete to authenticated
using (private.org_role(id) = 'owner');

create policy members_select on public.organization_members for select to authenticated
using (private.is_org_member(organization_id));
create policy members_insert on public.organization_members for insert to authenticated
with check (private.can_manage_org(organization_id) and role <> 'owner');
create policy members_update on public.organization_members for update to authenticated
using (private.can_manage_org(organization_id) and role <> 'owner')
with check (private.can_manage_org(organization_id) and role <> 'owner');
create policy members_delete on public.organization_members for delete to authenticated
using (private.can_manage_org(organization_id) and role <> 'owner' and user_id <> auth.uid());
create policy invites_select on public.organization_invites for select to authenticated
using (private.can_manage_org(organization_id));
create policy invites_insert on public.organization_invites for insert to authenticated
with check (private.can_manage_org(organization_id) and invited_by = auth.uid() and role <> 'owner');
create policy invites_delete on public.organization_invites for delete to authenticated
using (private.can_manage_org(organization_id));

create policy stages_select on public.stages for select to authenticated
using (private.is_org_member(organization_id));
create policy stages_insert on public.stages for insert to authenticated
with check (private.can_manage_org(organization_id));
create policy stages_update on public.stages for update to authenticated
using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));
create policy stages_delete on public.stages for delete to authenticated
using (private.can_manage_org(organization_id));

create policy tags_select on public.tags for select to authenticated
using (private.is_org_member(organization_id));
create policy tags_insert on public.tags for insert to authenticated
with check (private.can_manage_org(organization_id));
create policy tags_update on public.tags for update to authenticated
using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));
create policy tags_delete on public.tags for delete to authenticated
using (private.can_manage_org(organization_id));

create policy contacts_all on public.contacts for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));
create policy contact_tags_all on public.contact_tags for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));
create policy deals_all on public.deals for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));
create policy tasks_all on public.tasks for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));
create policy notes_all on public.notes for all to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

create policy events_select on public.contact_events for select to authenticated
using (private.is_org_member(organization_id));
create policy events_insert on public.contact_events for insert to authenticated
with check (private.is_org_member(organization_id) and (created_by is null or created_by = auth.uid()));
create policy events_update on public.contact_events for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));
create policy events_delete on public.contact_events for delete to authenticated
using (private.is_org_member(organization_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-avatars', 'contact-avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_organization_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if (storage.foldername(object_name))[1] <> 'organizations' then return null; end if;
  return ((storage.foldername(object_name))[2])::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create policy avatars_select on storage.objects for select to authenticated
using (
  bucket_id = 'contact-avatars'
  and private.is_org_member(private.storage_organization_id(name))
);
create policy avatars_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'contact-avatars'
  and private.is_org_member(private.storage_organization_id(name))
);
create policy avatars_update on storage.objects for update to authenticated
using (
  bucket_id = 'contact-avatars'
  and private.is_org_member(private.storage_organization_id(name))
)
with check (
  bucket_id = 'contact-avatars'
  and private.is_org_member(private.storage_organization_id(name))
);
create policy avatars_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'contact-avatars'
  and private.is_org_member(private.storage_organization_id(name))
);

commit;
