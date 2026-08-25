-- Plano de controle operacional da VPS.
--
-- O navegador nunca acessa as portas locais do Bridge/assistente. O runtime
-- publica somente estados sanitizados usando a credencial de robô da própria
-- conexão; membros da organização podem ler o último heartbeat via RLS.

begin;

create table if not exists public.connection_runtime_status (
  connection_id uuid primary key,
  organization_id uuid not null,
  instance_id uuid not null,
  runtime_kind text not null default 'vps'
    check (runtime_kind in ('vps', 'local', 'cloud')),
  host_label text not null default 'Runtime do Núcleo'
    check (length(trim(host_label)) between 1 and 120),
  runtime_version text not null default '' check (length(runtime_version) <= 80),
  bridge_status text not null check (bridge_status in ('online', 'offline', 'error')),
  whatsapp_status text not null check (whatsapp_status in (
    'bridge_starting', 'whatsapp_disconnected', 'starting_pairing', 'awaiting_qr',
    'qr_expired', 'connecting', 'connected', 'reconnecting', 'logged_out',
    'identity_mismatch', 'error', 'unknown'
  )),
  assistant_status text not null check (assistant_status in ('online', 'offline', 'error')),
  mcp_status text not null check (mcp_status in ('configured', 'not_configured', 'unavailable')),
  agenda_status text not null check (agenda_status in ('available', 'unavailable', 'not_checked')),
  agenda_read boolean,
  agenda_write boolean,
  chatbot_status text not null default 'not_configured'
    check (chatbot_status in ('online', 'degraded', 'not_configured', 'error')),
  automation_enabled boolean not null default false,
  default_owner text not null default 'bot' check (default_owner in ('bot', 'ia', 'humano')),
  open_bot integer not null default 0 check (open_bot >= 0),
  open_ai integer not null default 0 check (open_ai >= 0),
  open_human integer not null default 0 check (open_human >= 0),
  contract_version text not null default '' check (length(contract_version) <= 80),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, organization_id),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

create index if not exists connection_runtime_status_org_idx
  on public.connection_runtime_status (organization_id, heartbeat_at desc);

alter table public.connection_runtime_status enable row level security;
revoke all on public.connection_runtime_status from anon, authenticated;
grant select on public.connection_runtime_status to authenticated;

drop policy if exists connection_runtime_status_select on public.connection_runtime_status;
create policy connection_runtime_status_select
on public.connection_runtime_status for select to authenticated
using (private.is_org_member(organization_id));

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
  safe_chatbot text := trim(coalesce(runtime_payload ->> 'chatbot', 'not_configured'));
  safe_owner text := trim(coalesce(runtime_payload ->> 'defaultOwner', 'bot'));
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if jsonb_typeof(runtime_payload) <> 'object'
    or pg_catalog.octet_length(runtime_payload::text) > 4096 then
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
  exception when others then
    raise exception 'runtime instance id is invalid';
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
    or safe_chatbot not in ('online', 'degraded', 'not_configured', 'error')
    or safe_owner not in ('bot', 'ia', 'humano')
    or length(trim(coalesce(runtime_payload ->> 'contractVersion', ''))) > 80 then
    raise exception 'runtime heartbeat state is invalid';
  end if;

  insert into public.connection_runtime_status (
    connection_id, organization_id, instance_id, runtime_kind, host_label,
    runtime_version, bridge_status, whatsapp_status, assistant_status, mcp_status,
    agenda_status, agenda_read, agenda_write, chatbot_status,
    automation_enabled, default_owner, open_bot, open_ai, open_human,
    contract_version, started_at, heartbeat_at, updated_at
  ) values (
    robot_connection, robot_org, safe_instance, safe_kind, safe_host,
    safe_version, safe_bridge, safe_whatsapp, safe_assistant, safe_mcp,
    safe_agenda,
    case when runtime_payload ? 'agendaRead' then (runtime_payload ->> 'agendaRead')::boolean end,
    case when runtime_payload ? 'agendaWrite' then (runtime_payload ->> 'agendaWrite')::boolean end,
    safe_chatbot,
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

-- Reutiliza o canal sanitizado já consumido pelo portal.
drop trigger if exists connection_runtime_status_portal_realtime
  on public.connection_runtime_status;
create trigger connection_runtime_status_portal_realtime
after insert or update or delete on public.connection_runtime_status
for each row execute function private.portal_realtime_notify('connections');

commit;
