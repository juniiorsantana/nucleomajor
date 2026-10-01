-- O coordenador lê as conversas: a leitura automática feita pelo Jev.
--
-- O runtime da VPS ganha um trabalhador novo, o coordenador. De tempos em
-- tempos ele pergunta ao banco quais conversas pedem leitura, monta cada uma,
-- manda para o Jev (modelo de decisão da TypeSafe, pelo OpenRouter) com as
-- perguntas do framework da Major e devolve as respostas para cá. O Jev não
-- escreve texto: cada resposta é uma opção fechada com a chance de estar certa.
--
-- O que esta migration cria:
--
--   * a função `conversation_insights` no catálogo de funções por empresa.
--     Nasce DESLIGADA para todas, como toda função nova (20260924100000). A
--     Major liga pelo painel da plataforma, empresa por empresa: ligar é dizer
--     "as conversas desta empresa podem sair para o OpenRouter";
--   * `conversation_insight_runs`: uma linha por leitura. Quando, até que
--     mensagem, quantas mensagens, modelo, versão do framework, tokens, custo,
--     tempo e se deu certo. `summary` guarda as respostas compactas para o
--     portal ler a conversa inteira numa linha só; `is_latest` marca a leitura
--     em vigor de cada conversa;
--   * `conversation_insight_answers`: uma linha por pergunta respondida. É
--     daqui que saem os números gerais (quantos leads quentes, quantas
--     perguntas sem resposta), e é por isso que as respostas também ficam
--     separadas, e não só dentro do `summary`;
--   * `nucleo_insights_pending`: o robô da conexão pergunta quais conversas
--     pedem leitura e recebe as últimas mensagens de cada uma;
--   * `nucleo_insights_record`: o robô devolve a leitura.
--
-- O que NÃO cria, de propósito:
--
--   * nenhum gatilho de realtime. O aviso do portal (portal_realtime_events)
--     já encheu o banco uma vez; a leitura não precisa aparecer no segundo em
--     que fica pronta, e o portal a busca por conta própria;
--   * nenhuma ação. A primeira versão só registra e mostra. Etiqueta, tarefa
--     e aviso disparados por sinal entram depois, com os cortes de confiança
--     medidos nas leituras reais;
--   * texto de mensagem. Só as respostas ficam guardadas.
--
-- Quem lê: membros da empresa, pela mesma RLS das conversas. Quem escreve: só
-- o robô da conexão, pelas duas RPCs, que derivam empresa e conexão do
-- usuário autenticado e ignoram o que o chamador alegar.

begin;

-- ---------------------------------------------------------------------------
-- 1/6. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.platform_features') is null
     or to_regprocedure('private.org_has_feature(uuid, text)') is null then
    raise exception 'abortado: aplicar 20260924100000 (funcoes e limites por empresa) antes';
  end if;
  if to_regprocedure('private.robot_organization()') is null
     or to_regclass('public.connection_robot_credentials') is null then
    raise exception 'abortado: credencial do robo da conexao nao existe';
  end if;
  if to_regclass('public.whatsapp_conversations') is null
     or to_regclass('public.whatsapp_messages') is null then
    raise exception 'abortado: o espelho das conversas nao existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'whatsapp_messages' and column_name = 'author_kind'
  ) then
    raise exception 'abortado: aplicar 20260913230000 (o nome de quem escreveu) antes';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'chat_kind'
  ) then
    raise exception 'abortado: whatsapp_conversations.chat_kind nao existe';
  end if;
  if to_regclass('public.conversation_insight_runs') is not null then
    raise exception 'abortado: conversation_insight_runs ja existe; esta migration ja foi aplicada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/6. A função no catálogo, desligada para todos.
-- ---------------------------------------------------------------------------
insert into public.platform_features (key, kind, name, description, category, is_ai, sort_order)
values (
  'conversation_insights',
  'feature',
  'Leitura automatica das conversas',
  'O Jev le as conversas do WhatsApp e registra temperatura do lead, objecoes, qualidade do atendimento e sinais. O texto das conversas e enviado ao OpenRouter.',
  'ia',
  true,
  85
);

