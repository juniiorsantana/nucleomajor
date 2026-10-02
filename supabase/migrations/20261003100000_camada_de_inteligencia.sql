-- A camada de inteligência comercial: fatos, esquema versionado e notas.
--
-- Até aqui a conversa tinha duas leituras: a do Jev (perguntas fechadas, com
-- probabilidade, em conversation_insight_runs/answers) e a do botão (texto do
-- Claude, em conversation_analyses). Esta migration põe por baixo das duas o
-- que transforma leitura em medida:
--
--   BANCO   -> fatos objetivos da conversa, calculados aqui, sem IA
--              (private.fatos_da_conversa);
--   JEV     -> a classificação estruturada que já existe (summary/answers);
--   REGRAS  -> as notas, calculadas pelo NOSSO código a partir dos fatos e da
--              classificação, segundo um esquema versionado
--              (analysis_schemas + private.pontuar). A IA não dá nota;
--   CLAUDE  -> o botão passa a receber fatos e notas prontos, e cada mensagem
--              vai com o seu message_id, para a evidência apontar a mensagem.
--
-- O que ela NÃO define: dimensões, critérios, pesos e regras. A tabela de
-- esquemas nasce vazia; sem esquema publicado as notas ficam nulas e tudo o
-- mais funciona como antes. O "Analysis Schema v1" é a próxima etapa, com o
-- dono.
--
-- Compatibilidade: nenhuma RPC do portal ou da VPS muda de assinatura. A
-- leitura do Jev ganha fatos e notas por gatilho (nucleo_insights_record não
-- é tocada) e o gatilho nunca impede a leitura de ser gravada. O pedido de
-- análise é recriado com o mesmo contrato, levando mais campos na carga.

begin;

-- ---------------------------------------------------------------------------
-- 1/9. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.conversation_analyses') is null
     or to_regprocedure('public.conversation_analysis_request(uuid, uuid, text, text)') is null then
    raise exception 'abortado: aplicar 20261002100000 (analisar conversa) antes';
  end if;
  if to_regclass('public.conversation_insight_runs') is null
     or to_regprocedure('private.agente_da_conversa(uuid, uuid, text)') is null then
    raise exception 'abortado: aplicar 20260930100000 e 20261001100000 (coordenador e equipe de ia) antes';
  end if;
  if to_regclass('public.analysis_schemas') is not null then
    raise exception 'abortado: analysis_schemas ja existe; esta migration ja foi aplicada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/9. Os fatos da conversa.
