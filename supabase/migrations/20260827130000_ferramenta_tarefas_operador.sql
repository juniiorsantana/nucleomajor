begin;

-- Tarefas internas podem existir sem contato. Quando houver contato ou
-- negócio, o vínculo continua validado dentro da mesma organização.
alter table public.tasks alter column contact_id drop not null;

alter table public.assistant_pending_actions
  add column if not exists task_id uuid references public.tasks(id) on delete set null;

alter table public.assistant_pending_actions
  drop constraint if exists assistant_pending_actions_kind_check;
alter table public.assistant_pending_actions
  add constraint assistant_pending_actions_kind_check
  check (kind in ('calendar_event', 'task'));

alter table public.assistant_pending_actions
  drop constraint if exists assistant_pending_actions_single_result_check;
alter table public.assistant_pending_actions
  add constraint assistant_pending_actions_single_result_check
  check (num_nonnulls(event_id, task_id) <= 1);

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
    'tarefas', jsonb_build_object(
      'leitura', true,
      'escrita', compatible,
      'confirmacaoObrigatoria', true,
      'permiteAtribuirEquipe', context_row.operator_role in ('owner', 'admin')
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

create or replace function public.nucleo_task_operator_action_prepare(
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
  due_at timestamptz;
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
    raise exception 'task title must have between 1 and 240 characters';
  end if;
  begin
    due_at := (action_payload->>'venceEm')::timestamptz;
    if nullif(action_payload->>'responsavelId', '') is not null then
      perform (action_payload->>'responsavelId')::uuid;
    end if;
    if nullif(action_payload->>'contatoId', '') is not null then
      perform (action_payload->>'contatoId')::uuid;
    end if;
    if nullif(action_payload->>'negocioId', '') is not null then
      perform (action_payload->>'negocioId')::uuid;
    end if;
  exception when others then
    raise exception 'task payload contains an invalid date or identifier';
  end;
  if due_at is null or due_at < now() - interval '5 minutes'
    or due_at > now() + interval '366 days' then
    raise exception 'task due date must be in the next 366 days';
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
    and action.request_key = nucleo_task_operator_action_prepare.request_key;
  if found then
    if existing_action.kind <> 'task' or existing_action.payload_hash <> payload_digest then
      raise exception 'pending action key was already used with different data';
    end if;
    return jsonb_build_object(
      'status', existing_action.status,
      'acaoPendenteId', existing_action.id,
      'expiraEm', existing_action.expires_at,
      'resumo', existing_action.payload,
      'message', 'Tarefa já preparada; aguarde confirmação explícita.'
    );
  end if;

  update public.assistant_pending_actions action
  set status = 'expired', updated_at = now()
  where action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
    and action.kind = 'task'
    and action.status in ('collecting', 'awaiting_confirmation', 'failed');

  insert into public.assistant_pending_actions (
    organization_id, connection_id, operator_id, operator_user_id, kind,
    contract_version, request_key, requester_hash, payload_hash, payload,
    status, expires_at
  ) values (
    context_row.organization_id, context_row.connection_id, context_row.operator_id,
    context_row.user_id, 'task', contract_version, request_key, requester_hash,
    payload_digest, action_payload, 'awaiting_confirmation', now() + interval '30 minutes'
  ) returning * into created_action;

  return jsonb_build_object(
    'status', 'awaiting_confirmation',
    'acaoPendenteId', created_action.id,
    'expiraEm', created_action.expires_at,
    'resumo', created_action.payload,
    'message', 'Tarefa preparada. Mostre o resumo e peça confirmação explícita.'
  );
end;
$$;

create or replace function public.nucleo_task_operator_action_pending(
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
    and action.kind = 'task'
    and action.status in ('collecting', 'awaiting_confirmation', 'failed')
    and action.expires_at <= now();

  select * into pending_action
  from public.assistant_pending_actions action
  where action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
    and action.kind = 'task'
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

create or replace function public.nucleo_task_operator_action_confirm(
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
  created_task public.tasks%rowtype;
  safe_responsible uuid;
  safe_contact uuid;
  safe_deal uuid;
  responsible_name text;
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
    and action.kind = 'task'
  for update;
  if not found then
    return jsonb_build_object(
      'status', 'not_found', 'errorCode', 'missing_confirmation',
      'message', 'Não existe uma tarefa ativa para esta confirmação.'
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
      'status', 'already_exists', 'taskId', action_row.task_id,
      'acaoPendenteId', action_row.id,
      'message', 'Esta tarefa já havia sido criada.'
    );
  end if;
  if action_row.expires_at <= now() or action_row.status = 'expired' then
    update public.assistant_pending_actions set status = 'expired', updated_at = now()
    where id = action_row.id;
    return jsonb_build_object(
      'status', 'expired', 'errorCode', 'missing_confirmation',
      'message', 'A proposta expirou. Prepare a tarefa novamente.'
    );
  end if;
  if action_row.status not in ('awaiting_confirmation', 'failed') then
    return jsonb_build_object(
      'status', 'unavailable', 'errorCode', 'unavailable',
      'message', 'A tarefa não está disponível para confirmação.'
    );
  end if;

  safe_responsible := coalesce(
    nullif(action_row.payload->>'responsavelId', '')::uuid,
    context_row.user_id
  );
  safe_contact := nullif(action_row.payload->>'contatoId', '')::uuid;
  safe_deal := nullif(action_row.payload->>'negocioId', '')::uuid;

  if context_row.operator_role = 'member' and safe_responsible <> context_row.user_id then
    raise exception 'member can only create tasks assigned to themselves';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = context_row.organization_id
      and member.user_id = safe_responsible
      and member.status = 'active'
  ) then
    raise exception 'task owner is not an active member of this organization';
  end if;
  if safe_contact is not null and not exists (
    select 1 from public.contacts contact
    where contact.id = safe_contact
      and contact.organization_id = context_row.organization_id
      and contact.deleted_at is null
  ) then
    raise exception 'contact is not in this organization';
  end if;
  if safe_deal is not null then
    select deal.contact_id into safe_contact
    from public.deals deal
    where deal.id = safe_deal
      and deal.organization_id = context_row.organization_id
      and deal.deleted_at is null
      and (safe_contact is null or deal.contact_id = safe_contact);
    if not found then raise exception 'deal is not compatible with this task'; end if;
  end if;
  if length(trim(coalesce(action_row.payload->>'titulo', ''))) not between 1 and 240 then
    raise exception 'task title must have between 1 and 240 characters';
  end if;

  select coalesce(profile.full_name, '') into responsible_name
  from public.profiles profile
  where profile.id = safe_responsible;

  update public.assistant_pending_actions
  set status = 'executing', updated_at = now(), last_error_code = null
  where id = action_row.id;

  insert into public.tasks (
    organization_id, contact_id, deal_id, title, due_at, completed,
    owner_label, owner_id, created_by, updated_by
  ) values (
    context_row.organization_id, safe_contact, safe_deal,
    trim(action_row.payload->>'titulo'), (action_row.payload->>'venceEm')::timestamptz,
    false, responsible_name, safe_responsible, context_row.user_id, context_row.user_id
  ) returning * into created_task;

  if safe_contact is not null then
    insert into public.contact_events (
      organization_id, contact_id, event_type, entity_type, entity_id,
      source, payload, created_by
    ) values (
      context_row.organization_id, safe_contact, 'task.created', 'tarefa', created_task.id,
      'assistant', jsonb_build_object('titulo', created_task.title), context_row.user_id
    );
  end if;

  update public.assistant_pending_actions
  set status = 'completed', task_id = created_task.id,
      confirmation_key = nucleo_task_operator_action_confirm.confirmation_key,
      completed_at = now(), updated_at = now(), last_error_code = null
  where id = action_row.id;

  return jsonb_build_object(
    'status', 'created',
    'taskId', created_task.id,
    'acaoPendenteId', action_row.id,
    'titulo', created_task.title,
    'venceEm', created_task.due_at,
    'responsavelId', created_task.owner_id,
    'contatoId', created_task.contact_id,
    'negocioId', created_task.deal_id,
    'message', 'Tarefa criada no CRM e incluída na agenda.'
  );
end;
$$;

-- Depois de introduzir outro tipo de ação, o fluxo de agenda precisa recusar
-- explicitamente qualquer ação que não seja um evento.
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
    and action.kind = 'calendar_event'
    and action.status in ('collecting', 'awaiting_confirmation', 'failed')
    and action.expires_at <= now();

  select * into pending_action
  from public.assistant_pending_actions action
  where action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
    and action.kind = 'calendar_event'
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
  if not operator_confirmed then raise exception 'operator confirmation is required'; end if;
  if confirmation_key is null or confirmation_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid confirmation turn key';
  end if;
  if expected_contract_version <> 'fase-g-1' then
    raise exception 'runtime contract version is incompatible';
  end if;
  select * into context_row from public.nucleo_operator_context(requester_phone) limit 1;
  if not found then raise exception 'operator context unavailable'; end if;

  select * into action_row
  from public.assistant_pending_actions action
  where action.id = pending_action
    and action.organization_id = context_row.organization_id
    and action.connection_id = context_row.connection_id
    and action.operator_user_id = context_row.user_id
    and action.kind = 'calendar_event'
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'errorCode', 'missing_confirmation',
      'message', 'Não existe uma proposta ativa para esta confirmação.');
  end if;
  if action_row.contract_version <> expected_contract_version then
    raise exception 'pending action belongs to another runtime contract version';
  end if;
  if confirmation_key = action_row.request_key then
    raise exception 'confirmation must arrive in a later operator turn';
  end if;
  if action_row.status = 'completed' then
    return jsonb_build_object('status', 'already_exists', 'criado', false, 'jaExistia', true,
      'conflito', false, 'eventoId', action_row.event_id, 'acaoPendenteId', action_row.id);
  end if;
  if action_row.expires_at <= now() or action_row.status = 'expired' then
    update public.assistant_pending_actions set status = 'expired', updated_at = now()
    where id = action_row.id;
    return jsonb_build_object('status', 'expired', 'errorCode', 'missing_confirmation',
      'message', 'A proposta expirou. Prepare o agendamento novamente.');
  end if;
  if action_row.status not in ('awaiting_confirmation', 'failed') then
    return jsonb_build_object('status', 'unavailable', 'errorCode', 'unavailable',
      'message', 'A proposta não está disponível para confirmação.');
  end if;

  participant_ids := array(select value::uuid from jsonb_array_elements_text(
    coalesce(action_row.payload->'participantesIds', '[]'::jsonb)) value);
  reminder_minutes := array(select value::integer from jsonb_array_elements_text(
    coalesce(action_row.payload->'lembretesMinutos', '[30]'::jsonb)) value);
  update public.assistant_pending_actions set status = 'executing', updated_at = now(),
    last_error_code = null where id = action_row.id;

  booking_result := public.nucleo_calendar_operator_booking_create(
    requester_phone,
    encode(extensions.digest(action_row.id::text || ':' || action_row.contract_version, 'sha256'), 'hex'),
    action_row.requester_hash, action_row.payload->>'titulo',
    coalesce(action_row.payload->>'descricao', ''),
    (action_row.payload->>'inicio')::timestamptz,
    (action_row.payload->>'fim')::timestamptz,
    coalesce(action_row.payload->>'local', ''), reminder_minutes,
    nullif(action_row.payload->>'responsavelId', '')::uuid, participant_ids,
    nullif(action_row.payload->>'contatoId', '')::uuid,
    coalesce(nullif(action_row.payload->>'visibilidade', ''), 'organization'), true
  );

  if coalesce((booking_result->>'conflito')::boolean, false) then
    update public.assistant_pending_actions set status = 'awaiting_confirmation',
      updated_at = now(), last_error_code = 'conflict' where id = action_row.id;
    return booking_result || jsonb_build_object('status', 'conflict', 'errorCode', 'conflict',
      'acaoPendenteId', action_row.id);
  end if;
  if not coalesce((booking_result->>'criado')::boolean, false)
    and not coalesce((booking_result->>'jaExistia')::boolean, false) then
    update public.assistant_pending_actions set status = 'failed', updated_at = now(),
      last_error_code = 'unavailable' where id = action_row.id;
    return booking_result || jsonb_build_object('status', 'unavailable',
      'errorCode', 'unavailable', 'acaoPendenteId', action_row.id);
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

-- Skill oficial interna. O conteúdo detalhado continua versionado nos
-- arquivos packages/intelligence/skills/tarefas.
insert into public.skill_definitions (
  id, owner_type, slug, name, description, audience, status, current_version, spec
) values (
  '20000000-0000-0000-0000-000000000006', 'platform', 'tarefas', 'Tarefas',
  'Consulta e cria tarefas internas com atribuição e confirmação.',
  'internal', 'published', 1,
  '{"objective":"Consultar e organizar tarefas internas","activation":{"keywords":["tarefa","tarefas","lembrete","pendência","pendencias","afazer","retornar para"]},"requiredFields":["title","due_at"],"questions":["Qual é o prazo da tarefa?"],"allowedTools":["task.read","task.prepare","task.confirm"],"guardrails":["explicit_confirmation","idempotency","operator_only"],"handoff":["tool_unavailable","permission_denied"]}'::jsonb
)
on conflict (slug) where owner_type = 'platform' do update set
  name = excluded.name,
  description = excluded.description,
  audience = excluded.audience,
  status = excluded.status,
  spec = excluded.spec,
  updated_at = now();

insert into public.assistant_profile_skills (
  organization_id, profile_id, skill_id, enabled, priority, updated_by
)
select profile.organization_id, profile.id,
  skill.id, true, 20,
  coalesce(profile.updated_by, profile.created_by)
from public.assistant_profiles profile
join public.skill_definitions skill
  on skill.owner_type = 'platform' and skill.slug = 'tarefas'
where profile.audience = 'internal'
on conflict (profile_id, skill_id) do update set enabled = true, updated_at = now();

revoke all on function public.nucleo_task_operator_action_prepare(text, text, text, jsonb, text) from public;
revoke all on function public.nucleo_task_operator_action_pending(text, text) from public;
revoke all on function public.nucleo_task_operator_action_confirm(text, uuid, boolean, text, text) from public;

grant execute on function public.nucleo_task_operator_action_prepare(text, text, text, jsonb, text) to authenticated;
grant execute on function public.nucleo_task_operator_action_pending(text, text) to authenticated;
grant execute on function public.nucleo_task_operator_action_confirm(text, uuid, boolean, text, text) to authenticated;

commit;
