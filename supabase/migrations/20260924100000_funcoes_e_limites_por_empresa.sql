-- Funções e limites por empresa: o ajuste da empresa vence o plano.
--
-- Até aqui, o que cada empresa usa vinha SÓ do plano (`saas_plans.features` e
-- `saas_plans.limits`). Liberar o chatbot para um cliente exigia trocar o plano
-- inteiro dele. Esta migration acrescenta uma camada por empresa:
--
--   * `platform_features`: o catálogo dos interruptores e limites que existem,
--     com nome em português. Função nova entra aqui e nasce DESLIGADA para
--     todos (nenhum plano a tem; ninguém tem ajuste);
--   * `organization_entitlements`: as exceções de uma empresa, com prazo
--     opcional. Ajuste vencido é ignorado e a empresa volta ao plano — sem
--     rotina nenhuma;
--   * `private.org_features` / `private.org_limits`: plano sobrescrito pelos
--     ajustes válidos. `private.org_has_feature` passa a ler daqui, com o
--     MESMO nome e assinatura: as cascas da trava de IA (20260920110000) e o
--     pedido de WhatsApp enxergam os ajustes sem mudar;
--   * `organization_access_state` devolve features e limites JÁ combinados, e o
--     portal e o servidor passam a respeitar os ajustes sem mudar a leitura;
--   * `platform_audit_log`: o histórico de quem mudou o quê. Só acrescenta;
--     alterar ou apagar uma linha é recusado.
--
-- Quem ajusta é só a administração da plataforma, por
-- `platform_entitlement_set` / `platform_entitlement_clear`. Ligar uma função de
-- IA exige `confirm_ai => true`: ela custa (a conta do Claude é da Major) e só
-- funciona com o WhatsApp próprio do cliente e a conexão montada na VPS.
--
-- Sem nenhum ajuste, o resultado é idêntico ao de antes para toda empresa; a
-- conferência no fim da migration garante isso (a Major, plano `full`, fica
-- igual).
--
-- Cuidado de publicação: o portal desta mesma entrega passa a esconder função
-- desconhecida. Aplicar ESTA migration antes de publicar o portal.

begin;

-- ---------------------------------------------------------------------------
-- 1/7. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.org_has_feature(uuid, text)') is null
     or to_regprocedure('public.organization_access_state(uuid)') is null then
    raise exception 'abortado: aplicar 20260920100000 antes';
  end if;
  if to_regprocedure('public.nucleo_connection_request(uuid, text, text)') is null then
    raise exception 'abortado: aplicar 20260921100000 antes';
  end if;
  if to_regprocedure('private.is_platform_admin()') is null then
    raise exception 'abortado: private.is_platform_admin nao existe';
  end if;
  if to_regclass('public.platform_features') is not null then
    raise exception 'abortado: platform_features ja existe; esta migration ja foi aplicada';
  end if;
  -- O portal desta entrega passa a travar Contatos/Funil/Tarefas, Agenda,
  -- Equipe e Conversas/Conexões pelas chaves abaixo. Uma empresa cujo plano não
  -- as tenha ligadas perderia essas telas: melhor parar e olhar.
  if exists (
    select 1
    from public.organization_subscriptions subscription
    join public.saas_plans plan on plan.code = subscription.plan_code
    where not (
      coalesce(plan.features ->> 'crm', '') = 'true'
      and coalesce(plan.features ->> 'agenda', '') = 'true'
      and coalesce(plan.features ->> 'team_management', '') = 'true'
      and coalesce(plan.features ->> 'whatsapp_web', '') = 'true'
    )
  ) then
    raise exception 'abortado: ha empresa cujo plano nao liga crm, agenda, team_management e whatsapp_web; o portal passaria a esconder essas telas dela';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/7. O catálogo.
-- ---------------------------------------------------------------------------
create table public.platform_features (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind text not null default 'feature' check (kind in ('feature', 'limit')),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 300),
  category text not null default 'sob_medida'
    check (category in ('gestao', 'atendimento', 'ia', 'limite', 'sob_medida')),
  is_ai boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

