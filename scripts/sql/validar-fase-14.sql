-- Somente leitura. Executar inteiro no SQL Editor antes e depois da aplicação.
-- O aceite compara prosrc sem CR: pg_get_functiondef varia com CRLF.
with expected(signature, baseline, accepted) as (values
  ('private.intelligence_payload(uuid,text,text,text,text,jsonb,boolean)',
   '4ed9516507bcf8322f14e313fa08a94e','4ed9516507bcf8322f14e313fa08a94e'),
  ('public.nucleo_customer_agent_handoff(text,text,text,text,text)',
   null,'c5a77221e64b6be22720cc1800faf683'),
  ('public.nucleo_intelligence_context_resolve_v2(text,text,text,jsonb)',
   'c3409285d0afb1a7227f0787c01cb4a3','cf6d7160329a589602d730412215c801'),
  ('public.nucleo_intelligence_context_resolve_v3(text,text,text,jsonb)',
   'ca95dbd5882f8547ceb1d593c0590722','f74eee42963ae1c1a0f033ce3905811b')
)
select expected.signature, md5(replace(p.prosrc,chr(13),'')) as normalized_body_md5,
  expected.baseline, expected.accepted,
  md5(replace(p.prosrc,chr(13),'')) = expected.accepted as accepted,
  p.prosecdef as security_definer, p.proconfig,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from expected left join pg_proc p on p.oid=to_regprocedure(expected.signature);

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='conversation_intelligence_contexts'
  and column_name='agent_handoff_count';

-- Confirmar slug do SDR e bindings antes de configurar/publicar a instrução.
select profile.organization_id, profile.id, profile.slug, profile.display_name,
  profile.audience, profile.active, profile.is_default,
  count(*) filter(where binding.enabled and skill.status='published'
    and coalesce((skill.spec #>> '{routing,fallback}')::boolean,false)) as published_reception_bindings
from public.assistant_profiles profile
left join public.assistant_profile_skills binding on binding.profile_id=profile.id
left join public.skill_definitions skill on skill.id=binding.skill_id
group by profile.id order by profile.organization_id,profile.audience,profile.slug;

select slug,current_version,spec #>> '{source,contentHash}' as content_hash,
  spec->'allowedTools' as allowed_tools,spec #> '{workflow,stages}' as stages
from public.skill_definitions where slug in ('recepcao','vendas') and status='published';

-- Observação após uma transferência real: apenas metadados autorizados.
select created_at,organization_id,entity_id,
  metadata->>'sourceAgentSlug' as source_agent_slug,
  metadata->>'targetAgentSlug' as target_agent_slug,
  metadata->>'reason' as reason,metadata->>'handoffCount' as handoff_count,
  metadata ? 'summary' or metadata ? 'resumo' or metadata ? 'handoff_summary' as unexpected_summary
from public.intelligence_audit_log where entity_type='conversation' and action='agent_handoff'
order by created_at desc limit 20;
