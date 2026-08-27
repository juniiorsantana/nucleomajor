-- Fase H.4 — agenda externa com bloqueio provisório e aprovação humana.
--
-- A confirmação do cliente nunca cria um evento definitivo. Ela cria uma
-- reserva tentative, notifica donos/admins verificados e aguarda a primeira
-- decisão válida. Supabase é a autoridade para identidade, prazo, conflito,
-- atomicidade e idempotência.

begin;

alter table public.customer_pending_actions
  add column if not exists contact_id uuid,
  add column if not exists responsible_id uuid,
  add column if not exists approval_code text,
  add column if not exists team_expires_at timestamptz,
  add column if not exists decided_by uuid,
  add column if not exists decision text,
  add column if not exists decision_reason text,
  add column if not exists decided_at timestamptz;

update public.customer_pending_actions
set status = 'awaiting_customer_confirmation'
where status = 'awaiting_confirmation';

alter table public.customer_pending_actions
  drop constraint if exists customer_pending_actions_status_check;
alter table public.customer_pending_actions
  add constraint customer_pending_actions_status_check check (
    status in (
      'collecting', 'awaiting_customer_confirmation', 'awaiting_team_approval',
      'executing', 'completed', 'rejected', 'cancelled', 'expired', 'failed'
    )
  );

alter table public.customer_pending_actions
  drop constraint if exists customer_pending_actions_contact_fk;
alter table public.customer_pending_actions
  add constraint customer_pending_actions_contact_fk
  foreign key (contact_id, organization_id)
  references public.contacts(id, organization_id) on delete restrict;

alter table public.customer_pending_actions
  drop constraint if exists customer_pending_actions_responsible_fk;
alter table public.customer_pending_actions
  add constraint customer_pending_actions_responsible_fk
  foreign key (organization_id, responsible_id)
  references public.organization_members(organization_id, user_id) on delete restrict;

alter table public.customer_pending_actions
  drop constraint if exists customer_pending_actions_decided_by_fk;
alter table public.customer_pending_actions
  add constraint customer_pending_actions_decided_by_fk
  foreign key (organization_id, decided_by)
  references public.organization_members(organization_id, user_id) on delete restrict;

alter table public.customer_pending_actions
  drop constraint if exists customer_pending_actions_approval_code_check;
alter table public.customer_pending_actions
  add constraint customer_pending_actions_approval_code_check check (
    approval_code is null or approval_code ~ '^[A-F0-9]{4}-[A-F0-9]{4}$'
  );
alter table public.customer_pending_actions
  drop constraint if exists customer_pending_actions_decision_check;
alter table public.customer_pending_actions
  add constraint customer_pending_actions_decision_check check (
    decision is null or decision in ('approved', 'rejected', 'expired', 'cancelled', 'failed')
  );
alter table public.customer_pending_actions
  drop constraint if exists customer_pending_actions_decision_reason_check;
alter table public.customer_pending_actions
  add constraint customer_pending_actions_decision_reason_check check (
    decision_reason is null or length(decision_reason) <= 500
  );

drop index if exists public.customer_pending_actions_open_idx;
create index customer_pending_actions_open_idx
  on public.customer_pending_actions (organization_id, connection_id, context_id, created_at desc)
  where status in ('collecting', 'awaiting_customer_confirmation', 'awaiting_team_approval', 'failed');
create unique index if not exists customer_pending_actions_approval_code_idx
  on public.customer_pending_actions (organization_id, connection_id, approval_code)
  where approval_code is not null;
create index if not exists customer_pending_actions_team_expiry_idx
  on public.customer_pending_actions (organization_id, team_expires_at)
  where status = 'awaiting_team_approval';

create table if not exists public.customer_booking_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  action_id uuid not null references public.customer_pending_actions(id) on delete cascade,
  kind text not null check (kind in (
    'approval_requested', 'request_received', 'approved', 'rejected', 'expired', 'failed'
  )),
  recipient_user_id uuid,
  recipient_contact_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'sent', 'review', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  claimed_by_connection uuid,
  claim_expires_at timestamptz,
  error_code text,
  delivered_at timestamptz,
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade,
  foreign key (organization_id, recipient_user_id)
    references public.organization_members(organization_id, user_id) on delete cascade,
  foreign key (recipient_contact_id, organization_id)
    references public.contacts(id, organization_id) on delete cascade,
  check ((recipient_user_id is not null) <> (recipient_contact_id is not null))
);

create index if not exists customer_booking_notifications_pending_idx
  on public.customer_booking_notifications (organization_id, next_attempt_at, created_at)
  where status in ('pending', 'retry');
create index if not exists customer_booking_notifications_action_idx
  on public.customer_booking_notifications (organization_id, action_id, kind, status);

alter table public.customer_booking_notifications enable row level security;
revoke all on public.customer_booking_notifications from anon, authenticated;
grant select on public.customer_booking_notifications to authenticated;
drop policy if exists customer_booking_notifications_manage_read
  on public.customer_booking_notifications;
create policy customer_booking_notifications_manage_read
  on public.customer_booking_notifications for select to authenticated
  using (private.can_manage_org(organization_id));

drop trigger if exists customer_booking_notifications_touch
  on public.customer_booking_notifications;
create trigger customer_booking_notifications_touch
before update on public.customer_booking_notifications
for each row execute function private.touch_timestamp();

create or replace function private.h4_create_handoff(
  target_action public.customer_pending_actions,
  reason text,
  summary_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.customer_handoff_requests request
    where request.organization_id = target_action.organization_id
      and request.context_id = target_action.context_id
      and request.status in ('requested', 'accepted')
  ) then
    insert into public.customer_handoff_requests (
      organization_id, connection_id, contact_id, context_id,
      reason_code, summary, status
    ) values (
      target_action.organization_id, target_action.connection_id,
      target_action.contact_id, target_action.context_id,
      case when reason in ('requested_human', 'low_confidence', 'sensitive_topic',
        'commercial_exception', 'tool_unavailable', 'skill_limit') then reason
        else 'tool_unavailable' end,
      left(coalesce(summary_text, 'Solicitação de agenda requer atendimento humano.'), 1000),
      'requested'
    );
  end if;
