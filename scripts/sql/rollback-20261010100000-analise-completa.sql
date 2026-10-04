-- Rollback da 20261010100000 (Análise Completa).
--
-- Gerado por scripts/sql/gerar-rollback-20261010100000.mjs: cada função volta
-- EXATAMENTE ao corpo da migration de antes. A régua volta para a v2 se a v3
-- estiver em vigor; o modelo e as réguas da v3 ficam aposentados, não
-- apagados. As análises feitas continuam no banco: as de tipo lead e
-- completa ficam guardadas, e por isso a trava de tipos só volta ao que era
-- quando não houver nenhuma delas. A coluna de créditos sai (o uso volta a
-- ser uma linha por análise).

begin;

do $$
begin
  if to_regprocedure('private.veredito_do_cruzamento(jsonb, jsonb)') is null then
    raise exception 'abortado: a 20261010100000 nao esta aplicada';
  end if;
end $$;

-- 1. A régua: v2 de novo onde a v3 estiver valendo.
update public.analysis_schemas set status = 'retired'
where organization_id is not null and definition ->> 'key' = 'atendimento.v3' and status = 'published';
do $$
begin
  if exists (select 1 from public.analysis_schemas where organization_id is null and status = 'published'
             and definition ->> 'key' = 'atendimento.v3') then
    perform private.trocar_regua_padrao('atendimento.v2');
  end if;
end $$;

