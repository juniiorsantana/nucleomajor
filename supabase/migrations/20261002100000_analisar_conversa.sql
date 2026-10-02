-- Analisar conversa: o botão pago, com o Claude explicando o que o Jev viu.
--
-- Dono ou admin abre uma conversa, escolhe Comercial ou Atendimento e pede a
-- análise. Ela gasta 1 crédito do mês. A VPS pega o pedido pela fila de
-- comandos, entrega ao Agente Analista (o Claude, na SEGUNDA conta da Major,
-- separada do atendimento) a conversa, a leitura do Jev, o playbook publicado
-- e o funil da empresa, e grava a análise: o porquê, as mensagens que
-- comprovam, o que faltou, o próximo passo e sugestões para aplicar com um
-- clique. A análise fica como rascunho por 7 dias; salvar põe na ficha.
--
-- Créditos (decisão de 26/09/2026): Base 30, Atendimento 100, Completo 200 por
-- mês; Empresarial sob medida pelo painel (limite `analysis_credits`, nulo =
-- sem limite). Não acumulam. Renovam no dia do mês em que a empresa assinou
-- (`organization_subscriptions.started_at`; dia 31 vira o último dia dos meses
-- mais curtos), à meia-noite de São Paulo. Refazer gasta outro. Falha não
-- conta: o crédito volta sozinho, porque só pedidos que não falharam contam.
--
-- O que NÃO cria: gatilho de realtime (a tela consulta o status), escrita
-- direta em tabela (só RPC) e nenhuma ação sobre o CRM: aplicar uma sugestão
-- usa as operações que o portal já tem, com quem clicou.

begin;

-- ---------------------------------------------------------------------------
-- 1/8. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.org_limits(uuid)') is null
     or to_regclass('public.platform_features') is null then
    raise exception 'abortado: aplicar 20260924100000 (funcoes e limites por empresa) antes';
  end if;
  if to_regprocedure('private.playbook_para_o_jev(uuid)') is null
     or to_regprocedure('private.agente_da_conversa(uuid, uuid, text)') is null then
    raise exception 'abortado: aplicar 20261001100000 (equipe de ia) antes';
  end if;
  if to_regprocedure('private.conexao_da_organizacao(uuid)') is null then
    raise exception 'abortado: private.conexao_da_organizacao nao existe';
  end if;
  if not exists (select 1 from public.saas_plans where code in ('base', 'atendimento', 'completo')) then
    raise exception 'abortado: os planos base, atendimento e completo nao existem';
  end if;
  if to_regclass('public.conversation_analyses') is not null then
    raise exception 'abortado: conversation_analyses ja existe; esta migration ja foi aplicada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/8. Os créditos por plano.
-- ---------------------------------------------------------------------------
insert into public.platform_features (key, kind, name, description, category, is_ai, sort_order)
values (
  'analysis_credits',
  'limit',
  'Analises de conversa por mes',
  'Quantas analises completas de conversa (botao Analisar conversa) a empresa pode pedir por mes. Renova no dia da assinatura. Vazio = sem limite.',
  'limite',
  false,
  210
);

update public.saas_plans set limits = limits || '{"analysis_credits": 30}'::jsonb, updated_at = now() where code = 'base';
update public.saas_plans set limits = limits || '{"analysis_credits": 100}'::jsonb, updated_at = now() where code = 'atendimento';
update public.saas_plans set limits = limits || '{"analysis_credits": 200}'::jsonb, updated_at = now() where code in ('completo', 'full');

-- ---------------------------------------------------------------------------
-- 3/8. As análises.
-- ---------------------------------------------------------------------------
create table public.conversation_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  contact_phone text not null check (contact_phone ~ '^[0-9][0-9-]{5,39}$'),
  contact_id uuid,
  kind text not null check (kind in ('comercial', 'atendimento')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'expired')),
  error_code text not null default '' check (length(error_code) <= 80),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  -- O início do ciclo de créditos em que o pedido entrou. Guardado para o
  -- histórico; a conta do saldo usa `requested_at`.
  cycle_start timestamptz not null,
  result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 32768),
  model text not null default '' check (length(model) <= 80),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  saved_at timestamptz,
  saved_by uuid,
  command_id uuid,
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade,
  check (saved_at is null or status = 'done')
);

comment on table public.conversation_analyses is
  'Analises de conversa pedidas pelo botao (Claude, segunda conta). Escrita so pelas RPCs. Rascunho por 7 dias; salvo vai para a ficha. Ver 20261002100000.';

