begin;

-- A identidade pode ser cadastrada no Supabase, mas uma empresa nova somente
-- nasce quando existe uma autorização comercial válida. Convites de equipe
-- continuam independentes: o plano pertence à organização, não a cada membro.

create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.saas_plans (
  code text primary key check (code = lower(code) and code ~ '^[a-z0-9_-]+$'),
  name text not null,
  description text not null default '',
  active boolean not null default true,
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_code text not null references public.saas_plans(code),
  status text not null check (status in ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  source text not null default 'manual' check (source in ('manual', 'payment', 'migration', 'partner')),
  started_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  external_customer_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_ends_at is null or trial_ends_at > started_at)
);

create unique index if not exists organization_subscriptions_external_subscription_unique
  on public.organization_subscriptions (external_subscription_id)
  where external_subscription_id is not null;

create table if not exists public.onboarding_access_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  plan_code text not null references public.saas_plans(code),
  source text not null default 'manual' check (source in ('manual', 'payment', 'partner')),
  external_reference text,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'redeemed', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  redeemed_by uuid references public.profiles(id),
  redeemed_organization_id uuid references public.organizations(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'redeemed' and redeemed_by is not null and redeemed_organization_id is not null and redeemed_at is not null)
    or
    (status <> 'redeemed' and redeemed_by is null and redeemed_organization_id is null and redeemed_at is null)
  )
);

create index if not exists onboarding_access_grants_email_status_idx
  on public.onboarding_access_grants (email, status, expires_at desc);

insert into public.saas_plans (code, name, description, features, limits)
values (
  'full',
  'Full',
  'Acesso completo ao Núcleo Major.',
  '{
    "crm": true,
    "agenda": true,
    "knowledge": true,
    "assistant": true,
    "chatbots": true,
    "whatsapp_web": true,
    "whatsapp_official": true,
    "team_management": true
  }'::jsonb,
  '{"members": null, "contacts": null, "connections": 1}'::jsonb
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  features = excluded.features,
  limits = excluded.limits,
  active = true,
  updated_at = now();

-- As organizações já existentes são preservadas como clientes Full ativos.
insert into public.organization_subscriptions (organization_id, plan_code, status, source)
select organization.id, 'full', 'active', 'migration'
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = auth.uid()
  );
$$;

