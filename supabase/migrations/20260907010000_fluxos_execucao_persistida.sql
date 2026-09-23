-- FASE 3: persistent, version-pinned flow execution. Apply via SQL Editor.
begin;

create table public.chatbot_flow_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  connection_id uuid not null references public.whatsapp_connections(id),
  contact_id uuid not null references public.contacts(id),
  chatbot_id uuid not null references public.chatbot_definitions(id),
  chatbot_version bigint not null,
  definition_snapshot jsonb not null,
  requester_phone text not null check (requester_phone ~ '^[0-9]{10,15}$'),
  conversation_session_id uuid not null,
  conversation_epoch bigint not null default 0 check (conversation_epoch >= 0),
  external_message_id text not null,
  cursor_node_id text not null,
  revision bigint not null default 0,
  status text not null default 'ready' check (status in (
    'ready', 'executing', 'suspended', 'completed', 'cancelled', 'needs_review'
  )),
  claim_token uuid,
  claim_expires_at timestamptz,
  last_ack_token uuid,
  suspension_id uuid,
  suspension_expires_at timestamptz,
  last_suspension_id uuid,
  last_outcome text,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_polled_at timestamptz not null default '-infinity',
  unique (organization_id, connection_id, external_message_id)
);

create unique index chatbot_flow_one_live_conversation
on public.chatbot_flow_executions(organization_id, connection_id, requester_phone)
where status in ('ready', 'executing', 'suspended', 'needs_review');

alter table public.chatbot_flow_executions enable row level security;
revoke all on public.chatbot_flow_executions from public, anon, authenticated;

-- Human ownership cancels durable continuations even before the VPS polls.
create function private.flow_cancel_on_human_handoff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state='handed_off' and new.audience='customer' and new.channel='whatsapp' and new.contact_id is not null then
    update public.chatbot_flow_executions set status='cancelled',reason='human_takeover',
      revision=revision+1,updated_at=now()
    where organization_id=new.organization_id and contact_id=new.contact_id
      and status in ('ready','executing','suspended','needs_review');
  end if;
  return new;
end;
$$;
create trigger flow_cancel_on_human_handoff
after insert or update of state on public.conversation_intelligence_contexts
for each row execute function private.flow_cancel_on_human_handoff();
revoke all on function private.flow_cancel_on_human_handoff() from public, anon, authenticated;

create function private.flow_connection() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  org uuid := private.robot_organization();
  conn uuid;
begin
  if org is null then raise exception 'active robot credential required'; end if;
  select c.connection_id into conn from public.connection_robot_credentials c
  where c.organization_id=org and c.auth_user_id=auth.uid()
    and c.status='active' and c.revoked_at is null;
  if conn is null then raise exception 'active robot connection required'; end if;
  return conn;
end;
$$;

