begin;

create table if not exists public.assistant_pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  operator_id uuid not null references public.whatsapp_connection_operators(id) on delete cascade,
  operator_user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'calendar_event' check (kind in ('calendar_event')),
  status text not null default 'awaiting_confirmation'
    check (status in ('collecting', 'awaiting_confirmation', 'executing', 'completed', 'failed', 'expired')),
  contract_version text not null,
  request_key text not null check (request_key ~ '^[0-9a-f]{64}$'),
  confirmation_key text check (confirmation_key is null or confirmation_key ~ '^[0-9a-f]{64}$'),
  requester_hash text not null check (requester_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  event_id uuid references public.calendar_events(id) on delete set null,
  last_error_code text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, connection_id, request_key)
);

create unique index if not exists assistant_pending_actions_confirmation_key_idx
  on public.assistant_pending_actions (organization_id, connection_id, confirmation_key)
  where confirmation_key is not null;

create index if not exists assistant_pending_actions_active_idx
  on public.assistant_pending_actions (organization_id, connection_id, operator_user_id, created_at desc)
  where status in ('collecting', 'awaiting_confirmation', 'failed');

alter table public.assistant_pending_actions enable row level security;
revoke all on public.assistant_pending_actions from anon, authenticated;

drop trigger if exists assistant_pending_actions_org_immutable on public.assistant_pending_actions;
create trigger assistant_pending_actions_org_immutable
before update on public.assistant_pending_actions
for each row execute function private.prevent_organization_change();

