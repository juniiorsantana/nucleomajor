-- A Análise Completa: atendimento + lead + veredito, por 2 créditos.
--
-- Desenho aprovado em 03/10/2026 (canvas do relatório, boards Completa,
-- Escolha e Veredito) e pedido de construção do dono no mesmo dia. Em cima da
-- Avaliação do vendedor v2 (20261008100000):
--
--   * três tipos de análise: atendimento (1 crédito), lead (1) e completa (2).
--     "comercial" continua aceito, para o portal de antes;
--   * o crédito passa a ser contado por análise (`credits`, 1 ou 2), e não
--     por linha;
--   * atendimento.v3 = atendimento.v2 + a nota do lead: necessidade 20,
--     intenção 20, urgência 15, quem decide 15, engajamento 15, objeção 10,
--     encaixe no perfil 5. Nasce como modelo; vira o padrão com
--     `select private.trocar_regua_padrao('atendimento.v3');`, depois que a
--     VPS souber fazer as perguntas do lead;
--   * o relatório analysis.v2 ganha a nota do lead e, na Completa, o veredito
--     do cruzamento (avançar, oportunidade em risco, revisar o processo,
--     nutrir ou soltar), decidido aqui pelo corte de 75 das duas notas. Com
--     menos de 50% avaliado numa das notas, não há veredito.
--
-- Este arquivo é gerado por scripts/sql/gerar-20261010100000.mjs a partir de
-- scripts/sql/molde-20261010100000.sql: o pedido de análise é recortado da
-- 20261004100000 e só as linhas da Completa mudam.

begin;

-- ---------------------------------------------------------------------------
-- 1/8. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.analysis_schemas where definition ->> 'key' = 'atendimento.v3') then
    raise exception 'abortado: atendimento.v3 ja existe; esta migration ja foi aplicada';
  end if;
  if not exists (select 1 from public.analysis_schemas where organization_id is null and definition ->> 'key' = 'atendimento.v2') then
    raise exception 'abortado: aplicar 20261008100000 (avaliacao do vendedor v2) antes';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'conversation_analyses' and column_name = 'credits') then
    raise exception 'abortado: conversation_analyses.credits ja existe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/8. Os tipos e o crédito por análise.
-- ---------------------------------------------------------------------------
alter table public.conversation_analyses
  add column credits smallint not null default 1 check (credits between 1 and 2);

alter table public.conversation_analyses drop constraint conversation_analyses_kind_check;
alter table public.conversation_analyses
  add constraint conversation_analyses_kind_check check (kind in ('comercial', 'atendimento', 'lead', 'completa'));

-- Mesmo corpo de 20261002100000; o uso passa a ser a soma dos créditos.
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
  select coalesce(sum(a.credits), 0) into usados
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

