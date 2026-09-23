-- O painel da plataforma (painel.nucleomajor.com): as leituras e as ações.
--
-- A etapa 1 (20260924100000) deu a cada empresa os seus ajustes e o histórico
-- `platform_audit_log`. Esta migration dá ao painel o resto, sem SQL à mão:
--
--   * `platform_organizations_list()`: todas as empresas numa tabela — plano,
--     situação, fim do período, origem, membros, contatos, WhatsApp em uso e
--     limite, último sinal da VPS e último acesso do dono;
--   * `platform_organization_detail(org)`: a empresa inteira num jsonb — cada
--     interruptor com o que o plano diz, o ajuste e o resultado; o uso dos
--     últimos 30 dias; as pessoas; o WhatsApp; as vendas do Asaas; as últimas
--     50 linhas do histórico;
--   * `platform_organization_set_period(org, ends_at, renew, note)`: estender.
--     `renew = false` é "pago até, sem renovação" (`canceled` com data: bloqueia
--     sozinho quando a data passa, como os 90 dias da Adriane em 23/09/2026);
--     `renew = true` é `active`, que não bloqueia por data;
--   * `platform_organization_end_now(org, note)`: encerrar agora. Nota
--     obrigatória: é a ação que tranca o cliente do lado de fora;
--   * `platform_organization_set_plan(org, plan, note)`: trocar o plano. Os
--     ajustes da empresa continuam valendo por cima do plano novo;
--   * `platform_audit_list(org, limite)`: o histórico, de uma empresa ou de
--     todas.
--
-- Todas só para a administração da plataforma, e toda ação grava o histórico
-- com o antes e o depois. Empresa que paga pelo Asaas (`source = 'payment'`):
-- mexer aqui muda o ACESSO, não a cobrança. A resposta traz `billingInAsaas`
-- para o painel avisar "a cobrança continua no Asaas; cancele lá também". E o
-- próximo pagamento confirmado pelo webhook volta a escrever o período.
--
-- Nada muda para o portal dos clientes: as funções são novas, nenhuma
-- existente é reescrita.

begin;

-- ---------------------------------------------------------------------------
-- 1/5. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.platform_audit_log') is null
     or to_regprocedure('private.platform_audit(uuid, text, text, jsonb, jsonb, text)') is null
     or to_regprocedure('private.org_limits(uuid)') is null then
    raise exception 'abortado: aplicar 20260924100000 antes';
  end if;
  if to_regprocedure('public.platform_organizations_list()') is not null then
    raise exception 'abortado: platform_organizations_list ja existe; esta migration ja foi aplicada';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at'
  ) then
    raise exception 'abortado: auth.users.last_sign_in_at nao existe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/5. As leituras.
-- ---------------------------------------------------------------------------

