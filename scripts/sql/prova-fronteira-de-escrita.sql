-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- A fronteira de escrita dos agentes, exercitada como o PostgREST a exercita.
--
-- ETAPA 11B. O domínio JS (`agent-management.mjs`) garante que
-- `organization_id`, `audience` e `is_default` não são editáveis e que agente
-- nasce comum. Mas o domínio roda no NAVEGADOR: quem falar direto com o
-- PostgREST não passa por ele. Quem tem de garantir isso é o banco.
--
-- Roda duas vezes, o mesmo arquivo:
--   `-v modo=antes`   antes da migration de hardening
--   `-v modo=depois`  depois dela
--
-- TRÊS CUIDADOS METODOLÓGICOS, cada um por um erro que a primeira versão
-- desta prova cometeu e que a tornaria pior do que não ter prova nenhuma:
--
-- 1. **"Executou" não é "conseguiu".** Um `update ... where organization_id =
--    <org alheia>` não levanta erro: a RLS simplesmente não casa linha
--    nenhuma, e o comando termina com sucesso tendo mudado nada. Contar isso
--    como bypass seria alarme falso. Cada tentativa mede `row_count` e o
--    veredito é sobre EFEITO, não sobre ausência de exceção.
--
-- 2. **Cada tentativa é isolada.** Sem isso os testes contaminam uns aos
--    outros — na primeira versão, trocar o `id` do agente num item fez um item
--    seguinte falhar por FK, e a falha parecia proteção. Cada comando roda num
--    bloco próprio que é sempre desfeito.
--
-- 3. **Os GRANTs têm de ser os de produção.** As migrations do repositório
--    concedem `select, insert, update`; o Supabase concede `ALL` por cima, e
--    é o conjunto que vale (`authenticated=arwdDxtm` em produção, conferido
--    read-only). O harness não reproduz isso sozinho, então o setup replica.

\set ON_ERROR_STOP on

-- `psql -v modo=antes` (padrão) ou `-v modo=depois`.
\if :{?modo}
\else
  \set modo antes
\endif

begin;
select set_config('prova.modo', :'modo', true);

-- ===========================================================================
-- SETUP (superusuário): duas organizações, dois donos, e o elenco.
-- ===========================================================================
insert into auth.users (id, email) values
  ('eeeeeeee-000a-4000-8000-00000000fa5e', 'dona-a@exemplo.invalido'),
  ('eeeeeeee-000b-4000-8000-00000000fa5e', 'dona-b@exemplo.invalido')
on conflict (id) do nothing;

insert into public.profiles (id, full_name) values
  ('eeeeeeee-000a-4000-8000-00000000fa5e', 'Dona da Org A'),
  ('eeeeeeee-000b-4000-8000-00000000fa5e', 'Dona da Org B')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug, created_by) values
  ('eeeeeeee-0a00-4000-8000-00000000fa5e', 'Org A da fronteira', 'org-a-da-fronteira', 'eeeeeeee-000a-4000-8000-00000000fa5e'),
  ('eeeeeeee-0b00-4000-8000-00000000fa5e', 'Org B da fronteira', 'org-b-da-fronteira', 'eeeeeeee-000b-4000-8000-00000000fa5e');

insert into public.organization_members (organization_id, user_id, role, status, responsibility) values
  ('eeeeeeee-0a00-4000-8000-00000000fa5e', 'eeeeeeee-000a-4000-8000-00000000fa5e', 'owner', 'active', 'Prova'),
  ('eeeeeeee-0b00-4000-8000-00000000fa5e', 'eeeeeeee-000b-4000-8000-00000000fa5e', 'owner', 'active', 'Prova')
on conflict (organization_id, user_id) do update set role = 'owner', status = 'active';

-- Um agente comum na Org A, além dos dois do provisionamento; e o id do
-- agente padrão de clientes da Org B, alvo das tentativas cross-org.
insert into public.assistant_profiles (
  id, organization_id, template_id, audience, display_name, slug,
  created_by, updated_by, is_default, active
) values (
  'ffffffff-0001-4000-8000-00000000fa5e', 'eeeeeeee-0a00-4000-8000-00000000fa5e',
  '10000000-0000-0000-0000-000000000002', 'customer', 'Closer da fronteira',
  'closer-da-fronteira', 'eeeeeeee-000a-4000-8000-00000000fa5e',
  'eeeeeeee-000a-4000-8000-00000000fa5e', false, true
);

-- Cuidado 3: esta prova NÃO concede privilégio nenhum. O baseline de produção
-- vem de `scripts/sql/grants-de-producao-dos-agentes.sql`, aplicado UMA vez
-- antes da primeira rodada. Conceder aqui faria a rodada `depois` reabrir,
-- dentro da própria transação, o que a migration acabou de fechar — e o
-- veredito mediria o teste, não o produto.
do $$
begin
  if current_setting('prova.modo', true) is distinct from 'depois'
     and not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'PROVA INVALIDA: rode grants-de-producao-dos-agentes.sql antes da rodada `antes`';
  end if;
end $$;

