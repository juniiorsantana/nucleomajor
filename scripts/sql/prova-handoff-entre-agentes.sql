-- NUNCA EXECUTAR CONTRA PRODUÇÃO. PostgreSQL 17.9 descartável, cadeia completa.
\set ON_ERROR_STOP on
begin;

create function pg_temp.recusa(comando text, mensagem text) returns void language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if sqlerrm is distinct from mensagem then
      raise exception 'recusa errada: esperado %, recebido %', mensagem, sqlerrm;
    end if;
    return;
  end;
  raise exception 'comando aceito indevidamente: %', mensagem;
end $$;

do $$
declare
  org uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  actor uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  robot uuid := 'aaaaaaaa-0014-4000-8000-00000000fa5e';
  conn uuid := 'cccccccc-0014-4000-8000-00000000fa5e';
  agent_a uuid;
  agent_b uuid := 'bbbbbbbb-0014-4000-8000-00000000fa5e';
  reception uuid := 'dddddddd-0014-4000-8000-00000000fa5e';
  old_skill uuid := 'eeeeeeee-0014-4000-8000-00000000fa5e';
  spec jsonb;
begin
  insert into auth.users(id,email) values(robot,'robot14@example.invalid');
  insert into public.profiles(id,full_name) values(robot,'Robot prova 14') on conflict(id) do nothing;
  insert into public.whatsapp_connections(id,organization_id,name,status) values(conn,org,'Prova 14','connected');
  insert into public.connection_robot_credentials(connection_id,organization_id,auth_user_id,status) values(conn,org,robot,'active');
  perform set_config('request.jwt.claim.sub',robot::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('is_robot',true,'organization_id',org,'connection_id',conn))::text,true);
  select id into strict agent_a from public.assistant_profiles where organization_id=org and audience='customer' and is_default;
  update public.assistant_profiles set slug='major-prova-14', active=true, soul_markdown='Persona Major prova 14' where id=agent_a;
  update public.organization_campaigns set status='archived' where organization_id=org;
  insert into public.assistant_profiles(id,organization_id,template_id,audience,display_name,slug,created_by,updated_by,is_default,active,soul_markdown)
  select agent_b,org,template_id,'customer','SDR prova 14','sdr-prova-14',actor,actor,false,true,'Persona SDR prova 14'
  from public.assistant_profiles where id=agent_a;
  spec := jsonb_build_object('schemaVersion','1.1','objective','Recepção da prova',
    'instructionsMarkdown',repeat('Instrução confiável para receber e transferir ao especialista. ',3),
    'allowedTools',jsonb_build_array('conversation.handoff.agent'),
    'activation',jsonb_build_object('keywords',jsonb_build_array('ola')),
    'routing',jsonb_build_object('fallback',true),
    'workflow',jsonb_build_object('initialStage','acolher','stages',jsonb_build_array(jsonb_build_object('id','acolher','allowedTools',jsonb_build_array('conversation.handoff.agent')))));
  insert into public.skill_definitions(id,owner_type,organization_id,slug,name,audience,status,spec,created_by,updated_by)
  values(reception,'organization',org,'recepcao-prova-14','Recepcao prova 14','customer','published',spec,actor,actor),
        (old_skill,'organization',org,'antiga-prova-14','Antiga prova 14','customer','published',spec || '{"routing":{"fallback":false},"activation":{"keywords":["antiga"]}}',actor,actor);
  update public.assistant_profile_skills set enabled=false where profile_id=agent_a;
  insert into public.assistant_profile_skills(organization_id,profile_id,skill_id,enabled,priority)
  values(org,agent_a,reception,true,1),(org,agent_b,reception,true,1),(org,agent_a,old_skill,true,2);
end $$;

do $$
declare
  org uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ctx uuid;
  before_payload jsonb;
  after_payload jsonb;
  result jsonb;
  audit_metadata jsonb;
  q text := $query$select public.nucleo_customer_agent_handoff(repeat('a',64),'5511999999999','sdr-prova-14','commercial_intent','PRIVATE CLIENT SUMMARY')$query$;
