-- Conferência da migration 20260915000000 (lead do site), só leitura.
--
-- Rodar no SQL Editor depois de aplicar. Cada linha deve sair `ok = true`.
-- Não confiar na mensagem de sucesso do editor: é o catálogo que diz o que ficou.

select 'funcao existe e e security definer' as item,
       exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'nucleo_site_lead_receive' and p.prosecdef
       ) as ok
union all
select 'anon executa a funcao',
       has_function_privilege('anon', 'public.nucleo_site_lead_receive(text, jsonb)', 'execute')
union all
select 'authenticated NAO executa a funcao',
       not has_function_privilege('authenticated', 'public.nucleo_site_lead_receive(text, jsonb)', 'execute')
union all
select 'ninguem de fora le a ligacao (token_hash)',
       not has_table_privilege('anon', 'public.campaign_site_intakes', 'select')
       and not has_table_privilege('authenticated', 'public.campaign_site_intakes', 'select')
union all
select 'anon nao le nem escreve leads',
       not has_table_privilege('anon', 'public.campaign_site_leads', 'select')
       and not has_table_privilege('anon', 'public.campaign_site_leads', 'insert')
union all
select 'RLS ligada nas duas tabelas',
       (select bool_and(c.relrowsecurity) from pg_class c
        where c.oid in ('public.campaign_site_intakes'::regclass, 'public.campaign_site_leads'::regclass))
union all
select 'fila aceita site_lead_welcome e manteve os 8 tipos anteriores',
       exists (
         select 1 from pg_constraint k
         where k.conrelid = 'public.connection_runtime_commands'::regclass
           and k.conname = 'connection_runtime_commands_command_type_check'
           and pg_get_constraintdef(k.oid) like '%site_lead_welcome%'
           and pg_get_constraintdef(k.oid) like '%connection_pair_qr%'
           and pg_get_constraintdef(k.oid) like '%conversation_send%'
           and pg_get_constraintdef(k.oid) like '%operator_verification_send%'
       );

-- Depois de ligar a campanha (scripts/sql/ligar-campanha-do-site.sql):
--
-- select campaign.name, campaign.status, intake.enabled, intake.hourly_limit,
--        left(intake.welcome_template, 60) as mensagem, intake.updated_at
-- from public.campaign_site_intakes intake
-- join public.organization_campaigns campaign on campaign.id = intake.campaign_id;

-- Acompanhar os leads e o que aconteceu com cada um:
--
-- select site_lead.last_received_at, site_lead.name, site_lead.site,
--        site_lead.submissions, site_lead.consent, site_lead.welcome_requested,
--        command.status as fila, command.error_code,
--        command.public_result ->> 'welcome' as primeira_mensagem,
--        command.public_result ->> 'teamNotified' as equipe_avisada
-- from public.campaign_site_leads site_lead
-- left join public.connection_runtime_commands command on command.id = site_lead.last_command_id
-- order by site_lead.last_received_at desc
-- limit 50;
