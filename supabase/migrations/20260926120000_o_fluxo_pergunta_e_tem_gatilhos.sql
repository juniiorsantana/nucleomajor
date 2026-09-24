-- O fluxo pergunta, entende a resposta e começa por outros gatilhos.
--
-- Etapas 6 e 7 de `plano-construtor-de-fluxos.md`, pedido do dono em
-- 23/09/2026: o construtor de fluxos do plano Base precisa conversar sem IA, e
-- precisa começar por mais coisas do que "um contato conhecido escreveu".
--
--
-- 1. O FLUXO PERGUNTA (Etapa 6)
--
-- Dois blocos novos, que só existem no formato com caminhos (v3):
--
--   * `perguntar` — "Pedir para escolher": manda a pergunta com as opções
--     numeradas e espera a resposta. Uma saída por opção, mais
--     `nao_resolvido`. `tentativas` (1 a 5, padrão 2) é quantas respostas o
--     contato pode dar antes de sair por `nao_resolvido`; `prazoHoras` (1 a
--     168, padrão 24) é quanto a execução espera.
--   * `coletar` — "Pedir para digitar": manda a pergunta e guarda o que o
--     contato escrever em `variables.<variavel>`, que as mensagens seguintes
--     usam como `{variavel}`. Saídas `padrao` e `nao_resolvido` (prazo).
--
-- A espera reaproveita a suspensão que a etapa de IA já usa: o bloco suspende
-- com prazo, e a resposta chega por `nucleo_flow_answer`, que move o cursor
-- para a saída escolhida. Entender a resposta é trabalho do runtime, sem IA:
-- número, texto igual à opção, palavra de uma opção só, sinônimo. Repetir a
-- pergunta mora DENTRO do bloco (`nucleo_flow_answer_retry` conta as
-- tentativas): o fluxo continua sem ciclo, que o banco segue proibindo.
--
-- O que o contato digita só entra no texto das mensagens: nunca em log, nunca
-- em regra, nunca em nome de etiqueta.
--
--
-- 2. OS GATILHOS (Etapa 7)
--
-- O fluxo ganha `gatilho` na definição:
--
--   * `mensagem` (o de sempre, e o padrão quando falta) e `palavra` (a
--     mensagem contém uma das palavras) — avaliados pelo runtime a cada
--     mensagem;
--   * `manual`, `etiqueta`, `etapa` e `campanha` — não dependem de mensagem.
--     Viram o comando `flow_trigger` na fila que a VPS já consome, e o
--     runtime inicia o fluxo como se o contato tivesse escrito.
--
-- De onde vem cada um:
--   * manual   -> `nucleo_flow_trigger_manual`, chamada pelo portal por
--                 alguém da equipe (o follow-up que o dono descreveu);
--   * etiqueta -> gatilho em `contact_tags` (etiqueta aplicada);
--   * etapa    -> gatilho em `deals` (negócio mudou de etapa);
--   * campanha -> gatilho em `campaign_site_leads` (lead de site entrou na
--                 campanha), só onde essa tabela existe.
--
-- Um gatilho automático nunca fala com quem tem a etiqueta "Não atender IA";
-- o manual fala, porque foi uma pessoa da equipe que pediu. E disparar fluxo
-- nunca impede a ação que o disparou: se o enfileiramento falhar, a etiqueta
-- continua aplicada e o negócio continua na etapa nova.
--
--
-- As funções do motor são as de 20260907010000 com as trocas marcadas; os
-- hashes de produção foram conferidos iguais ao arquivo antes desta escrita.
--
-- Aplicar pelo SQL Editor, depois de 20260926110000. Conferir com
-- scripts/sql/validar-fluxo-pergunta-e-gatilhos.sql.

begin;

