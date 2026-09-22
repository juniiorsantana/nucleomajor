-- O pagamento no Asaas libera a empresa.
--
-- Desde 20260823090000 uma empresa só nasce com um código de ativação, e o
-- código só nascia pela mão de um administrador da plataforma. Esta migration
-- liga o outro lado: o Link de Pagamento recorrente do Asaas avisa o servidor
-- do portal pelo webhook, o servidor chama `nucleo_billing_asaas_receive`, e a
-- função emite o código para o e-mail de quem pagou. O servidor manda o e-mail
-- com o link `/app/ativar`; a pessoa cria a conta e ativa a empresa pelo
-- `create_organization` de sempre, que agora também amarra a assinatura.
--
-- QUEM CHAMA A FUNÇÃO DO WEBHOOK, e por que ela aceita `anon`: o servidor do
-- portal não tem `service_role` (README, SPEC-DATA-SECURITY). Ele chama a RPC
-- com a chave publicável e um TOKEN que só existe na variável de ambiente
-- `BILLING_INTAKE_TOKEN`; aqui fica o sha256 dele, em `billing_intakes`. Sem o
-- token não há evento, concessão nem código. É o mesmo desenho do formulário
-- do site (20260915000000).
--
-- A MESMA CONTA DO ASAAS COBRA OUTRAS COISAS. O webhook entrega todas as
-- cobranças da conta, não só as do Núcleo. Só vira acesso a cobrança de uma
-- assinatura cujo Link de Pagamento está em `billing_payment_links`; o resto é
-- registrado como ignorado, sem e-mail nem dado pessoal.
--
-- OS PLANOS. Três à venda, com nomes padrão que mudam por
-- `update saas_plans set name = ...` (o código fica):
--   base         WhatsApp no portal, CRM, funil, agenda, tarefas, equipe;
--   atendimento  + a IA respondendo os clientes finais (`ai_customer`);
--   completo     + o assistente da equipe pelo WhatsApp (`ai_team`).
-- A Major continua no `full`, que ganha as duas chaves ligadas. Cada Link de
-- Pagamento diz o plano e o ciclo (mensal ou anual); o período pago segue o
-- ciclo.
--
-- O QUE BLOQUEIA. `private.org_access_state` responde `ok`, `past_due` ou
-- `blocked`, calculado na hora (não há cron): atraso vira aviso por 7 dias e
-- depois bloqueio; estorno e chargeback suspendem; cancelamento vale até o fim
-- do período pago. As assinaturas da Major (`migration`) continuam `ok`.
--
-- Fora daqui: o texto do e-mail, a busca do e-mail do cliente na API do Asaas
-- e a conferência do cabeçalho `asaas-access-token` são do servidor
-- (`src/billing.mjs`). A trava da IA por plano é a migration seguinte.

begin;

-- ---------------------------------------------------------------------------
-- 1/8. Guardas. O que está vivo precisa ser o que este arquivo espera.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_organization'
    and pg_get_function_identity_arguments(p.oid) = 'organization_name text, access_code text';
  if corpo is null then
    raise exception 'abortado: create_organization(text, text) nao existe';
  end if;
  if corpo like '%billing_subscriptions%' then
    raise exception 'abortado: create_organization ja conhece billing_subscriptions; conferir o que esta vivo antes de reescrever';
  end if;
  if corpo not like '%access.plan_code, ''active'', access.source%' then
    raise exception 'abortado: o corpo vivo de create_organization nao e o de 20260823090000';
  end if;
  if not exists (select 1 from public.saas_plans where code = 'full') then
    raise exception 'abortado: o plano full nao existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'onboarding_access_grants'
      and column_name = 'created_by'
  ) then
    raise exception 'abortado: onboarding_access_grants.created_by nao existe';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'is_platform_admin'
  ) then
    raise exception 'abortado: private.is_platform_admin nao existe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/8. Os planos à venda. `assistant` quer dizer "tem alguma IA" e fica por
