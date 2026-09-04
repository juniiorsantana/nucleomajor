-- A audience deixa de valer por um agente só.
--
-- FASE E de docs/intelligence/MULTI-AGENT-MIGRATION.md, e a última que mexe no
-- modelo de dados antes da API/UI. Ela remove
-- `unique (organization_id, audience)` de `assistant_profiles`.
--
-- Essa unique era, até a FASE D, a única razão pela qual o produto acertava o
-- agente: não havia critério de escolha, havia impossibilidade de erro. A FASE
-- D trocou isso por um critério explícito (`is_default`), e é isso — e só isso
-- — que torna esta remoção segura. Removê-la antes da D era o cenário de
-- regressão silenciosa descrito no início do documento de desenho.
--
-- O que a FASE E NÃO faz, de propósito:
--
-- * não cria nenhum agente;
-- * não constrói Agent Router — escolher entre os N elegíveis por turno é a
--   FASE G. Aqui, quem responde continua sendo o padrão, sempre;
-- * não afrouxa RLS. As três policies de `assistant_profiles` são por
--   organização (`is_org_member` / `can_manage_org`), nunca por audience, e
--   continuam idênticas;
-- * não muda `routing_mode`.
--
-- Consequência que precisa estar escrita: depois desta migration, a policy
-- `assistant_profiles_insert` (`can_manage_org` + `created_by = auth.uid()`)
-- passa a permitir que um gestor crie um segundo agente pela API REST, sem
-- UI. Isso é o modelo de dados sendo liberado antes da tela, que é o objetivo
-- da fase. É seguro porque a coluna `is_default` nasce `false`: um agente
-- criado assim entra como comum e **não** passa a atender ninguém. Promover
-- exige `update` explícito, e o índice parcial rejeita o segundo padrão.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guardas. Fail closed, e antes de qualquer alteração.
-- ---------------------------------------------------------------------------
-- Nenhuma delas corrige dado. Se o banco não estiver no estado que as FASES C
-- e D deixaram, esta migration recusa rodar e não deixa nada pela metade.
do $$
declare
  audiences_sem_default text;
  audiences_com_varios text;
begin
  -- A coluna da FASE C.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and column_name = 'is_default'
  ) then
    raise exception 'FASE E abortada: a coluna is_default (FASE C) nao existe';
  end if;

  -- O índice parcial é o que passa a segurar a unicidade do padrão depois que
  -- a unique antiga cair. Sem ele, o DROP abriria a porta para dois padrões.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and indexname = 'assistant_profiles_one_default_idx'
      and indexdef like '%WHERE is_default%'
  ) then
    raise exception 'FASE E abortada: o indice parcial de agente padrao nao existe';
  end if;

  -- Com N agentes por audience, o slug deixa de ser conveniência e vira a
  -- única identidade estável de um agente dentro da organização.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and indexname = 'assistant_profiles_organization_slug_key'
  ) then
    raise exception 'FASE E abortada: unique (organization_id, slug) nao existe';
  end if;

  -- A FASE D tem de estar semanticamente presente, não só aplicada de nome:
  -- os três pontos de resolução implícita precisam pedir o padrão.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%profile.is_default%'
  ) then
    raise exception 'FASE E abortada: intelligence_payload nao seleciona por is_default (FASE D ausente)';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access'
      and p.prosrc like '%profile.is_default%'
  ) then
    raise exception 'FASE E abortada: nucleo_customer_assistant_access nao seleciona por is_default (FASE D ausente)';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_intelligence_context_resolve_v2'
      and p.prosrc like '%profile.is_default%'
  ) then
    raise exception 'FASE E abortada: resolve_v2 nao seleciona por is_default (FASE D ausente)';
  end if;

  -- E a ordem da FASE D: a seleção do agente não pode voltar a filtrar
  -- `active` junto, senão um padrão parado passaria a vez para outro agente —
  -- que é exatamente o que fica possível a partir desta migration.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%and profile.audience = target_audience and profile.active%'
  ) then
    raise exception 'FASE E abortada: intelligence_payload filtra active dentro da selecao do agente';
  end if;

  -- Dois padrões na mesma audience já deveria ser impossível pelo índice
  -- parcial. Conferimos assim mesmo: é barato, e é a invariável inteira.
  select string_agg(format('%s/%s', organization_id, audience), ', ')
  into audiences_com_varios
  from (
    select organization_id, audience
    from public.assistant_profiles
    where is_default
    group by organization_id, audience
    having count(*) > 1
  ) duplicados;
  if audiences_com_varios is not null then
    raise exception 'FASE E abortada: mais de um agente padrao em %', audiences_com_varios;
  end if;

  -- Toda audience que já existe precisa ter EXATAMENTE um padrão. O banco vai
  -- passar a garantir "no máximo um"; "pelo menos um" não vira trigger nesta
  -- fase (o resolvedor já falha fechado sem padrão). Mas deixar produção
  -- entrar no multi-agent com uma audience órfã seria escolher, em silêncio,
  -- que aquele público para de ser atendido. Recusamos, e quem for corrigir
  -- corrige olhando.
  select string_agg(format('%s/%s', organization_id, audience), ', ')
  into audiences_sem_default
  from (
    select organization_id, audience
    from public.assistant_profiles
    group by organization_id, audience
    having count(*) filter (where is_default) = 0
  ) orfaos;
  if audiences_sem_default is not null then
    raise exception 'FASE E abortada: audience sem agente padrao em %', audiences_sem_default;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/4. private.provision_intelligence deixa de depender da unique antiga.
