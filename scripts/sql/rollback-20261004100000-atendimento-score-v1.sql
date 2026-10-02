-- ROLLBACK de 20261004100000_atendimento_score_v1.sql.
--
-- Não é migration: fica fora de supabase/migrations de propósito. Só rodar
-- pelo SQL Editor se for preciso desfazer a v1. Volta as funções ao estado de
-- antes dela (corpos copiados, sem mudança, de 20261001100000, 20261002100000
-- e 20261003100000), remove as funções novas e APOSENTA o atendimento.v1 (não
-- apaga: leituras e análises gravadas apontam para a versão 1). As notas já
-- gravadas ficam como estão; leituras novas voltam a sair sem nota.
-- Para reaplicar a v1 depois, apague antes a linha aposentada do
-- atendimento.v1 (nada tem chave estrangeira para ela; a guarda da migration
-- recusa reaplicar enquanto ela existir).

begin;

do $$
begin
  if to_regprocedure('public.nucleo_analysis_classify(jsonb)') is null then
    raise exception 'abortado: a v1 nao esta aplicada';
  end if;
end $$;

create or replace function private.fatos_da_conversa(
  target_organization uuid,
  target_connection uuid,
  telefone text,
  ate timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  limite timestamptz := coalesce(ate, now());
  conversa public.whatsapp_conversations%rowtype;
  m record;
  lado text;
  anterior_lado text;
  anterior_em timestamptz;
  turno_em timestamptz;
  ultimo_da_empresa text;
  total integer := 0;
  do_contato integer := 0;
  da_ia integer := 0;
  da_equipe integer := 0;
  do_bot integer := 0;
  audios integer := 0;
  primeira_em timestamptz;
  ultima_em timestamptz;
  iniciou text;
  primeira_resposta integer;
  respostas integer[] := '{}';
  retomadas integer := 0;
  ia_para_equipe integer := 0;
  equipe_para_ia integer := 0;
  primeira_equipe_em timestamptz;
  equipe uuid[] := '{}';
  contato public.contacts%rowtype;
  negocio jsonb;
  tarefas jsonb;
  agenda jsonb;
  mediana integer;
begin
  select * into conversa
  from public.whatsapp_conversations c
  where c.organization_id = target_organization
    and c.connection_id = target_connection
    and c.contact_phone = telefone;
  if not found then
    return '{}'::jsonb;
  end if;

  for m in
    select ultimas.*
    from (
      select msg.sent_at, msg.message_id, msg.is_from_me, msg.author_kind, msg.author_id, msg.media_type
      from public.whatsapp_messages msg
      where msg.organization_id = target_organization
        and msg.connection_id = target_connection
        and msg.contact_phone = telefone
        and msg.sent_at <= limite
      order by msg.sent_at desc, msg.message_id desc
      limit 2000
    ) ultimas
    order by ultimas.sent_at, ultimas.message_id
  loop
    lado := case
      when not m.is_from_me then 'contact'
      when m.author_kind = 'ia' then 'ai'
      when m.author_kind = 'bot' then 'bot'
      else 'team'
    end;
    total := total + 1;
    if primeira_em is null then
      primeira_em := m.sent_at;
      iniciou := case when lado = 'contact' then 'contact' else 'company' end;
    end if;
    ultima_em := m.sent_at;

    if lado = 'contact' then
      do_contato := do_contato + 1;
      if lower(m.media_type) in ('audio', 'ptt') then
        audios := audios + 1;
      end if;
      if turno_em is null then
        turno_em := m.sent_at;
      end if;
    else
      if lado = 'ai' then da_ia := da_ia + 1;
      elsif lado = 'bot' then do_bot := do_bot + 1;
      else da_equipe := da_equipe + 1;
      end if;

      if anterior_lado is not null and anterior_lado <> 'contact'
         and m.sent_at - anterior_em >= interval '24 hours' then
        retomadas := retomadas + 1;
      end if;

      if lado in ('ai', 'team') then
        if turno_em is not null then
          respostas := respostas || greatest(0, extract(epoch from m.sent_at - turno_em))::integer;
          if primeira_resposta is null then
            primeira_resposta := respostas[1];
          end if;
          turno_em := null;
        end if;
        if ultimo_da_empresa = 'ai' and lado = 'team' then
          ia_para_equipe := ia_para_equipe + 1;
        elsif ultimo_da_empresa = 'team' and lado = 'ai' then
          equipe_para_ia := equipe_para_ia + 1;
        end if;
        ultimo_da_empresa := lado;
      end if;

      if lado = 'team' then
        primeira_equipe_em := coalesce(primeira_equipe_em, m.sent_at);
        if m.author_id is not null and not (m.author_id = any(equipe)) then
          equipe := equipe || m.author_id;
        end if;
      end if;
    end if;

    anterior_lado := lado;
    anterior_em := m.sent_at;
  end loop;

  if array_length(respostas, 1) > 0 then
    select percentile_disc(0.5) within group (order by r) into mediana from unnest(respostas) r;
  end if;

  -- O contato do CRM, pelos 8 últimos dígitos (a mesma regra do pedido de
  -- análise). Grupo não tem contato.
  if conversa.chat_kind = 'direto' then
    select c.* into contato
    from public.contacts c
    where c.organization_id = target_organization
      and c.deleted_at is null
      and length(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 8
      and pg_catalog.right(pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) = pg_catalog.right(telefone, 8)
    order by c.created_at
    limit 1;
  end if;

  if contato.id is not null then
    -- O negócio que importa: o aberto mais recente; sem aberto, o último.
    select jsonb_build_object(
      'id', d.id,
      'status', d.status,
      'stage', s.name,
      'stagePosition', s.position,
      'value', d.value,
      'createdAt', d.created_at,
      'closedAt', d.closed_at
    ) into negocio
    from public.deals d
    left join public.stages s on s.id = d.stage_id
    where d.organization_id = target_organization
      and d.contact_id = contato.id
      and d.deleted_at is null
    order by (d.status = 'aberto') desc, d.created_at desc
    limit 1;

    select jsonb_build_object(
      'open', count(*) filter (where not t.completed),
      'overdue', count(*) filter (where not t.completed and t.due_at < limite)
    ) into tarefas
    from public.tasks t
    where t.organization_id = target_organization
      and t.contact_id = contato.id
      and t.deleted_at is null;

    select jsonb_build_object(
      'scheduled', count(*) filter (where e.starts_at >= limite),
      'past', count(*) filter (where e.starts_at < limite),
      'next', min(e.starts_at) filter (where e.starts_at >= limite)
    ) into agenda
    from public.calendar_events e
    where e.organization_id = target_organization
      and e.contact_id = contato.id
      and e.deleted_at is null
      and e.status = 'scheduled';
  end if;

  return jsonb_build_object(
    'version', 1,
    'until', limite,
    'messages', jsonb_build_object(
      'total', total, 'contact', do_contato, 'ai', da_ia, 'team', da_equipe, 'bot', do_bot,
      'contactAudio', audios
    ),
    'firstMessageAt', primeira_em,
    'lastMessageAt', ultima_em,
    'startedBy', iniciou,
    'lastSpeaker', anterior_lado,
    'hoursSinceLastMessage', case when ultima_em is null then null
      else round((extract(epoch from limite - ultima_em) / 3600)::numeric, 1) end,
    'waitingReply', turno_em is not null,
    'hoursWaiting', case when turno_em is null then null
      else round((extract(epoch from limite - turno_em) / 3600)::numeric, 1) end,
    'firstResponseSeconds', primeira_resposta,
    'responses', jsonb_build_object(
      'count', coalesce(array_length(respostas, 1), 0),
      'medianSeconds', mediana,
      'maxSeconds', (select max(r) from unnest(respostas) r)
    ),
    'followUps', retomadas,
    'handoff', jsonb_build_object(
      'aiToTeam', ia_para_equipe, 'teamToAi', equipe_para_ia, 'firstTeamAt', primeira_equipe_em
    ),
    'owner', conversa.owner,
    'attendantId', conversa.attendant_id,
    'teamAuthors', to_jsonb(equipe),
    'contactId', contato.id,
    'isLead', contato.lead_at is not null,
    'deal', negocio,
    'tasks', coalesce(tarefas, jsonb_build_object('open', 0, 'overdue', 0)),
    'meetings', coalesce(agenda, jsonb_build_object('scheduled', 0, 'past', 0, 'next', null))
  );
end;
$$;

create or replace function private.pontuar(definicao jsonb, fatos jsonb, classificacao jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  familia text;
  corpo jsonb;
  dimensao jsonb;
  criterio jsonb;
  criterios jsonb;
  resultado jsonb := '{}'::jsonb;
  dimensoes jsonb;
  avaliados jsonb;
  peso numeric;
  atingido numeric;
  avaliado numeric;
  nota numeric;
  soma numeric;
  pesos numeric;
  atendida boolean;
begin
  if definicao is null or jsonb_typeof(definicao -> 'scores') is distinct from 'object' then
    return '{}'::jsonb;
  end if;

  for familia, corpo in select key, value from jsonb_each(definicao -> 'scores') loop
    dimensoes := '[]'::jsonb;
    soma := 0;
    pesos := 0;
    for dimensao in select value from jsonb_array_elements(coalesce(corpo -> 'dimensions', '[]'::jsonb)) loop
      criterios := coalesce(dimensao -> 'criteria', '[]'::jsonb);
      -- Os critérios próprios da empresa, que o Jev já responde como pb_<chave>.
      if coalesce((dimensao ->> 'fromPlaybook')::boolean, false) then
        criterios := criterios || coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', chave, 'weight', 1,
            'when', jsonb_build_object('source', 'classification', 'path', chave, 'op', 'eq', 'value', 'sim')
          ) order by chave)
          from jsonb_object_keys(coalesce(classificacao, '{}'::jsonb)) chave
          where chave like 'pb\_%'
        ), '[]'::jsonb);
      end if;

      avaliados := '[]'::jsonb;
      atingido := 0;
      avaliado := 0;
      for criterio in select value from jsonb_array_elements(criterios) loop
        peso := greatest(coalesce((criterio ->> 'weight')::numeric, 1), 0);
        atendida := private.regra_atendida(criterio -> 'when', fatos, classificacao);
        if atendida is null and criterio ->> 'unknownAs' = 'missed' then
          atendida := false;
        end if;
        if atendida is not null then
          avaliado := avaliado + peso;
          if atendida then
            atingido := atingido + peso;
          end if;
        end if;
        avaliados := avaliados || jsonb_build_object(
          'key', criterio ->> 'key',
          'result', case when atendida is null then 'unknown' when atendida then 'met' else 'missed' end
        );
      end loop;

      nota := case when avaliado > 0 then round(100 * atingido / avaliado) end;
      if nota is not null then
        peso := greatest(coalesce((dimensao ->> 'weight')::numeric, 1), 0);
        soma := soma + nota * peso;
        pesos := pesos + peso;
      end if;
      dimensoes := dimensoes || jsonb_build_object('key', dimensao ->> 'key', 'score', nota, 'criteria', avaliados);
    end loop;

    resultado := resultado || jsonb_build_object(familia, jsonb_build_object(
      'score', case when pesos > 0 then round(soma / pesos) end,
      'dimensions', dimensoes
    ));
  end loop;
  return resultado;
