-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Fixtures da prova comportamental da FASE C — rodar ANTES da migration.
--
-- NUNCA rode isto em produção. Só existe para banco descartável.
--
-- Por que um script separado, e por que ele faz COMMIT: o item A da prova
-- ("o backfill transforma perfil existente em is_default = true") é a única
-- garantia da FASE C que NÃO pode ser provada depois do fato. Ela exige que
-- exista uma linha nascida no estado pré-C, que sobreviva à aplicação da
-- migration e possa ser inspecionada do outro lado. Uma transação que termina
-- em ROLLBACK não atravessa um `alter table`; então este arquivo commita de
-- propósito, e é justamente por isso que ele é proibido em produção.
--
-- Sequência completa da prova, num Postgres descartável:
--   1. migrations até a FASE B (20260904160000) inclusive
--   2. este arquivo                                    <-- fixtures, COMMIT
--   3. migration da FASE C (20260904190000)
--   4. scripts/sql/prova-agente-padrao.sql             <-- provas A–J
--
-- Identificadores fixos e obviamente falsos (`...fa5e`) para o script de
-- prova reencontrá-los sem depender de `limit 1` numa tabela que ele não
-- controla — que é como a versão anterior desta prova escolhia suas linhas, e
-- o motivo de ela poder passar examinando dados que não eram os dela.

-- ---------------------------------------------------------------------------
-- Identidade mínima: auth.users -> public.profiles -> organizations.
-- ---------------------------------------------------------------------------
-- `public.profiles.id` referencia `auth.users(id)`, então não há como criar
-- organização sem um usuário. Numa preview branch do Supabase o schema `auth`
-- já existe; num Postgres cru ele precisa ter sido criado por shim antes.
insert into auth.users (id, email)
values ('aaaaaaaa-0000-4000-8000-00000000fa5e', 'prova-fase-c@exemplo.invalido')
on conflict (id) do nothing;

insert into public.profiles (id, full_name)
values ('aaaaaaaa-0000-4000-8000-00000000fa5e', 'Ator da prova FASE C')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A organização da prova.
-- ---------------------------------------------------------------------------
-- O gatilho `organizations_provision_intelligence` dispara aqui e cria os dois
-- perfis (internal e customer) pela versão PRÉ-C de
-- `private.provision_intelligence` — isto é, sem `is_default`, que nem existe
-- ainda. É exatamente o estado que o backfill da FASE C precisa encontrar.
insert into public.organizations (id, name, slug, created_by)
values (
  'aaaaaaaa-0001-4000-8000-00000000fa5e',
  'Organização da prova FASE C',
  'organizacao-da-prova-fase-c',
  'aaaaaaaa-0000-4000-8000-00000000fa5e'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Confere que o estado semeado é mesmo o estado PRÉ-C.
-- ---------------------------------------------------------------------------
-- Se este bloco falhar, o seed rodou no momento errado e a prova inteira
-- perderia o sentido: o item A estaria observando uma linha que já nasceu
-- depois da FASE C, e passaria sem provar nada.
do $$
declare
  perfis integer;
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.assistant_profiles'::regclass
      and attname = 'is_default' and not attisdropped
  ) then
    raise exception 'SEED INVALIDO: is_default ja existe, ou seja a FASE C ja foi aplicada. O item A precisa de linhas nascidas antes dela.';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.assistant_profiles'::regclass
      and attname = 'slug' and not attisdropped
  ) then
    raise exception 'SEED INVALIDO: coluna slug ausente, ou seja a FASE B ainda nao foi aplicada.';
  end if;

  select count(*) into perfis
  from public.assistant_profiles
  where organization_id = 'aaaaaaaa-0001-4000-8000-00000000fa5e';

  if perfis <> 2 then
    raise exception 'SEED INVALIDO: esperava 2 perfis provisionados pelo gatilho e encontrei %', perfis;
  end if;

  raise notice 'seed ok: organizacao da prova criada com % perfis, em estado pre-FASE C', perfis;
end $$;
