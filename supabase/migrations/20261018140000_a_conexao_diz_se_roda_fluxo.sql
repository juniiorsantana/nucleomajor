-- A conexão diz se roda fluxo, e a observação das execuções (Etapa 11,
-- pacotes 11.1 e 11.4 do review do runtime).
--
-- 11.1. O executor de fluxos só existe na VPS com `EMYLEADS_CHATBOT_RUNTIME=1`
-- e `NUCLEO_FLOW_RUNTIME=1`. Hoje nada no banco diz isso, e um fluxo ativo
-- numa conexão sem executor não responde ninguém (o risco que o plano anotou
-- para a Adriani). O runtime novo manda `flowRuntime` (`online` ou
-- `not_configured`) no heartbeat; aqui ele é guardado em
-- `connection_runtime_status.flow_runtime_status`, e o portal avisa "esta
-- conexão não roda fluxo". `null` = runtime anterior, que não informa.
-- `chatbot`, `automationEnabled` (ia_ativa) e `defaultOwner` (dono_padrao) já
-- eram guardados desde 20260825120000.
--
-- `nucleo_runtime_heartbeat` é o de 20260828183000 com as trocas marcadas
-- "Etapa 11"; a guarda abaixo confere que é essa a versão em produção. O
-- runtime antigo continua funcionando (não manda a chave: fica `null`), e o
-- runtime novo funciona com o banco antigo (o RPC antigo ignora a chave).
--
-- 11.4. `private.flow_execution_overview`: execuções por organização, status e
-- motivo, dos últimos 30 dias, para o dono ler no SQL Editor. Só leitura, sem
-- grant para ninguém além do dono do banco: o portal não a lê.
--
-- Aplicar pelo SQL Editor; ensaio trocando o `commit;` final por `rollback;`.
-- Prova: scripts/sql/prova-a-conexao-diz-se-roda-fluxo.mjs. Desfazer:
-- scripts/sql/rollback-20261018140000-a-conexao-diz-se-roda-fluxo.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guarda: o heartbeat em produção é o de 20260828183000 (ou esta mesma
-- migration, colada de novo).
do $$
declare
  corpo text;
begin
  select replace(prosrc, chr(13), '') into corpo from pg_proc
  where oid = to_regprocedure('public.nucleo_runtime_heartbeat(jsonb)');
  if corpo is null then
    raise exception 'guarda: public.nucleo_runtime_heartbeat(jsonb) não existe';
  end if;
  if corpo not like '%last_model_error_code%' or corpo not like '%contract_version%' then
    raise exception 'guarda: o heartbeat em produção não é o de 20260828183000; compare antes de aplicar';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/4. A coluna.
alter table public.connection_runtime_status
  add column if not exists flow_runtime_status text;
alter table public.connection_runtime_status
  drop constraint if exists connection_runtime_status_flow_runtime_check;
alter table public.connection_runtime_status
  add constraint connection_runtime_status_flow_runtime_check
  check (flow_runtime_status is null or flow_runtime_status in ('online', 'not_configured'));
comment on column public.connection_runtime_status.flow_runtime_status is
  'Etapa 11: online = a conexão roda o executor de fluxos; not_configured = não roda; null = runtime que não informa.';

