-- Desfaz 20261018150000_o_fluxo_nao_trava.sql. Aplicar pelo SQL Editor.
-- GERADO: os corpos abaixo são cópias exatas das migrations de origem
-- (anotadas antes de cada função). A resposta volta à forma que estava: a da
-- Etapa 9 (20261018110000, decided_by) se ela estiver aplicada, senão a de
-- 20260926160000.
--
-- Não desfaz: as execuções que o prazo já fechou (review_expired /
-- execution_expired), os eventos flow.expired gravados e as conversas que o
-- "Iniciar fluxo" devolveu ao bot (histórico).

begin;

do $$
begin
  if to_regclass('public.organization_flow_settings') is null then
    raise exception 'abortado: 20261018150000 nao esta aplicada';
  end if;
end;
$$;

-- de 20260907010000_fluxos_execucao_persistida.sql
create or replace function public.nucleo_flow_current(requester_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conn uuid:=private.flow_connection(); org uuid:=private.robot_organization(); run public.chatbot_flow_executions%rowtype;
begin
  select * into run from public.chatbot_flow_executions f where f.organization_id=org and f.connection_id=conn
    and f.requester_phone=regexp_replace(coalesce(nucleo_flow_current.requester_phone,''),'[^0-9]','','g')
    and f.status='suspended' and f.suspension_expires_at>now();
  if not found then return jsonb_build_object('status','none'); end if;
  return private.flow_envelope(run)||jsonb_build_object('step',private.flow_step(run.definition_snapshot,run.cursor_node_id));
end;
$$;

-- de 20260907010000_fluxos_execucao_persistida.sql
create or replace function public.nucleo_flow_pending() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conn uuid:=private.flow_connection(); org uuid:=private.robot_organization(); result jsonb;
begin
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

-- de 20261018100000_cada_bloco_depende_do_plano.sql
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
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||conn::text||':'||safe_phone,0));
  select * into run from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.external_message_id=external_message;
  if found then
    if run.requester_phone<>safe_phone or run.chatbot_id<>selected_chatbot
      or run.conversation_session_id<>conversation_session or run.conversation_epoch<>conversation_epoch then raise exception 'flow identity mismatch'; end if;
    return private.flow_envelope(run);
  end if;
  if exists(select 1 from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.requester_phone=safe_phone
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

-- de 20260926160000_o_fluxo_sabe_esperar.sql
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

-- de 20260926160000_o_fluxo_sabe_esperar.sql
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

-- de 20260926120000_o_fluxo_pergunta_e_tem_gatilhos.sql
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

-- de 20260926120000_o_fluxo_pergunta_e_tem_gatilhos.sql
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

-- de 20260926120000_o_fluxo_pergunta_e_tem_gatilhos.sql
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

-- a resposta: a de 20261018110000 (Etapa 9) se ela estiver aplicada, senão a de 20260926160000
do $resposta$
begin
  if to_regprocedure('public.nucleo_flow_answer(uuid, uuid, text, text, text, text)') is null then
    execute $fn$
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
$$
$fn$;
  else
    execute $fn$
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
    -- Etapa 9: quem decidiu, só numa pergunta (a espera e o digitar não escolhem).
    last_decided_by=case when step->>'tipo'='perguntar' then decided_by end,
    revision=revision+1,updated_at=now(),
    reason=case when not expired then null
      when step->>'tipo'='aguardar' then 'wait_elapsed' else 'reply_timeout' end
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$
$fn$;
  end if;
end;
$resposta$;

drop function public.nucleo_flow_trigger_status(uuid);
drop function public.nucleo_flow_settings_save(uuid, integer, uuid);
drop function private.flow_trigger_connection(uuid, uuid);
drop function private.flow_contact_busy(uuid, uuid);
drop function private.flow_expire_stale(uuid, uuid, text);
drop function private.flow_execution_timeout(uuid, jsonb);
drop table public.organization_flow_settings;

revoke all on function private.flow_validate(jsonb) from public, anon, authenticated;
revoke all on function private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.flow_trigger_on_tag() from public, anon, authenticated;

do $$
begin
  if (select prosrc from pg_proc where oid = 'public.nucleo_flow_current(text)'::regprocedure) like '%running%'
     or (select prosrc from pg_proc where oid = 'public.nucleo_flow_pending()'::regprocedure) like '%flow_expire_stale%'
     or (select prosrc from pg_proc where oid = 'private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text)'::regprocedure) like '%flow_trigger_connection%'
     or to_regprocedure('private.flow_expire_stale(uuid, uuid, text)') is not null then
    raise exception 'conferencia: o rollback nao voltou o motor';
  end if;
end;
$$;

commit;