comment on table public.platform_features is
  'Catalogo dos interruptores (kind feature) e limites (kind limit) que podem ser ajustados por empresa. Funcao nova entra aqui e nasce desligada para todos. Ver 20260924100000.';

insert into public.platform_features (key, kind, name, description, category, is_ai, sort_order) values
  ('crm', 'feature', 'Contatos, funil e tarefas', 'Telas de Contatos, Funil e Tarefas.', 'gestao', false, 10),
  ('agenda', 'feature', 'Agenda', 'Agenda e compromissos.', 'gestao', false, 20),
  ('team_management', 'feature', 'Equipe', 'Convidar pessoas e definir papeis.', 'gestao', false, 30),
  ('whatsapp_web', 'feature', 'WhatsApp no portal', 'Conversas e Conexoes: o WhatsApp da empresa dentro do portal.', 'atendimento', false, 40),
  ('chatbots', 'feature', 'Chatbots', 'Fluxos automaticos de atendimento.', 'atendimento', false, 50),
  ('knowledge', 'feature', 'Base de conhecimento', 'O que a IA consulta para responder.', 'ia', true, 60),
  ('ai_customer', 'feature', 'IA atendendo clientes', 'A IA responde os clientes da empresa pelo WhatsApp. Exige WhatsApp proprio e a conexao montada na VPS.', 'ia', true, 70),
  ('ai_team', 'feature', 'Assistente da equipe', 'A equipe conversa com o assistente pelo WhatsApp e pelo portal.', 'ia', true, 80),
  ('whatsapp_official', 'feature', 'API oficial do WhatsApp', 'Reservado para quando houver a integracao oficial.', 'atendimento', false, 90),
  ('connections', 'limit', 'Numeros de WhatsApp', 'Quantos numeros de WhatsApp a empresa pode ter ao mesmo tempo. Hoje: 0 (sem WhatsApp) ou 1.', 'limite', false, 200);

-- ---------------------------------------------------------------------------
-- 3/7. Os ajustes por empresa.
-- ---------------------------------------------------------------------------
create table public.organization_entitlements (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null references public.platform_features(key) on update cascade,
  -- `kind = feature`: liga ou desliga. `kind = limit`: `limit_value` (nulo =
  -- sem limite). A coerência com o catálogo é garantida por quem grava
  -- (`platform_entitlement_set`), já que um CHECK não enxerga outra tabela.
  enabled boolean,
  limit_value integer check (limit_value is null or limit_value >= 0),
  expires_at timestamptz,
  note text not null default '' check (length(note) <= 500),
  set_by uuid,
  set_at timestamptz not null default now(),
  primary key (organization_id, key)
);

comment on table public.organization_entitlements is
  'Excecoes de uma empresa ao seu plano. Vence o plano enquanto expires_at for nulo ou futuro. Escrita so por platform_entitlement_set/_clear. Ver 20260924100000.';

-- ---------------------------------------------------------------------------
-- 4/7. O histórico: só acrescenta.
-- ---------------------------------------------------------------------------
create table public.platform_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_email text,
  -- Sem chave estrangeira de propósito: o histórico sobrevive à empresa.
  organization_id uuid,
  action text not null check (length(action) between 1 and 80),
  target text not null default '' check (length(target) <= 120),
  before jsonb,
  after jsonb,
  note text not null default '' check (length(note) <= 500)
);

create index platform_audit_log_organization_at on public.platform_audit_log (organization_id, at desc);

comment on table public.platform_audit_log is
  'Historico das acoes da administracao da plataforma. So insercao, por private.platform_audit; update e delete sao recusados pelo gatilho. Ver 20260924100000.';

create function private.platform_audit_log_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform audit log is append-only';
end;
$$;

create trigger platform_audit_log_imutavel
before update or delete on public.platform_audit_log
for each row execute function private.platform_audit_log_imutavel();

