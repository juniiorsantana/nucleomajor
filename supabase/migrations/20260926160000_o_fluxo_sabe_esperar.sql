-- O fluxo sabe esperar: o bloco "Aguardar" (Etapa 8 do construtor).
--
-- Pedido do dono em 24/09/2026: o follow-up. A negociação parou, alguém da
-- equipe clica em "Iniciar fluxo" (gatilho manual, 20260926120000) e o fluxo
-- manda uma mensagem, espera 24 horas, cobra de novo, espera 2 horas, e
-- desiste — sozinho, com o portal fechado.
--
-- O bloco `aguardar` só existe no formato com caminhos (v3):
--
--   * `duracao` (inteiro) e `unidade` (`minutos` 1 a 1440, `horas` 1 a 720,
--     `dias` 1 a 30);
--   * duas saídas: `respondeu` (o contato escreveu antes do prazo) e
--     `sem_resposta` (o prazo venceu).
--
-- A espera reaproveita a suspensão que a IA e as perguntas já usam: o ack
-- suspende com o prazo do bloco, e `nucleo_flow_answer` acorda a execução —
-- `respondeu` quando o contato escreve (a mensagem é consumida pela espera e
-- não abre outro fluxo), `sem_resposta` quando o relógio da VPS vê o prazo
-- vencido. `sem_resposta` antes do prazo é recusado: seria cobrar cedo.
--
-- Freios:
--   * no máximo 10 blocos `aguardar` por fluxo, e o fluxo segue sem ciclo, que
--     o banco continua proibindo: toda sequência de cobranças tem fim;
--   * cobrança com mais de 6 horas de atraso (a VPS ficou fora do ar) não sai:
--     a execução fecha como `cancelled`/`wait_missed` e grava `flow.expired` em
--     `contact_events`;
--   * quem a equipe assumiu (handed_off) cancela a espera, como já cancelava a
--     pergunta e a etapa de IA (`flow_cancel_on_human_handoff`).
--
-- As funções do motor são as de 20260926120000 com as trocas marcadas por
-- comentário; a trava abaixo confere que é essa a versão em produção.
--
-- Aplicar pelo SQL Editor, depois de 20260926150000. Prova:
-- scripts/sql/prova-fluxo-aguardar.mjs.

begin;

do $$
declare validar text; responder text; confirmar text;
begin
  select pg_catalog.replace(p.prosrc, chr(13), '') into validar from pg_catalog.pg_proc p
    where p.oid = 'private.flow_validate(jsonb)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into responder from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_answer(uuid, uuid, text, text, text)'::regprocedure;
  select pg_catalog.replace(p.prosrc, chr(13), '') into confirmar from pg_catalog.pg_proc p
    where p.oid = 'public.nucleo_flow_ack(uuid, uuid, text, text)'::regprocedure;
  if validar is null or responder is null or confirmar is null
    or validar not like '%''perguntar'',''coletar'')%' or validar like '%aguardar%'
    or responder not like '%reply_timeout%' or responder like '%aguardar%'
    or confirmar not like '%prazoHoras%' or confirmar like '%aguardar%' then
    raise exception 'abortado: o motor de fluxo em producao nao e o de 20260926120000; conferir antes de reescrever';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1/3. O que uma espera pode ter.