create index conversation_analyses_ciclo on public.conversation_analyses (organization_id, requested_at desc);
create index conversation_analyses_conversa on public.conversation_analyses (connection_id, contact_phone, requested_at desc);

alter table public.conversation_analyses enable row level security;
revoke all on public.conversation_analyses from anon, authenticated;
grant select on public.conversation_analyses to authenticated;

-- A equipe vê as salvas; dono e admin veem também os rascunhos.
create policy conversation_analyses_select
on public.conversation_analyses for select to authenticated
using (
  private.is_org_member(organization_id)
  and (saved_at is not null or private.can_manage_org(organization_id))
);

-- ---------------------------------------------------------------------------
-- 4/8. O ciclo e o saldo.
-- ---------------------------------------------------------------------------
-- O início do ciclo em vigor: o dia da assinatura no mês corrente (ou o último
-- dia do mês, quando ele é mais curto), à meia-noite de São Paulo. Se esse dia
-- ainda não chegou, o ciclo começou no mês anterior.
create function private.ciclo_de_analise(target_organization uuid, agora timestamptz default now())
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ancora timestamptz;
  dia integer;
  hoje date := (agora at time zone 'America/Sao_Paulo')::date;
  mes date;
  candidato date;
begin
  select coalesce(
    (select s.started_at from public.organization_subscriptions s where s.organization_id = target_organization),
    (select o.created_at from public.organizations o where o.id = target_organization),
    agora
  ) into ancora;
  dia := extract(day from ancora at time zone 'America/Sao_Paulo')::integer;
  mes := date_trunc('month', hoje)::date;
  candidato := mes + (least(dia, extract(day from (mes + interval '1 month' - interval '1 day'))::integer) - 1);
  if candidato > hoje then
    mes := (mes - interval '1 month')::date;
    candidato := mes + (least(dia, extract(day from (mes + interval '1 month' - interval '1 day'))::integer) - 1);
  end if;
  return candidato::timestamp at time zone 'America/Sao_Paulo';
end;
$$;

create function private.renovacao_de_analise(target_organization uuid, agora timestamptz default now())
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inicio timestamptz := private.ciclo_de_analise(target_organization, agora);
  ancora timestamptz;
  dia integer;
  mes date;
begin
  select coalesce(
    (select s.started_at from public.organization_subscriptions s where s.organization_id = target_organization),
    (select o.created_at from public.organizations o where o.id = target_organization),
    agora
  ) into ancora;
  dia := extract(day from ancora at time zone 'America/Sao_Paulo')::integer;
  mes := (date_trunc('month', inicio at time zone 'America/Sao_Paulo') + interval '1 month')::date;
  return (mes + (least(dia, extract(day from (mes + interval '1 month' - interval '1 day'))::integer) - 1))::timestamp
    at time zone 'America/Sao_Paulo';
end;
$$;

-- O saldo: limite do plano (com o ajuste do painel), usados no ciclo (pedidos
-- que não falharam) e as datas. Limite nulo é sem limite.
create function private.creditos_de_analise(target_organization uuid)
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

