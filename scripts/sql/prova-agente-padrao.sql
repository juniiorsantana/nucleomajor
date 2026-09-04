-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Prova COMPORTAMENTAL das regras da FASE C (agente padrão explícito).
--
-- NUNCA rode isto em produção. O script insere perfis de mentira para provar
-- que as constraints rejeitam o que devem rejeitar. O bloco principal termina
-- em ROLLBACK, mas mesmo assim: gatilhos de auditoria disparam, sequências
-- avançam, e um erro de digitação num `commit` transformaria um teste em dado
-- sujo. Use um Postgres descartável.
--
-- Os testes de test/agent-default-migration.test.mjs provam que a migration
-- DECLARA as regras certas. Este script prova que o Postgres as APLICA.
--
-- Sequência completa, num Postgres descartável:
--   1. migrations até a FASE B (20260904160000) inclusive
--   2. scripts/sql/prova-agente-padrao-seed.sql        <-- fixtures, COMMIT
--   3. migration da FASE C (20260904190000)
--   4. este arquivo
--
-- Três correções em relação à versão anterior desta prova, que valem registro
-- porque são a diferença entre provar e parecer provar:
--
-- 1. **Toda rejeição confere QUAL constraint disparou**, via
--    `get stacked diagnostics ... constraint_name`. A versão anterior
--    capturava `unique_violation` genérico. Como a unique antiga
--    `(organization_id, audience)` e a unicidade de slug barram o mesmo
--    insert, o teste de slug podia passar tendo sido rejeitado pela
--    constraint errada — um verde que não provava nada sobre slug.
--
-- 2. **O item do `default false` é exercitado por insert**, não lido de
--    `information_schema.columns.column_default`. Ler o default declarado
--    prova que a coluna foi declarada; não prova o que uma linha nova recebe.
--
-- 3. **As linhas usadas são as do seed, de identificador fixo (`...fa5e`)**,
--    e não as primeiras que aparecerem na tabela: a versão anterior escolhia
--    por `limit 1` sem `order by`, então podia inspecionar linhas que não
--    eram dela — e, num banco com mais de uma organização, provar sobre dados
--    que ela não controlava.

\set ON_ERROR_STOP on

-- ===========================================================================
-- A: o backfill transformou o perfil pré-C em is_default = true.
-- ===========================================================================
-- Fora de transação de propósito: esta é a única garantia que depende de a
-- linha ter nascido ANTES da migration e sobrevivido a ela. Por isso o seed
-- é um arquivo separado que commita.
do $$
declare
  total integer;
  padroes integer;
begin
  select count(*), count(*) filter (where is_default)
    into total, padroes
  from public.assistant_profiles
  where organization_id = 'aaaaaaaa-0001-4000-8000-00000000fa5e';

  if total = 0 then
    raise exception 'A: FALHOU — o seed nao esta neste banco; rode prova-agente-padrao-seed.sql ANTES da FASE C';
  end if;
  if padroes <> total then
    raise exception 'A: FALHOU — % de % perfis pre-C ficaram sem is_default apos o backfill', total - padroes, total;
  end if;
  raise notice 'A: PASS — os % perfis que existiam antes da FASE C viraram is_default = true', total;
end $$;

-- ===========================================================================
-- Retrato do estado, para o item J conferir o ROLLBACK depois.
-- ===========================================================================
drop table if exists public.prova_fase_c_retrato;
create table public.prova_fase_c_retrato as
select id, organization_id, audience, display_name, slug, is_default, active
from public.assistant_profiles;

-- ===========================================================================
-- B a I, tudo dentro de uma transação que será desfeita.
-- ===========================================================================
begin;

do $$
declare
  org constant uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  org_nova constant uuid := 'aaaaaaaa-0002-4000-8000-00000000fa5e';
  ator constant uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  modelo_customer constant uuid := '10000000-0000-0000-0000-000000000002';
  constraint_que_barrou text;
  slug_gerado text;
  padrao_customer uuid;
  novo uuid;
  quantos integer;
  ainda_padrao boolean;
