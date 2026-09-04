-- O assistente ganha identidade própria: slug, papel e alma.
--
-- FASE B de docs/intelligence/MULTI-AGENT-MIGRATION.md. A FASE A criou
-- `AgentDefinition` no domínio (packages/intelligence/src/agent.mjs) e o
-- adapter `assistantProfileToAgentDefinition`, que hoje DERIVA três campos
-- que o banco não tem: `slug` (a partir de display_name), `role` (null) e
-- `soulMarkdown` (null). Derivar é aceitável enquanto é leitura; deixa de
-- ser no instante em que alguém quiser EDITAR o papel ou a alma de um
-- agente — não há onde gravar.
--
-- Esta migration é aditiva e não libera multi-agent:
-- `unique (organization_id, audience)` continua de pé, e `is_default` NÃO é
-- criado aqui (ele é a FASE C, e precisa vir antes da FASE E, que remove a
-- unique — nessa ordem, senão os resolvedores passam a sortear agente em
-- silêncio; o raciocínio completo está no documento).
--
-- Três decisões que valem explicação:
--
-- 1. **O slug é calculado por uma função, não por um UPDATE com regex solto.**
--    `private.agent_slug` existe para que o backfill de hoje e qualquer
--    inserção de amanhã usem exatamente a mesma regra. E, principalmente,
--    para que ela possa ser PROVADA: o bloco `do $$` logo abaixo da função
--    roda o mesmo corpus de casos que o teste JavaScript
--    (test/fixtures/agent/agent-slug-cases.json) e levanta exceção se
--    o Postgres computar qualquer coisa diferente do que o domínio computa.
--    Se `normalize`/`lower`/`regexp_replace` se comportarem de forma
--    diferente do JavaScript nesta instalação, esta migration FALHA em vez de
--    gravar um slug divergente — que é o erro caro, porque só apareceria
--    muito depois, quando algo passar a resolver agente por slug.
--
-- 2. **O slug não é UNIQUE nesta fase.** A preferência arquitetural é que o
--    agente tenha identidade única dentro da organização, mas hoje é
--    impossível provar que o backfill não colide: dois perfis da mesma
--    organização podem ter sido renomeados para o mesmo nome pelo portal
--    (`inteligencia.salvarPerfil` deixa), e não há ambiente seguro para
--    consultar os dados reais antes de aplicar. Impor UNIQUE agora arrisca
--    uma migration que falha em produção; e resolver a colisão com sufixo
--    automático quebraria a igualdade `slug = agent_slug(display_name)`
--    justamente na linha colidida — trocaria uma divergência silenciosa por
--    outra. Em vez disso, o bloco final REPORTA quantas colisões existem,
--    por NOTICE. Quem aplicar a migration sai sabendo se a FASE C pode
--    impor UNIQUE (organization_id, slug) com segurança. Enquanto ninguém
--    resolve agente por slug — e hoje ninguém resolve —, a colisão não tem
--    consequência de runtime.
--
-- 3. **`role` aqui não é permissão.** O sistema já tem `role` com outro
--    significado: `public.organization_role` (owner/admin/member), que é
--    autorização de gente. `assistant_profiles.role` é papel/função do
--    agente — "recepcionista", "vendedor" — e não concede nada. Mesma regra
--    de `soul_markdown`: persona, nunca ACL. Quem autoriza continua sendo o
--    `allowedTools` da skill (validado contra o Tool Registry) e a RLS.
--    Os `comment on column` abaixo deixam isso gravado no próprio schema.
--
-- O que NÃO muda: nenhum resolvedor é tocado
-- (`private.intelligence_payload`, `resolve_v2`, `resolve_v3`,
-- `nucleo_customer_assistant_access`). O payload de inteligência monta
-- `assistente` com campos nomeados um a um, então as colunas novas não
-- vazam para nenhuma resposta de RPC. Nenhum consumidor lê `slug`/`role`/
-- `soul_markdown` ainda.

