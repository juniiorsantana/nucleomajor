-- O fluxo não trava: o Pacote 0 do review do executor e os pacotes P2 e P3 do
-- review do portal e do banco (18/10/2026), antes das jornadas da Etapa 3.
--
-- PACOTE 0 (o lado do banco; o runtime está em `feat/fluxos-robustez`):
--
--   * 0.1 (A1) `nucleo_flow_current` devolve a execução viva que NÃO está
--     suspensa como `{"status": "running", "executionStatus": ...}`. Antes ela
--     devolvia `none`, e a segunda mensagem do contato ("oi" + "tudo bem?")
--     procurava fluxo novo, o start recusava e a conversa ia para a equipe;
--   * 0.3 (M1) a suspensão vencida que o relógio ainda não fechou continua
--     sendo devolvida, e `nucleo_flow_answer` aceita a resposta (a opção, o
--     texto da coleta, o `respondeu` do Aguardar) depois do prazo enquanto a
--     execução está `suspended`: quem chega primeiro decide, e a resposta
--     vence a cobrança que ainda não saiu;
--   * 0.5 (M3) `flow_trigger_enqueue` não enfileira para quem já tem fluxo
--     vivo;
--   * A7: `nucleo_flow_current` e a trava de "fluxo vivo" do start comparam o
--     telefone nas duas formas do nono dígito. O fluxo de gatilho nasce com o
--     telefone do CRM, e a resposta chega com o do WhatsApp.
--
-- P2 (A1 e A8 do review do banco): execução que não anda fecha sozinha.
-- `needs_review` (envio que ninguém confirmou) e `ready` parado fecham depois
-- do prazo da execução — 24 horas, ajustável por organização
-- (`organization_flow_settings.execution_timeout_hours`) e por fluxo
-- (`definition.prazoExecucaoHoras`, de 1 a 720). A execução vira
-- `cancelled` com `review_expired` ou `execution_expired`, o histórico do
-- contato ganha `flow.expired` (uma vez), e o contato volta a poder começar
-- fluxo. Quem fecha é `nucleo_flow_pending` (o laço de 1 s da VPS), o start
-- e o `current` daquele telefone.
--
-- P3 (A2, A3 e A6 do review do banco):
--
--   * "Iniciar fluxo" numa conversa que a equipe assumiu DEVOLVE AO BOT
--     (decisão do dono, 18/10): o `handed_off` encerra e o fluxo começa. O
--     manual devolve o id do comando, e `nucleo_flow_trigger_status` diz o
--     desfecho real (começou, ou o motivo);
--   * a conexão do gatilho é escolhida por regra explícita
--     (`private.flow_trigger_connection`), não pelo `updated_at`: a conexão
--     configurada na organização, a da última conversa do contato, a da
--     última execução dele, a única da empresa — e, com mais de uma e nenhuma
--     pista, nenhuma (o manual recusa com o motivo). Hoje o banco só deixa
--     uma conexão viva por empresa (`whatsapp_connections_one_live_per_org`);
--     o risco concreto era a regra antiga aceitar a conexão desligada por
--     `revoked_at` com o status ainda ativo. A ordem acima vale para quando
--     houver mais de um número;
--   * etiqueta aplicada pelo próprio motor (bloco "Editar etiquetas") não
--     dispara gatilho de etiqueta (A6): o ack marca `nucleo.flow_origin`.
--
-- As funções do motor são as de 20261018100000 (start), 20260926160000
-- (answer, ack, flow_validate), 20260926120000 (flow_trigger_enqueue,
-- nucleo_flow_trigger_manual, flow_trigger_on_tag) e 20260907010000
-- (current, pending), com as trocas marcadas "Robustez". A guarda abaixo
-- confere que é essa a versão em produção.
--
-- Compatível com o runtime de hoje: `running` não é `suspended`, e o
-- runtime antigo segue o caminho de antes (o start recusa e a conversa vai
-- para a equipe); a resposta atrasada que ele mandar é aceita.
--
-- Ordem com a Etapa 9 (20261018110000, Major 2, branch feat/fluxos-etapa9):
-- aplicar a dela ANTES desta. A guarda dela exige `nucleo_flow_answer` com o
-- corpo exato de 20260926160000 (md5) e abortaria depois desta. Esta aceita
-- as duas situações: com a Etapa 9 aplicada, reescreve a resposta de 6
-- argumentos mantendo o `decided_by`; sem ela, a de 5.
--
-- Aplicar pelo SQL Editor, depois de 20261018100000 (e de 20261018110000, se
-- ela for aplicada). Prova:
-- scripts/sql/prova-o-fluxo-nao-trava.mjs. Desfazer:
-- scripts/sql/rollback-20261018150000-o-fluxo-nao-trava.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1/7. Guardas.
-- ---------------------------------------------------------------------------
do $$
declare
  comecar text; atual text; pendentes text; responder text; confirmar text;
  enfileirar text; manual text; validar text; etiqueta text;
begin
  if to_regclass('public.organization_flow_settings') is not null then
    raise exception 'abortado: organization_flow_settings ja existe; esta migration ja foi aplicada';
  end if;
  if to_regprocedure('private.flow_validate(jsonb, uuid)') is null then
    raise exception 'abortado: aplicar 20261018100000 antes';
  end if;
  select pg_catalog.replace(p.prosrc, chr(13), '') into comecar from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_start(text, text, uuid, bigint, uuid, bigint)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into atual from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_current(text)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into pendentes from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_pending()'::regprocedure;
  -- A resposta da Etapa 9 (20261018110000), se já aplicada; senão a de 20260926160000.
  select pg_catalog.replace(p.prosrc, chr(13), '') into responder from pg_catalog.pg_proc p
    where p.oid = coalesce(to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text, text)'),
                           to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text)'));
  select pg_catalog.replace(p.prosrc, chr(13), '') into confirmar from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_ack(uuid, uuid, text, text)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into enfileirar from pg_catalog.pg_proc p
    where p.oid = 'private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into manual from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_trigger_manual(uuid, uuid)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into validar from pg_catalog.pg_proc p
    where p.oid = 'private.flow_validate(jsonb)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into etiqueta from pg_catalog.pg_proc p
    where p.oid = 'private.flow_trigger_on_tag()'::regprocedure;
  if comecar is null or atual is null or pendentes is null or responder is null or confirmar is null
    or enfileirar is null or manual is null or validar is null or etiqueta is null
    or comecar not like '%flow feature unavailable%' or comecar like '%flow_expire_stale%'
    or atual not like '%suspension_expires_at>now()%'
    or pendentes not like '%last_polled_at%' or pendentes like '%flow_expire_stale%'
    or responder not like '%wait_missed%' or responder not like '%flow suspension expired%' or responder like '%Robustez%'
    or confirmar not like '%flow_wait_interval%' or confirmar like '%nucleo.flow_origin%'
    or enfileirar not like '%order by w.updated_at desc limit 1%'
    or manual not like '%flow trigger unavailable%' or manual like '%handed_off%'
    or validar not like '%flow waits exceeded%' or validar like '%prazoExecucaoHoras%'
    or etiqueta like '%nucleo.flow_origin%' then
    raise exception 'abortado: o motor de fluxo em producao nao e o de 20261018100000/20260926160000; conferir antes de reescrever';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2/7. A configuração de fluxo da organização (P2 e P3).
