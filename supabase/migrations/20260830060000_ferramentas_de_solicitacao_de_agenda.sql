-- Aceita as duas ferramentas de solicitacao de agenda na validacao da skill.
--
-- A H.4 (20260827190000) criou a skill de plataforma `solicitacao-agenda` e
-- deu a ela `calendar.request.prepare` e `calendar.request.submit` - o caminho
-- pelo qual o CLIENTE pede horario sem nunca criar evento direto, descrito em
-- docs/specs/SPEC-EXTERNAL-PILOT.md:67. O runtime implementa as duas
-- (whatsapp-assistant/runner.py) e o catalogo canonico do portal as declara
-- (packages/intelligence/src/catalog.mjs:22-23).
--
-- O que ficou para tras foi a validacao no banco.
-- `nucleo_intelligence_context_resolve_v2` confere `allowedTools` contra uma
-- lista fixa antes de devolver o contexto, e essa lista nunca recebeu as duas:
-- nao estava em 20260824153000, a H.4 nao a tocou, e 20260828210000 a
-- reescreveu mantendo as mesmas treze.
--
-- Consequencia: todo turno externo que caisse em `solicitacao-agenda`
-- levantava `published skill contains an unsupported tool`, o runtime
-- registrava `intelligence.resolve_failed` com `error_code=unavailable`, e o
-- cliente recebia "Nosso atendimento esta temporariamente indisponivel"
-- seguido de transferencia humana. Nunca apareceu antes porque o Bridge
-- barrava todo cliente antes disto - dois defeitos empilhados, e o de fora
-- escondia o de dentro.
--
-- Esta migration reaplica a funcao de 20260828210000 SEM NENHUMA outra
-- alteracao alem das duas linhas da lista. O roteamento de tarefas internas
-- que aquela migration corrigiu continua identico.
--
-- `nucleo_intelligence_context_resolve_v3` (modo ativo) nao precisa mudar:
-- ela delega a v2 e herda a lista.

begin;

-- Antes de substituir, confere que o que esta no banco e o que este
-- repositorio pensa que esta. Se alguem tiver redefinido a funcao pelo SQL
-- Editor, a migration para aqui em vez de silenciosamente descartar a
-- alteracao dessa pessoa.
do $verificacao$
declare
  definicao text;
begin
  select pg_get_functiondef(p.oid) into definicao
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'nucleo_intelligence_context_resolve_v2';

  if definicao is null then
    raise exception 'nucleo_intelligence_context_resolve_v2 nao existe nesta base';
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
$$;

-- As permissoes nao mudam com `create or replace`, mas repetir aqui torna a
-- migration completa se for aplicada numa base nova.
revoke all on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) from public;
grant execute on function public.nucleo_intelligence_context_resolve_v2(text, text, text, jsonb) to authenticated;

-- Prova, na mesma transacao: as quinze ferramentas do catalogo canonico
-- precisam ser aceitas, e uma inventada precisa continuar sendo recusada. Sem
-- isto a lista voltaria a ser um texto que ninguem confere - foi assim que as
-- duas sumiram por tres dias.
do $prova$
declare
  definicao text := (
    select pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'nucleo_intelligence_context_resolve_v2'
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
      raise exception 'ferramenta do catalogo ausente na validacao: %', ferramenta;
    end if;
  end loop;

  if strpos(definicao, 'calendar.create') > 0 then
    raise exception 'calendar.create nao pertence ao catalogo e nao pode ser aceita';
  end if;
end;
$prova$;

commit;