create function private.platform_audit(
  target_organization uuid,
  audit_action text,
  audit_target text,
  audit_before jsonb,
  audit_after jsonb,
  audit_note text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_audit_log (actor, actor_email, organization_id, action, target, before, after, note)
  select auth.uid(),
         (select users.email from auth.users users where users.id = auth.uid()),
         target_organization, audit_action, coalesce(audit_target, ''),
         audit_before, audit_after, left(coalesce(audit_note, ''), 500);
$$;

-- Nenhuma das três tabelas é lida ou escrita direto: tudo passa por função.
alter table public.platform_features enable row level security;
alter table public.organization_entitlements enable row level security;
alter table public.platform_audit_log enable row level security;
revoke all on public.platform_features from public, anon, authenticated;
revoke all on public.organization_entitlements from public, anon, authenticated;
revoke all on public.platform_audit_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5/7. A regra: o ajuste vence o plano.
-- ---------------------------------------------------------------------------
create function private.org_features(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with combinado as (
    select coalesce((
      select plan.features
      from public.organization_subscriptions subscription
      join public.saas_plans plan on plan.code = subscription.plan_code
      where subscription.organization_id = target_organization
    ), '{}'::jsonb) || coalesce((
      select jsonb_object_agg(entitlement.key, entitlement.enabled)
      from public.organization_entitlements entitlement
      join public.platform_features feature on feature.key = entitlement.key
      where entitlement.organization_id = target_organization
        and feature.kind = 'feature'
        and entitlement.enabled is not null
        and (entitlement.expires_at is null or entitlement.expires_at > now())
    ), '{}'::jsonb) as features
  )
  -- `assistant` é "tem alguma IA": acompanha as duas chaves específicas quando
  -- elas existem, para um ajuste de IA não deixá-lo mentindo.
  select case
    when combinado.features ? 'ai_customer' or combinado.features ? 'ai_team' then
      combinado.features || jsonb_build_object(
        'assistant',
        coalesce(combinado.features ->> 'ai_customer', '') = 'true'
          or coalesce(combinado.features ->> 'ai_team', '') = 'true'
      )
    else combinado.features
  end
  from combinado;
$$;

create function private.org_limits(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select plan.limits
    from public.organization_subscriptions subscription
    join public.saas_plans plan on plan.code = subscription.plan_code
    where subscription.organization_id = target_organization
  ), '{}'::jsonb) || coalesce((
    select jsonb_object_agg(entitlement.key, to_jsonb(entitlement.limit_value))
    from public.organization_entitlements entitlement
    join public.platform_features feature on feature.key = entitlement.key
    where entitlement.organization_id = target_organization
      and feature.kind = 'limit'
      and (entitlement.expires_at is null or entitlement.expires_at > now())
  ), '{}'::jsonb);
$$;

revoke all on function private.org_features(uuid) from public, anon, authenticated;
revoke all on function private.org_limits(uuid) from public, anon, authenticated;

create or replace function private.org_has_feature(target_organization uuid, feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_access_state(target_organization) <> 'blocked'
    and coalesce(private.org_features(target_organization) ->> feature = 'true', false);
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
         subscription.plan_code, plan.name,
         private.org_features(target_organization),
         private.org_limits(target_organization),
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

-- A leitura antiga (20260823090000) também passa a devolver o combinado, para
-- nenhuma versão do portal ver uma coisa e o banco decidir outra.
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
         private.org_features(target_organization),
         private.org_limits(target_organization),
         subscription.trial_ends_at, subscription.current_period_ends_at
  from public.organization_subscriptions subscription
  join public.saas_plans plan on plan.code = subscription.plan_code
  where subscription.organization_id = target_organization;
end;
$$;

-- O pedido de WhatsApp (20260921100000) com o limite combinado. O corpo é o
-- mesmo; só a leitura do limite muda.
create or replace function public.nucleo_connection_request(
  target_organization uuid,
  display_name text,
  phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  digitos text := regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g');
  nome text := left(regexp_replace(trim(coalesce(display_name, '')), '\s+', ' ', 'g'), 120);
  limite integer;
  vivas integer;
  existente public.whatsapp_connections%rowtype;
  nova uuid := extensions.gen_random_uuid();
begin
  if private.is_robot() then
    raise exception 'robot credentials cannot request connections';
  end if;
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if private.org_access_state(target_organization) = 'blocked' then
    raise exception 'subscription is not active';
  end if;
  if not private.org_has_feature(target_organization, 'whatsapp_web') then
    raise exception 'plan without whatsapp';
  end if;

  -- Número brasileiro sem o 55 ganha o 55: é o formato que o WhatsApp
  -- devolve no pareamento, e o hash esperado precisa bater com ele.
  if length(digitos) in (10, 11) then
    digitos := '55' || digitos;
  end if;
  if digitos !~ '^[1-9][0-9]{9,14}$' then
    raise exception 'invalid phone';
  end if;
  if nome = '' then
    nome := 'WhatsApp principal';
  end if;

  -- Idempotente: pedir de novo o mesmo número devolve o pedido que já existe.
  select connection.* into existente
  from public.whatsapp_connections connection
  where connection.organization_id = target_organization
    and connection.status <> 'revoked'
    and connection.revoked_at is null
    and connection.expected_phone_hash = encode(extensions.digest(connection.id::text || ':' || digitos, 'sha256'), 'hex')
  order by connection.created_at
  limit 1;
  if existente.id is not null then
    return jsonb_build_object('connectionId', existente.id, 'created', false, 'status', existente.status::text);
  end if;

  -- Plano sobrescrito pelo ajuste da empresa (20260924100000).
  limite := nullif(private.org_limits(target_organization) ->> 'connections', '')::integer;
  select count(*) into vivas
  from public.whatsapp_connections connection
  where connection.organization_id = target_organization
    and connection.status <> 'revoked'
    and connection.revoked_at is null;
  if limite is not null and vivas >= limite then
    raise exception 'connection limit reached';
  end if;

  if exists (
    select 1 from public.whatsapp_connections connection
    where connection.organization_id = target_organization and connection.name = nome
  ) then
    nome := left(nome, 110) || ' ' || substr(nova::text, 1, 4);
  end if;

  insert into public.whatsapp_connections (
    id, organization_id, name, expected_phone_hash, expected_phone_last4,
    status, created_by, updated_by
  ) values (
    nova, target_organization, nome,
    encode(extensions.digest(nova::text || ':' || digitos, 'sha256'), 'hex'),
    right(digitos, 4),
    'created', auth.uid(), auth.uid()
  );

  return jsonb_build_object('connectionId', nova, 'created', true, 'status', 'created');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6/7. Ajustar: só a administração da plataforma.
-- ---------------------------------------------------------------------------
create function private.org_entitlements_view(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organizationId', target_organization,
    'features', private.org_features(target_organization),
    'limits', private.org_limits(target_organization)
  );
$$;

revoke all on function private.org_entitlements_view(uuid) from public, anon, authenticated;

create function public.platform_features_list()
returns table (
  key text,
  kind text,
  name text,
  description text,
  category text,
  is_ai boolean,
  sort_order integer
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
  select feature.key, feature.kind, feature.name, feature.description,
         feature.category, feature.is_ai, feature.sort_order
  from public.platform_features feature
  order by feature.sort_order, feature.key;
end;
$$;

create function public.platform_entitlement_set(
  target_organization uuid,
  feature_key text,
  enabled boolean default null,
  limit_value integer default null,
  expires_at timestamptz default null,
  note text default '',
  confirm_ai boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalogo public.platform_features%rowtype;
  anterior public.organization_entitlements%rowtype;
  depois public.organization_entitlements%rowtype;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  if not exists (select 1 from public.organizations organization where organization.id = target_organization) then
    raise exception 'organization not found';
  end if;
  select * into catalogo from public.platform_features feature where feature.key = feature_key;
  if not found then
    raise exception 'unknown feature';
  end if;
  if catalogo.kind = 'feature' then
    if enabled is null or limit_value is not null then
      raise exception 'feature adjustment needs enabled and no limit_value';
    end if;
    if enabled and catalogo.is_ai and not coalesce(confirm_ai, false) then
      raise exception 'enabling ai requires confirm_ai: the company needs its own WhatsApp and the VPS setup';
    end if;
  else
    if enabled is not null then
      raise exception 'limit adjustment takes limit_value, not enabled';
    end if;
    -- Um WhatsApp ativo por empresa é regra do banco (índice
    -- whatsapp_connections_one_live_per_org, 20260821210000), e agenda,
    -- verificação de número e o pedido de conexão contam com ela. Até existir
    -- suporte a vários números, o ajuste só pode fechar (0) ou abrir (1).
    if feature_key = 'connections' and (limit_value is null or limit_value > 1) then
      raise exception 'more than one WhatsApp per company is not supported yet';
    end if;
  end if;
  if expires_at is not null and expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;

  select * into anterior
  from public.organization_entitlements entitlement
  where entitlement.organization_id = target_organization and entitlement.key = feature_key;

  insert into public.organization_entitlements as entitlement (
    organization_id, key, enabled, limit_value, expires_at, note, set_by, set_at
  ) values (
    target_organization, feature_key,
    case when catalogo.kind = 'feature' then enabled end,
    case when catalogo.kind = 'limit' then limit_value end,
    platform_entitlement_set.expires_at, left(coalesce(note, ''), 500), auth.uid(), now()
  )
  on conflict (organization_id, key) do update
    set enabled = excluded.enabled,
        limit_value = excluded.limit_value,
        expires_at = excluded.expires_at,
        note = excluded.note,
        set_by = excluded.set_by,
        set_at = excluded.set_at
  returning * into depois;

  perform private.platform_audit(
    target_organization, 'entitlement.set', feature_key,
    case when anterior.organization_id is null then null else to_jsonb(anterior) end,
    to_jsonb(depois), note
  );

  return private.org_entitlements_view(target_organization);
end;
$$;

create function public.platform_entitlement_clear(
  target_organization uuid,
  feature_key text,
  note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  anterior public.organization_entitlements%rowtype;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  delete from public.organization_entitlements entitlement
  where entitlement.organization_id = target_organization and entitlement.key = feature_key
  returning * into anterior;
  if found then
    perform private.platform_audit(
      target_organization, 'entitlement.clear', feature_key, to_jsonb(anterior), null, note
    );
  end if;
  return private.org_entitlements_view(target_organization);
end;
$$;

revoke all on function private.platform_audit(uuid, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function private.platform_audit_log_imutavel() from public, anon, authenticated;
revoke all on function public.platform_features_list() from public, anon, authenticated;
revoke all on function public.platform_entitlement_set(uuid, text, boolean, integer, timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function public.platform_entitlement_clear(uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_features_list() to authenticated;
grant execute on function public.platform_entitlement_set(uuid, text, boolean, integer, timestamptz, text, boolean) to authenticated;
grant execute on function public.platform_entitlement_clear(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7/7. Conferência: sem ajuste nenhum, toda empresa fica exatamente igual.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.organization_subscriptions subscription
    join public.saas_plans plan on plan.code = subscription.plan_code
    where private.org_features(subscription.organization_id) <> plan.features
       or private.org_limits(subscription.organization_id) <> plan.limits
  ) then
    raise exception 'conferencia: alguma empresa ficaria com funcoes ou limites diferentes do plano';
  end if;
  if (select count(*) from public.platform_features) <> 10 then
    raise exception 'conferencia: o catalogo deveria ter 10 itens';
  end if;
  if has_table_privilege('authenticated', 'public.organization_entitlements', 'select')
     or has_table_privilege('anon', 'public.platform_audit_log', 'select') then
    raise exception 'conferencia: as tabelas novas nao podem ser lidas direto';
  end if;
end $$;

commit;
