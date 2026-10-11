-- As análises da conversa passam a ser da empresa, e não da conexão
-- (docs/adr/ADR-0007-REMOVER-ORGANIZACAO-DE-WHATSAPP.md, etapa 1).
--
-- O dono decidiu em 11/10/2026 que as análises ficam quando um WhatsApp é
-- removido. Até aqui, elas dependiam da conexão: a FK
-- (connection_id, organization_id) era ON DELETE CASCADE, e o portal as lia
-- pela conexão e pelo telefone. Esta migration:
--   1. liga cada análise e cada leitura a um contato só, pelo telefone
--      inteiro, e não mais pelos 8 últimos dígitos (empate fica sem contato);
--   2. guarda o nome e o final do número da conexão na própria análise;
--   3. deixa a conexão sair sem levar a análise junto: ON DELETE SET NULL só
--      da coluna connection_id, sem tocar em organization_id;
--   4. refaz o contato das linhas antigas com a regra nova. Onde o contato já
--      gravado nos fatos aponta para outra pessoa, a linha fica sem contato:
--      os fatos e os resultados antigos não são recalculados.
-- Não habilita nenhuma remoção.
--
-- Produção: só pelo SQL Editor, depois de conferir que o Postgres é 15 ou
-- mais novo (SET NULL com lista de colunas) e com autorização do dono.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_analyses' and column_name = 'connection_last4'
  ) then
    raise exception 'abortado: 20261013100000 ja foi aplicada';
  end if;
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'abortado: precisa de Postgres 15+ (ON DELETE SET NULL com lista de colunas)';
  end if;
end;
$$;

-- 1. O mesmo WhatsApp, pelo telefone inteiro -------------------------------

