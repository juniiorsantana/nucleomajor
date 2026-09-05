-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Alinha o banco descartável com os GRANTs REAIS de produção nas tabelas de
-- agente, antes de qualquer prova de fronteira de escrita.
--
-- Por que isto existe como arquivo à parte, e não dentro da prova: a prova de
-- fronteira roda duas vezes, antes e depois do hardening. Se ela mesma
-- concedesse privilégios no seu setup, a segunda rodada reabriria, dentro da
-- própria transação, exatamente o que a migration acabou de fechar — e o
-- resultado seria "a fronteira continua aberta", medindo o teste em vez do
-- produto. Aconteceu, e é por isso que está escrito aqui.
--
-- O estado que replicamos é o de produção, conferido read-only em 05/09/2026:
--
--   assistant_profiles       -> authenticated=arwdDxtm/postgres
--   assistant_profile_skills -> authenticated=arwdDxtm/postgres
--
-- `arwdDxtm` = INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN. As migrations do repositório concedem apenas
-- `select, insert, update` (20260823120000); o `ALL` vem do Supabase, aplicado
-- por fora sobre o schema `public`. É o conjunto dos dois que vale em
-- produção, e é o conjunto dos dois que o hardening precisa enfrentar.

grant all on public.assistant_profiles to authenticated;
grant all on public.assistant_profile_skills to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
  ) then
    raise exception 'fixture invalida: o baseline de producao nao foi aplicado';
  end if;
  raise notice 'baseline ok: authenticated com privilegio de tabela inteira, como em producao';
end $$;