-- ---------------------------------------------------------------------------
-- 3/8. atendimento.v3: a v2 mais a nota do lead, como modelo.
-- ---------------------------------------------------------------------------
-- A parte do atendimento é copiada do modelo da v2 (idêntica). A do lead usa
-- as perguntas de base do Jev que já existem (intenção, necessidade, prazo,
-- quem decide, temperatura) e duas novas (lead_objection, lead_fit). Nota do
-- lead: a qualidade do lead, não do trabalho da equipe.
insert into public.analysis_schemas (organization_id, version, status, definition, notes)
select
  null,
  3,
  'draft',
  jsonb_set(
    jsonb_set(s.definition, '{key}', '"atendimento.v3"'),
    '{scores,lead}',
    jsonb_build_object(
      'stateFactors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0}'::jsonb,
      'dimensions', jsonb_build_array(
        jsonb_build_object('key', 'need', 'name', 'Necessidade', 'weight', 20, 'source', 'jev',
          'criteria', jsonb_build_array(jsonb_build_object('key', 'need',
            'when', jsonb_build_object('source', 'classification', 'path', 'disse_necessidade', 'minConfidence', 0.6),
            'factors', '{"sim": 1.0, "nao": 0.2}'::jsonb))),
        jsonb_build_object('key', 'intent', 'name', 'Intenção', 'weight', 20, 'source', 'jev',
          'criteria', jsonb_build_array(jsonb_build_object('key', 'intent',
            'when', jsonb_build_object('source', 'classification', 'path', 'intencao', 'minConfidence', 0.6),
            'factors', '{"comprar_agora": 1.0, "pesquisando": 0.6, "curiosidade": 0.2, "fora_do_perfil": 0.0, "ja_cliente": null}'::jsonb))),
        jsonb_build_object('key', 'urgency', 'name', 'Urgência', 'weight', 15, 'source', 'jev',
          'criteria', jsonb_build_array(jsonb_build_object('key', 'urgency',
            'when', jsonb_build_object('source', 'classification', 'path', 'prazo', 'minConfidence', 0.6),
            'factors', '{"agora": 1.0, "este_mes": 0.6, "sem_prazo": 0.2, "nao_falou": null}'::jsonb))),
        jsonb_build_object('key', 'decision', 'name', 'Quem decide', 'weight', 15, 'source', 'jev',
          'criteria', jsonb_build_array(jsonb_build_object('key', 'decision',
            'when', jsonb_build_object('source', 'classification', 'path', 'decisor', 'minConfidence', 0.6),
            'factors', '{"o_proprio": 1.0, "outra_pessoa": 0.6, "nao_da_para_saber": null}'::jsonb))),
        jsonb_build_object('key', 'engagement', 'name', 'Engajamento', 'weight', 15, 'source', 'jev',
          'criteria', jsonb_build_array(jsonb_build_object('key', 'engagement',
            'when', jsonb_build_object('source', 'classification', 'path', 'temperatura', 'minConfidence', 0.6),
            'factors', '{"quente": 1.0, "morno": 0.6, "frio": 0.2}'::jsonb))),
        jsonb_build_object('key', 'objection', 'name', 'Objeção', 'weight', 10, 'source', 'jev',
          'criteria', jsonb_build_array(jsonb_build_object('key', 'objection',
            'when', jsonb_build_object('source', 'classification', 'path', 'lead_objection', 'minConfidence', 0.6),
            'factors', '{"nenhuma": 1.0, "contornavel": 0.6, "forte": 0.2, "impeditiva": 0.0, "nao_avaliado": null}'::jsonb))),
        jsonb_build_object('key', 'fit', 'name', 'Encaixe no perfil', 'weight', 5, 'source', 'jev+playbook',
          'criteria', jsonb_build_array(jsonb_build_object('key', 'fit',
            'when', jsonb_build_object('source', 'classification', 'path', 'lead_fit', 'minConfidence', 0.6),
            'factors', '{"dentro": 1.0, "parcial": 0.6, "fora": 0.0, "nao_avaliado": null}'::jsonb)))
      )
    )
  ),
  'Atendimento v2 + nota do lead (Analise Completa, 03/10/2026). Vira o padrao com private.trocar_regua_padrao.'
from public.analysis_schemas s
where s.organization_id is null and s.definition ->> 'key' = 'atendimento.v2'
order by s.version desc
limit 1;

-- O painel da plataforma também aceita a v3 por empresa.
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
  if schema_key not in ('atendimento.v1', 'atendimento.v2', 'atendimento.v3') then
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

-- ---------------------------------------------------------------------------
-- 4/8. O pedido de análise aceita lead e completa e cobra o custo certo.
-- ---------------------------------------------------------------------------
-- Corpo de 20261004100000; mudam só o tipo aceito, o custo (completa = 2) e a
-- coluna `credits` gravada.
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
  -- A Completa (atendimento + lead + veredito) custa 2 créditos; o resto, 1.
  custo integer := case when lower(trim(coalesce(analysis_kind, ''))) = 'completa' then 2 else 1 end;
  nova uuid;
  comando uuid;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if tipo not in ('comercial', 'atendimento', 'lead', 'completa') then
    raise exception 'analysis kind must be comercial, atendimento, lead or completa';
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
  if saldo ->> 'limit' is not null and (saldo ->> 'left')::integer < custo then
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
    lead_score, service_score, credits
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
    (avaliacao ->> 'service')::smallint,
    custo
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

