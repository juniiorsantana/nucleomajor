begin;

-- Fase H.3 - revisão 3: estado determinístico de skills, confirmações de clientes e
-- continuação de chatbots. A H.2 permanece disponível durante o rollout.

create table if not exists public.conversation_skill_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  context_id uuid not null,
  primary_skill_id uuid references public.skill_definitions(id) on delete set null,
  active_skill_id uuid references public.skill_definitions(id) on delete set null,
  stage text not null default 'acolher' check (stage ~ '^[a-z][a-z0-9_]{1,63}$'),
  stack jsonb not null default '[]'::jsonb check (jsonb_typeof(stack) = 'array' and octet_length(stack::text) <= 16384),
  slots jsonb not null default '{}'::jsonb check (jsonb_typeof(slots) = 'object' and octet_length(slots::text) <= 32768),
  status text not null default 'active' check (status in ('active', 'completed', 'expired', 'handed_off')),
  revision bigint not null default 1 check (revision > 0),
  context_expires_at timestamptz not null default (now() + interval '24 hours'),
  subflow_expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (context_id),
  unique (id, organization_id),
  foreign key (context_id, organization_id)
    references public.conversation_intelligence_contexts(id, organization_id) on delete cascade
);

create index if not exists conversation_skill_sessions_active_idx
  on public.conversation_skill_sessions (organization_id, updated_at desc)
  where status = 'active';

create table if not exists public.customer_pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  context_id uuid not null,
  action_type text not null check (action_type in ('calendar_event')),
  contract_version text not null check (contract_version = 'fase-h-3'),
  request_key text not null check (request_key ~ '^[0-9a-f]{64}$'),
  requester_hash text not null check (requester_hash ~ '^[0-9a-f]{64}$'),
  confirmation_key text check (confirmation_key is null or confirmation_key ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  status text not null default 'awaiting_confirmation'
    check (status in ('collecting', 'awaiting_confirmation', 'executing', 'completed', 'failed', 'cancelled', 'expired')),
  event_id uuid references public.calendar_events(id) on delete set null,
  last_error_code text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, connection_id, request_key),
  unique (organization_id, connection_id, confirmation_key),
  foreign key (context_id, organization_id)
    references public.conversation_intelligence_contexts(id, organization_id) on delete cascade
);

create index if not exists customer_pending_actions_open_idx
  on public.customer_pending_actions (organization_id, connection_id, context_id, created_at desc)
  where status in ('collecting', 'awaiting_confirmation', 'failed');

create table if not exists public.chatbot_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  conversation_key_hash text not null check (conversation_key_hash ~ '^[0-9a-f]{64}$'),
  chatbot_id uuid not null,
  chatbot_version integer not null check (chatbot_version > 0),
  current_node_id text not null default '' check (length(current_node_id) <= 160),
  owner text not null default 'bot' check (owner in ('bot', 'ia', 'humano')),
  revision bigint not null default 1 check (revision > 0),
  status text not null default 'active' check (status in ('active', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, connection_id, conversation_key_hash),
  unique (id, organization_id),
  foreign key (chatbot_id, organization_id)
    references public.chatbot_definitions(id, organization_id) on delete cascade
);

create table if not exists public.chatbot_ai_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_session_id uuid not null,
  intelligence_context_id uuid,
  transfer_node_id text not null check (length(transfer_node_id) between 1 and 160),
  target_mode text not null check (target_mode in ('reception', 'skill', 'campaign')),
  target_skill_id uuid references public.skill_definitions(id) on delete set null,
  target_campaign_id uuid,
  return_node_id text check (return_node_id is null or length(return_node_id) <= 160),
  failure_node_id text check (failure_node_id is null or length(failure_node_id) <= 160),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'returned', 'failed', 'cancelled')),
  result_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (flow_session_id, organization_id)
    references public.chatbot_flow_sessions(id, organization_id) on delete cascade,
  foreign key (intelligence_context_id, organization_id)
    references public.conversation_intelligence_contexts(id, organization_id) on delete set null,
  foreign key (target_campaign_id, organization_id)
    references public.organization_campaigns(id, organization_id) on delete set null
);

