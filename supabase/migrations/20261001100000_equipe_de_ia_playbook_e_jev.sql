-- Equipe de IA: o playbook comercial e o Jev olhando cada agente.
--
-- O que esta migration acrescenta ao coordenador de 20260930100000:
--
--   * o PLAYBOOK COMERCIAL da empresa: um só por empresa, com rascunho e
--     versões publicadas (`organization_playbooks`, `playbook_versions`). Só
--     dono e admin gravam, por `playbook_save`. O Jev usa a versão publicada:
--     as objeções e os próximos passos viram opções das perguntas, e os
--     critérios próprios viram perguntas sim/não;
--   * as leituras passam a saber de QUAL AGENTE é a conversa e QUEM falou:
--     `assistant_profile_id`, `ai_messages`, `team_messages`,
--     `contact_messages` e `playbook_version` em `conversation_insight_runs`.
--     É o que alimenta a aba Desempenho de cada agente;
--   * `nucleo_insights_pending` entrega, junto de cada conversa, o agente e o
--     jeito dele (`tone`), e o playbook publicado. O Jev passa a perguntar "a
--     empresa seguiu o jeito definido para este agente?";
--   * o comando `insights_evaluate`: o dono escreve uma conversa de teste na
--     aba Testar do agente, o portal enfileira, a VPS pergunta ao Jev e devolve
--     a avaliação. A conversa de teste vive só no `private_payload`, que a
--     conclusão do comando apaga.
--
-- Qual agente atendeu: o contexto de inteligência mais recente da conversa
-- (`conversation_intelligence_contexts`, ligado pelo contato, comparando os
-- 8 últimos dígitos do telefone). Sem contexto, a porta de entrada: o agente
-- padrão de clientes. É uma aproximação, e está dita aqui para não virar
-- surpresa nos números.

begin;

-- ---------------------------------------------------------------------------
-- 1/7. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.conversation_insight_runs') is null
     or to_regprocedure('public.nucleo_insights_pending(integer, integer)') is null then
    raise exception 'abortado: aplicar 20260930100000 (o coordenador le as conversas) antes';
  end if;
  if to_regclass('public.conversation_intelligence_contexts') is null
     or to_regclass('public.assistant_profiles') is null then
    raise exception 'abortado: os agentes nao existem';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles' and column_name = 'is_default'
  ) then
    raise exception 'abortado: assistant_profiles.is_default nao existe';
  end if;
  if to_regprocedure('private.can_manage_org(uuid)') is null then
    raise exception 'abortado: private.can_manage_org nao existe';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.connection_runtime_commands'::regclass
      and conname = 'connection_runtime_commands_command_type_check'
  ) then
    raise exception 'abortado: o check de command_type da fila de comandos nao existe';
  end if;
  if to_regclass('public.organization_playbooks') is not null then
    raise exception 'abortado: organization_playbooks ja existe; esta migration ja foi aplicada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/7. O playbook.
-- ---------------------------------------------------------------------------
create table public.organization_playbooks (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb
    check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 65536),
  published jsonb not null default '{}'::jsonb
    check (jsonb_typeof(published) = 'object' and octet_length(published::text) <= 65536),
  published_version integer not null default 0 check (published_version >= 0),
  published_at timestamptz,
  published_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.organization_playbooks is
  'O playbook comercial da empresa: rascunho e versao publicada. Escrita so por playbook_save (dono e admin). Ver 20261001100000.';

create table public.playbook_versions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  published_by uuid,
  published_at timestamptz not null default now(),
  primary key (organization_id, version)
);

alter table public.organization_playbooks enable row level security;
alter table public.playbook_versions enable row level security;
revoke all on public.organization_playbooks from anon, authenticated;
revoke all on public.playbook_versions from anon, authenticated;
grant select on public.organization_playbooks to authenticated;
grant select on public.playbook_versions to authenticated;

create policy organization_playbooks_select
on public.organization_playbooks for select to authenticated
using (private.is_org_member(organization_id));

create policy playbook_versions_select
on public.playbook_versions for select to authenticated
using (private.is_org_member(organization_id));