--      compatibilidade; quem decide o que a IA faz são `ai_customer` (atender
--      os clientes finais) e `ai_team` (o assistente da equipe).
-- ---------------------------------------------------------------------------
insert into public.saas_plans (code, name, description, features, limits)
values
  (
    'base',
    'Base',
    'WhatsApp no portal, CRM, funil, agenda, tarefas e equipe. Sem IA.',
    '{
      "crm": true, "agenda": true, "team_management": true, "whatsapp_web": true,
      "assistant": false, "ai_customer": false, "ai_team": false,
      "knowledge": false, "chatbots": false, "whatsapp_official": false
    }'::jsonb,
    '{"members": null, "contacts": null, "connections": 1}'::jsonb
  ),
  (
    'atendimento',
    'Atendimento com IA',
    'Tudo do Base, mais a IA atendendo os clientes da empresa pelo WhatsApp.',
    '{
      "crm": true, "agenda": true, "team_management": true, "whatsapp_web": true,
      "assistant": true, "ai_customer": true, "ai_team": false,
      "knowledge": true, "chatbots": true, "whatsapp_official": false
    }'::jsonb,
    '{"members": null, "contacts": null, "connections": 1}'::jsonb
  ),
  (
    'completo',
    'Completo',
    'Tudo do Atendimento com IA, mais o assistente da equipe pelo WhatsApp.',
    '{
      "crm": true, "agenda": true, "team_management": true, "whatsapp_web": true,
      "assistant": true, "ai_customer": true, "ai_team": true,
      "knowledge": true, "chatbots": true, "whatsapp_official": false
    }'::jsonb,
    '{"members": null, "contacts": null, "connections": 1}'::jsonb
  )
on conflict (code) do nothing;

-- A Major (plano full) ganha as duas chaves novas, ligadas: nada muda para ela.
update public.saas_plans
set features = features || '{"ai_customer": true, "ai_team": true}'::jsonb,
    updated_at = now()
where code = 'full';

