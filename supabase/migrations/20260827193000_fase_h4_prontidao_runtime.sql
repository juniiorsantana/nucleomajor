-- Fase H.4: prontidão operacional detalhada do runtime da VPS.

begin;

alter table public.connection_runtime_status
  add column if not exists external_approval_status text not null default 'not_checked'
    check (external_approval_status in ('available', 'unavailable', 'not_checked')),
  add column if not exists notification_worker_status text not null default 'not_configured'
    check (notification_worker_status in ('online', 'dry_run', 'not_configured', 'error')),
  add column if not exists last_notification_at timestamptz,
  add column if not exists skill_slug text not null default '' check (length(skill_slug) <= 80),
  add column if not exists skill_version integer check (skill_version is null or skill_version > 0),
  add column if not exists skill_hash text not null default '' check (length(skill_hash) <= 128);

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
  safe_mcp text := trim(coalesce(runtime_payload ->> 'mcp', 'unavailable'));
  safe_agenda text := trim(coalesce(runtime_payload ->> 'agenda', 'not_checked'));
  safe_external text := trim(coalesce(runtime_payload ->> 'externalApproval', 'not_checked'));
  safe_notification text := trim(coalesce(runtime_payload ->> 'notificationWorker', 'not_configured'));
  safe_chatbot text := trim(coalesce(runtime_payload ->> 'chatbot', 'not_configured'));
  safe_owner text := trim(coalesce(runtime_payload ->> 'defaultOwner', 'bot'));
  safe_skill_slug text := trim(coalesce(runtime_payload ->> 'skillSlug', ''));
  safe_skill_hash text := trim(coalesce(runtime_payload ->> 'skillHash', ''));
  safe_skill_version integer;
  safe_last_notification timestamptz;
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
    or safe_mcp not in ('configured', 'not_configured', 'unavailable')
    or safe_agenda not in ('available', 'unavailable', 'not_checked')
    or safe_external not in ('available', 'unavailable', 'not_checked')
    or safe_notification not in ('online', 'dry_run', 'not_configured', 'error')
    or safe_chatbot not in ('online', 'degraded', 'not_configured', 'error')
    or safe_owner not in ('bot', 'ia', 'humano')
    or length(safe_skill_slug) > 80
    or length(safe_skill_hash) > 128
    or (safe_skill_version is not null and safe_skill_version <= 0)
    or length(trim(coalesce(runtime_payload ->> 'contractVersion', ''))) > 80 then
    raise exception 'runtime heartbeat state is invalid';
  end if;

  insert into public.connection_runtime_status (
    connection_id, organization_id, instance_id, runtime_kind, host_label,
    runtime_version, bridge_status, whatsapp_status, assistant_status, mcp_status,
    agenda_status, agenda_read, agenda_write, external_approval_status,
    notification_worker_status, last_notification_at, skill_slug, skill_version,
    skill_hash, chatbot_status, automation_enabled, default_owner, open_bot,
    open_ai, open_human, contract_version, started_at, heartbeat_at, updated_at
  ) values (
    robot_connection, robot_org, safe_instance, safe_kind, safe_host,
    safe_version, safe_bridge, safe_whatsapp, safe_assistant, safe_mcp,
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
    mcp_status = excluded.mcp_status,
    agenda_status = excluded.agenda_status,
    agenda_read = excluded.agenda_read,
    agenda_write = excluded.agenda_write,
    external_approval_status = excluded.external_approval_status,
    notification_worker_status = excluded.notification_worker_status,
    last_notification_at = coalesce(excluded.last_notification_at, public.connection_runtime_status.last_notification_at),
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

revoke all on function public.nucleo_runtime_heartbeat(jsonb) from public;
grant execute on function public.nucleo_runtime_heartbeat(jsonb) to authenticated;

commit;