revoke all on function private.ciclo_de_analise(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.renovacao_de_analise(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.creditos_de_analise(uuid) from public, anon, authenticated;

create function public.conversation_analysis_credits(target_organization uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  return private.creditos_de_analise(target_organization);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5/8. O comando da fila.
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
  if not ('conversation_analyze' = any(tipos)) then
    tipos := tipos || array['conversation_analyze'];
    alter table public.connection_runtime_commands drop constraint connection_runtime_commands_command_type_check;
    execute format(
      'alter table public.connection_runtime_commands add constraint connection_runtime_commands_command_type_check check (command_type = any (array[%s]::text[]))',
      (select string_agg(quote_literal(t), ', ' order by ord) from unnest(tipos) with ordinality as u(t, ord)));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6/8. Pedir a análise.
-- ---------------------------------------------------------------------------
create function public.conversation_analysis_request(
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
  leitura jsonb;
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

  -- Rascunhos com mais de 7 dias perdem o conteúdo, mas continuam contando no
  -- ciclo: apagar a linha devolveria um crédito que foi usado.
  update public.conversation_analyses a
  set status = 'expired', result = '{}'::jsonb
  where a.organization_id = target_organization
    and a.status = 'done'
    and a.saved_at is null
    and a.completed_at < now() - interval '7 days';
  delete from public.conversation_analyses a
  where a.organization_id = target_organization
    and a.saved_at is null
    and a.requested_at < now() - interval '120 days';

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

  select r.summary into leitura
  from public.conversation_insight_runs r
  where r.connection_id = conexao and r.contact_phone = chat and r.is_latest
  limit 1;

  insert into public.conversation_analyses (
    organization_id, connection_id, contact_phone, contact_id, kind, requested_by, cycle_start
  ) values (
    target_organization, conexao, chat, contato, tipo, auth.uid(), (saldo ->> 'cycleStart')::timestamptz
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
      'reading', coalesce(leitura, '{}'::jsonb),
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
-- 7/8. A VPS grava; a tela acompanha e salva.
-- ---------------------------------------------------------------------------
create function public.nucleo_analysis_record(record_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  analise public.conversation_analyses%rowtype;
  situacao text := coalesce(record_payload ->> 'status', '');
  resultado jsonb := coalesce(record_payload -> 'result', '{}'::jsonb);
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
  if situacao not in ('running', 'done', 'failed') then
    raise exception 'status must be running, done or failed';
  end if;
  if jsonb_typeof(resultado) <> 'object' or octet_length(resultado::text) > 32768 then
    raise exception 'analysis result is invalid';
  end if;

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

  update public.conversation_analyses a
  set status = situacao,
      started_at = coalesce(a.started_at, now()),
      completed_at = case when situacao in ('done', 'failed') then now() else null end,
      result = case when situacao = 'done' then resultado else '{}'::jsonb end,
      error_code = case when situacao = 'failed' then pg_catalog.left(coalesce(record_payload ->> 'errorCode', 'failed'), 80) else '' end,
      model = pg_catalog.left(coalesce(record_payload ->> 'model', a.model), 80),
      latency_ms = greatest(0, coalesce((record_payload ->> 'latencyMs')::integer, a.latency_ms))
  where a.id = analise.id;

  return jsonb_build_object('recorded', true, 'status', situacao);
end;
$$;

create function public.conversation_analysis_status(target_organization uuid, target_analysis uuid)
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

create function public.conversation_analysis_save(target_organization uuid, target_analysis uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  update public.conversation_analyses a
  set saved_at = coalesce(a.saved_at, now()), saved_by = coalesce(a.saved_by, auth.uid())
  where a.id = target_analysis
    and a.organization_id = target_organization
    and a.status = 'done';
  if not found then
    raise exception 'only a finished analysis can be saved';
  end if;
  return jsonb_build_object('saved', true);
end;
$$;

revoke all on function public.conversation_analysis_credits(uuid) from public, anon, authenticated;
revoke all on function public.conversation_analysis_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.nucleo_analysis_record(jsonb) from public, anon, authenticated;
revoke all on function public.conversation_analysis_status(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conversation_analysis_save(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conversation_analysis_credits(uuid) to authenticated;
grant execute on function public.conversation_analysis_request(uuid, uuid, text, text) to authenticated;
grant execute on function public.nucleo_analysis_record(jsonb) to authenticated;
grant execute on function public.conversation_analysis_status(uuid, uuid) to authenticated;
grant execute on function public.conversation_analysis_save(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8/8. Conferência.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.saas_plans where code = 'base' and (limits ->> 'analysis_credits')::integer = 30)
     or not exists (select 1 from public.saas_plans where code = 'atendimento' and (limits ->> 'analysis_credits')::integer = 100)
     or not exists (select 1 from public.saas_plans where code = 'completo' and (limits ->> 'analysis_credits')::integer = 200) then
    raise exception 'conferencia: os creditos dos planos nao ficaram 30/100/200';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.conversation_analyses'::regclass) then
    raise exception 'conferencia: RLS desligada nas analises';
  end if;
  if has_table_privilege('authenticated', 'public.conversation_analyses', 'insert')
     or has_table_privilege('authenticated', 'public.conversation_analyses', 'update') then
    raise exception 'conferencia: authenticated escreve direto nas analises';
  end if;
  if has_function_privilege('anon', 'public.conversation_analysis_request(uuid, uuid, text, text)', 'execute') then
    raise exception 'conferencia: anon pede analise';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.connection_runtime_commands'::regclass
      and conname = 'connection_runtime_commands_command_type_check'
      and pg_get_constraintdef(oid) like '%conversation_analyze%'
      and pg_get_constraintdef(oid) like '%insights_evaluate%'
  ) then
    raise exception 'conferencia: a fila de comandos perdeu ou nao ganhou tipos';
  end if;
end $$;

commit;