alter table public.conversation_skill_sessions enable row level security;
alter table public.customer_pending_actions enable row level security;
alter table public.chatbot_flow_sessions enable row level security;
alter table public.chatbot_ai_handoffs enable row level security;

revoke all on public.conversation_skill_sessions, public.customer_pending_actions,
  public.chatbot_flow_sessions, public.chatbot_ai_handoffs from anon, authenticated;
grant select on public.conversation_skill_sessions, public.customer_pending_actions,
  public.chatbot_flow_sessions, public.chatbot_ai_handoffs to authenticated;

drop policy if exists conversation_skill_sessions_manage_read on public.conversation_skill_sessions;
create policy conversation_skill_sessions_manage_read on public.conversation_skill_sessions
  for select to authenticated using (private.can_manage_org(organization_id));
drop policy if exists customer_pending_actions_manage_read on public.customer_pending_actions;
create policy customer_pending_actions_manage_read on public.customer_pending_actions
  for select to authenticated using (private.can_manage_org(organization_id));
drop policy if exists chatbot_flow_sessions_manage_read on public.chatbot_flow_sessions;
create policy chatbot_flow_sessions_manage_read on public.chatbot_flow_sessions
  for select to authenticated using (private.can_manage_org(organization_id));
drop policy if exists chatbot_ai_handoffs_manage_read on public.chatbot_ai_handoffs;
create policy chatbot_ai_handoffs_manage_read on public.chatbot_ai_handoffs
  for select to authenticated using (private.can_manage_org(organization_id));

-- Remove somente definições H.3 eventualmente deixadas por uma execução
-- interrompida. As tabelas e os dados existentes permanecem intactos.
drop function if exists public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb);
drop function if exists private.intelligence_normalize_v3(text);