-- ---------------------------------------------------------------------------
-- Esta é a dívida que a FASE C registrou e a D repetiu: os dois
-- `on conflict (organization_id, audience)` apontam para o índice que o passo
-- 3 remove. Sem esta redefinição, criar organização passaria a falhar —
-- `there is no unique or exclusion constraint matching the ON CONFLICT
-- specification`. Por isso ela vem ANTES do DROP, na mesma transação.
--
-- Duas mudanças, e as duas importam:
--
-- 1. **O conflito passa a ser inferido pelo índice parcial.**
--    `on conflict (organization_id, audience) where is_default` casa com
--    `assistant_profiles_one_default_idx`. A linha inserida tem
--    `is_default = true`, então satisfaz o predicado e o árbitro é elegível.
--    Continua atômico — não vira "consulta e depois insere", que teria janela
--    de corrida.
--
-- 2. **Os dois `select id into` passam a pedir o padrão.** Esse é o bug mais
--    silencioso do arquivo antigo e não estava registrado em lugar nenhum:
--    `select id into internal_profile ... where audience = 'internal'` sem
--    `strict` pega a PRIMEIRA linha e descarta o resto sem erro. Com um agente
--    por audience era exato; com N, escolhe por sorteio a quem amarrar as
--    skills iniciais. É o mesmo defeito que a FASE D tirou dos resolvedores.
--
-- O que ela continua NÃO fazendo, e é o pedido da fase: agentes não-padrão não
-- são tocados, não são promovidos e não são apagados. O `do nothing` cuida do
-- caso "já existe padrão"; o `where is_default` da leitura cuida de não
-- confundir um agente comum com ele.
create or replace function private.provision_intelligence(target_organization uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal_profile uuid;
  customer_profile uuid;
begin
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, created_by, updated_by, is_default
  ) values (
    target_organization, '10000000-0000-0000-0000-000000000001', 'internal',
    'Assistente interno', actor, actor, true
  ) on conflict (organization_id, audience) where is_default do nothing;
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, created_by, updated_by, is_default
  ) values (
    target_organization, '10000000-0000-0000-0000-000000000002', 'customer',
    'Assistente da empresa', actor, actor, true
  ) on conflict (organization_id, audience) where is_default do nothing;

  select id into internal_profile from public.assistant_profiles
  where organization_id = target_organization and audience = 'internal' and is_default;
  select id into customer_profile from public.assistant_profiles
  where organization_id = target_organization and audience = 'customer' and is_default;

  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values (target_organization, internal_profile, '20000000-0000-0000-0000-000000000001', 10, actor)
  on conflict (profile_id, skill_id) do nothing;
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000003', 10, actor),
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000002', 20, actor),
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000004', 30, actor),
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000001', 40, actor)
  on conflict (profile_id, skill_id) do nothing;

  insert into public.knowledge_collections (
    organization_id, name, slug, description, scope_type, audience, created_by, updated_by
  ) values
    (target_organization, 'Conhecimento interno', 'conhecimento-interno',
     'Regras e referências disponíveis somente para a equipe.', 'organization', 'internal', actor, actor),
    (target_organization, 'Conhecimento para clientes', 'conhecimento-clientes',
     'Conteúdo publicado explicitamente para atendimento externo.', 'organization', 'external', actor, actor)
  on conflict (organization_id, slug) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/4. A remoção. Uma constraint, nomeada, e nada além dela.