create or replace function public.nucleo_assistant_capabilities(
  requester_phone text,
  expected_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  schema_version constant text := 'fase-g-1';
  compatible boolean;
begin
  select * into context_row
  from public.nucleo_operator_context(requester_phone)
  limit 1;
  if not found then raise exception 'operator context unavailable'; end if;

  compatible := trim(coalesce(expected_contract_version, '')) = schema_version;
  return jsonb_build_object(
    'schemaVersion', schema_version,
    'contractVersion', expected_contract_version,
    'compativel', compatible,
    'operadorAtivo', true,
    'organizacaoAtiva', true,
    'agenda', jsonb_build_object(
      'leitura', true,
      'escrita', compatible,
      'confirmacaoObrigatoria', true,
      'intervaloMinutos', 30
    ),
    'operador', jsonb_build_object(
      'usuarioId', context_row.user_id,
      'nome', context_row.operator_name,
      'papel', context_row.operator_role
    ),
    'organizacaoId', context_row.organization_id,
    'conexaoId', context_row.connection_id
  );
end;
$$;

create or replace function public.nucleo_calendar_operator_action_prepare(
  requester_phone text,
  request_key text,
  requester_hash text,
  action_payload jsonb,
  contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  payload_digest text;
  existing_action public.assistant_pending_actions%rowtype;
  created_action public.assistant_pending_actions%rowtype;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if contract_version <> 'fase-g-1' then
    raise exception 'runtime contract version is incompatible';
  end if;
  if request_key is null or request_key !~ '^[0-9a-f]{64}$'
    or requester_hash is null or requester_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid pending action idempotency key';
  end if;
  if jsonb_typeof(action_payload) <> 'object' then
    raise exception 'pending action payload must be an object';
  end if;
  if length(trim(coalesce(action_payload->>'titulo', ''))) not between 1 and 240 then
    raise exception 'booking title must have between 1 and 240 characters';
  end if;

  begin
    starts_at := (action_payload->>'inicio')::timestamptz;
    ends_at := (action_payload->>'fim')::timestamptz;
  exception when others then
    raise exception 'booking interval is invalid';
  end;
  if ends_at <= starts_at
    or ends_at - starts_at < interval '30 minutes'
    or ends_at - starts_at > interval '8 hours'
    or mod(extract(epoch from (ends_at - starts_at))::bigint, 1800) <> 0
    or extract(second from starts_at) <> 0
    or mod(extract(minute from starts_at)::integer, 30) <> 0
    or extract(second from ends_at) <> 0
    or mod(extract(minute from ends_at)::integer, 30) <> 0 then
    raise exception 'booking interval must use 30-minute boundaries';
  end if;
  if starts_at < now() - interval '5 minutes' or starts_at > now() + interval '366 days' then
    raise exception 'booking must be in the next 366 days';
  end if;
  if jsonb_typeof(coalesce(action_payload->'participantesIds', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(action_payload->'participantesIds', '[]'::jsonb)) > 20 then
    raise exception 'invalid booking participants';
  end if;

  select * into context_row
  from public.nucleo_operator_context(requester_phone)
  limit 1;
  if not found then raise exception 'operator context unavailable'; end if;

  payload_digest := encode(extensions.digest(action_payload::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(context_row.connection_id::text || ':' || request_key, 0)
  );

  select * into existing_action
  from public.assistant_pending_actions action
  where action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.request_key = nucleo_calendar_operator_action_prepare.request_key;
  if found then
    if existing_action.payload_hash <> payload_digest then
      raise exception 'pending action key was already used with different data';
    end if;
    return jsonb_build_object(
      'status', existing_action.status,
      'acaoPendenteId', existing_action.id,
      'expiraEm', existing_action.expires_at,
      'resumo', existing_action.payload,
      'message', 'Proposta já preparada; aguarde confirmação explícita.'
    );
  end if;

  update public.assistant_pending_actions action
  set status = 'expired', updated_at = now()
  where action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
    and action.status in ('collecting', 'awaiting_confirmation', 'failed');

  insert into public.assistant_pending_actions (
    organization_id, connection_id, operator_id, operator_user_id,
    contract_version, request_key, requester_hash, payload_hash, payload,
    status, expires_at
  ) values (
    context_row.organization_id, context_row.connection_id, context_row.operator_id,
    context_row.user_id, contract_version, request_key, requester_hash,
    payload_digest, action_payload, 'awaiting_confirmation', now() + interval '30 minutes'
  ) returning * into created_action;

  return jsonb_build_object(
    'status', 'awaiting_confirmation',
    'acaoPendenteId', created_action.id,
    'expiraEm', created_action.expires_at,
    'resumo', created_action.payload,
    'message', 'Proposta preparada. Mostre o resumo e peça confirmação explícita.'
  );
end;
$$;

create or replace function public.nucleo_calendar_operator_action_pending(
  requester_phone text,
  expected_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  pending_action public.assistant_pending_actions%rowtype;
begin
  if expected_contract_version <> 'fase-g-1' then
    raise exception 'runtime contract version is incompatible';
  end if;
  select * into context_row
  from public.nucleo_operator_context(requester_phone)
  limit 1;
  if not found then raise exception 'operator context unavailable'; end if;

  update public.assistant_pending_actions action
  set status = 'expired', updated_at = now()
  where action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
    and action.status in ('collecting', 'awaiting_confirmation', 'failed')
    and action.expires_at <= now();

  select * into pending_action
  from public.assistant_pending_actions action
  where action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
    and action.contract_version = expected_contract_version
    and action.status in ('awaiting_confirmation', 'failed')
    and action.expires_at > now()
  order by action.created_at desc
  limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'status', 'awaiting_confirmation',
    'acaoPendenteId', pending_action.id,
    'expiraEm', pending_action.expires_at,
    'resumo', pending_action.payload
  );
end;
$$;

create or replace function public.nucleo_calendar_operator_action_confirm(
  requester_phone text,
  pending_action uuid,
  operator_confirmed boolean,
  confirmation_key text,
  expected_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  action_row public.assistant_pending_actions%rowtype;
  booking_result jsonb;
  participant_ids uuid[];
  reminder_minutes integer[];
begin
  if not operator_confirmed then
    raise exception 'operator confirmation is required';
  end if;
  if confirmation_key is null or confirmation_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid confirmation turn key';
  end if;
  if expected_contract_version <> 'fase-g-1' then
    raise exception 'runtime contract version is incompatible';
  end if;
  select * into context_row
  from public.nucleo_operator_context(requester_phone)
  limit 1;
  if not found then raise exception 'operator context unavailable'; end if;

  select * into action_row
  from public.assistant_pending_actions action
  where action.id = pending_action
    and action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
  for update;
  if not found then
    return jsonb_build_object(
      'status', 'not_found', 'errorCode', 'missing_confirmation',
      'message', 'Não existe uma proposta ativa para esta confirmação.'
    );
  end if;
  if action_row.contract_version <> expected_contract_version then
    raise exception 'pending action belongs to another runtime contract version';
  end if;
  if confirmation_key = action_row.request_key then
    raise exception 'confirmation must arrive in a later operator turn';
  end if;
  if action_row.status = 'completed' then
    return jsonb_build_object(
      'status', 'already_exists', 'criado', false, 'jaExistia', true,
      'conflito', false, 'eventoId', action_row.event_id,
      'acaoPendenteId', action_row.id
    );
  end if;
  if action_row.expires_at <= now() or action_row.status = 'expired' then
    update public.assistant_pending_actions set status = 'expired', updated_at = now()
    where id = action_row.id;
    return jsonb_build_object(
      'status', 'expired', 'errorCode', 'missing_confirmation',
      'message', 'A proposta expirou. Prepare o agendamento novamente.'
    );
  end if;
  if action_row.status not in ('awaiting_confirmation', 'failed') then
    return jsonb_build_object(
      'status', 'unavailable', 'errorCode', 'unavailable',
      'message', 'A proposta não está disponível para confirmação.'
    );
  end if;

  participant_ids := array(
    select value::uuid
    from jsonb_array_elements_text(coalesce(action_row.payload->'participantesIds', '[]'::jsonb)) value
  );
  reminder_minutes := array(
    select value::integer
    from jsonb_array_elements_text(coalesce(action_row.payload->'lembretesMinutos', '[30]'::jsonb)) value
  );

  update public.assistant_pending_actions
  set status = 'executing', updated_at = now(), last_error_code = null
  where id = action_row.id;

  booking_result := public.nucleo_calendar_operator_booking_create(
    requester_phone,
    encode(extensions.digest(action_row.id::text || ':' || action_row.contract_version, 'sha256'), 'hex'),
    action_row.requester_hash,
    action_row.payload->>'titulo',
    coalesce(action_row.payload->>'descricao', ''),
    (action_row.payload->>'inicio')::timestamptz,
    (action_row.payload->>'fim')::timestamptz,
    coalesce(action_row.payload->>'local', ''),
    reminder_minutes,
    nullif(action_row.payload->>'responsavelId', '')::uuid,
    participant_ids,
    nullif(action_row.payload->>'contatoId', '')::uuid,
    coalesce(nullif(action_row.payload->>'visibilidade', ''), 'organization'),
    true
  );

  if coalesce((booking_result->>'conflito')::boolean, false) then
    update public.assistant_pending_actions
    set status = 'awaiting_confirmation', updated_at = now(), last_error_code = 'conflict'
    where id = action_row.id;
    return booking_result || jsonb_build_object(
      'status', 'conflict', 'errorCode', 'conflict', 'acaoPendenteId', action_row.id
    );
  end if;
  if not coalesce((booking_result->>'criado')::boolean, false)
    and not coalesce((booking_result->>'jaExistia')::boolean, false) then
    update public.assistant_pending_actions
    set status = 'failed', updated_at = now(), last_error_code = 'unavailable'
    where id = action_row.id;
    return booking_result || jsonb_build_object(
      'status', 'unavailable', 'errorCode', 'unavailable', 'acaoPendenteId', action_row.id
    );
  end if;

  update public.assistant_pending_actions
  set status = 'completed', event_id = (booking_result->>'eventoId')::uuid,
      confirmation_key = nucleo_calendar_operator_action_confirm.confirmation_key,
      completed_at = now(), updated_at = now(), last_error_code = null
  where id = action_row.id;
  return booking_result || jsonb_build_object(
    'status', case when coalesce((booking_result->>'criado')::boolean, false)
      then 'created' else 'already_exists' end,
    'acaoPendenteId', action_row.id
  );
end;
$$;

revoke all on function public.nucleo_assistant_capabilities(text, text) from public;
revoke all on function public.nucleo_calendar_operator_action_prepare(text, text, text, jsonb, text) from public;
revoke all on function public.nucleo_calendar_operator_action_pending(text, text) from public;
revoke all on function public.nucleo_calendar_operator_action_confirm(text, uuid, boolean, text, text) from public;

grant execute on function public.nucleo_assistant_capabilities(text, text) to authenticated;
grant execute on function public.nucleo_calendar_operator_action_prepare(text, text, text, jsonb, text) to authenticated;
grant execute on function public.nucleo_calendar_operator_action_pending(text, text) to authenticated;
grant execute on function public.nucleo_calendar_operator_action_confirm(text, uuid, boolean, text, text) to authenticated;

commit;