-- 2. As funções de antes.
create or replace function private.creditos_de_analise(target_organization uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  limites jsonb := private.org_limits(target_organization);
  limite integer;
  inicio timestamptz := private.ciclo_de_analise(target_organization);
  usados integer;
begin
  if limites ? 'analysis_credits' then
    limite := nullif(limites ->> 'analysis_credits', '')::integer;
  else
    limite := 0;
  end if;
  select count(*) into usados
  from public.conversation_analyses a
  where a.organization_id = target_organization
    and a.requested_at >= inicio
    and a.status <> 'failed';
  return jsonb_build_object(
    'limit', limite,
    'used', usados,
    'left', case when limite is null then null else greatest(0, limite - usados) end,
    'cycleStart', inicio,
    'renewsAt', private.renovacao_de_analise(target_organization)
  );
end;
$$;

revoke all on function private.creditos_de_analise(uuid) from public, anon, authenticated;

create or replace function public.conversation_analysis_request(
  target_organization uuid,
  target_connection uuid,
  target_chat text,
  analysis_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat text := pg_catalog.regexp_replace(coalesce(target_chat, ''), '[^0-9-]', '', 'g');
  tipo text := lower(trim(coalesce(analysis_kind, '')));
  conexao uuid := target_connection;
  conversa public.whatsapp_conversations%rowtype;
  saldo jsonb;
  em_andamento public.conversation_analyses%rowtype;
  contato uuid;
  agente uuid;
  perfil public.assistant_profiles%rowtype;
  mensagens jsonb;
  leitura public.conversation_insight_runs%rowtype;
  avaliacao jsonb := '{}'::jsonb;
  versao_playbook integer;
  nova uuid;
  comando uuid;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if tipo not in ('comercial', 'atendimento') then
    raise exception 'analysis kind must be comercial or atendimento';
  end if;
  if conexao is null then
    conexao := private.conexao_da_organizacao(target_organization);
  end if;

  select * into conversa
  from public.whatsapp_conversations c
  where c.organization_id = target_organization
    and c.connection_id = conexao
    and c.contact_phone = chat;
  if not found then
    raise exception 'conversation is not mirrored for this connection';
  end if;
  if conversa.chat_kind <> 'direto' then
    raise exception 'group conversations cannot be analyzed';
  end if;

  -- Um pedido por vez por empresa daqui até o fim da transação: dois cliques
  -- rápidos não gastam dois créditos nem passam do limite.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('analise:' || target_organization::text));

  -- Já há uma análise desta conversa em andamento: devolve a mesma.
  select * into em_andamento
  from public.conversation_analyses a
  where a.connection_id = conexao
    and a.contact_phone = chat
    and a.status in ('pending', 'running')
    and a.requested_at > now() - interval '15 minutes'
  order by a.requested_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'analysisId', em_andamento.id,
      'status', em_andamento.status,
      'reused', true,
      'credits', private.creditos_de_analise(target_organization)
    );
  end if;

  saldo := private.creditos_de_analise(target_organization);
  if saldo ->> 'limit' is not null and (saldo ->> 'left')::integer <= 0 then
    raise exception 'no analysis credits left';
  end if;

  -- Rascunhos com mais de 7 dias perdem o texto, mas continuam contando no
  -- ciclo e guardando fatos e notas.
  update public.conversation_analyses a
  set status = 'expired', result = '{}'::jsonb
  where a.organization_id = target_organization
    and a.status = 'done'
    and a.saved_at is null
    and a.completed_at < now() - interval '7 days';

  select c.id into contato
  from public.contacts c
  where c.organization_id = target_organization
    and c.deleted_at is null
    and length(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 8
    and pg_catalog.right(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) = pg_catalog.right(chat, 8)
  order by c.created_at
  limit 1;

  agente := private.agente_da_conversa(target_organization, conexao, chat);
  select * into perfil from public.assistant_profiles p where p.id = agente and p.organization_id = target_organization;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ultima.message_id,
      'sentAt', ultima.sent_at,
      'fromMe', ultima.is_from_me,
      'authorKind', ultima.author_kind,
      'mediaType', ultima.media_type,
      'content', pg_catalog.left(ultima.content, 1500)
    ) order by ultima.sent_at, ultima.message_id
  ), '[]'::jsonb)
  into mensagens
  from (
    select m.sent_at, m.message_id, m.is_from_me, m.author_kind, m.media_type, m.content
    from public.whatsapp_messages m
    where m.connection_id = conexao and m.contact_phone = chat
    order by m.sent_at desc, m.message_id desc
    limit 80
  ) ultima;
  if pg_catalog.jsonb_array_length(mensagens) = 0 then
    raise exception 'conversation has no messages';
  end if;

  select * into leitura
  from public.conversation_insight_runs r
  where r.connection_id = conexao and r.contact_phone = chat and r.is_latest
  limit 1;

  -- Fatos e notas: se algo falhar aqui, a análise segue sem eles. O botão é
  -- pago; ele não pode parar por causa da camada de medida.
  begin
    avaliacao := private.avaliar_conversa(target_organization, conexao, chat, coalesce(leitura.summary, '{}'::jsonb));
  exception when others then
    avaliacao := '{}'::jsonb;
  end;

  select coalesce(max(p.published_version), 0) into versao_playbook
  from public.organization_playbooks p
  where p.organization_id = target_organization;

  insert into public.conversation_analyses (
    organization_id, connection_id, contact_phone, contact_id, kind, requested_by, cycle_start,
    facts, facts_version, classification, reading_id, scores, schema_version, playbook_version,
    lead_score, service_score
  ) values (
    target_organization, conexao, chat, contato, tipo, auth.uid(), (saldo ->> 'cycleStart')::timestamptz,
    coalesce(avaliacao -> 'facts', '{}'::jsonb),
    coalesce((avaliacao -> 'facts' ->> 'version')::smallint, 0),
    coalesce(leitura.summary, '{}'::jsonb),
    leitura.id,
    coalesce(avaliacao -> 'scores', '{}'::jsonb),
    coalesce((avaliacao ->> 'schemaVersion')::integer, 0),
    versao_playbook,
    (avaliacao ->> 'lead')::smallint,
    (avaliacao ->> 'service')::smallint
  )
  returning id into nova;

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload, created_by, idempotency_key, expires_at
  ) values (
    target_organization,
    conexao,
    'conversation_analyze',
    jsonb_build_object(
      'analysisId', nova,
      'kind', tipo,
      'messages', mensagens,
      'reading', coalesce(leitura.summary, '{}'::jsonb),
      'facts', coalesce(avaliacao -> 'facts', '{}'::jsonb),
      'scores', coalesce(avaliacao -> 'scores', '{}'::jsonb),
      -- O playbook efetivo: o da empresa; sem ele, o Playbook Base Major.
      'playbook', private.playbook_efetivo(target_organization),
      'agent', case when perfil.id is null then null else jsonb_build_object('name', perfil.display_name, 'tone', perfil.tone) end,
      'stages', coalesce((select jsonb_agg(s.name order by s.position) from public.stages s where s.organization_id = target_organization and s.deleted_at is null), '[]'::jsonb),
      'tags', coalesce((select jsonb_agg(t.name order by t.name) from public.tags t where t.organization_id = target_organization and t.deleted_at is null), '[]'::jsonb),
      'hasContact', contato is not null
    ),
    auth.uid(),
    encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'),
    now() + interval '15 minutes'
  )
  returning id into comando;

  update public.conversation_analyses set command_id = comando where id = nova;

  return jsonb_build_object(
    'analysisId', nova,
    'status', 'pending',
    'reused', false,
    'credits', private.creditos_de_analise(target_organization)
  );
