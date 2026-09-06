begin;

-- FASE 14C: v3 chama v2 antes de validar o estágio. Ambas as listas precisam aceitar a capacidade.

do $guard$
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc
      where oid = 'public.nucleo_intelligence_context_resolve_v2(text,text,text,jsonb)'::regprocedure)
      is distinct from 'c3409285d0afb1a7227f0787c01cb4a3' then
    raise exception 'nucleo_intelligence_context_resolve_v2 differs from reviewed baseline';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.nucleo_intelligence_context_resolve_v2(conversation_key_hash text, requester_phone text DEFAULT ''::text, incoming_text text DEFAULT ''::text, source_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  robot_org uuid := private.robot_organization();
  payload jsonb;
  skill_spec jsonb;
  instructions text;
  content_hash text;
  allowed_tools jsonb;
  operator_user uuid;
  operator_connection uuid;
  task_skill uuid;
  normalized_message text := translate(
    lower(left(coalesce(incoming_text, ''), 2000)),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  );
  task_intent boolean := false;
  agenda_intent boolean := false;
  explicit_confirmation boolean := false;
  pending_task boolean := false;
  recent_task_context boolean := false;
  task_continuation boolean := false;
  force_task boolean := false;
  routing_text text := left(coalesce(incoming_text, ''), 2000);
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if conversation_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid conversation context key';
  end if;

  task_intent := normalized_message ~
    '(^|[^a-z0-9])(tarefa|tarefas|pendencia|pendencias|afazer|lembrete|lembrar|follow-up)([^a-z0-9]|$)';
  agenda_intent := normalized_message ~
    '(^|[^a-z0-9])(agenda|agendar|agendamento|reuniao|reunioes|compromisso|evento|bloqueio|disponibilidade|horario|horarios)([^a-z0-9]|$)';
  explicit_confirmation := trim(normalized_message) ~
    '^(sim([, ]+pode[ ]+(agendar|marcar|criar))?|confirmo|confirmado|pode[ ]+(agendar|marcar|criar|prosseguir)|ok)[.! ]*$';
  task_continuation := trim(normalized_message) ~
    '^(hoje|amanha|depois de amanha|segunda(-feira)?|terca(-feira)?|quarta(-feira)?|quinta(-feira)?|sexta(-feira)?|sabado|domingo|[0-9]{1,2}([:/h][0-9]{0,2})?([ ]*(h|horas?))?|[0-9]{1,2}/[0-9]{1,2}(/[0-9]{2,4})?)(.*)$';

  if trim(coalesce(requester_phone, '')) <> '' then
    select context.user_id, context.connection_id
    into operator_user, operator_connection
    from public.nucleo_operator_context(requester_phone) context
    where context.organization_id = robot_org
    limit 1;
  end if;

  if operator_user is not null then
    select skill.id into task_skill
    from public.assistant_profiles profile
    join public.assistant_profile_skills binding
      on binding.organization_id = profile.organization_id
     and binding.profile_id = profile.id
     and binding.enabled
    join public.skill_definitions skill
      on skill.id = binding.skill_id
     and skill.status = 'published'
     and skill.slug = 'tarefas'
     and skill.audience in ('internal', 'both')
    where profile.organization_id = robot_org
      and profile.audience = 'internal'
      and profile.is_default
      and profile.active
    order by binding.priority, skill.name
    limit 1;

    select exists (
      select 1
      from public.assistant_pending_actions action
      where action.organization_id = robot_org
        and action.connection_id = operator_connection
        and action.operator_user_id = operator_user
        and action.kind = 'task'
        and action.contract_version = 'fase-g-1'
        and action.status in ('awaiting_confirmation', 'failed')
        and action.expires_at > now()
    ) into pending_task;

    if task_skill is not null then
      select exists (
        select 1
        from public.conversation_intelligence_contexts context
        where context.organization_id = robot_org
          and context.channel = 'whatsapp'
          and context.conversation_key_hash = nucleo_intelligence_context_resolve_v2.conversation_key_hash
          and context.state = 'active'
          and context.active_skill_id = task_skill
          and context.last_message_at > now() - interval '30 minutes'
      ) into recent_task_context;
    end if;
  end if;

  force_task := task_skill is not null and (
    task_intent
    or (pending_task and explicit_confirmation)
    or (recent_task_context and task_continuation and not agenda_intent)
  );

  update public.conversation_intelligence_contexts context
  set active_skill_id = case when force_task then task_skill else null end,
      updated_at = now()
  where context.organization_id = robot_org
    and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_intelligence_context_resolve_v2.conversation_key_hash
    and context.state = 'active';

  -- Em uma conversa nova, a palavra sintética serve somente ao roteador. Ela
  -- não é armazenada como mensagem nem enviada ao modelo.
  if force_task and not task_intent then
    routing_text := left(routing_text || ' tarefa', 2000);
  end if;

  payload := public.nucleo_intelligence_context_resolve(
    conversation_key_hash,
    requester_phone,
    routing_text,
    coalesce(source_data, '{}'::jsonb)
  );

  skill_spec := payload #> '{skillAtivo,spec}';
  if skill_spec is not null and jsonb_typeof(skill_spec) <> 'null' then
    instructions := nullif(trim(skill_spec ->> 'instructionsMarkdown'), '');
    allowed_tools := coalesce(skill_spec -> 'allowedTools', '[]'::jsonb);
    if instructions is null then
      instructions := concat(
        '# ', coalesce(payload #>> '{skillAtivo,nome}', 'Skill da organização'), E'\n\n',
        'Objetivo: ', coalesce(skill_spec ->> 'objective', 'Atender dentro das regras da organização.'), E'\n\n',
        'Perguntas permitidas: ', coalesce((skill_spec -> 'questions')::text, '[]'), E'\n',
        'Dados necessários: ', coalesce((skill_spec -> 'requiredFields')::text, '[]'), E'\n',
        'Limites obrigatórios: ', coalesce((skill_spec -> 'guardrails')::text, '[]'), E'\n',
        'Transferir quando: ', coalesce((skill_spec -> 'handoff')::text, '[]')
      );
    end if;
    if length(instructions) < 80 or length(instructions) > 20000 then
      raise exception 'published skill instructions are invalid';
    end if;
    content_hash := coalesce(
      nullif(skill_spec #>> '{source,contentHash}', ''),
      encode(extensions.digest(skill_spec::text, 'sha256'), 'hex')
    );
    if jsonb_typeof(allowed_tools) <> 'array' then
      raise exception 'published skill tools are invalid';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(allowed_tools) item
      where item not in (
        'knowledge.search',
        'crm.contact.read',
        'crm.contact.upsert',
        'crm.tag.apply',
        'crm.deal.qualify',
        'conversation.handoff', 'conversation.handoff.agent',
        'calendar.read',
        'calendar.availability',
        'calendar.prepare',
        'calendar.confirm',
        'task.read',
        'task.prepare',
        'task.confirm',
        'calendar.request.prepare',
        'calendar.request.submit'
      )
    ) then
      raise exception 'published skill contains an unsupported tool';
    end if;
  end if;

  return payload || jsonb_build_object(
    'schemaVersion', 'fase-h-2',
    'runtimeContext', jsonb_build_object(
      'audience', payload ->> 'audiencia',
      'assistant', payload -> 'assistente',
      'campaign', payload -> 'campanha',
      'activeSkill', case
        when payload -> 'skillAtivo' is null or jsonb_typeof(payload -> 'skillAtivo') = 'null' then null
        else jsonb_build_object(
          'id', payload #>> '{skillAtivo,id}',
          'slug', payload #>> '{skillAtivo,slug}',
          'name', payload #>> '{skillAtivo,nome}',
          'version', payload #> '{skillAtivo,versao}',
          'contentHash', content_hash,
          'objective', payload #>> '{skillAtivo,spec,objective}',
          'instructions', instructions,
          'allowedTools', coalesce(payload #> '{skillAtivo,spec,allowedTools}', '[]'::jsonb),
          'guardrails', coalesce(payload #> '{skillAtivo,spec,guardrails}', '[]'::jsonb),
          'handoff', coalesce(payload #> '{skillAtivo,spec,handoff}', '[]'::jsonb)
        )
      end,
      'allowedCollections', coalesce(payload -> 'colecoesPermitidas', '[]'::jsonb),
      'policies', coalesce(payload -> 'politicas', '{}'::jsonb)
    )
  );
end;
$function$;

do $verify$
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc
      where oid = 'public.nucleo_intelligence_context_resolve_v2(text,text,text,jsonb)'::regprocedure)
      is distinct from 'cf6d7160329a589602d730412215c801' then
    raise exception 'nucleo_intelligence_context_resolve_v2 differs from reviewed handoff body';
  end if;
end;
$verify$;

do $guard$
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc
      where oid = 'public.nucleo_intelligence_context_resolve_v3(text,text,text,jsonb)'::regprocedure)
      is distinct from 'ca95dbd5882f8547ceb1d593c0590722' then
    raise exception 'nucleo_intelligence_context_resolve_v3 differs from reviewed baseline';
  end if;
end;
$guard$;

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
    'conversation.handoff', 'conversation.handoff.agent', 'calendar.read', 'calendar.availability', 'calendar.prepare', 'calendar.confirm',
    'task.read', 'task.prepare', 'task.confirm', 'calendar.request.prepare', 'calendar.request.submit'
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

do $verify$
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc
      where oid = 'public.nucleo_intelligence_context_resolve_v3(text,text,text,jsonb)'::regprocedure)
      is distinct from 'f74eee42963ae1c1a0f033ce3905811b' then
    raise exception 'nucleo_intelligence_context_resolve_v3 differs from reviewed handoff body';
  end if;
end;
$verify$;

commit;
