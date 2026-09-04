-- ============================================================================
-- APENAS TESTE. NUNCA EXECUTAR CONTRA PRODUÇÃO NEM CONTRA QUALQUER BANCO
-- LIGADO (Supabase real, réplica, staging com dados de verdade).
-- ============================================================================
--
-- Shim mínimo do Supabase para rodar as migrations do repositório num
-- PostgreSQL cru (userspace, descartável). Só existe para viabilizar a prova
-- comportamental de scripts/sql/prova-agente-padrao-seed.sql e
-- scripts/sql/prova-agente-padrao.sql — ver docs/intelligence/MULTI-AGENT-MIGRATION.md,
-- FASE C (20260904190000_agente_padrao_explicito.sql).
--
-- ----------------------------------------------------------------------------
-- O QUE ESTE ARQUIVO NÃO É
-- ----------------------------------------------------------------------------
-- Não é uma reprodução do Supabase. Não simula GoTrue (emissão/validação de
-- JWT), PostgREST, Realtime nem Storage de verdade — só cria os objetos que
-- as migrations do repositório referenciam, para o DDL delas compilar num
-- Postgres que não é o Supabase.
--
-- Não reproduz nem mocka nenhuma regra da FASE B ou da FASE C. `is_default`,
-- o índice parcial `assistant_profiles_one_default_idx`, a UNIQUE de slug e o
-- gatilho `assistant_profiles_fill_slug` vêm inteiramente das migrations
-- reais do repositório, aplicadas por cima deste harness. A semântica que
-- A–J prova é a das migrations, não deste arquivo — este arquivo só monta o
-- alicerce onde elas conseguem rodar. Em particular, `private.provision_intelligence`
-- roda exatamente como redefinida pela migration da FASE C; nada aqui a
-- reescreve ou substitui.
--
-- Não contém credencial nenhuma. `auth.users` aqui é uma tabela vazia com
-- três colunas; quem povoa é o script de seed, com um e-mail obviamente
-- fictício (`prova-fase-c@exemplo.invalido`).
--
-- ----------------------------------------------------------------------------
-- FIDELIDADE: o que fica de fora e por que não compromete a prova
-- ----------------------------------------------------------------------------
-- - `auth.uid()` aqui lê um GUC de sessão (`request.jwt.claim.sub`), não um
--   JWT real. A prova A–J roda como superusuário e não exercita RLS —
--   nenhuma das garantias da FASE C (backfill, índice parcial, unicidade de
--   slug, gatilho de slug, provision_intelligence) depende de RLS.
-- - Os papéis (`anon`, `authenticated`, `service_role`) existem só para as
--   migrations que fazem `grant ... to authenticated` não falharem por papel
--   inexistente; não carregam os GRANTs finos que o Supabase real aplica.
-- - `storage.objects`/`buckets`/`foldername` são o suficiente para o DDL de
--   `avatars_*` policies compilar; não há upload real nem enforcement de
--   bucket.
--
-- ----------------------------------------------------------------------------
-- SEQUÊNCIA DE USO (num Postgres 17.6 userspace descartável, sem TCP)
-- ----------------------------------------------------------------------------
--   1. criar cluster descartável (initdb + pg_ctl start, listen_addresses='',
--      só socket unix)
--   2. aplicar este harness
--   3. aplicar as migrations do repositório até a FASE B
--      (20260904160000_identidade_do_agente_em_assistant_profiles.sql)
--      inclusive
--   4. executar scripts/sql/prova-agente-padrao-seed.sql
--      (fixtures em estado PRÉ-C — precisa existir ANTES da FASE C para o
--      item A da prova poder atravessar o backfill)
--   5. aplicar a migration da FASE C
--      (20260904190000_agente_padrao_explicito.sql)
--   6. executar scripts/sql/prova-agente-padrao.sql
--   7. destruir o cluster (pg_ctl stop; apagar o diretório de dados inteiro)
--
-- Detalhe de portabilidade que custou uma iteração: normalizar CRLF
-- (`tr -d '\r'`) nos arquivos antes de aplicar — eles saem do Windows.

-- ---------------------------------------------------------------------------
-- Papéis.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Schemas.
-- ---------------------------------------------------------------------------
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create schema if not exists realtime;

-- ---------------------------------------------------------------------------
-- Extensões, no schema em que as migrations esperam encontrá-las.
-- ---------------------------------------------------------------------------
-- As migrations chamam `extensions.digest`, `extensions.gen_random_bytes` e
-- `extensions.gen_random_uuid`, mas declaram `create extension if not exists
-- pgcrypto` sem schema. Instalando aqui em `extensions` primeiro, aquele
-- comando vira no-op e as chamadas qualificadas resolvem.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- `extensions` precisa estar no search_path para os operadores do btree_gist
-- serem achados pelas constraints de exclusão da agenda.
do $$
begin
  execute format('alter database %I set search_path = public, extensions', current_database());
end $$;

-- ---------------------------------------------------------------------------
-- auth: só o que as migrations tocam.
-- ---------------------------------------------------------------------------
-- Colunas usadas pelo repositório: id, email, raw_user_meta_data.
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- auth.uid() lê um GUC em vez de um JWT. Com o GUC vazio devolve NULL, que é
-- o mesmo que o Supabase devolve para requisição sem sessão.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

create or replace function auth.jwt()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- storage: só o que as migrations tocam.
-- ---------------------------------------------------------------------------
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select string_to_array(name, '/');
$$;