create temporary table resultado (
  item text primary key,
  efeito boolean not null,
  detalhe text
) on commit drop;
grant select, insert on resultado to authenticated;

-- Cuidados 1 e 2: mede o efeito real e desfaz sempre.
create or replace function pg_temp.tentar(rotulo text, comando text)
returns void language plpgsql as $$
declare
  afetadas integer := 0;
begin
  begin
    execute comando;
    get diagnostics afetadas = row_count;
    -- Força o desfazimento deste bloco levando o número junto na mensagem.
    raise exception 'DESFAZER %', afetadas using errcode = 'P0001';
  exception
    when others then
      if sqlstate = 'P0001' and sqlerrm like 'DESFAZER %' then
        -- Caminho normal: o comando rodou, e este bloco desfez o que ele fez.
        afetadas := substring(sqlerrm from 10)::integer;
        insert into resultado (item, efeito, detalhe)
        values (rotulo, afetadas > 0, 'linhas afetadas: ' || afetadas);
      else
        -- O comando foi recusado — por privilégio, RLS ou constraint.
        insert into resultado (item, efeito, detalhe) values (rotulo, false, sqlerrm);
      end if;
  end;
end $$;

-- ===========================================================================
-- Passa a ser a dona da Org A, autenticada — igual ao PostgREST.
-- ===========================================================================
select set_config('request.jwt.claim.sub', 'eeeeeeee-000a-4000-8000-00000000fa5e', true);
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;

-- --- Estruturais: nada disto pode ter efeito -------------------------------

select pg_temp.tentar('A_update_is_default', $cmd$
  update public.assistant_profiles set is_default = false
  where organization_id = 'eeeeeeee-0a00-4000-8000-00000000fa5e'
    and audience = 'customer' and is_default
$cmd$);

select pg_temp.tentar('B_update_audience', $cmd$
  update public.assistant_profiles set audience = 'internal'
  where id = 'ffffffff-0001-4000-8000-00000000fa5e'
$cmd$);

select pg_temp.tentar('C_update_organization_id', $cmd$
  update public.assistant_profiles set organization_id = 'eeeeeeee-0b00-4000-8000-00000000fa5e'
  where id = 'ffffffff-0001-4000-8000-00000000fa5e'
$cmd$);

select pg_temp.tentar('C2_update_id', $cmd$
  update public.assistant_profiles set id = 'ffffffff-0009-4000-8000-00000000fa5e'
  where id = 'ffffffff-0001-4000-8000-00000000fa5e'
$cmd$);

-- Nasce padrão. A audience `customer` da Org A já tem padrão, então o índice
-- parcial pegaria e mascararia o privilégio; usamos `internal` da Org A
-- rebaixando o padrão dela no MESMO comando não é possível, então medimos o
-- privilégio pelo caminho que o índice não cobre: uma audience sem padrão.
select pg_temp.tentar('D_insert_is_default_true', $cmd$
  with rebaixa as (
    update public.assistant_profiles set is_default = false
    where organization_id = 'eeeeeeee-0a00-4000-8000-00000000fa5e'
      and audience = 'customer' and is_default
    returning 1
  )
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, slug,
    created_by, updated_by, is_default
  )
  select 'eeeeeeee-0a00-4000-8000-00000000fa5e', '10000000-0000-0000-0000-000000000002',
         'customer', 'Intruso padrao', 'intruso-padrao',
         'eeeeeeee-000a-4000-8000-00000000fa5e', 'eeeeeeee-000a-4000-8000-00000000fa5e', true
  from rebaixa
$cmd$);

select pg_temp.tentar('E_insert_outra_org', $cmd$
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, slug,
    created_by, updated_by
  ) values (
    'eeeeeeee-0b00-4000-8000-00000000fa5e', '10000000-0000-0000-0000-000000000002',
    'customer', 'Invasor', 'invasor',
    'eeeeeeee-000a-4000-8000-00000000fa5e', 'eeeeeeee-000a-4000-8000-00000000fa5e'
  )
$cmd$);

select pg_temp.tentar('F_update_outra_org', $cmd$
  update public.assistant_profiles set display_name = 'Sequestrado'
  where organization_id = 'eeeeeeee-0b00-4000-8000-00000000fa5e'
$cmd$);

select pg_temp.tentar('I1_delete_agente', $cmd$
  delete from public.assistant_profiles where id = 'ffffffff-0001-4000-8000-00000000fa5e'
$cmd$);

select pg_temp.tentar('I2_truncate_agentes', $cmd$
  truncate public.assistant_profiles cascade
$cmd$);

-- Skills cross-org. `H1` referencia o agente da Org B pelo id literal: usar
-- um SELECT o esconderia atrás da RLS de leitura e o teste passaria sem
-- provar nada sobre a ESCRITA.
select pg_temp.tentar('H1_skill_agente_de_outra_org', $cmd$
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  select 'eeeeeeee-0a00-4000-8000-00000000fa5e', 'ffffffff-000b-4000-8000-00000000fa5e',
         '20000000-0000-0000-0000-000000000002', 10, 'eeeeeeee-000a-4000-8000-00000000fa5e'
$cmd$);

