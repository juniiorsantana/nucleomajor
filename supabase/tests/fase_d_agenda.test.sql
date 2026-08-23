-- Testes comportamentais da Agenda Major integrada.
-- Rodar com `supabase test db` quando houver Postgres local; não exige nenhum
-- serviço de WhatsApp e nunca faz envio real.

begin;
select plan(10);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'dona-a@teste.local', now()),
  ('22222222-2222-4222-8222-222222222222', 'membro-a@teste.local', now()),
  ('33333333-3333-4333-8333-333333333333', 'admin-a@teste.local', now()),
  ('44444444-4444-4444-8444-444444444444', 'dona-b@teste.local', now());

insert into public.profiles (id, full_name) values
  ('11111111-1111-4111-8111-111111111111', 'Dona A'),
  ('22222222-2222-4222-8222-222222222222', 'Membro A'),
  ('33333333-3333-4333-8333-333333333333', 'Admin A'),
  ('44444444-4444-4444-8444-444444444444', 'Dona B')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.organizations (id, name, slug, created_by) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Empresa A', 'fase-d-empresa-a', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Empresa B', 'fase-d-empresa-b', '44444444-4444-4444-8444-444444444444');

insert into public.organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'member'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'owner');

insert into public.calendar_events (
  id, organization_id, owner_id, title, description, starts_at, ends_at,
  kind, visibility, category_id, location, tags, created_by, updated_by
) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222',
   'Consulta particular', 'segredo pessoal', '2030-08-21 13:00+00', '2030-08-21 14:00+00', 'appointment', 'personal',
   (select id from public.calendar_categories where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by position limit 1),
   'Local secreto', array['segredo'], '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   'Reunião da empresa', 'pauta pública', '2030-08-21 15:00+00', '2030-08-21 16:00+00', 'event', 'organization',
   (select id from public.calendar_categories where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by position limit 1),
   'Sala 1', '{}', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444',
   'Evento B', 'outro tenant', '2030-08-21 13:00+00', '2030-08-21 14:00+00', 'event', 'organization',
   (select id from public.calendar_categories where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' order by position limit 1),
   '', '{}', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select is_empty(
  $$ select title from public.calendar_events where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'nem owner lê evento pessoal do colega pela tabela base'
);

select results_eq(
  $$ select title from public.calendar_events_list(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2030-08-21 00:00+00', '2030-08-22 00:00+00'
     ) where id = 'a1000000-0000-4000-8000-000000000001' $$,
  $$ values ('Indisponível'::text) $$,
  'RPC revela somente indisponibilidade'
);

select results_eq(
  $$ select description, contact_id, category_id, location, cardinality(tags), cardinality(reminder_minutes)
     from public.calendar_events_list(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2030-08-21 00:00+00', '2030-08-22 00:00+00'
     ) where id = 'a1000000-0000-4000-8000-000000000001' $$,
  $$ values (''::text, null::uuid, null::uuid, ''::text, 0, 0) $$,
  'descrição, contato, categoria, local, tags e lembretes ficam mascarados'
);

select is_empty(
  $$ select 1 from public.calendar_events_list(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2030-08-21 00:00+00', '2030-08-22 00:00+00'
     ) where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  'organização B nunca aparece no contexto A'
);

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

select is_empty(
  $$ update public.calendar_events set title = 'Invasão'
     where id = 'a1000000-0000-4000-8000-000000000002' returning id $$,
  'membro comum não edita evento corporativo'
);

select throws_ok(
  $$ insert into public.calendar_categories (organization_id, name, color, created_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Proibida', '#123456', '22222222-2222-4222-8222-222222222222') $$,
  '42501', null,
  'membro comum não configura categorias'
);

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select results_eq(
  $$ update public.calendar_events set title = 'Reunião atualizada'
     where id = 'a1000000-0000-4000-8000-000000000002' returning title $$,
  $$ values ('Reunião atualizada'::text) $$,
  'admin edita evento corporativo'
);

select lives_ok(
  $$ insert into public.calendar_categories (organization_id, name, color, created_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Visita', '#123456', '33333333-3333-4333-8333-333333333333') $$,
  'admin configura categorias'
);

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.calendar_events (
       organization_id, owner_id, title, starts_at, ends_at, kind, visibility,
       category_id, created_by, updated_by
     ) values (
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'Conflito',
       '2030-08-21 13:30+00', '2030-08-21 14:30+00', 'block', 'personal',
       (select id from public.calendar_categories where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by position limit 1),
       '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'
     ) $$,
  '23P01', null,
  'sobreposição do mesmo profissional é recusada'
);

select throws_ok(
  $$ select * from public.calendar_phone_verifications $$,
  '42501', null,
  'telefone e hash de verificação não têm SELECT direto'
);

select * from finish();
rollback;