do $$
begin
  if to_regprocedure('private.flow_contact_for(uuid, text, boolean)') is null then
    raise exception 'abortado: aplicar 20260926110000 antes';
  end if;
  if to_regprocedure('public.nucleo_flow_ack(uuid, uuid, text, text)') is null then
    raise exception 'abortado: aplicar 20260907010000 antes';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1/6. A execução guarda o que o contato respondeu e quantas vezes errou.
-- ---------------------------------------------------------------------------
alter table public.chatbot_flow_executions
  add column if not exists variables jsonb not null default '{}'::jsonb,
  add column if not exists attempts integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chatbot_flow_executions_variables_check') then
    alter table public.chatbot_flow_executions add constraint chatbot_flow_executions_variables_check
      check (jsonb_typeof(variables) = 'object' and octet_length(variables::text) <= 32768);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chatbot_flow_executions_attempts_check') then
    alter table public.chatbot_flow_executions add constraint chatbot_flow_executions_attempts_check
      check (attempts between 0 and 10);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2/6. O que um gatilho e uma pergunta podem ter.
-- ---------------------------------------------------------------------------
create or replace function private.flow_validate_trigger(trigger jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare kind text; word jsonb; reference text;
begin
  -- Sem gatilho vale o de sempre: uma mensagem do contato.
  if trigger is null or jsonb_typeof(trigger) = 'null' then return; end if;
  if jsonb_typeof(trigger) is distinct from 'object' then raise exception 'flow trigger invalid'; end if;
  kind := trigger->>'tipo';
  if kind is null or kind not in ('mensagem','palavra','manual','campanha','etiqueta','etapa') then
    raise exception 'flow trigger invalid';
  end if;
  if kind = 'palavra' then
    if jsonb_typeof(trigger->'palavras') is distinct from 'array'
       or jsonb_array_length(trigger->'palavras') not between 1 and 20 then
      raise exception 'flow trigger invalid';
    end if;
    for word in select jsonb_array_elements(trigger->'palavras') loop
      if jsonb_typeof(word) is distinct from 'string' or length(trim(word #>> '{}')) not between 1 and 60 then
        raise exception 'flow trigger invalid';
      end if;
    end loop;
  end if;
  if kind in ('campanha','etiqueta','etapa') then
    reference := trigger->>case kind when 'campanha' then 'campanhaId' when 'etiqueta' then 'etiquetaId' else 'stageId' end;
    if reference is null or reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'flow trigger invalid';
    end if;
  end if;
end;
$$;

create or replace function private.flow_validate_question(step jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare item jsonb; ids text[] := array[]::text[]; synonym jsonb;
begin
  if length(trim(coalesce(step->>'texto',''))) not between 1 and 4000 then
    raise exception 'flow question invalid';
  end if;
  if step ? 'prazoHoras' and (
    jsonb_typeof(step->'prazoHoras') is distinct from 'number'
    or coalesce(step->>'prazoHoras','') !~ '^[0-9]{1,3}$'
    or (step->>'prazoHoras')::int not between 1 and 168
  ) then raise exception 'flow question invalid'; end if;

  if step->>'tipo' = 'coletar' then
    if coalesce(step->>'variavel','') !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'flow question invalid';
    end if;
    return;
  end if;

  if step ? 'tentativas' and (
    jsonb_typeof(step->'tentativas') is distinct from 'number'
    or coalesce(step->>'tentativas','') !~ '^[0-9]$'
    or (step->>'tentativas')::int not between 1 and 5
  ) then raise exception 'flow question invalid'; end if;
  if jsonb_typeof(step->'opcoes') is distinct from 'array'
     or jsonb_array_length(step->'opcoes') not between 1 and 10 then
    raise exception 'flow question invalid';
  end if;
  for item in select jsonb_array_elements(step->'opcoes') loop
    if jsonb_typeof(item) is distinct from 'object'
       or coalesce(item->>'id','') !~ '^[a-z0-9_-]{1,40}$'
       or item->>'id' in ('nao_resolvido','padrao')
       or item->>'id' = any(ids)
       or length(trim(coalesce(item->>'rotulo',''))) not between 1 and 100 then
      raise exception 'flow question invalid';
    end if;
    ids := array_append(ids, item->>'id');
    if item ? 'sinonimos' then
      if jsonb_typeof(item->'sinonimos') is distinct from 'array'
         or jsonb_array_length(item->'sinonimos') > 20 then
        raise exception 'flow question invalid';
      end if;
      for synonym in select jsonb_array_elements(item->'sinonimos') loop
        if jsonb_typeof(synonym) is distinct from 'string'
           or length(trim(synonym #>> '{}')) not between 1 and 60 then
          raise exception 'flow question invalid';
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/6. O motor (corpos de 20260907010000 com as trocas marcadas no cabeçalho).
-- ---------------------------------------------------------------------------
create or replace function private.flow_validate(spec jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  step jsonb; edge jsonb; node text; target text; port text;
  nodes text[] := array['entrada','condicoes'];
  ports text[]; removed text[] := array[]::text[]; pending text[];
  found_root boolean;
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
  perform private.flow_validate_expression(spec->'condicoes');
  perform private.flow_validate_trigger(spec->'gatilho');
  for step in select jsonb_array_elements(spec->'passos') loop
    node := step->>'id';
    if node is null or node !~ '^[A-Za-z0-9_-]{1,80}$' or node=any(nodes) then
      raise exception 'flow node identity invalid';
    end if;
    nodes := array_append(nodes,node);
    if step->>'tipo' not in ('enviar_mensagem','editar_etiquetas','condicao','transferir','encerrar','perguntar','coletar')
      or step->>'tipo' is null then raise exception 'flow node type invalid'; end if;
    if step->>'tipo'='enviar_mensagem' and length(trim(coalesce(step->>'texto',''))) not between 1 and 4000 then
      raise exception 'flow message invalid';
    end if;
    if step->>'tipo'='transferir' and coalesce(step->>'destino','') not in ('ia','humano') then
      raise exception 'flow transfer invalid';
    end if;
    if step->>'tipo'='condicao' then perform private.flow_validate_expression(step->'expressao'); end if;
    if step->>'tipo' in ('perguntar','coletar') then perform private.flow_validate_question(step); end if;
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

create or replace function public.nucleo_flow_claim(execution_id uuid, expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found then raise exception 'flow execution unavailable'; end if;
  if run.revision is distinct from expected_revision then raise exception 'flow revision changed'; end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if run.status='executing' and run.claim_expires_at<=now() then
    if step->>'tipo'='enviar_mensagem' then
      update public.chatbot_flow_executions set status='needs_review',reason='delivery_unknown',updated_at=now()
      where id=run.id returning * into run;
      return private.flow_envelope(run);
    end if;
  elsif run.status<>'ready' then raise exception 'flow execution not ready';
  end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=run.contact_id and c.channel='whatsapp' and c.state='handed_off') then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',updated_at=now()
    where id=run.id returning * into run;
    return private.flow_envelope(run);
  end if;
  update public.chatbot_flow_executions set status='executing',claim_token=gen_random_uuid(),
    claim_expires_at=now()+interval '90 seconds',revision=revision+1,updated_at=now(),
    suspension_id=case when (step->>'tipo'='transferir' and step->>'destino'='ia') or step->>'tipo' in ('perguntar','coletar')
      then coalesce(suspension_id,gen_random_uuid()) else suspension_id end
  where id=run.id returning * into run;
  return private.flow_envelope(run)||jsonb_build_object('step',step,
    'contact',(public.nucleo_chatbot_runtime_context(run.requester_phone))->'contact');
end;
$$;

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
      delete from public.contact_tags t where t.organization_id=org and t.contact_id=run.contact_id and t.tag_id=any(removed);
      insert into public.contact_tags(organization_id,contact_id,tag_id)
      select org,run.contact_id,v from unnest(added) v on conflict(contact_id,tag_id) do nothing;
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

create or replace function private.flow_envelope(run public.chatbot_flow_executions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('executionId',run.id,'organizationId',run.organization_id,
    'connectionId',run.connection_id,'contactId',run.contact_id,
    'requesterPhone',run.requester_phone,'conversationSessionId',run.conversation_session_id,'conversationEpoch',run.conversation_epoch,
    'chatbotId',run.chatbot_id,'chatbotVersion',run.chatbot_version,
    'cursor',run.cursor_node_id,'revision',run.revision,'status',run.status,
    'claimToken',run.claim_token,'suspensionId',run.suspension_id,
    'suspensionExpiresAt',run.suspension_expires_at,'lastSuspensionId',run.last_suspension_id,
    'lastOutcome',run.last_outcome,'reason',run.reason,
    'variables',run.variables,'attempts',run.attempts,
    -- O que a execução suspensa espera: a resposta do contato ou a IA.
    'waiting',case when run.status='suspended' then
      case when private.flow_step(run.definition_snapshot,run.cursor_node_id)->>'tipo' in ('perguntar','coletar')
        then 'reply' else 'ia' end end);
$$;

create or replace function public.nucleo_flow_finish_ai(
  execution_id uuid, suspension_id uuid, requester_phone text, outcome text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare conn uuid:=private.flow_connection(); org uuid:=private.robot_organization(); run public.chatbot_flow_executions%rowtype; output_name text;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found or run.requester_phone<>regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g') then
    raise exception 'flow execution unavailable';
  end if;
  if outcome is null or outcome not in ('sucesso','falha','expired') then raise exception 'flow outcome invalid'; end if;
  if suspension_id is not null and run.last_suspension_id=suspension_id and run.last_outcome=outcome then
    return private.flow_envelope(run);
  end if;
  if run.status<>'suspended' or suspension_id is null or run.suspension_id is distinct from suspension_id then
    raise exception 'flow suspension invalid';
  end if;
  -- Uma pergunta não é uma etapa de IA: quem a encerra é `nucleo_flow_answer`.
  if private.flow_step(run.definition_snapshot,run.cursor_node_id)->>'tipo' in ('perguntar','coletar') then
    raise exception 'flow suspension invalid';
  end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=run.contact_id and c.channel='whatsapp' and c.state='handed_off') then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',updated_at=now()
    where id=run.id returning * into run;
    return private.flow_envelope(run);
  end if;
  if outcome='expired' and run.suspension_expires_at>now() then raise exception 'flow suspension not expired'; end if;
  if outcome<>'expired' and run.suspension_expires_at<=now() then raise exception 'flow suspension expired'; end if;
  output_name:=case when outcome='expired' then 'falha' else outcome end;
  update public.chatbot_flow_executions set
    cursor_node_id=private.flow_target(run.definition_snapshot,run.cursor_node_id,output_name),
    status='ready',last_suspension_id=run.suspension_id,last_outcome=outcome,
    suspension_id=null,suspension_expires_at=null,revision=revision+1,updated_at=now(),
    reason=case when outcome='expired' then 'ai_timeout' else null end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4/6. A resposta do contato.
-- ---------------------------------------------------------------------------
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
  if coalesce(step->>'tipo','') not in ('perguntar','coletar') then raise exception 'flow suspension invalid'; end if;
  valid:=case step->>'tipo'
    when 'perguntar' then array(select o->>'id' from jsonb_array_elements(step->'opcoes') o)||array['nao_resolvido']
    else array['padrao','nao_resolvido'] end;
  if selected_output is null or not (selected_output=any(valid)) then raise exception 'flow output invalid'; end if;
  -- Depois do prazo, a única saída é desistir.
  expired:=run.suspension_expires_at<=now();
  if expired and selected_output<>'nao_resolvido' then raise exception 'flow suspension expired'; end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=run.contact_id and c.channel='whatsapp' and c.state='handed_off') then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
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
    reason=case when expired then 'reply_timeout' else null end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;

comment on function public.nucleo_flow_answer(uuid, uuid, text, text, text) is
  'Encerra a espera de um bloco perguntar/coletar pela saida escolhida (uma opcao, padrao ou nao_resolvido) e guarda a resposta de coletar em variables. Chamada pelo runtime da VPS. Ver 20260926120000.';

-- Uma resposta que não deu para entender, com tentativas sobrando: conta mais
-- uma e a execução continua esperando. Sem tentativas, recusa, e o runtime
-- responde `nao_resolvido`.
create or replace function public.nucleo_flow_answer_retry(
  execution_id uuid, suspension_id uuid, requester_phone text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  conn uuid:=private.flow_connection(); org uuid:=private.robot_organization();
  run public.chatbot_flow_executions%rowtype; step jsonb;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found or run.requester_phone<>regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g') then
    raise exception 'flow execution unavailable';
  end if;
  if run.status<>'suspended' or suspension_id is null or run.suspension_id is distinct from suspension_id
     or run.suspension_expires_at<=now() then
    raise exception 'flow suspension invalid';
  end if;
  step:=private.flow_step(run.definition_snapshot,run.cursor_node_id);
  if coalesce(step->>'tipo','')<>'perguntar' then raise exception 'flow suspension invalid'; end if;
  if run.attempts+1>=coalesce((step->>'tentativas')::int,2) then raise exception 'flow attempts exhausted'; end if;
  update public.chatbot_flow_executions set attempts=attempts+1,revision=revision+1,updated_at=now()
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;

comment on function public.nucleo_flow_answer_retry(uuid, uuid, text) is
  'Conta uma resposta nao entendida de um bloco perguntar e mantem a espera. Levanta flow attempts exhausted quando nao sobra tentativa. Ver 20260926120000.';

-- ---------------------------------------------------------------------------
-- 5/6. Os gatilhos que não dependem de mensagem.
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
  -- Acrescenta sem reescrever: a lista de produção tem tipos que nem todo
  -- ramo do repositório conhece (site_lead_welcome), e perdê-los derrubaria
  -- comandos vivos.
  if not ('flow_trigger' = any(tipos)) then
    tipos := tipos || array['flow_trigger'];
    alter table public.connection_runtime_commands drop constraint connection_runtime_commands_command_type_check;
    -- `array['a', 'b']`, e não '{a,b}': é o formato que o catálogo devolve e que
    -- a próxima migration que mexer nesta lista vai ler de novo.
    execute format(
      'alter table public.connection_runtime_commands add constraint connection_runtime_commands_command_type_check check (command_type = any (array[%s]::text[]))',
      (select string_agg(quote_literal(t), ', ' order by ord) from unnest(tipos) with ordinality as u(t, ord)));
  end if;
end;
$$;

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
  select w.id into conn from public.whatsapp_connections w
  where w.organization_id = target_organization and w.status <> 'revoked'
    and exists (select 1 from public.connection_robot_credentials r
                where r.connection_id = w.id and r.status = 'active' and r.revoked_at is null)
  order by w.updated_at desc limit 1;
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

comment on function private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text) is
  'Enfileira flow_trigger para cada fluxo v3 ativo cujo gatilho casa (manual, campanha, etiqueta, etapa). Respeita a funcao chatbots e, fora do manual, a etiqueta nao-atender-ia. Ver 20260926120000.';

create or replace function private.flow_trigger_on_tag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.flow_trigger_enqueue(new.organization_id, new.contact_id, 'etiqueta', new.tag_id,
      (select p.id from public.profiles p where p.id = auth.uid()), 'etiqueta');
  exception when others then
    null;  -- disparar fluxo nunca impede aplicar a etiqueta
  end;
  return new;
end;
$$;

drop trigger if exists chatbot_flow_trigger_on_tag on public.contact_tags;
create trigger chatbot_flow_trigger_on_tag
after insert on public.contact_tags
for each row execute function private.flow_trigger_on_tag();

create or replace function private.flow_trigger_on_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null and (tg_op = 'INSERT' or old.stage_id is distinct from new.stage_id) then
    begin
      perform private.flow_trigger_enqueue(new.organization_id, new.contact_id, 'etapa', new.stage_id,
        (select p.id from public.profiles p where p.id = auth.uid()), 'etapa');
    exception when others then
      null;  -- disparar fluxo nunca impede mover o negócio
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists chatbot_flow_trigger_on_stage on public.deals;
create trigger chatbot_flow_trigger_on_stage
after insert or update of stage_id on public.deals
for each row execute function private.flow_trigger_on_stage();

create or replace function private.flow_trigger_on_campaign_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.contact_id is not null and (tg_op = 'INSERT' or old.contact_id is distinct from new.contact_id) then
    begin
      perform private.flow_trigger_enqueue(new.organization_id, new.contact_id, 'campanha', new.campaign_id, null, 'campanha');
    exception when others then
      null;  -- disparar fluxo nunca impede o lead de entrar
    end;
  end if;
  return new;
end;
$$;

-- A tabela dos leads do site existe em produção (20260915000000), mas não em
-- todo ramo do repositório.
do $$
begin
  if to_regclass('public.campaign_site_leads') is not null then
    execute 'drop trigger if exists chatbot_flow_trigger_on_campaign_lead on public.campaign_site_leads';
    execute 'create trigger chatbot_flow_trigger_on_campaign_lead after insert or update of contact_id on public.campaign_site_leads for each row execute function private.flow_trigger_on_campaign_lead()';
  end if;
end;
$$;

create or replace function public.nucleo_flow_trigger_manual(target_contact uuid, target_chatbot uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare org uuid; queued integer;
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
  queued := private.flow_trigger_enqueue(org, target_contact, 'manual', target_chatbot, auth.uid(), 'manual');
  if queued = 0 then raise exception 'flow trigger unavailable'; end if;
  return jsonb_build_object('queued', queued);
end;
$$;

comment on function public.nucleo_flow_trigger_manual(uuid, uuid) is
  'Alguem da equipe inicia um fluxo de gatilho manual para um contato (follow-up). Enfileira flow_trigger para a VPS. Ver 20260926120000.';

-- ---------------------------------------------------------------------------
-- 6/6. Quem pode chamar o quê.
-- ---------------------------------------------------------------------------
revoke all on function private.flow_validate_trigger(jsonb) from public, anon, authenticated;
revoke all on function private.flow_validate_question(jsonb) from public, anon, authenticated;
revoke all on function private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.flow_trigger_on_tag() from public, anon, authenticated;
revoke all on function private.flow_trigger_on_stage() from public, anon, authenticated;
revoke all on function private.flow_trigger_on_campaign_lead() from public, anon, authenticated;
revoke all on function public.nucleo_flow_answer(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.nucleo_flow_answer_retry(uuid, uuid, text) from public, anon;
revoke all on function public.nucleo_flow_trigger_manual(uuid, uuid) from public, anon;
grant execute on function public.nucleo_flow_answer(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.nucleo_flow_answer_retry(uuid, uuid, text) to authenticated;
grant execute on function public.nucleo_flow_trigger_manual(uuid, uuid) to authenticated;

-- Conferência.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.connection_runtime_commands'::regclass
      and c.conname = 'connection_runtime_commands_command_type_check'
      and pg_get_constraintdef(c.oid) like '%flow_trigger%'
  ) then
    raise exception 'conferencia: a fila nao aceita flow_trigger';
  end if;
  if has_function_privilege('anon', 'public.nucleo_flow_trigger_manual(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'conferencia: permissao errada nas funcoes de gatilho';
  end if;
end;
$$;

commit;
