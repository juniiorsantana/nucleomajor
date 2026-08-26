-- Envio remoto de códigos de operador pelo runtime da VPS.
--
-- O navegador cria o desafio, mas nunca recebe o telefone normalizado nem o
-- código. A credencial de robô da conexão reivindica o comando pelo Supabase,
-- envia pelo Bridge em loopback e publica apenas um resultado sanitizado.

begin;

create table if not exists public.connection_runtime_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  command_type text not null
    check (command_type in ('operator_verification_send')),
  private_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'failed', 'expired')),
  created_by uuid not null references public.profiles(id),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  available_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_by uuid,
  claimed_instance uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_-]{1,80}$'),
  public_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

create index if not exists connection_runtime_commands_claim_idx
  on public.connection_runtime_commands (organization_id, connection_id, status, available_at, created_at)
  where status = 'pending';

create index if not exists connection_runtime_commands_expiry_idx
  on public.connection_runtime_commands (expires_at)
  where status in ('pending', 'claimed');

alter table public.connection_runtime_commands enable row level security;
revoke all on public.connection_runtime_commands from anon, authenticated;

create or replace function public.whatsapp_operator_verification_enqueue(
  target_organization uuid,
  target_connection uuid,
  target_user uuid,
  target_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge record;
  command_id uuid;
  command_key text;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;

  select * into challenge
  from public.whatsapp_operator_verification_begin(
    target_organization,
    target_connection,
    target_user,
    target_phone
  );

  if challenge.verification_id is null then
    raise exception 'operator verification challenge was not created';
  end if;

  command_key := encode(
    extensions.digest(
      concat_ws(':', 'operator-verification', challenge.verification_id::text),
      'sha256'
    ),
    'hex'
  );

  insert into public.connection_runtime_commands (
    organization_id,
    connection_id,
    command_type,
    private_payload,
    created_by,
    idempotency_key,
    expires_at
  ) values (
    target_organization,
    target_connection,
    'operator_verification_send',
    jsonb_build_object(
      'verificationId', challenge.verification_id,
      'recipient', challenge.target_phone_e164,
      'code', challenge.verification_code
    ),
    auth.uid(),
    command_key,
    challenge.expires_at
  )
  returning id into command_id;

  return jsonb_build_object(
    'command_id', command_id,
    'verification_id', challenge.verification_id,
    'status', 'pending',
    'expires_at', challenge.expires_at
  );
end;
$$;

create or replace function public.whatsapp_operator_verification_command_status(
  target_organization uuid,
  target_command uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_row public.connection_runtime_commands%rowtype;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;

  update public.connection_runtime_commands
  set status = 'expired',
      private_payload = '{}'::jsonb,
      error_code = 'expired',
      completed_at = now(),
      updated_at = now()
  where id = target_command
    and organization_id = target_organization
    and status in ('pending', 'claimed')
    and expires_at <= now();

  select command.* into command_row
  from public.connection_runtime_commands command
  where command.id = target_command
    and command.organization_id = target_organization;

  if not found then
    raise exception 'runtime command not found';
  end if;

  return jsonb_build_object(
    'command_id', command_row.id,
    'status', command_row.status,
    'error_code', command_row.error_code,
    'created_at', command_row.created_at,
    'claimed_at', command_row.claimed_at,
    'completed_at', command_row.completed_at,
    'expires_at', command_row.expires_at
  );
end;
$$;

create or replace function public.nucleo_runtime_commands_claim(
  max_items integer default 10,
  runtime_instance uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  safe_limit integer := greatest(1, least(coalesce(max_items, 10), 20));
  claimed_commands jsonb;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
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

  update public.connection_runtime_commands
  set status = 'expired',
      private_payload = '{}'::jsonb,
      error_code = 'expired',
      completed_at = now(),
      updated_at = now()
  where organization_id = robot_org
    and connection_id = robot_connection
    and status in ('pending', 'claimed')
    and expires_at <= now();

  with selected as (
    select command.id
    from public.connection_runtime_commands command
    where command.organization_id = robot_org
      and command.connection_id = robot_connection
      and command.status = 'pending'
      and command.available_at <= now()
      and command.expires_at > now()
      and command.attempts < 3
    order by command.created_at
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.connection_runtime_commands command
    set status = 'claimed',
        claimed_by = auth.uid(),
        claimed_instance = runtime_instance,
        claimed_at = now(),
        attempts = command.attempts + 1,
        updated_at = now()
    from selected
    where command.id = selected.id
    returning command.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'commandId', claimed.id,
    'organizationId', claimed.organization_id,
    'connectionId', claimed.connection_id,
    'commandType', claimed.command_type,
    'payload', claimed.private_payload,
    'expiresAt', claimed.expires_at
  ) order by claimed.created_at), '[]'::jsonb)
  into claimed_commands
  from claimed;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = robot_org
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object('commands', claimed_commands);
end;
$$;

create or replace function public.nucleo_runtime_command_complete(
  target_command uuid,
  completion_status text,
  completion_error_code text default null,
  completion_result jsonb default '{}'::jsonb,
  runtime_instance uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  safe_status text := lower(trim(coalesce(completion_status, '')));
  safe_error text := lower(trim(coalesce(completion_error_code, '')));
  updated_id uuid;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if safe_status not in ('completed', 'failed') then
    raise exception 'runtime command completion status is invalid';
  end if;
  if safe_error <> '' and safe_error !~ '^[a-z0-9_-]{1,80}$' then
    raise exception 'runtime command error code is invalid';
  end if;
  if jsonb_typeof(coalesce(completion_result, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(completion_result, '{}'::jsonb)::text) > 2048 then
    raise exception 'runtime command result is invalid';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;

  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;

  update public.connection_runtime_commands command
  set status = safe_status,
      private_payload = '{}'::jsonb,
      error_code = nullif(safe_error, ''),
      public_result = coalesce(completion_result, '{}'::jsonb),
      completed_at = now(),
      updated_at = now()
  where command.id = target_command
    and command.organization_id = robot_org
    and command.connection_id = robot_connection
    and command.status = 'claimed'
    and command.claimed_by = auth.uid()
    and (runtime_instance is null or command.claimed_instance = runtime_instance)
  returning command.id into updated_id;

  if updated_id is null then
    raise exception 'runtime command is not claimed by this runtime';
  end if;

  return jsonb_build_object(
    'commandId', updated_id,
    'status', safe_status,
    'completedAt', now()
  );
end;
$$;

revoke all on function public.whatsapp_operator_verification_enqueue(uuid, uuid, uuid, text) from public;
revoke all on function public.whatsapp_operator_verification_command_status(uuid, uuid) from public;
revoke all on function public.nucleo_runtime_commands_claim(integer, uuid) from public;
revoke all on function public.nucleo_runtime_command_complete(uuid, text, text, jsonb, uuid) from public;

grant execute on function public.whatsapp_operator_verification_enqueue(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.whatsapp_operator_verification_command_status(uuid, uuid) to authenticated;
grant execute on function public.nucleo_runtime_commands_claim(integer, uuid) to authenticated;
grant execute on function public.nucleo_runtime_command_complete(uuid, text, text, jsonb, uuid) to authenticated;

drop trigger if exists connection_runtime_commands_portal_realtime
  on public.connection_runtime_commands;
create trigger connection_runtime_commands_portal_realtime
after insert or update or delete on public.connection_runtime_commands
for each row execute function private.portal_realtime_notify('operators');

commit;