-- O formato, conferido no banco e não só na tela. Devolve o motivo da recusa,
-- ou vazio quando está tudo certo.
create function private.playbook_problema(conteudo jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  chaves text[];
  lista text;
  texto text;
  limites constant jsonb := '{"oferta": 20, "objecoes": 12, "proximosPassos": 6, "criterios": 8}';
begin
  if jsonb_typeof(conteudo) is distinct from 'object' then
    return 'o playbook precisa ser um objeto';
  end if;
  if length(coalesce(conteudo ->> 'segmento', '')) > 40 then
    return 'segmento longo demais';
  end if;

  foreach lista in array array['oferta', 'objecoes', 'proximosPassos', 'criterios'] loop
    if conteudo ? lista then
      if jsonb_typeof(conteudo -> lista) <> 'array' then
        return lista || ' precisa ser uma lista';
      end if;
      if jsonb_array_length(conteudo -> lista) > (limites ->> lista)::integer then
        return lista || ' passou do limite de ' || (limites ->> lista);
      end if;
      for item in select value from jsonb_array_elements(conteudo -> lista) loop
        if jsonb_typeof(item) <> 'object' then
          return lista || ' tem item invalido';
        end if;
        for texto in select value from jsonb_each_text(item) loop
          if length(coalesce(texto, '')) > 600 then
            return lista || ' tem texto longo demais (600)';
          end if;
        end loop;
      end loop;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(conteudo -> 'oferta', '[]'::jsonb)) loop
    if length(trim(coalesce(item ->> 'nome', ''))) not between 1 and 120 then
      return 'todo item da oferta precisa de nome';
    end if;
  end loop;

  foreach lista in array array['objecoes', 'proximosPassos', 'criterios'] loop
    chaves := array[]::text[];
    for item in select value from jsonb_array_elements(coalesce(conteudo -> lista, '[]'::jsonb)) loop
      if coalesce(item ->> 'chave', '') !~ '^[a-z][a-z0-9_]{1,30}$' then
        return lista || ': chave invalida (' || coalesce(item ->> 'chave', '') || ')';
      end if;
      if (item ->> 'chave') = any(chaves) then
        return lista || ': chave repetida (' || (item ->> 'chave') || ')';
      end if;
      chaves := chaves || (item ->> 'chave');
      if lista = 'criterios' then
        if length(trim(coalesce(item ->> 'pergunta', ''))) not between 5 and 300 then
          return 'todo criterio precisa de uma pergunta';
        end if;
      elsif length(trim(coalesce(item ->> 'nome', ''))) not between 1 and 120 then
        return lista || ': todo item precisa de nome';
      end if;
    end loop;
  end loop;

  if conteudo ? 'clienteIdeal' then
    if jsonb_typeof(conteudo -> 'clienteIdeal') <> 'object' then
      return 'clienteIdeal precisa ser um objeto';
    end if;
    foreach lista in array array['atende', 'naoAtende'] loop
      if (conteudo -> 'clienteIdeal') ? lista then
        if jsonb_typeof(conteudo -> 'clienteIdeal' -> lista) <> 'array'
           or jsonb_array_length(conteudo -> 'clienteIdeal' -> lista) > 10 then
          return 'clienteIdeal.' || lista || ' precisa ser uma lista de ate 10';
        end if;
      end if;
    end loop;
  end if;

  return '';
end;
$$;

revoke all on function private.playbook_problema(jsonb) from public, anon, authenticated;

