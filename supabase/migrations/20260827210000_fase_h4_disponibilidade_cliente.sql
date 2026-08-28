begin;

-- Consulta estritamente booleana para o atendimento externo. O cliente nunca
-- recebe títulos, descrições, contatos, categorias ou participantes da agenda.
create or replace function public.nucleo_customer_calendar_availability(
  conversation_key_hash text,
  selected_agent uuid,
  range_start timestamptz,
  range_end timestamptz,
  expected_contract_version text
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
  has_conflict boolean := false;
begin
  if robot_org is null or robot_connection is null then
    raise exception 'active robot credential required';
  end if;
  if expected_contract_version <> 'fase-h-3' then
    raise exception 'runtime contract version is incompatible';
  end if;
  if conversation_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid conversation key';
  end if;
  if range_end <= range_start
    or range_end - range_start < interval '30 minutes'
    or range_end - range_start > interval '8 hours' then
    raise exception 'calendar interval is invalid';
  end if;
  if extract(second from range_start) <> 0
    or extract(second from range_end) <> 0
    or extract(minute from range_start)::integer not in (0, 30)
    or extract(minute from range_end)::integer not in (0, 30) then
    raise exception 'calendar interval must use 30-minute boundaries';
  end if;

  select * into context_row
  from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org
    and context.connection_id = robot_connection
    and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_calendar_availability.conversation_key_hash
    and context.audience = 'customer'
    and context.state = 'active'
  limit 1;
  if not found then
    raise exception 'active customer intelligence context required';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = robot_org
      and member.user_id = nucleo_customer_calendar_availability.selected_agent
      and member.status = 'active'
  ) then
    raise exception 'selected agent is not active';
  end if;

  select exists (
    select 1
    from public.calendar_events event
    where event.organization_id = robot_org
      and event.deleted_at is null
      and event.status in ('scheduled', 'tentative')
      and event.starts_at < nucleo_customer_calendar_availability.range_end
      and event.ends_at > nucleo_customer_calendar_availability.range_start
      and (
        event.owner_id = nucleo_customer_calendar_availability.selected_agent
        or exists (
          select 1
          from public.calendar_event_participants participant
          where participant.event_id = event.id
            and participant.participant_id = nucleo_customer_calendar_availability.selected_agent
        )
      )
  ) into has_conflict;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = robot_org
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object(
    'status', case when has_conflict then 'conflict' else 'available' end,
    'available', not has_conflict,
    'inicio', range_start,
    'fim', range_end,
    'responsavelId', selected_agent
  );
end;
$$;

revoke all on function public.nucleo_customer_calendar_availability(text, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.nucleo_customer_calendar_availability(text, uuid, timestamptz, timestamptz, text) to authenticated;

commit;
