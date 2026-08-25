begin;

-- Contrato determinístico entre o catálogo publicado e o runtime do WhatsApp.
-- A campanha continua persistente, mas a skill volta a ser resolvida usando a
-- mensagem atual em vez de ficar presa à primeira intenção da conversa.
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
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if conversation_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid conversation context key';
  end if;

  update public.conversation_intelligence_contexts context
  set active_skill_id = null, updated_at = now()
  where context.organization_id = robot_org
    and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_intelligence_context_resolve_v2.conversation_key_hash
    and context.state = 'active';

  payload := public.nucleo_intelligence_context_resolve(
    conversation_key_hash,
    requester_phone,
    left(coalesce(incoming_text, ''), 2000),
    coalesce(source_data, '{}'::jsonb)
  );

  skill_spec := payload #> '{skillAtivo,spec}';
  if skill_spec is not null and jsonb_typeof(skill_spec) <> 'null' then
    instructions := nullif(trim(skill_spec ->> 'instructionsMarkdown'), '');
    allowed_tools := coalesce(skill_spec -> 'allowedTools', '[]'::jsonb);
    -- Skills oficiais usam o Markdown versionado no Git. Skills privadas ou
    -- antigas do editor recebem uma compilação determinística do spec; texto
    -- livre de documentos e mensagens nunca participa desta instrução.
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
        'calendar.confirm'
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