-- ---------------------------------------------------------------------------
-- Tudo o que dá para medir sem opinião: quantas mensagens e de quem, quanto a
-- empresa demorou para responder, quem falou por último, se o contato está
-- esperando, quantas retomadas a empresa fez, se a conversa passou da IA para
-- a equipe, e o que o CRM diz do contato (lead, negócio, tarefas, agenda).
--
-- Regras da versão 1 (mudar uma delas é subir `version`):
--   * lado: contato (is_from_me falso), ai (author_kind ia), bot (bot) e team
--     (humano, celular ou vazio: o vazio é mensagem digitada no aparelho);
--   * um "turno do contato" começa na primeira mensagem dele depois de uma da
--     empresa, e termina na primeira resposta da IA ou da equipe. Mensagem de
--     bot (lembrete automático) não conta como resposta;
--   * retomada (followUps): mensagem da empresa quando a anterior também era
--     da empresa e passaram 24 horas ou mais;
--   * tempos em segundos corridos, sem horário comercial;
--   * no máximo as 2.000 mensagens mais recentes.
create function private.fatos_da_conversa(
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

revoke all on function private.fatos_da_conversa(uuid, uuid, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/9. O esquema de análise, versionado.
-- ---------------------------------------------------------------------------
-- Um esquema diz como as notas são feitas: famílias de nota (lead,
-- atendimento...), dimensões, critérios, pesos e a regra de cada critério.
-- organization_id nulo = o padrão da plataforma; com empresa = o dela, que
-- vale no lugar do padrão. Versão publicada não se edita: muda-se publicando
-- outra. Cada leitura e cada análise guardam a versão que usaram.
--
-- Contrato do `definition` que o motor (private.pontuar) entende:
--   {"scores": {
--      "<familia>": {"dimensions": [{
--         "key": "...", "name": "...", "weight": 1,
--         "fromPlaybook": false,           -- true: soma os critérios pb_* do playbook
--         "criteria": [{
--           "key": "...", "name": "...", "weight": 1,
--           "unknownAs": "skip" | "missed", -- sem dado: fora da conta (padrão) ou erro
--           "when": {"source": "fact" | "classification",
--                    "path": "responses.medianSeconds" | "temperatura",
--                    "op": "eq|neq|in|nin|lt|lte|gt|gte|true|false|exists",
--                    "value": ..., "minConfidence": 0.6}
--         }]
--      }]}
--   }}
-- As famílias "lead" e "atendimento" também vão para colunas próprias
-- (lead_score e service_score), para comparar e somar.
create table public.analysis_schemas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  definition jsonb not null default '{}'::jsonb
    check (jsonb_typeof(definition) = 'object' and octet_length(definition::text) <= 65536),
  notes text not null default '' check (length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check (status = 'draft' or published_at is not null)
);

comment on table public.analysis_schemas is
  'Esquemas de analise versionados (dimensoes, criterios, pesos, regras). organization_id nulo = padrao da plataforma. As notas sao calculadas por private.pontuar, nunca pela IA. Ver 20261003100000.';

create unique index analysis_schemas_versao
  on public.analysis_schemas (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
create unique index analysis_schemas_publicado
  on public.analysis_schemas (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'published';

alter table public.analysis_schemas enable row level security;
revoke all on public.analysis_schemas from anon, authenticated;
grant select on public.analysis_schemas to authenticated;
create policy analysis_schemas_select
on public.analysis_schemas for select to authenticated
using (organization_id is null or private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- 4/9. O motor de regras.
-- ---------------------------------------------------------------------------
-- Uma regra contra os fatos ou a classificação: verdadeiro, falso, ou nulo
-- quando não há dado (ou a classificação veio com confiança abaixo do pedido).
create function private.regra_atendida(regra jsonb, fatos jsonb, classificacao jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  operador text := coalesce(regra ->> 'op', 'eq');
  alvo jsonb := regra -> 'value';
  valor jsonb;
  item jsonb;
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

  if operador = 'exists' then
    return valor is not null and jsonb_typeof(valor) <> 'null';
  end if;
  if valor is null or jsonb_typeof(valor) = 'null' then
    return null;
  end if;

  if operador = 'eq' then return valor = alvo; end if;
  if operador = 'neq' then return valor <> alvo; end if;
  if operador = 'true' then return valor = 'true'::jsonb; end if;
  if operador = 'false' then return valor = 'false'::jsonb; end if;
  if operador in ('in', 'nin') then
    if jsonb_typeof(alvo) <> 'array' then return null; end if;
    return (alvo @> jsonb_build_array(valor)) = (operador = 'in');
  end if;
  if operador in ('lt', 'lte', 'gt', 'gte') then
    if jsonb_typeof(valor) <> 'number' or jsonb_typeof(alvo) <> 'number' then
      return null;
    end if;
    return case operador
      when 'lt' then valor::numeric < alvo::numeric
      when 'lte' then valor::numeric <= alvo::numeric
      when 'gt' then valor::numeric > alvo::numeric
      else valor::numeric >= alvo::numeric
    end;
  end if;
  return null;
end;
$$;

-- As notas de um esquema: cada critério atendido soma o peso dele; o que não
-- tem dado sai da conta (ou conta como erro, com unknownAs = missed). A nota
-- da dimensão é 0-100 sobre os pesos avaliados; a da família é a média das
-- dimensões, ponderada pelo peso de cada uma. Sem nada avaliável, nula.
create function private.pontuar(definicao jsonb, fatos jsonb, classificacao jsonb)
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

-- Fatos + notas de uma conversa, com o esquema em vigor da empresa (o dela,
-- senão o padrão publicado; nenhum = notas vazias).
create function private.avaliar_conversa(
  target_organization uuid,
  target_connection uuid,
  telefone text,
  classificacao jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fatos jsonb := private.fatos_da_conversa(target_organization, target_connection, telefone);
  esquema public.analysis_schemas%rowtype;
  notas jsonb := '{}'::jsonb;
begin
  select * into esquema
  from public.analysis_schemas s
  where s.status = 'published'
    and (s.organization_id = target_organization or s.organization_id is null)
  order by (s.organization_id is null), s.version desc
  limit 1;
  if found then
    notas := private.pontuar(esquema.definition, fatos, classificacao);
  end if;
  return jsonb_build_object(
    'facts', fatos,
    'scores', notas,
    'schemaVersion', coalesce(esquema.version, 0),
    'lead', (notas -> 'lead' ->> 'score')::integer,
    'service', (notas -> 'atendimento' ->> 'score')::integer
  );
end;
$$;

revoke all on function private.regra_atendida(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.pontuar(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.avaliar_conversa(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5/9. Leituras e análises guardam fatos e notas.
-- ---------------------------------------------------------------------------
alter table public.conversation_insight_runs
  add column facts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(facts) = 'object' and octet_length(facts::text) <= 16384),
  add column facts_version smallint not null default 0 check (facts_version >= 0),
  add column scores jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scores) = 'object' and octet_length(scores::text) <= 32768),
  add column schema_version integer not null default 0 check (schema_version >= 0),
  add column lead_score smallint check (lead_score between 0 and 100),
  add column service_score smallint check (service_score between 0 and 100);

alter table public.conversation_analyses
  add column facts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(facts) = 'object' and octet_length(facts::text) <= 16384),
  add column facts_version smallint not null default 0 check (facts_version >= 0),
  -- A leitura do Jev que a análise recebeu, congelada: a leitura em vigor
  -- muda, e a análise precisa continuar explicável.
  add column classification jsonb not null default '{}'::jsonb
    check (jsonb_typeof(classification) = 'object' and octet_length(classification::text) <= 8192),
  add column reading_id uuid references public.conversation_insight_runs(id) on delete set null,
  add column scores jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scores) = 'object' and octet_length(scores::text) <= 32768),
  add column schema_version integer not null default 0 check (schema_version >= 0),
  add column playbook_version integer not null default 0 check (playbook_version >= 0),
  add column lead_score smallint check (lead_score between 0 and 100),
  add column service_score smallint check (service_score between 0 and 100);

-- A leitura do Jev ganha fatos e notas ao ser gravada. Qualquer erro aqui é
-- engolido: os fatos nunca podem impedir o coordenador de gravar.
create function private.leitura_ganha_fatos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  avaliacao jsonb;
begin
  if new.status = 'ok' then
    begin
      avaliacao := private.avaliar_conversa(new.organization_id, new.connection_id, new.contact_phone, new.summary);
      new.facts := avaliacao -> 'facts';
      new.facts_version := coalesce((avaliacao -> 'facts' ->> 'version')::smallint, 0);
      new.scores := avaliacao -> 'scores';
      new.schema_version := (avaliacao ->> 'schemaVersion')::integer;
      new.lead_score := (avaliacao ->> 'lead')::smallint;
      new.service_score := (avaliacao ->> 'service')::smallint;
    exception when others then
      new.facts := '{}'::jsonb;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.leitura_ganha_fatos() from public, anon, authenticated;

create trigger conversation_insight_runs_fatos
before insert on public.conversation_insight_runs
for each row execute function private.leitura_ganha_fatos();

-- ---------------------------------------------------------------------------
-- 6/9. O pedido de análise leva fatos, notas e o id de cada mensagem.
-- ---------------------------------------------------------------------------
-- Mesmo contrato de 20261002100000. Mudanças:
--   * a análise guarda os fatos, a leitura do Jev usada, as notas e as
--     versões (esquema, playbook);
--   * a carga leva `facts`, `scores` e o `id` (message_id) de cada mensagem,
--     para a evidência apontar a mensagem e não só citar o texto;
--   * a análise não é mais apagada aos 120 dias: o rascunho vencido perde o
--     TEXTO (como antes), mas fatos e notas ficam para o histórico.
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

-- ---------------------------------------------------------------------------
-- 7/9. A visão para os números: uma linha por conversa, a leitura em vigor.
-- ---------------------------------------------------------------------------
-- Colunas tipadas para comparar por agente, por pessoa da equipe e por
-- período sem abrir o JSON. security_invoker: quem consulta só vê o que a RLS
-- da leitura já deixa ver.
create view public.conversation_intelligence
with (security_invoker = true)
as
select
  r.organization_id,
  r.connection_id,
  r.contact_phone,
  r.id as reading_id,
  r.created_at as read_at,
  r.assistant_profile_id,
  r.framework_version,
  r.playbook_version,
  r.facts_version,
  r.schema_version,
  r.lead_score,
  r.service_score,
  r.facts ->> 'owner' as owner,
  (r.facts ->> 'attendantId')::uuid as attendant_id,
  (r.facts ->> 'contactId')::uuid as contact_id,
  (r.facts ->> 'isLead')::boolean as is_lead,
  r.facts ->> 'startedBy' as started_by,
  r.facts ->> 'lastSpeaker' as last_speaker,
  (r.facts ->> 'waitingReply')::boolean as waiting_reply,
  (r.facts ->> 'hoursWaiting')::numeric as hours_waiting,
  (r.facts ->> 'hoursSinceLastMessage')::numeric as hours_since_last_message,
  (r.facts ->> 'firstResponseSeconds')::integer as first_response_seconds,
  (r.facts -> 'responses' ->> 'medianSeconds')::integer as median_response_seconds,
  (r.facts -> 'responses' ->> 'maxSeconds')::integer as max_response_seconds,
  (r.facts ->> 'followUps')::integer as follow_ups,
  (r.facts -> 'messages' ->> 'total')::integer as messages_total,
  (r.facts -> 'messages' ->> 'contact')::integer as messages_contact,
  (r.facts -> 'messages' ->> 'ai')::integer as messages_ai,
  (r.facts -> 'messages' ->> 'team')::integer as messages_team,
  (r.facts -> 'handoff' ->> 'aiToTeam')::integer as handoffs_ai_to_team,
  (r.facts -> 'meetings' ->> 'scheduled')::integer as meetings_scheduled,
  (r.facts -> 'tasks' ->> 'overdue')::integer as tasks_overdue,
  r.facts -> 'deal' ->> 'status' as deal_status,
  r.facts -> 'deal' ->> 'stage' as deal_stage
from public.conversation_insight_runs r
where r.is_latest;

comment on view public.conversation_intelligence is
  'Uma linha por conversa (a leitura em vigor) com fatos e notas em colunas, para relatorios e comparacoes. Ver 20261003100000.';

revoke all on public.conversation_intelligence from anon, authenticated;
grant select on public.conversation_intelligence to authenticated;

-- ---------------------------------------------------------------------------
-- 8/9. As leituras em vigor ganham fatos agora, sem esperar a próxima.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  avaliacao jsonb;
begin
  for r in
    select id, organization_id, connection_id, contact_phone, summary
    from public.conversation_insight_runs
    where is_latest
  loop
    begin
      avaliacao := private.avaliar_conversa(r.organization_id, r.connection_id, r.contact_phone, r.summary);
      update public.conversation_insight_runs
      set facts = avaliacao -> 'facts',
          facts_version = coalesce((avaliacao -> 'facts' ->> 'version')::smallint, 0),
          scores = avaliacao -> 'scores',
          schema_version = (avaliacao ->> 'schemaVersion')::integer,
          lead_score = (avaliacao ->> 'lead')::smallint,
          service_score = (avaliacao ->> 'service')::smallint
      where id = r.id;
    exception when others then
      null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9/9. Conferência.
-- ---------------------------------------------------------------------------
do $$
declare
  notas jsonb;
begin
  -- O motor, com um esquema de exemplo: 2 de 3 critérios avaliáveis (pesos 1,
  -- 1 e 2; o de peso 2 falha) = 50; o sem dado fica fora.
  notas := private.pontuar(
    '{"scores": {"lead": {"dimensions": [{"key": "d", "criteria": [
       {"key": "a", "when": {"source": "fact", "path": "messages.total", "op": "gte", "value": 2}},
       {"key": "b", "when": {"source": "classification", "path": "temperatura", "op": "in", "value": ["morno", "quente"]}},
       {"key": "c", "weight": 2, "when": {"source": "fact", "path": "waitingReply", "op": "false"}},
       {"key": "x", "when": {"source": "fact", "path": "naoExiste", "op": "eq", "value": 1}}
     ]}]}}}'::jsonb,
    '{"messages": {"total": 3}, "waitingReply": true}'::jsonb,
    '{"temperatura": {"a": "morno", "p": 0.8}}'::jsonb
  );
  if (notas -> 'lead' ->> 'score')::integer is distinct from 50
     or notas -> 'lead' -> 'dimensions' -> 0 -> 'criteria' -> 3 ->> 'result' is distinct from 'unknown' then
    raise exception 'conferencia: o motor de regras nao deu 50 (%)', notas;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.analysis_schemas'::regclass) then
    raise exception 'conferencia: RLS desligada nos esquemas';
  end if;
  if has_table_privilege('authenticated', 'public.analysis_schemas', 'insert')
     or has_table_privilege('anon', 'public.conversation_intelligence', 'select') then
    raise exception 'conferencia: permissao a mais nos esquemas ou na visao';
  end if;
  if has_function_privilege('authenticated', 'private.fatos_da_conversa(uuid, uuid, text, timestamptz)', 'execute') then
    raise exception 'conferencia: fatos expostos';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'conversation_insight_runs_fatos') then
    raise exception 'conferencia: gatilho dos fatos nao existe';
  end if;
end $$;

commit;
