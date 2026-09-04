-- Os resolvedores param de pegar "algum" perfil e passam a pedir o padrao.
--
-- FASE D de docs/intelligence/MULTI-AGENT-MIGRATION.md. A FASE C deu ao banco
-- a coluna `is_default`, mas ninguem a le ainda: a selecao de agente continua
-- sendo "o perfil daquela audience", e ela so devolve o agente certo porque
-- `unique (organization_id, audience)` garante que existe um so. Essa
-- garantia morre na FASE E. Se ela morresse antes desta migration, os pontos
-- de resolucao automatica passariam a sortear agente em silencio -- um
-- `limit 1` sem `order by` e literalmente "qualquer linha".
--
-- A regra que entra, e vale para todo ponto de resolucao implicita:
--
--     organizacao + audience + is_default = true  ->  o agente
--     depois, e so depois, verifica-se `active`
--
-- A ordem importa e e o coracao da fase. Hoje `intelligence_payload` filtra
-- `and profile.active` DENTRO do where da selecao. Com um agente so isso e
-- indistinguivel de checar depois; com dois, e a diferenca entre "o padrao
-- esta parado, recuse" e "o padrao esta parado, entao fale pelo outro" -- e a
-- segunda e exatamente o comportamento que nao podemos ter. Um agente nao
-- herda a conversa de outro por acidente de disponibilidade. Quem promove
-- agente e pessoa, nao indisponibilidade.
--
-- Por isso, aqui:
--
-- 1. **A selecao nao filtra `active`.** Ela pergunta so quem e o padrao. O
--    `active` vira uma checagem separada, imediatamente depois, que recusa.
--    Nenhuma das funcoes passa a procurar um substituto.
--
-- 2. **`limit 1` sai de onde escolhia agente.** O indice parcial da FASE C
--    (`assistant_profiles_one_default_idx`) ja garante no maximo um padrao por
--    (organizacao, audience), entao o `limit 1` nao estava protegendo nada --
--    estava so escondendo a ausencia de criterio. Sem ele, se algum dia
--    houvesse dois padroes, o `select into` falharia alto em vez de escolher
--    um por sorteio. Os outros `limit 1` do arquivo continuam onde estao:
--    eles ordenam e escolhem skill ou campanha, nao agente.
--
-- 3. **As mensagens e os `reason` publicos nao mudam.** `intelligence_payload`
--    continua levantando `assistant profile is inactive or unavailable` -- a
--    mesma string, agora por dois caminhos (nao existe padrao / o padrao esta
--    inativo), como ja era antes, ja que o filtro unico tambem colapsava os
--    dois casos. `nucleo_customer_assistant_access` continua devolvendo
--    `profile_inactive`. Nada vira erro generico para simplificar SQL.
--
-- O que NAO muda:
--
-- * `unique (organization_id, audience)` continua de pe. Esta fase nao libera
--   multi-agent; ela faz o codigo sobreviver a quando a FASE E liberar.
-- * `nucleo_intelligence_context_resolve_v3` nao e tocada. Ela nao escolhe
--   agente: le `context_row.assistant_profile_id`, que e gravado por
--   `intelligence_payload` a cada turno. Corrigir a selecao la em cima ja
--   corrige o v3 -- e e o que queremos, UMA semantica de padrao, nao duas.
-- * `public.nucleo_intelligence_context_resolve` (v1) e
--   `public.intelligence_context_preview` tambem nao sao tocadas: as duas
--   delegam a `private.intelligence_payload` e nao tem selecao propria.
-- * `private.provision_intelligence` nao e reescrita -- a FASE C ja a deixou
--   criando os perfis iniciais com `is_default = true`. Fica repetida aqui a
--   divida da FASE E: os dois `on conflict (organization_id, audience)` dela
--   dependem da unique antiga e vao precisar mudar quando ela cair.
--
-- Os tres corpos abaixo foram extraidos da definicao VIVA em producao
-- (`pg_get_functiondef`, 04/09/2026) e a unica alteracao em cada um e a
-- selecao de perfil descrita acima.

