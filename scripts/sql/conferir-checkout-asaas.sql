-- Conferência do checkout do Asaas. Só leitura: pode rodar quantas vezes
-- quiser. Rodar no SQL Editor depois da migration 20260920100000 e do
-- scripts/sql/ligar-checkout-asaas.sql. Tudo precisa voltar `ok = true`.

select 'plano base existe, sem IA' as conferencia,
       exists (
         select 1 from public.saas_plans
         where code = 'base' and active and features ->> 'assistant' = 'false'
       ) as ok
union all
select 'token do webhook gravado',
       exists (select 1 from public.billing_intakes where provider = 'asaas' and enabled)
union all
select 'link do plano base mapeado',
       exists (
         select 1 from public.billing_payment_links
         where provider = 'asaas' and active and plan_code = 'base'
           and external_link_id <> 'COLE_AQUI_O_ID_DO_LINK'
       )
union all
select 'nenhum link esquecido com o texto de exemplo',
       not exists (
         select 1 from public.billing_payment_links
         where external_link_id = 'COLE_AQUI_O_ID_DO_LINK'
       )
union all
select 'anon executa o webhook',
       has_function_privilege('anon', 'public.nucleo_billing_asaas_receive(text, jsonb, text)', 'execute')
union all
select 'anon não lê as vendas',
       not has_table_privilege('anon', 'public.billing_subscriptions', 'select')
union all
select 'usuário logado não lê os eventos',
       not has_table_privilege('authenticated', 'public.billing_events', 'select')
union all
select 'criar empresa exige e-mail confirmado e conhece a venda',
       coalesce((
         select p.prosrc like '%confirmed email required%'
            and p.prosrc like '%billing_subscriptions%'
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'create_organization'
           and pg_get_function_identity_arguments(p.oid) = 'organization_name text, access_code text'
       ), false)
union all
select 'toda empresa tem assinatura',
       not exists (
         select 1 from public.organizations organization
         where not exists (
           select 1 from public.organization_subscriptions subscription
           where subscription.organization_id = organization.id
         )
       )
union all
select 'nenhuma empresa que já existia ficou bloqueada',
       not exists (
         select 1 from public.organization_subscriptions subscription
         where subscription.source in ('migration', 'manual')
           and private.org_access_state(subscription.organization_id) <> 'ok'
       )
union all
select 'concessão sem autor só quando vem de pagamento',
       exists (
         select 1 from pg_constraint
         where conname = 'onboarding_access_grants_created_by_source'
       );

-- Durante o ensaio no sandbox: os últimos eventos que chegaram, sem dado
-- pessoal. `unmapped_link` com o ID do SEU link quer dizer que o BLOCO 2 do
-- ligar-checkout-asaas.sql ficou com o número errado.
--
-- select event_type, external_link_id, external_subscription_id, result, received_at
-- from public.billing_events
-- order by received_at desc
-- limit 20;
