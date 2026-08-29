begin;

-- Mantém o fluxo interno de tarefas durante coleta e confirmação. A H.2
-- limpava a skill ativa em todo turno; por isso uma resposta curta como
-- "confirmo" voltava para a skill de menor prioridade (Agenda).
create or replace function public.nucleo_intelligence_context_resolve_v2(
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
        'task.confirm'
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
$$;

revoke all on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) from public;
grant execute on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) to authenticated;

commit;
