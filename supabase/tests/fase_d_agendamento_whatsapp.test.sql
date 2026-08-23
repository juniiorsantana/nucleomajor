-- Teste comportamental da escrita estreita do agente do WhatsApp.
-- Rodar com `supabase test db` após aplicar as migrations.

begin;
select plan(9);

insert into auth.users (id, email, email_confirmed_at) values
  ('51000000-0000-4000-8000-000000000001', 'owner-booking@teste.local', now()),
  ('51000000-0000-4000-8000-000000000002', 'agent-booking@teste.local', now()),
  ('51000000-0000-4000-8000-000000000003', 'robot-booking@teste.local', now()),
  ('51000000-0000-4000-8000-000000000004', 'outsider-booking@teste.local', now());

insert into public.profiles (id, full_name) values
  ('51000000-0000-4000-8000-000000000001', 'Owner Booking'),
  ('51000000-0000-4000-8000-000000000002', 'Agent Booking'),
  ('51000000-0000-4000-8000-000000000004', 'Outsider Booking');

insert into public.organizations (id, name, slug, created_by) values
  ('52000000-0000-4000-8000-000000000001', 'Empresa Booking', 'empresa-booking', '51000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002', 'Outra Empresa', 'outra-empresa-booking', '51000000-0000-4000-8000-000000000004');

insert into public.organization_members (organization_id, user_id, role) values
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'owner'),
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'member'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000004', 'owner');

insert into public.whatsapp_connections (
  id, organization_id, name, status, automation_status, created_by, updated_by
) values (
  '53000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  'WhatsApp Booking', 'connected', 'active',
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001'
);

insert into public.connection_robot_credentials (
  connection_id, organization_id, auth_user_id, status, created_by
) values (
  '53000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000003',
  'active',
  '51000000-0000-4000-8000-000000000001'
);

insert into public.contacts (id, organization_id, name, phone, created_by, updated_by)
values (
  '54000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  'Cliente WhatsApp', '+55 (11) 99999-9999',
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"is_robot":true,"organization_id":"52000000-0000-4000-8000-000000000001","connection_id":"53000000-0000-4000-8000-000000000001"}}',
  true
);

select results_eq(
  $$ select (public.nucleo_calendar_booking_create(
       '51000000-0000-4000-8000-000000000002', repeat('a', 64), repeat('b', 64),
       '+5511999999999', 'Avaliação inicial', '',
       date_trunc('day', now()) + interval '30 days 15 hours',
       date_trunc('day', now()) + interval '30 days 16 hours',
       '', array[30], true
     ) ->> 'criado')::boolean $$,
  $$ values (true) $$,
  'robô cria compromisso confirmado na agenda atribuída'
);

select results_eq(
  $$ select organization_id, owner_id, kind, visibility, contact_id
     from public.calendar_events
     where title = 'Avaliação inicial' $$,
  $$ values (
       '52000000-0000-4000-8000-000000000001'::uuid,
       '51000000-0000-4000-8000-000000000002'::uuid,
       'appointment'::text,
       'organization'::text,
       '54000000-0000-4000-8000-000000000001'::uuid
     ) $$,
  'organização, profissional, visibilidade e contato são derivados corretamente'
);

select results_eq(
  $$ select (public.nucleo_calendar_booking_create(
       '51000000-0000-4000-8000-000000000002', repeat('a', 64), repeat('b', 64),
       '+5511999999999', 'Avaliação inicial', '',
       date_trunc('day', now()) + interval '30 days 15 hours',
       date_trunc('day', now()) + interval '30 days 16 hours',
       '', array[30], true
     ) ->> 'jaExistia')::boolean $$,
  $$ values (true) $$,
  'repetir a mesma chave é idempotente'
);

select results_eq(
  $$ select count(*)::bigint from public.calendar_events where title = 'Avaliação inicial' $$,
  $$ values (1::bigint) $$,
  'idempotência não duplica o evento'
);

select results_eq(
  $$ select (public.nucleo_calendar_booking_create(
       '51000000-0000-4000-8000-000000000002', repeat('f', 64), repeat('b', 64),
       '+5511999999999', 'Avaliação inicial', '',
       date_trunc('day', now()) + interval '30 days 15 hours',
       date_trunc('day', now()) + interval '30 days 16 hours',
       '', array[30], true
     ) ->> 'jaExistia')::boolean $$,
  $$ values (true) $$,
  'o mesmo conteúdo em outro turno também não duplica'
);

select results_eq(
  $$ select (public.nucleo_calendar_booking_create(
       '51000000-0000-4000-8000-000000000002', repeat('c', 64), repeat('b', 64),
       '+5511999999999', 'Outro atendimento', '',
       date_trunc('day', now()) + interval '30 days 15 hours 30 minutes',
       date_trunc('day', now()) + interval '30 days 16 hours 30 minutes',
       '', array[30], true
     ) ->> 'conflito')::boolean $$,
  $$ values (true) $$,
  'horário ocupado retorna conflito sem criar'
);

select throws_ok(
  $$ select public.nucleo_calendar_booking_create(
       '51000000-0000-4000-8000-000000000002', repeat('d', 64), repeat('b', 64),
       '+5511999999999', 'Sem confirmação', '',
       date_trunc('day', now()) + interval '31 days 15 hours',
       date_trunc('day', now()) + interval '31 days 16 hours',
       '', array[30], false
     ) $$,
  'P0001', 'customer confirmation is required before creating a booking',
  'sem confirmação explícita o banco recusa'
);

select throws_ok(
  $$ select public.nucleo_calendar_booking_create(
       '51000000-0000-4000-8000-000000000004', repeat('e', 64), repeat('b', 64),
       '+5511999999999', 'Outro tenant', '',
       date_trunc('day', now()) + interval '31 days 15 hours',
       date_trunc('day', now()) + interval '31 days 16 hours',
       '', array[30], true
     ) $$,
  'P0001', 'selected agent is not an active member of this organization',
  'robô não agenda para profissional de outra organização'
);

select throws_ok(
  $$ insert into public.calendar_events (
       organization_id, owner_id, title, starts_at, ends_at, kind, visibility,
       category_id, created_by, updated_by
     ) values (
       '52000000-0000-4000-8000-000000000001',
       '51000000-0000-4000-8000-000000000002', 'Bypass',
       date_trunc('day', now()) + interval '32 days 15 hours',
       date_trunc('day', now()) + interval '32 days 16 hours',
       'appointment', 'organization',
       (select id from public.calendar_categories where organization_id = '52000000-0000-4000-8000-000000000001' order by position limit 1),
       '51000000-0000-4000-8000-000000000002',
       '51000000-0000-4000-8000-000000000002'
     ) $$,
  '42501', null,
  'credencial do robô continua sem insert direto'
);

select * from finish();
rollback;
