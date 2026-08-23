-- Corrige create_organization_invite quando a funcao retorna expires_at.
--
-- Em PL/pgSQL, o nome da coluna de RETURNS TABLE tambem vira uma variavel de
-- saida. A consulta antiga usava expires_at sem qualificar e o PostgreSQL
-- recusava o convite com "column reference expires_at is ambiguous".

begin;

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
  if length(trim(target_email)) < 3 then
    raise exception 'invalid invite email';
  end if;

  insert into public.organization_invites as oi (
    organization_id,
    email,
    role,
    token_hash,
    invited_by
  )
  values (
    target_organization,
    lower(trim(target_email)),
    target_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    auth.uid()
  )
  on conflict (organization_id, email) do update set
    role = excluded.role,
    token_hash = excluded.token_hash,
    invited_by = excluded.invited_by,
    expires_at = now() + interval '7 days',
    accepted_at = null
  returning oi.id, oi.email, oi.role, oi.expires_at
  into saved_id, saved_email, saved_role, saved_expires;

  return query
  select saved_id, saved_email, saved_role, raw_token, saved_expires;
end;
$$;

commit;