end;
$$;

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
      'playbook', (select p.published from public.organization_playbooks p where p.organization_id = target_organization and p.published_version > 0),
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

create or replace function private.playbook_para_o_jev(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when playbook.published_version > 0 then jsonb_build_object(
    'version', playbook.published_version,
    'objecoes', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'nome', item ->> 'nome'))
      from jsonb_array_elements(coalesce(playbook.published -> 'objecoes', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'proximosPassos', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'nome', item ->> 'nome'))
      from jsonb_array_elements(coalesce(playbook.published -> 'proximosPassos', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'criterios', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'pergunta', item ->> 'pergunta', 'sim', coalesce(item ->> 'sim', '')))
      from jsonb_array_elements(coalesce(playbook.published -> 'criterios', '[]'::jsonb)) item
    ), '[]'::jsonb)
  ) else null end
  from public.organization_playbooks playbook
  where playbook.organization_id = target_organization;
$$;

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
    'credits', private.creditos_de_analise(target_organization)
  );
end;
$$;

drop function if exists public.nucleo_analysis_classify(jsonb);
drop function if exists private.relatorio_da_analise(public.conversation_analyses);
drop function if exists private.fator_do_criterio(jsonb, jsonb, jsonb);
drop function if exists private.valor_da_regra(jsonb, jsonb, jsonb);
drop function if exists private.playbook_efetivo(uuid);
drop function if exists private.playbook_base_major();

update public.analysis_schemas
set status = 'retired'
where organization_id is null and definition ->> 'key' = 'atendimento.v1' and status = 'published';

do $$
begin
  if to_regprocedure('public.nucleo_analysis_classify(jsonb)') is not null
     or to_regprocedure('private.playbook_efetivo(uuid)') is not null
     or exists (select 1 from public.analysis_schemas where definition ->> 'key' = 'atendimento.v1' and status = 'published') then
    raise exception 'conferencia do rollback: sobrou algo da v1';
  end if;
end $$;

commit;