end;
$$;

create or replace function private.relatorio_do_vendedor(analise public.conversation_analyses)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  familia jsonb := analise.scores -> 'atendimento';
  fatores jsonb;
  diagnostico jsonb := case when analise.result ->> 'schema_version' = 'analysis_report.v2' then analise.result end;
  motivos jsonb;
  criterios jsonb := '[]'::jsonb;
  dimensao jsonb;
  motivo jsonb;
  fator numeric;
  estado text;
  bandeiras jsonb;
  nota integer;
  avaliado numeric;
  maximo numeric;
  cobertura integer;
  faixa text;
begin
  fatores := coalesce(familia -> 'stateFactors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0}'::jsonb);
  motivos := coalesce(diagnostico -> 'why_this_score', '[]'::jsonb);
  bandeiras := coalesce(diagnostico -> 'red_flags', '[]'::jsonb);

  for dimensao in select value from jsonb_array_elements(coalesce(familia -> 'dimensions', '[]'::jsonb)) loop
    fator := (dimensao ->> 'factor')::numeric;
    estado := case when fator is null then 'nao_avaliado'
      else coalesce((select f.key from jsonb_each_text(fatores) f where f.value::numeric = fator limit 1), 'avaliado') end;
    select m.value into motivo
    from jsonb_array_elements(motivos) m
    where m.value ->> 'criterion' = dimensao ->> 'key'
    limit 1;
    criterios := criterios || jsonb_build_object(
      'key', dimensao ->> 'key',
      'name', dimensao ->> 'name',
      'weight', dimensao -> 'weight',
      'status', estado,
      'state', dimensao -> 'criteria' -> 0 -> 'value',
      'score_factor', dimensao -> 'factor',
      'points_awarded', dimensao -> 'points',
      'critique', motivo ->> 'explanation',
      'better', motivo ->> 'better',
      'evidence_message_ids', coalesce(motivo -> 'evidence_message_ids', '[]'::jsonb)
    );
    motivo := null;

    if dimensao ->> 'key' = 'advance' and dimensao -> 'criteria' -> 0 ->> 'value' = 'continuacao'
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'conversation_left_open') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'conversation_left_open', 'severity', null, 'criterion', 'advance', 'source', 'regra',
        'reason', 'A conversa terminou sem nenhum compromisso do cliente com data.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
    if dimensao ->> 'key' = 'promises' and dimensao -> 'criteria' -> 0 ->> 'value' = 'vencida_sem_entrega'
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'broken_promise') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'broken_promise', 'severity', null, 'criterion', 'promises', 'source', 'regra',
        'reason', 'O vendedor prometeu algo ao cliente, o prazo passou e não entregou.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
  end loop;

  nota := (familia ->> 'score')::integer;
  avaliado := coalesce((familia ->> 'evaluatedWeight')::numeric, 0);
  maximo := coalesce((familia ->> 'maxWeight')::numeric, 0);
  cobertura := case when maximo > 0 then round(100 * avaliado / maximo) end;
  faixa := case
    when nota is null then null
    when nota >= 75 then 'vendeu_bem'
    when nota >= 50 then 'nao_fecha'
    else 'atrapalhou'
  end;

  return jsonb_build_object(
    'schema_version', 'analysis.v2',
    'conversation_id', analise.connection_id::text || ':' || analise.contact_phone,
    'generated_at', analise.completed_at,
    'kind', analise.kind,
    'score_schema_version', analise.schema_version,
    'facts_version', analise.facts_version,
    'playbook_version', analise.playbook_version,
    'seller', analise.facts -> 'seller',
    'speed', analise.facts -> 'speed',
    'vendedor_score', case when familia is null then null else jsonb_build_object(
      'score', to_jsonb(nota),
      'max_score', 100,
      'evaluated_weight', familia -> 'evaluatedWeight',
      'max_weight', familia -> 'maxWeight',
      'coverage', cobertura,
      'conclusive', nota is not null and coalesce(cobertura, 0) >= 50,
      'band', faixa,
      'band_label', case faixa when 'vendeu_bem' then 'Vendeu bem' when 'nao_fecha' then 'Atende, mas não fecha'
        when 'atrapalhou' then 'Atrapalhou a venda' end,
      'criteria', criterios
    ) end,
    'diagnosis', case when diagnostico is null then null else jsonb_build_object(
      'summary', diagnostico -> 'summary',
      'verdict', diagnostico -> 'verdict',
      'did_well', coalesce(diagnostico -> 'did_well', '[]'::jsonb),
      'cost_the_sale', coalesce(diagnostico -> 'cost_the_sale', '[]'::jsonb),
      'main_bottleneck', diagnostico -> 'main_bottleneck',
      'why_this_score', motivos,
      'what_to_do_now', coalesce(diagnostico -> 'what_to_do_now', '[]'::jsonb),
      'suggested_message', diagnostico -> 'suggested_message',
      'red_flags', bandeiras
    ) end,
    'red_flags', bandeiras
  );
