-- Teste pgTAP do portal de convites. Executar em um banco Supabase de teste
-- com as migrations aplicadas, por exemplo: supabase test db.
begin;
select plan(6);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'dona@portal.test', now()),
  ('22222222-2222-4222-8222-222222222222', 'membro@portal.test', now()),
  ('33333333-3333-4333-8333-333333333333', 'convidada@portal.test', now()),
  ('44444444-4444-4444-8444-444444444444', 'cancelada@portal.test', now()),
  ('55555555-5555-4555-8555-555555555555', 'expirada@portal.test', now());

insert into public.profiles (id, full_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

create temporary table org_a as
select public.create_organization('Portal A') as id;
create temporary table org_b as
select public.create_organization('Portal B') as id;

insert into public.organization_members (organization_id, user_id, role)
select id, '22222222-2222-4222-8222-222222222222', 'member'
from org_a;

select throws_ok(
  format($$select public.create_organization_invite(%L, 'membro@portal.test', 'admin')$$,
    (select id from org_a)),
  'invite target is already a member of this organization',
  'não permite convite para membro já existente'
);

-- Simula um convite antigo já gravado para garantir que o aceite não faz
-- upsert e não troca o papel da associação existente.
insert into public.organization_invites (
  organization_id, email, role, token_hash, invited_by
)
select id, 'membro@portal.test', 'admin',
  encode(extensions.digest('token-de-membro', 'sha256'), 'hex'),
  '11111111-1111-4111-8111-111111111111'
from org_a;

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select throws_ok(
  $$select public.accept_organization_invite('token-de-membro')$$,
  'invite target is already a member of this organization',
  'aceite não altera cargo de membro existente'
);

-- A mesma conta pode pertencer a outra organização sem reutilizar a associação
-- da primeira.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
create temporary table convite_b as
select * from public.create_organization_invite(
  (select id from org_b), 'convidada@portal.test', 'member'
);
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select lives_ok(
  format($$select public.accept_organization_invite(%L)$$,
    (select invite_token from convite_b)),
  'usuário pode aceitar convite de outra organização'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
create temporary table convite_cancelado as
select * from public.create_organization_invite(
  (select id from org_a), 'cancelada@portal.test', 'member'
);
select public.revoke_organization_invite(
  (select id from org_a), (select invite_id from convite_cancelado)
);
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select throws_ok(
  format($$select public.accept_organization_invite(%L)$$,
    (select invite_token from convite_cancelado)),
  'invite invalid or expired',
  'convite cancelado é recusado'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
create temporary table convite_expirado as
select * from public.create_organization_invite(
  (select id from org_a), 'expirada@portal.test', 'member'
);
update public.organization_invites
set expires_at = now() - interval '1 minute'
where id = (select invite_id from convite_expirado);
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select throws_ok(
  format($$select public.accept_organization_invite(%L)$$,
    (select invite_token from convite_expirado)),
  'invite invalid or expired',
  'convite expirado é recusado'
);

select is(
  (select count(*)::integer from public.organization_members
   where user_id = '33333333-3333-4333-8333-333333333333'),
  1,
  'aceite multi-organização cria uma associação'
);

select * from finish();
rollback;
