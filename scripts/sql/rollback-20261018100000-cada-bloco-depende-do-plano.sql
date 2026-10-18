-- Desfaz 20261018100000_cada_bloco_depende_do_plano.sql.
--
-- Volta o claim ao corpo de 20260926160000 e o start ao de 20260926110000,
-- tira o gatilho de chatbot_definitions e apaga as funções da lista. Os
-- eventos `flow.step_blocked` já gravados em contact_events ficam (são
-- histórico). Execuções que o claim já desviou pela Falha ou cancelou com
-- `plan_feature_missing` não voltam: o desvio já aconteceu.
--
-- Ordem segura: primeiro voltar a release da VPS (se a nova já estiver no ar
-- ela só LÊ `requer`/`bloqueado` e funciona sem eles), depois este script.
-- Aplicar pelo SQL Editor.

begin;

drop trigger if exists chatbot_definitions_plan_guard on public.chatbot_definitions;

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

create or replace function public.nucleo_flow_start(
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

drop function if exists private.flow_definition_plan_guard();
drop function if exists private.flow_validate(jsonb, uuid);
drop function if exists private.flow_locked_feature(uuid, jsonb);
drop function if exists private.flow_start_features(jsonb);
drop function if exists private.flow_step_features(jsonb);
drop function if exists private.flow_expression_rules(jsonb, integer);
drop function if exists private.flow_block_requirements();

do $$
begin
  if exists (select 1 from pg_catalog.pg_proc p where p.oid = 'public.nucleo_flow_claim(uuid, bigint)'::regprocedure
             and p.prosrc like '%plan_feature_missing%')
     or exists (select 1 from pg_catalog.pg_proc p where p.oid = 'public.nucleo_flow_start(text, text, uuid, bigint, uuid, bigint)'::regprocedure
             and p.prosrc like '%flow feature unavailable%')
     or to_regprocedure('private.flow_validate(jsonb, uuid)') is not null then
    raise exception 'rollback incompleto';
  end if;
end;
$$;

commit;
