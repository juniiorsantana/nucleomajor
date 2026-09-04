-- O agente padrão deixa de ser consequência da constraint e vira uma coluna.
--
-- FASE C de docs/intelligence/MULTI-AGENT-MIGRATION.md. Hoje "qual agente
-- responde" não é uma escolha: `unique (organization_id, audience)` garante
-- uma linha só, então a única linha É o padrão. O adapter do domínio deriva
-- exatamente assim (`isDefault: true`, fixo). Essa derivação morre no
-- instante em que a unique cair — e é por isso que esta fase precisa vir
-- ANTES da FASE E, nunca depois: sem uma coluna dizendo quem é o padrão, os
-- cinco pontos de resolução automática do sistema passariam a sortear agente
-- em silêncio (o levantamento está no documento).
--
-- O que `is_default` significa: "este é o agente de fallback desta audience
-- dentro da organização". Nada além disso. Não é escolha do Agent Router
-- (que não existe), não é obrigatoriedade para toda conversa, não é
-- prioridade comercial e não é permissão.
--
-- Quatro decisões:
--
-- 1. **`default false`, com backfill explícito.** Se a coluna nascesse
--    `default true`, todo agente criado depois da FASE F nasceria padrão —
--    e o segundo deles quebraria contra o índice parcial, transformando uma
--    regra de negócio numa falha de insert aparentemente aleatória. Nascer
--    `false` é o comportamento correto: um agente novo é só mais um agente
--    até alguém promovê-lo.
--
-- 2. **No máximo um padrão, nunca "pelo menos um".** O índice parcial impede
--    dois padrões por (organização, audience). Ele NÃO obriga que exista um.
--    Essa segunda invariante é da aplicação e da FASE D — resolver por
--    eleição automática em gatilho tornaria o banco responsável por uma
--    decisão de produto, e tornaria impossível despromover alguém sem que o
--    banco escolhesse um substituto sozinho.
--
-- 3. **`is_default` é ortogonal a `active`.** `is_default` é identidade de
--    fallback; `active` é elegibilidade operacional. As duas podem divergir:
--    um agente padrão desativado continua sendo o padrão, e o resolvedor deve
--    recusar com "sem padrão ativo" em vez de escolher outro por conta
--    própria. Isto não é regra nova: é exatamente o que o sistema já faz
--    hoje — `private.intelligence_payload` filtra `and profile.active` e, não
--    achando, levanta `assistant profile is inactive or unavailable`; e
--    `nucleo_customer_assistant_access` devolve `reason: 'profile_inactive'`.
--    Nenhum dos dois cai para outro perfil. A coluna nova só dá nome ao que
--    já era verdade, e por isso NÃO existe constraint amarrando as duas.
--
-- 4. **`unique (organization_id, slug)` entra agora.** A FASE B mediu: zero
--    colisões em produção. Slug é identidade técnica do agente dentro da
--    organização, independente de audience — dois agentes podem se chamar
--    "Emília" (`display_name` não é único, e continua não sendo), mas não
--    podem responder pelo mesmo identificador técnico. `knowledge_collections`
--    já usa `unique (organization_id, slug)` neste mesmo banco: é a forma que
--    o projeto já adota para identidade técnica por organização.
--
-- O que NÃO muda: `unique (organization_id, audience)` continua de pé, então
-- continua impossível ter dois agentes da mesma audience. Nenhum resolvedor é
-- tocado — `private.intelligence_payload`, `resolve_v2`, `resolve_v3` e
-- `nucleo_customer_assistant_access` seguem dependendo da unique antiga, e
-- passar a usar `is_default` é a FASE D, inteira.

-- ---------------------------------------------------------------------------
-- A coluna.
-- ---------------------------------------------------------------------------
alter table public.assistant_profiles
  add column if not exists is_default boolean not null default false;

comment on column public.assistant_profiles.is_default is
  'Agente padrão/fallback desta audience na organização. Ortogonal a active: um padrão desativado continua sendo o padrão, e cabe ao resolvedor recusar com "sem padrão ativo" em vez de escolher outro. Não é seleção de Agent Router, não é prioridade comercial e não concede permissão. No máximo um por (organization_id, audience), garantido por índice parcial.';

-- ---------------------------------------------------------------------------
-- Backfill: a premissa precisa ser verificada, não suposta.
-- ---------------------------------------------------------------------------
-- Todo perfil de hoje é o padrão da sua audience — mas isso só é verdade
-- porque a unique antiga garante uma linha por (organização, audience). Se
-- essa premissa não valer no banco em que esta migration rodar, marcar todo
-- mundo como padrão seria errado e silencioso. Então: confere antes.
do $$
begin
  if exists (
    select 1
    from public.assistant_profiles
    group by organization_id, audience
    having count(*) > 1
  ) then
    raise exception 'ha mais de um perfil por (organization_id, audience); o backfill nao pode assumir que todo perfil e o padrao da sua audience';
  end if;