select pg_temp.tentar('H2_skill_declarando_org_alheia', $cmd$
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values ('eeeeeeee-0b00-4000-8000-00000000fa5e', 'ffffffff-0001-4000-8000-00000000fa5e',
          '20000000-0000-0000-0000-000000000002', 10, 'eeeeeeee-000a-4000-8000-00000000fa5e')
$cmd$);

-- --- Legítimos: nada disto pode parar de funcionar -------------------------

select pg_temp.tentar('G1_update_nome_tom_soul', $cmd$
  update public.assistant_profiles
  set display_name = 'Closer renomeado', tone = 'direto', soul_markdown = '# Persona',
      role = 'vendas', slug = 'closer-renomeado',
      updated_by = 'eeeeeeee-000a-4000-8000-00000000fa5e'
  where id = 'ffffffff-0001-4000-8000-00000000fa5e'
$cmd$);

select pg_temp.tentar('G2_update_active', $cmd$
  update public.assistant_profiles set active = false
  where id = 'ffffffff-0001-4000-8000-00000000fa5e'
$cmd$);

-- Desativar o PADRÃO também é legítimo (item 10 da etapa).
select pg_temp.tentar('G2b_desativar_o_padrao', $cmd$
  update public.assistant_profiles set active = false
  where organization_id = 'eeeeeeee-0a00-4000-8000-00000000fa5e'
    and audience = 'customer' and is_default
$cmd$);

select pg_temp.tentar('G3_update_brand_process', $cmd$
  update public.assistant_profiles
  set brand_config = '{"brandName":"X"}'::jsonb, process_config = '{"instructions":"y"}'::jsonb
  where id = 'ffffffff-0001-4000-8000-00000000fa5e'
$cmd$);

select pg_temp.tentar('G4_insert_agente_comum', $cmd$
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, slug,
    created_by, updated_by
  ) values (
    'eeeeeeee-0a00-4000-8000-00000000fa5e', '10000000-0000-0000-0000-000000000002',
    'customer', 'Agente legitimo', 'agente-legitimo',
    'eeeeeeee-000a-4000-8000-00000000fa5e', 'eeeeeeee-000a-4000-8000-00000000fa5e'
  )
$cmd$);

select pg_temp.tentar('H3_skill_legitima', $cmd$
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values ('eeeeeeee-0a00-4000-8000-00000000fa5e', 'ffffffff-0001-4000-8000-00000000fa5e',
          '20000000-0000-0000-0000-000000000002', 10, 'eeeeeeee-000a-4000-8000-00000000fa5e')
$cmd$);

reset role;

-- ===========================================================================
-- Veredito.
-- ===========================================================================
select item,
       case when efeito then 'TEVE EFEITO' else 'sem efeito' end as resultado,
       left(coalesce(detalhe, ''), 80) as detalhe
from resultado order by item;

do $$
declare
  modo text := current_setting('prova.modo', true);
  estruturais text[] := array[
    'A_update_is_default', 'B_update_audience', 'C_update_organization_id',
    'C2_update_id', 'D_insert_is_default_true', 'E_insert_outra_org',
    'F_update_outra_org', 'I1_delete_agente', 'I2_truncate_agentes',
    'H1_skill_agente_de_outra_org', 'H2_skill_declarando_org_alheia'
  ];
  legitimos text[] := array[
    'G1_update_nome_tom_soul', 'G2_update_active', 'G2b_desativar_o_padrao',
    'G3_update_brand_process', 'G4_insert_agente_comum', 'H3_skill_legitima'
  ];
  vazou text;
  quebrou text;
  faltando integer;
begin
  select count(*) into faltando
  from unnest(estruturais || legitimos) esperado
  where not exists (select 1 from resultado where item = esperado);
  if faltando > 0 then
    raise exception 'PROVA INVALIDA: % tentativas nao foram registradas', faltando;
  end if;

  -- Um hardening que fecha o produto junto com o buraco não é hardening, é
  -- indisponibilidade. Isto vale nos DOIS modos.
  select string_agg(item || ' -> ' || left(coalesce(detalhe,''), 60), '; ')
  into quebrou from resultado where item = any(legitimos) and not efeito;
  if quebrou is not null then
    raise exception 'ESCRITA LEGITIMA QUEBRADA: %', quebrou;
  end if;
  raise notice 'LEGITIMAS ok (6/6): criar agente comum, editar nome/slug/tom/soul/role, ligar-desligar (inclusive o padrao), brand/process e amarrar skill da propria org';

  select string_agg(item, ', ') into vazou
  from resultado where item = any(estruturais) and efeito;

  if modo = 'depois' then
    if vazou is not null then
      raise exception 'FRONTEIRA AINDA ABERTA em: %', vazou;
    end if;
    raise notice 'DEPOIS ok (11/11): nenhum caminho estrutural teve efeito';
  else
    raise notice 'ANTES: caminhos com efeito real hoje -> %', coalesce(vazou, '(nenhum)');
  end if;
end $$;

rollback;
