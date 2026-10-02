-- Analysis Schema v1: o Atendimento Score publicado.
--
-- Especificação: ANALYSIS_SCHEMA_V1_NUCLEO_MAJOR.md (02/10/2026). Esta
-- migration põe a v1 em cima da camada de inteligência (20261003100000), sem
-- estrutura paralela:
--
--   * Playbook Base Major: o padrão da plataforma, conservador, usado quando a
--     empresa não tem playbook publicado. O da empresa sempre prevalece.
--   * Fatos versão 2: estilo de comunicação (texto, áudio, tamanho) e o
--     relógio humano, que começa no pedido de handoff para uma pessoa.
--   * Motor: além de "atendeu ou não", um critério pode ter FATORES por
--     estado (bom 1,0; atencao 0,6; ruim 0,2; critico 0,0; nao_avaliado fora
--     da conta). nota = soma(peso x fator) / soma(pesos avaliados) x 100.
--   * atendimento.v1 publicado em analysis_schemas, com os 8 critérios e os
--     pesos da especificação. Lead Score continua nulo: não há família
--     "lead" no esquema.
--   * A análise do botão pode receber a classificação do Jev feita na hora
--     (nucleo_analysis_classify) e a nota é recalculada aqui, nunca pela IA.
--   * O relatório agregado (analysis.v1) é montado no banco e volta na
--     consulta de andamento, junto do que ela já devolvia.
--
-- Histórico: nada é recalculado. Leituras e análises antigas guardam a
-- versão de fatos, de esquema e de playbook que usaram.

begin;

-- ---------------------------------------------------------------------------
-- 1/9. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.analysis_schemas') is null
     or to_regprocedure('private.pontuar(jsonb, jsonb, jsonb)') is null then
    raise exception 'abortado: aplicar 20261003100000 (camada de inteligencia) antes';
  end if;
  if to_regclass('public.customer_handoff_requests') is null then
    raise exception 'abortado: customer_handoff_requests nao existe';
  end if;
  if exists (select 1 from public.analysis_schemas where definition ->> 'key' = 'atendimento.v1') then
    raise exception 'abortado: atendimento.v1 ja existe; esta migration ja foi aplicada';
  end if;
  if exists (select 1 from public.analysis_schemas where organization_id is null and status = 'published') then
    raise exception 'abortado: ja existe um esquema padrao publicado';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/9. Playbook Base Major e playbook efetivo.
-- ---------------------------------------------------------------------------
-- A régua mínima da plataforma (especificação, seção 6). Não tem política de
-- preço nem roteiro: não impõe metodologia a nicho nenhum. `atendimento` é a
-- régua de tempo, vazia de propósito (sem valor universal de SLA).
create function private.playbook_base_major()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'origem', 'base_major',
    'versao', 'base_major.v1',
    'version', 0,
    'regras', jsonb_build_array(
      'Compreender a necessidade antes de recomendar solução.',
      'Não repetir perguntas que já foram respondidas.',
      'Adaptar comunicação ao padrão demonstrado pelo lead.',
      'Coletar apenas informações de qualificação relevantes ao processo.',
      'Não penalizar ausência de informação que ainda não era necessária.',
      'Buscar compreender a objeção antes de simplesmente rebater.',
      'Manter respostas coerentes com o contexto já fornecido.',
      'Quando houver condição de avanço, definir próximo passo.',
      'Se o lead não tiver fit, registrar desqualificação com motivo.',
      'Cumprir compromissos e follow-ups combinados.',
      'Não criar regra específica de preço se a empresa não tiver definido uma.',
      'Não exigir formato rígido ou script textual específico.'
    ),
    'atendimento', jsonb_build_object(
      'first_human_response_minutes', null,
      'active_conversation_response_minutes', null,
      'business_hours', null,
      'timezone', null
    )
  );
$$;

-- O playbook que vale para a empresa: o publicado por ela; sem ele, o Base.
create function private.playbook_efetivo(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.published || jsonb_build_object('origem', 'empresa', 'version', p.published_version)
     from public.organization_playbooks p
     where p.organization_id = target_organization and p.published_version > 0),
    private.playbook_base_major()
  );
$$;

