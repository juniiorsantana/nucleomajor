-- Conferência do checkout do Asaas. Só leitura: pode rodar quantas vezes
-- quiser. Rodar no SQL Editor depois da migration 20260920100000 e do
-- scripts/sql/ligar-checkout-asaas.sql. Tudo precisa voltar `ok = true`.

select 'planos base, atendimento e completo existem, cada um com a IA certa' as conferencia,
       (select count(*) = 3 from public.saas_plans
        where active and (
          (code = 'base' and features ->> 'ai_customer' = 'false' and features ->> 'ai_team' = 'false')
          or (code = 'atendimento' and features ->> 'ai_customer' = 'true' and features ->> 'ai_team' = 'false')
          or (code = 'completo' and features ->> 'ai_customer' = 'true' and features ->> 'ai_team' = 'true')
        )) as ok
union all
select 'o plano da Major (full) mantém as duas IAs',
       exists (
         select 1 from public.saas_plans
         where code = 'full' and features ->> 'ai_customer' = 'true' and features ->> 'ai_team' = 'true'
       )
union all
select 'token do webhook gravado',
       exists (select 1 from public.billing_intakes where provider = 'asaas' and enabled)
union all
select 'pelo menos um link mapeado',
       exists (
         select 1 from public.billing_payment_links
         where provider = 'asaas' and active and external_link_id not like 'COLE_AQUI%'
       )
union all
select 'nenhum link esquecido com o texto de exemplo',
       not exists (
         select 1 from public.billing_payment_links
         where external_link_id like 'COLE_AQUI%'
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

-- Quais planos e ciclos já têm link (informativo):
--
-- select plan.name as plano, link.billing_cycle as ciclo, link.external_link_id, link.active
-- from public.billing_payment_links link
-- join public.saas_plans plan on plan.code = link.plan_code
-- order by plan.code, link.billing_cycle;

-- Durante o ensaio no sandbox: os últimos eventos que chegaram, sem dado
-- pessoal. `unmapped_link` com o ID do SEU link quer dizer que o BLOCO 2 do
-- ligar-checkout-asaas.sql ficou com o número errado.
--
-- select event_type, external_link_id, external_subscription_id, result, received_at
-- from public.billing_events
-- order by received_at desc
-- limit 20;