-- ---------------------------------------------------------------------------
-- 1/3. private.intelligence_payload
-- ---------------------------------------------------------------------------
-- O ponto de resolucao de todo o runtime: v1, v2, v3 e o preview chegam aqui.
-- A selecao deixa de filtrar `active` e passa a pedir `is_default`; o `active`
-- vira a checagem seguinte, que recusa em vez de procurar substituto.
CREATE OR REPLACE FUNCTION private.intelligence_payload(target_organization uuid, target_audience text, target_channel text, conversation_hash text, incoming_text text, source_data jsonb, should_persist boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_profile public.assistant_profiles%rowtype;
  selected_campaign public.organization_campaigns%rowtype;
  existing_context public.conversation_intelligence_contexts%rowtype;
  selected_skill public.skill_definitions%rowtype;
  skills_payload jsonb;
  collections_payload jsonb;
  saved_context uuid;
  normalized_message text := lower(left(coalesce(incoming_text, ''), 2000));
  safe_source jsonb := coalesce(source_data, '{}'::jsonb);
begin
  if target_audience not in ('internal', 'customer') then raise exception 'invalid assistant audience'; end if;
  if target_channel not in ('whatsapp', 'web', 'simulator') then raise exception 'invalid assistant channel'; end if;
  if conversation_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid conversation context key'; end if;

  select * into selected_profile from public.assistant_profiles profile
  where profile.organization_id = target_organization
    and profile.audience = target_audience
    and profile.is_default;
  if not found then raise exception 'assistant profile is inactive or unavailable'; end if;
  if not selected_profile.active then raise exception 'assistant profile is inactive or unavailable'; end if;

  select * into existing_context from public.conversation_intelligence_contexts context
  where context.organization_id = target_organization
    and context.channel = target_channel
    and context.conversation_key_hash = conversation_hash
    and context.state = 'active'
  limit 1;

  if existing_context.id is null and exists (
    select 1 from public.conversation_intelligence_contexts context
    where context.organization_id = target_organization
      and context.channel = target_channel
      and context.conversation_key_hash = conversation_hash
      and context.state = 'handed_off'
  ) then
    raise exception 'conversation is assigned to human service';
  end if;

  if existing_context.id is not null and existing_context.campaign_id is not null then
    select * into selected_campaign from public.organization_campaigns campaign
    where campaign.id = existing_context.campaign_id
      and campaign.organization_id = target_organization;
  elsif target_audience = 'customer' then
    select campaign.* into selected_campaign
    from public.organization_campaigns campaign
    left join public.campaign_sources source
      on source.campaign_id = campaign.id and source.organization_id = campaign.organization_id and source.active
    where campaign.organization_id = target_organization
      and campaign.status in ('test', 'active')
      and (campaign.starts_at is null or campaign.starts_at <= now())
      and (campaign.ends_at is null or campaign.ends_at > now())
      and (
        (source.source_type in ('link', 'qr', 'ad', 'tag', 'semantic') and safe_source ->> source.source_type = source.source_value)
        or (source.source_type = 'keyword' and source.source_value <> '' and position(lower(source.source_value) in normalized_message) > 0)
        or campaign.is_default
      )
    order by
      case when source.source_type in ('link', 'qr', 'ad', 'tag', 'semantic') then 0
           when source.source_type = 'keyword' then 1
           when campaign.is_default then 3 else 2 end,
      source.priority nulls last,
      campaign.created_at
    limit 1;
  end if;

  if existing_context.active_skill_id is not null then
    select * into selected_skill from public.skill_definitions skill
    where skill.id = existing_context.active_skill_id and skill.status = 'published';
  end if;
  if selected_skill.id is null and selected_campaign.id is not null then
    select skill.* into selected_skill
    from public.campaign_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    where binding.organization_id = target_organization and binding.campaign_id = selected_campaign.id
    order by
      case when exists (
        select 1 from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,keywords}', '[]'::jsonb)) keyword
        where position(lower(keyword) in normalized_message) > 0
      ) then 0 else 1 end,
      binding.priority, skill.name
    limit 1;
  end if;
  if selected_skill.id is null then
    select skill.* into selected_skill
    from public.assistant_profile_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    where binding.organization_id = target_organization
      and binding.profile_id = selected_profile.id and binding.enabled
      and skill.audience in (target_audience, 'both')
    order by
      case when exists (
        select 1 from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,keywords}', '[]'::jsonb)) keyword
        where position(lower(keyword) in normalized_message) > 0
      ) then 0 else 1 end,
      binding.priority, skill.name
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', skill.id, 'slug', skill.slug, 'nome', skill.name,
    'descricao', skill.description, 'versao', skill.current_version,
    'spec', skill.spec, 'prioridade', binding.priority,
    'configuracao', binding.configuration
  ) order by binding.priority, skill.name), '[]'::jsonb)
  into skills_payload
  from public.assistant_profile_skills binding
  join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
  where binding.organization_id = target_organization
    and binding.profile_id = selected_profile.id and binding.enabled
    and skill.audience in (target_audience, 'both');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', collection.id, 'nome', collection.name, 'escopo', collection.scope_type,
    'audiencia', collection.audience
  ) order by collection.name), '[]'::jsonb)
  into collections_payload
  from public.knowledge_collections collection
  where collection.organization_id = target_organization and collection.status = 'active'
    and (
      (target_audience = 'internal' and collection.audience = 'internal' and collection.scope_type <> 'personal')
      or (target_audience = 'customer' and collection.audience = 'external' and (
        collection.scope_type <> 'campaign'
        or exists (
          select 1 from public.campaign_knowledge_collections campaign_collection
          where campaign_collection.organization_id = target_organization
            and campaign_collection.collection_id = collection.id
            and campaign_collection.campaign_id = selected_campaign.id
        )
      ))
    );

  if should_persist then
    if existing_context.id is not null then
      update public.conversation_intelligence_contexts context
      set assistant_profile_id = selected_profile.id,
          campaign_id = coalesce(context.campaign_id, selected_campaign.id),
          active_skill_id = coalesce(selected_skill.id, context.active_skill_id),
          last_message_at = now(), source_context = context.source_context || safe_source
      where context.id = existing_context.id
      returning context.id into saved_context;
    else
      insert into public.conversation_intelligence_contexts (
        organization_id, assistant_profile_id, campaign_id, active_skill_id,
        audience, channel, conversation_key_hash, source_context
      ) values (
        target_organization, selected_profile.id, selected_campaign.id, selected_skill.id,
        target_audience, target_channel, conversation_hash, safe_source
      ) returning id into saved_context;
    end if;
  end if;

  return jsonb_build_object(
    'schemaVersion', 'fase-h-1',
    'contextoId', coalesce(saved_context, existing_context.id),
    'audiencia', target_audience,
    'assistente', jsonb_build_object(
      'id', selected_profile.id, 'nome', selected_profile.display_name,
      'tom', selected_profile.tone, 'marca', selected_profile.brand_config,
      'processo', selected_profile.process_config, 'templateId', selected_profile.template_id
    ),
    'campanha', case when selected_campaign.id is null then null else jsonb_build_object(
      'id', selected_campaign.id, 'nome', selected_campaign.name,
      'objetivo', selected_campaign.objective, 'oferta', selected_campaign.offer,
      'publico', selected_campaign.audience_description,
      'resultadoEsperado', selected_campaign.desired_outcome,
      'configuracao', selected_campaign.configuration
    ) end,
    'skillAtivo', case when selected_skill.id is null then null else jsonb_build_object(
      'id', selected_skill.id, 'slug', selected_skill.slug, 'nome', selected_skill.name,
      'versao', selected_skill.current_version, 'spec', selected_skill.spec
    ) end,
    'skillsPermitidos', skills_payload,
    'colecoesPermitidas', collections_payload,
    'politicas', jsonb_build_object(
      'organizacaoDerivada', true,
      'confirmacaoParaEscrita', true,
      'documentosComoDados', true,
      'transferenciaHumana', target_audience = 'customer'
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2/3. public.nucleo_customer_assistant_access
-- ---------------------------------------------------------------------------
-- Esta ja separava selecao de disponibilidade: buscava sem filtrar `active` e
-- devolvia `profile_inactive` no `if not found or not profile_row.active`.
-- Faltava so dizer QUAL perfil. Com `is_default`, os dois casos que ja caiam
-- em `profile_inactive` continuam caindo: sem padrao (fail closed) e padrao
-- inativo. O codigo de razao publico nao muda.
CREATE OR REPLACE FUNCTION public.nucleo_customer_assistant_access(requester_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid := private.robot_connection();
  profile_row public.assistant_profiles%rowtype;
  safe_mode text;
  matched_contacts uuid[];
  pilot_campaign uuid;
begin
  if robot_org is null or robot_connection is null then
    raise exception 'active robot credential required';
  end if;

  select profile.* into profile_row
  from public.assistant_profiles profile
  where profile.organization_id = robot_org and profile.audience = 'customer'
    and profile.is_default;
  if not found or not profile_row.active then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', 'off', 'reason', 'profile_inactive'
    );
  end if;

  safe_mode := coalesce(profile_row.process_config #>> '{rollout,mode}', 'off');
  if safe_mode not in ('off', 'pilot', 'active') then safe_mode := 'off'; end if;
  if safe_mode = 'off' then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode, 'reason', 'rollout_off'
    );
  end if;
  if safe_mode = 'active' then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', true,
      'mode', safe_mode, 'reason', 'active'
    );
  end if;

  select coalesce(array_agg(distinct contact.id), '{}'::uuid[])
  into matched_contacts
  from public.customer_assistant_pilot_contacts pilot
  join public.contacts contact
    on contact.id = pilot.contact_id
   and contact.organization_id = pilot.organization_id
  where pilot.organization_id = robot_org
    and pilot.profile_id = profile_row.id
    and pilot.active
    and contact.deleted_at is null
    and (
      private.customer_phone_matches(requester_phone, contact.phone)
      or private.customer_phone_matches(requester_phone, contact.whatsapp_id)
    );

  if cardinality(matched_contacts) <> 1 then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode,
      'reason', case when cardinality(matched_contacts) = 0
        then 'contact_not_selected' else 'contact_ambiguous' end
    );
  end if;

  select campaign.id into pilot_campaign
  from public.organization_campaigns campaign
  where campaign.organization_id = robot_org
    and campaign.assistant_profile_id = profile_row.id
    and campaign.name = 'Piloto Atendimento Major'
    and campaign.status = 'test'
  order by campaign.created_at
  limit 1;
  if pilot_campaign is null then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode, 'reason', 'pilot_campaign_unavailable'
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', 'customer-rollout-1', 'allowed', true,
    'mode', safe_mode, 'reason', 'pilot_contact',
    'contactId', matched_contacts[1],
    'sourceData', jsonb_build_object(
      'targetMode', 'campaign', 'targetCampaignId', pilot_campaign
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3/3. public.nucleo_intelligence_context_resolve_v2
-- ---------------------------------------------------------------------------
-- O v2 nao resolve o agente da conversa (isso e do payload), mas tem uma
-- selecao implicita propria: para achar o skill `tarefas` do operador, ele
-- entra por um perfil `internal` qualquer da organizacao. Passa a entrar pelo
-- padrao. O `and profile.active` continua aqui de proposito: se o padrao
-- interno esta parado, `task_skill` fica nulo e o fluxo segue sem skill de
-- tarefa -- que e o comportamento de hoje. O que nao pode, e agora nao pode
-- mesmo, e encontrar o skill por um segundo agente interno.
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
        'conversation.handoff',
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

-- ---------------------------------------------------------------------------
-- Prova: a fase promete selecao explicita, e promete nao ter liberado nada.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo_payload text;
  corpo_access text;
  corpo_v2 text;
begin
  select prosrc into corpo_payload from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'intelligence_payload';
  select prosrc into corpo_access from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access';
  select prosrc into corpo_v2 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nucleo_intelligence_context_resolve_v2';

  if corpo_payload not like '%profile.is_default%' then
    raise exception 'intelligence_payload nao passou a selecionar por is_default';
  end if;
  if corpo_access not like '%profile.is_default%' then
    raise exception 'nucleo_customer_assistant_access nao passou a selecionar por is_default';
  end if;
  if corpo_v2 not like '%profile.is_default%' then
    raise exception 'resolve_v2 nao passou a selecionar por is_default';
  end if;

  -- A selecao do agente no payload nao pode voltar a filtrar active junto.
  if corpo_payload like '%and profile.audience = target_audience and profile.active%' then
    raise exception 'intelligence_payload voltou a filtrar active dentro da selecao do agente';
  end if;

  -- A FASE D nao libera multi-agent: a unique antiga continua de pe.
  if not exists (
    select 1 from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public'
      and table_row.relname = 'assistant_profiles'
      and constraint_row.contype = 'u'
      and (
        select array_agg(attribute_row.attname::text order by attribute_row.attname)
        from unnest(constraint_row.conkey) as coluna(attnum)
        join pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = coluna.attnum
      ) = array['audience', 'organization_id']
  ) then
    raise exception 'unique (organization_id, audience) sumiu: a FASE D nao pode liberar multi-agent';
  end if;

  -- E o indice parcial da FASE C, que e o que torna a selecao sem limit 1 segura.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and indexname = 'assistant_profiles_one_default_idx'
      and indexdef like '%WHERE is_default%'
  ) then
    raise exception 'o indice parcial de agente padrao nao esta presente';
  end if;
end $$;