end;
$$;

create or replace function private.h4_enqueue_booking_notification(
  target_action public.customer_pending_actions,
  notification_kind text,
  target_user uuid default null,
  target_contact uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_value text;
begin
  if (target_user is null) = (target_contact is null) then
    raise exception 'booking notification requires exactly one recipient';
  end if;
  key_value := encode(extensions.digest(
    concat_ws('|', target_action.id::text, notification_kind,
      coalesce(target_user::text, ''), coalesce(target_contact::text, '')),
    'sha256'), 'hex');
  insert into public.customer_booking_notifications (
    organization_id, connection_id, action_id, kind,
    recipient_user_id, recipient_contact_id, idempotency_key
  ) values (
    target_action.organization_id, target_action.connection_id, target_action.id,
    notification_kind, target_user, target_contact, key_value
  ) on conflict (organization_id, idempotency_key) do nothing;
end;
$$;

create or replace function private.h4_expire_booking_requests(target_organization uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_row public.customer_pending_actions%rowtype;
  expired_count integer := 0;
begin
  for action_row in
    select action.* from public.customer_pending_actions action
    where action.organization_id = target_organization
      and action.status = 'awaiting_team_approval'
      and coalesce(action.team_expires_at, action.expires_at) <= now()
    for update skip locked
  loop
    update public.calendar_events event
    set status = 'cancelled', reminder_minutes = '{}'::integer[],
        updated_by = action_row.responsible_id
    where event.id = action_row.event_id
      and event.organization_id = action_row.organization_id
      and event.status = 'tentative';

    update public.customer_pending_actions action
    set status = 'expired', decision = 'expired', decided_at = now(),
        completed_at = now(), updated_at = now(), last_error_code = 'team-approval-expired'
    where action.id = action_row.id;
    select refreshed.* into action_row
    from public.customer_pending_actions refreshed
    where refreshed.id = action_row.id;

    update public.customer_booking_notifications notification
    set status = 'cancelled', error_code = 'request-expired'
    where notification.action_id = action_row.id
      and notification.kind = 'approval_requested'
      and notification.status in ('pending', 'retry');

    if action_row.contact_id is not null then
      perform private.h4_enqueue_booking_notification(action_row, 'expired', null, action_row.contact_id);
    end if;
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

-- A proposta continua sendo persistida antes da confirmação do cliente.
create or replace function public.nucleo_customer_calendar_action_prepare(
  conversation_key_hash text,
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
  robot_org uuid := private.robot_organization();
  robot_connection uuid := private.robot_connection();
  context_row public.conversation_intelligence_contexts%rowtype;
  existing_action public.customer_pending_actions%rowtype;
  created_action public.customer_pending_actions%rowtype;
  payload_digest text;
  starts_at timestamptz;
  ends_at timestamptz;
  responsible uuid;
begin
  if robot_org is null or robot_connection is null then raise exception 'active robot credential required'; end if;
  if contract_version <> 'fase-h-3' then raise exception 'runtime contract version is incompatible'; end if;
  if conversation_key_hash !~ '^[0-9a-f]{64}$' or request_key !~ '^[0-9a-f]{64}$'
    or requester_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid pending action idempotency key'; end if;
  if jsonb_typeof(action_payload) <> 'object' then raise exception 'pending action payload must be an object'; end if;
  if length(trim(coalesce(action_payload ->> 'titulo', ''))) not between 1 and 240
    or nullif(action_payload ->> 'responsavelId', '') is null then raise exception 'booking payload is incomplete'; end if;
  begin
    starts_at := (action_payload ->> 'inicio')::timestamptz;
    ends_at := (action_payload ->> 'fim')::timestamptz;
    responsible := (action_payload ->> 'responsavelId')::uuid;
  exception when others then raise exception 'booking interval is invalid'; end;
  if ends_at <= starts_at or ends_at - starts_at < interval '30 minutes'
    or ends_at - starts_at > interval '8 hours' then raise exception 'booking interval is invalid'; end if;
  if starts_at < now() + interval '30 minutes' then
    return jsonb_build_object('status', 'handoff_required', 'errorCode', 'less_than_30_minutes',
      'message', 'Este horário precisa de atendimento humano por estar muito próximo.');
  end if;

  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.connection_id = robot_connection
    and context.channel = 'whatsapp' and context.conversation_key_hash = nucleo_customer_calendar_action_prepare.conversation_key_hash
    and context.audience = 'customer' and context.state = 'active' limit 1;
  if not found then raise exception 'active customer intelligence context required'; end if;
  if context_row.contact_id is null then raise exception 'customer contact is required'; end if;
  if not exists (select 1 from public.organization_members member
    where member.organization_id = robot_org and member.user_id = responsible
      and member.status = 'active') then raise exception 'selected agent is not active'; end if;

  payload_digest := encode(extensions.digest(action_payload::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(robot_connection::text || ':' || request_key, 0));
  select * into existing_action from public.customer_pending_actions action
  where action.organization_id = robot_org and action.connection_id = robot_connection
    and action.request_key = nucleo_customer_calendar_action_prepare.request_key;
  if found then
    if existing_action.payload_hash <> payload_digest then raise exception 'pending action key reused with different data'; end if;
    return jsonb_build_object('status', existing_action.status, 'acaoPendenteId', existing_action.id,
      'expiraEm', coalesce(existing_action.team_expires_at, existing_action.expires_at),
      'resumo', existing_action.payload);
  end if;

  update public.customer_pending_actions action
  set status = 'expired', decision = 'expired', decided_at = now(), updated_at = now()
  where action.organization_id = robot_org and action.connection_id = robot_connection
    and action.context_id = context_row.id
    and action.status in ('collecting', 'awaiting_customer_confirmation', 'failed');

  insert into public.customer_pending_actions (
    organization_id, connection_id, context_id, action_type, contract_version,
    request_key, requester_hash, payload_hash, payload, status, expires_at,
    contact_id, responsible_id
  ) values (
    robot_org, robot_connection, context_row.id, 'calendar_event', contract_version,
    request_key, requester_hash, payload_digest, action_payload,
    'awaiting_customer_confirmation', now() + interval '30 minutes',
    context_row.contact_id, responsible
  ) returning * into created_action;

  return jsonb_build_object('status', 'awaiting_customer_confirmation',
    'acaoPendenteId', created_action.id, 'expiraEm', created_action.expires_at,
    'resumo', created_action.payload,
    'message', 'Proposta preparada. Mostre o resumo e aguarde uma confirmação em outra mensagem.');
end;
$$;

create or replace function public.nucleo_customer_calendar_action_pending(
  conversation_key_hash text,
  expected_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  pending_action public.customer_pending_actions%rowtype;
begin
  if robot_org is null or expected_contract_version <> 'fase-h-3' then raise exception 'runtime unavailable'; end if;
  perform private.h4_expire_booking_requests(robot_org);
  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_calendar_action_pending.conversation_key_hash
    and context.audience = 'customer' and context.state = 'active' limit 1;
  if not found then return null; end if;
  update public.customer_pending_actions action
  set status = 'expired', decision = 'expired', decided_at = now(), updated_at = now()
  where action.organization_id = robot_org and action.context_id = context_row.id
    and action.status in ('collecting', 'awaiting_customer_confirmation', 'failed')
    and action.expires_at <= now();
  select * into pending_action from public.customer_pending_actions action
  where action.organization_id = robot_org and action.context_id = context_row.id
    and action.contract_version = expected_contract_version
    and action.status in ('awaiting_customer_confirmation', 'awaiting_team_approval', 'failed')
    and coalesce(action.team_expires_at, action.expires_at) > now()
  order by action.created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('status', pending_action.status, 'acaoPendenteId', pending_action.id,
    'requestId', pending_action.id, 'expiraEm', coalesce(pending_action.team_expires_at, pending_action.expires_at),
    'resumo', pending_action.payload);
end;
$$;

-- Confirmar como cliente cria apenas o bloqueio tentative e as entregas.
create or replace function public.nucleo_customer_calendar_action_confirm(
  conversation_key_hash text,
  pending_action uuid,
  requester_phone text,
  customer_confirmed boolean,
  confirmation_key text,
  expected_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  action_row public.customer_pending_actions%rowtype;
  category_id uuid;
  created_event uuid;
  starts_at timestamptz;
  ends_at timestamptz;
  hold_expires timestamptz;
  code_value text;
  approver record;
  approver_count integer := 0;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if customer_confirmed is not true then raise exception 'customer confirmation is required'; end if;
  if expected_contract_version <> 'fase-h-3' then raise exception 'runtime contract version is incompatible'; end if;
  if confirmation_key !~ '^[0-9a-f]{64}$' then raise exception 'invalid confirmation key'; end if;
  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_calendar_action_confirm.conversation_key_hash
    and context.audience = 'customer' and context.state = 'active' limit 1;
  if not found then raise exception 'active customer intelligence context required'; end if;
  select * into action_row from public.customer_pending_actions action
  where action.id = pending_action and action.organization_id = robot_org
    and action.context_id = context_row.id for update;
  if not found then return jsonb_build_object('status', 'not_found', 'errorCode', 'missing_confirmation'); end if;
  if action_row.requester_hash <> conversation_key_hash then raise exception 'pending action belongs to another requester'; end if;
  if confirmation_key = action_row.request_key then raise exception 'confirmation must arrive in a later customer turn'; end if;
  if action_row.status = 'awaiting_team_approval' then
    return jsonb_build_object('status', 'awaiting_team_approval', 'requestId', action_row.id,
      'acaoPendenteId', action_row.id, 'expiresAt', action_row.team_expires_at,
      'resumo', action_row.payload);
  end if;
  if action_row.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'requestId', action_row.id,
      'eventoId', action_row.event_id, 'alreadyDecided', true);
  end if;
  if action_row.expires_at <= now() or action_row.status = 'expired' then
    update public.customer_pending_actions set status = 'expired', decision = 'expired',
      decided_at = now(), updated_at = now() where id = action_row.id;
    return jsonb_build_object('status', 'expired', 'errorCode', 'missing_confirmation');
  end if;
  if action_row.status not in ('awaiting_customer_confirmation', 'failed') then
    return jsonb_build_object('status', 'unavailable', 'errorCode', 'unavailable');
  end if;

  starts_at := (action_row.payload ->> 'inicio')::timestamptz;
  ends_at := (action_row.payload ->> 'fim')::timestamptz;
  if starts_at < now() + interval '30 minutes' then
    perform private.h4_create_handoff(action_row, 'tool_unavailable',
      'Solicitação de agenda com menos de 30 minutos de antecedência.');
    update public.customer_pending_actions set status = 'failed', decision = 'failed',
      last_error_code = 'less-than-30-minutes', updated_at = now() where id = action_row.id;
    return jsonb_build_object('status', 'handoff_required', 'errorCode', 'less_than_30_minutes');
  end if;

  select count(*) into approver_count
  from public.organization_members member
  join public.whatsapp_connection_operators operator
    on operator.organization_id = member.organization_id
   and operator.user_id = member.user_id
   and operator.connection_id = action_row.connection_id
   and operator.status = 'active' and operator.verified_at is not null
  where member.organization_id = action_row.organization_id
    and member.status = 'active' and member.role in ('owner', 'admin');
  if approver_count = 0 then
    perform private.h4_create_handoff(action_row, 'tool_unavailable',
      'Não existe dono ou administrador com WhatsApp verificado para aprovar a solicitação.');
    update public.customer_pending_actions set status = 'failed', decision = 'failed',
      last_error_code = 'no-verified-approver', updated_at = now() where id = action_row.id;
    return jsonb_build_object('status', 'handoff_required', 'errorCode', 'no_verified_approver');
  end if;

  select category.id into category_id
  from public.calendar_categories category
  where category.organization_id = action_row.organization_id and category.active
  order by case when category.name = 'Reunião' then 0 else 1 end, category.position
  limit 1;
  if category_id is null then raise exception 'calendar category unavailable'; end if;

  hold_expires := least(now() + interval '2 hours', starts_at - interval '5 minutes');
  code_value := upper(
    substring(replace(action_row.id::text, '-', '') from 1 for 4)
    || '-' || substring(replace(action_row.id::text, '-', '') from 29 for 4)
  );

  update public.customer_pending_actions
  set status = 'executing', confirmation_key = nucleo_customer_calendar_action_confirm.confirmation_key,
      updated_at = now(), last_error_code = null
  where id = action_row.id;

  begin
    insert into public.calendar_events (
      organization_id, owner_id, title, description, starts_at, ends_at,
      all_day, kind, visibility, contact_id, status, category_id, location,
      tags, reminder_minutes, created_by, updated_by
    ) values (
      action_row.organization_id, action_row.responsible_id,
      'Reserva provisória — aguardando aprovação', '', starts_at, ends_at,
      false, 'appointment', 'organization', null, 'tentative', category_id, '',
      array['solicitacao-externa'], '{}'::integer[],
      action_row.responsible_id, action_row.responsible_id
    ) returning id into created_event;
  exception when exclusion_violation then
    update public.customer_pending_actions
    set status = 'awaiting_customer_confirmation', last_error_code = 'conflict', updated_at = now()
    where id = action_row.id;
    return jsonb_build_object('status', 'conflict', 'errorCode', 'conflict',
      'acaoPendenteId', action_row.id, 'message', 'O horário não está mais disponível.');
  end;

  update public.customer_pending_actions
  set status = 'awaiting_team_approval', event_id = created_event,
      approval_code = code_value, team_expires_at = hold_expires,
      expires_at = hold_expires, updated_at = now(), last_error_code = null
  where id = action_row.id
  returning * into action_row;

  for approver in
    select distinct member.user_id
    from public.organization_members member
    join public.whatsapp_connection_operators operator
      on operator.organization_id = member.organization_id
     and operator.user_id = member.user_id
     and operator.connection_id = action_row.connection_id
     and operator.status = 'active' and operator.verified_at is not null
    where member.organization_id = action_row.organization_id
      and member.status = 'active' and member.role in ('owner', 'admin')
  loop
    perform private.h4_enqueue_booking_notification(action_row, 'approval_requested', approver.user_id, null);
  end loop;
  perform private.h4_enqueue_booking_notification(action_row, 'request_received', null, action_row.contact_id);

  return jsonb_build_object(
    'status', 'awaiting_team_approval', 'requestId', action_row.id,
    'acaoPendenteId', action_row.id, 'expiresAt', action_row.team_expires_at,
    'expiraEm', action_row.team_expires_at, 'resumo', action_row.payload,
    'message', 'Solicitação recebida. O horário foi reservado provisoriamente e aguarda aprovação da equipe.'
  );
end;
$$;

create or replace function private.h4_decide_booking_request(
  target_action uuid,
  actor_user uuid,
  target_decision text,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_row public.customer_pending_actions%rowtype;
  safe_decision text := lower(trim(coalesce(target_decision, '')));
  safe_reason text := nullif(left(trim(coalesce(reason, '')), 500), '');
begin
  select * into action_row from public.customer_pending_actions action
  where action.id = target_action for update;
  if not found then return jsonb_build_object('status', 'not_found', 'errorCode', 'request_not_found'); end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = action_row.organization_id
      and member.user_id = actor_user and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) then raise exception 'owner or administrator approval required'; end if;
  if safe_decision not in ('approve', 'reject') then raise exception 'invalid booking decision'; end if;

  if action_row.status in ('completed', 'rejected', 'expired', 'cancelled') then
    return jsonb_build_object('status', action_row.status, 'requestId', action_row.id,
      'eventId', action_row.event_id, 'alreadyDecided', true,
      'message', case action_row.status when 'completed' then 'Esta solicitação já foi aprovada.'
        when 'rejected' then 'Esta solicitação já foi recusada.'
        else 'Esta solicitação já foi encerrada.' end);
  end if;
  if action_row.status <> 'awaiting_team_approval' then
    return jsonb_build_object('status', 'unavailable', 'errorCode', 'request_not_awaiting_approval');
  end if;
  if coalesce(action_row.team_expires_at, action_row.expires_at) <= now() then
    perform private.h4_expire_booking_requests(action_row.organization_id);
    return jsonb_build_object('status', 'expired', 'requestId', action_row.id,
      'message', 'A solicitação expirou antes da decisão.');
  end if;

  if safe_decision = 'approve' then
    update public.calendar_events event
    set status = 'scheduled',
        title = trim(action_row.payload ->> 'titulo'),
        description = left(trim(coalesce(action_row.payload ->> 'descricao', '')), 2000),
        location = left(trim(coalesce(action_row.payload ->> 'local', '')), 500),
        contact_id = action_row.contact_id,
        reminder_minutes = array[30],
        updated_by = actor_user
    where event.id = action_row.event_id
      and event.organization_id = action_row.organization_id
      and event.status = 'tentative';
    if not found then raise exception 'tentative booking is unavailable'; end if;

    update public.customer_pending_actions
    set status = 'completed', decision = 'approved', decided_by = actor_user,
        decision_reason = safe_reason, decided_at = now(), completed_at = now(),
        updated_at = now(), last_error_code = null
    where id = action_row.id returning * into action_row;
    perform private.h4_enqueue_booking_notification(action_row, 'approved', null, action_row.contact_id);
  else
    update public.calendar_events event
    set status = 'cancelled', reminder_minutes = '{}'::integer[], updated_by = actor_user
    where event.id = action_row.event_id
      and event.organization_id = action_row.organization_id
      and event.status = 'tentative';
    update public.customer_pending_actions
    set status = 'rejected', decision = 'rejected', decided_by = actor_user,
        decision_reason = safe_reason, decided_at = now(), completed_at = now(),
        updated_at = now(), last_error_code = null
    where id = action_row.id returning * into action_row;
    perform private.h4_enqueue_booking_notification(action_row, 'rejected', null, action_row.contact_id);
  end if;

  update public.customer_booking_notifications notification
  set status = 'cancelled', error_code = 'request-decided'
  where notification.action_id = action_row.id
    and notification.kind = 'approval_requested'
    and notification.status in ('pending', 'retry');

  return jsonb_build_object(
    'status', action_row.status, 'requestId', action_row.id,
    'eventId', action_row.event_id, 'alreadyDecided', false,
    'message', case when safe_decision = 'approve'
      then 'Solicitação aprovada. O cliente será avisado.'
      else 'Solicitação recusada. O cliente será avisado.' end
  );
end;
$$;

create or replace function public.nucleo_customer_calendar_request_decide(
  requester_phone text,
  request_code text,
  decision text,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid := private.robot_connection();
  operator_context record;
  action_id uuid;
  safe_code text := upper(trim(coalesce(request_code, '')));
begin
  if robot_org is null or robot_connection is null then raise exception 'active robot credential required'; end if;
  if safe_code !~ '^[A-F0-9]{4}-[A-F0-9]{4}$' then
    return jsonb_build_object('status', 'invalid', 'errorCode', 'invalid_request_code');
  end if;
  select * into operator_context from public.nucleo_operator_context(requester_phone) limit 1;
  if not found or operator_context.organization_id <> robot_org
    or operator_context.operator_role not in ('owner', 'admin') then
    raise exception 'owner or administrator approval required';
  end if;
  select action.id into action_id from public.customer_pending_actions action
  where action.organization_id = robot_org and action.connection_id = robot_connection
    and action.approval_code = safe_code
  order by action.created_at desc limit 1;
  if action_id is null then
    return jsonb_build_object('status', 'not_found', 'errorCode', 'request_not_found');
  end if;
  return private.h4_decide_booking_request(action_id, operator_context.user_id, decision, reason);
end;
$$;

create or replace function public.calendar_booking_requests_list(
  target_organization uuid,
  status_filter text default null,
  max_items integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.can_manage_org(target_organization) then raise exception 'organization management required'; end if;
  perform private.h4_expire_booking_requests(target_organization);
  max_items := greatest(1, least(coalesce(max_items, 100), 200));
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into result
  from (
    select action.id, action.status, action.approval_code as code,
      action.created_at, action.team_expires_at as expires_at,
      action.decided_at, action.decision_reason,
      action.event_id, action.responsible_id,
      coalesce(nullif(contact.name, ''), 'Cliente') as customer_name,
      right(regexp_replace(coalesce(contact.phone, ''), '[^0-9]', '', 'g'), 4) as customer_phone_last4,
      coalesce(nullif(profile.full_name, ''), 'Profissional') as responsible_name,
      action.payload ->> 'titulo' as subject,
      (action.payload ->> 'inicio')::timestamptz as starts_at,
      (action.payload ->> 'fim')::timestamptz as ends_at,
      decider.full_name as decided_by_name
    from public.customer_pending_actions action
    left join public.contacts contact on contact.id = action.contact_id
      and contact.organization_id = action.organization_id
    left join public.profiles profile on profile.id = action.responsible_id
    left join public.profiles decider on decider.id = action.decided_by
    where action.organization_id = target_organization
      and action.action_type = 'calendar_event'
      and (status_filter is null or status_filter = '' or action.status = status_filter)
    order by action.created_at desc limit max_items
  ) item;
  return result;
end;
$$;

create or replace function public.calendar_booking_request_decide(
  target_organization uuid,
  target_request uuid,
  decision text,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_org(target_organization) then raise exception 'organization management required'; end if;
  if not exists (select 1 from public.customer_pending_actions action
    where action.id = target_request and action.organization_id = target_organization) then
    return jsonb_build_object('status', 'not_found', 'errorCode', 'request_not_found');
  end if;
  return private.h4_decide_booking_request(target_request, auth.uid(), decision, reason);
end;
$$;

create or replace function public.notification_worker_claim_booking_notifications(max_items integer default 20)
returns table (
  notification_id uuid,
  recipient_phone text,
  notification_kind text,
  customer_name text,
  subject text,
  starts_at timestamptz,
  ends_at timestamptz,
  responsible_name text,
  expires_at timestamptz,
  request_code text,
  decision_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
  failed_action public.customer_pending_actions%rowtype;
begin
  if worker_org is null or worker_connection is null then
    raise exception 'notification worker credential is inactive';
  end if;
  perform private.h4_expire_booking_requests(worker_org);
  max_items := greatest(1, least(coalesce(max_items, 20), 50));

  update public.customer_booking_notifications notification
  set status = case when notification.attempt_count >= 3 then 'review' else 'retry' end,
      claimed_by_connection = null, claim_expires_at = null,
      error_code = case when notification.attempt_count >= 3 then 'lease-expired' else notification.error_code end
  where notification.organization_id = worker_org
    and notification.status = 'processing' and notification.claim_expires_at <= now();

  -- Um destinatário ausente não deve ficar eternamente em processing nem
  -- ser reivindicado em todos os ciclos. O item vai para revisão e o fluxo
  -- de aprovação tratará a ausência de todos os aprovadores entregáveis.
  update public.customer_booking_notifications notification
  set status = 'review', error_code = 'recipient-unavailable',
      claim_expires_at = null, updated_at = now()
  where notification.organization_id = worker_org
    and notification.connection_id = worker_connection
    and notification.status in ('pending', 'retry')
    and not exists (
      select 1
      from public.customer_pending_actions action
      left join public.contacts contact
        on contact.id = notification.recipient_contact_id
       and contact.organization_id = notification.organization_id
      left join public.whatsapp_connection_operators operator
        on operator.organization_id = notification.organization_id
       and operator.connection_id = notification.connection_id
       and operator.user_id = notification.recipient_user_id
       and operator.status = 'active' and operator.verified_at is not null
      where action.id = notification.action_id
        and length(regexp_replace(coalesce(
          case when notification.recipient_user_id is not null
            then operator.phone_e164 else contact.phone end,
          ''), '[^0-9]', '', 'g')) between 10 and 15
    );

  for failed_action in
    select action.*
    from public.customer_pending_actions action
    where action.organization_id = worker_org
      and action.connection_id = worker_connection
      and action.status = 'awaiting_team_approval'
      and exists (
        select 1 from public.customer_booking_notifications delivery
        where delivery.action_id = action.id and delivery.kind = 'approval_requested'
      )
      and not exists (
        select 1 from public.customer_booking_notifications delivery
        where delivery.action_id = action.id and delivery.kind = 'approval_requested'
          and delivery.status in ('pending', 'retry', 'processing', 'sent')
      )
    for update skip locked
  loop
    perform private.h4_create_handoff(failed_action, 'tool_unavailable',
      'Não existe um aprovador com entrega disponível para esta solicitação.');
    update public.calendar_events event
    set status = 'cancelled', reminder_minutes = '{}'::integer[],
        updated_by = failed_action.responsible_id
    where event.id = failed_action.event_id
      and event.organization_id = failed_action.organization_id
      and event.status = 'tentative';
    update public.customer_pending_actions action
    set status = 'failed', decision = 'failed', decided_at = now(),
        completed_at = now(), updated_at = now(),
        last_error_code = 'approver-unavailable'
    where action.id = failed_action.id
    returning * into failed_action;
    if failed_action.contact_id is not null then
      perform private.h4_enqueue_booking_notification(failed_action, 'failed', null, failed_action.contact_id);
    end if;
  end loop;

  return query
  with candidates as (
    select notification.id
    from public.customer_booking_notifications notification
    where notification.organization_id = worker_org
      and notification.connection_id = worker_connection
      and notification.status in ('pending', 'retry')
      and notification.attempt_count < 3
      and notification.next_attempt_at <= now()
    order by notification.created_at
    for update skip locked
    limit max_items
  ), claimed as (
    update public.customer_booking_notifications notification
    set status = 'processing', attempt_count = notification.attempt_count + 1,
        claimed_by_connection = worker_connection,
        claim_expires_at = now() + interval '5 minutes'
    from candidates
    where notification.id = candidates.id
    returning notification.*
  )
  select claimed.id,
    case when claimed.recipient_user_id is not null then operator.phone_e164 else contact.phone end,
    claimed.kind,
    coalesce(nullif(customer.name, ''), 'Cliente'),
    coalesce(nullif(action.payload ->> 'titulo', ''), 'Reunião'),
    (action.payload ->> 'inicio')::timestamptz,
    (action.payload ->> 'fim')::timestamptz,
    coalesce(nullif(responsible.full_name, ''), 'Profissional'),
    action.team_expires_at,
    action.approval_code,
    action.decision_reason
  from claimed
  join public.customer_pending_actions action on action.id = claimed.action_id
  left join public.contacts contact on contact.id = claimed.recipient_contact_id
    and contact.organization_id = claimed.organization_id
  left join public.contacts customer on customer.id = action.contact_id
    and customer.organization_id = action.organization_id
  left join public.whatsapp_connection_operators operator
    on operator.organization_id = claimed.organization_id
   and operator.connection_id = claimed.connection_id
   and operator.user_id = claimed.recipient_user_id
   and operator.status = 'active' and operator.verified_at is not null
  left join public.profiles responsible on responsible.id = action.responsible_id
  where length(regexp_replace(coalesce(
    case when claimed.recipient_user_id is not null then operator.phone_e164 else contact.phone end,
    ''), '[^0-9]', '', 'g')) between 10 and 15;
end;
$$;

create or replace function public.notification_worker_complete_booking_notification(
  notification_id uuid,
  result_status text,
  result_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_org uuid := private.notification_worker_organization();
  worker_connection uuid := private.notification_worker_connection();
  notification_row public.customer_booking_notifications%rowtype;
  action_row public.customer_pending_actions%rowtype;
begin
  if result_status not in ('sent', 'retry', 'review') then raise exception 'invalid booking notification result'; end if;
  update public.customer_booking_notifications notification
  set status = case
        when result_status = 'retry' and notification.attempt_count >= 3 then 'review'
        else result_status end,
      delivered_at = case when result_status = 'sent' then now() else notification.delivered_at end,
      next_attempt_at = case when result_status = 'retry' and notification.attempt_count < 3
        then now() + interval '1 minute' else notification.next_attempt_at end,
      error_code = left(result_error, 160), claim_expires_at = null
  where notification.id = notification_worker_complete_booking_notification.notification_id
    and notification.organization_id = worker_org
    and notification.claimed_by_connection = worker_connection
    and notification.status = 'processing'
  returning * into notification_row;
  if not found then raise exception 'booking notification claim not found'; end if;

  if notification_row.kind = 'approval_requested'
    and notification_row.status = 'review'
    and not exists (
      select 1 from public.customer_booking_notifications delivery
      where delivery.action_id = notification_row.action_id
        and delivery.kind = 'approval_requested'
        and delivery.status in ('pending', 'retry', 'processing', 'sent')
    ) then
    select * into action_row from public.customer_pending_actions
    where id = notification_row.action_id for update;
    if action_row.status = 'awaiting_team_approval' then
      perform private.h4_create_handoff(action_row, 'tool_unavailable',
        'Não foi possível entregar a solicitação de agenda aos aprovadores.');
      update public.calendar_events event
      set status = 'cancelled', reminder_minutes = '{}'::integer[],
          updated_by = action_row.responsible_id
      where event.id = action_row.event_id
        and event.organization_id = action_row.organization_id
        and event.status = 'tentative';
      update public.customer_pending_actions action
      set status = 'failed', decision = 'failed', decided_at = now(),
          completed_at = now(), updated_at = now(),
          last_error_code = 'approver-delivery-failed'
      where action.id = action_row.id
      returning * into action_row;
      if action_row.contact_id is not null then
        perform private.h4_enqueue_booking_notification(action_row, 'failed', null, action_row.contact_id);
      end if;
    end if;
  end if;

  update public.connection_notification_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid() and organization_id = worker_org and status = 'active';
end;
$$;

-- Migra os vínculos: agenda é interna; clientes recebem solicitacao-agenda.
-- Mantém futuras alterações do modo Piloto alinhadas à nova skill externa.
create or replace function public.customer_assistant_rollout_update(
  target_profile uuid,
  rollout_mode text,
  selected_contacts uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.assistant_profiles%rowtype;
  safe_mode text := lower(trim(coalesce(rollout_mode, '')));
  requested_count integer;
  inserted_count integer;
  pilot_campaign uuid;
  skill_row record;
begin
  if safe_mode not in ('off', 'pilot', 'active') then raise exception 'customer assistant rollout mode is invalid'; end if;
  select profile.* into profile_row from public.assistant_profiles profile
  where profile.id = target_profile and profile.audience = 'customer' for update;
  if not found or not private.can_manage_org(profile_row.organization_id) then
    raise exception 'customer assistant management required';
  end if;
  select count(distinct contact_id) into requested_count
  from unnest(coalesce(selected_contacts, '{}'::uuid[])) contact_id;
  if safe_mode = 'pilot' and requested_count = 0 then raise exception 'select at least one contact for pilot mode'; end if;

  delete from public.customer_assistant_pilot_contacts pilot
  where pilot.organization_id = profile_row.organization_id and pilot.profile_id = profile_row.id;
  insert into public.customer_assistant_pilot_contacts (
    organization_id, profile_id, contact_id, added_by
  )
  select profile_row.organization_id, profile_row.id, contact.id, auth.uid()
  from public.contacts contact
  join (select distinct value as id from unnest(coalesce(selected_contacts, '{}'::uuid[])) value) chosen
    on chosen.id = contact.id
  where contact.organization_id = profile_row.organization_id and contact.deleted_at is null;
  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then raise exception 'one or more pilot contacts are invalid'; end if;

  update public.assistant_profiles profile
  set process_config = jsonb_set(coalesce(profile.process_config, '{}'::jsonb), '{rollout}',
        jsonb_build_object('mode', safe_mode, 'updatedAt', now()), true),
      updated_by = auth.uid(), updated_at = now()
  where profile.id = profile_row.id;

  if safe_mode = 'pilot' then
    select campaign.id into pilot_campaign from public.organization_campaigns campaign
    where campaign.organization_id = profile_row.organization_id
      and campaign.name = 'Piloto Atendimento Major'
    order by campaign.created_at limit 1;
    if pilot_campaign is null then
      insert into public.organization_campaigns (
        organization_id, assistant_profile_id, name, status, objective,
        offer, audience_description, desired_outcome, is_default,
        configuration, created_by, updated_by
      ) values (
        profile_row.organization_id, profile_row.id, 'Piloto Atendimento Major', 'test',
        'Validar recepção, qualificação, vendas, suporte, solicitação de agenda e transferência humana.',
        '', 'Contatos selecionados para o piloto controlado.',
        'Qualificar, solicitar horário ou transferir com segurança.', false,
        jsonb_build_object('rollout', 'pilot', 'managedBy', 'nucleo-major'),
        auth.uid(), auth.uid()
      ) returning id into pilot_campaign;
    else
      update public.organization_campaigns campaign
      set assistant_profile_id = profile_row.id, status = 'test',
          objective = 'Validar recepção, qualificação, vendas, suporte, solicitação de agenda e transferência humana.',
          configuration = coalesce(campaign.configuration, '{}'::jsonb)
            || jsonb_build_object('rollout', 'pilot', 'managedBy', 'nucleo-major'),
          updated_by = auth.uid(), updated_at = now()
      where campaign.id = pilot_campaign;
    end if;

    delete from public.assistant_profile_skills binding
    using public.skill_definitions skill
    where binding.profile_id = profile_row.id and binding.skill_id = skill.id
      and skill.owner_type = 'platform' and skill.slug = 'agenda';
    delete from public.campaign_skills binding
    using public.skill_definitions skill
    where binding.campaign_id = pilot_campaign and binding.skill_id = skill.id
      and skill.owner_type = 'platform' and skill.slug = 'agenda';

    for skill_row in
      select skill.id, skill.slug,
        case skill.slug when 'recepcao' then 10 when 'pre-qualificacao' then 20
          when 'vendas' then 30 when 'suporte' then 40 else 50 end as priority
      from public.skill_definitions skill
      where skill.owner_type = 'platform' and skill.status = 'published'
        and skill.slug in ('recepcao', 'pre-qualificacao', 'vendas', 'suporte', 'solicitacao-agenda')
    loop
      insert into public.assistant_profile_skills (
        organization_id, profile_id, skill_id, enabled, priority, updated_by
      ) values (
        profile_row.organization_id, profile_row.id, skill_row.id, true,
        skill_row.priority, auth.uid()
      ) on conflict (profile_id, skill_id) do update
        set enabled = true, priority = excluded.priority, updated_by = auth.uid(), updated_at = now();
      insert into public.campaign_skills (organization_id, campaign_id, skill_id, priority)
      values (profile_row.organization_id, pilot_campaign, skill_row.id, skill_row.priority)
      on conflict (campaign_id, skill_id) do update set priority = excluded.priority;
    end loop;
    if (select count(*) from public.campaign_skills binding
      join public.skill_definitions skill on skill.id = binding.skill_id
      where binding.campaign_id = pilot_campaign
        and skill.slug in ('recepcao', 'pre-qualificacao', 'vendas', 'suporte', 'solicitacao-agenda')) <> 5 then
      raise exception 'publish the five official customer skills before enabling the pilot';
    end if;

    insert into public.campaign_knowledge_collections (organization_id, campaign_id, collection_id)
    select collection.organization_id, pilot_campaign, collection.id
    from public.knowledge_collections collection
    where collection.organization_id = profile_row.organization_id
      and collection.audience = 'external' and collection.scope_type <> 'personal'
    on conflict (campaign_id, collection_id) do nothing;
  end if;
  return jsonb_build_object('status', 'updated', 'mode', safe_mode,
    'pilotContacts', inserted_count, 'campaignId', pilot_campaign);
end;
$$;

create or replace function public.intelligence_scheduling_bindings_sync(target_organization uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  agenda_skill uuid;
  request_skill uuid;
  changed_profiles integer := 0;
  changed_campaigns integer := 0;
begin
  if auth.role() <> 'service_role'
    and (target_organization is null or not private.can_manage_org(target_organization)) then
    raise exception 'platform or organization management required';
  end if;
  select skill.id into agenda_skill from public.skill_definitions skill
  where skill.owner_type = 'platform' and skill.slug = 'agenda' limit 1;
  select skill.id into request_skill from public.skill_definitions skill
  where skill.owner_type = 'platform' and skill.slug = 'solicitacao-agenda'
    and skill.status = 'published' limit 1;

  if agenda_skill is not null then
    delete from public.assistant_profile_skills binding
    using public.assistant_profiles profile
    where binding.profile_id = profile.id and binding.skill_id = agenda_skill
      and profile.audience = 'customer'
      and (target_organization is null or profile.organization_id = target_organization);
    delete from public.campaign_skills binding
    using public.organization_campaigns campaign
    where binding.campaign_id = campaign.id and binding.skill_id = agenda_skill
      and (target_organization is null or campaign.organization_id = target_organization);
  end if;

  if request_skill is not null then
    insert into public.assistant_profile_skills (
      organization_id, profile_id, skill_id, enabled, priority, updated_by
    )
    select profile.organization_id, profile.id, request_skill, true, 50, profile.updated_by
    from public.assistant_profiles profile
    where profile.audience = 'customer' and profile.active
      and (target_organization is null or profile.organization_id = target_organization)
    on conflict (profile_id, skill_id) do update
      set enabled = true, priority = excluded.priority, updated_at = now();
    get diagnostics changed_profiles = row_count;

    insert into public.campaign_skills (organization_id, campaign_id, skill_id, priority)
    select campaign.organization_id, campaign.id, request_skill, 50
    from public.organization_campaigns campaign
    where campaign.status in ('test', 'active')
      and (target_organization is null or campaign.organization_id = target_organization)
    on conflict (campaign_id, skill_id) do update set priority = excluded.priority;
    get diagnostics changed_campaigns = row_count;
  end if;
  return jsonb_build_object('requestSkillPublished', request_skill is not null,
    'profiles', changed_profiles, 'campaigns', changed_campaigns);
end;
$$;

revoke all on function private.h4_create_handoff(public.customer_pending_actions, text, text) from public;
revoke all on function private.h4_enqueue_booking_notification(public.customer_pending_actions, text, uuid, uuid) from public;
revoke all on function private.h4_expire_booking_requests(uuid) from public;
revoke all on function private.h4_decide_booking_request(uuid, uuid, text, text) from public;

revoke all on function public.nucleo_customer_calendar_action_prepare(text, text, text, jsonb, text) from public;
revoke all on function public.nucleo_customer_calendar_action_pending(text, text) from public;
revoke all on function public.nucleo_customer_calendar_action_confirm(text, uuid, text, boolean, text, text) from public;
revoke all on function public.nucleo_customer_calendar_request_decide(text, text, text, text) from public;
revoke all on function public.calendar_booking_requests_list(uuid, text, integer) from public;
revoke all on function public.calendar_booking_request_decide(uuid, uuid, text, text) from public;
revoke all on function public.notification_worker_claim_booking_notifications(integer) from public;
revoke all on function public.notification_worker_complete_booking_notification(uuid, text, text) from public;
revoke all on function public.intelligence_scheduling_bindings_sync(uuid) from public;

grant execute on function public.nucleo_customer_calendar_action_prepare(text, text, text, jsonb, text) to authenticated;
grant execute on function public.nucleo_customer_calendar_action_pending(text, text) to authenticated;
grant execute on function public.nucleo_customer_calendar_action_confirm(text, uuid, text, boolean, text, text) to authenticated;
grant execute on function public.nucleo_customer_calendar_request_decide(text, text, text, text) to authenticated;
grant execute on function public.calendar_booking_requests_list(uuid, text, integer) to authenticated;
grant execute on function public.calendar_booking_request_decide(uuid, uuid, text, text) to authenticated;
grant execute on function public.notification_worker_claim_booking_notifications(integer) to authenticated;
grant execute on function public.notification_worker_complete_booking_notification(uuid, text, text) to authenticated;
grant execute on function public.intelligence_scheduling_bindings_sync(uuid) to authenticated, service_role;

commit;