-- O que o Jev recebe do playbook. Antes era só o da empresa (nulo sem ele) e
-- só chave e nome; agora é o efetivo, com as respostas esperadas para as
-- objeções, a oferta (com o preço, que é onde a política de preço aparece),
-- o cliente ideal e as regras do Base Major.
create or replace function private.playbook_para_o_jev(target_organization uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((efetivo ->> 'version')::integer, 0),
    'origem', coalesce(efetivo ->> 'origem', 'base_major'),
    'segmento', coalesce(efetivo ->> 'segmento', ''),
    'regras', coalesce(efetivo -> 'regras', '[]'::jsonb),
    'oferta', coalesce((
      select jsonb_agg(jsonb_build_object('nome', item ->> 'nome', 'preco', coalesce(item ->> 'preco', '')))
      from jsonb_array_elements(coalesce(efetivo -> 'oferta', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'clienteIdeal', coalesce(efetivo -> 'clienteIdeal', '{}'::jsonb),
    'objecoes', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'nome', item ->> 'nome', 'resposta', coalesce(item ->> 'resposta', '')))
      from jsonb_array_elements(coalesce(efetivo -> 'objecoes', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'proximosPassos', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'nome', item ->> 'nome'))
      from jsonb_array_elements(coalesce(efetivo -> 'proximosPassos', '[]'::jsonb)) item
    ), '[]'::jsonb),
    'criterios', coalesce((
      select jsonb_agg(jsonb_build_object('chave', item ->> 'chave', 'pergunta', item ->> 'pergunta', 'sim', coalesce(item ->> 'sim', '')))
      from jsonb_array_elements(coalesce(efetivo -> 'criterios', '[]'::jsonb)) item
    ), '[]'::jsonb)
  )
  from (select private.playbook_efetivo(target_organization) as efetivo) x;
$$;

