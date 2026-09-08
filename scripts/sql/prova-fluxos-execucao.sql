-- TEST ONLY: isolated PostgreSQL with the complete migration chain.
\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(command text, expected text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlerrm is distinct from expected then raise exception 'expected %, received %',expected,sqlerrm; end if;
    return;
  end;
  raise exception 'expected refusal: %',expected;
end $$;

create function pg_temp.robot(conn text default 'f3000000-0000-4000-8000-000000000003') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object(
    'is_robot',true,'organization_id','f3000000-0000-4000-8000-000000000002','connection_id',conn))::text,true);
end $$;

insert into auth.users(id,email) values('f3000000-0000-4000-8000-000000000001','flow-proof@example.invalid');
insert into public.profiles(id,full_name) values('f3000000-0000-4000-8000-000000000001','Flow proof') on conflict(id) do nothing;
insert into public.organizations(id,name,slug,created_by) values(
  'f3000000-0000-4000-8000-000000000002','Flow proof','flow-proof', 'f3000000-0000-4000-8000-000000000001');
insert into public.whatsapp_connections(id,organization_id,name,status) values(
  'f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002','Flow proof','connected');
insert into public.connection_robot_credentials(connection_id,organization_id,auth_user_id,status) values(
  'f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001','active');
insert into public.contacts(id,organization_id,name,phone,created_by,updated_by) values(
  'f3000000-0000-4000-8000-000000000004','f3000000-0000-4000-8000-000000000002','Fictitious customer','5511999993333',
  'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001');
insert into public.tags(id,organization_id,name,color,created_by,updated_by) values(
  'f3000000-0000-4000-8000-000000000005','f3000000-0000-4000-8000-000000000002','VIP','#123456',
  'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001');
insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values(
  'f3000000-0000-4000-8000-000000000006','f3000000-0000-4000-8000-000000000002','Branch proof',
  'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',
  '{"condicoes":[{"tipo":"primeira_conversa"}],"passos":[
    {"id":"tag","tipo":"editar_etiquetas","adicionar":["f3000000-0000-4000-8000-000000000005"],"remover":[]},
    {"id":"if","tipo":"condicao","expressao":{"tipo":"tem_etiqueta","etiquetaId":"f3000000-0000-4000-8000-000000000005"}},
    {"id":"yes","tipo":"enviar_mensagem","texto":"VIP"},
    {"id":"no","tipo":"enviar_mensagem","texto":"Normal"},
    {"id":"ai","tipo":"transferir","destino":"ia","objetivoIa":"Confirmar o pedido do cliente"},
    {"id":"success","tipo":"enviar_mensagem","texto":"Concluido"},
    {"id":"failure","tipo":"enviar_mensagem","texto":"Vamos ajudar"},
    {"id":"end","tipo":"encerrar"}
  ],"canvas":{"versao":3,"conexoes":[
    {"source":"entrada","target":"condicoes","saida":"padrao"},
    {"source":"condicoes","target":"tag","saida":"padrao"},
    {"source":"tag","target":"if","saida":"padrao"},
    {"source":"if","target":"yes","saida":"sim"},
    {"source":"if","target":"no","saida":"nao"},
    {"source":"yes","target":"ai","saida":"padrao"},
    {"source":"no","target":"ai","saida":"padrao"},
    {"source":"ai","target":"success","saida":"sucesso"},
    {"source":"ai","target":"failure","saida":"falha"},
    {"source":"success","target":"end","saida":"padrao"},
    {"source":"failure","target":"end","saida":"padrao"}
  ]}}');
select pg_temp.robot();

create function pg_temp.start_run(message text) returns jsonb language sql as $$
  select public.nucleo_flow_start('5511999993333',message,'f3000000-0000-4000-8000-000000000006',
    (select version from public.chatbot_definitions where id='f3000000-0000-4000-8000-000000000006'),
    'f3000000-0000-4000-8000-000000000007');
$$;
create function pg_temp.advance(run jsonb, output_name text default 'padrao') returns jsonb language plpgsql as $$
declare claimed jsonb;
begin
  claimed:=public.nucleo_flow_claim((run->>'executionId')::uuid,(run->>'revision')::bigint);
  return public.nucleo_flow_ack((run->>'executionId')::uuid,(claimed->>'claimToken')::uuid,output_name);