-- ---------------------------------------------------------------------------
-- 3/8. Tabelas. Ninguém escreve nelas direto: só as funções abaixo.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_intakes (
  provider text primary key check (provider in ('asaas')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_intakes is
  'Token do webhook de cobranca, guardado como sha256. O token em si so aparece uma vez, no SQL de ligacao (scripts/sql/ligar-checkout-asaas.sql), e vai para BILLING_INTAKE_TOKEN do servidor.';

create table if not exists public.billing_payment_links (
  provider text not null check (provider in ('asaas')),
  external_link_id text not null check (length(trim(external_link_id)) between 1 and 120),
  plan_code text not null references public.saas_plans(code),
  billing_cycle text not null default 'MONTHLY'
    check (billing_cycle in ('MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY')),
  label text not null default '' check (length(label) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (provider, external_link_id)
);

comment on table public.billing_payment_links is
  'Quais Links de Pagamento do Asaas vendem o Nucleo, qual plano cada um libera e em que ciclo (o mesmo do link no Asaas). Cobranca de link fora desta lista e de outro negocio da conta e e ignorada.';

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('asaas')),
  external_subscription_id text not null check (length(external_subscription_id) between 1 and 120),
  external_customer_id text check (external_customer_id is null or length(external_customer_id) <= 120),
  email text check (email is null or (email = lower(trim(email)) and position('@' in email) > 1 and length(email) <= 320)),
  plan_code text not null references public.saas_plans(code),
  billing_cycle text not null default 'MONTHLY'
    check (billing_cycle in ('MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY')),
  status text not null check (status in ('active', 'past_due', 'suspended', 'canceled')),
  last_paid_due_date date,
  current_period_ends_at timestamptz,
  past_due_since timestamptz,
  grant_id uuid references public.onboarding_access_grants(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  activation_sent_at timestamptz,
  activation_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_subscription_id)
);

create unique index if not exists billing_subscriptions_organization_unique
  on public.billing_subscriptions (organization_id)
  where organization_id is not null;

comment on table public.billing_subscriptions is
  'Uma assinatura do Asaas que vende o Nucleo. Nasce no primeiro pagamento confirmado; grant_id e o codigo de ativacao em aberto; organization_id e a empresa criada com ele.';

create table if not exists public.billing_events (
  provider text not null check (provider in ('asaas')),
  event_id text not null check (length(event_id) between 1 and 200),
  event_type text not null check (event_type ~ '^[A-Z_]{3,80}$'),
  external_subscription_id text,
  external_payment_id text,
  external_link_id text,
  result text not null default 'received' check (length(result) <= 60),
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

comment on table public.billing_events is
  'Um registro por evento de webhook, para a entrega at-least-once do Asaas nao processar nada duas vezes. So ids, nunca nome, e-mail ou valor.';

alter table public.billing_intakes enable row level security;
alter table public.billing_payment_links enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;
-- O Supabase concede tudo em tabela nova do schema public a anon e
-- authenticated. Aqui ninguém lê nem escreve direto.
revoke all on public.billing_intakes from anon, authenticated;
revoke all on public.billing_payment_links from anon, authenticated;
revoke all on public.billing_subscriptions from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;

-- A concessão emitida pelo webhook não tem usuário por trás.
alter table public.onboarding_access_grants
  alter column created_by drop not null;
alter table public.onboarding_access_grants
  drop constraint if exists onboarding_access_grants_created_by_source;
alter table public.onboarding_access_grants
  add constraint onboarding_access_grants_created_by_source
  check (created_by is not null or source = 'payment');

-- Desde quando está em atraso: é o relógio do bloqueio.
alter table public.organization_subscriptions
  add column if not exists past_due_since timestamptz;

-- Toda empresa precisa de uma assinatura; sem linha, o estado é `blocked`.
-- As que existem hoje já têm (20260823090000); isto só fecha a porta.
insert into public.organization_subscriptions (organization_id, plan_code, status, source)
select organization.id, 'full', 'active', 'migration'
from public.organizations organization
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4/8. O estado de acesso e as features do plano.
-- ---------------------------------------------------------------------------
create or replace function private.org_access_state(target_organization uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when subscription.status = 'active' then 'ok'
      when subscription.status = 'trialing'
        and (subscription.trial_ends_at is null or subscription.trial_ends_at > now()) then 'ok'
      when subscription.status = 'past_due'
        and coalesce(subscription.past_due_since, subscription.updated_at) > now() - interval '7 days' then 'past_due'
      when subscription.status = 'canceled'
        and subscription.current_period_ends_at > now() then 'ok'
      else 'blocked'
    end
    from public.organization_subscriptions subscription
    where subscription.organization_id = target_organization
  ), 'blocked');
$$;

create or replace function private.org_has_feature(target_organization uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_access_state(target_organization) <> 'blocked'
    and coalesce((
      select plan.features ->> feature = 'true'
      from public.organization_subscriptions subscription
      join public.saas_plans plan on plan.code = subscription.plan_code
      where subscription.organization_id = target_organization
    ), false);
$$;

create or replace function public.organization_access_state(target_organization uuid)
returns table (
  state text,
  plan_code text,
  plan_name text,
  features jsonb,
  limits jsonb,
  subscription_status text,
  current_period_ends_at timestamptz,
  past_due_since timestamptz,
  blocks_at timestamptz
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
  select private.org_access_state(target_organization),
         subscription.plan_code, plan.name, plan.features, plan.limits,
         subscription.status, subscription.current_period_ends_at,
         subscription.past_due_since,
         case when subscription.status = 'past_due'
           then coalesce(subscription.past_due_since, subscription.updated_at) + interval '7 days'
         end
  from public.organization_subscriptions subscription
  join public.saas_plans plan on plan.code = subscription.plan_code
  where subscription.organization_id = target_organization;
end;
$$;

-- Quanto tempo um pagamento cobre. Ciclo desconhecido vale um mês: o menor,
-- para nunca dar acesso a mais do que foi pago.
create or replace function private.billing_cycle_interval(cycle text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case cycle
    when 'YEARLY' then interval '12 months'
    when 'SEMIANNUALLY' then interval '6 months'
    when 'QUARTERLY' then interval '3 months'
    else interval '1 month'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5/8. Emitir o código de um pagamento. Mesmo formato de issue_onboarding_access.
-- ---------------------------------------------------------------------------
create or replace function private.issue_payment_grant(
  target_email text,
  target_plan text,
  target_reference text,
  issued_by uuid
)
returns table (grant_id uuid, access_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  compact_code text := 'NM' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  raw_code text;
  saved_id uuid := extensions.gen_random_uuid();
  saved_expires timestamptz := now() + interval '30 days';
begin
  raw_code := substr(compact_code, 1, 4) || '-' || substr(compact_code, 5, 4) || '-'
    || substr(compact_code, 9, 4) || '-' || substr(compact_code, 13, 2);
  insert into public.onboarding_access_grants (
    id, email, plan_code, source, external_reference, token_hash, expires_at, created_by
  ) values (
    saved_id,
    target_email,
    target_plan,
    'payment',
    target_reference,
    encode(extensions.digest(private.normalize_onboarding_code(raw_code), 'sha256'), 'hex'),
    saved_expires,
    issued_by
  );
  return query select saved_id, raw_code, saved_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6/8. O webhook.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_billing_asaas_receive(
  intake_token text,
  event jsonb,
  customer_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_limpo text := lower(trim(coalesce(intake_token, '')));
  evento_id text;
  tipo text;
  pagamento jsonb;
  assinatura jsonb;
  sub_id text;
  cliente_id text;
  link_id text;
  vencimento date;
  plano text;
  ciclo text;
  email_limpo text;
  registro public.billing_subscriptions%rowtype;
  concessao record;
  resultado text := 'ignored';
  resposta jsonb := jsonb_build_object('action', 'none');
begin
  if jsonb_typeof(event) is distinct from 'object'
     or pg_catalog.octet_length(event::text) > 65536 then
    raise exception 'billing event is invalid';
  end if;
  if token_limpo !~ '^[0-9a-f]{64}$' then
    raise exception 'intake token is invalid';
  end if;
  perform 1
  from public.billing_intakes intake
  where intake.provider = 'asaas'
    and intake.enabled
    and intake.token_hash = encode(extensions.digest(token_limpo, 'sha256'), 'hex');
  if not found then
    raise exception 'intake token is invalid';
  end if;

  evento_id := left(trim(coalesce(event ->> 'id', '')), 200);
  tipo := upper(trim(coalesce(event ->> 'event', '')));
  if evento_id = '' or tipo !~ '^[A-Z_]{3,80}$' then
    raise exception 'billing event is invalid';
  end if;

  pagamento := case when jsonb_typeof(event -> 'payment') = 'object' then event -> 'payment' end;
  assinatura := case when jsonb_typeof(event -> 'subscription') = 'object' then event -> 'subscription' end;
  sub_id := nullif(left(trim(coalesce(pagamento ->> 'subscription', assinatura ->> 'id', '')), 120), '');
  cliente_id := nullif(left(trim(coalesce(pagamento ->> 'customer', assinatura ->> 'customer', '')), 120), '');
  link_id := nullif(left(trim(coalesce(pagamento ->> 'paymentLink', assinatura ->> 'paymentLink', '')), 120), '');
  if coalesce(pagamento ->> 'dueDate', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    vencimento := (pagamento ->> 'dueDate')::date;
  end if;

  -- Idempotência. Um evento repetido não faz nada, nem de novo o e-mail.
  insert into public.billing_events (
    provider, event_id, event_type, external_subscription_id, external_payment_id, external_link_id
  ) values (
    'asaas', evento_id, tipo, sub_id, nullif(left(coalesce(pagamento ->> 'id', ''), 120), ''), link_id
  )
  on conflict (provider, event_id) do nothing;
  if not found then
    return jsonb_build_object('action', 'none', 'duplicate', true);
  end if;

  if sub_id is null then
    update public.billing_events set result = 'no_subscription'
    where provider = 'asaas' and event_id = evento_id;
    return resposta;
  end if;

  select * into registro
  from public.billing_subscriptions subscription
  where subscription.provider = 'asaas' and subscription.external_subscription_id = sub_id
  for update;

  if tipo in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') then
    if registro.id is null then
      select link.plan_code, link.billing_cycle into plano, ciclo
      from public.billing_payment_links link
      where link.provider = 'asaas' and link.external_link_id = link_id and link.active;
      if plano is null then
        update public.billing_events set result = 'unmapped_link'
        where provider = 'asaas' and event_id = evento_id;
        return resposta;
      end if;

      email_limpo := lower(trim(coalesce(customer_email, '')));
      if email_limpo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(email_limpo) > 320 then
        email_limpo := null;
      end if;

      -- Dois eventos do mesmo pagamento podem chegar juntos (cartão confirma
      -- e depois compensa). O `on conflict` mais o `for update` fazem o
      -- segundo esperar o primeiro e enxergar o código que ele emitiu.
      insert into public.billing_subscriptions (
        provider, external_subscription_id, external_customer_id, email, plan_code, billing_cycle,
        status, last_paid_due_date, current_period_ends_at
      ) values (
        'asaas', sub_id, cliente_id, email_limpo, plano, ciclo,
        'active', vencimento,
        (greatest(coalesce(vencimento, current_date), current_date)
          + private.billing_cycle_interval(ciclo))::timestamptz
      )
      on conflict (provider, external_subscription_id) do nothing;

      select * into registro
      from public.billing_subscriptions subscription
      where subscription.provider = 'asaas' and subscription.external_subscription_id = sub_id
      for update;
    else
      update public.billing_subscriptions
      set status = 'active',
          past_due_since = null,
          last_paid_due_date = case
            when vencimento is null then last_paid_due_date
            else greatest(coalesce(last_paid_due_date, vencimento), vencimento)
          end,
          current_period_ends_at = greatest(
            coalesce(current_period_ends_at, now()),
            (greatest(coalesce(vencimento, current_date), current_date)
              + private.billing_cycle_interval(billing_cycle))::timestamptz
          ),
          external_customer_id = coalesce(external_customer_id, cliente_id),
          updated_at = now()
      where id = registro.id
      returning * into registro;
    end if;

    if registro.organization_id is not null then
      update public.organization_subscriptions
      set status = 'active',
          past_due_since = null,
          current_period_ends_at = registro.current_period_ends_at,
          updated_at = now()
      where organization_id = registro.organization_id;
      resultado := 'renewed';
    elsif exists (
      select 1 from public.onboarding_access_grants grant_row
      where grant_row.id = registro.grant_id
        and grant_row.status = 'pending'
        and grant_row.expires_at > now()
    ) then
      resultado := 'activation_pending';
    elsif registro.email is null then
      resultado := 'missing_email';
    else
      select * into concessao
      from private.issue_payment_grant(registro.email, registro.plan_code, registro.external_subscription_id, null);
      update public.billing_subscriptions
      set grant_id = concessao.grant_id,
          activation_sent_at = null,
          activation_failed_at = null,
          updated_at = now()
      where id = registro.id;
      resultado := 'activation_issued';
      resposta := jsonb_build_object(
        'action', 'send_activation',
        'grant_id', concessao.grant_id,
        'access_code', concessao.access_code,
        'email', registro.email,
        'plan_code', registro.plan_code,
        'expires_at', concessao.expires_at
      );
    end if;

  elsif registro.id is null then
    resultado := 'unknown_subscription';

  elsif tipo = 'PAYMENT_OVERDUE' then
    -- Fora de ordem não derruba quem já pagou: só atrasa o que vence depois
    -- do último pagamento conhecido.
    if vencimento is not null and (registro.last_paid_due_date is null or vencimento > registro.last_paid_due_date)
       and registro.status in ('active', 'past_due') then
      update public.billing_subscriptions
      set status = 'past_due', past_due_since = coalesce(past_due_since, now()), updated_at = now()
      where id = registro.id;
      update public.organization_subscriptions
      set status = 'past_due', past_due_since = coalesce(past_due_since, now()), updated_at = now()
      where organization_id = registro.organization_id;
      resultado := 'past_due';
    else
      resultado := 'overdue_ignored';
    end if;

  elsif tipo in ('PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED',
                 'SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED') then
    update public.billing_subscriptions
    set status = case when tipo like 'SUBSCRIPTION_%' then 'canceled' else 'suspended' end,
        updated_at = now()
    where id = registro.id;
    update public.onboarding_access_grants
    set status = 'revoked'
    where id = registro.grant_id and status = 'pending';
    update public.organization_subscriptions
    set status = case when tipo like 'SUBSCRIPTION_%' then 'canceled' else 'suspended' end,
        updated_at = now()
    where organization_id = registro.organization_id;
    resultado := case when tipo like 'SUBSCRIPTION_%' then 'canceled' else 'suspended' end;
  end if;

  update public.billing_events set result = resultado
  where provider = 'asaas' and event_id = evento_id;
  return resposta || jsonb_build_object('result', resultado);
end;
$$;

comment on function public.nucleo_billing_asaas_receive(text, jsonb, text) is
  'Recebe um evento de webhook do Asaas, chamada pelo servidor do portal com a chave publicavel e BILLING_INTAKE_TOKEN. Idempotente por event id. Pagamento de assinatura vendida por link mapeado emite o codigo de ativacao (action send_activation) ou renova a empresa; atraso, estorno e cancelamento mudam o estado. Ver 20260920100000.';

create or replace function public.nucleo_billing_activation_delivered(
  intake_token text,
  target_grant uuid,
  delivered boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_limpo text := lower(trim(coalesce(intake_token, '')));
begin
  if token_limpo !~ '^[0-9a-f]{64}$' then
    raise exception 'intake token is invalid';
  end if;
  perform 1
  from public.billing_intakes intake
  where intake.provider = 'asaas'
    and intake.enabled
    and intake.token_hash = encode(extensions.digest(token_limpo, 'sha256'), 'hex');
  if not found then
    raise exception 'intake token is invalid';
  end if;
  update public.billing_subscriptions
  set activation_sent_at = case when delivered then now() else activation_sent_at end,
      activation_failed_at = case when delivered then null else now() end,
      updated_at = now()
  where grant_id = target_grant;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7/8. A empresa nasce amarrada à assinatura, e só com e-mail confirmado.
--      O resto do corpo é o de 20260823090000, sem mudança.
-- ---------------------------------------------------------------------------
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
  email_confirmed timestamptz;
  access public.onboarding_access_grants%rowtype;
  cobranca public.billing_subscriptions%rowtype;
  -- `organization_id` e variavel e coluna ao mesmo tempo; no update abaixo
  -- so a variavel auxiliar e inequivoca.
  empresa uuid;
begin
  if private.is_robot() then
    raise exception 'robot credentials cannot manage organizations';
  end if;
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if length(trim(organization_name)) < 2 then raise exception 'invalid organization name'; end if;
  if private.normalize_onboarding_code(access_code) = '' then raise exception 'access code required'; end if;

  select lower(trim(user_account.email)), user_account.email_confirmed_at
  into current_email, email_confirmed
  from auth.users user_account
  where user_account.id = auth.uid();
  if email_confirmed is null then
    raise exception 'confirmed email required';
  end if;

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

  if access.source = 'payment' then
    select * into cobranca
    from public.billing_subscriptions subscription
    where subscription.grant_id = access.id
    for update;
    if cobranca.id is null or cobranca.status not in ('active', 'past_due') or cobranca.organization_id is not null then
      raise exception 'access code invalid or expired';
    end if;
  end if;

  organization_slug := trim(both '-' from regexp_replace(lower(trim(organization_name)), '[^a-z0-9]+', '-', 'g'))
    || '-' || substr(organization_id::text, 1, 8);

  insert into public.organizations (id, name, slug, created_by)
  values (organization_id, trim(organization_name), organization_slug, auth.uid());
  insert into public.organization_members (organization_id, user_id, role)
  values (organization_id, auth.uid(), 'owner');

  if cobranca.id is not null then
    insert into public.organization_subscriptions (
      organization_id, plan_code, status, source,
      current_period_ends_at, past_due_since,
      external_customer_id, external_subscription_id
    ) values (
      organization_id, cobranca.plan_code, cobranca.status, 'payment',
      cobranca.current_period_ends_at, cobranca.past_due_since,
      cobranca.external_customer_id, cobranca.external_subscription_id
    );
    empresa := organization_id;
    update public.billing_subscriptions
    set organization_id = empresa, updated_at = now()
    where id = cobranca.id;
  else
    insert into public.organization_subscriptions (
      organization_id, plan_code, status, source
    ) values (
      organization_id, access.plan_code, 'active', access.source
    );
  end if;

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

-- ---------------------------------------------------------------------------
-- 8/8. Administração da plataforma: ver as vendas e reenviar a ativação.
-- ---------------------------------------------------------------------------
create or replace function public.billing_subscriptions_admin_list()
returns table (
  id uuid,
  email text,
  plan_code text,
  plan_name text,
  billing_cycle text,
  status text,
  external_subscription_id text,
  organization_id uuid,
  organization_name text,
  grant_id uuid,
  grant_status text,
  grant_expires_at timestamptz,
  activation_sent_at timestamptz,
  activation_failed_at timestamptz,
  past_due_since timestamptz,
  created_at timestamptz,
  updated_at timestamptz
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
  select subscription.id, subscription.email, subscription.plan_code, plan.name,
         subscription.billing_cycle, subscription.status,
         subscription.external_subscription_id, subscription.organization_id, organization.name,
         subscription.grant_id,
         case when grant_row.status = 'pending' and grant_row.expires_at <= now()
           then 'expired' else grant_row.status end,
         grant_row.expires_at,
         subscription.activation_sent_at, subscription.activation_failed_at,
         subscription.past_due_since, subscription.created_at, subscription.updated_at
  from public.billing_subscriptions subscription
  join public.saas_plans plan on plan.code = subscription.plan_code
  left join public.organizations organization on organization.id = subscription.organization_id
  left join public.onboarding_access_grants grant_row on grant_row.id = subscription.grant_id
  order by subscription.created_at desc
  limit 200;
end;
$$;

-- Reenviar é emitir outro código: o texto do anterior não existe mais em
-- lugar nenhum. O anterior, se ainda estava aberto, é revogado.
create or replace function public.billing_activation_rotate(
  target_subscription uuid,
  target_email text default null
)
returns table (grant_id uuid, access_code text, email text, plan_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  registro public.billing_subscriptions%rowtype;
  email_limpo text := nullif(lower(trim(coalesce(target_email, ''))), '');
  concessao record;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  select * into registro
  from public.billing_subscriptions subscription
  where subscription.id = target_subscription
  for update;
  if registro.id is null then
    raise exception 'subscription not found';
  end if;
  if registro.organization_id is not null then
    raise exception 'subscription already activated';
  end if;
  if registro.status not in ('active', 'past_due') then
    raise exception 'subscription is not paid';
  end if;
  if email_limpo is not null then
    if email_limpo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(email_limpo) > 320 then
      raise exception 'invalid email';
    end if;
    registro.email := email_limpo;
  end if;
  if registro.email is null then
    raise exception 'invalid email';
  end if;

  update public.onboarding_access_grants
  set status = 'revoked'
  where id = registro.grant_id and status = 'pending';

  select * into concessao
  from private.issue_payment_grant(registro.email, registro.plan_code, registro.external_subscription_id, auth.uid());
  update public.billing_subscriptions
  set email = registro.email,
      grant_id = concessao.grant_id,
      activation_sent_at = null,
      activation_failed_at = null,
      updated_at = now()
  where id = registro.id;

  return query select concessao.grant_id, concessao.access_code, registro.email,
                      registro.plan_code, concessao.expires_at;
end;
$$;

-- Permissões. O Supabase concede EXECUTE em função nova a anon e
-- authenticated por padrão: primeiro tira de todo mundo, depois dá a quem é.
revoke all on function private.org_access_state(uuid) from public, anon, authenticated;
revoke all on function private.org_has_feature(uuid, text) from public, anon, authenticated;
revoke all on function private.issue_payment_grant(text, text, text, uuid) from public, anon, authenticated;
revoke all on function private.billing_cycle_interval(text) from public, anon, authenticated;
revoke all on function public.organization_access_state(uuid) from public, anon, authenticated;
revoke all on function public.nucleo_billing_asaas_receive(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.nucleo_billing_activation_delivered(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_organization(text, text) from public, anon, authenticated;
revoke all on function public.billing_subscriptions_admin_list() from public, anon, authenticated;
revoke all on function public.billing_activation_rotate(uuid, text) from public, anon, authenticated;

grant execute on function public.nucleo_billing_asaas_receive(text, jsonb, text) to anon;
grant execute on function public.nucleo_billing_activation_delivered(text, uuid, boolean) to anon;
grant execute on function public.organization_access_state(uuid) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.billing_subscriptions_admin_list() to authenticated;
grant execute on function public.billing_activation_rotate(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Asserções. Se alguma reprovar, a transação inteira volta.
-- ---------------------------------------------------------------------------
do $$
declare
  tabela text;
  funcao text;
begin
  if not has_function_privilege('anon', 'public.nucleo_billing_asaas_receive(text, jsonb, text)', 'execute') then
    raise exception 'conferencia: anon precisa executar nucleo_billing_asaas_receive';
  end if;
  if not has_function_privilege('anon', 'public.nucleo_billing_activation_delivered(text, uuid, boolean)', 'execute') then
    raise exception 'conferencia: anon precisa executar nucleo_billing_activation_delivered';
  end if;
  if has_function_privilege('anon', 'public.create_organization(text, text)', 'execute')
     or has_function_privilege('anon', 'public.billing_activation_rotate(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.organization_access_state(uuid)', 'execute') then
    raise exception 'conferencia: anon nao pode executar as funcoes de usuario';
  end if;
  if not has_function_privilege('authenticated', 'public.create_organization(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.organization_access_state(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.billing_subscriptions_admin_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.billing_activation_rotate(uuid, text)', 'execute') then
    raise exception 'conferencia: authenticated precisa executar as funcoes de usuario';
  end if;
  foreach tabela in array array['billing_intakes', 'billing_payment_links', 'billing_subscriptions', 'billing_events'] loop
    if has_table_privilege('anon', 'public.' || tabela, 'select')
       or has_table_privilege('anon', 'public.' || tabela, 'insert')
       or has_table_privilege('authenticated', 'public.' || tabela, 'select')
       or has_table_privilege('authenticated', 'public.' || tabela, 'insert')
       or has_table_privilege('authenticated', 'public.' || tabela, 'update') then
      raise exception 'conferencia: % nao pode ser acessada direto', tabela;
    end if;
  end loop;
  foreach funcao in array array[
    'nucleo_billing_asaas_receive', 'nucleo_billing_activation_delivered', 'create_organization',
    'organization_access_state', 'billing_subscriptions_admin_list', 'billing_activation_rotate'
  ] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = funcao
        and (not p.prosecdef or not coalesce(p.proconfig, '{}') @> array['search_path=""'])
    ) then
      raise exception 'conferencia: % precisa ser security definer com search_path vazio', funcao;
    end if;
  end loop;
  if (select count(*) from public.saas_plans
      where active and (
        (code = 'base' and features ->> 'ai_customer' = 'false' and features ->> 'ai_team' = 'false' and features ->> 'assistant' = 'false')
        or (code = 'atendimento' and features ->> 'ai_customer' = 'true' and features ->> 'ai_team' = 'false')
        or (code = 'completo' and features ->> 'ai_customer' = 'true' and features ->> 'ai_team' = 'true')
      )) <> 3 then
    raise exception 'conferencia: os planos base, atendimento e completo precisam existir com a IA certa';
  end if;
  if not exists (
    select 1 from public.saas_plans
    where code = 'full' and features ->> 'ai_customer' = 'true' and features ->> 'ai_team' = 'true'
  ) then
    raise exception 'conferencia: o plano full (Major) precisa manter a IA inteira';
  end if;
  if exists (
    select 1 from public.organizations organization
    where not exists (
      select 1 from public.organization_subscriptions subscription
      where subscription.organization_id = organization.id
    )
  ) then
    raise exception 'conferencia: toda empresa precisa de uma assinatura';
  end if;
  if exists (
    select 1 from public.organizations organization
    where private.org_access_state(organization.id) <> 'ok'
      and exists (
        select 1 from public.organization_subscriptions subscription
        where subscription.organization_id = organization.id and subscription.source in ('migration', 'manual')
      )
  ) then
    raise exception 'conferencia: uma empresa que ja existia ficaria bloqueada';
  end if;
end $$;

commit;