-- ---------------------------------------------------------------------------
-- 5/8. A faixa de uma nota e o veredito do cruzamento.
-- ---------------------------------------------------------------------------
-- Faixas iguais para as duas notas (75+ bom, 50 a 74 atenção, abaixo de 50
-- ruim). O veredito só existe com as duas notas conclusivas (50% ou mais
-- avaliado) e usa o corte de 75 de cada uma.
create function private.veredito_do_cruzamento(atendimento jsonb, lead jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  nota_atendimento numeric := (atendimento ->> 'score')::numeric;
  nota_lead numeric := (lead ->> 'score')::numeric;
  conclusivo boolean;
  chave text;
begin
  conclusivo := nota_atendimento is not null and nota_lead is not null
    and coalesce((atendimento ->> 'evaluatedWeight')::numeric, 0) * 2 >= coalesce((atendimento ->> 'maxWeight')::numeric, 1)
    and coalesce((lead ->> 'evaluatedWeight')::numeric, 0) * 2 >= coalesce((lead ->> 'maxWeight')::numeric, 1);
  if not conclusivo then
    return jsonb_build_object('key', 'sem_conclusao', 'label', 'Ainda sem conclusão');
  end if;
  chave := case
    when nota_lead >= 75 and nota_atendimento >= 75 then 'avancar'
    when nota_lead >= 75 then 'em_risco'
    when nota_atendimento >= 75 then 'nutrir_ou_soltar'
    else 'revisar_processo'
  end;
  return jsonb_build_object(
    'key', chave,
    'label', case chave
      when 'avancar' then 'Avançar'
      when 'em_risco' then 'Oportunidade em risco'
      when 'nutrir_ou_soltar' then 'Nutrir ou soltar'
      else 'Revisar o processo' end,
    'lead_good', nota_lead >= 75,
    'service_good', nota_atendimento >= 75
  );
end;
$$;

revoke all on function private.veredito_do_cruzamento(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6/8. O relatório analysis.v2 com a nota do lead e o veredito.
-- ---------------------------------------------------------------------------
-- Mesmo corpo de 20261008100000, com três acréscimos: `lead_score` (estados,
-- pontos e o porquê de cada ponto, de `lead_why` do diagnóstico), `matrix`
-- (só na Completa) e, no diagnóstico, `lead_verdict`, `lead_why` e
-- `matrix_explanation`.
create or replace function private.relatorio_do_vendedor(analise public.conversation_analyses)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  familia jsonb := analise.scores -> 'atendimento';
  familia_lead jsonb := analise.scores -> 'lead';
  fatores jsonb;
  diagnostico jsonb := case when analise.result ->> 'schema_version' = 'analysis_report.v2' then analise.result end;
  motivos jsonb;
  motivos_lead jsonb;
  criterios jsonb := '[]'::jsonb;
  criterios_lead jsonb := '[]'::jsonb;
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
  nota_lead integer;
  cobertura_lead integer;
  faixa_lead text;
begin
  fatores := coalesce(familia -> 'stateFactors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0}'::jsonb);
  motivos := coalesce(diagnostico -> 'why_this_score', '[]'::jsonb);
  motivos_lead := coalesce(diagnostico -> 'lead_why', '[]'::jsonb);
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

  for dimensao in select value from jsonb_array_elements(coalesce(familia_lead -> 'dimensions', '[]'::jsonb)) loop
    fator := (dimensao ->> 'factor')::numeric;
    estado := case when fator is null then 'nao_avaliado'
      else coalesce((select f.key from jsonb_each_text(fatores) f where f.value::numeric = fator limit 1), 'avaliado') end;
    select m.value into motivo
    from jsonb_array_elements(motivos_lead) m
    where m.value ->> 'criterion' = dimensao ->> 'key'
    limit 1;
    criterios_lead := criterios_lead || jsonb_build_object(
      'key', dimensao ->> 'key',
      'name', dimensao ->> 'name',
      'weight', dimensao -> 'weight',
      'status', estado,
      'state', dimensao -> 'criteria' -> 0 -> 'value',
      'score_factor', dimensao -> 'factor',
      'points_awarded', dimensao -> 'points',
      'reason', motivo ->> 'explanation',
      'evidence_message_ids', coalesce(motivo -> 'evidence_message_ids', '[]'::jsonb)
    );
    motivo := null;
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

  nota_lead := (familia_lead ->> 'score')::integer;
  cobertura_lead := case when coalesce((familia_lead ->> 'maxWeight')::numeric, 0) > 0
    then round(100 * coalesce((familia_lead ->> 'evaluatedWeight')::numeric, 0) / (familia_lead ->> 'maxWeight')::numeric) end;
  faixa_lead := case
    when nota_lead is null then null
    when nota_lead >= 75 then 'bom'
    when nota_lead >= 50 then 'atencao'
    else 'ruim'
  end;

  return jsonb_build_object(
    'schema_version', 'analysis.v2',
    'conversation_id', analise.connection_id::text || ':' || analise.contact_phone,
    'generated_at', analise.completed_at,
    'kind', analise.kind,
    'credits', analise.credits,
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
    'lead_score', case when familia_lead is null then null else jsonb_build_object(
      'score', to_jsonb(nota_lead),
      'max_score', 100,
      'evaluated_weight', familia_lead -> 'evaluatedWeight',
      'max_weight', familia_lead -> 'maxWeight',
      'coverage', cobertura_lead,
      'conclusive', nota_lead is not null and coalesce(cobertura_lead, 0) >= 50,
      'band', faixa_lead,
      'band_label', case faixa_lead when 'bom' then 'Bom' when 'atencao' then 'Atenção' when 'ruim' then 'Ruim' end,
      'criteria', criterios_lead
    ) end,
    'matrix', case when analise.kind = 'completa' and familia is not null and familia_lead is not null
      then private.veredito_do_cruzamento(familia, familia_lead) end,
    'diagnosis', case when diagnostico is null then null else jsonb_build_object(
      'summary', diagnostico -> 'summary',
      'verdict', diagnostico -> 'verdict',
      'did_well', coalesce(diagnostico -> 'did_well', '[]'::jsonb),
      'cost_the_sale', coalesce(diagnostico -> 'cost_the_sale', '[]'::jsonb),
      'lead_verdict', diagnostico -> 'lead_verdict',
      'lead_why', motivos_lead,
      'matrix_explanation', diagnostico -> 'matrix_explanation',
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

-- ---------------------------------------------------------------------------
-- 7/8. A linha do tempo também cita o porquê da nota do lead.
-- ---------------------------------------------------------------------------
-- Mesmo corpo de 20261008100000, com `lead_why` como fonte de evidência.
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
    union all
    select item.value -> 'evidence_message_ids'
    from jsonb_array_elements(coalesce(analise.result -> 'lead_why', '[]'::jsonb)) item
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
-- 8/8. Conferência.
-- ---------------------------------------------------------------------------
do $$
declare
  modelo jsonb;
  notas jsonb;
  pesos numeric;
begin
  select definition into modelo from public.analysis_schemas
  where organization_id is null and definition ->> 'key' = 'atendimento.v3';
  if modelo is null then
    raise exception 'conferencia: atendimento.v3 nao entrou como modelo';
  end if;
  if modelo -> 'scores' -> 'atendimento' is distinct from (
       select s.definition -> 'scores' -> 'atendimento' from public.analysis_schemas s
       where s.organization_id is null and s.definition ->> 'key' = 'atendimento.v2' order by s.version desc limit 1) then
    raise exception 'conferencia: a parte do atendimento da v3 difere da v2';
  end if;
  select sum((d ->> 'weight')::numeric) into pesos
  from jsonb_array_elements(modelo -> 'scores' -> 'lead' -> 'dimensions') d;
  if pesos <> 100 then
    raise exception 'conferencia: pesos do lead somam % e nao 100', pesos;
  end if;

  -- Lead do exemplo: necessidade e intenção boas (20 + 20), prazo este mês
  -- (9), outra pessoa decide (9), quente (15), objeção contornável (6),
  -- encaixe sem dado (fora). 79 de 95 = 83.
  notas := private.pontuar(modelo, '{}'::jsonb, '{
    "disse_necessidade": {"a": "sim", "p": 0.9},
    "intencao": {"a": "comprar_agora", "p": 0.8},
    "prazo": {"a": "este_mes", "p": 0.7},
    "decisor": {"a": "outra_pessoa", "p": 0.9},
    "temperatura": {"a": "quente", "p": 0.8},
    "lead_objection": {"a": "contornavel", "p": 0.8},
    "lead_fit": {"a": "nao_avaliado", "p": 0.9}
  }'::jsonb);
  if (notas -> 'lead' ->> 'score')::integer is distinct from 83
     or (notas -> 'lead' ->> 'evaluatedWeight')::numeric <> 95 then
    raise exception 'conferencia: o lead do exemplo nao deu 83 de 95 (%)', notas -> 'lead';
  end if;
  if private.veredito_do_cruzamento('{"score": 45, "evaluatedWeight": 88, "maxWeight": 100}', '{"score": 83, "evaluatedWeight": 95, "maxWeight": 100}') ->> 'key' <> 'em_risco'
     or private.veredito_do_cruzamento('{"score": 45, "evaluatedWeight": 30, "maxWeight": 100}', '{"score": 83, "evaluatedWeight": 95, "maxWeight": 100}') ->> 'key' <> 'sem_conclusao' then
    raise exception 'conferencia: o veredito do cruzamento nao bate com o desenho';
  end if;
  if exists (select 1 from public.analysis_schemas where organization_id is null and status = 'published'
             and definition ->> 'key' = 'atendimento.v3') then
    raise exception 'conferencia: a v3 nao pode nascer publicada';
  end if;
  if has_function_privilege('authenticated', 'private.veredito_do_cruzamento(jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.conversation_analysis_request(uuid, uuid, text, text)', 'execute') then
    raise exception 'conferencia: permissao a mais';
  end if;
end $$;

commit;
