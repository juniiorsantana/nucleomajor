-- O cliente pede o WhatsApp pelo portal.
--
-- Até aqui a única conexão que existia era a da Major, criada à mão por
-- migration (20260814170000). Uma empresa nova abria Conversas e ficava
-- olhando "Consultando a conexão…" para sempre, e Conexões mandava abrir
-- `127.0.0.1:8090` — o computador de quem estava olhando.
--
-- O caminho agora é semiautomático:
--
--   1. dono ou administrador pede a conexão no portal, com o número que vai
--      conectar (`nucleo_connection_request`). A linha nasce em
--      `whatsapp_connections` com status `created` e SEM runtime;
--   2. o servidor do portal avisa a equipe da Major por e-mail, com o comando
--      pronto (`scripts/vps/provision-connection.sh`, no repositório do
--      runtime), e a administração da plataforma vê os pedidos em
--      `platform_connection_requests_list`;
--   3. o script sobe o par Bridge + assistente na VPS; quando o heartbeat
--      chega, o portal mostra o QR pelo caminho que já existe
--      (`nucleo_connection_pair_request`).
--
-- A regra de quantas conexões cabem vem do plano (`limits.connections`).
-- Empresa bloqueada não pede conexão nova.
--
-- De carona: `private.conexao_da_organizacao` usava `min(uuid)`, que não
-- existe no Postgres. A função é plpgsql (validação preguiçosa), então só
-- quebra quando alguém a chama sem id de conexão — e com clientes novos isso
-- passa a acontecer. Reescrita sem o agregado, com o mesmo comportamento.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guardas.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'org_access_state'
  ) then
    raise exception 'abortado: private.org_access_state nao existe; aplicar 20260920100000 antes';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_connection_request'
  ) then
    raise exception 'abortado: nucleo_connection_request ja existe; esta migration ja foi aplicada';
  end if;
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'conexao_da_organizacao';
  if corpo is null or corpo not like '%min(connection.id)%' then
    raise exception 'abortado: private.conexao_da_organizacao nao e a de 20260908120000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/4. A conexão da organização, sem `min(uuid)`.
-- ---------------------------------------------------------------------------
create or replace function private.conexao_da_organizacao(target_organization uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  quantas integer;
  escolhida uuid;
begin
  select count(*), (array_agg(connection.id order by connection.created_at, connection.id))[1]
  into quantas, escolhida
  from public.whatsapp_connections connection
  where connection.organization_id = target_organization
    and connection.status <> 'revoked'
    and connection.revoked_at is null;
  if quantas = 0 then
    raise exception 'connection is not available for this organization';
  end if;
  if quantas > 1 then
    raise exception 'organization has more than one connection; choose one';
  end if;
  return escolhida;
end;
$$;

revoke all on function private.conexao_da_organizacao(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/4. O pedido.
-- ---------------------------------------------------------------------------
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

  select nullif(plan.limits ->> 'connections', '')::integer into limite
  from public.organization_subscriptions subscription
  join public.saas_plans plan on plan.code = subscription.plan_code
  where subscription.organization_id = target_organization;
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

comment on function public.nucleo_connection_request(uuid, text, text) is
  'Dono ou administrador pede a conexao do WhatsApp da empresa. Nasce em whatsapp_connections com status created e sem runtime; o servidor do portal avisa a equipe, que roda scripts/vps/provision-connection.sh. Respeita limits.connections do plano. Ver 20260921100000.';

-- ---------------------------------------------------------------------------
-- 4/4. Os pedidos, para a administração da plataforma.
-- ---------------------------------------------------------------------------
create or replace function public.platform_connection_requests_list()
returns table (
  connection_id uuid,
  organization_id uuid,
  organization_name text,
  owner_email text,
  connection_name text,
  expected_phone_last4 text,
  connection_status text,
  plan_code text,
  created_at timestamptz,
  heartbeat_at timestamptz
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
  select connection.id, connection.organization_id, organization.name,
         (
           select lower(owner_user.email)
           from public.organization_members member
           join auth.users owner_user on owner_user.id = member.user_id
           where member.organization_id = connection.organization_id
             and member.role = 'owner' and member.status = 'active'
           order by member.joined_at
           limit 1
         ),
         connection.name, connection.expected_phone_last4, connection.status::text,
         subscription.plan_code, connection.created_at, runtime.heartbeat_at
  from public.whatsapp_connections connection
  join public.organizations organization on organization.id = connection.organization_id
  left join public.organization_subscriptions subscription on subscription.organization_id = connection.organization_id
  left join public.connection_runtime_status runtime on runtime.connection_id = connection.id
  where connection.status <> 'revoked'
    and connection.revoked_at is null
  order by (runtime.heartbeat_at is null) desc, connection.created_at desc
  limit 200;
end;
$$;

revoke all on function public.nucleo_connection_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.platform_connection_requests_list() from public, anon, authenticated;
grant execute on function public.nucleo_connection_request(uuid, text, text) to authenticated;
grant execute on function public.platform_connection_requests_list() to authenticated;

-- ---------------------------------------------------------------------------
-- Asserções.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_function_privilege('authenticated', 'public.nucleo_connection_request(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.platform_connection_requests_list()', 'execute') then
    raise exception 'conferencia: authenticated precisa executar as funcoes novas';
  end if;
  if has_function_privilege('anon', 'public.nucleo_connection_request(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.platform_connection_requests_list()', 'execute') then
    raise exception 'conferencia: anon nao pode executar as funcoes novas';
  end if;
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'conexao_da_organizacao') like '%min(connection.id)%' then
    raise exception 'conferencia: conexao_da_organizacao ainda usa min(uuid)';
  end if;
end $$;

commit;