end $$;

do $$
declare run jsonb; claim jsonb; duplicate jsonb; token uuid; suspension uuid; execution uuid; revision bigint;
begin
  run:=pg_temp.start_run('flow-proof-success'); execution:=(run->>'executionId')::uuid;
  if pg_temp.start_run('flow-proof-success') is distinct from run then raise exception 'start not idempotent'; end if;
  claim:=public.nucleo_flow_claim(execution,0); token:=(claim->>'claimToken')::uuid;
  perform pg_temp.expect_error(format('select public.nucleo_flow_claim(%L,0)',execution),'flow revision changed');
  run:=public.nucleo_flow_ack(execution,token,'padrao');
  duplicate:=public.nucleo_flow_ack(execution,token,'padrao');
  if duplicate is distinct from run then raise exception 'ack not idempotent'; end if;
  if not exists(select 1 from public.contact_tags where contact_id='f3000000-0000-4000-8000-000000000004'
    and tag_id='f3000000-0000-4000-8000-000000000005') then raise exception 'tag effect missing'; end if;
  raise notice 'A PASS: start, claim and acknowledgement are scoped/idempotent; tag applied';

  claim:=public.nucleo_flow_claim(execution,(run->>'revision')::bigint);
  if not (claim#>'{contact,tags}' ? 'f3000000-0000-4000-8000-000000000005') then raise exception 'condition context stale'; end if;
  run:=public.nucleo_flow_ack(execution,(claim->>'claimToken')::uuid,'sim');
  if run->>'cursor'<>'yes' then raise exception 'condition path wrong'; end if;
  run:=pg_temp.advance(run);
  if run->>'cursor'<>'ai' then raise exception 'message skipped transfer'; end if;
  run:=pg_temp.advance(run,''); suspension:=(run->>'suspensionId')::uuid;
  if run->>'status'<>'suspended' or suspension is null then raise exception 'suspension missing'; end if;
  if (public.nucleo_flow_current('5511999993333')->>'executionId')::uuid<>execution then raise exception 'current mismatch'; end if;
  perform pg_temp.expect_error(format('select public.nucleo_flow_finish_ai(%L,%L,%L,%L)',execution,suspension,'5511999994444','sucesso'),'flow execution unavailable');
  perform pg_temp.expect_error(format('select public.nucleo_flow_finish_ai(%L,%L,%L,%L)',execution,gen_random_uuid(),'5511999993333','sucesso'),'flow suspension invalid');
  update public.chatbot_definitions set definition=jsonb_set(definition,'{passos,5,texto}','"EDITED"')
    where id='f3000000-0000-4000-8000-000000000006';
  run:=public.nucleo_flow_finish_ai(execution,suspension,'5511999993333','sucesso');
  if public.nucleo_flow_finish_ai(execution,suspension,'5511999993333','sucesso') is distinct from run then raise exception 'callback duplicated'; end if;
  claim:=public.nucleo_flow_claim(execution,(run->>'revision')::bigint);
  if claim#>>'{step,texto}'<>'Concluido' then raise exception 'snapshot changed'; end if;
  run:=public.nucleo_flow_ack(execution,(claim->>'claimToken')::uuid,'padrao');
  run:=pg_temp.advance(run,'');
  if run->>'status'<>'completed' then raise exception 'end missing'; end if;
  raise notice 'B PASS: branch, AI suspension, exact version, callback replay and next message';

  run:=pg_temp.start_run('flow-proof-expired'); execution:=(run->>'executionId')::uuid;
  run:=pg_temp.advance(run); run:=pg_temp.advance(run,'nao'); run:=pg_temp.advance(run); run:=pg_temp.advance(run,'');
  suspension:=(run->>'suspensionId')::uuid;
  perform pg_temp.expect_error(format('select public.nucleo_flow_finish_ai(%L,%L,%L,%L)',execution,suspension,'5511999993333','expired'),'flow suspension not expired');
  update public.chatbot_flow_executions set suspension_expires_at=now()-interval '1 second' where id=execution;
  run:=public.nucleo_flow_finish_ai(execution,suspension,'5511999993333','expired');
  if run->>'cursor'<>'failure' or run->>'reason'<>'ai_timeout' then raise exception 'expiration wrong path'; end if;
  run:=public.nucleo_flow_cancel(execution,'human_takeover');
  perform pg_temp.expect_error(format('select public.nucleo_flow_claim(%L,%s)',execution,run->>'revision'),'flow execution not ready');
  raise notice 'C PASS: expiry uses failure; human cancels continuation';

  run:=pg_temp.start_run('flow-proof-uncertain'); execution:=(run->>'executionId')::uuid;
  run:=pg_temp.advance(run); run:=pg_temp.advance(run,'sim');
  claim:=public.nucleo_flow_claim(execution,(run->>'revision')::bigint);
  update public.chatbot_flow_executions set claim_expires_at=now()-interval '1 second' where id=execution;
  run:=public.nucleo_flow_claim(execution,(claim->>'revision')::bigint);
  if run->>'status'<>'needs_review' then raise exception 'ambiguous message was retried'; end if;
  raise notice 'D PASS: restart with unconfirmed message does not resend';

  perform public.nucleo_flow_cancel(execution,'human_takeover');
  run:=pg_temp.start_run('flow-proof-human-trigger'); execution:=(run->>'executionId')::uuid;
  run:=pg_temp.advance(run); run:=pg_temp.advance(run,'sim'); run:=pg_temp.advance(run); run:=pg_temp.advance(run,'');
  suspension:=(run->>'suspensionId')::uuid;
  insert into public.assistant_profiles(id,organization_id,template_id,audience,display_name,slug,is_default,created_by,updated_by)
    select 'f3000000-0000-4000-8000-000000000008','f3000000-0000-4000-8000-000000000002',id,'customer','Flow proof','flow-proof',false,
      'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001'
    from public.assistant_templates where audience='customer' limit 1;
  insert into public.conversation_intelligence_contexts(organization_id,contact_id,assistant_profile_id,audience,channel,conversation_key_hash,state)
    values('f3000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000004',
      'f3000000-0000-4000-8000-000000000008','customer','whatsapp',repeat('f',64),'handed_off');
  if public.nucleo_flow_state(execution)->>'status'<>'cancelled' then raise exception 'human trigger did not cancel'; end if;
  perform pg_temp.expect_error(format('select public.nucleo_flow_finish_ai(%L,%L,%L,%L)',execution,suspension,'5511999993333','sucesso'),'flow suspension invalid');
  raise notice 'O PASS: database human handoff cancels suspension and rejects late completion';
end $$;

do $$
begin
  perform pg_temp.expect_error('select private.flow_validate_expression(''{"operador":"xor","itens":[{"tipo":"primeira_conversa"}]}''::jsonb)', 'flow condition invalid');
  perform pg_temp.expect_error('select private.flow_validate_expression(''[]''::jsonb)', 'flow condition invalid');
  perform pg_temp.expect_error('select private.flow_validate_expression(''{"tipo":"sem_interacao_ha","dias":-1}''::jsonb)', 'flow condition invalid');
  perform pg_temp.expect_error('select private.flow_validate_expression(''{"tipo":"tem_etiqueta"}''::jsonb)', 'flow condition invalid');
  perform private.flow_validate_expression('{"operador":"e","itens":[{"tipo":"primeira_conversa"},{"operador":"ou","itens":[{"tipo":"tarefa_atrasada"},{"tipo":"sem_interacao_ha","dias":7}]}]}'::jsonb);
  raise notice 'N PASS: malformed conditions rejected; nested AND/OR accepted';
  if has_table_privilege('authenticated','public.chatbot_flow_executions','SELECT')
    or has_function_privilege('anon','public.nucleo_flow_finish_ai(uuid,uuid,text,text)','EXECUTE') then
    raise exception 'direct access exposed';
  end if;
  raise notice 'E PASS: table and anonymous execution denied';
end $$;
rollback;
do $$ begin
  if exists(select 1 from public.chatbot_flow_executions where organization_id='f3000000-0000-4000-8000-000000000002')
    or exists(select 1 from public.organizations where id='f3000000-0000-4000-8000-000000000002') then
    raise exception 'proof fixtures leaked';
  end if;
  raise notice 'F PASS: rollback removed fixtures';
end $$;