-- Uma linha por empresa. `target_organization` nulo = todas. Privada: quem
-- confere o admin são as funções públicas que a usam.
create function private.platform_organization_rows(target_organization uuid)
returns table (
  organization_id uuid,
  organization_name text,
  created_at timestamptz,
  owner_email text,
  owner_last_sign_in_at timestamptz,
  plan_code text,
  plan_name text,
  subscription_status text,
  source text,
  state text,
  current_period_ends_at timestamptz,
  past_due_since timestamptz,
  members integer,
  contacts integer,
  connections_in_use integer,
  connections_limit integer,
  last_heartbeat_at timestamptz,
  active_adjustments integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select organization.id, organization.name, organization.created_at,
         lower(dono.email), dono.last_sign_in_at,
         subscription.plan_code, plan.name, subscription.status, subscription.source,
         private.org_access_state(organization.id),
         subscription.current_period_ends_at, subscription.past_due_since,
         (select count(*)::integer from public.organization_members member
           where member.organization_id = organization.id and member.status = 'active'),
         (select count(*)::integer from public.contacts contact
           where contact.organization_id = organization.id and contact.deleted_at is null),
         (select count(*)::integer from public.whatsapp_connections connection
           where connection.organization_id = organization.id
             and connection.status <> 'revoked' and connection.revoked_at is null),
         nullif(private.org_limits(organization.id) ->> 'connections', '')::integer,
         (select max(runtime.heartbeat_at) from public.connection_runtime_status runtime
           where runtime.organization_id = organization.id),
         (select count(*)::integer from public.organization_entitlements entitlement
           where entitlement.organization_id = organization.id
             and (entitlement.expires_at is null or entitlement.expires_at > now()))
  from public.organizations organization
  left join public.organization_subscriptions subscription on subscription.organization_id = organization.id
  left join public.saas_plans plan on plan.code = subscription.plan_code
  left join lateral (
    select owner_user.email, owner_user.last_sign_in_at
    from public.organization_members member
    join auth.users owner_user on owner_user.id = member.user_id
    where member.organization_id = organization.id
      and member.role = 'owner' and member.status = 'active'
    order by member.joined_at
    limit 1
  ) dono on true
  where target_organization is null or organization.id = target_organization;
$$;

revoke all on function private.platform_organization_rows(uuid) from public, anon, authenticated;

create function public.platform_organizations_list()
returns table (
  organization_id uuid,
  organization_name text,
  created_at timestamptz,
  owner_email text,
  owner_last_sign_in_at timestamptz,
  plan_code text,
  plan_name text,
  subscription_status text,
  source text,
  state text,
  current_period_ends_at timestamptz,
  past_due_since timestamptz,
  members integer,
  contacts integer,
  connections_in_use integer,
  connections_limit integer,
  last_heartbeat_at timestamptz,
  active_adjustments integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  return query
  select linha.*
  from private.platform_organization_rows(null) linha
  order by lower(linha.organization_name), linha.organization_id
  limit 1000;
end;
$$;

-- A assinatura como o histórico guarda: o que o painel muda e nada mais.
create function private.platform_subscription_snapshot(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan_code', subscription.plan_code,
    'status', subscription.status,
    'source', subscription.source,
    'current_period_ends_at', subscription.current_period_ends_at,
    'past_due_since', subscription.past_due_since,
    'trial_ends_at', subscription.trial_ends_at,
    'state', private.org_access_state(target_organization)
  )
  from public.organization_subscriptions subscription
  where subscription.organization_id = target_organization;
$$;

revoke all on function private.platform_subscription_snapshot(uuid) from public, anon, authenticated;

create function public.platform_organization_detail(target_organization uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resumo jsonb;
  plano public.saas_plans%rowtype;
  combinadas jsonb := private.org_features(target_organization);
  limites jsonb := private.org_limits(target_organization);
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  select to_jsonb(linha) into resumo
  from private.platform_organization_rows(target_organization) linha;
  if resumo is null then
    raise exception 'organization not found';
  end if;
  select plan.* into plano
  from public.organization_subscriptions subscription
  join public.saas_plans plan on plan.code = subscription.plan_code
  where subscription.organization_id = target_organization;

  return jsonb_build_object(
    'organization', resumo,
    -- Um item por linha do catálogo. `plan` é o que o plano diz, `adjustment`
    -- o ajuste da empresa (mesmo vencido, com `active` dizendo se vale) e
    -- `result` o que a empresa tem de fato.
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', feature.key,
        'kind', feature.kind,
        'name', feature.name,
        'description', feature.description,
        'category', feature.category,
        'isAi', feature.is_ai,
        'plan', case when feature.kind = 'feature'
          then coalesce(plano.features, '{}'::jsonb) -> feature.key
          else coalesce(plano.limits, '{}'::jsonb) -> feature.key end,
        'adjustment', case when entitlement.key is null then null else jsonb_build_object(
          'enabled', entitlement.enabled,
          'limitValue', entitlement.limit_value,
          'expiresAt', entitlement.expires_at,
          'note', entitlement.note,
          'setAt', entitlement.set_at,
          'active', entitlement.expires_at is null or entitlement.expires_at > now()
        ) end,
        'result', case when feature.kind = 'feature'
          then combinadas -> feature.key
          else limites -> feature.key end
      ) order by feature.sort_order, feature.key)
      from public.platform_features feature
      left join public.organization_entitlements entitlement
        on entitlement.organization_id = target_organization and entitlement.key = feature.key
    ), '[]'::jsonb),
    'usage', jsonb_build_object(
      'contacts', (select count(*) from public.contacts contact
        where contact.organization_id = target_organization and contact.deleted_at is null),
      'deals', (select count(*) from public.deals deal
        where deal.organization_id = target_organization and deal.deleted_at is null),
      'conversations30d', (select count(*) from public.whatsapp_conversations conversation
        where conversation.organization_id = target_organization
          and conversation.last_message_at > now() - interval '30 days'),
      'messages30d', (select count(*) from public.whatsapp_messages message
        where message.organization_id = target_organization
          and message.sent_at > now() - interval '30 days')
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', lower(member_user.email),
        'role', member.role,
        'status', member.status,
        'joinedAt', member.joined_at,
        'lastSignInAt', member_user.last_sign_in_at
      ) order by member.role, member.joined_at)
      from public.organization_members member
      join auth.users member_user on member_user.id = member.user_id
      where member.organization_id = target_organization
    ), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', connection.id,
        'name', connection.name,
        'last4', connection.expected_phone_last4,
        'status', connection.status,
        'createdAt', connection.created_at,
        'heartbeatAt', (select max(runtime.heartbeat_at) from public.connection_runtime_status runtime
          where runtime.connection_id = connection.id)
      ) order by connection.created_at desc)
      from public.whatsapp_connections connection
      where connection.organization_id = target_organization
        and connection.status <> 'revoked' and connection.revoked_at is null
    ), '[]'::jsonb),
    'billing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sale.id,
        'email', sale.email,
        'planCode', sale.plan_code,
        'cycle', sale.billing_cycle,
        'status', sale.status,
        'externalSubscriptionId', sale.external_subscription_id,
        'lastPaidDueDate', sale.last_paid_due_date,
        'currentPeriodEndsAt', sale.current_period_ends_at,
        'pastDueSince', sale.past_due_since,
        'createdAt', sale.created_at
      ) order by sale.created_at desc)
      from public.billing_subscriptions sale
      where sale.organization_id = target_organization
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(ultima) order by ultima.id desc)
      from (
        select registro.id, registro.at, registro.actor_email, registro.action, registro.target, registro.before, registro.after, registro.note
        from public.platform_audit_log registro
        where registro.organization_id = target_organization
        order by registro.id desc
        limit 50
      ) ultima
    ), '[]'::jsonb)
  );