begin

  -- -------------------------------------------------------------------
  -- H: a UNIQUE antiga ainda impede um segundo agente de customer.
  -- -------------------------------------------------------------------
  -- Precisa vir primeiro, enquanto a constraint ainda está de pé.
  begin
    insert into public.assistant_profiles
      (organization_id, template_id, audience, display_name, created_by, updated_by)
    values (org, modelo_customer, 'customer', 'Segundo agente de cliente', ator, ator);
    raise exception 'H: FALHOU — a unique (organization_id, audience) deixou criar um segundo agente de customer';
  exception when unique_violation then
    get stacked diagnostics constraint_que_barrou = constraint_name;
    if constraint_que_barrou is distinct from 'assistant_profiles_organization_id_audience_key' then
      raise exception 'H: FALHOU — rejeitado pela constraint errada (%); esperava a unique antiga', constraint_que_barrou;
    end if;
    raise notice 'H: PASS — dois agentes da mesma audience continuam impossiveis (%)', constraint_que_barrou;
  end;

  -- -------------------------------------------------------------------
  -- I: provision_intelligence cria os dois iniciais com is_default = true.
  -- -------------------------------------------------------------------
  -- Exercita o caminho real de criação de organização: o gatilho
  -- organizations_provision_intelligence dispara no insert abaixo. É o ponto
  -- mais caro de errar da FASE C, porque a falha só apareceria quando um
  -- cliente novo entrasse.
  --
  -- Precisa rodar ANTES do `drop constraint` logo abaixo, e não depois: os
  -- dois `on conflict (organization_id, audience)` de provision_intelligence
  -- dependem daquela unique para existir um índice correspondente. Sem ela, a
  -- função falha com "no unique or exclusion constraint matching the ON
  -- CONFLICT specification" — que é uma falha do teste, não da migration. A
  -- própria FASE C deixa esse aviso escrito para a FASE E.
  insert into public.organizations (id, name, slug, created_by)
  values (org_nova, 'Organizacao nova da prova', 'organizacao-nova-da-prova', ator);

  select count(*) into quantos
  from public.assistant_profiles where organization_id = org_nova;
  if quantos <> 2 then
    raise exception 'I: FALHOU — provision_intelligence criou % perfis em vez de 2', quantos;
  end if;

  select count(*) into quantos
  from public.assistant_profiles where organization_id = org_nova and is_default;
  if quantos <> 2 then
    raise exception 'I: FALHOU — organizacao nova nasceu com % agentes padrao em vez de 2', quantos;
  end if;
  raise notice 'I: PASS — organizacao nova nasce com customer e internal, ambos is_default = true';

  -- -------------------------------------------------------------------
  -- A partir daqui, soltamos a unique antiga DENTRO da transação.
  -- -------------------------------------------------------------------
  -- É o único jeito de exercitar o índice parcial e a unicidade de slug de
  -- forma isolada — com a unique antiga de pé, ela barra tudo antes. É também
  -- um ensaio do que a FASE E vai fazer de verdade. Some no ROLLBACK, e o
  -- item J confere que sumiu mesmo.
  alter table public.assistant_profiles
    drop constraint assistant_profiles_organization_id_audience_key;

  -- -------------------------------------------------------------------
  -- B: agente novo, sem is_default informado, nasce false.
  -- -------------------------------------------------------------------
  insert into public.assistant_profiles
    (organization_id, template_id, audience, display_name, created_by, updated_by)
  values (org, modelo_customer, 'customer', 'Agente B', ator, ator)
  returning id, is_default, slug into novo, ainda_padrao, slug_gerado;

  if ainda_padrao then
    raise exception 'B: FALHOU — agente novo nasceu is_default = true';
  end if;
  raise notice 'B: PASS — agente novo nasce is_default = false';

  -- -------------------------------------------------------------------
  -- GATILHO DE SLUG: o insert acima não informou slug.
  -- -------------------------------------------------------------------
  -- Prova comportamental do gatilho da FASE B, que só dá para fazer com
  -- banco: insert legado sem slug -> gatilho preenche -> NOT NULL satisfeito.
  if slug_gerado is null or btrim(slug_gerado) = '' then
    raise exception 'SLUG: FALHOU — insert sem slug nao foi preenchido pelo gatilho';
  end if;
  if slug_gerado is distinct from private.agent_slug('Agente B', 'customer') then
    raise exception 'SLUG: FALHOU — gatilho gravou % e a regra canonica diz %',
      slug_gerado, private.agent_slug('Agente B', 'customer');
  end if;
  raise notice 'SLUG: PASS — insert legado sem slug foi preenchido pelo gatilho como % e satisfez o NOT NULL', slug_gerado;

  -- -------------------------------------------------------------------
  -- F: mesmo display_name é permitido quando o slug difere.
  -- -------------------------------------------------------------------
  insert into public.assistant_profiles
    (organization_id, template_id, audience, display_name, slug, created_by, updated_by)
  values (org, modelo_customer, 'customer', 'Agente B', 'agente-b-segundo', ator, ator);

  select count(*) into quantos
  from public.assistant_profiles
  where organization_id = org and display_name = 'Agente B';
  if quantos <> 2 then
    raise exception 'F: FALHOU — esperava 2 perfis com o mesmo display_name e encontrei %', quantos;
  end if;
  raise notice 'F: PASS — display_name duplicado convive quando o slug difere';

  -- -------------------------------------------------------------------
  -- E: (organization_id, slug) repetido é rejeitado.
  -- -------------------------------------------------------------------
  begin
    insert into public.assistant_profiles
      (organization_id, template_id, audience, display_name, slug, created_by, updated_by)
    values (org, modelo_customer, 'customer', 'Colisao de slug', slug_gerado, ator, ator);
    raise exception 'E: FALHOU — dois perfis da mesma organizacao aceitaram o mesmo slug';
  exception when unique_violation then
    get stacked diagnostics constraint_que_barrou = constraint_name;
    if constraint_que_barrou is distinct from 'assistant_profiles_organization_slug_key' then
      raise exception 'E: FALHOU — rejeitado por % em vez da unicidade de slug', constraint_que_barrou;
    end if;
    raise notice 'E: PASS — slug repetido na mesma organizacao e rejeitado (%)', constraint_que_barrou;
  end;

  -- -------------------------------------------------------------------
  -- C: dois padrões na mesma organização + audience são rejeitados.
  -- -------------------------------------------------------------------
  begin
    update public.assistant_profiles set is_default = true where id = novo;
    raise exception 'C: FALHOU — o indice parcial deixou existir dois agentes padrao na mesma audience';
  exception when unique_violation then
    get stacked diagnostics constraint_que_barrou = constraint_name;
    if constraint_que_barrou is distinct from 'assistant_profiles_one_default_idx' then
      raise exception 'C: FALHOU — rejeitado por % em vez do indice parcial de padrao', constraint_que_barrou;
    end if;
    raise notice 'C: PASS — so um agente padrao por organizacao + audience (%)', constraint_que_barrou;
  end;

  -- -------------------------------------------------------------------
  -- D: padrão de customer e padrão de internal coexistem.
  -- -------------------------------------------------------------------
  select count(*) into quantos
  from public.assistant_profiles
  where organization_id = org and is_default;
  if quantos <> 2 then
    raise exception 'D: FALHOU — esperava exatamente 2 padroes na organizacao e encontrei %', quantos;
  end if;
  if (
    select count(distinct audience) from public.assistant_profiles
    where organization_id = org and is_default
  ) <> 2 then
    raise exception 'D: FALHOU — os 2 padroes nao sao de audiences diferentes';
  end if;
  raise notice 'D: PASS — padrao de customer e padrao de internal convivem';

  -- -------------------------------------------------------------------
  -- G: um agente padrão pode ficar inactive e continuar padrão.
  -- -------------------------------------------------------------------
  -- is_default é identidade de fallback; active é elegibilidade operacional.
  -- A FASE C promete que as duas são ortogonais e que NÃO há constraint
  -- amarrando uma na outra.
  select id into padrao_customer
  from public.assistant_profiles
  where organization_id = org and audience = 'customer' and is_default;

  update public.assistant_profiles set active = false where id = padrao_customer;

  select is_default into ainda_padrao
  from public.assistant_profiles where id = padrao_customer;
  if not ainda_padrao then
    raise exception 'G: FALHOU — desativar o agente tirou o is_default dele';
  end if;

  select count(*) into quantos
  from public.assistant_profiles where organization_id = org and is_default;
  if quantos <> 2 then
    raise exception 'G: FALHOU — desativar o padrao mudou a contagem de padroes para %', quantos;
  end if;
  raise notice 'G: PASS — agente padrao desativado continua sendo o padrao';

  raise notice '--- B a I passaram; desfazendo tudo ---';
