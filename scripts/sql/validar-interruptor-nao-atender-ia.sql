-- Conferência depois de aplicar 20260913150000 pelo SQL Editor. SOMENTE LEITURA.
--
-- Um SELECT só. Tudo precisa voltar `true`, e `contatos_marcados` é o número de
-- contatos com a etiqueta — zero logo depois de aplicar é esperado (a marca nunca
-- tinha chegado ao banco); passa a subir quando alguém usar o interruptor.

select jsonb_build_object(
  'set_existe_definer', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_contact_ai_opt_out_set' and p.prosecdef
  ),
  'status_existe_definer', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_contact_ai_opt_out_status' and p.prosecdef
  ),
  'search_path_vazio', (
    select bool_and(pg_get_functiondef(p.oid) like '%SET search_path TO ''''%')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('nucleo_contact_ai_opt_out_set', 'nucleo_contact_ai_opt_out_status')
  ),
  'anon_bloqueado', not has_function_privilege(
    'anon', 'public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text)', 'execute'
  ) and not has_function_privilege(
    'anon', 'public.nucleo_contact_ai_opt_out_status(uuid, text)', 'execute'
  ),
  'authenticated_liberado', has_function_privilege(
    'authenticated', 'public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text)', 'execute'
  ) and has_function_privilege(
    'authenticated', 'public.nucleo_contact_ai_opt_out_status(uuid, text)', 'execute'
  ),
  'gate_inalterado_trata_etiqueta', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access'
      and p.prosrc like '%contact_opted_out%'
  ),
  'contatos_marcados', (
    select count(distinct marcacao.contact_id)
    from public.contact_tags marcacao
    join public.tags tag on tag.id = marcacao.tag_id and tag.organization_id = marcacao.organization_id
    join public.contacts contact on contact.id = marcacao.contact_id and contact.organization_id = marcacao.organization_id
    where tag.deleted_at is null and contact.deleted_at is null
      and (
        lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'
        or lower(regexp_replace(tag.name, '[^A-Za-z]', '', 'g')) in ('noatenderia', 'naoatenderia')
      )
  )
) as conferencia;
