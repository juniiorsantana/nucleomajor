-- FASE 14B: restaurar exclusivamente o corpo revisado da RPC.
-- Abrir este arquivo em editor de texto e copiar diretamente para o SQL Editor.
-- A transacao aborta se o corpo colado sofrer alteracao.
begin;
do $guard$
declare
  current_hash text;
begin
  select md5(replace(prosrc,chr(13),'')) into current_hash
  from pg_proc where oid=to_regprocedure(
    'public.nucleo_customer_agent_handoff(text,text,text,text,text)');
  if current_hash is null or current_hash not in (
    '92928c87614ffd2603e9ecea9e376e5f',
    'c5a77221e64b6be22720cc1800faf683'
  ) then
    raise exception 'unexpected agent handoff body; review before repair';
  end if;
end;
$guard$;

create or replace function public.nucleo_customer_agent_handoff(
  conversation_key_hash text,
  requester_phone text,
  target_agent_slug text,
  handoff_reason text,
  handoff_summary text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  target_agent public.assistant_profiles%rowtype;
  source_slug text;
  normalized_phone text := regexp_replace(coalesce(requester_phone, ''), '[^0-9]', '', 'g');
  max_handoffs constant integer := 3;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;

  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_agent_handoff.conversation_key_hash
    and context.state in ('active', 'handed_off') and context.audience = 'customer'
  order by case when context.state = 'handed_off' then 0 else 1 end
  limit 1 for update;
  if not found then raise exception 'customer intelligence context required'; end if;
  if context_row.state = 'handed_off' then
    raise exception 'conversation already handed off to human';
  end if;

  select * into target_agent from public.assistant_profiles profile
  where profile.organization_id = robot_org
    and profile.slug = target_agent_slug;
  if not found then raise exception 'target agent unavailable'; end if;
  if target_agent.audience <> context_row.audience then
    raise exception 'target agent audience mismatch';
  end if;
  if not target_agent.active then raise exception 'target agent inactive'; end if;
  if target_agent.id = context_row.assistant_profile_id then
    raise exception 'target agent is current agent';
  end if;
  if context_row.agent_handoff_count >= max_handoffs then
    raise exception 'agent handoff limit reached; use human handoff';
  end if;
  if handoff_reason is null or handoff_reason not in ('commercial_intent', 'specialist_required', 'scope_mismatch') then
    raise exception 'invalid agent handoff reason';
  end if;
  if length(normalized_phone) not between 10 and 15 then
    raise exception 'valid customer phone required';
  end if;
  if length(coalesce(handoff_summary, '')) > 1000 then
    raise exception 'agent handoff summary too long';
  end if;

  select profile.slug into source_slug from public.assistant_profiles profile
  where profile.id = context_row.assistant_profile_id and profile.organization_id = robot_org;

  update public.conversation_intelligence_contexts
  set assistant_profile_id = target_agent.id,
      active_skill_id = null,
      agent_handoff_count = agent_handoff_count + 1,
      updated_at = now()
  where id = context_row.id;

  update public.conversation_skill_sessions
  set status = 'handed_off', revision = revision + 1, updated_at = now()
  where context_id = context_row.id and organization_id = robot_org and status = 'active';

  insert into public.intelligence_audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata
  ) values (
    robot_org, auth.uid(), 'conversation', context_row.id, 'agent_handoff',
    jsonb_build_object('sourceAgentSlug', source_slug, 'targetAgentSlug', target_agent.slug,
      'reason', handoff_reason, 'handoffCount', context_row.agent_handoff_count + 1)
  );
  return jsonb_build_object(
    'status', 'agent_handoff_completed',
    'sourceAgentSlug', source_slug, 'targetAgentSlug', target_agent.slug,
    'reason', handoff_reason, 'handoffCount', context_row.agent_handoff_count + 1,
    'message', 'Transferência confirmada; o agente destino atenderá no próximo turno.'
  );
end;
$$;

do $verify$
begin
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc
      where oid=to_regprocedure(
        'public.nucleo_customer_agent_handoff(text,text,text,text,text)'))
      is distinct from 'c5a77221e64b6be22720cc1800faf683' then
    raise exception 'body changed during copy; transaction rolled back';
  end if;
end;
$verify$;
commit;

select md5(replace(prosrc,chr(13),'')) as hash_corpo,
  md5(replace(prosrc,chr(13),'')) =
    'c5a77221e64b6be22720cc1800faf683' as hash_confere
from pg_proc where oid=to_regprocedure(
  'public.nucleo_customer_agent_handoff(text,text,text,text,text)');
