-- Portal Núcleo Major: convites por e-mail e aceite multi-organização.
--
-- O token continua sendo guardado somente como hash. O token bruto é devolvido
-- apenas à API autenticada que fará o envio pelo SMTP; a extensão deixa de
-- enviar convites diretamente pelo navegador.

begin;

alter table public.organization_invites
  add column if not exists revoked_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organization_invites_delivery_status_check'
      and conrelid = 'public.organization_invites'::regclass
  ) then
    alter table public.organization_invites
      add constraint organization_invites_delivery_status_check
      check (delivery_status in ('pending', 'sent', 'failed'));
  end if;
end;
$$;

create index if not exists organization_invites_pending_idx
  on public.organization_invites (organization_id, expires_at desc)
  where accepted_at is null and revoked_at is null;

-- A tela usa RPCs sem token_hash. A coluna sensível não fica disponível por
-- consulta direta mesmo para um administrador autenticado.
revoke all on table public.organization_invites from anon, authenticated;

create or replace function public.create_organization_invite(
  target_organization uuid,
  target_email text,
  target_role public.organization_role default 'member'
)
returns table (
  invite_id uuid,
  invited_email text,
  invited_role public.organization_role,
  invite_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email, '')));
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  saved_id uuid;
  saved_email text;
  saved_role public.organization_role;
  saved_expires timestamptz;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if target_role = 'owner' then
    raise exception 'owner invitations are not allowed';
  end if;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or length(normalized_email) > 320 then
    raise exception 'invalid invite email';
  end if;

  -- Convite não pode funcionar como atalho para alterar o papel de alguém
  -- que já está na organização. Rebaixar/promover continua sendo uma ação
  -- própria, com a autorização de dono definida pelas funções de membros.
  if exists (
    select 1
    from public.organization_members member
    join auth.users invited_user on invited_user.id = member.user_id
    where member.organization_id = target_organization
      and lower(trim(invited_user.email)) = normalized_email
  ) then
    raise exception 'invite target is already a member of this organization';
  end if;

  insert into public.organization_invites as oi (
    organization_id, email, role, token_hash, invited_by,
    expires_at, accepted_at, revoked_at, sent_at, delivery_status, delivery_error
  )
  values (
    target_organization, normalized_email, target_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'), auth.uid(),
    now() + interval '7 days', null, null, null, 'pending', null
  )
  on conflict (organization_id, email) do update set
    role = excluded.role,
    token_hash = excluded.token_hash,
    invited_by = excluded.invited_by,
    expires_at = excluded.expires_at,
    accepted_at = null,
    revoked_at = null,
    sent_at = null,
    delivery_status = 'pending',
    delivery_error = null
  returning oi.id, oi.email, oi.role, oi.expires_at
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
  email_atual text;
  confirmado timestamptz;
begin
  if private.is_robot() then
    raise exception 'robot credentials cannot manage organizations';
  end if;
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select lower(trim(u.email)), u.email_confirmed_at
    into email_atual, confirmado
  from auth.users u
  where u.id = auth.uid();

  select * into convite
  from public.organization_invites
  where token_hash = encode(extensions.digest(coalesce(target_token, ''), 'sha256'), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  for update;
  if convite.id is null then
    raise exception 'invite invalid or expired';
  end if;
  if email_atual is null or confirmado is null then
    raise exception 'a confirmed email is required to accept an invite';
  end if;
  if email_atual <> lower(trim(convite.email)) then
    raise exception 'invite issued for a different email';
  end if;

  if exists (
    select 1
    from public.organization_members member
    where member.organization_id = convite.organization_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'invite target is already a member of this organization';
  end if;

  begin
    insert into public.organization_members (organization_id, user_id, role)
    values (convite.organization_id, auth.uid(), convite.role);
  exception when unique_violation then
    raise exception 'invite target is already a member of this organization';
  end;

  update public.organization_invites
  set accepted_at = now(), delivery_error = null
  where id = convite.id;
  return convite.organization_id;
end;
$$;

create or replace function public.list_organization_invites(target_organization uuid)
returns table (
  invite_id uuid,
  invited_email text,
  invited_role public.organization_role,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  sent_at timestamptz,
  delivery_status text,
  delivery_error text
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
  select oi.id, oi.email, oi.role, oi.created_at, oi.expires_at,
    oi.accepted_at, oi.revoked_at, oi.sent_at, oi.delivery_status, oi.delivery_error
  from public.organization_invites oi
  where oi.organization_id = target_organization
  order by oi.created_at desc;
end;
$$;

create or replace function public.resend_organization_invite(
  target_organization uuid,
  target_invite uuid
)
returns table (
  invite_id uuid,
  invited_email text,
  invited_role public.organization_role,
  invite_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  convite public.organization_invites%rowtype;
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;

  select * into convite
  from public.organization_invites
  where id = target_invite and organization_id = target_organization
  for update;
  if convite.id is null then
    raise exception 'invite not found';
  end if;
  if convite.accepted_at is not null then
    raise exception 'invite was already accepted';
  end if;
  if convite.revoked_at is not null then
    raise exception 'invite was cancelled';
  end if;

  update public.organization_invites
  set token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    expires_at = now() + interval '7 days',
    invited_by = auth.uid(),
    sent_at = null,
    delivery_status = 'pending',
    delivery_error = null
  where id = convite.id;

  return query
  select convite.id, convite.email, convite.role, raw_token, now() + interval '7 days';
end;
$$;

create or replace function public.revoke_organization_invite(
  target_organization uuid,
  target_invite uuid
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
  update public.organization_invites
  set revoked_at = now()
  where id = target_invite
    and organization_id = target_organization
    and accepted_at is null
    and revoked_at is null;
  if not found then
    raise exception 'invite not found or already closed';
  end if;
end;
$$;

create or replace function public.mark_organization_invite_delivery(
  target_organization uuid,
  target_invite uuid,
  delivered boolean,
  failure_reason text default null
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
  update public.organization_invites
  set sent_at = case when delivered then now() else sent_at end,
    delivery_status = case when delivered then 'sent' else 'failed' end,
    delivery_error = case when delivered then null else left(trim(coalesce(failure_reason, 'delivery failed')), 500) end
  where id = target_invite
    and organization_id = target_organization
    and accepted_at is null
    and revoked_at is null;
  if not found then
    raise exception 'invite not found or already closed';
  end if;
end;
$$;

revoke all on function public.create_organization_invite(uuid, text, public.organization_role) from public;
revoke all on function public.accept_organization_invite(text) from public;
revoke all on function public.list_organization_invites(uuid) from public;
revoke all on function public.resend_organization_invite(uuid, uuid) from public;
revoke all on function public.revoke_organization_invite(uuid, uuid) from public;
revoke all on function public.mark_organization_invite_delivery(uuid, uuid, boolean, text) from public;

grant execute on function public.create_organization_invite(uuid, text, public.organization_role) to authenticated;
grant execute on function public.accept_organization_invite(text) to authenticated;
grant execute on function public.list_organization_invites(uuid) to authenticated;
grant execute on function public.resend_organization_invite(uuid, uuid) to authenticated;
grant execute on function public.revoke_organization_invite(uuid, uuid) to authenticated;
grant execute on function public.mark_organization_invite_delivery(uuid, uuid, boolean, text) to authenticated;

commit;