create function private.intelligence_normalize_v3(input_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select translate(
    lower(coalesce(input_value, ''::text)),
    'áàâãäéèêëíìîïóòôõöúùûüç'::text,
    'aaaaaeeeeiiiiooooouuuuc'::text
  );
$function$;

create or replace function public.nucleo_intelligence_context_resolve_v3(
  conversation_key_hash text,
  requester_phone text default '',
  incoming_text text default '',
  source_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  base_payload jsonb;
  context_row public.conversation_intelligence_contexts%rowtype;
  session_row public.conversation_skill_sessions%rowtype;
  selected_skill public.skill_definitions%rowtype;
  reception_skill public.skill_definitions%rowtype;
  selected_campaign public.organization_campaigns%rowtype;
  active_stage jsonb;
  normalized_message text := private.intelligence_normalize_v3(left(coalesce(incoming_text, ''), 2000));
  context_hours integer := 24;
  subflow_hours integer := 2;
  confirmation_minutes integer := 30;
  selected_stage text := 'acolher';
  skill_spec jsonb;
  instructions text;
  content_hash text;
  allowed_tools jsonb := '[]'::jsonb;
  stack_payload jsonb := '[]'::jsonb;
  campaign_payload jsonb;
  pending_exists boolean := false;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if conversation_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid conversation context key'; end if;

  base_payload := public.nucleo_intelligence_context_resolve_v2(
    conversation_key_hash, requester_phone, left(coalesce(incoming_text, ''), 2000), coalesce(source_data, '{}'::jsonb)
  );
  campaign_payload := base_payload -> 'campanha';
  -- A Fase H.3 é externa primeiro. O assistente de profissionais continua no
  -- contrato H.2, com todas as permissões já validadas.
  if base_payload ->> 'audiencia' <> 'customer' then return base_payload; end if;

  select * into context_row from public.conversation_intelligence_contexts context
  where context.id = (base_payload ->> 'contextoId')::uuid
    and context.organization_id = robot_org and context.state = 'active'
  limit 1 for update;
  if not found then raise exception 'active customer intelligence context required'; end if;

  select
    least(greatest(case when profile.process_config #>> '{sessionPolicy,contextHours}' ~ '^[0-9]+$'
      then (profile.process_config #>> '{sessionPolicy,contextHours}')::integer else 24 end, 1), 168),
    least(greatest(case when profile.process_config #>> '{sessionPolicy,subflowHours}' ~ '^[0-9]+$'
      then (profile.process_config #>> '{sessionPolicy,subflowHours}')::integer else 2 end, 1), 24),
    least(greatest(case when profile.process_config #>> '{sessionPolicy,confirmationMinutes}' ~ '^[0-9]+$'
      then (profile.process_config #>> '{sessionPolicy,confirmationMinutes}')::integer else 30 end, 5), 120)
  into context_hours, subflow_hours, confirmation_minutes
  from public.assistant_profiles profile where profile.id = context_row.assistant_profile_id;

  select * into session_row from public.conversation_skill_sessions skill_session
  where skill_session.context_id = context_row.id and skill_session.organization_id = robot_org
  limit 1 for update;
  if found and (session_row.context_expires_at <= now() or session_row.status <> 'active') then
    update public.conversation_skill_sessions set status = 'expired', updated_at = now(), revision = revision + 1
    where id = session_row.id;
    session_row := null;
  end if;

  select skill.* into reception_skill
  from public.assistant_profile_skills binding
  join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
  where binding.organization_id = robot_org and binding.profile_id = context_row.assistant_profile_id
    and binding.enabled and skill.audience in ('customer', 'both')
    and coalesce((skill.spec #>> '{routing,fallback}')::boolean, false)
  order by binding.priority, skill.name limit 1;
  if reception_skill.id is null then
    raise exception 'published reception skill is required for customer routing';
  end if;

  update public.customer_pending_actions action set status = 'expired', updated_at = now()
  where action.organization_id = robot_org and action.context_id = context_row.id
    and action.status in ('collecting', 'awaiting_confirmation', 'failed') and action.expires_at <= now();
  select exists(select 1 from public.customer_pending_actions action
    where action.organization_id = robot_org and action.context_id = context_row.id
      and action.status in ('awaiting_confirmation', 'failed') and action.expires_at > now())
  into pending_exists;

  -- 1. Uma ação aguardando confirmação sempre vence o roteamento.
  if pending_exists then
    select skill.* into selected_skill
    from public.assistant_profile_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    where binding.organization_id = robot_org and binding.profile_id = context_row.assistant_profile_id
      and binding.enabled and skill.slug = 'agenda' limit 1;
    selected_stage := 'confirmar';
  else
    -- Um alvo vindo do chatbot é aceito somente depois de ser validado contra
    -- o perfil e a organização derivados da credencial. IDs do modelo nunca
    -- chegam a este parâmetro.
    if source_data ->> 'targetMode' = 'reception' then
      selected_skill := reception_skill;
    elsif source_data ->> 'targetMode' = 'skill'
      and coalesce(source_data ->> 'targetSkillId', '') ~ '^[0-9a-fA-F-]{36}$' then
      select skill.* into selected_skill
      from public.assistant_profile_skills binding
      join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
      where binding.organization_id = robot_org and binding.profile_id = context_row.assistant_profile_id
        and binding.enabled and skill.id = (source_data ->> 'targetSkillId')::uuid
        and skill.audience in ('customer', 'both') limit 1;
    elsif source_data ->> 'targetMode' = 'campaign'
      and coalesce(source_data ->> 'targetCampaignId', '') ~ '^[0-9a-fA-F-]{36}$' then
      select * into selected_campaign from public.organization_campaigns campaign
      where campaign.id = (source_data ->> 'targetCampaignId')::uuid
        and campaign.organization_id = robot_org and campaign.status in ('test', 'active')
        and (campaign.starts_at is null or campaign.starts_at <= now())
        and (campaign.ends_at is null or campaign.ends_at > now()) limit 1;
      if selected_campaign.id is not null then
        campaign_payload := jsonb_build_object(
          'id', selected_campaign.id, 'nome', selected_campaign.name,
          'objetivo', selected_campaign.objective, 'oferta', selected_campaign.offer,
          'publico', selected_campaign.audience_description,
          'resultadoEsperado', selected_campaign.desired_outcome,
          'configuracao', selected_campaign.configuration
        );
        update public.conversation_intelligence_contexts context set campaign_id = selected_campaign.id
        where context.id = context_row.id;
        context_row.campaign_id := selected_campaign.id;
        select skill.* into selected_skill
        from public.campaign_skills campaign_binding
        join public.assistant_profile_skills profile_binding
          on profile_binding.organization_id = campaign_binding.organization_id
         and profile_binding.profile_id = context_row.assistant_profile_id
         and profile_binding.skill_id = campaign_binding.skill_id and profile_binding.enabled
        join public.skill_definitions skill on skill.id = campaign_binding.skill_id and skill.status = 'published'
        where campaign_binding.organization_id = robot_org and campaign_binding.campaign_id = selected_campaign.id
          and skill.audience in ('customer', 'both')
        order by campaign_binding.priority, skill.name limit 1;
      end if;
    end if;

    -- 2. Uma intenção explícita nova pode trocar o subfluxo. Negativas bloqueiam
    -- falsos positivos; fallback nunca participa desta busca.
    if selected_skill.id is null then select skill.* into selected_skill
    from public.assistant_profile_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    cross join lateral (
      select count(*)::integer as score
      from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,keywords}', '[]'::jsonb)) keyword
      where position(private.intelligence_normalize_v3(keyword) in normalized_message) > 0
    ) matches
    where binding.organization_id = robot_org and binding.profile_id = context_row.assistant_profile_id
      and binding.enabled and skill.audience in ('customer', 'both')
      and not coalesce((skill.spec #>> '{routing,fallback}')::boolean, false)
      and matches.score > 0
      and not exists (
        select 1 from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,negativeKeywords}', '[]'::jsonb)) negative
        where private.intelligence_normalize_v3(negative) <> ''
          and position(private.intelligence_normalize_v3(negative) in normalized_message) > 0
      )
      and (
        context_row.campaign_id is null
        or not exists (select 1 from public.campaign_skills any_binding where any_binding.campaign_id = context_row.campaign_id)
        or exists (select 1 from public.campaign_skills campaign_binding
          where campaign_binding.organization_id = robot_org and campaign_binding.campaign_id = context_row.campaign_id
            and campaign_binding.skill_id = skill.id)
      )
    order by matches.score desc,
      case when skill.spec #>> '{routing,priority}' ~ '^[0-9]+$' then (skill.spec #>> '{routing,priority}')::integer else binding.priority end,
      binding.priority, skill.name limit 1; end if;

    -- 3. Sem intenção nova, a resposta esperada continua no subfluxo por até
    -- duas horas. Depois disso a Recepção volta a ser a porta de entrada.
    if selected_skill.id is null and session_row.id is not null
      and session_row.active_skill_id is not null
      and session_row.active_skill_id <> reception_skill.id
      and session_row.subflow_expires_at > now() then
      select * into selected_skill from public.skill_definitions skill
      where skill.id = session_row.active_skill_id and skill.status = 'published';
      selected_stage := session_row.stage;
    end if;
    if selected_skill.id is null then selected_skill := reception_skill; end if;
  end if;

  skill_spec := selected_skill.spec;
  if selected_stage = 'acolher' or session_row.active_skill_id is distinct from selected_skill.id then
    selected_stage := coalesce(nullif(skill_spec #>> '{workflow,initialStage}', ''), 'acolher');
  end if;
  if pending_exists then selected_stage := 'confirmar'; end if;
  select stage into active_stage
  from jsonb_array_elements(coalesce(skill_spec #> '{workflow,stages}', '[]'::jsonb)) stage
  where stage ->> 'id' = selected_stage limit 1;
  allowed_tools := coalesce(active_stage -> 'allowedTools', skill_spec -> 'allowedTools', '[]'::jsonb);
  if jsonb_typeof(allowed_tools) <> 'array' then raise exception 'published skill tools are invalid'; end if;
  if exists (select 1 from jsonb_array_elements_text(allowed_tools) tool where tool not in (
    'knowledge.search', 'crm.contact.read', 'crm.contact.upsert', 'crm.tag.apply', 'crm.deal.qualify',
    'conversation.handoff', 'calendar.read', 'calendar.availability', 'calendar.prepare', 'calendar.confirm'
  )) then raise exception 'published skill contains an unsupported tool'; end if;

  instructions := nullif(trim(skill_spec ->> 'instructionsMarkdown'), '');
  if instructions is null or length(instructions) < 80 or length(instructions) > 20000 then
    raise exception 'published skill instructions are invalid';
  end if;
  content_hash := coalesce(nullif(skill_spec #>> '{source,contentHash}', ''),
    encode(extensions.digest(skill_spec::text, 'sha256'), 'hex'));
  if selected_skill.id <> reception_skill.id then
    stack_payload := jsonb_build_array(jsonb_build_object(
      'skillId', reception_skill.id, 'skillSlug', reception_skill.slug, 'returnStage', 'entender'
    ));
  end if;

  update public.conversation_intelligence_contexts context
  set active_skill_id = selected_skill.id, context_version = 'fase-h-3', last_message_at = now(), updated_at = now()
  where context.id = context_row.id;

  insert into public.conversation_skill_sessions as current_session (
    organization_id, context_id, primary_skill_id, active_skill_id, stage, stack, status,
    context_expires_at, subflow_expires_at
  ) values (
    robot_org, context_row.id, reception_skill.id, selected_skill.id, selected_stage, stack_payload, 'active',
    now() + make_interval(hours => context_hours), now() + make_interval(hours => subflow_hours)
  ) on conflict (context_id) do update set
    primary_skill_id = excluded.primary_skill_id, active_skill_id = excluded.active_skill_id,
    stage = excluded.stage, stack = excluded.stack, status = 'active', revision = current_session.revision + 1,
    context_expires_at = excluded.context_expires_at, subflow_expires_at = excluded.subflow_expires_at, updated_at = now()
  returning * into session_row;

  return (base_payload - 'skillAtivo' - 'campanha' - 'schemaVersion' - 'runtimeContext') || jsonb_build_object(
    'schemaVersion', 'fase-h-3',
    'campanha', campaign_payload,
    'skillAtivo', jsonb_build_object('id', selected_skill.id, 'slug', selected_skill.slug,
      'nome', selected_skill.name, 'versao', selected_skill.current_version, 'spec', selected_skill.spec),
    'runtimeContext', jsonb_build_object(
      'audience', 'customer', 'assistant', base_payload -> 'assistente', 'campaign', campaign_payload,
      'activeSkill', jsonb_build_object(
        'id', selected_skill.id, 'slug', selected_skill.slug, 'name', selected_skill.name,
        'version', selected_skill.current_version, 'contentHash', content_hash,
        'objective', skill_spec ->> 'objective', 'instructions', instructions,
        'allowedTools', allowed_tools, 'guardrails', coalesce(skill_spec -> 'guardrails', '[]'::jsonb),
        'handoff', coalesce(skill_spec -> 'handoff', '[]'::jsonb)
      ),
      'workflow', jsonb_build_object(
        'sessionId', session_row.id, 'revision', session_row.revision,
        'primarySkillId', reception_skill.id, 'activeSkillId', selected_skill.id,
        'stage', selected_stage, 'stageSpec', active_stage, 'stack', session_row.stack,
        'pendingSensitiveAction', pending_exists,
        'expiresAt', session_row.context_expires_at, 'subflowExpiresAt', session_row.subflow_expires_at,
        'confirmationMinutes', confirmation_minutes
      ),
      'allowedCollections', coalesce(base_payload -> 'colecoesPermitidas', '[]'::jsonb),
      'policies', coalesce(base_payload -> 'politicas', '{}'::jsonb) || jsonb_build_object(
        'singleOwner', true, 'separateConfirmation', true, 'chatbotResume', true
      )
    )
  );
end;
$$;

create or replace function public.nucleo_customer_calendar_action_prepare(
  conversation_key_hash text,
  request_key text,
  requester_hash text,
  action_payload jsonb,
  contract_version text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  context_row public.conversation_intelligence_contexts%rowtype;
  existing_action public.customer_pending_actions%rowtype;
  created_action public.customer_pending_actions%rowtype;
  payload_digest text;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if contract_version <> 'fase-h-3' then raise exception 'runtime contract version is incompatible'; end if;
  if conversation_key_hash !~ '^[0-9a-f]{64}$' or request_key !~ '^[0-9a-f]{64}$'
    or requester_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid pending action idempotency key'; end if;
  if jsonb_typeof(action_payload) <> 'object' then raise exception 'pending action payload must be an object'; end if;
  if length(trim(coalesce(action_payload ->> 'titulo', ''))) not between 1 and 240
    or nullif(action_payload ->> 'responsavelId', '') is null then raise exception 'booking payload is incomplete'; end if;
  begin
    starts_at := (action_payload ->> 'inicio')::timestamptz;
    ends_at := (action_payload ->> 'fim')::timestamptz;
  exception when others then raise exception 'booking interval is invalid'; end;
  if ends_at <= starts_at or ends_at - starts_at < interval '30 minutes'
    or ends_at - starts_at > interval '8 hours' then raise exception 'booking interval is invalid'; end if;

  select credential.connection_id into robot_connection from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid() and credential.organization_id = robot_org
    and credential.status = 'active' and credential.revoked_at is null limit 1;
  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.connection_id = robot_connection
    and context.channel = 'whatsapp' and context.conversation_key_hash = nucleo_customer_calendar_action_prepare.conversation_key_hash
    and context.audience = 'customer' and context.state = 'active' limit 1;
  if not found then raise exception 'active customer intelligence context required'; end if;
  if not exists (select 1 from public.organization_members member
    where member.organization_id = robot_org and member.user_id = (action_payload ->> 'responsavelId')::uuid
      and member.status = 'active') then raise exception 'selected agent is not active'; end if;

  payload_digest := encode(extensions.digest(action_payload::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(robot_connection::text || ':' || request_key, 0));
  select * into existing_action from public.customer_pending_actions action
  where action.organization_id = robot_org and action.connection_id = robot_connection
    and action.request_key = nucleo_customer_calendar_action_prepare.request_key;
  if found then
    if existing_action.payload_hash <> payload_digest then raise exception 'pending action key reused with different data'; end if;
    return jsonb_build_object('status', existing_action.status, 'acaoPendenteId', existing_action.id,
      'expiraEm', existing_action.expires_at, 'resumo', existing_action.payload);
  end if;
  update public.customer_pending_actions action set status = 'expired', updated_at = now()
  where action.organization_id = robot_org and action.connection_id = robot_connection
    and action.context_id = context_row.id and action.status in ('collecting', 'awaiting_confirmation', 'failed');
  insert into public.customer_pending_actions (
    organization_id, connection_id, context_id, action_type, contract_version,
    request_key, requester_hash, payload_hash, payload, status, expires_at
  ) values (
    robot_org, robot_connection, context_row.id, 'calendar_event', contract_version,
    request_key, requester_hash, payload_digest, action_payload, 'awaiting_confirmation', now() + interval '30 minutes'
  ) returning * into created_action;
  return jsonb_build_object('status', 'awaiting_confirmation', 'acaoPendenteId', created_action.id,
    'expiraEm', created_action.expires_at, 'resumo', created_action.payload,
    'message', 'Proposta preparada. Mostre o resumo e aguarde uma confirmação em outra mensagem.');
end;
$$;

create or replace function public.nucleo_customer_calendar_action_pending(
  conversation_key_hash text,
  expected_contract_version text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  pending_action public.customer_pending_actions%rowtype;
begin
  if robot_org is null or expected_contract_version <> 'fase-h-3' then raise exception 'runtime unavailable'; end if;
  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_calendar_action_pending.conversation_key_hash
    and context.audience = 'customer' and context.state = 'active' limit 1;
  if not found then return null; end if;
  update public.customer_pending_actions action set status = 'expired', updated_at = now()
  where action.organization_id = robot_org and action.context_id = context_row.id
    and action.status in ('collecting', 'awaiting_confirmation', 'failed') and action.expires_at <= now();
  select * into pending_action from public.customer_pending_actions action
  where action.organization_id = robot_org and action.context_id = context_row.id
    and action.contract_version = expected_contract_version
    and action.status in ('awaiting_confirmation', 'failed') and action.expires_at > now()
  order by action.created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('status', 'awaiting_confirmation', 'acaoPendenteId', pending_action.id,
    'expiraEm', pending_action.expires_at, 'resumo', pending_action.payload);
end;
$$;

create or replace function public.nucleo_customer_calendar_action_confirm(
  conversation_key_hash text,
  pending_action uuid,
  requester_phone text,
  customer_confirmed boolean,
  confirmation_key text,
  expected_contract_version text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  action_row public.customer_pending_actions%rowtype;
  booking_result jsonb;
  reminders integer[];
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
  where action.id = pending_action and action.organization_id = robot_org and action.context_id = context_row.id for update;
  if not found then return jsonb_build_object('status', 'not_found', 'errorCode', 'missing_confirmation'); end if;
  if action_row.requester_hash <> conversation_key_hash then raise exception 'pending action belongs to another requester'; end if;
  if confirmation_key = action_row.request_key then raise exception 'confirmation must arrive in a later customer turn'; end if;
  if action_row.status = 'completed' then return jsonb_build_object('status', 'already_exists', 'eventoId', action_row.event_id); end if;
  if action_row.expires_at <= now() or action_row.status = 'expired' then
    update public.customer_pending_actions set status = 'expired', updated_at = now() where id = action_row.id;
    return jsonb_build_object('status', 'expired', 'errorCode', 'missing_confirmation');
  end if;
  if action_row.status not in ('awaiting_confirmation', 'failed') then
    return jsonb_build_object('status', 'unavailable', 'errorCode', 'unavailable');
  end if;
  reminders := array(select value::integer from jsonb_array_elements_text(
    coalesce(action_row.payload -> 'lembretesMinutos', '[30]'::jsonb)) value);
  update public.customer_pending_actions set status = 'executing', updated_at = now(), last_error_code = null where id = action_row.id;
  begin
    booking_result := public.nucleo_calendar_booking_create(
      (action_row.payload ->> 'responsavelId')::uuid,
      encode(extensions.digest(action_row.id::text || ':fase-h-3', 'sha256'), 'hex'),
      action_row.requester_hash, requester_phone, action_row.payload ->> 'titulo',
      coalesce(action_row.payload ->> 'descricao', ''), (action_row.payload ->> 'inicio')::timestamptz,
      (action_row.payload ->> 'fim')::timestamptz, coalesce(action_row.payload ->> 'local', ''), reminders, true
    );
  exception when others then
    update public.customer_pending_actions set status = 'failed', last_error_code = 'unavailable', updated_at = now()
    where id = action_row.id;
    return jsonb_build_object('status', 'unavailable', 'errorCode', 'unavailable',
      'acaoPendenteId', action_row.id, 'message', 'Não foi possível criar o evento agora; a proposta continua disponível.');
  end;
  if coalesce((booking_result ->> 'conflito')::boolean, false) then
    update public.customer_pending_actions set status = 'awaiting_confirmation', last_error_code = 'conflict', updated_at = now() where id = action_row.id;
    return booking_result || jsonb_build_object('status', 'conflict', 'acaoPendenteId', action_row.id);
  end if;
  if not coalesce((booking_result ->> 'criado')::boolean, false)
    and not coalesce((booking_result ->> 'jaExistia')::boolean, false) then
    update public.customer_pending_actions set status = 'failed', last_error_code = 'unavailable', updated_at = now() where id = action_row.id;
    return booking_result || jsonb_build_object('status', 'unavailable', 'acaoPendenteId', action_row.id);
  end if;
  update public.customer_pending_actions set status = 'completed', event_id = (booking_result ->> 'eventoId')::uuid,
    confirmation_key = nucleo_customer_calendar_action_confirm.confirmation_key,
    completed_at = now(), updated_at = now(), last_error_code = null where id = action_row.id;
  return booking_result || jsonb_build_object('status', case when coalesce((booking_result ->> 'criado')::boolean, false)
    then 'created' else 'already_exists' end, 'acaoPendenteId', action_row.id);
end;
$$;

revoke all on function private.intelligence_normalize_v3(text) from public;
revoke all on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) from public;
revoke all on function public.nucleo_customer_calendar_action_prepare(text, text, text, jsonb, text) from public;
revoke all on function public.nucleo_customer_calendar_action_pending(text, text) from public;
revoke all on function public.nucleo_customer_calendar_action_confirm(text, uuid, text, boolean, text, text) from public;
grant execute on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) to authenticated;
grant execute on function public.nucleo_customer_calendar_action_prepare(text, text, text, jsonb, text) to authenticated;
grant execute on function public.nucleo_customer_calendar_action_pending(text, text) to authenticated;
grant execute on function public.nucleo_customer_calendar_action_confirm(text, uuid, text, boolean, text, text) to authenticated;

commit;