end;
$$;

create function public.platform_audit_list(
  target_organization uuid default null,
  max_rows integer default 100
)
returns table (
  id bigint,
  at timestamptz,
  actor_email text,
  organization_id uuid,
  organization_name text,
  action text,
  target text,
  before jsonb,
  after jsonb,
  note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  return query
  select registro.id, registro.at, registro.actor_email, registro.organization_id, organization.name,
         registro.action, registro.target, registro.before, registro.after, registro.note
  from public.platform_audit_log registro
  left join public.organizations organization on organization.id = registro.organization_id
  where target_organization is null or registro.organization_id = target_organization
  order by registro.id desc
  limit greatest(1, least(coalesce(max_rows, 100), 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/5. As ações.
-- ---------------------------------------------------------------------------

-- O que toda ação devolve: o estado novo e se a cobrança mora no Asaas.
create function private.platform_subscription_result(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organizationId', target_organization,
    'subscription', private.platform_subscription_snapshot(target_organization),
    'billingInAsaas', coalesce((
      select subscription.source = 'payment'
      from public.organization_subscriptions subscription
      where subscription.organization_id = target_organization
    ), false)
      or exists (
        select 1 from public.billing_subscriptions sale
        where sale.organization_id = target_organization
          and sale.status in ('active', 'past_due')
      )
  );
$$;

revoke all on function private.platform_subscription_result(uuid) from public, anon, authenticated;

create function private.platform_require_subscription(target_organization uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations organization where organization.id = target_organization) then
    raise exception 'organization not found';
  end if;
  if not exists (
    select 1 from public.organization_subscriptions subscription
    where subscription.organization_id = target_organization
  ) then
    raise exception 'organization has no subscription';
  end if;
end;
$$;

revoke all on function private.platform_require_subscription(uuid) from public, anon, authenticated;

create function public.platform_organization_set_period(
  target_organization uuid,
  target_ends_at timestamptz,
  renew boolean default false,
  note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes jsonb;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  perform private.platform_require_subscription(target_organization);
  if target_ends_at is null or target_ends_at <= now() then
    raise exception 'ends_at must be in the future';
  end if;
  if target_ends_at > now() + interval '5 years' then
    raise exception 'ends_at too far in the future';
  end if;

  antes := private.platform_subscription_snapshot(target_organization);
  update public.organization_subscriptions subscription
  set status = case when coalesce(renew, false) then 'active' else 'canceled' end,
      current_period_ends_at = target_ends_at,
      past_due_since = null,
      updated_at = now()
  where subscription.organization_id = target_organization;

  perform private.platform_audit(
    target_organization, 'subscription.set_period', '',
    antes, private.platform_subscription_snapshot(target_organization), note
  );
  return private.platform_subscription_result(target_organization);
end;
$$;

create function public.platform_organization_end_now(
  target_organization uuid,
  note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes jsonb;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  perform private.platform_require_subscription(target_organization);
  -- Trancar o cliente do lado de fora sem dizer por quê é o tipo de coisa que
  -- ninguém consegue explicar três meses depois.
  if length(trim(coalesce(note, ''))) < 3 then
    raise exception 'note required to end access';
  end if;

  antes := private.platform_subscription_snapshot(target_organization);
  update public.organization_subscriptions subscription
  set status = 'canceled',
      current_period_ends_at = now(),
      past_due_since = null,
      updated_at = now()
  where subscription.organization_id = target_organization;

  perform private.platform_audit(
    target_organization, 'subscription.end_now', '',
    antes, private.platform_subscription_snapshot(target_organization), note
  );
  return private.platform_subscription_result(target_organization);
end;
$$;

create function public.platform_organization_set_plan(
  target_organization uuid,
  target_plan text,
  note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes jsonb;
  plano_limpo text := lower(trim(coalesce(target_plan, '')));
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  perform private.platform_require_subscription(target_organization);
  if not exists (select 1 from public.saas_plans plan where plan.code = plano_limpo and plan.active) then
    raise exception 'plan unavailable';
  end if;

  antes := private.platform_subscription_snapshot(target_organization);
  if antes ->> 'plan_code' = plano_limpo then
    -- Nada mudou: nada a gravar.
    return private.platform_subscription_result(target_organization);
  end if;

  update public.organization_subscriptions subscription
  set plan_code = plano_limpo,
      updated_at = now()
  where subscription.organization_id = target_organization;

  perform private.platform_audit(
    target_organization, 'subscription.set_plan', plano_limpo,
    antes, private.platform_subscription_snapshot(target_organization), note
  );
  return private.platform_subscription_result(target_organization);
end;
$$;

-- Os planos que o painel oferece, com o que cada um liga. O cartão antigo lia
-- `saas_plans` direto; o painel lê daqui, com os limites juntos.
create function public.platform_plans_list()
returns table (
  code text,
  name text,
  description text,
  active boolean,
  features jsonb,
  limits jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  return query
  select plan.code, plan.name, plan.description, plan.active, plan.features, plan.limits
  from public.saas_plans plan
  order by plan.active desc, plan.code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4/5. Quem executa.
-- ---------------------------------------------------------------------------
revoke all on function public.platform_organizations_list() from public, anon, authenticated;
revoke all on function public.platform_organization_detail(uuid) from public, anon, authenticated;
revoke all on function public.platform_audit_list(uuid, integer) from public, anon, authenticated;
revoke all on function public.platform_organization_set_period(uuid, timestamptz, boolean, text) from public, anon, authenticated;
revoke all on function public.platform_organization_end_now(uuid, text) from public, anon, authenticated;
revoke all on function public.platform_organization_set_plan(uuid, text, text) from public, anon, authenticated;
revoke all on function public.platform_plans_list() from public, anon, authenticated;
grant execute on function public.platform_organizations_list() to authenticated;
grant execute on function public.platform_organization_detail(uuid) to authenticated;
grant execute on function public.platform_audit_list(uuid, integer) to authenticated;
grant execute on function public.platform_organization_set_period(uuid, timestamptz, boolean, text) to authenticated;
grant execute on function public.platform_organization_end_now(uuid, text) to authenticated;
grant execute on function public.platform_organization_set_plan(uuid, text, text) to authenticated;
grant execute on function public.platform_plans_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 5/5. Conferência.
-- ---------------------------------------------------------------------------
do $$
declare
  assinatura text;
begin
  foreach assinatura in array array[
    'public.platform_organizations_list()',
    'public.platform_organization_detail(uuid)',
    'public.platform_audit_list(uuid, integer)',
    'public.platform_organization_set_period(uuid, timestamptz, boolean, text)',
    'public.platform_organization_end_now(uuid, text)',
    'public.platform_organization_set_plan(uuid, text, text)',
    'public.platform_plans_list()'
  ] loop
    if not has_function_privilege('authenticated', assinatura, 'execute') then
      raise exception 'conferencia: authenticated precisa executar %', assinatura;
    end if;
    if has_function_privilege('anon', assinatura, 'execute') then
      raise exception 'conferencia: anon nao pode executar %', assinatura;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.platform_organization_rows(uuid)', 'execute') then
    raise exception 'conferencia: a leitura privada nao pode ser chamada direto';
  end if;
  -- Toda empresa aparece na lista, com ou sem assinatura.
  if (select count(*) from private.platform_organization_rows(null))
     <> (select count(*) from public.organizations) then
    raise exception 'conferencia: a lista deveria ter uma linha por empresa';
  end if;
end $$;

commit;