-- ---------------------------------------------------------------------------
alter table public.assistant_profiles
  drop constraint assistant_profiles_organization_id_audience_key;

-- ---------------------------------------------------------------------------
-- 4/4. Prova do que a fase promete e do que ela não pode ter levado junto.
-- ---------------------------------------------------------------------------
do $$
declare
  faltando text;
begin
  -- A unique antiga saiu.
  if exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'assistant_profiles' and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(c.conkey) as k(attnum)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['audience', 'organization_id']
  ) then
    raise exception 'FASE E falhou: unique (organization_id, audience) ainda existe';
  end if;

  -- E nada mais saiu junto. Estes são os que seguram a integridade a partir
  -- de agora; conferidos por nome, um a um.
  select string_agg(esperado, ', ') into faltando
  from unnest(array[
    'assistant_profiles_pkey',
    'assistant_profiles_one_default_idx',
    'assistant_profiles_organization_slug_key',
    'assistant_profiles_id_organization_id_key'
  ]) esperado
  where not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'assistant_profiles' and indexname = esperado
  );
  if faltando is not null then
    raise exception 'FASE E falhou: indice(s) perdido(s): %', faltando;
  end if;

  -- As 5 checks e as 4 FKs da tabela continuam onde estavam.
  if (select count(*) from pg_constraint
      where conrelid = 'public.assistant_profiles'::regclass and contype = 'c') <> 5 then
    raise exception 'FASE E falhou: o numero de CHECKs de assistant_profiles mudou';
  end if;
  if (select count(*) from pg_constraint
      where conrelid = 'public.assistant_profiles'::regclass and contype = 'f') <> 4 then
    raise exception 'FASE E falhou: o numero de FKs de assistant_profiles mudou';
  end if;

  -- RLS continua ligada, com as mesmas três policies, e nenhuma delas passou a
  -- depender de audience.
  if not (select relrowsecurity from pg_class where oid = 'public.assistant_profiles'::regclass) then
    raise exception 'FASE E falhou: RLS foi desligada em assistant_profiles';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'assistant_profiles') <> 3 then
    raise exception 'FASE E falhou: o numero de policies de assistant_profiles mudou';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%audience%'
  ) then
    raise exception 'FASE E falhou: alguma policy passou a depender de audience';
  end if;

  -- Os três gatilhos (auditoria, slug, updated_at) continuam armados.
  if (select count(*) from pg_trigger t
      where t.tgrelid = 'public.assistant_profiles'::regclass and not t.tgisinternal) <> 3 then
    raise exception 'FASE E falhou: o numero de gatilhos de assistant_profiles mudou';
  end if;

  -- provision_intelligence não pode ter ficado presa à unique removida.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'provision_intelligence'
      and p.prosrc like '%on conflict (organization_id, audience) do nothing%'
  ) then
    raise exception 'FASE E falhou: provision_intelligence ainda infere a unique removida';
  end if;

  -- E a FASE E não pode ter inventado Agent Router: quem responde continua
  -- sendo o padrão, e nenhum resolvedor ganhou critério de escolha novo.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%profile.is_default%'
  ) then
    raise exception 'FASE E falhou: intelligence_payload deixou de pedir o padrao';
  end if;
end $$;

commit;
