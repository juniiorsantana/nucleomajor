-- A linha do tempo do relatório da análise (o relatório visual).
--
-- A consulta de andamento passa a devolver, junto do relatório, a sequência
-- das mensagens que o analista leu: quando cada uma chegou e de que lado veio.
-- É dela que o portal tira o tempo entre as mensagens, as pausas longas, as
-- viradas de dia e há quanto tempo a conversa estava parada quando foi
-- analisada. A conta é do portal (domain/analiseDaConversa.js); o banco só
-- entrega os instantes.
--
-- Sem coluna nova e sem backfill: a janela é a mesma do pedido
-- (conversation_analysis_request: as últimas 80 mensagens) até o momento do
-- pedido, e é montada a cada consulta. Vale também para as análises que já
-- existem.
--
-- Conteúdo: só um trecho (90 caracteres) das mensagens que o diagnóstico cita
-- como evidência, para servir de legenda. Quem consulta a análise já lê a
-- conversa inteira no portal (RLS de whatsapp_messages: membro da empresa).
--
-- Nada muda na nota, no diagnóstico nem no runtime da VPS.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.relatorio_da_analise(public.conversation_analyses)') is null then
    raise exception 'abortado: aplicar 20261004100000 (atendimento score v1) antes';
  end if;
  if to_regprocedure('private.linha_do_tempo_da_analise(public.conversation_analyses)') is not null then
    raise exception 'abortado: linha_do_tempo_da_analise ja existe; esta migration ja foi aplicada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/4. A linha do tempo.
-- ---------------------------------------------------------------------------
create function private.linha_do_tempo_da_analise(analise public.conversation_analyses)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with fontes as (
    select analise.result -> 'main_bottleneck' -> 'evidence_message_ids' as lista
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'why_this_score', '[]'::jsonb)) item
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'what_to_do_now', '[]'::jsonb)) item
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'red_flags', '[]'::jsonb)) item
  ),
  citadas as (
    select distinct ids.value as id
    from fontes
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(fontes.lista) = 'array' then fontes.lista else '[]'::jsonb end
    ) ids
  ),
  janela as (
    select m.message_id, m.sent_at, m.is_from_me, m.author_kind, m.media_type, m.content
    from public.whatsapp_messages m
    where m.organization_id = analise.organization_id
      and m.connection_id = analise.connection_id
      and m.contact_phone = analise.contact_phone
      and m.sent_at <= analise.requested_at
    order by m.sent_at desc, m.message_id desc
    limit 80
  )
  select jsonb_build_object(
    'until', analise.requested_at,
    'messages', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', j.message_id,
        'at', j.sent_at,
        'fromMe', j.is_from_me,
        'author', j.author_kind,
        'media', j.media_type,
        'snippet', case when exists (select 1 from citadas c where c.id = j.message_id)
          then pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(j.content, '\s+', ' ', 'g')), 90) end
      ) order by j.sent_at, j.message_id
    ), '[]'::jsonb)
  )
  from janela j;
$$;

revoke all on function private.linha_do_tempo_da_analise(public.conversation_analyses) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/4. A consulta de andamento devolve a linha do tempo.
-- ---------------------------------------------------------------------------
-- Mesmo contrato de 20261004100000, com o campo `timeline` a mais.
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
    'report', case when analise.status = 'done' then private.relatorio_da_analise(analise) end,
    'timeline', case when analise.status = 'done' then private.linha_do_tempo_da_analise(analise) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4/4. Conferência.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'private.linha_do_tempo_da_analise(public.conversation_analyses)', 'execute')
     or has_function_privilege('anon', 'private.linha_do_tempo_da_analise(public.conversation_analyses)', 'execute') then
    raise exception 'conferencia: permissao a mais na linha do tempo';
  end if;
  if has_function_privilege('anon', 'public.conversation_analysis_status(uuid, uuid)', 'execute') then
    raise exception 'conferencia: anon executa a consulta de andamento';
  end if;
end $$;

commit;
