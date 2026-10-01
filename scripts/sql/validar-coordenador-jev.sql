-- Conferência da migration 20260930100000 (o coordenador lê as conversas).
-- Só leitura. Rode DEPOIS de aplicar; todas as colunas devem dar true.
select
  exists (select 1 from public.platform_features
          where key = 'conversation_insights' and kind = 'feature' and is_ai) as funcao_no_catalogo,
  not exists (select 1 from public.organization_entitlements
              where key = 'conversation_insights' and enabled) as desligada_para_todos,
  to_regclass('public.conversation_insight_runs') is not null as tabela_leituras,
  to_regclass('public.conversation_insight_answers') is not null as tabela_respostas,
  (select relrowsecurity from pg_class where oid = 'public.conversation_insight_runs'::regclass) as rls_leituras,
  (select relrowsecurity from pg_class where oid = 'public.conversation_insight_answers'::regclass) as rls_respostas,
  to_regprocedure('public.nucleo_insights_pending(integer, integer)') is not null as rpc_pendentes,
  to_regprocedure('public.nucleo_insights_record(jsonb)') is not null as rpc_gravar,
  not has_function_privilege('anon', 'public.nucleo_insights_pending(integer, integer)', 'execute') as anon_fora_pendentes,
  not has_function_privilege('anon', 'public.nucleo_insights_record(jsonb)', 'execute') as anon_fora_gravar,
  not has_table_privilege('authenticated', 'public.conversation_insight_runs', 'insert') as ninguem_escreve_direto,
  (select count(*) from pg_trigger
   where tgrelid in ('public.conversation_insight_runs'::regclass, 'public.conversation_insight_answers'::regclass)
     and not tgisinternal) = 0 as sem_gatilho_de_realtime;

-- Depois de ligar a função para a Major no painel, esta linha deve dar true:
-- select private.org_has_feature('338e44ca-36ab-437c-b8ac-aa7c60fee64a', 'conversation_insights');

-- E, com o coordenador rodando na VPS, as leituras aparecem aqui:
-- select status, count(*), round(avg(latency_ms)) as ms_medio, sum(cost_usd) as custo_usd,
--        max(created_at) as ultima
-- from public.conversation_insight_runs
-- where organization_id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
-- group by status;
