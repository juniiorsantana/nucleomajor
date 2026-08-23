-- Testes de `accept_organization_invite` depois do hotfix
-- `20260819180000_convite_vinculado_ao_email.sql`.
--
-- Rodar com `supabase test db` (exige Docker e `supabase start`).
--
-- O teste que dá nome ao arquivo é o quarto: **outra pessoa, com um código
-- perfeitamente válido, é recusada.** Antes do hotfix ele passava — o convite
-- era um portador puro.

begin;
select plan(9);

-- ------------------------------------------------------------------ cenário

-- Três contas: quem convida, quem foi convidada, e uma terceira que vai tentar
-- usar o código alheio. A terceira é o ponto do arquivo.
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'dona@empresa.com',     now()),
  ('22222222-2222-4222-8222-222222222222', 'convidada@empresa.com', now()),
  ('33333333-3333-4333-8333-333333333333', 'terceira@empresa.com',  now()),
  ('44444444-4444-4444-8444-444444444444', 'naoconfirmada@empresa.com', null);

-- `handle_new_user` cria os profiles; se o gatilho não existir no ambiente de
-- teste, esta inserção garante o mesmo estado.
insert into public.profiles (id, full_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- A dona cria a organização e convida `convidada@empresa.com`.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.create_organization('Empresa de Teste') $$,
  'a dona cria a organização'
);

create temporary table convite_emitido as
select * from public.create_organization_invite(
  (select id from public.organizations where slug like 'empresa-de-teste%' limit 1),
  'convidada@empresa.com',
  'member'
);

select isnt(
  (select invite_token from convite_emitido), null,
  'o convite devolve o código uma vez'
);

-- ------------------------------------------------- o que precisa ser negado

-- 1. Outra pessoa, com o código válido em mãos.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select throws_ok(
  format($$ select public.accept_organization_invite(%L) $$,
         (select invite_token from convite_emitido)),
  'invite issued for a different email',
  'ESTE: uma terceira pessoa com código válido é recusada'
);

select is_empty(
  $$ select 1 from public.organization_members
     where user_id = '33333333-3333-4333-8333-333333333333' $$,
  'e a terceira pessoa não virou membro de nada'
);

-- 2. Conta com o e-mail certo, porém não confirmado.
--    Sem esta guarda, a de cima é quase cosmética: bastaria cadastrar-se com o
--    e-mail alheio para aceitar o convite dele.
update auth.users set email = 'convidada@empresa.com'
where id = '44444444-4444-4444-8444-444444444444';

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

select throws_ok(
  format($$ select public.accept_organization_invite(%L) $$,
         (select invite_token from convite_emitido)),
  'a confirmed email is required to accept an invite',
  'e-mail não confirmado é recusado, mesmo sendo o e-mail do convite'
);

update auth.users set email = 'naoconfirmada@empresa.com'
where id = '44444444-4444-4444-8444-444444444444';

-- 3. Código que não existe continua indistinguível de código vencido.
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

select throws_ok(
  $$ select public.accept_organization_invite('codigo-que-nunca-existiu') $$,
  'invite invalid or expired',
  'código inexistente não revela se já existiu'
);

-- ------------------------------------------------- o que precisa continuar

-- 4. A pessoa certa entra.
select lives_ok(
  format($$ select public.accept_organization_invite(%L) $$,
         (select invite_token from convite_emitido)),
  'quem foi convidada entra'
);

select is(
  (select role::text from public.organization_members
   where user_id = '22222222-2222-4222-8222-222222222222'),
  'member',
  'e entra com o papel do convite'
);

-- 5. O mesmo código não serve duas vezes.
select throws_ok(
  format($$ select public.accept_organization_invite(%L) $$,
         (select invite_token from convite_emitido)),
  'invite invalid or expired',
  'o código já aceito não serve de novo'
);

select * from finish();
rollback;