end $$;

rollback;

-- ===========================================================================
-- J: o ROLLBACK devolveu o banco ao estado anterior à prova.
-- ===========================================================================
-- Não basta ter escrito `rollback`: o item J exige comparar o retrato tirado
-- antes com o estado de agora. Inclui a constraint derrubada dentro da
-- transação — se ela não tiver voltado, o ROLLBACK não desfez tudo.
do $$
declare
  faltando integer;
  sobrando integer;
begin
  select count(*) into faltando from (
    select id, organization_id, audience, display_name, slug, is_default, active
      from public.prova_fase_c_retrato
    except
    select id, organization_id, audience, display_name, slug, is_default, active
      from public.assistant_profiles
  ) diferenca;

  select count(*) into sobrando from (
    select id, organization_id, audience, display_name, slug, is_default, active
      from public.assistant_profiles
    except
    select id, organization_id, audience, display_name, slug, is_default, active
      from public.prova_fase_c_retrato
  ) diferenca;

  if faltando <> 0 or sobrando <> 0 then
    raise exception 'J: FALHOU — apos o ROLLBACK faltam % linha(s) e sobram % linha(s)', faltando, sobrando;
  end if;

  if exists (select 1 from public.organizations where id = 'aaaaaaaa-0002-4000-8000-00000000fa5e') then
    raise exception 'J: FALHOU — a organizacao criada no item I sobreviveu ao ROLLBACK';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_organization_id_audience_key'
  ) then
    raise exception 'J: FALHOU — a unique antiga nao voltou depois do ROLLBACK';
  end if;

  raise notice 'J: PASS — o ROLLBACK devolveu perfis, organizacoes e constraints ao estado anterior';
end $$;

drop table public.prova_fase_c_retrato;