-- ---------------------------------------------------------------------------
-- 3/6. As leituras e as respostas.
-- ---------------------------------------------------------------------------
create table public.conversation_insight_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  contact_phone text not null check (contact_phone ~ '^[0-9][0-9-]{5,39}$'),
  -- Até onde a leitura foi: o `last_message_at` da conversa no momento em que
  -- o coordenador a pegou. Conversa que recebeu mensagem depois disso pede
  -- leitura nova.
  analyzed_until timestamptz not null,
  messages_count integer not null default 0 check (messages_count between 0 and 500),
  status text not null check (status in ('ok', 'failed')),
  error_code text not null default '' check (length(error_code) <= 80),
  model text not null default '' check (length(model) <= 80),
  framework_version text not null default '' check (length(framework_version) <= 40),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cost_usd numeric(12, 8) not null default 0 check (cost_usd >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  -- {"temperatura": {"a": "morno", "p": 0.71}, ...}: as respostas da leitura,
  -- compactas, para o portal ler uma conversa numa linha só.
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 8192),
  is_latest boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade,
  check (status = 'ok' or not is_latest)
);

comment on table public.conversation_insight_runs is
  'Uma leitura automatica de conversa feita pelo Jev (coordenador da VPS). Escrita so por nucleo_insights_record. is_latest marca a leitura em vigor de cada conversa. Ver 20260930100000.';

-- A leitura em vigor: uma por conversa, e é ela que o portal busca.
create unique index conversation_insight_runs_latest
  on public.conversation_insight_runs (connection_id, contact_phone)
  where is_latest;
create index conversation_insight_runs_conversa
  on public.conversation_insight_runs (connection_id, contact_phone, created_at desc);
create index conversation_insight_runs_org_latest
  on public.conversation_insight_runs (organization_id)
  where is_latest;
create index conversation_insight_runs_poda
  on public.conversation_insight_runs (connection_id, created_at);

create table public.conversation_insight_answers (
  run_id uuid not null references public.conversation_insight_runs(id) on delete cascade,
  organization_id uuid not null,
  question text not null check (question ~ '^[a-z][a-z0-9_]{1,40}$'),
  answer text not null check (length(answer) between 1 and 60),
  probability numeric(5, 4) check (probability is null or probability between 0 and 1),
  -- A distribuição inteira que o Jev devolveu (por opção ou por nível), para
  -- recalibrar os cortes sem precisar ler a conversa de novo.
  distribution jsonb not null default '{}'::jsonb
    check (jsonb_typeof(distribution) = 'object' and octet_length(distribution::text) <= 2048),
  primary key (run_id, question)
);

comment on table public.conversation_insight_answers is
  'As respostas de uma leitura, uma por pergunta do framework. Base dos numeros gerais. Ver 20260930100000.';

create index conversation_insight_answers_org_question
  on public.conversation_insight_answers (organization_id, question);

-- ---------------------------------------------------------------------------
-- 4/6. Quem lê.
-- ---------------------------------------------------------------------------
alter table public.conversation_insight_runs enable row level security;
alter table public.conversation_insight_answers enable row level security;
revoke all on public.conversation_insight_runs from anon, authenticated;
revoke all on public.conversation_insight_answers from anon, authenticated;
grant select on public.conversation_insight_runs to authenticated;
grant select on public.conversation_insight_answers to authenticated;

create policy conversation_insight_runs_select
on public.conversation_insight_runs for select to authenticated
using (private.is_org_member(organization_id));