revoke all on function private.playbook_base_major() from public, anon, authenticated;
revoke all on function private.playbook_efetivo(uuid) from public, anon, authenticated;
revoke all on function private.playbook_para_o_jev(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/9. Fatos, versão 2.
-- ---------------------------------------------------------------------------
-- Tudo da versão 1, mais:
--   * communication: mensagens de texto e de áudio de cada lado e o tamanho
--     médio do texto, para o critério de adaptação de comunicação;
--   * humanClock: o relógio humano começa no último pedido de handoff para
--     uma pessoa (customer_handoff_requests, gravado pelo runtime quando a IA
--     passa a conversa ou cumpre a promessa de transferir). Resposta de IA ou
--     bot não conta como resposta humana;
--   * responseRules: a régua de tempo da empresa (vazia no Base Major).
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
  -- Versão 2: estilo de comunicação e relógio humano.
  texto_contato integer := 0;
  chars_contato bigint := 0;
  texto_empresa integer := 0;
  chars_empresa bigint := 0;
  audios_empresa integer := 0;
  relogio_em timestamptz;
  primeira_humana_em timestamptz;
  regras jsonb;
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
      select msg.sent_at, msg.message_id, msg.is_from_me, msg.author_kind, msg.author_id, msg.media_type,
             length(msg.content) as tamanho
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
      elsif m.media_type = '' and m.tamanho > 0 then
        texto_contato := texto_contato + 1;
        chars_contato := chars_contato + m.tamanho;
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
        if lower(m.media_type) in ('audio', 'ptt') then
          audios_empresa := audios_empresa + 1;
        elsif m.media_type = '' and m.tamanho > 0 then
          texto_empresa := texto_empresa + 1;
          chars_empresa := chars_empresa + m.tamanho;
        end if;
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

  -- O relógio humano: começa no último pedido de handoff para uma pessoa
  -- (a IA passou a conversa, por pedido do lead ou porque prometeu
  -- transferir). Resposta de IA ou de bot não para esse relógio.
  select h.created_at into relogio_em
  from public.customer_handoff_requests h
  where h.organization_id = target_organization
    and h.connection_id = target_connection
    and h.created_at <= limite
    and (h.routing_address = telefone or (contato.id is not null and h.contact_id = contato.id))
  order by h.created_at desc
  limit 1;
  if relogio_em is not null then
    select min(msg.sent_at) into primeira_humana_em
    from public.whatsapp_messages msg
    where msg.organization_id = target_organization
      and msg.connection_id = target_connection
      and msg.contact_phone = telefone
      and msg.is_from_me
      and msg.author_kind not in ('ia', 'bot')
      and msg.sent_at >= relogio_em
      and msg.sent_at <= limite;
  end if;

  -- A régua de tempo da empresa (playbook efetivo). Sem ela, os tempos são
  -- só fatos: nenhum valor universal é inventado aqui.
  regras := coalesce(private.playbook_efetivo(target_organization) -> 'atendimento', '{}'::jsonb);

  return jsonb_build_object(
    'version', 2,
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
    'meetings', coalesce(agenda, jsonb_build_object('scheduled', 0, 'past', 0, 'next', null)),
    'communication', jsonb_build_object(
      'contactText', texto_contato,
      'contactAudio', audios,
      'companyText', texto_empresa,
      'companyAudio', audios_empresa,
      'contactAvgChars', case when texto_contato > 0 then round(chars_contato::numeric / texto_contato) end,
      'companyAvgChars', case when texto_empresa > 0 then round(chars_empresa::numeric / texto_empresa) end
    ),
    'humanClock', jsonb_build_object(
      'startedAt', relogio_em,
      'source', case when relogio_em is not null then 'handoff_request' end,
      'firstHumanResponseAt', primeira_humana_em,
      'firstHumanResponseSeconds', case when primeira_humana_em is not null
        then greatest(0, extract(epoch from primeira_humana_em - relogio_em))::integer end,
      'waitingHuman', relogio_em is not null and primeira_humana_em is null,
      -- Só existe com a régua da empresa e a regra de faixas aprovada. Em
      -- atendimento.v1, sempre nulo: a responsividade fica nao_avaliado.
      'slaStatus', null
    ),
    'responseRules', jsonb_build_object(
      'first_human_response_minutes', regras -> 'first_human_response_minutes',
      'active_conversation_response_minutes', regras -> 'active_conversation_response_minutes',
      'business_hours', regras -> 'business_hours',
      'timezone', regras -> 'timezone'
    )
  );
end;
$$;
-- ---------------------------------------------------------------------------
-- 4/9. O motor: critérios com fator por estado.
-- ---------------------------------------------------------------------------
-- O valor que a regra observa: o fato no caminho, ou a resposta do Jev (nula
-- quando a confiança fica abaixo de minConfidence).
create function private.valor_da_regra(regra jsonb, fatos jsonb, classificacao jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  valor jsonb;
begin
  if regra is null or jsonb_typeof(regra) <> 'object' then
    return null;
  end if;
  if coalesce(regra ->> 'source', 'fact') = 'classification' then
    item := coalesce(classificacao, '{}'::jsonb) -> (regra ->> 'path');
    if item is null or jsonb_typeof(item) <> 'object' then
      return null;
    end if;
    if regra ? 'minConfidence'
       and coalesce((item ->> 'p')::numeric, 0) < (regra ->> 'minConfidence')::numeric then
      return null;
    end if;
    valor := item -> 'a';
  else
    valor := coalesce(fatos, '{}'::jsonb) #> pg_catalog.string_to_array(coalesce(regra ->> 'path', ''), '.');
  end if;
  if valor is null or jsonb_typeof(valor) = 'null' then
    return null;
  end if;
  return valor;
end;
$$;

-- O fator de um critério com "factors": o valor observado é a chave. Valor
-- sem fator (ou fator nulo, como nao_avaliado) = fora da conta.
create function private.fator_do_criterio(criterio jsonb, fatos jsonb, classificacao jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  valor jsonb := private.valor_da_regra(criterio -> 'when', fatos, classificacao);
  chave text;
  fator numeric;
begin
  if valor is null or jsonb_typeof(criterio -> 'factors') is distinct from 'object' then
    return null;
  end if;
  chave := valor #>> '{}';
  if not ((criterio -> 'factors') ? chave) then
    return null;
  end if;
  fator := (criterio -> 'factors' ->> chave)::numeric;
  if fator is null then
    return null;
  end if;
  return least(1, greatest(0, fator));
end;
$$;

-- As notas. Critério booleano (atendeu = 1, não atendeu = 0) e critério com
-- fatores somam do mesmo jeito: peso x fator. Sem dado, fora do denominador.
-- Dimensão: fator = soma(peso x fator) / soma(pesos avaliados); pontos =
-- peso da dimensão x fator. Família: nota = soma(pontos) / soma(pesos das
-- dimensões avaliadas) x 100, que é a média das dimensões pelo peso.
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
  peso_dimensao numeric;
  atingido numeric;
  avaliado numeric;
  fator numeric;
  fator_dimensao numeric;
  pontos numeric;
  pesos numeric;
  pesos_total numeric;
  atendida boolean;
  valor text;
begin
  if definicao is null or jsonb_typeof(definicao -> 'scores') is distinct from 'object' then
    return '{}'::jsonb;
  end if;

  for familia, corpo in select key, value from jsonb_each(definicao -> 'scores') loop
    dimensoes := '[]'::jsonb;
    pontos := 0;
    pesos := 0;
    pesos_total := 0;
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
        valor := null;
        if criterio ? 'factors' then
          fator := private.fator_do_criterio(criterio, fatos, classificacao);
          valor := private.valor_da_regra(criterio -> 'when', fatos, classificacao) #>> '{}';
        else
          atendida := private.regra_atendida(criterio -> 'when', fatos, classificacao);
          fator := case when atendida is null then null when atendida then 1 else 0 end;
        end if;
        if fator is null and criterio ->> 'unknownAs' = 'missed' then
          fator := 0;
        end if;
        if fator is not null and peso > 0 then
          avaliado := avaliado + peso;
          atingido := atingido + peso * fator;
        end if;
        avaliados := avaliados || jsonb_build_object(
          'key', criterio ->> 'key',
          'weight', peso,
          'value', valor,
          'factor', fator,
          'result', case when fator is null then 'unknown' when fator >= 1 then 'met' when fator <= 0 then 'missed' else 'partial' end
        );
      end loop;

      fator_dimensao := case when avaliado > 0 then atingido / avaliado end;
      peso_dimensao := greatest(coalesce((dimensao ->> 'weight')::numeric, 1), 0);
      pesos_total := pesos_total + peso_dimensao;
      if fator_dimensao is not null and peso_dimensao > 0 then
        pontos := pontos + peso_dimensao * fator_dimensao;
        pesos := pesos + peso_dimensao;
      end if;
      dimensoes := dimensoes || jsonb_build_object(
        'key', dimensao ->> 'key',
        'name', dimensao ->> 'name',
        'weight', peso_dimensao,
        'factor', round(fator_dimensao, 4),
        'score', round(100 * fator_dimensao),
        'points', round(peso_dimensao * fator_dimensao, 2),
        'criteria', avaliados
      );
    end loop;

    resultado := resultado || jsonb_build_object(familia, jsonb_build_object(
      'score', case when pesos > 0 then round(100 * pontos / pesos) end,
      'points', round(pontos, 2),
      'evaluatedWeight', pesos,
      'maxWeight', pesos_total,
      'stateFactors', corpo -> 'stateFactors',
      'dimensions', dimensoes
    ));
  end loop;
  return resultado;
end;
$$;

revoke all on function private.valor_da_regra(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.fator_do_criterio(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.pontuar(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5/9. atendimento.v1, publicado.
-- ---------------------------------------------------------------------------
-- Pesos e fatores da especificação (seções 3 e 8). Critérios do Jev com a
-- confiança mínima que o portal já usa (0,6, CONFIANCA_MINIMA): abaixo dela a
-- resposta é "incerta" e o critério fica fora da conta.
--
-- Adaptações ao que existe (registradas no doc da v1):
--   * responsividade: o relógio humano é fato, mas sem a régua de tempo da
--     empresa e sem regra de faixas aprovada não há estado; fica sempre
--     nao_avaliado nesta versão (fatores vazios);
--   * playbook_adherence inclui objeções numa pergunta só do Jev; a pergunta
--     de objeções (att_objection_handling) entra com peso 0, como detalhe;
--   * next_step e follow_up: o Jev dá o ESTADO de negócio e o código o
--     converte em fator, pelas regras da especificação.
insert into public.analysis_schemas (organization_id, version, status, definition, notes, published_at)
values (
  null,
  1,
  'published',
  jsonb_build_object(
    'key', 'atendimento.v1',
    'scoreType', 'atendimento',
    'notEvaluatedBehavior', 'exclude_from_denominator',
    'scores', jsonb_build_object(
      'atendimento', jsonb_build_object(
        'stateFactors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0}'::jsonb,
        'dimensions', jsonb_build_array(
          jsonb_build_object('key', 'responsiveness', 'name', 'Responsividade contextual', 'weight', 10, 'source', 'facts',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'responsiveness',
              'when', jsonb_build_object('source', 'fact', 'path', 'humanClock.slaStatus'),
              'factors', '{}'::jsonb))),
          jsonb_build_object('key', 'discovery', 'name', 'Descoberta da necessidade', 'weight', 15, 'source', 'jev',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'discovery',
              'when', jsonb_build_object('source', 'classification', 'path', 'att_discovery', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'conversation_coherence', 'name', 'Coerência da condução', 'weight', 15, 'source', 'jev',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'conversation_coherence',
              'when', jsonb_build_object('source', 'classification', 'path', 'att_conversation_coherence', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'communication_adaptation', 'name', 'Adaptação ao estilo de comunicação', 'weight', 10, 'source', 'facts+jev',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'communication_adaptation',
              'when', jsonb_build_object('source', 'classification', 'path', 'att_communication_adaptation', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'qualification', 'name', 'Qualificação', 'weight', 10, 'source', 'jev+playbook',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'qualification',
              'when', jsonb_build_object('source', 'classification', 'path', 'att_qualification', 'minConfidence', 0.6),
              'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'playbook_adherence', 'name', 'Playbook e objeções', 'weight', 15, 'source', 'jev+playbook',
            'includes', jsonb_build_array('objection_handling'),
            'criteria', jsonb_build_array(
              jsonb_build_object('key', 'playbook_adherence',
                'when', jsonb_build_object('source', 'classification', 'path', 'att_playbook_adherence', 'minConfidence', 0.6),
                'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb),
              jsonb_build_object('key', 'objection_handling', 'weight', 0,
                'when', jsonb_build_object('source', 'classification', 'path', 'att_objection_handling', 'minConfidence', 0.6),
                'factors', '{"bom": 1.0, "atencao": 0.6, "ruim": 0.2, "critico": 0.0, "nao_avaliado": null}'::jsonb))),
          jsonb_build_object('key', 'next_step', 'name', 'Próximo passo', 'weight', 15, 'source', 'jev+crm',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'next_step',
              'when', jsonb_build_object('source', 'classification', 'path', 'att_next_step', 'minConfidence', 0.6),
              -- avançou, aguardando o lead e desqualificado com motivo: o
              -- atendente fez a parte dele. Ficou em aberto (havia condição de
              -- avançar): falha forte. Ainda em descoberta: não avaliável.
              'factors', '{"avancou_com_acao": 1.0, "aguardando_acao_do_lead": 1.0, "desqualificado_com_motivo": 1.0, "ficou_em_aberto": 0.0, "ainda_em_descoberta": null}'::jsonb))),
          jsonb_build_object('key', 'follow_up', 'name', 'Follow-up', 'weight', 10, 'source', 'facts+jev+crm',
            'criteria', jsonb_build_array(jsonb_build_object('key', 'follow_up',
              'when', jsonb_build_object('source', 'classification', 'path', 'att_follow_up', 'minConfidence', 0.6),
              -- Feito: positivo. Vencido e não feito: negativo (ruim). Ainda
              -- não venceu, ou não se aplica: sem perda, fora da conta.
              'factors', '{"done": 1.0, "overdue": 0.2, "not_due": null, "not_applicable": null}'::jsonb)))
        )
      )
    )
  ),
  'Atendimento Score v1 (ANALYSIS_SCHEMA_V1_NUCLEO_MAJOR.md). Lead Score fora: nulo ate versao propria.',
  now()
);

-- ---------------------------------------------------------------------------
-- 6/9. O pedido de análise leva o playbook efetivo.
-- ---------------------------------------------------------------------------
-- Mesmo corpo de 20261003100000; muda só o playbook da carga, que passa a ser
-- o efetivo (o da empresa ou, sem ele, o Base Major).
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
-- ---------------------------------------------------------------------------
-- 7/9. A classificação do Jev feita na hora da análise.
-- ---------------------------------------------------------------------------
-- O analista da VPS pergunta ao Jev sobre a conversa antes de chamar o
-- Claude e grava aqui as respostas. A nota é recalculada AQUI, com os fatos
-- congelados no pedido e o esquema em vigor; a VPS recebe a nota pronta.
create function public.nucleo_analysis_classify(record_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  analise public.conversation_analyses%rowtype;
  respostas jsonb := coalesce(record_payload -> 'answers', '[]'::jsonb);
  resposta jsonb;
  resumo jsonb := '{}'::jsonb;
  esquema public.analysis_schemas%rowtype;
  notas jsonb := '{}'::jsonb;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;
  if jsonb_typeof(respostas) <> 'array' or pg_catalog.jsonb_array_length(respostas) not between 1 and 40 then
    raise exception 'answers are invalid';
  end if;

  for resposta in select value from pg_catalog.jsonb_array_elements(respostas) loop
    if jsonb_typeof(resposta) <> 'object'
       or coalesce(resposta ->> 'question', '') !~ '^[a-z][a-z0-9_]{1,40}$'
       or length(coalesce(resposta ->> 'answer', '')) not between 1 and 60
       or (resposta ? 'probability' and jsonb_typeof(resposta -> 'probability') not in ('number', 'null'))
       or coalesce((resposta ->> 'probability')::numeric, 0) not between 0 and 1 then
      raise exception 'answer is invalid';
    end if;
    resumo := resumo || jsonb_build_object(
      resposta ->> 'question',
      jsonb_build_object('a', resposta ->> 'answer', 'p', round(((resposta ->> 'probability')::numeric), 4))
    );
  end loop;

  select * into analise
  from public.conversation_analyses a
  where a.id = nullif(record_payload ->> 'analysisId', '')::uuid
    and a.organization_id = robot_org
    and a.connection_id = robot_connection
  for update;
  if not found then
    raise exception 'analysis not found for this connection';
  end if;
  if analise.status not in ('pending', 'running') then
    return jsonb_build_object('recorded', false, 'status', analise.status);
  end if;

  select * into esquema
  from public.analysis_schemas s
  where s.status = 'published'
    and (s.organization_id = robot_org or s.organization_id is null)
  order by (s.organization_id is null), s.version desc
  limit 1;
  if found then
    notas := private.pontuar(esquema.definition, analise.facts, resumo);
  end if;

  update public.conversation_analyses a
  set classification = resumo,
      scores = notas,
      schema_version = coalesce(esquema.version, 0),
      lead_score = (notas -> 'lead' ->> 'score')::smallint,
      service_score = (notas -> 'atendimento' ->> 'score')::smallint
  where a.id = analise.id;

  return jsonb_build_object(
    'recorded', true,
    'scores', notas,
    'schemaVersion', coalesce(esquema.version, 0),
    'leadScore', (notas -> 'lead' ->> 'score')::integer,
    'serviceScore', (notas -> 'atendimento' ->> 'score')::integer
  );
end;
$$;

revoke all on function public.nucleo_analysis_classify(jsonb) from public, anon, authenticated;
grant execute on function public.nucleo_analysis_classify(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8/9. O relatório agregado (analysis.v1).
-- ---------------------------------------------------------------------------
-- Junta, sem misturar: a nota (do motor), o diagnóstico (do Claude, formato
-- analysis_report.v1) e os alertas. O motivo de cada critério vem do
-- "why_this_score" do diagnóstico. Dois alertas saem de regra, sem desconto
-- extra (a perda já está no critério): conversation_left_open e
-- overdue_follow_up. Severidade só quando o Claude a deu.
create function private.relatorio_da_analise(analise public.conversation_analyses)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  familia jsonb := analise.scores -> 'atendimento';
  fatores jsonb;
  diagnostico jsonb := case when analise.result ->> 'schema_version' = 'analysis_report.v1' then analise.result end;
  motivos jsonb;
  criterios jsonb := '[]'::jsonb;
  dimensao jsonb;
  motivo jsonb;
  fator numeric;
  estado text;
  bandeiras jsonb;
  nota integer;
  rotulo text;
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
      'reason', motivo ->> 'explanation',
      'evidence_message_ids', coalesce(motivo -> 'evidence_message_ids', '[]'::jsonb)
    );
    motivo := null;

    if dimensao ->> 'key' = 'next_step' and fator = 0
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'conversation_left_open') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'conversation_left_open', 'severity', null, 'criterion', 'next_step', 'source', 'regra',
        'reason', 'Havia condição de avançar e a conversa ficou sem próxima ação definida.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
    if dimensao ->> 'key' = 'follow_up' and dimensao -> 'criteria' -> 0 ->> 'value' = 'overdue'
       and not exists (select 1 from jsonb_array_elements(bandeiras) b where b.value ->> 'code' = 'overdue_follow_up') then
      bandeiras := bandeiras || jsonb_build_object(
        'code', 'overdue_follow_up', 'severity', null, 'criterion', 'follow_up', 'source', 'regra',
        'reason', 'Um follow-up combinado venceu e não foi feito.',
        'evidence_message_ids', '[]'::jsonb);
    end if;
  end loop;

  nota := (familia ->> 'score')::integer;
  rotulo := case
    when familia is null or nota is null then 'Ainda não avaliável'
    when (familia ->> 'evaluatedWeight')::numeric < (familia ->> 'maxWeight')::numeric then nota || '/100 até aqui'
    else nota || '/100'
  end;

  return jsonb_build_object(
    'schema_version', 'analysis.v1',
    'conversation_id', analise.connection_id::text || ':' || analise.contact_phone,
    'generated_at', analise.completed_at,
    'kind', analise.kind,
    'score_schema_version', analise.schema_version,
    'facts_version', analise.facts_version,
    'playbook_version', analise.playbook_version,
    'lead_score', to_jsonb(analise.lead_score),
    'atendimento_score', case when familia is null then null else jsonb_build_object(
      'score', to_jsonb(nota),
      'max_score', 100,
      'evaluated_weight', familia -> 'evaluatedWeight',
      'max_weight', familia -> 'maxWeight',
      'label', rotulo,
      'criteria', criterios
    ) end,
    'diagnosis', case when diagnostico is null then null else jsonb_build_object(
      'summary', diagnostico -> 'summary',
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

revoke all on function private.relatorio_da_analise(public.conversation_analyses) from public, anon, authenticated;

-- A consulta de andamento devolve o que já devolvia, mais o relatório e as
-- notas. Mesmo contrato de 20261002100000, com campos a mais.
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

-- ---------------------------------------------------------------------------
-- 9/9. Conferência.
-- ---------------------------------------------------------------------------
do $$
declare
  esquema jsonb;
  notas jsonb;
  pesos numeric;
begin
  select definition into esquema from public.analysis_schemas
  where organization_id is null and status = 'published' and definition ->> 'key' = 'atendimento.v1';
  if esquema is null then
    raise exception 'conferencia: atendimento.v1 nao foi publicado';
  end if;
  select sum((d ->> 'weight')::numeric) into pesos
  from jsonb_array_elements(esquema -> 'scores' -> 'atendimento' -> 'dimensions') d;
  if pesos <> 100 or esquema -> 'scores' ? 'lead' then
    raise exception 'conferencia: pesos do atendimento.v1 nao somam 100 ou ha familia lead (%)', pesos;
  end if;

  -- O exemplo da especificação, com o esquema publicado: descoberta bom (15),
  -- coerência atencao (9 de 15), próximo passo em aberto (0 de 15),
  -- follow-up que ainda não venceu e responsividade sem régua (fora).
  -- 24 / 45 x 100 = 53.
  notas := private.pontuar(esquema, '{}'::jsonb, '{
    "att_discovery": {"a": "bom", "p": 0.9},
    "att_conversation_coherence": {"a": "atencao", "p": 0.8},
    "att_next_step": {"a": "ficou_em_aberto", "p": 0.7},
    "att_follow_up": {"a": "not_due", "p": 0.9},
    "att_qualification": {"a": "bom", "p": 0.4}
  }'::jsonb);
  if (notas -> 'atendimento' ->> 'score')::integer is distinct from 53
     or (notas -> 'atendimento' ->> 'evaluatedWeight')::numeric <> 45
     or notas ? 'lead' then
    raise exception 'conferencia: o motor nao deu 53 de 45 avaliados (%)', notas -> 'atendimento';
  end if;
  if has_function_privilege('anon', 'public.nucleo_analysis_classify(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.playbook_efetivo(uuid)', 'execute') then
    raise exception 'conferencia: permissao a mais';
  end if;
end $$;

commit;
