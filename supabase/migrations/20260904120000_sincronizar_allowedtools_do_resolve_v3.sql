-- Sincroniza a whitelist de allowedTools de nucleo_intelligence_context_resolve_v3
-- com a de nucleo_intelligence_context_resolve_v2.
--
-- A auditoria registrada em docs/intelligence/BASELINE-ARQUITETURA-ATUAL.md
-- (seção 15.1) encontrou que resolve_v3 nunca recebeu a correção aplicada a
-- resolve_v2 em 20260830060000_ferramentas_de_solicitacao_de_agenda.sql: v3
-- mantém sua PRÓPRIA lista embutida, definida uma única vez em
-- 20260824210000_fase_h3_orquestracao_contextual.sql e nunca mais tocada.
--
-- O comentário daquela migration ("nucleo_intelligence_context_resolve_v3
-- (modo ativo) nao precisa mudar: ela delega a v2 e herda a lista") descreve
-- um comportamento que o código não tem: v3 chama v2 só para reaproveitar
-- `assistente`/`colecoesPermitidas`/`politicas`/`campanha` inicial (linha
-- 184-186 daquele arquivo); a partir daí v3 descarta o `skillAtivo`/
-- `runtimeContext` devolvidos por v2 (linha 375: `base_payload - 'skillAtivo'
-- - 'campanha' - 'schemaVersion' - 'runtimeContext'`) e reconstrói tudo
-- sozinha — inclusive a validação de allowedTools, com uma lista própria e
-- fixa. v3 nunca herdou nada de v2.
--
-- Consequência: a skill `solicitacao-agenda` (audience customer) usa
-- `calendar.request.prepare` no estágio `confirmar_cliente` e
-- `calendar.request.submit` no estágio `submeter`
-- (packages/intelligence/skills/solicitacao-agenda/skill.json). Nenhuma das
-- duas estava na lista de v3. Um turno de cliente que chegue a esses estágios
-- através de v3 (o resolvedor usado para clientes externos, segundo
-- docs/specs/SPEC-INTELLIGENCE.md) levantava
-- 'published skill contains an unsupported tool' — o mesmo sintoma do
-- incidente de 30/08 (docs/STATUS.md), reaberto no resolvedor que aquela
-- correção não tocou.
--
-- Esta migration reaplica a função de 20260824210000 SEM NENHUMA outra
-- alteração além da lista de ferramentas aceitas (equivalente às linhas
-- 342-345 daquele arquivo, agora com as mesmas quinze de v2, na mesma
-- ordem). Roteamento, seleção de skill/estágio, sessão de subfluxo, ação
-- pendente, campanha, payload de retorno e permissões permanecem idênticos.

begin;

-- Mesmo cuidado de 20260830060000: se alguém redefiniu a função fora deste
-- histórico de migrations, a migration para aqui em vez de descartar aquela
-- alteração silenciosamente.
do $verificacao$
declare
  definicao text;
begin
  select pg_get_functiondef(p.oid) into definicao
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'nucleo_intelligence_context_resolve_v3';

  if definicao is null then
    raise exception 'nucleo_intelligence_context_resolve_v3 nao existe nesta base';
  end if;
  if strpos(definicao, 'calendar.request.prepare') > 0 then
    raise notice 'a funcao ja aceita calendar.request.*; esta migration e no-op efetivo';
  end if;
  if strpos(definicao, 'published skill contains an unsupported tool') = 0 then
    raise exception
      'a funcao no banco nao tem a validacao de ferramentas esperada; '
      'reveja manualmente antes de aplicar';
  end if;
end;
$verificacao$;

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
    'conversation.handoff', 'calendar.read', 'calendar.availability', 'calendar.prepare', 'calendar.confirm',
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

-- As permissoes nao mudam com `create or replace`, mas repetir aqui torna a
-- migration completa se for aplicada numa base nova.
revoke all on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) from public;
grant execute on function public.nucleo_intelligence_context_resolve_v3(text, text, text, jsonb) to authenticated;

-- Prova, na mesma transação: as quinze ferramentas do catálogo canônico
-- precisam ser aceitas por v3 (as mesmas de v2), e uma ferramenta que não
-- pertence ao catálogo (calendar.create, exclusiva do assistente web)
-- continua sendo recusada.
do $prova$
declare
  definicao text := (
    select pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'nucleo_intelligence_context_resolve_v3'
  );
  ferramenta text;
begin
  foreach ferramenta in array array[
    'knowledge.search', 'crm.contact.read', 'crm.contact.upsert',
    'crm.tag.apply', 'crm.deal.qualify', 'conversation.handoff',
    'calendar.read', 'calendar.availability', 'calendar.prepare',
    'calendar.confirm', 'calendar.request.prepare', 'calendar.request.submit',
    'task.read', 'task.prepare', 'task.confirm'
  ] loop
    if strpos(definicao, '''' || ferramenta || '''') = 0 then
      raise exception 'ferramenta do catalogo ausente na validacao de v3: %', ferramenta;
    end if;
  end loop;

  if strpos(definicao, 'calendar.create') > 0 then
    raise exception 'calendar.create nao pertence ao catalogo e nao pode ser aceita';
  end if;
end;
$prova$;

commit;