begin
  before_payload := public.nucleo_intelligence_context_resolve_v3(repeat('a',64),'5511999999999','ola');
  ctx := (before_payload->>'contextoId')::uuid;
  if before_payload #>> '{runtimeContext,activeSkill,allowedTools,0}' is distinct from 'conversation.handoff.agent' then
    raise exception 'A: capacidade não atravessou v2/v3';
  end if;
  raise notice 'A PASS: capacidade publicada atravessa v2 e v3';

  update public.conversation_intelligence_contexts set active_skill_id='eeeeeeee-0014-4000-8000-00000000fa5e' where id=ctx;
  update public.conversation_skill_sessions set active_skill_id='eeeeeeee-0014-4000-8000-00000000fa5e',stage='coletar' where context_id=ctx;
  result := public.nucleo_customer_agent_handoff(repeat('a',64),'5511999999999','sdr-prova-14','commercial_intent','PRIVATE CLIENT SUMMARY');
  if not exists(select 1 from public.conversation_intelligence_contexts where id=ctx and assistant_profile_id='bbbbbbbb-0014-4000-8000-00000000fa5e' and active_skill_id is null and agent_handoff_count=1 and state='active') then
    raise exception 'B: fixo, skill, contador ou estado incorretos';
  end if;
  if not exists(select 1 from public.conversation_skill_sessions where context_id=ctx and status='handed_off') then raise exception 'B: sessão aberta'; end if;
  raise notice 'B PASS: destino fixado, skill limpa, sessão fechada, automação ativa';

  select metadata into strict audit_metadata from public.intelligence_audit_log where entity_id=ctx and action='agent_handoff';
  if audit_metadata is distinct from '{"sourceAgentSlug":"major-prova-14","targetAgentSlug":"sdr-prova-14","reason":"commercial_intent","handoffCount":1}'::jsonb
     or result::text like '%PRIVATE%' then raise exception 'C: auditoria ou retorno incorreto'; end if;
  raise notice 'C PASS: auditoria contém somente slugs, motivo e salto; retorno sem resumo';

  after_payload := public.nucleo_intelligence_context_resolve_v3(repeat('a',64),'5511999999999','ola');
  if after_payload #>> '{assistente,id}' is distinct from 'bbbbbbbb-0014-4000-8000-00000000fa5e'
     or after_payload #>> '{assistente,soul}' is distinct from 'Persona SDR prova 14'
     or after_payload #>> '{skillAtivo,id}' is distinct from 'dddddddd-0014-4000-8000-00000000fa5e' then raise exception 'D: destino herdou skill ou persona'; end if;
  -- A sessão muda revisão por turno; o agente muda em ambas as representações.
  if (after_payload - 'assistente' - 'runtimeContext' - 'skillsPermitidos') is distinct from (before_payload - 'assistente' - 'runtimeContext' - 'skillsPermitidos')
     or ((after_payload #> '{runtimeContext}') - 'assistant' - 'workflow') is distinct from ((before_payload #> '{runtimeContext}') - 'assistant' - 'workflow')
     or (select array_agg(key order by key) from jsonb_object_keys(after_payload) key) is distinct from (select array_agg(key order by key) from jsonb_object_keys(before_payload) key)
     or after_payload->>'schemaVersion' <> 'fase-h-3' then
    raise exception 'D: contrato/payload mudou além do agente e revisão de sessão';
  end if;
  if exists(select 1 from jsonb_array_elements(after_payload->'skillsPermitidos') skill where skill->>'id'='eeeeeeee-0014-4000-8000-00000000fa5e') then raise exception 'D: skill não vinculada vazou'; end if;
  raise notice 'D PASS: próximo turno usa destino e sua persona, skill própria; contrato intacto';

  perform pg_temp.recusa(q,'target agent is current agent');
  perform public.nucleo_customer_agent_handoff(repeat('a',64),'5511999999999','major-prova-14','scope_mismatch');
  if not exists(select 1 from public.conversation_intelligence_contexts where id=ctx and agent_handoff_count=2) then raise exception 'E: volta A falhou'; end if;
  perform public.nucleo_customer_agent_handoff(repeat('a',64),'5511999999999','sdr-prova-14','specialist_required');
  perform pg_temp.recusa(replace(q,'sdr-prova-14','major-prova-14'),'agent handoff limit reached; use human handoff');
  if (select agent_handoff_count from public.conversation_intelligence_contexts where id=ctx) <> 3 then raise exception 'E: teto alterado por recusa'; end if;
  raise notice 'E PASS: A-B-A funciona; terceiro permitido, quarto recusado';

  -- Contexto novo para testar cada guarda sem ser bloqueado pelo teto.
  perform public.nucleo_intelligence_context_resolve_v3(repeat('b',64),'5511999999999','ola');
  q := replace(q,'''a''','''b''');
  perform pg_temp.recusa(replace(q,'sdr-prova-14','missing-agent'),'target agent unavailable');
  perform pg_temp.recusa(replace(q,'commercial_intent','requested_human'),'invalid agent handoff reason');
  perform pg_temp.recusa(replace(q,'''commercial_intent''','null'),'invalid agent handoff reason');
  perform pg_temp.recusa(replace(q,'5511999999999','123'),'valid customer phone required');
  perform pg_temp.recusa(replace(q,'PRIVATE CLIENT SUMMARY',repeat('x',1001)),'agent handoff summary too long');
  update public.assistant_profiles set active=false where slug='sdr-prova-14' and organization_id=org;
  perform pg_temp.recusa(q,'target agent inactive');
  update public.assistant_profiles set active=true where slug='sdr-prova-14' and organization_id=org;
  -- Público interno existente, sem alterar campos estruturais protegidos.
  perform pg_temp.recusa(replace(q,'sdr-prova-14',(select slug from public.assistant_profiles where organization_id=org and audience='internal' and is_default)),'target agent audience mismatch');
  -- Um slug só existente em outra organização não pode ser resolvido.
  insert into public.organizations(id,name,slug,created_by) values('ffffffff-0014-4000-8000-00000000fa5e','Outra prova 14','outra-prova-14','aaaaaaaa-0000-4000-8000-00000000fa5e');
  update public.assistant_profiles set slug='outro-tenant-14' where organization_id='ffffffff-0014-4000-8000-00000000fa5e' and audience='customer';
  perform pg_temp.recusa(replace(q,'sdr-prova-14','outro-tenant-14'),'target agent unavailable');
  if exists(select 1 from public.conversation_intelligence_contexts where conversation_key_hash=repeat('b',64) and organization_id=org and agent_handoff_count<>0)
    or exists(select 1 from public.intelligence_audit_log where action='agent_handoff' and entity_id=(select id from public.conversation_intelligence_contexts where organization_id=org and conversation_key_hash=repeat('b',64))) then
    raise exception 'F: recusa escreveu contador ou auditoria';
  end if;
  raise notice 'F PASS: inexistente, inativo, outra audience, outro tenant, self e motivo inválido recusados';

  update public.conversation_intelligence_contexts set state='handed_off' where conversation_key_hash=repeat('b',64) and organization_id=org;
  perform pg_temp.recusa(q,'conversation already handed off to human');
  perform pg_temp.recusa(replace(q,'sdr-prova-14','missing-agent'),'conversation already handed off to human');
  update public.conversation_intelligence_contexts set state='closed' where conversation_key_hash=repeat('b',64) and organization_id=org;
  perform pg_temp.recusa(q,'customer intelligence context required');
  perform pg_temp.recusa(replace(q,'''b''','''c'''),'customer intelligence context required');
  update public.connection_robot_credentials set status='revoked', revoked_at=now() where auth_user_id='aaaaaaaa-0014-4000-8000-00000000fa5e';
  perform pg_temp.recusa(q,'active robot credential required');
  raise notice 'G PASS: humano prevalece; contexto fechado/ausente e robô inativo recusados';
  update public.connection_robot_credentials set status='active', revoked_at=null where auth_user_id='aaaaaaaa-0014-4000-8000-00000000fa5e';
  -- Comparação integral com vínculos equivalentes: só agente e revisão mudam.
  update public.assistant_profile_skills set enabled=false where skill_id='eeeeeeee-0014-4000-8000-00000000fa5e';
  before_payload := public.nucleo_intelligence_context_resolve_v3(repeat('c',64),'5511999999999','ola');
  perform public.nucleo_customer_agent_handoff(repeat('c',64),'5511999999999','sdr-prova-14','commercial_intent');
  after_payload := public.nucleo_intelligence_context_resolve_v3(repeat('c',64),'5511999999999','ola');
  if (before_payload - 'assistente' #- '{runtimeContext,assistant}' #- '{runtimeContext,workflow,revision}') is distinct from
     (after_payload - 'assistente' #- '{runtimeContext,assistant}' #- '{runtimeContext,workflow,revision}') then
    raise exception 'G2: payload com vínculos iguais mudou além de agente e revisão';
  end if;
  raise notice 'G2 PASS: payload integral idêntico fora agente e revisão, com vínculos equivalentes';
end $$;

rollback;
do $$
begin
  if exists(select 1 from public.assistant_profiles where slug in ('sdr-prova-14','major-prova-14','outro-tenant-14'))
    or exists(select 1 from public.skill_definitions where slug in ('recepcao-prova-14','antiga-prova-14'))
    or exists(select 1 from public.conversation_intelligence_contexts where organization_id='aaaaaaaa-0001-4000-8000-00000000fa5e' and conversation_key_hash in(repeat('a',64),repeat('b',64),repeat('c',64)))
    or exists(select 1 from public.intelligence_audit_log where action='agent_handoff')
    or exists(select 1 from auth.users where id='aaaaaaaa-0014-4000-8000-00000000fa5e') then raise exception 'H: fixtures sobreviveram ao rollback'; end if;
  raise notice 'H PASS: nada da prova sobrou após ROLLBACK';
end $$;
