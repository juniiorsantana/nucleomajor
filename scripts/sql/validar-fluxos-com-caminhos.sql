-- Somente leitura. Rodar no SQL Editor depois de
-- 20260925100000_fluxos_com_caminhos.sql.
--
-- `catalogo_confere` precisa ser true. `empresas_com_a_funcao` lista quem já
-- está com ela ligada: logo depois da migration, a lista vem vazia; depois de
-- ligar pelo painel, deve aparecer só a Major.
select jsonb_pretty(jsonb_build_object(
  'catalogo_confere', exists (
    select 1 from public.platform_features
    where key = 'fluxos_ramificados' and kind = 'feature'
      and category = 'atendimento' and is_ai = false
  ),
  'empresas_com_a_funcao', coalesce((
    select jsonb_agg(jsonb_build_object(
      'organizacao', organization.name,
      'id', organization.id,
      'ligada', entitlement.enabled,
      'vence', entitlement.expires_at
    ) order by organization.name)
    from public.organization_entitlements entitlement
    join public.organizations organization on organization.id = entitlement.organization_id
    where entitlement.key = 'fluxos_ramificados'
  ), '[]'::jsonb),
  'execucoes_de_fluxo', (select count(*) from public.chatbot_flow_executions)
)) as resultado;
