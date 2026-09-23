-- FASE 3: somente leitura. Executar depois da migration no SQL Editor.
-- Todos os campos *_confere e tabela_confere devem ser true.
with esperado(schema_name, function_name, body_hash, definer, authenticated_execute) as (
  values
    ('private', 'flow_cancel_on_human_handoff', '52df475b8a327e8ea9e5bb8d334f64ce', true, false),
    ('private', 'flow_connection', 'b6bbc7b2344af0fee0830a7717a441ea', true, false),
    ('private', 'flow_step', 'd182e18bc61229ce42dedb4fc106dbe7', false, false),
    ('private', 'flow_target', '2e0a59b1fe2f8ab1458d473b866343e0', false, false),
    ('private', 'flow_validate_expression', '0a9cd49ab6e936487b139f628885c4b5', false, false),
    ('private', 'flow_validate', '749468581666cf0e5c0ab73bc702c3e0', false, false),
    ('private', 'flow_envelope', 'f3eaddb1283d7d6a98e92b2921665463', false, false),
    ('public', 'nucleo_flow_start', '40f258ab7125e35dbcddeefb80e93dee', true, true),
    ('public', 'nucleo_flow_claim', '17e4be5e4186ae551eafdb245917e2e9', true, true),
    ('public', 'nucleo_flow_ack', 'ddf8207fd29ce828d292df2ad9f1db6f', true, true),
    ('public', 'nucleo_flow_pending', '42f20eee3d4aae69c663b93956ca8f39', true, true),
    ('public', 'nucleo_flow_current', '7deb3d48337a172cde578c6097e0eb5b', true, true),
    ('public', 'nucleo_flow_state', '2fa688fe6adfed3d48d06f1ef42aa635', true, true),
    ('public', 'nucleo_flow_finish_ai', 'e44b0646daa5fc143d458a53809603bf', true, true),
    ('public', 'nucleo_flow_cancel', '316d3b531c3258126fcdb96714eda4c7', true, true)
), funcoes as (
  select e.function_name as funcao, e.schema_name as schema,
    md5(replace(p.prosrc, chr(13), '')) as hash_corpo,
    coalesce(md5(replace(p.prosrc, chr(13), '')) = e.body_hash, false) as hash_confere,
    coalesce(p.prosecdef = e.definer, false) as definer_confere,
    coalesce(p.proconfig @> array['search_path=""'], false) as search_path_confere,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_confere,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated_execute, false) as authenticated_confere
  from esperado e
  left join pg_namespace n on n.nspname=e.schema_name
  left join pg_proc p on p.pronamespace=n.oid and p.proname=e.function_name
), tabela as (
  select coalesce(
    c.relrowsecurity
    and not has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    and (select count(*) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)=25
    and exists(select 1 from pg_trigger t
      where t.tgrelid=to_regclass('public.conversation_intelligence_contexts')
        and t.tgname='flow_cancel_on_human_handoff' and t.tgenabled='O'),
    false) as tabela_confere
  from (select to_regclass('public.chatbot_flow_executions') as oid) alvo
  left join pg_class c on c.oid=alvo.oid
)
select jsonb_pretty(jsonb_build_object(
  'funcoes', (select jsonb_agg(to_jsonb(f) order by schema,funcao) from funcoes f),
  'tabela_confere', (select tabela_confere from tabela),
  'tudo_confere', (select count(*)=15 and bool_and(hash_confere and definer_confere
      and search_path_confere and anon_confere and authenticated_confere) from funcoes)
      and (select tabela_confere from tabela)
)) as resultado;