-- ---------------------------------------------------------------------------
create or replace function private.flow_validate_wait(step jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare amount integer;
begin
  if jsonb_typeof(step->'duracao') is distinct from 'number'
     or coalesce(step->>'duracao','') !~ '^[0-9]{1,4}$' then
    raise exception 'flow wait invalid';
  end if;
  amount := (step->>'duracao')::int;
  if coalesce(step->>'unidade','') not in ('minutos','horas','dias')
     or (step->>'unidade' = 'minutos' and amount not between 1 and 1440)
     or (step->>'unidade' = 'horas' and amount not between 1 and 720)
     or (step->>'unidade' = 'dias' and amount not between 1 and 30) then
    raise exception 'flow wait invalid';
  end if;
end;
$$;

create or replace function private.flow_wait_interval(step jsonb) returns interval
language sql immutable set search_path = '' as $$
  select case step->>'unidade'
    when 'minutos' then pg_catalog.make_interval(mins => (step->>'duracao')::int)
    when 'horas' then pg_catalog.make_interval(hours => (step->>'duracao')::int)
    else pg_catalog.make_interval(days => (step->>'duracao')::int) end;
$$;

-- ---------------------------------------------------------------------------
-- 2/3. O motor (corpos de 20260926120000 com as trocas marcadas).
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
    suspension_id=case when (step->>'tipo'='transferir' and step->>'destino'='ia') or step->>'tipo' in ('perguntar','coletar','aguardar')
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
    -- O que a execução suspensa espera: a resposta do contato, o relógio ou a IA.
    'waiting',case when run.status='suspended' then
      case private.flow_step(run.definition_snapshot,run.cursor_node_id)->>'tipo'
        when 'perguntar' then 'reply' when 'coletar' then 'reply'
        when 'aguardar' then 'timer' else 'ia' end end);
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
  -- Uma pergunta ou uma espera não é etapa de IA: quem a encerra é `nucleo_flow_answer`.
  if private.flow_step(run.definition_snapshot,run.cursor_node_id)->>'tipo' in ('perguntar','coletar','aguardar') then
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
  -- Depois do prazo, a única saída é desistir. Na espera (Etapa 8) vale o
  -- contrário também: `sem_resposta` antes do prazo seria cobrar cedo.
  expired:=run.suspension_expires_at<=now();
  if step->>'tipo'='aguardar' then
    if expired and selected_output<>'sem_resposta' then raise exception 'flow suspension expired'; end if;
    if not expired and selected_output='sem_resposta' then raise exception 'flow suspension not expired'; end if;
  elsif expired and selected_output<>'nao_resolvido' then raise exception 'flow suspension expired'; end if;
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
    reason=case when not expired then null
      when step->>'tipo'='aguardar' then 'wait_elapsed' else 'reply_timeout' end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;


comment on function public.nucleo_flow_answer(uuid, uuid, text, text, text) is
  'Encerra a espera de um bloco perguntar/coletar/aguardar pela saida escolhida (uma opcao, padrao, nao_resolvido, respondeu ou sem_resposta) e guarda a resposta de coletar em variables. Chamada pelo runtime da VPS. Ver 20260926120000 e 20260926160000.';

-- ---------------------------------------------------------------------------
-- 3/3. Quem pode chamar o quê, e a conferência.
-- ---------------------------------------------------------------------------
revoke all on function private.flow_validate_wait(jsonb) from public, anon, authenticated;
revoke all on function private.flow_wait_interval(jsonb) from public, anon, authenticated;

do $$
declare spec jsonb := '{
  "condicoes": [{"tipo": "primeira_conversa"}],
  "passos": [
    {"id": "msg", "tipo": "enviar_mensagem", "texto": "Oi"},
    {"id": "espera", "tipo": "aguardar", "duracao": 24, "unidade": "horas"},
    {"id": "fim", "tipo": "encerrar"}
  ],
  "canvas": {"versao": 3, "nos": [], "conexoes": [
    {"source": "entrada", "saida": "padrao", "target": "condicoes"},
    {"source": "condicoes", "saida": "padrao", "target": "msg"},
    {"source": "msg", "saida": "padrao", "target": "espera"},
    {"source": "espera", "saida": "respondeu", "target": "fim"},
    {"source": "espera", "saida": "sem_resposta", "target": "fim"}
  ]}
}';
begin
  perform private.flow_validate(spec);
  if private.flow_wait_interval('{"duracao": 2, "unidade": "horas"}') <> interval '2 hours' then
    raise exception 'conferencia: prazo da espera errado';
  end if;
  if has_function_privilege('authenticated', 'private.flow_validate_wait(jsonb)', 'EXECUTE') then
    raise exception 'conferencia: permissao errada na validacao da espera';
  end if;
end;
$$;

commit;