-- ---------------------------------------------------------------------------
-- A regra canônica de slug, espelhando slugFromAgentName() do domínio.
-- ---------------------------------------------------------------------------
-- Cada passo corresponde, na ordem, a uma linha de
-- packages/intelligence/src/agent.mjs:
--   normalize(NFD)                    → .normalize("NFD")
--   regexp_replace [\u0300-\u036f]    → .replace(/[\u0300-\u036f]/g, "")
--   lower                             → .toLocaleLowerCase("pt-BR")
--   regexp_replace [^a-z0-9]+ → '-'   → .replace(/[^a-z0-9]+/g, "-")
--   btrim '-'                         → .replace(/^-+|-+$/g, "")
--   coalesce 'agente-' || audience    → || `agente-${audience}`
-- A ordem importa: acento é removido ANTES do lower, senão a decomposição
-- muda de forma em alguns caracteres.
create or replace function private.agent_slug(display_name text, audience text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      btrim(
        regexp_replace(
          lower(
            regexp_replace(normalize(coalesce(display_name, ''), NFD), '[\u0300-\u036f]', '', 'g')
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-'
      ),
      ''
    ),
    'agente-' || coalesce(audience, '')
  );
$$;

comment on function private.agent_slug(text, text) is
  'Regra canônica de slug de agente. Espelha slugFromAgentName() em packages/intelligence/src/agent.mjs; a equivalência é provada pelo bloco de prova da migration 20260904160000 e pelo teste test/agent-slug-equivalence.test.mjs, ambos usando o corpus de test/fixtures/agent/agent-slug-cases.json.';

-- ---------------------------------------------------------------------------
-- Prova de equivalência com o domínio, no Postgres real, antes do backfill.
-- ---------------------------------------------------------------------------
-- Mesmos pares de test/fixtures/agent/agent-slug-cases.json. Se algum
-- divergir, a migration falha aqui e nenhuma coluna é criada.
do $$
declare
  casos constant text[][] := array[
    ['Assistente interno', 'internal', 'assistente-interno'],
    ['Assistente da empresa', 'customer', 'assistente-da-empresa'],
    ['Recepção — Clínica!', 'customer', 'recepcao-clinica'],
    ['Emília', 'customer', 'emilia'],
    ['  Agente   de   Vendas  ', 'customer', 'agente-de-vendas'],
    ['SDR 2.0', 'internal', 'sdr-2-0'],
    ['Ação & Reação', 'internal', 'acao-reacao'],
    ['ÁÉÍÓÚÇÃÕ', 'internal', 'aeioucao'],
    ['2026', 'internal', '2026'],
    ['!!', 'customer', 'agente-customer'],
    ['??', 'internal', 'agente-internal']
  ];
  caso text[];
  obtido text;
begin
  foreach caso slice 1 in array casos loop
    obtido := private.agent_slug(caso[1], caso[2]);
    if obtido is distinct from caso[3] then
      raise exception 'regra de slug divergiu do dominio: agent_slug(%, %) devolveu % e o JavaScript devolve %',
        caso[1], caso[2], obtido, caso[3];
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- As colunas de identidade.
-- ---------------------------------------------------------------------------
alter table public.assistant_profiles
  add column if not exists slug text,
  add column if not exists role text,
  add column if not exists soul_markdown text;

comment on column public.assistant_profiles.slug is
  'Identidade TÉCNICA do agente, estável: derivada uma única vez de display_name pela regra de private.agent_slug e não reescrita quando o nome muda. Não confundir com display_name, que é a identidade HUMANA e pode ser reescrita à vontade.';
comment on column public.assistant_profiles.role is
  'Papel/função do agente na operação (ex.: recepcionista, vendedor). NÃO é autorização e não tem relação com public.organization_role, que é permissão de pessoa. Permissão de agente é allowedTools da skill mais RLS.';
comment on column public.assistant_profiles.soul_markdown is
  'Persona do agente em markdown: quem ele é e como se comporta. NUNCA autorização — soul não concede ferramenta, escopo nem acesso a dado. Ver docs/intelligence/MULTI-AGENT-MIGRATION.md.';

-- ---------------------------------------------------------------------------
-- Backfill: determinístico, idempotente e sem tocar display_name.
-- ---------------------------------------------------------------------------
-- Só preenche o que está nulo, então rodar de novo não reescreve nada — o
-- slug é identidade estável, não espelho do nome.
update public.assistant_profiles
set slug = private.agent_slug(display_name, audience)
where slug is null;

-- `role` e `soul_markdown` ficam NULL de propósito. Não há de onde tirá-los
-- sem inventar: template_id e process_config não descrevem persona, e migrar
-- prompt antigo para soul é uma decisão de produto que merece etapa própria.

-- ---------------------------------------------------------------------------
-- Toda linha nova também nasce com slug.
-- ---------------------------------------------------------------------------
-- Sem isto, `slug not null` quebraria a criação de organização:
-- `private.provision_intelligence()` insere os dois perfis sem informar slug,
-- e é trigger de `after insert on organizations`. O gatilho preenche só
-- quando o slug não veio, então quem souber informar um slug próprio (a UI da
-- FASE F) continua mandando o seu.
create or replace function private.assistant_profile_fill_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := private.agent_slug(new.display_name, new.audience);
  end if;
  return new;
end;
$$;

drop trigger if exists assistant_profiles_fill_slug on public.assistant_profiles;
create trigger assistant_profiles_fill_slug
before insert on public.assistant_profiles
for each row execute function private.assistant_profile_fill_slug();

alter table public.assistant_profiles alter column slug set not null;

-- ---------------------------------------------------------------------------
-- Relatório de colisão: transforma o desconhecido em fato medido.
-- ---------------------------------------------------------------------------
-- Não falha nada. Só informa a quem aplicou se a FASE C pode impor
-- unique (organization_id, slug) — hoje impossível de saber sem olhar os
-- dados reais.
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

  if colisoes = 0 then
    raise notice 'slug de agente: nenhuma colisao por organizacao. unique (organization_id, slug) e seguro na FASE C.';
  else
    raise notice 'slug de agente: % par(es) (organization_id, slug) repetidos. Resolver antes de impor unique na FASE C.', colisoes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Prova final: esta migration não afrouxou nada nem antecipou a FASE C.
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
        -- `attname` é do tipo `name`; sem o cast explícito a comparação com
        -- um array de literais falha com "operator does not exist: name[] = text[]".
        select array_agg(attribute_row.attname::text order by attribute_row.attname)
        from unnest(constraint_row.conkey) as coluna(attnum)
        join pg_attribute attribute_row
          on attribute_row.attrelid = constraint_row.conrelid
         and attribute_row.attnum = coluna.attnum
      ) = array['audience', 'organization_id']
  ) then
    raise exception 'unique (organization_id, audience) sumiu: esta fase nao pode liberar multi-agent';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.assistant_profiles'::regclass
      and attname = 'is_default'
      and not attisdropped
  ) then
    raise exception 'is_default nao pertence a esta fase; ele e a FASE C';
  end if;

  if exists (select 1 from public.assistant_profiles where slug is null or btrim(slug) = '') then
    raise exception 'ha perfil sem slug apos o backfill';
  end if;
end $$;