-- Os dígitos, com o 55 na frente quando o número veio só com DDD (10 ou 11
-- dígitos, como o cadastro manual costuma guardar).
create or replace function private.telefone_do_whatsapp(telefone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when pg_catalog.length(d) in (10, 11) then '55' || d else d end
  from (select pg_catalog.regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') as d) t;
$$;

-- O contato daquele telefone, se houver exatamente um na empresa. Compara o
-- número inteiro, com e sem o nono dígito (private.customer_phone_matches).
-- Dois contatos com o mesmo número: nenhum, porque não dá para saber quem é.
create or replace function private.contato_pelo_telefone(target_organization uuid, telefone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when pg_catalog.count(*) = 1 then (pg_catalog.array_agg(c.id))[1] end
  from public.contacts c
  where c.organization_id = target_organization
    and c.deleted_at is null
    and c.phone <> ''
    and private.customer_phone_matches(
      private.telefone_do_whatsapp(c.phone),
      private.telefone_do_whatsapp(telefone)
    );
$$;

revoke all on function private.telefone_do_whatsapp(text) from public, anon, authenticated;
revoke all on function private.contato_pelo_telefone(uuid, text) from public, anon, authenticated;

-- 2. Origem e contato nas duas tabelas --------------------------------------

alter table public.conversation_analyses
  add column connection_name text check (connection_name is null or pg_catalog.length(connection_name) <= 120),
  add column connection_last4 text check (connection_last4 is null or connection_last4 ~ '^[0-9]{4}$');

alter table public.conversation_insight_runs
  add column connection_name text check (connection_name is null or pg_catalog.length(connection_name) <= 120),
  add column connection_last4 text check (connection_last4 is null or connection_last4 ~ '^[0-9]{4}$'),
  add column contact_id uuid;

-- 3. A conexão pode sair sem levar a análise ---------------------------------

do $$
declare
  fk record;
begin
  for fk in
    select con.conrelid::regclass::text as tabela, con.conname
    from pg_catalog.pg_constraint con
    where con.contype = 'f'
      and con.confrelid = 'public.whatsapp_connections'::regclass
      and con.conrelid in ('public.conversation_analyses'::regclass, 'public.conversation_insight_runs'::regclass)
  loop
    execute pg_catalog.format('alter table %s drop constraint %I', fk.tabela, fk.conname);
  end loop;
end;
$$;

alter table public.conversation_analyses alter column connection_id drop not null;
alter table public.conversation_insight_runs alter column connection_id drop not null;

-- Só a coluna da conexão vira nula: organization_id continua, e a análise
-- continua da empresa.
alter table public.conversation_analyses
  add constraint conversation_analyses_conexao
  foreign key (connection_id, organization_id)
  references public.whatsapp_connections(id, organization_id)
  on delete set null (connection_id);

alter table public.conversation_insight_runs
  add constraint conversation_insight_runs_conexao
  foreign key (connection_id, organization_id)
  references public.whatsapp_connections(id, organization_id)
  on delete set null (connection_id);

-- 4. Na criação, a origem e o contato ficam gravados -------------------------

-- O nome e o final do número entram uma vez, enquanto a conexão existe, e não
-- mudam depois. Na leitura, o contato é o dos fatos: os dois saem de
-- private.contato_pelo_telefone, e a coluna não pode apontar para outra
-- pessoa. Este gatilho roda depois de conversation_insight_runs_fatos (os
-- gatilhos BEFORE vão em ordem de nome), quando os fatos já existem.
create or replace function private.origem_da_analise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conexao record;
  do_fato uuid;
begin
  if new.connection_id is not null and (new.connection_name is null or new.connection_last4 is null) then
    select c.name,
           case
             when c.verified_phone_last4 ~ '^[0-9]{4}$' then c.verified_phone_last4
             when c.expected_phone_last4 ~ '^[0-9]{4}$' then c.expected_phone_last4
           end as last4
    into conexao
    from public.whatsapp_connections c
    where c.id = new.connection_id and c.organization_id = new.organization_id;
    new.connection_name := coalesce(new.connection_name, pg_catalog.left(conexao.name, 120));
    new.connection_last4 := coalesce(new.connection_last4, conexao.last4);
  end if;

  if tg_table_name = 'conversation_insight_runs' and new.contact_id is null then
    do_fato := nullif(new.facts ->> 'contactId', '')::uuid;
    new.contact_id := do_fato;
  end if;
  return new;
end;
$$;

revoke all on function private.origem_da_analise() from public, anon, authenticated;

create trigger conversation_analyses_origem
before insert on public.conversation_analyses
for each row execute function private.origem_da_analise();

create trigger conversation_insight_runs_origem
before insert on public.conversation_insight_runs
for each row execute function private.origem_da_analise();

-- 5. As linhas que já existem -----------------------------------------------

update public.conversation_analyses a
set connection_name = pg_catalog.left(c.name, 120),
    connection_last4 = case
      when c.verified_phone_last4 ~ '^[0-9]{4}$' then c.verified_phone_last4
      when c.expected_phone_last4 ~ '^[0-9]{4}$' then c.expected_phone_last4
    end
from public.whatsapp_connections c
where c.id = a.connection_id and c.organization_id = a.organization_id;

update public.conversation_insight_runs r
set connection_name = pg_catalog.left(c.name, 120),
    connection_last4 = case
      when c.verified_phone_last4 ~ '^[0-9]{4}$' then c.verified_phone_last4
      when c.expected_phone_last4 ~ '^[0-9]{4}$' then c.expected_phone_last4
    end
from public.whatsapp_connections c
where c.id = r.connection_id and c.organization_id = r.organization_id;

-- O contato pela regra nova. O escolhido antes (8 últimos dígitos, o mais
-- antigo no empate) não prova quem é. Se os fatos guardados apontam para
-- outra pessoa, a linha fica sem contato: os fatos não são reescritos.
update public.conversation_analyses a
set contact_id = case when x.do_fato is null or x.do_fato = x.novo then x.novo end
from (
  select id,
         private.contato_pelo_telefone(organization_id, contact_phone) as novo,
         nullif(facts ->> 'contactId', '')::uuid as do_fato
  from public.conversation_analyses
) x
where x.id = a.id and a.contact_id is distinct from (case when x.do_fato is null or x.do_fato = x.novo then x.novo end);

update public.conversation_insight_runs r
set contact_id = case when x.do_fato is null or x.do_fato = x.novo then x.novo end
from (
  select id,
         private.contato_pelo_telefone(organization_id, contact_phone) as novo,
         nullif(facts ->> 'contactId', '')::uuid as do_fato
  from public.conversation_insight_runs
) x
where x.id = r.id;

-- 6. O contato é da mesma empresa ------------------------------------------

alter table public.conversation_analyses
  add constraint conversation_analyses_contato
  foreign key (contact_id, organization_id)
  references public.contacts(id, organization_id)
  on delete set null (contact_id);

alter table public.conversation_insight_runs
  add constraint conversation_insight_runs_contato
  foreign key (contact_id, organization_id)
  references public.contacts(id, organization_id)
  on delete set null (contact_id);

create index conversation_analyses_contato
  on public.conversation_analyses (organization_id, contact_id, requested_at desc)
  where contact_id is not null;

create index conversation_insight_runs_contato
  on public.conversation_insight_runs (organization_id, contact_id, created_at desc)
  where contact_id is not null;

-- A visão dos números passa a usar o contato validado (a coluna), e não o dos
-- fatos. Numa leitura antiga em que os fatos apontam para outra pessoa, o que
-- vem do contato (lead, negócio, reuniões, tarefas) fica vazio, em vez de
-- falar de quem não é. Mesmas colunas, na mesma ordem (20261003100000).
create or replace view public.conversation_intelligence
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
  r.contact_id,
  case when v.do_contato then (r.facts ->> 'isLead')::boolean end as is_lead,
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
  case when v.do_contato then (r.facts -> 'meetings' ->> 'scheduled')::integer end as meetings_scheduled,
  case when v.do_contato then (r.facts -> 'tasks' ->> 'overdue')::integer end as tasks_overdue,
  case when v.do_contato then r.facts -> 'deal' ->> 'status' end as deal_status,
  case when v.do_contato then r.facts -> 'deal' ->> 'stage' end as deal_stage
from public.conversation_insight_runs r
cross join lateral (
  select (r.facts ->> 'contactId') is not distinct from r.contact_id::text as do_contato
) v
where r.is_latest;

-- Sem a conexão, a linha do tempo não existe: as mensagens eram dela.
-- Cópia de 20261010100000; só o caso da conexão nula mudou.
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
  select case when analise.connection_id is null then null else jsonb_build_object(
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
  ) end
  from janela j;
$$;

-- 7. O pedido de análise e os fatos usam o mesmo contato ---------------------
-- Cópia das últimas definições (20261010100000 e 20261004100000); só o
-- trecho que escolhe o contato mudou.

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

  -- O contato do CRM: um só, pelo telefone inteiro (private.contato_pelo_telefone).
  -- Empate ou nenhum, sem contato. Grupo não tem contato.
  if conversa.chat_kind = 'direto' then
    select c.* into contato
    from public.contacts c
    where c.id = private.contato_pelo_telefone(target_organization, telefone);
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

  -- Um contato só, pelo telefone inteiro; empate fica sem contato.
  contato := private.contato_pelo_telefone(target_organization, chat);

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
