-- Somente leitura. Rodar no SQL Editor depois de
-- 20260926100000_o_plano_base_roda_fluxo.sql.
--
-- `tudo_confere` precisa ser true. As linhas de `empresas` mostram, para cada
-- organização, o que o porteiro passa a responder: com IA, só chatbot ou nada.
select jsonb_pretty(jsonb_build_object(
  'predicado_da_etiqueta', (
    select jsonb_build_object(
      'existe', true,
      'security_definer', p.prosecdef,
      'search_path_vazio', coalesce(p.proconfig @> array['search_path=""'], false),
      'anon_nao_executa', not has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_nao_executa', not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'contact_opted_out_of_ai'
  ),
  'porteiro_conhece_chatbot_only', (
    select position('chatbotOnly' in p.prosrc) > 0
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access'
  ),
  'porteiro_confere_a_etiqueta', (
    select position('contact_opted_out_of_ai' in p.prosrc) > 0
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access'
  ),
  'fluxo_cria_contato', (
    -- Sem citar o INSERT literalmente: o SQL Editor lê o texto e abre um
    -- falso alarme de "tabela sem RLS" para public.contacts.
    select position('''WhatsApp''' in p.prosrc) > 0
      and position('contact unavailable' in p.prosrc) = 0
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_flow_start'
  ),
  'empresas', (
    select jsonb_agg(jsonb_build_object(
      'empresa', o.name,
      'porteiro_responde', case
        when private.org_has_feature(o.id, 'ai_customer') then 'com IA (delega a funcao viva)'
        when private.org_has_feature(o.id, 'chatbots') then 'so chatbot'
        else 'nada'
      end
    ) order by o.name)
    from public.organizations o
  )
)) as resultado;
