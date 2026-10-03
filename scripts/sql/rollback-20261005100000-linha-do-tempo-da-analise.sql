-- ROLLBACK de 20261005100000_linha_do_tempo_da_analise.sql.
--
-- Não é migration: fica fora de supabase/migrations de propósito. Só rodar
-- pelo SQL Editor se for preciso desfazer a linha do tempo. Volta a consulta
-- de andamento ao corpo de 20261004100000 (copiado sem mudança) e remove a
-- função nova. Nada foi gravado em tabela, então não há dado a desfazer. O
-- portal novo continua funcionando: sem `timeline`, a seção "Onde aconteceu
-- na conversa" não aparece.

begin;

do $$
begin
  if to_regprocedure('private.linha_do_tempo_da_analise(public.conversation_analyses)') is null then
    raise exception 'abortado: a linha do tempo nao esta aplicada';
  end if;
end $$;

create or replace function public.conversation_analysis_status(target_organization uuid, target_analysis uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  analise public.conversation_analyses%rowtype;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;

  -- Pedido parado há mais de 15 minutos: falha, e o crédito volta.
  update public.conversation_analyses a
  set status = 'failed', error_code = 'expired', completed_at = now()
  where a.id = target_analysis
    and a.organization_id = target_organization
    and a.status in ('pending', 'running')
    and a.requested_at < now() - interval '15 minutes';

  select * into analise
  from public.conversation_analyses a
  where a.id = target_analysis and a.organization_id = target_organization;
  if not found or (analise.saved_at is null and not private.can_manage_org(target_organization)) then
    raise exception 'analysis not found';
  end if;

  return jsonb_build_object(
    'analysisId', analise.id,
    'kind', analise.kind,
    'status', analise.status,
    'errorCode', analise.error_code,
    'result', analise.result,
    'contactId', analise.contact_id,
    'requestedAt', analise.requested_at,
    'completedAt', analise.completed_at,
    'savedAt', analise.saved_at,
    'credits', private.creditos_de_analise(target_organization),
    'leadScore', analise.lead_score,
    'serviceScore', analise.service_score,
    'schemaVersion', analise.schema_version,
    'report', case when analise.status = 'done' then private.relatorio_da_analise(analise) end
  );
end;
$$;

drop function private.linha_do_tempo_da_analise(public.conversation_analyses);

commit;