create policy conversation_insight_answers_select
on public.conversation_insight_answers for select to authenticated
using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- 5/6. O robô pergunta o que ler.
-- ---------------------------------------------------------------------------
--
-- Uma conversa pede leitura quando:
--   * é conversa direta (grupo fica de fora: o espelho não guarda quem falou
--     dentro dele, e a leitura de lead não faz sentido ali);
--   * teve mensagem nos últimos 7 dias e está quieta há `quiet_minutes`. Ler
--     no meio de uma troca de mensagens daria uma foto de meia conversa;
--   * o contato escreveu ao menos uma vez (só mensagem da empresa não é
--     conversa);
--   * a leitura em vigor não cobre a última mensagem;
--   * não falhou na última hora. Falha transitória tenta de novo depois;
--     falha permanente não vira laço que gasta crédito a cada ciclo.
--
-- Devolve as últimas 80 mensagens de cada conversa, em ordem, com o texto
-- cortado em 1500 caracteres. Com a função desligada para a empresa, devolve
-- `enabled = false` e lista vazia: o robô não sabe nem tem como saber o que
-- haveria para ler.
create function public.nucleo_insights_pending(max_items integer default 5, quiet_minutes integer default 60)
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
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'phone', candidata.contact_phone,
      'lastMessageAt', candidata.last_message_at,
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
          -- Sem corte por `last_message_at`: a lista e as mensagens são
          -- gravadas em momentos diferentes, e o relógio de uma pode passar
          -- alguns milissegundos do da outra. Mensagem que chegou depois só
          -- faz a leitura sair um pouco mais completa.
          where mensagem.connection_id = robot_connection
            and mensagem.contact_phone = candidata.contact_phone
          order by mensagem.sent_at desc, mensagem.message_id desc
          limit 80
        ) ultima
      ), '[]'::jsonb)
    ) order by candidata.last_message_at desc
  ), '[]'::jsonb)
  into resultado
  from candidatas candidata;

  return jsonb_build_object('enabled', true, 'conversations', resultado);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6/6. O robô devolve a leitura.
-- ---------------------------------------------------------------------------
--
-- Formato do `record_payload`:
--   {
--     "phone": "5565...", "analyzedUntil": "2026-10-01T12:00:00Z",
--     "messagesCount": 42, "status": "ok" | "failed", "errorCode": "",
--     "model": "typesafe/jev-1.13-20260917", "frameworkVersion": "major-v1",
--     "inputTokens": 4005, "costUsd": 0.000168, "latencyMs": 917,
--     "answers": [{"question": "temperatura", "answer": "morno",
--                  "probability": 0.71, "distribution": {...}}, ...]
--   }
--
-- Leitura `ok` vira a leitura em vigor da conversa e aposenta a anterior.
-- Leitura `failed` só fica registrada (é ela que segura a nova tentativa por
-- uma hora). Leituras com mais de 180 dias desta conexão são podadas aqui
-- mesmo, sem rotina à parte.
create function public.nucleo_insights_record(record_payload jsonb)
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
    summary, is_latest
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
    situacao = 'ok'
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

revoke all on function public.nucleo_insights_pending(integer, integer) from public, anon, authenticated;
revoke all on function public.nucleo_insights_record(jsonb) from public, anon, authenticated;
grant execute on function public.nucleo_insights_pending(integer, integer) to authenticated;
grant execute on function public.nucleo_insights_record(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: o estado que esta migration promete, afirmado direto.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.platform_features where key = 'conversation_insights' and kind = 'feature' and is_ai) then
    raise exception 'conferencia: a funcao conversation_insights nao entrou no catalogo';
  end if;
  if exists (select 1 from public.organization_entitlements where key = 'conversation_insights') then
    raise exception 'conferencia: conversation_insights nasceu ligada para alguem';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.conversation_insight_runs'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.conversation_insight_answers'::regclass) then
    raise exception 'conferencia: RLS desligada nas leituras';
  end if;
  if has_function_privilege('anon', 'public.nucleo_insights_pending(integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.nucleo_insights_record(jsonb)', 'execute') then
    raise exception 'conferencia: anon executa as RPCs do coordenador';
  end if;
  if has_table_privilege('authenticated', 'public.conversation_insight_runs', 'insert')
     or has_table_privilege('authenticated', 'public.conversation_insight_answers', 'insert') then
    raise exception 'conferencia: authenticated escreve direto nas leituras';
  end if;
end $$;

commit;