create or replace function private.normalize_onboarding_code(raw_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(raw_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.issue_onboarding_access(
  target_email text,
  target_plan text default 'full',
  valid_days integer default 7
)
returns table (
  grant_id uuid,
  access_code text,
  email text,
  plan_code text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(target_email));
  normalized_plan text := lower(trim(target_plan));
  compact_code text := 'NM' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  raw_code text;
  saved_id uuid := extensions.gen_random_uuid();
  saved_expires timestamptz;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  if normalized_email = '' or position('@' in normalized_email) <= 1 then
    raise exception 'invalid email';
  end if;
  if valid_days < 1 or valid_days > 30 then
    raise exception 'validity must be between 1 and 30 days';
  end if;
  if not exists (
    select 1 from public.saas_plans plan
    where plan.code = normalized_plan and plan.active
  ) then
    raise exception 'plan unavailable';
  end if;

  update public.onboarding_access_grants access
  set status = 'expired'
  where access.email = normalized_email
    and access.status = 'pending'
    and access.expires_at <= now();

  if exists (
    select 1 from public.onboarding_access_grants access
    where access.email = normalized_email
      and access.status = 'pending'
      and access.expires_at > now()
  ) then
    raise exception 'email already has a pending access';
  end if;

  raw_code := substr(compact_code, 1, 4) || '-' || substr(compact_code, 5, 4) || '-' || substr(compact_code, 9, 4) || '-' || substr(compact_code, 13, 2);
  saved_expires := now() + make_interval(days => valid_days);

  insert into public.onboarding_access_grants (
    id, email, plan_code, token_hash, expires_at, created_by
  ) values (
    saved_id,
    normalized_email,
    normalized_plan,
    encode(extensions.digest(private.normalize_onboarding_code(raw_code), 'sha256'), 'hex'),
    saved_expires,
    auth.uid()
  );

  return query select saved_id, raw_code, normalized_email, normalized_plan, saved_expires;
end;
$$;

create or replace function public.revoke_onboarding_access(target_grant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  update public.onboarding_access_grants
  set status = 'revoked'
  where id = target_grant and status = 'pending';
  if not found then raise exception 'pending access not found'; end if;
end;
$$;

create or replace function public.organization_entitlement(target_organization uuid)
returns table (
  plan_code text,
  plan_name text,
  subscription_status text,
  features jsonb,
  limits jsonb,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization access required';
  end if;
  return query
  select subscription.plan_code, plan.name, subscription.status,
         plan.features, plan.limits, subscription.trial_ends_at,
         subscription.current_period_ends_at
  from public.organization_subscriptions subscription
  join public.saas_plans plan on plan.code = subscription.plan_code
  where subscription.organization_id = target_organization;
end;
$$;

-- A assinatura antiga fica deliberadamente fechada. Isso impede que versões
-- desatualizadas do frontend contornem a autorização comercial.
revoke all on function public.create_organization(text) from public;
revoke all on function public.create_organization(text) from authenticated;

create or replace function public.create_organization(
  organization_name text,
  access_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid := extensions.gen_random_uuid();
  organization_slug text;
  current_email text;
  access public.onboarding_access_grants%rowtype;
begin
  if private.is_robot() then
    raise exception 'robot credentials cannot manage organizations';
  end if;
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if length(trim(organization_name)) < 2 then raise exception 'invalid organization name'; end if;
  if private.normalize_onboarding_code(access_code) = '' then raise exception 'access code required'; end if;

  select lower(trim(user_account.email)) into current_email
  from auth.users user_account
  where user_account.id = auth.uid();

  select * into access
  from public.onboarding_access_grants candidate
  where candidate.token_hash = encode(
      extensions.digest(private.normalize_onboarding_code(access_code), 'sha256'),
      'hex'
    )
    and candidate.status = 'pending'
  for update;

  if access.id is null or access.expires_at <= now() then
    raise exception 'access code invalid or expired';
  end if;
  if access.email <> current_email then
    raise exception 'access code belongs to another email';
  end if;

  organization_slug := trim(both '-' from regexp_replace(lower(trim(organization_name)), '[^a-z0-9]+', '-', 'g'))
    || '-' || substr(organization_id::text, 1, 8);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, trim(organization_name), organization_slug, auth.uid());
  insert into public.organization_members (organization_id, user_id, role)
  values (organization_id, auth.uid(), 'owner');

  insert into public.organization_subscriptions (
    organization_id, plan_code, status, source
  ) values (
    organization_id, access.plan_code, 'active', access.source
  );

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

  update public.onboarding_access_grants
  set status = 'redeemed',
      redeemed_by = auth.uid(),
      redeemed_organization_id = organization_id,
      redeemed_at = now()
  where id = access.id;

  return organization_id;
end;
$$;

revoke all on function public.issue_onboarding_access(text, text, integer) from public;
revoke all on function public.revoke_onboarding_access(uuid) from public;
revoke all on function public.organization_entitlement(uuid) from public;
revoke all on function public.create_organization(text, text) from public;
grant execute on function public.issue_onboarding_access(text, text, integer) to authenticated;
grant execute on function public.revoke_onboarding_access(uuid) to authenticated;
grant execute on function public.organization_entitlement(uuid) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
grant select on public.platform_admins to authenticated;
grant select on public.saas_plans to authenticated;
grant select on public.organization_subscriptions to authenticated;

alter table public.platform_admins enable row level security;
alter table public.saas_plans enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.onboarding_access_grants enable row level security;

create policy platform_admins_self_select on public.platform_admins
for select to authenticated
using (user_id = auth.uid());

create policy saas_plans_authenticated_select on public.saas_plans
for select to authenticated
using (active);

create policy organization_subscriptions_member_select on public.organization_subscriptions
for select to authenticated
using (private.is_org_member(organization_id));

-- Primeiro administrador da plataforma. Se a conta ainda não existir, a
-- inserção não faz nada e pode ser executada novamente depois da confirmação.
insert into public.platform_admins (user_id)
select user_account.id
from auth.users user_account
where lower(user_account.email) = 'cmo@majorhub.com.br'
on conflict (user_id) do nothing;

commit;
