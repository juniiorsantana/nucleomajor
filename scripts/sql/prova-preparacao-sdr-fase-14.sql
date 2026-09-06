-- SOMENTE POSTGRES DESCARTÁVEL. IDs reais identificam a configuração sob teste,
-- mas todas as linhas abaixo são fixtures locais, sem dados de produção.
\set ON_ERROR_STOP on
begin;
do $$
declare
  org uuid := '338e44ca-36ab-437c-b8ac-aa7c60fee64a';
  actor uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  robot uuid := 'aaaaaaaa-0024-4000-8000-00000000fa5e';
  conn uuid := 'cccccccc-0024-4000-8000-00000000fa5e';
  skill_slug text;
begin
  insert into public.organizations(id,name,slug,created_by)
  values(org,'Organização sintética da prova SDR','prova-sdr-fase-14',actor);
  insert into public.assistant_profiles(id,organization_id,template_id,audience,display_name,slug,created_by,updated_by,active,is_default)
  select '85ef7c76-e439-4a4d-9ff2-8b3109a650de',org,template_id,'customer','SDR','sdr',actor,actor,true,false
  from public.assistant_profiles where organization_id=org and audience='customer' and is_default;
  foreach skill_slug in array array['recepcao','vendas'] loop
    insert into public.skill_definitions(owner_type,slug,name,audience,status,spec)
    values('platform',skill_slug,skill_slug,'customer','published',jsonb_build_object(
      'objective','Prova do vínculo ao SDR',
      'instructionsMarkdown',repeat('Instruções sintéticas para validar o atendimento pelo SDR. ',3),
      'allowedTools','[]'::jsonb,
      'routing',jsonb_build_object('fallback',skill_slug='recepcao'),
      'activation',jsonb_build_object('keywords',jsonb_build_array(case when skill_slug='recepcao' then 'ola' else 'plano' end)),
      'workflow',jsonb_build_object('initialStage','acolher','stages',jsonb_build_array(jsonb_build_object('id','acolher','allowedTools','[]'::jsonb)))
    )) on conflict(slug) where owner_type='platform' do update set status='published',spec=excluded.spec;
  end loop;
  insert into auth.users(id,email) values(robot,'robot-sdr-proof@example.invalid');
  insert into public.whatsapp_connections(id,organization_id,name,status) values(conn,org,'Conexão sintética SDR','connected');
  insert into public.connection_robot_credentials(connection_id,organization_id,auth_user_id,status) values(conn,org,robot,'active');
  perform set_config('request.jwt.claim.sub',robot::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('is_robot',true,'organization_id',org,'connection_id',conn))::text,true);
end $$;

-- O arquivo exato entregue para aplicação, duas vezes: repetir é seguro.
\ir preparar-sdr-fase-14.sql
\ir preparar-sdr-fase-14.sql

do $$
declare
  org uuid := '338e44ca-36ab-437c-b8ac-aa7c60fee64a';
  target uuid := '85ef7c76-e439-4a4d-9ff2-8b3109a650de';
  result jsonb;
begin
  if (select count(*) from public.assistant_profile_skills where profile_id=target and enabled) <> 2 then
    raise exception 'vínculos incorretos após repetição';
  end if;
  perform private.intelligence_payload(org,'customer','whatsapp',repeat('d',64),'ola','{}',true);
  update public.conversation_intelligence_contexts set assistant_profile_id=target
  where organization_id=org and conversation_key_hash=repeat('d',64);
  result := public.nucleo_intelligence_context_resolve_v3(repeat('d',64),'5511999999999','ola');
  if result #>> '{assistente,id}' is distinct from target::text or result #>> '{skillAtivo,slug}' is distinct from 'recepcao' then
    raise exception 'SDR não resolveu Recepção';
  end if;
  result := public.nucleo_intelligence_context_resolve_v3(repeat('d',64),'5511999999999','quero fechar plano');
  if result #>> '{assistente,id}' is distinct from target::text or result #>> '{skillAtivo,slug}' is distinct from 'vendas' then
    raise exception 'SDR não resolveu Vendas';
  end if;
  raise notice 'SDR PASS: script idempotente, recepção e vendas resolvidas no destino';
end $$;
rollback;
do $$
begin
  if exists(select 1 from public.organizations where id='338e44ca-36ab-437c-b8ac-aa7c60fee64a') then
    raise exception 'fixture SDR sobreviveu ao rollback';
  end if;
  raise notice 'SDR PASS: rollback sem resíduos';
end $$;