create function public.playbook_save(target_organization uuid, playbook jsonb, publish boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  problema text;
  versao integer;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  problema := private.playbook_problema(playbook);
  if problema <> '' then
    raise exception 'playbook invalido: %', problema;
  end if;

  insert into public.organization_playbooks (organization_id, draft, updated_by, updated_at)
  values (target_organization, playbook, auth.uid(), now())
  on conflict (organization_id) do update
    set draft = excluded.draft, updated_by = excluded.updated_by, updated_at = now();

  if coalesce(publish, false) then
    update public.organization_playbooks
    set published = playbook,
        published_version = published_version + 1,
        published_at = now(),
        published_by = auth.uid()
    where organization_id = target_organization
    returning published_version into versao;

    insert into public.playbook_versions (organization_id, version, content, published_by)
    values (target_organization, versao, playbook, auth.uid());
  end if;

  select published_version into versao
  from public.organization_playbooks where organization_id = target_organization;
  return jsonb_build_object('saved', true, 'published', coalesce(publish, false), 'version', versao);
end;
$$;

revoke all on function public.playbook_save(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.playbook_save(uuid, jsonb, boolean) to authenticated;

-- O que o Jev precisa do playbook publicado: só chaves, nomes e critérios.
create function private.playbook_para_o_jev(target_organization uuid)
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

revoke all on function private.playbook_para_o_jev(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/7. As leituras sabem de que agente são e quem falou.
-- ---------------------------------------------------------------------------
alter table public.conversation_insight_runs
  add column assistant_profile_id uuid,
  add column ai_messages integer not null default 0 check (ai_messages between 0 and 500),
  add column team_messages integer not null default 0 check (team_messages between 0 and 500),
  add column contact_messages integer not null default 0 check (contact_messages between 0 and 500),
  add column playbook_version integer not null default 0 check (playbook_version >= 0);

create index conversation_insight_runs_agente
  on public.conversation_insight_runs (organization_id, assistant_profile_id, created_at desc);

-- O agente da conversa: o contexto mais recente do contato, ou a porta de
-- entrada de clientes.
create function private.agente_da_conversa(target_organization uuid, target_connection uuid, telefone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select contexto.assistant_profile_id
      from public.conversation_intelligence_contexts contexto
      join public.contacts contato
        on contato.id = contexto.contact_id
       and contato.organization_id = contexto.organization_id
      where contexto.organization_id = target_organization
        and (contexto.connection_id is null or contexto.connection_id = target_connection)
        and contexto.audience = 'customer'
        and length(pg_catalog.regexp_replace(contato.phone, '[^0-9]', '', 'g')) >= 8
        and pg_catalog.right(pg_catalog.regexp_replace(contato.phone, '[^0-9]', '', 'g'), 8)
            = pg_catalog.right(pg_catalog.regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g'), 8)
      order by contexto.last_message_at desc
      limit 1
    ),
    (
      select perfil.id
      from public.assistant_profiles perfil
      where perfil.organization_id = target_organization
        and perfil.audience = 'customer'
        and perfil.is_default
      order by perfil.created_at
      limit 1
    )
  );
$$;

revoke all on function private.agente_da_conversa(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4/7. A fila do coordenador entrega agente, jeito e playbook.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_insights_pending(max_items integer default 5, quiet_minutes integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  limite integer := greatest(1, least(coalesce(max_items, 5), 10));
  quieto integer := greatest(5, least(coalesce(quiet_minutes, 60), 1440));
  resultado jsonb;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;

  if not private.org_has_feature(robot_org, 'conversation_insights') then
    return jsonb_build_object('enabled', false, 'conversations', '[]'::jsonb);
  end if;

  with candidatas as (
    select conversa.contact_phone, conversa.last_message_at
    from public.whatsapp_conversations conversa
    where conversa.connection_id = robot_connection
      and conversa.organization_id = robot_org
      and conversa.chat_kind = 'direto'
      and conversa.last_message_at is not null
      and conversa.last_message_at >= now() - interval '7 days'
      and conversa.last_message_at <= now() - pg_catalog.make_interval(mins => quieto)
      and exists (
        select 1 from public.whatsapp_messages mensagem
        where mensagem.connection_id = conversa.connection_id
          and mensagem.contact_phone = conversa.contact_phone
          and not mensagem.is_from_me
      )
      and not exists (
        select 1 from public.conversation_insight_runs leitura
        where leitura.connection_id = conversa.connection_id
          and leitura.contact_phone = conversa.contact_phone
          and leitura.status = 'ok'
          and leitura.analyzed_until >= conversa.last_message_at
      )
      and not exists (
        select 1 from public.conversation_insight_runs leitura
        where leitura.connection_id = conversa.connection_id
          and leitura.contact_phone = conversa.contact_phone
          and leitura.status = 'failed'
          and leitura.created_at > now() - interval '1 hour'
      )
    order by conversa.last_message_at desc
    limit limite
  ), com_agente as (
    select candidata.*, private.agente_da_conversa(robot_org, robot_connection, candidata.contact_phone) as agente_id
    from candidatas candidata
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'phone', candidata.contact_phone,
      'lastMessageAt', candidata.last_message_at,
      'agent', case when perfil.id is null then null else jsonb_build_object(
        'id', perfil.id,
        'name', perfil.display_name,
        'tone', perfil.tone
      ) end,
      'messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sentAt', ultima.sent_at,
            'fromMe', ultima.is_from_me,
            'authorKind', ultima.author_kind,
            'mediaType', ultima.media_type,
            'content', pg_catalog.left(ultima.content, 1500)
          ) order by ultima.sent_at, ultima.message_id
        )
        from (
          select mensagem.sent_at, mensagem.message_id, mensagem.is_from_me,
                 mensagem.author_kind, mensagem.media_type, mensagem.content
          from public.whatsapp_messages mensagem
          where mensagem.connection_id = robot_connection
            and mensagem.contact_phone = candidata.contact_phone
          order by mensagem.sent_at desc, mensagem.message_id desc
          limit 80
        ) ultima
      ), '[]'::jsonb)
    ) order by candidata.last_message_at desc
  ), '[]'::jsonb)
  into resultado
  from com_agente candidata
  left join public.assistant_profiles perfil
    on perfil.id = candidata.agente_id
   and perfil.organization_id = robot_org;

  return jsonb_build_object(
    'enabled', true,
    'conversations', resultado,
    'playbook', private.playbook_para_o_jev(robot_org)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5/7. A gravação aceita agente, quem falou e a versão do playbook.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_insights_record(record_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  telefone text;
  ate timestamptz;
  situacao text;
  respostas jsonb;
  resposta jsonb;
  resumo jsonb := '{}'::jsonb;
  nova uuid;
  podadas integer := 0;
  agente uuid;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if jsonb_typeof(record_payload) is distinct from 'object'
     or pg_catalog.octet_length(record_payload::text) > 65536 then
    raise exception 'insight record payload is invalid';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;

  if not private.org_has_feature(robot_org, 'conversation_insights') then
    raise exception 'conversation insights are disabled for this organization';
  end if;

  telefone := coalesce(record_payload ->> 'phone', '');
  if not exists (
    select 1 from public.whatsapp_conversations conversa
    where conversa.connection_id = robot_connection
      and conversa.organization_id = robot_org
      and conversa.contact_phone = telefone
  ) then
    raise exception 'conversation not found for this connection';
  end if;

  begin
    ate := (record_payload ->> 'analyzedUntil')::timestamptz;
  exception when others then
    raise exception 'analyzedUntil is invalid';
  end;
  if ate is null or ate > now() + interval '5 minutes' then
    raise exception 'analyzedUntil is invalid';
  end if;

  situacao := coalesce(record_payload ->> 'status', '');
  if situacao not in ('ok', 'failed') then
    raise exception 'status must be ok or failed';
  end if;

  respostas := coalesce(record_payload -> 'answers', '[]'::jsonb);
  if jsonb_typeof(respostas) <> 'array' or pg_catalog.jsonb_array_length(respostas) > 40 then
    raise exception 'answers are invalid';
  end if;
  if situacao = 'ok' and pg_catalog.jsonb_array_length(respostas) = 0 then
    raise exception 'an ok reading needs answers';
  end if;

  for resposta in select value from pg_catalog.jsonb_array_elements(respostas) loop
    if jsonb_typeof(resposta) <> 'object'
       or coalesce(resposta ->> 'question', '') !~ '^[a-z][a-z0-9_]{1,40}$'
       or length(coalesce(resposta ->> 'answer', '')) not between 1 and 60
       or (resposta ? 'probability' and jsonb_typeof(resposta -> 'probability') not in ('number', 'null'))
       or coalesce((resposta ->> 'probability')::numeric, 0) not between 0 and 1
       or (resposta ? 'distribution' and jsonb_typeof(resposta -> 'distribution') <> 'object') then
      raise exception 'answer is invalid';
    end if;
    resumo := resumo || jsonb_build_object(
      resposta ->> 'question',
      jsonb_build_object(
        'a', resposta ->> 'answer',
        'p', round(((resposta ->> 'probability')::numeric), 4)
      )
    );
  end loop;

  -- O agente só é aceito se for desta empresa. Sem ele, a leitura continua
  -- valendo; só não entra no Desempenho de agente nenhum.
  begin
    agente := nullif(record_payload ->> 'assistantProfileId', '')::uuid;
  exception when others then
    agente := null;
  end;
  if agente is not null and not exists (
    select 1 from public.assistant_profiles perfil
    where perfil.id = agente and perfil.organization_id = robot_org
  ) then
    agente := null;
  end if;

  if situacao = 'ok' then
    update public.conversation_insight_runs leitura
    set is_latest = false
    where leitura.connection_id = robot_connection
      and leitura.contact_phone = telefone
      and leitura.is_latest;
  end if;

  insert into public.conversation_insight_runs (
    organization_id, connection_id, contact_phone, analyzed_until, messages_count,
    status, error_code, model, framework_version, input_tokens, cost_usd, latency_ms,
    summary, is_latest, assistant_profile_id, ai_messages, team_messages, contact_messages,
    playbook_version
  ) values (
    robot_org,
    robot_connection,
    telefone,
    ate,
    greatest(0, least(coalesce((record_payload ->> 'messagesCount')::integer, 0), 500)),
    situacao,
    pg_catalog.left(coalesce(record_payload ->> 'errorCode', ''), 80),
    pg_catalog.left(coalesce(record_payload ->> 'model', ''), 80),
    pg_catalog.left(coalesce(record_payload ->> 'frameworkVersion', ''), 40),
    greatest(0, coalesce((record_payload ->> 'inputTokens')::integer, 0)),
    greatest(0, coalesce((record_payload ->> 'costUsd')::numeric, 0)),
    greatest(0, coalesce((record_payload ->> 'latencyMs')::integer, 0)),
    case when situacao = 'ok' then resumo else '{}'::jsonb end,
    situacao = 'ok',
    agente,
    greatest(0, least(coalesce((record_payload ->> 'aiMessages')::integer, 0), 500)),
    greatest(0, least(coalesce((record_payload ->> 'teamMessages')::integer, 0), 500)),
    greatest(0, least(coalesce((record_payload ->> 'contactMessages')::integer, 0), 500)),
    greatest(0, coalesce((record_payload ->> 'playbookVersion')::integer, 0))
  )
  returning id into nova;

  if situacao = 'ok' then
    insert into public.conversation_insight_answers (run_id, organization_id, question, answer, probability, distribution)
    select
      nova,
      robot_org,
      item ->> 'question',
      item ->> 'answer',
      round((item ->> 'probability')::numeric, 4),
      coalesce(item -> 'distribution', '{}'::jsonb)
    from pg_catalog.jsonb_array_elements(respostas) as item
    on conflict (run_id, question) do nothing;
  end if;

  delete from public.conversation_insight_runs velha
  where velha.connection_id = robot_connection
    and velha.created_at < now() - interval '180 days';
  get diagnostics podadas = row_count;

  return jsonb_build_object('recorded', true, 'id', nova, 'pruned', podadas);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6/7. O comando "avaliar uma conversa de teste".
-- ---------------------------------------------------------------------------
do $$
declare tipos text[];
begin
  select array_agg(m[1] order by ord) into tipos
  from pg_constraint c,
       regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') with ordinality as x(m, ord)
  where c.conrelid = 'public.connection_runtime_commands'::regclass
    and c.conname = 'connection_runtime_commands_command_type_check';
  if tipos is null then raise exception 'abortado: o check de command_type da fila de comandos nao existe'; end if;
  -- Acrescenta sem reescrever, como em 20260926120000: a lista de produção
  -- pode ter tipos que este ramo nem conhece.
  if not ('insights_evaluate' = any(tipos)) then
    tipos := tipos || array['insights_evaluate'];
    alter table public.connection_runtime_commands drop constraint connection_runtime_commands_command_type_check;
    execute format(
      'alter table public.connection_runtime_commands add constraint connection_runtime_commands_command_type_check check (command_type = any (array[%s]::text[]))',
      (select string_agg(quote_literal(t), ', ' order by ord) from unnest(tipos) with ordinality as u(t, ord)));
  end if;
end;
$$;

-- Dono ou admin escreve uma conversa de teste e pede a avaliação do Jev com
-- o jeito do agente escolhido e o playbook publicado. Volta o id do comando,
-- que a tela acompanha por `nucleo_insights_evaluate_status`.
create function public.nucleo_insights_evaluate_request(
  target_organization uuid,
  target_profile uuid,
  transcript text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  perfil public.assistant_profiles%rowtype;
  conexao uuid;
  texto text := trim(coalesce(transcript, ''));
  comando uuid;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if not private.org_has_feature(target_organization, 'conversation_insights') then
    raise exception 'conversation insights are disabled for this organization';
  end if;
  if length(texto) < 10 or length(texto) > 20000 then
    raise exception 'test conversation must have between 10 and 20000 characters';
  end if;

  select * into perfil
  from public.assistant_profiles
  where id = target_profile and organization_id = target_organization;
  if not found then
    raise exception 'agent not found';
  end if;

  conexao := private.conexao_da_organizacao(target_organization);
  if conexao is null then
    raise exception 'organization has no WhatsApp connection';
  end if;

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload, created_by,
    idempotency_key, expires_at
  ) values (
    target_organization,
    conexao,
    'insights_evaluate',
    jsonb_build_object(
      'transcript', texto,
      'agent', jsonb_build_object('id', perfil.id, 'name', perfil.display_name, 'tone', perfil.tone),
      'playbook', private.playbook_para_o_jev(target_organization)
    ),
    auth.uid(),
    encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'),
    now() + interval '3 minutes'
  )
  returning id into comando;

  return jsonb_build_object('commandId', comando, 'status', 'pending');
end;
$$;

create function public.nucleo_insights_evaluate_status(target_organization uuid, target_command uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha public.connection_runtime_commands%rowtype;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;

  update public.connection_runtime_commands
  set status = 'expired', private_payload = '{}'::jsonb, error_code = 'expired',
      completed_at = now(), updated_at = now()
  where id = target_command
    and organization_id = target_organization
    and command_type = 'insights_evaluate'
    and status in ('pending', 'claimed')
    and expires_at <= now();

  select * into linha
  from public.connection_runtime_commands
  where id = target_command
    and organization_id = target_organization
    and command_type = 'insights_evaluate';
  if not found then
    raise exception 'evaluation not found';
  end if;

  return jsonb_build_object(
    'commandId', linha.id,
    'status', linha.status,
    'errorCode', linha.error_code,
    'result', linha.public_result,
    'completedAt', linha.completed_at
  );
end;
$$;

revoke all on function public.nucleo_insights_evaluate_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.nucleo_insights_evaluate_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nucleo_insights_evaluate_request(uuid, uuid, text) to authenticated;
grant execute on function public.nucleo_insights_evaluate_status(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7/7. Conferência.
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.organization_playbooks'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.playbook_versions'::regclass) then
    raise exception 'conferencia: RLS desligada no playbook';
  end if;
  if has_table_privilege('authenticated', 'public.organization_playbooks', 'insert')
     or has_table_privilege('authenticated', 'public.organization_playbooks', 'update') then
    raise exception 'conferencia: authenticated escreve direto no playbook';
  end if;
  if has_function_privilege('anon', 'public.playbook_save(uuid, jsonb, boolean)', 'execute')
     or has_function_privilege('anon', 'public.nucleo_insights_evaluate_request(uuid, uuid, text)', 'execute') then
    raise exception 'conferencia: anon executa as RPCs novas';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.connection_runtime_commands'::regclass
      and conname = 'connection_runtime_commands_command_type_check'
      and pg_get_constraintdef(oid) like '%insights_evaluate%'
      and pg_get_constraintdef(oid) like '%conversation_send%'
  ) then
    raise exception 'conferencia: a fila de comandos perdeu ou nao ganhou tipos';
  end if;
end $$;

commit;