end;
$$;

revoke all on function private.relatorio_do_vendedor(public.conversation_analyses) from public, anon, authenticated;

create or replace function private.linha_do_tempo_da_analise(analise public.conversation_analyses)
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
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'did_well', '[]'::jsonb)) item
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'cost_the_sale', '[]'::jsonb)) item
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

create or replace function public.platform_analysis_schema_set(target_organization uuid, schema_key text, note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes text;
  depois jsonb;
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'platform administrator permission required';
  end if;
  if schema_key not in ('atendimento.v1', 'atendimento.v2') then
    raise exception 'unknown analysis schema';
  end if;
  antes := private.regua_da_empresa(target_organization);
  depois := private.ligar_regua(target_organization, schema_key);
  perform private.platform_audit(
    target_organization, 'analysis_schema.set', schema_key,
    jsonb_build_object('schema', antes), depois, note
  );
  return depois;
end;
$$;

revoke all on function public.platform_analysis_schema_set(uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_analysis_schema_set(uuid, text, text) to authenticated;

drop function private.veredito_do_cruzamento(jsonb, jsonb);

-- 3. A coluna e a trava de tipos.
alter table public.conversation_analyses drop column credits;
do $$
begin
  if not exists (select 1 from public.conversation_analyses where kind in ('lead', 'completa')) then
    alter table public.conversation_analyses drop constraint conversation_analyses_kind_check;
    alter table public.conversation_analyses
      add constraint conversation_analyses_kind_check check (kind in ('comercial', 'atendimento'));
  end if;
end $$;

commit;