-- ---------------------------------------------------------------------------
create table public.organization_flow_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Quanto uma execução pode ficar parada (`ready`) ou esperando revisão
  -- (`needs_review`) antes de fechar sozinha. O fluxo pode dizer outro.
  execution_timeout_hours integer not null default 24 check (execution_timeout_hours between 1 and 720),
  -- Por qual WhatsApp saem os fluxos que não começam por mensagem (manual,
  -- etiqueta, etapa, campanha). Nulo: a regra de `flow_trigger_connection`.
  trigger_connection_id uuid references public.whatsapp_connections(id) on delete set null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

comment on table public.organization_flow_settings is
  'Configuracao de fluxo por organizacao: prazo da execucao parada (24h padrao) e a conexao dos gatilhos que nao comecam por mensagem. Gravada por nucleo_flow_settings_save. Ver 20261018150000.';

alter table public.organization_flow_settings enable row level security;
revoke all on public.organization_flow_settings from public, anon, authenticated;
grant select on public.organization_flow_settings to authenticated;
create policy organization_flow_settings_select on public.organization_flow_settings
  for select to authenticated using (private.is_org_member(organization_id));

create or replace function public.nucleo_flow_settings_save(
  target_organization uuid, timeout_hours integer, trigger_connection uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.organization_flow_settings%rowtype;
begin
  if auth.uid() is null or target_organization is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if timeout_hours is null or timeout_hours not between 1 and 720 then
    raise exception 'flow execution deadline invalid';
  end if;
  if trigger_connection is not null and not exists (
    select 1 from public.whatsapp_connections w
    where w.id = trigger_connection and w.organization_id = target_organization
      and w.status <> 'revoked' and w.revoked_at is null) then
    raise exception 'flow connection unavailable';
  end if;
  insert into public.organization_flow_settings as s
    (organization_id, execution_timeout_hours, trigger_connection_id, updated_by, updated_at)
  values (target_organization, timeout_hours, trigger_connection, auth.uid(), now())
  on conflict (organization_id) do update set
    execution_timeout_hours = excluded.execution_timeout_hours,
    trigger_connection_id = excluded.trigger_connection_id,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into saved;
  return jsonb_build_object('executionTimeoutHours', saved.execution_timeout_hours,
    'triggerConnectionId', saved.trigger_connection_id);
end;
$$;

comment on function public.nucleo_flow_settings_save(uuid, integer, uuid) is
  'Quem administra a empresa grava o prazo da execucao parada (1 a 720 horas) e a conexao dos gatilhos. Ver 20261018150000.';

-- ---------------------------------------------------------------------------
-- 3/7. O prazo, quem está ocupado e qual conexão (funções internas).
-- ---------------------------------------------------------------------------

-- O prazo de uma execução: o do fluxo, senão o da organização, senão 24 h.
create or replace function private.flow_execution_timeout(target_organization uuid, spec jsonb) returns interval
language plpgsql stable security definer set search_path = '' as $$
declare hours integer;
begin
  if jsonb_typeof(spec->'prazoExecucaoHoras') = 'number' and spec->>'prazoExecucaoHoras' ~ '^[0-9]{1,3}$' then
    hours := (spec->>'prazoExecucaoHoras')::integer;
  end if;
  if hours is null or hours not between 1 and 720 then
    select s.execution_timeout_hours into hours from public.organization_flow_settings s
    where s.organization_id = target_organization;
  end if;
  return make_interval(hours => coalesce(hours, 24));
end;
$$;

-- Fecha as execuções paradas desta conexão (ou só as de um telefone): o
-- `needs_review` e o `ready` que não andam há mais que o prazo. Uma vez só:
-- o evento sai do mesmo `update` que muda o estado.
create or replace function private.flow_expire_stale(target_organization uuid, target_connection uuid, phone text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare closed integer;
begin
  with stale as (
    select r.id from public.chatbot_flow_executions r
    where r.organization_id = target_organization and r.connection_id = target_connection
      and r.status in ('ready', 'needs_review')
      and (phone is null or private.customer_phone_matches(r.requester_phone, phone))
      -- O menor prazo possível é 1 hora: o filtro barato vem antes.
      and r.updated_at < now() - interval '1 hour'
      and r.updated_at < now() - private.flow_execution_timeout(r.organization_id, r.definition_snapshot)
    for update skip locked
  ), expired as (
    update public.chatbot_flow_executions r set status = 'cancelled',
      reason = case when r.status = 'needs_review' then 'review_expired' else 'execution_expired' end,
      claim_token = null, claim_expires_at = null, revision = r.revision + 1, updated_at = now()
    from stale where r.id = stale.id
    returning r.id, r.organization_id, r.contact_id, r.chatbot_id, r.cursor_node_id, r.reason
  )
  insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload)
  select expired.organization_id, expired.contact_id, 'flow.expired', 'chatbot', expired.chatbot_id, 'chatbot',
    jsonb_build_object('executionId', expired.id, 'nodeId', expired.cursor_node_id, 'reason', expired.reason)
  from expired;
  get diagnostics closed = row_count;
  return closed;
end;
$$;

-- O contato já tem um fluxo vivo que ainda vale (não parado além do prazo).
create or replace function private.flow_contact_busy(target_organization uuid, target_contact uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chatbot_flow_executions r
    where r.organization_id = target_organization and r.contact_id = target_contact
      and r.status in ('ready', 'executing', 'suspended', 'needs_review')
      and not (r.status in ('ready', 'needs_review')
               and r.updated_at < now() - private.flow_execution_timeout(r.organization_id, r.definition_snapshot)));
$$;

-- Por qual WhatsApp sai um fluxo que não começa por mensagem. Regra explícita,
-- em ordem: a conexão configurada na organização; a da última conversa do
-- contato; a da última execução dele; a única da empresa. Com mais de uma e
-- nenhuma pista, nenhuma: adivinhar o número é decisão de gente.
create or replace function private.flow_trigger_connection(target_organization uuid, target_contact uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare conn uuid; eligible uuid[];
begin
  -- Conexão que pode rodar: não revogada (nem pelo status, nem pela data —
  -- a regra antiga olhava só o status) e com a credencial do robô ativa.
  select coalesce(array_agg(w.id order by w.id), array[]::uuid[]) into eligible
  from public.whatsapp_connections w
  where w.organization_id = target_organization and w.status <> 'revoked' and w.revoked_at is null
    and exists (select 1 from public.connection_robot_credentials r
                where r.connection_id = w.id and r.status = 'active' and r.revoked_at is null);

  select s.trigger_connection_id into conn from public.organization_flow_settings s
  where s.organization_id = target_organization and s.trigger_connection_id = any(eligible);
  if conn is not null then return conn; end if;

  select c.connection_id into conn from public.conversation_intelligence_contexts c
  where c.organization_id = target_organization and c.contact_id = target_contact and c.channel = 'whatsapp'
    and c.connection_id = any(eligible)
  order by c.last_message_at desc nulls last limit 1;
  if conn is not null then return conn; end if;

  select r.connection_id into conn from public.chatbot_flow_executions r
  where r.organization_id = target_organization and r.contact_id = target_contact
    and r.connection_id = any(eligible)
  order by r.created_at desc limit 1;
  if conn is not null then return conn; end if;

  if cardinality(eligible) = 1 then return eligible[1]; end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4/7. A validação aceita o prazo do fluxo.
-- (corpo de 20260926160000 com a troca marcada "Robustez")
-- ---------------------------------------------------------------------------
create or replace function private.flow_validate(spec jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  step jsonb; edge jsonb; node text; target text; port text;
  nodes text[] := array['entrada','condicoes'];
  ports text[]; removed text[] := array[]::text[]; pending text[];
  found_root boolean; waits integer := 0;
begin
  if jsonb_typeof(spec) is distinct from 'object'
    or spec#>>'{canvas,versao}' is distinct from '3'
    or jsonb_typeof(spec->'passos') is distinct from 'array'
    or jsonb_typeof(spec#>'{canvas,conexoes}') is distinct from 'array'
    or jsonb_array_length(spec->'passos') not between 1 and 200
    or jsonb_array_length(spec#>'{canvas,conexoes}') > 402
    or length(spec::text)>200000 then
    raise exception 'flow definition invalid';
  end if;
  -- Robustez (P2): o prazo da execução parada, se o fluxo disser um.
  if spec ? 'prazoExecucaoHoras' and (jsonb_typeof(spec->'prazoExecucaoHoras') is distinct from 'number'
    or spec->>'prazoExecucaoHoras' !~ '^[0-9]{1,3}$'
    or (spec->>'prazoExecucaoHoras')::integer not between 1 and 720) then
    raise exception 'flow execution deadline invalid';
  end if;
  perform private.flow_validate_expression(spec->'condicoes');
  perform private.flow_validate_trigger(spec->'gatilho');
  for step in select jsonb_array_elements(spec->'passos') loop
    node := step->>'id';
    if node is null or node !~ '^[A-Za-z0-9_-]{1,80}$' or node=any(nodes) then
      raise exception 'flow node identity invalid';
    end if;
    nodes := array_append(nodes,node);
    if step->>'tipo' not in ('enviar_mensagem','editar_etiquetas','condicao','transferir','encerrar','perguntar','coletar','aguardar')
      or step->>'tipo' is null then raise exception 'flow node type invalid'; end if;
    if step->>'tipo'='enviar_mensagem' and length(trim(coalesce(step->>'texto',''))) not between 1 and 4000 then
      raise exception 'flow message invalid';
    end if;
    if step->>'tipo'='transferir' and coalesce(step->>'destino','') not in ('ia','humano') then
      raise exception 'flow transfer invalid';
    end if;
    if step->>'tipo'='condicao' then perform private.flow_validate_expression(step->'expressao'); end if;
    if step->>'tipo' in ('perguntar','coletar') then perform private.flow_validate_question(step); end if;
    if step->>'tipo'='aguardar' then
      perform private.flow_validate_wait(step);
      waits:=waits+1;
    end if;
    if step->>'tipo'='editar_etiquetas' then
      foreach port in array array['adicionar','remover'] loop
        if jsonb_typeof(step->port) is distinct from 'array' then raise exception 'flow tags invalid'; end if;
        if jsonb_array_length(step->port)>100 or exists(select 1 from jsonb_array_elements_text(step->port) t
          where t !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or t is null) then
          raise exception 'flow tags invalid';
        end if;
      end loop;
    end if;
    if step->>'tipo'='transferir' and step->>'destino'='ia' then
      if length(trim(coalesce(step->>'objetivoIa',''))) not between 1 and 2000
        or coalesce(step->>'alvoIa','reception') not in ('reception','skill','campaign') then
        raise exception 'flow AI objective invalid';
      end if;
      if step->>'alvoIa' in ('skill','campaign') then
        target:=step->>case when step->>'alvoIa'='skill' then 'skillId' else 'campanhaId' end;
        if target is null or target !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'flow AI target invalid';
        end if;
      end if;
    end if;
  end loop;
  -- O freio da insistência (Etapa 8): no QR Code não há template nem janela,
  -- e o risco de cobrar demais é a reputação do número.
  if waits>10 then raise exception 'flow waits exceeded'; end if;
  for edge in select jsonb_array_elements(spec#>'{canvas,conexoes}') loop
    if not coalesce(edge->>'source'=any(nodes),false)
      or not coalesce(edge->>'target'=any(nodes),false)
      or edge->>'target'='entrada'
      or (edge->>'target'='condicoes' and edge->>'source'<>'entrada') then
      raise exception 'flow edge invalid';
    end if;
  end loop;
  foreach node in array nodes loop
    if node in ('entrada','condicoes') then ports:=array['padrao'];
    else
      step:=private.flow_step(spec,node);
      ports:=case step->>'tipo'
        when 'condicao' then array['sim','nao']
        when 'encerrar' then array[]::text[]
        when 'transferir' then case when step->>'destino'='ia' then array['sucesso','falha'] else array[]::text[] end
        when 'perguntar' then array(select o->>'id' from jsonb_array_elements(step->'opcoes') o)||array['nao_resolvido']
        when 'coletar' then array['padrao','nao_resolvido']
        when 'aguardar' then array['respondeu','sem_resposta']
        else array['padrao'] end;
    end if;
    if (select count(*) from jsonb_array_elements(spec#>'{canvas,conexoes}') e where e->>'source'=node) <> cardinality(ports) then
      raise exception 'flow ports incomplete';
    end if;
    foreach port in array ports loop
      target:=private.flow_target(spec,node,port);
      if node='entrada' and target<>'condicoes' then raise exception 'flow entry invalid'; end if;
    end loop;
    if node<>'entrada' and not exists(select 1 from jsonb_array_elements(spec#>'{canvas,conexoes}') e where e->>'target'=node) then
      raise exception 'flow node unreachable';
    end if;
  end loop;
  -- Kahn's algorithm avoids enumerating exponentially many convergent paths.
  pending:=nodes;
  while cardinality(pending)>0 loop
    found_root:=false;
    foreach node in array pending loop
      if not exists(select 1 from jsonb_array_elements(spec#>'{canvas,conexoes}') e
        where e->>'target'=node and not (e->>'source'=any(removed))) then
        removed:=array_append(removed,node);
        pending:=array_remove(pending,node);
        found_root:=true;
      end if;
    end loop;
    if not found_root then raise exception 'flow cycle forbidden'; end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5/7. O motor: current, pending, start, answer e ack.
-- ---------------------------------------------------------------------------

-- (corpo de 20260907010000, reescrito: Robustez 0.1, 0.3, A7 e P2)
create or replace function public.nucleo_flow_current(requester_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization(); run public.chatbot_flow_executions%rowtype;
  safe_phone text:=regexp_replace(coalesce(nucleo_flow_current.requester_phone,''),'[^0-9]','','g');
begin
  -- Robustez (P2): a execução parada além do prazo não prende a conversa.
  perform private.flow_expire_stale(org, conn, safe_phone);
  -- Robustez (A7): as duas formas do nono dígito; a forma exata primeiro.
  select * into run from public.chatbot_flow_executions f where f.organization_id=org and f.connection_id=conn
    and private.customer_phone_matches(f.requester_phone, safe_phone)
    and f.status in ('ready','executing','suspended','needs_review')
  order by (f.requester_phone=safe_phone) desc, f.updated_at desc limit 1;
  if not found then return jsonb_build_object('status','none'); end if;
  -- Robustez (0.1): o fluxo anda entre um bloco e outro, ou espera revisão. A
  -- mensagem é dele: o runtime não procura outro fluxo.
  if run.status<>'suspended' then
    return jsonb_build_object('status','running','executionId',run.id,'executionStatus',run.status,
      'requesterPhone',run.requester_phone);
  end if;
  -- Robustez (0.3): a suspensão vencida que o relógio ainda não fechou vale.
  return private.flow_envelope(run)||jsonb_build_object('step',private.flow_step(run.definition_snapshot,run.cursor_node_id));
end;
$$;

-- (corpo de 20260907010000 com a troca marcada "Robustez")
create or replace function public.nucleo_flow_pending() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conn uuid:=private.flow_connection(); org uuid:=private.robot_organization(); result jsonb;
begin
  -- Robustez (P2): fecha antes o que está parado além do prazo.
  perform private.flow_expire_stale(org, conn, null);
  with batch as (
    select r.id from public.chatbot_flow_executions r where r.organization_id=org and r.connection_id=conn
      and (r.status in ('ready','suspended') or (r.status='executing' and r.claim_expires_at<=now()))
    order by r.last_polled_at,r.updated_at,r.id limit 25 for update skip locked
  ), polled as (
    update public.chatbot_flow_executions r set last_polled_at=now()
    from batch where r.id=batch.id returning r as execution
  )
  select coalesce(jsonb_agg(private.flow_envelope(polled.execution)),'[]'::jsonb) into result from polled;
  return jsonb_build_object('executions',result);
end;
$$;

-- (corpo de 20261018100000 com as trocas marcadas "Robustez")
create or replace function public.nucleo_flow_start(
  requester_phone text, external_message text, selected_chatbot uuid,
  expected_version bigint, conversation_session uuid, conversation_epoch bigint default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org uuid:=private.robot_organization(); conn uuid:=private.flow_connection();
  safe_phone text:=regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g');
  bot public.chatbot_definitions%rowtype; run public.chatbot_flow_executions%rowtype;
  contact uuid; feature text;
begin
  if length(safe_phone) not between 10 and 15 or conversation_session is null or conversation_epoch is null or conversation_epoch<0
    or length(trim(coalesce(external_message,''))) not between 1 and 500 then
    raise exception 'flow identity invalid';
  end if;
  -- Robustez (A7): a trava é a mesma para as duas formas do nono dígito.
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||conn::text||':'||
    case when length(safe_phone)=13 and safe_phone like '55__9%' then substring(safe_phone from 1 for 4)||substring(safe_phone from 6)
      else safe_phone end,0));
  select * into run from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.external_message_id=external_message;
  if found then
    if run.requester_phone<>safe_phone or run.chatbot_id<>selected_chatbot
      or run.conversation_session_id<>conversation_session or run.conversation_epoch<>conversation_epoch then raise exception 'flow identity mismatch'; end if;
    return private.flow_envelope(run);
  end if;
  -- Robustez (P2): a execução parada além do prazo fecha e libera o contato.
  perform private.flow_expire_stale(org, conn, safe_phone);
  if exists(select 1 from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and private.customer_phone_matches(f.requester_phone, safe_phone)
    and f.status in ('ready','executing','suspended','needs_review')) then
    raise exception 'flow conversation already running';
  end if;
  select * into bot from public.chatbot_definitions b where b.id=selected_chatbot
    and b.organization_id=org and b.active and b.deleted_at is null and b.version=expected_version for share;
  if not found then raise exception 'flow definition changed'; end if;
  perform private.flow_validate(bot.definition);
  -- Etapa 10: o começo (gatilho e regras de entrada) precisa da função. Os
  -- passos trancados não impedem o começo: o claim os desvia pela Falha.
  foreach feature in array private.flow_start_features(bot.definition) loop
    if not private.org_has_feature(org, feature) then
      raise exception 'flow feature unavailable: %', feature using errcode = 'PF010';
    end if;
  end loop;
  -- Acha pelo telefone exato ou pelas duas formas do nono dígito; se não houver,
  -- cria com o evento `contact.created` (20260926110000).
  contact:=private.flow_contact_for(org, safe_phone, true);
  if contact is null then raise exception 'flow contact unavailable'; end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=contact and c.channel='whatsapp' and c.state='handed_off') then
    raise exception 'flow conversation with human';
  end if;
  insert into public.chatbot_flow_executions(organization_id,connection_id,contact_id,chatbot_id,
    chatbot_version,definition_snapshot,requester_phone,conversation_session_id,conversation_epoch,external_message_id,cursor_node_id)
  values(org,conn,contact,bot.id,bot.version,bot.definition,safe_phone,conversation_session,nucleo_flow_start.conversation_epoch,external_message,
    private.flow_target(bot.definition,'condicoes','padrao')) returning * into run;
  return private.flow_envelope(run);
end;
$$;

-- A resposta existe em duas formas: a de 20260926160000 (5 argumentos) e,
-- se a Etapa 9 (20261018110000, Major 2) já foi aplicada, a com `decided_by`
-- (6 argumentos). A troca "Robustez" é a mesma nas duas; a Etapa 9 fica
-- intacta (marcada "Etapa 9").
do $resposta$
begin
  if to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text, text)') is null then
    execute $fn$
-- (corpo de 20260926160000 com as trocas marcadas "Robustez")
create or replace function public.nucleo_flow_answer(
  execution_id uuid, suspension_id uuid, requester_phone text, selected_output text, answer_value text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb; valid text[]; next_node text; vars jsonb;
  expired boolean;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found or run.requester_phone<>regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g') then
    raise exception 'flow execution unavailable';
  end if;
  -- A mesma resposta duas vezes (reenvio depois de uma confirmação perdida)
  -- devolve o estado atual em vez de andar duas casas.
  if suspension_id is not null and run.last_suspension_id=suspension_id and run.last_outcome=selected_output then
    return private.flow_envelope(run);
  end if;
  if run.status<>'suspended' or suspension_id is null or run.suspension_id is distinct from suspension_id then
    raise exception 'flow suspension invalid';
  end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if coalesce(step->>'tipo','') not in ('perguntar','coletar','aguardar') then raise exception 'flow suspension invalid'; end if;
  valid:=case step->>'tipo'
    when 'perguntar' then array(select o->>'id' from jsonb_array_elements(step->'opcoes') o)||array['nao_resolvido']
    when 'aguardar' then array['respondeu','sem_resposta']
    else array['padrao','nao_resolvido'] end;
  if selected_output is null or not (selected_output=any(valid)) then raise exception 'flow output invalid'; end if;
  -- Robustez (0.3): enquanto a execução está suspensa, a resposta do contato
  -- vale mesmo depois do prazo — quem chega primeiro decide, e a resposta
  -- vence a cobrança que ainda não saiu. Só `sem_resposta` antes do prazo
  -- continua recusado: seria cobrar cedo.
  expired:=run.suspension_expires_at<=now();
  if step->>'tipo'='aguardar' and not expired and selected_output='sem_resposta' then
    raise exception 'flow suspension not expired';
  end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=run.contact_id and c.channel='whatsapp' and c.state='handed_off') then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
    return private.flow_envelope(run);
  end if;
  -- Uma cobrança muito atrasada (a VPS ficou fora do ar) não sai: o fluxo
  -- fecha como perdido e o histórico do contato registra (Etapa 8).
  if step->>'tipo'='aguardar' and selected_output='sem_resposta'
     and run.suspension_expires_at<now()-interval '6 hours' then
    update public.chatbot_flow_executions set status='cancelled',reason='wait_missed',
      last_suspension_id=run.suspension_id,last_outcome=selected_output,
      suspension_id=null,suspension_expires_at=null,revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
    insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload)
    values (org, run.contact_id, 'flow.expired', 'chatbot', run.chatbot_id, 'chatbot',
      jsonb_build_object('executionId', run.id, 'nodeId', step->>'id', 'reason', 'wait_missed'));
    return private.flow_envelope(run);
  end if;
  vars:=coalesce(run.variables,'{}'::jsonb);
  if step->>'tipo'='coletar' and selected_output='padrao' then
    if length(trim(coalesce(answer_value,''))) not between 1 and 1000 then raise exception 'flow answer invalid'; end if;
    vars:=vars||jsonb_build_object(step->>'variavel',trim(answer_value));
  end if;
  next_node:=private.flow_target(run.definition_snapshot,run.cursor_node_id,selected_output);
  update public.chatbot_flow_executions set cursor_node_id=next_node,status='ready',
    last_suspension_id=run.suspension_id,last_outcome=selected_output,
    suspension_id=null,suspension_expires_at=null,attempts=0,variables=vars,
    revision=revision+1,updated_at=now(),
    -- Robustez (0.3): o motivo de prazo só quando foi o prazo que decidiu.
    reason=case when not expired then null
      when selected_output='sem_resposta' then 'wait_elapsed'
      when selected_output='nao_resolvido' then 'reply_timeout' else null end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$
$fn$;
  else
    execute $fn$
-- (corpo de 20261018110000 com as trocas marcadas "Robustez")
create or replace function public.nucleo_flow_answer(
  execution_id uuid, suspension_id uuid, requester_phone text, selected_output text, answer_value text default null,
  decided_by text default 'regra'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb; valid text[]; next_node text; vars jsonb;
  expired boolean;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found or run.requester_phone<>regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g') then
    raise exception 'flow execution unavailable';
  end if;
  -- A mesma resposta duas vezes (reenvio depois de uma confirmação perdida)
  -- devolve o estado atual em vez de andar duas casas.
  if suspension_id is not null and run.last_suspension_id=suspension_id and run.last_outcome=selected_output then
    return private.flow_envelope(run);
  end if;
  if run.status<>'suspended' or suspension_id is null or run.suspension_id is distinct from suspension_id then
    raise exception 'flow suspension invalid';
  end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if coalesce(step->>'tipo','') not in ('perguntar','coletar','aguardar') then raise exception 'flow suspension invalid'; end if;
  valid:=case step->>'tipo'
    when 'perguntar' then array(select o->>'id' from jsonb_array_elements(step->'opcoes') o)||array['nao_resolvido']
    when 'aguardar' then array['respondeu','sem_resposta']
    else array['padrao','nao_resolvido'] end;
  if selected_output is null or not (selected_output=any(valid)) then raise exception 'flow output invalid'; end if;
  -- Etapa 9: a IA só escolhe uma opção de verdade, numa pergunta marcada
  -- "Usar IA quando não entender", de uma empresa com IA.
  if decided_by is null or decided_by not in ('regra','ia') then raise exception 'flow decided_by invalid'; end if;
  if decided_by='ia' and (
    step->>'tipo' is distinct from 'perguntar' or selected_output='nao_resolvido'
    or jsonb_typeof(step->'iaQuandoNaoEntende') is distinct from 'boolean'
    or not (step->>'iaQuandoNaoEntende')::boolean
    or not private.org_has_feature(org, 'ai_customer')
  ) then raise exception 'flow decided_by invalid'; end if;
  -- Robustez (0.3): enquanto a execução está suspensa, a resposta do contato
  -- vale mesmo depois do prazo — quem chega primeiro decide, e a resposta
  -- vence a cobrança que ainda não saiu. Só `sem_resposta` antes do prazo
  -- continua recusado: seria cobrar cedo.
  expired:=run.suspension_expires_at<=now();
  if step->>'tipo'='aguardar' and not expired and selected_output='sem_resposta' then
    raise exception 'flow suspension not expired';
  end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=run.contact_id and c.channel='whatsapp' and c.state='handed_off') then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
    return private.flow_envelope(run);
  end if;
  -- Uma cobrança muito atrasada (a VPS ficou fora do ar) não sai: o fluxo
  -- fecha como perdido e o histórico do contato registra (Etapa 8).
  if step->>'tipo'='aguardar' and selected_output='sem_resposta'
     and run.suspension_expires_at<now()-interval '6 hours' then
    update public.chatbot_flow_executions set status='cancelled',reason='wait_missed',
      last_suspension_id=run.suspension_id,last_outcome=selected_output,
      suspension_id=null,suspension_expires_at=null,revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
    insert into public.contact_events (organization_id, contact_id, event_type, entity_type, entity_id, source, payload)
    values (org, run.contact_id, 'flow.expired', 'chatbot', run.chatbot_id, 'chatbot',
      jsonb_build_object('executionId', run.id, 'nodeId', step->>'id', 'reason', 'wait_missed'));
    return private.flow_envelope(run);
  end if;
  vars:=coalesce(run.variables,'{}'::jsonb);
  if step->>'tipo'='coletar' and selected_output='padrao' then
    if length(trim(coalesce(answer_value,''))) not between 1 and 1000 then raise exception 'flow answer invalid'; end if;
    vars:=vars||jsonb_build_object(step->>'variavel',trim(answer_value));
  end if;
  next_node:=private.flow_target(run.definition_snapshot,run.cursor_node_id,selected_output);
  update public.chatbot_flow_executions set cursor_node_id=next_node,status='ready',
    last_suspension_id=run.suspension_id,last_outcome=selected_output,
    suspension_id=null,suspension_expires_at=null,attempts=0,variables=vars,
    -- Etapa 9: quem decidiu, só numa pergunta (a espera e o digitar não escolhem).
    last_decided_by=case when step->>'tipo'='perguntar' then decided_by end,
    revision=revision+1,updated_at=now(),
    -- Robustez (0.3): o motivo de prazo só quando foi o prazo que decidiu.
    reason=case when not expired then null
      when selected_output='sem_resposta' then 'wait_elapsed'
      when selected_output='nao_resolvido' then 'reply_timeout' else null end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$
$fn$;
  end if;
end;
$resposta$;

-- (corpo de 20260926160000 com a troca marcada "Robustez")
create or replace function public.nucleo_flow_ack(
  execution_id uuid, claim_token uuid, selected_output text default '', effect_status text default 'confirmed'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb; next_node text;
  added uuid[]; removed uuid[];
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found then raise exception 'flow execution unavailable'; end if;
  if claim_token is not null and run.last_ack_token=claim_token then return private.flow_envelope(run); end if;
  if run.status<>'executing' or claim_token is null or run.claim_token is distinct from claim_token then
    raise exception 'flow claim invalid';
  end if;
  if effect_status is null or effect_status not in ('confirmed','uncertain') then raise exception 'flow effect invalid'; end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if effect_status='uncertain' then
    update public.chatbot_flow_executions set status='needs_review',reason='delivery_unknown',updated_at=now()
    where id=run.id returning * into run;
    return private.flow_envelope(run);
  end if;
  if step->>'tipo' in ('enviar_mensagem','editar_etiquetas','condicao') then
    if (step->>'tipo'='condicao' and coalesce(selected_output,'') not in ('sim','nao'))
      or (step->>'tipo'<>'condicao' and selected_output is distinct from 'padrao') then
      raise exception 'flow output invalid';
    end if;
    next_node:=private.flow_target(run.definition_snapshot,run.cursor_node_id,selected_output);
    if step->>'tipo'='editar_etiquetas' then
      select coalesce(array_agg(v::uuid),array[]::uuid[]) into added
      from jsonb_array_elements_text(coalesce(step->'adicionar','[]'::jsonb)) v;
      select coalesce(array_agg(v::uuid),array[]::uuid[]) into removed
      from jsonb_array_elements_text(coalesce(step->'remover','[]'::jsonb)) v;
      if exists(select 1 from unnest(added||removed) v where not exists(select 1 from public.tags t
        where t.id=v and t.organization_id=org and t.deleted_at is null)) then raise exception 'flow tag unavailable'; end if;
      -- Robustez (A6): a etiqueta que o próprio fluxo aplica não dispara outro
      -- fluxo por gatilho de etiqueta (`flow_trigger_on_tag` lê a marca).
      perform set_config('nucleo.flow_origin','motor',true);
      delete from public.contact_tags t where t.organization_id=org and t.contact_id=run.contact_id and t.tag_id=any(removed);
      insert into public.contact_tags(organization_id,contact_id,tag_id)
      select org,run.contact_id,v from unnest(added) v on conflict(contact_id,tag_id) do nothing;
      perform set_config('nucleo.flow_origin','',true);
      update public.contacts set updated_at=now() where id=run.contact_id and organization_id=org;
    end if;
    run.cursor_node_id:=next_node; run.status:='ready';
  elsif step->>'tipo'='transferir' and step->>'destino'='ia' then
    run.status:='suspended'; run.suspension_expires_at:=now()+interval '24 hours';
  elsif step->>'tipo' in ('perguntar','coletar') then
    -- A pergunta foi enviada: a execução espera a resposta do contato pelo
    -- prazo do bloco. Quem responde é `nucleo_flow_answer` (20260926120000).
    run.status:='suspended';
    run.suspension_expires_at:=now()+make_interval(hours=>coalesce((step->>'prazoHoras')::int,24));
    run.attempts:=0;
  elsif step->>'tipo'='aguardar' then
    -- Etapa 8: nada a enviar; a execução dorme até o prazo do bloco. Quem a
    -- acorda é `nucleo_flow_answer`: `respondeu` se o contato escrever antes,
    -- `sem_resposta` quando o relógio da VPS vir o prazo vencido.
    run.status:='suspended';
    run.suspension_expires_at:=now()+private.flow_wait_interval(step);
    run.attempts:=0;
  else
    run.status:='completed';
    update public.chatbot_definitions set executions=executions+1,last_execution_at=now()
    where id=run.chatbot_id and organization_id=org;
  end if;
  update public.chatbot_flow_executions set cursor_node_id=run.cursor_node_id,status=run.status,
    suspension_expires_at=run.suspension_expires_at,attempts=run.attempts,last_ack_token=run.claim_token,
    claim_token=null,claim_expires_at=null,revision=revision+1,updated_at=now()
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6/7. Os gatilhos: quem está ocupado, qual conexão, o freio e o manual.
-- ---------------------------------------------------------------------------

-- (corpo de 20260926120000 com as trocas marcadas "Robustez")
create or replace function private.flow_trigger_enqueue(
  target_organization uuid, target_contact uuid, trigger_kind text, trigger_ref uuid, issuer uuid, origin text
) returns integer language plpgsql security definer set search_path = '' as $$
declare phone text; conn uuid; bot record; queued integer := 0; author uuid;
begin
  if target_organization is null or target_contact is null
     or trigger_kind not in ('manual','campanha','etiqueta','etapa')
     or not private.org_has_feature(target_organization, 'chatbots') then
    return 0;
  end if;
  select regexp_replace(coalesce(nullif(trim(c.phone), ''), c.whatsapp_id, ''), '[^0-9]', '', 'g') into phone
  from public.contacts c
  where c.id = target_contact and c.organization_id = target_organization and c.deleted_at is null;
  if phone is null or length(phone) not between 10 and 15 then return 0; end if;
  -- Quem pediu "Não atender IA" não recebe automação. O disparo manual é uma
  -- pessoa da equipe decidindo por aquele contato, e passa.
  if trigger_kind <> 'manual' and private.contact_opted_out_of_ai(target_organization, phone) then
    return 0;
  end if;
  -- Robustez (0.5): quem já tem fluxo vivo não ganha outro por cima. Antes o
  -- comando chegava à VPS, o start recusava e a conversa saía da IA.
  if private.flow_contact_busy(target_organization, target_contact) then return 0; end if;
  -- Robustez (P3): a conexão por regra explícita, não pelo `updated_at`.
  conn := private.flow_trigger_connection(target_organization, target_contact);
  if conn is null then return 0; end if;

  for bot in
    select b.id, b.version, b.created_by from public.chatbot_definitions b
    where b.organization_id = target_organization and b.active and b.deleted_at is null
      and b.definition#>>'{canvas,versao}' = '3'
      and b.definition#>>'{gatilho,tipo}' = trigger_kind
      and case trigger_kind
            when 'manual' then b.id = trigger_ref
            when 'campanha' then b.definition#>>'{gatilho,campanhaId}' = trigger_ref::text
            when 'etiqueta' then b.definition#>>'{gatilho,etiquetaId}' = trigger_ref::text
            else b.definition#>>'{gatilho,stageId}' = trigger_ref::text
          end
    order by b.created_at, b.id
  loop
    author := coalesce(issuer, bot.created_by);
    if author is null or not exists (select 1 from public.profiles p where p.id = author) then continue; end if;
    insert into public.connection_runtime_commands (
      organization_id, connection_id, command_type, private_payload, created_by, idempotency_key, expires_at
    ) values (
      target_organization, conn, 'flow_trigger',
      jsonb_build_object('phone', phone, 'chatbotId', bot.id, 'chatbotVersion', bot.version,
                         'contactId', target_contact, 'origem', origin, 'manual', trigger_kind = 'manual'),
      author, encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'), now() + interval '1 hour'
    );
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

-- (corpo de 20260926120000 com a troca marcada "Robustez")
create or replace function private.flow_trigger_on_tag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Robustez (A6): etiqueta aplicada pelo próprio motor de fluxo não dispara
  -- outro fluxo — sem isso, dois fluxos que se etiquetam viram um laço de
  -- mensagens no número do cliente.
  if coalesce(current_setting('nucleo.flow_origin', true), '') = 'motor' then
    return new;
  end if;
  begin
    perform private.flow_trigger_enqueue(new.organization_id, new.contact_id, 'etiqueta', new.tag_id,
      (select p.id from public.profiles p where p.id = auth.uid()), 'etiqueta');
  exception when others then
    null;  -- disparar fluxo nunca impede aplicar a etiqueta
  end;
  return new;
end;
$$;

-- (corpo de 20260926120000, reescrito: Robustez P3)
create or replace function public.nucleo_flow_trigger_manual(target_contact uuid, target_chatbot uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare org uuid; queued integer; returned integer := 0; command uuid;
begin
  select c.organization_id into org from public.contacts c where c.id = target_contact and c.deleted_at is null;
  if org is null or auth.uid() is null or not private.is_org_member(org) then
    raise exception 'contact unavailable';
  end if;
  if not exists (select 1 from public.chatbot_definitions b
                 where b.id = target_chatbot and b.organization_id = org and b.active and b.deleted_at is null
                   and b.definition#>>'{gatilho,tipo}' = 'manual') then
    raise exception 'flow unavailable';
  end if;
  -- Os motivos que a tela mostra, antes de enfileirar.
  if private.flow_contact_busy(org, target_contact) then raise exception 'flow already running for contact'; end if;
  if private.flow_trigger_connection(org, target_contact) is null then raise exception 'flow connection unavailable'; end if;
  -- Decisão do dono (18/10): iniciar o fluxo numa conversa que a equipe
  -- assumiu devolve a conversa ao bot. O `handed_off` encerra aqui; o runtime
  -- passa o dono local para o bot quando o fluxo começa. Se nada for
  -- enfileirado, a exceção abaixo desfaz.
  update public.conversation_intelligence_contexts c set state = 'active', updated_at = now()
  where c.organization_id = org and c.contact_id = target_contact and c.channel = 'whatsapp'
    and c.audience = 'customer' and c.state = 'handed_off';
  get diagnostics returned = row_count;
  queued := private.flow_trigger_enqueue(org, target_contact, 'manual', target_chatbot, auth.uid(), 'manual');
  if queued = 0 then raise exception 'flow trigger unavailable'; end if;
  select r.id into command from public.connection_runtime_commands r
  where r.organization_id = org and r.command_type = 'flow_trigger' and r.created_by = auth.uid()
    and r.private_payload->>'contactId' = target_contact::text and r.private_payload->>'chatbotId' = target_chatbot::text
  order by r.created_at desc limit 1;
  return jsonb_build_object('queued', queued, 'commandId', command, 'returnedToBot', returned > 0);
end;
$$;

comment on function public.nucleo_flow_trigger_manual(uuid, uuid) is
  'Alguem da equipe inicia um fluxo de gatilho manual para um contato (follow-up). Devolve a conversa ao bot se a equipe a tinha assumido e devolve o id do comando (ver nucleo_flow_trigger_status). Ver 20260926120000 e 20261018150000.';

-- O desfecho de um disparo manual, para a ficha não parar em "enfileirado".
create or replace function public.nucleo_flow_trigger_status(target_command uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare comando public.connection_runtime_commands%rowtype;
begin
  select r.* into comando from public.connection_runtime_commands r
  where r.id = target_command and r.command_type = 'flow_trigger';
  if not found or auth.uid() is null or not private.is_org_member(comando.organization_id) then
    raise exception 'flow command not found';
  end if;
  return jsonb_build_object(
    'commandId', comando.id,
    'status', case when comando.status in ('pending','claimed') and comando.expires_at <= now() then 'expired' else comando.status end,
    'errorCode', comando.error_code,
    'started', comando.public_result->'started',
    'reason', comando.public_result->>'reason',
    'completedAt', comando.completed_at);
end;
$$;

comment on function public.nucleo_flow_trigger_status(uuid) is
  'Estado de um comando flow_trigger para quem e da empresa: pending, claimed, completed (started true/false e o motivo), failed (errorCode) ou expired. Ver 20261018150000.';

-- ---------------------------------------------------------------------------
-- 7/7. Quem pode chamar o quê, e a conferência.
-- ---------------------------------------------------------------------------
revoke all on function private.flow_execution_timeout(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.flow_expire_stale(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.flow_contact_busy(uuid, uuid) from public, anon, authenticated;
revoke all on function private.flow_trigger_connection(uuid, uuid) from public, anon, authenticated;
revoke all on function private.flow_validate(jsonb) from public, anon, authenticated;
revoke all on function private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.flow_trigger_on_tag() from public, anon, authenticated;
revoke all on function public.nucleo_flow_settings_save(uuid, integer, uuid) from public, anon;
revoke all on function public.nucleo_flow_trigger_status(uuid) from public, anon;
grant execute on function public.nucleo_flow_settings_save(uuid, integer, uuid) to authenticated;
grant execute on function public.nucleo_flow_trigger_status(uuid) to authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'private.flow_expire_stale(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_trigger_connection(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_contact_busy(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_execution_timeout(uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.nucleo_flow_trigger_status(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.nucleo_flow_settings_save(uuid, integer, uuid)', 'EXECUTE') then
    raise exception 'conferencia: permissao errada nas funcoes do fluxo';
  end if;
  if private.flow_execution_timeout(null, '{"prazoExecucaoHoras": 6}') <> interval '6 hours'
     or private.flow_execution_timeout(null, '{"prazoExecucaoHoras": 9999}') <> interval '24 hours'
     or private.flow_execution_timeout(null, '{}') <> interval '24 hours' then
    raise exception 'conferencia: o prazo da execucao nao diz o que devia';
  end if;
end;
$$;

commit;