end $$;

update public.assistant_profiles
set is_default = true
where not is_default;

-- ---------------------------------------------------------------------------
-- No máximo um padrão por organização + audience.
-- ---------------------------------------------------------------------------
-- Índice PARCIAL, não constraint: Postgres não aceita `unique ... where`, e é
-- justamente o `where` que permite N agentes não-padrão convivendo.
--
-- Hoje isto parece redundante com a unique antiga, que já limita tudo a uma
-- linha. É intencional: quando a FASE E remover aquela, esta continua
-- garantindo que só existe um padrão — e sem ela, remover a unique antiga
-- deixaria o sistema sem nenhuma regra dizendo quem responde.
--
-- O projeto já resolveu este mesmo problema uma vez, em
-- `organization_campaigns`: `is_default boolean not null default false` mais
-- `organization_campaigns_one_default_idx`, um índice parcial. Daí o nome
-- daqui seguir a mesma forma. Há, porém, uma divergência deliberada: aquele
-- índice é `where is_default and status in ('test','active')`, ou seja, uma
-- campanha padrão encerrada libera a vaga para outra. Aqui NÃO filtramos por
-- `active`, porque para agente as duas coisas são ortogonais: um agente padrão
-- desativado continua sendo o padrão, e queremos que o resolvedor recuse com
-- "sem padrão ativo" em vez de outro agente assumir sozinho. Filtrar por
-- `active` permitiria duas linhas `is_default = true` ao mesmo tempo (uma
-- inativa, uma ativa) e tornaria a coluna ambígua de ler.
create unique index if not exists assistant_profiles_one_default_idx
  on public.assistant_profiles (organization_id, audience)
  where is_default;

-- ---------------------------------------------------------------------------
-- Identidade técnica única por organização.
-- ---------------------------------------------------------------------------
do $$
declare
  colisoes integer;
begin
  select count(*) into colisoes from (
    select organization_id, slug
    from public.assistant_profiles
    group by organization_id, slug
    having count(*) > 1
  ) duplicados;

  if colisoes > 0 then
    raise exception 'ha % par(es) (organization_id, slug) repetidos; resolva antes de impor a unicidade de slug', colisoes;
  end if;

  -- Guardado por nome para a migration poder ser reaplicada sem erro.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_organization_slug_key'
  ) then
    alter table public.assistant_profiles
      add constraint assistant_profiles_organization_slug_key unique (organization_id, slug);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Organização nova nasce com os dois padrões.
-- ---------------------------------------------------------------------------
-- Redefinida a partir da definição VIVA em produção (conferida por
-- `pg_get_functiondef` antes de escrever esta migration). A única mudança são
-- as duas colunas `is_default` nos inserts de `assistant_profiles`: sem isso,
-- os perfis iniciais nasceriam `false` por causa do default da coluna, e toda
-- organização nova ficaria sem agente padrão — o oposto do que a FASE D vai
-- precisar encontrar.
--
-- Nota para a FASE E: os dois `on conflict (organization_id, audience)`
-- abaixo dependem da unique antiga. Quando ela for removida, este ON CONFLICT
-- deixa de ter índice correspondente e a função passa a falhar. Fica
-- registrado aqui porque é fácil de esquecer.
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
  ) on conflict (organization_id, audience) do nothing;
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, created_by, updated_by, is_default
  ) values (
    target_organization, '10000000-0000-0000-0000-000000000002', 'customer',
    'Assistente da empresa', actor, actor, true
  ) on conflict (organization_id, audience) do nothing;

  select id into internal_profile from public.assistant_profiles
  where organization_id = target_organization and audience = 'internal';
  select id into customer_profile from public.assistant_profiles
  where organization_id = target_organization and audience = 'customer';

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
-- Prova final: o que esta fase promete, e o que ela não pode ter afrouxado.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public'
      and table_row.relname = 'assistant_profiles'
      and constraint_row.contype = 'u'
      and (
        select array_agg(attribute_row.attname::text order by attribute_row.attname)
        from unnest(constraint_row.conkey) as coluna(attnum)
        join pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = coluna.attnum
      ) = array['audience', 'organization_id']
  ) then
    raise exception 'unique (organization_id, audience) sumiu: a FASE C nao pode liberar multi-agent';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and indexname = 'assistant_profiles_one_default_idx'
      and indexdef like '%WHERE is_default%'
  ) then
    raise exception 'o indice parcial de agente padrao nao foi criado como parcial';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_organization_slug_key'
  ) then
    raise exception 'a unicidade de slug por organizacao nao foi criada';
  end if;

  if exists (select 1 from public.assistant_profiles where not is_default) then
    raise exception 'ha perfil sem is_default apos o backfill';
  end if;

  if exists (
    select 1 from public.assistant_profiles
    where is_default group by organization_id, audience having count(*) > 1
  ) then
    raise exception 'ha mais de um agente padrao na mesma organizacao e audience';
  end if;
end $$;
