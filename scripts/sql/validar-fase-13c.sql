-- Conferencia SOMENTE LEITURA: executar antes e depois da aplicacao manual.
-- Uma unica consulta, com snapshot consistente; nao chama RPC nem resolvedor.
-- Exportar o JSON inteiro nas duas execucoes, no mesmo projeto e papel.
-- Os fingerprints resumem linhas sem devolver o conteudo das personas.
with funcoes_esperadas(schema_nome, funcao_nome) as (
  values
    ('private', 'intelligence_payload'),
    ('private', 'provision_intelligence'),
    ('public', 'intelligence_context_preview'),
    ('public', 'nucleo_customer_assistant_access'),
    ('public', 'nucleo_intelligence_context_resolve'),
    ('public', 'nucleo_intelligence_context_resolve_v2'),
    ('public', 'nucleo_intelligence_context_resolve_v3')
), funcoes as (
  select e.schema_nome || '.' || e.funcao_nome as nome,
    p.oid, p.prosecdef, p.proconfig, p.proowner, p.proacl,
    md5(replace(p.prosrc, chr(13), '')) as md5_corpo_normalizado
  from funcoes_esperadas e
  left join pg_catalog.pg_namespace n on n.nspname = e.schema_nome
  left join pg_catalog.pg_proc p
    on p.pronamespace = n.oid and p.proname = e.funcao_nome
), perfis as (
  select count(*) as quantidade,
    count(*) filter (where p.is_default) as padroes,
    count(*) filter (where p.active) as ativos,
    count(*) filter (where p.soul_markdown is not null) as com_soul,
    count(*) filter (where length(p.soul_markdown) > 8000) as soul_acima_de_8000,
    max(p.updated_at) as ultimo_updated_at,
    md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' order by p.id), '')) as fingerprint
  from public.assistant_profiles p
), contextos as (
  select count(*) as quantidade,
    count(*) filter (where c.state = 'active') as ativos,
    md5(coalesce(string_agg(md5(to_jsonb(c)::text), '' order by c.id), '')) as fingerprint
  from public.conversation_intelligence_contexts c
), auditoria as (
  select count(*) as quantidade, max(a.id) as ultimo_id,
    max(a.created_at) as ultimo_created_at,
    md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) as fingerprint
  from public.intelligence_audit_log a
)
select jsonb_pretty(jsonb_build_object(
  'coletado_em', statement_timestamp(),
  'banco', current_database(),
  'papel', current_user,
  'timezone', current_setting('TimeZone'),
  'funcoes_encontradas', (select count(oid) from funcoes),
  'funcoes', (
    select jsonb_agg(jsonb_build_object(
      'nome', f.nome,
      'assinatura', pg_get_function_identity_arguments(f.oid),
      'md5_corpo_normalizado', f.md5_corpo_normalizado,
      'md5_definicao', md5(pg_get_functiondef(f.oid)),
      'security_definer', f.prosecdef,
      'configuracao', f.proconfig,
      'dono', pg_get_userbyid(f.proowner),
      'acl', f.proacl::text
    ) order by f.nome, f.oid)
    from funcoes f
  ),
  'payload_13b_confirmado', coalesce((
    select md5_corpo_normalizado = 'f5a6b72b2a01f96aab60e5d6b4e50319'
    from funcoes where nome = 'private.intelligence_payload'
  ), false),
  'payload_13c_confirmado', coalesce((
    select md5_corpo_normalizado = '4ed9516507bcf8322f14e313fa08a94e'
    from funcoes where nome = 'private.intelligence_payload'
  ), false),
  'coluna_soul_existe', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and column_name = 'soul_markdown'
  ),
  'digest_texto_existe', to_regprocedure('extensions.digest(text,text)') is not null,
  'constraint_soul', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', c.conname,
      'tipo', c.contype,
      'validada', c.convalidated,
      'definicao', pg_get_constraintdef(c.oid)
    )), '[]'::jsonb)
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.assistant_profiles'::regclass
      and c.conname = 'assistant_profiles_soul_markdown_tamanho'
  ),
  'dados', jsonb_build_object(
    'perfis', (select to_jsonb(p) from perfis p),
    'contextos', (select to_jsonb(c) from contextos c),
    'auditoria', (select to_jsonb(a) from auditoria a)
  )
)) as conferencia_fase_13c;