-- ---------------------------------------------------------------------------
-- 3/4. O heartbeat (20260828183000 + "Etapa 11").
create or replace function public.nucleo_runtime_heartbeat(runtime_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  safe_instance uuid;
  safe_kind text := trim(coalesce(runtime_payload ->> 'runtimeKind', 'vps'));
  safe_host text := trim(coalesce(runtime_payload ->> 'hostLabel', 'Runtime do Núcleo'));
  safe_version text := trim(coalesce(runtime_payload ->> 'runtimeVersion', ''));
  safe_bridge text := trim(coalesce(runtime_payload ->> 'bridge', 'offline'));
  safe_whatsapp text := trim(coalesce(runtime_payload ->> 'whatsapp', 'unknown'));
  safe_assistant text := trim(coalesce(runtime_payload ->> 'assistant', 'offline'));
  safe_model text := trim(coalesce(runtime_payload ->> 'modelStatus', 'not_checked'));
  safe_model_error text := trim(coalesce(runtime_payload ->> 'lastModelErrorCode', ''));
  safe_mcp text := trim(coalesce(runtime_payload ->> 'mcp', 'unavailable'));
  safe_agenda text := trim(coalesce(runtime_payload ->> 'agenda', 'not_checked'));
  safe_external text := trim(coalesce(runtime_payload ->> 'externalApproval', 'not_checked'));
  safe_notification text := trim(coalesce(runtime_payload ->> 'notificationWorker', 'not_configured'));
  safe_chatbot text := trim(coalesce(runtime_payload ->> 'chatbot', 'not_configured'));
  -- Etapa 11: sem a chave (runtime antigo) fica nulo, "não informa".
  safe_flow text := nullif(trim(coalesce(runtime_payload ->> 'flowRuntime', '')), '');
  safe_owner text := trim(coalesce(runtime_payload ->> 'defaultOwner', 'bot'));
  safe_skill_slug text := trim(coalesce(runtime_payload ->> 'skillSlug', ''));
  safe_skill_hash text := trim(coalesce(runtime_payload ->> 'skillHash', ''));
  safe_skill_version integer;
  safe_last_notification timestamptz;
  safe_last_model_success timestamptz;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if jsonb_typeof(runtime_payload) <> 'object'
    or pg_catalog.octet_length(runtime_payload::text) > 8192 then
    raise exception 'runtime heartbeat payload is invalid';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;

  begin
    safe_instance := (runtime_payload ->> 'instanceId')::uuid;
    if nullif(runtime_payload ->> 'skillVersion', '') is not null then
      safe_skill_version := (runtime_payload ->> 'skillVersion')::integer;
    end if;
    if nullif(runtime_payload ->> 'lastNotificationAt', '') is not null then
      safe_last_notification := to_timestamp((runtime_payload ->> 'lastNotificationAt')::double precision);
    end if;
    if nullif(runtime_payload ->> 'lastModelSuccessAt', '') is not null then
      safe_last_model_success := to_timestamp((runtime_payload ->> 'lastModelSuccessAt')::double precision);
    end if;
  exception when others then
    raise exception 'runtime operational details are invalid';
  end;

  if safe_kind not in ('vps', 'local', 'cloud')
    or length(safe_host) not between 1 and 120
    or length(safe_version) > 80
    or safe_bridge not in ('online', 'offline', 'error')
    or safe_whatsapp not in (
      'bridge_starting', 'whatsapp_disconnected', 'starting_pairing', 'awaiting_qr',
      'qr_expired', 'connecting', 'connected', 'reconnecting', 'logged_out',
      'identity_mismatch', 'error', 'unknown'
    )
    or safe_assistant not in ('online', 'offline', 'error')
    or safe_model not in ('available', 'quota_exhausted', 'unavailable', 'not_checked')
    or length(safe_model_error) > 64
    or (safe_model_error <> '' and safe_model_error !~ '^[a-z0-9_]+$')
    or safe_mcp not in ('configured', 'not_configured', 'unavailable')
    or safe_agenda not in ('available', 'unavailable', 'not_checked')
    or safe_external not in ('available', 'unavailable', 'not_checked')
    or safe_notification not in ('online', 'dry_run', 'not_configured', 'error')
    or safe_chatbot not in ('online', 'degraded', 'not_configured', 'error')
    -- Etapa 11
    or (safe_flow is not null and safe_flow not in ('online', 'not_configured'))
    or safe_owner not in ('bot', 'ia', 'humano')
    or length(safe_skill_slug) > 80
    or length(safe_skill_hash) > 128
    or (safe_skill_version is not null and safe_skill_version <= 0)
    or length(trim(coalesce(runtime_payload ->> 'contractVersion', ''))) > 80 then
    raise exception 'runtime heartbeat state is invalid';
  end if;

  insert into public.connection_runtime_status (
    connection_id, organization_id, instance_id, runtime_kind, host_label,
    runtime_version, bridge_status, whatsapp_status, assistant_status,
    model_status, last_model_success_at, last_model_error_code, mcp_status,
    agenda_status, agenda_read, agenda_write, external_approval_status,
    notification_worker_status, last_notification_at, skill_slug, skill_version,
    skill_hash, chatbot_status, automation_enabled, default_owner, open_bot,
    open_ai, open_human, contract_version, flow_runtime_status, started_at, heartbeat_at, updated_at
  ) values (
    robot_connection, robot_org, safe_instance, safe_kind, safe_host,
    safe_version, safe_bridge, safe_whatsapp, safe_assistant,
    safe_model, safe_last_model_success, safe_model_error, safe_mcp,
    safe_agenda,
    case when runtime_payload ? 'agendaRead' then (runtime_payload ->> 'agendaRead')::boolean end,
    case when runtime_payload ? 'agendaWrite' then (runtime_payload ->> 'agendaWrite')::boolean end,
    safe_external, safe_notification, safe_last_notification, safe_skill_slug,
    safe_skill_version, safe_skill_hash, safe_chatbot,
    coalesce((runtime_payload ->> 'automationEnabled')::boolean, false),
    safe_owner,
    greatest(0, least(coalesce((runtime_payload ->> 'openBot')::integer, 0), 100000)),
    greatest(0, least(coalesce((runtime_payload ->> 'openAi')::integer, 0), 100000)),
    greatest(0, least(coalesce((runtime_payload ->> 'openHuman')::integer, 0), 100000)),
    trim(coalesce(runtime_payload ->> 'contractVersion', '')),
    safe_flow, -- Etapa 11
    now(), now(), now()
  )
  on conflict (connection_id) do update set
    organization_id = excluded.organization_id,
    instance_id = excluded.instance_id,
    runtime_kind = excluded.runtime_kind,
    host_label = excluded.host_label,
    runtime_version = excluded.runtime_version,
    bridge_status = excluded.bridge_status,
    whatsapp_status = excluded.whatsapp_status,
    assistant_status = excluded.assistant_status,
    model_status = excluded.model_status,
    last_model_success_at = coalesce(
      excluded.last_model_success_at,
      public.connection_runtime_status.last_model_success_at
    ),
    last_model_error_code = excluded.last_model_error_code,
    mcp_status = excluded.mcp_status,
    agenda_status = excluded.agenda_status,
    agenda_read = excluded.agenda_read,
    agenda_write = excluded.agenda_write,
    external_approval_status = excluded.external_approval_status,
    notification_worker_status = excluded.notification_worker_status,
    last_notification_at = coalesce(
      excluded.last_notification_at,
      public.connection_runtime_status.last_notification_at
    ),
    skill_slug = excluded.skill_slug,
    skill_version = excluded.skill_version,
    skill_hash = excluded.skill_hash,
    chatbot_status = excluded.chatbot_status,
    automation_enabled = excluded.automation_enabled,
    default_owner = excluded.default_owner,
    open_bot = excluded.open_bot,
    open_ai = excluded.open_ai,
    open_human = excluded.open_human,
    contract_version = excluded.contract_version,
    flow_runtime_status = excluded.flow_runtime_status, -- Etapa 11
    started_at = case
      when public.connection_runtime_status.instance_id = excluded.instance_id
        then public.connection_runtime_status.started_at
      else now()
    end,
    heartbeat_at = now(),
    updated_at = now();

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = robot_org
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object(
    'accepted', true,
    'connectionId', robot_connection,
    'heartbeatAt', now()
  );
end;
$$;

revoke all on function public.nucleo_runtime_heartbeat(jsonb) from public, anon;
grant execute on function public.nucleo_runtime_heartbeat(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4/4. Observação (11.4): só leitura, só para o dono do banco.
create or replace view private.flow_execution_overview as
select
  execution.organization_id,
  organization.name as organization_name,
  execution.status,
  coalesce(execution.reason, '') as reason,
  count(*) as executions,
  count(*) filter (where execution.updated_at > now() - interval '24 hours') as last_24h,
  max(execution.updated_at) as last_update
from public.chatbot_flow_executions execution
join public.organizations organization on organization.id = execution.organization_id
where execution.created_at > now() - interval '30 days'
group by execution.organization_id, organization.name, execution.status, coalesce(execution.reason, '');

revoke all on private.flow_execution_overview from public, anon, authenticated, service_role;
comment on view private.flow_execution_overview is
  'Etapa 11 (11.4): execuções de fluxo dos últimos 30 dias por empresa, status e motivo. Sem conteúdo de conversa.';

-- Conferência: falha aqui, e nada fica gravado, se o efeito não for o esperado.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'connection_runtime_status' and column_name = 'flow_runtime_status') then
    raise exception 'conferência: falta connection_runtime_status.flow_runtime_status';
  end if;
  if (select prosrc from pg_proc where oid = 'public.nucleo_runtime_heartbeat(jsonb)'::regprocedure)
     not like '%flowRuntime%' then
    raise exception 'conferência: o heartbeat não lê flowRuntime';
  end if;
  if has_function_privilege('anon', 'public.nucleo_runtime_heartbeat(jsonb)', 'execute') then
    raise exception 'conferência: anon executa o heartbeat';
  end if;
  if has_table_privilege('authenticated', 'private.flow_execution_overview', 'select') then
    raise exception 'conferência: a visão de observação ficou aberta';
  end if;
end $$;

commit;