create function private.flow_step(spec jsonb, node_id text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare step jsonb;
begin
  select item into strict step from jsonb_array_elements(spec->'passos') item
  where item->>'id'=node_id;
  return step;
exception when no_data_found or too_many_rows then
  raise exception 'flow node unavailable';
end;
$$;

create function private.flow_target(spec jsonb, node_id text, output_name text) returns text
language plpgsql immutable set search_path = '' as $$
declare target text;
begin
  select edge->>'target' into strict target
  from jsonb_array_elements(spec#>'{canvas,conexoes}') edge
  where edge->>'source'=node_id and coalesce(edge->>'saida','padrao')=output_name;
  if target is null then raise exception 'flow output unavailable'; end if;
  return target;
exception when no_data_found or too_many_rows then
  raise exception 'flow output unavailable';
end;
$$;

create function private.flow_validate_expression(expression jsonb, depth integer default 0) returns void
language plpgsql immutable set search_path = '' as $$
declare children jsonb; child jsonb; kind text; identifier text;
begin
  if depth > 8 or expression is null then raise exception 'flow condition invalid'; end if;
  if jsonb_typeof(expression)='array' then children:=expression;
  elsif jsonb_typeof(expression)='object' and expression ? 'operador' then
    if expression->>'operador' is null or expression->>'operador' not in ('e','ou') then
      raise exception 'flow condition invalid';
    end if;
    children:=expression->'itens';
    if jsonb_typeof(children) is distinct from 'array' then raise exception 'flow condition invalid'; end if;
  elsif jsonb_typeof(expression)='object' then
    kind:=expression->>'tipo';
    if kind is null or kind not in ('tem_etiqueta','estagio_atual','primeira_conversa','tarefa_atrasada','sem_interacao_ha') then
      raise exception 'flow condition invalid';
    end if;
    if kind in ('tem_etiqueta','estagio_atual') then
      identifier:=expression->>case when kind='tem_etiqueta' then 'etiquetaId' else 'stageId' end;
      if identifier is null or identifier !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'flow condition invalid';
      end if;
    end if;
    if kind='sem_interacao_ha' and (jsonb_typeof(expression->'dias') is distinct from 'number'
      or coalesce(expression->>'dias','') !~ '^[0-9]{1,9}$') then raise exception 'flow condition invalid'; end if;
    return;
  else raise exception 'flow condition invalid';
  end if;
  if jsonb_array_length(children) not between 1 and 100 then raise exception 'flow condition invalid'; end if;
  for child in select jsonb_array_elements(children) loop
    perform private.flow_validate_expression(child,depth+1);
  end loop;
end;
$$;

create function private.flow_validate(spec jsonb) returns void
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
  for step in select jsonb_array_elements(spec->'passos') loop
    node := step->>'id';
    if node is null or node !~ '^[A-Za-z0-9_-]{1,80}$' or node=any(nodes) then
      raise exception 'flow node identity invalid';
    end if;
    nodes := array_append(nodes,node);
    if step->>'tipo' not in ('enviar_mensagem','editar_etiquetas','condicao','transferir','encerrar')
      or step->>'tipo' is null then raise exception 'flow node type invalid'; end if;
    if step->>'tipo'='enviar_mensagem' and length(trim(coalesce(step->>'texto',''))) not between 1 and 4000 then
      raise exception 'flow message invalid';
    end if;
    if step->>'tipo'='transferir' and coalesce(step->>'destino','') not in ('ia','humano') then
      raise exception 'flow transfer invalid';
    end if;
    if step->>'tipo'='condicao' then perform private.flow_validate_expression(step->'expressao'); end if;
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

create function private.flow_envelope(run public.chatbot_flow_executions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('executionId',run.id,'organizationId',run.organization_id,
    'connectionId',run.connection_id,'contactId',run.contact_id,
    'requesterPhone',run.requester_phone,'conversationSessionId',run.conversation_session_id,'conversationEpoch',run.conversation_epoch,
    'chatbotId',run.chatbot_id,'chatbotVersion',run.chatbot_version,
    'cursor',run.cursor_node_id,'revision',run.revision,'status',run.status,
    'claimToken',run.claim_token,'suspensionId',run.suspension_id,
    'suspensionExpiresAt',run.suspension_expires_at,'lastSuspensionId',run.last_suspension_id,
    'lastOutcome',run.last_outcome,'reason',run.reason);
$$;

create function public.nucleo_flow_start(
  requester_phone text, external_message text, selected_chatbot uuid,
  expected_version bigint, conversation_session uuid, conversation_epoch bigint default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org uuid:=private.robot_organization(); conn uuid:=private.flow_connection();
  safe_phone text:=regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g');
  bot public.chatbot_definitions%rowtype; run public.chatbot_flow_executions%rowtype;
  contact uuid;
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
  select c.id into contact from public.contacts c where c.organization_id=org and c.deleted_at is null
    and (regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=safe_phone
      or regexp_replace(coalesce(c.whatsapp_id,''),'[^0-9]','','g')=safe_phone)
    order by c.updated_at desc limit 1;
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

create function public.nucleo_flow_claim(execution_id uuid, expected_revision bigint)
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
    suspension_id=case when step->>'tipo'='transferir' and step->>'destino'='ia'
      then coalesce(suspension_id,gen_random_uuid()) else suspension_id end
  where id=run.id returning * into run;
  return private.flow_envelope(run)||jsonb_build_object('step',step,
    'contact',(public.nucleo_chatbot_runtime_context(run.requester_phone))->'contact');
end;
$$;

create function public.nucleo_flow_ack(
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
  else
    run.status:='completed';
    update public.chatbot_definitions set executions=executions+1,last_execution_at=now()
    where id=run.chatbot_id and organization_id=org;
  end if;
  update public.chatbot_flow_executions set cursor_node_id=run.cursor_node_id,status=run.status,
    suspension_expires_at=run.suspension_expires_at,last_ack_token=run.claim_token,
    claim_token=null,claim_expires_at=null,revision=revision+1,updated_at=now()
  where id=run.id returning * into run;
  return private.flow_envelope(run);
end;
$$;

create function public.nucleo_flow_pending() returns jsonb
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

create function public.nucleo_flow_current(requester_phone text) returns jsonb
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

create function public.nucleo_flow_state(execution_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conn uuid:=private.flow_connection(); org uuid:=private.robot_organization(); run public.chatbot_flow_executions%rowtype;
begin
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn;
  if not found then raise exception 'flow execution unavailable'; end if;
  return private.flow_envelope(run);
end;
$$;

create function public.nucleo_flow_finish_ai(
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

create function public.nucleo_flow_cancel(execution_id uuid, cancellation_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare conn uuid:=private.flow_connection(); org uuid:=private.robot_organization(); run public.chatbot_flow_executions%rowtype;
begin
  if cancellation_reason is null or cancellation_reason not in ('human_takeover','session_closed','session_changed','invalid_definition','connection_revoked','automation_paused','contact_unavailable') then
    raise exception 'flow cancellation invalid';
  end if;
  select * into run from public.chatbot_flow_executions f where f.id=execution_id
    and f.organization_id=org and f.connection_id=conn for update;
  if not found then raise exception 'flow execution unavailable'; end if;
  if run.status not in ('completed','cancelled') then
    update public.chatbot_flow_executions set status='cancelled',reason=cancellation_reason,revision=revision+1,updated_at=now()
    where id=run.id returning * into run;
  end if;
  return private.flow_envelope(run);
end;
$$;

revoke all on function private.flow_connection() from public, anon, authenticated;
revoke all on function private.flow_step(jsonb,text) from public, anon, authenticated;
revoke all on function private.flow_target(jsonb,text,text) from public, anon, authenticated;
revoke all on function private.flow_validate(jsonb) from public, anon, authenticated;
revoke all on function private.flow_validate_expression(jsonb,integer) from public, anon, authenticated;
revoke all on function private.flow_envelope(public.chatbot_flow_executions) from public, anon, authenticated;
revoke all on function public.nucleo_flow_start(text,text,uuid,bigint,uuid,bigint) from public, anon;
revoke all on function public.nucleo_flow_claim(uuid,bigint) from public, anon;
revoke all on function public.nucleo_flow_ack(uuid,uuid,text,text) from public, anon;
revoke all on function public.nucleo_flow_pending() from public, anon;
revoke all on function public.nucleo_flow_current(text) from public, anon;
revoke all on function public.nucleo_flow_state(uuid) from public, anon;
revoke all on function public.nucleo_flow_finish_ai(uuid,uuid,text,text) from public, anon;
revoke all on function public.nucleo_flow_cancel(uuid,text) from public, anon;
grant execute on function public.nucleo_flow_start(text,text,uuid,bigint,uuid,bigint) to authenticated;
grant execute on function public.nucleo_flow_claim(uuid,bigint) to authenticated;
grant execute on function public.nucleo_flow_ack(uuid,uuid,text,text) to authenticated;
grant execute on function public.nucleo_flow_pending() to authenticated;
grant execute on function public.nucleo_flow_current(text) to authenticated;
grant execute on function public.nucleo_flow_state(uuid) to authenticated;
grant execute on function public.nucleo_flow_finish_ai(uuid,uuid,text,text) to authenticated;
grant execute on function public.nucleo_flow_cancel(uuid,text) to authenticated;

do $verify$
declare verified_count integer;
begin
  select count(*) into verified_count
  from (values
      ('private', 'flow_cancel_on_human_handoff', '52df475b8a327e8ea9e5bb8d334f64ce'),
      ('private', 'flow_connection', 'b6bbc7b2344af0fee0830a7717a441ea'),
      ('private', 'flow_step', 'd182e18bc61229ce42dedb4fc106dbe7'),
      ('private', 'flow_target', '2e0a59b1fe2f8ab1458d473b866343e0'),
      ('private', 'flow_validate_expression', '0a9cd49ab6e936487b139f628885c4b5'),
      ('private', 'flow_validate', '749468581666cf0e5c0ab73bc702c3e0'),
      ('private', 'flow_envelope', 'f3eaddb1283d7d6a98e92b2921665463'),
      ('public', 'nucleo_flow_start', '40f258ab7125e35dbcddeefb80e93dee'),
      ('public', 'nucleo_flow_claim', '17e4be5e4186ae551eafdb245917e2e9'),
      ('public', 'nucleo_flow_ack', 'ddf8207fd29ce828d292df2ad9f1db6f'),
      ('public', 'nucleo_flow_pending', '42f20eee3d4aae69c663b93956ca8f39'),
      ('public', 'nucleo_flow_current', '7deb3d48337a172cde578c6097e0eb5b'),
      ('public', 'nucleo_flow_state', '2fa688fe6adfed3d48d06f1ef42aa635'),
      ('public', 'nucleo_flow_finish_ai', 'e44b0646daa5fc143d458a53809603bf'),
      ('public', 'nucleo_flow_cancel', '316d3b531c3258126fcdb96714eda4c7')
  ) expected(schema_name,function_name,body_hash)
  join pg_namespace n on n.nspname=expected.schema_name
  join pg_proc p on p.pronamespace=n.oid and p.proname=expected.function_name
  where md5(replace(p.prosrc,chr(13),''))=expected.body_hash;
  if verified_count<>15 then
    raise exception 'flow body changed during copy; transaction rolled back';
  end if;
end;
$verify$;

commit;
