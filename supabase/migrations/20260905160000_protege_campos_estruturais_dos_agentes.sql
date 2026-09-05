-- Os campos estruturais do agente saem do alcance do cliente.
--
-- ETAPA 11B, hardening da FASE F. Nada de produto muda aqui: nenhuma função é
-- redefinida, nenhuma policy é reescrita, nenhuma linha é tocada. O que muda é
-- QUEM pode escrever em QUAIS COLUNAS.
--
-- O PROBLEMA, medido antes de corrigir
--
-- `assistant_profiles` tem RLS por organização, e ela funciona: um gestor da
-- Org A não cria nem edita agente da Org B (provado — as tentativas cross-org
-- ou levantam violação de policy ou casam zero linhas). Mas **RLS filtra
-- linhas, não colunas**: dentro das linhas que o gestor legitimamente
-- administra, ele podia escrever em qualquer coluna, porque
-- `authenticated` tem `UPDATE`/`INSERT` de tabela inteira
-- (`authenticated=arwdDxtm`, conferido em produção).
--
-- As regras que o domínio JS garante — `organization_id` e `audience`
-- imutáveis, `is_default` só pela RPC, agente nasce comum — moram no
-- NAVEGADOR. Quem chama o PostgREST direto não passa por elas. A prova
-- `scripts/sql/prova-fronteira-de-escrita.sql`, rodando como `authenticated`
-- (que é exatamente como o PostgREST executa), mediu quatro caminhos com
-- EFEITO REAL antes desta migration:
--
--   1. `update … set is_default = false`  -> a organização fica sem padrão, e
--      sem padrão o resolvedor recusa tudo (FASE D). Um público inteiro para
--      de ser atendido sem que nada tenha sido "quebrado".
--   2. `update … set audience = 'internal'` -> um agente de clientes, com
--      contexto e campanhas amarrados, passa a ler conhecimento INTERNO.
--   3. `update … set id = …` -> a identidade referenciada por conversas,
--      campanhas e skills muda por baixo.
--   4. `insert … is_default = true` -> um agente nasce padrão e passa a
--      atender sem que ninguém o tenha promovido.
--
-- Os outros sete caminhos testados já estavam fechados, e ficam registrados
-- para não serem "corrigidos" de novo por engano: cross-org de escrita e de
-- criação (RLS), skill em agente de outra organização (a FK composta
-- `(profile_id, organization_id)`, que é estrutura e não policy), e DELETE
-- (nenhuma policy de DELETE existe, então RLS não casa linha nenhuma).
--
-- A ESCOLHA: PRIVILÉGIO DE COLUNA, NÃO GATILHO
--
-- Um gatilho `before update` que comparasse `old`/`new` e levantasse exceção
-- também funcionaria, e foi considerado. Privilégio de coluna ganha por três
-- razões:
--
-- * é declarativo e auditável por catálogo — dá para perguntar ao banco quem
--   pode escrever onde, sem ler corpo de função;
-- * o PostgREST devolve o erro certo (`permission denied for column`) sem
--   precisar de tradução, e a recusa acontece antes de qualquer efeito;
-- * gatilho é código, e código de segurança que roda em todo UPDATE é mais uma
--   coisa para manter correta — inclusive quando alguém precisar de um
--   `update` legítimo e for tentado a adicionar uma exceção nele.
--
-- A RPC `nucleo_agent_set_default` continua funcionando porque é
-- `security definer` e pertence ao owner: ela não passa pelo privilégio de
-- `authenticated`. Depois desta migration ela é o ÚNICO caminho de escrita em
-- `is_default`.
--
-- O QUE CONTINUA ABERTO, DE PROPÓSITO
--
-- `active` continua editável, inclusive no agente padrão. Desativar o padrão é
-- decisão legítima de quem administra; o runtime já sabe recusar (FASE D) e
-- nada é promovido no lugar. Confundir `active` com `is_default` aqui seria
-- reintroduzir, por segurança, a ambiguidade que a FASE C separou.

begin;

-- ---------------------------------------------------------------------------
-- 1/3. Guardas. O hardening precisa saber onde está pisando.
-- ---------------------------------------------------------------------------
do $$
declare
  faltando text;
begin
  -- As colunas listadas abaixo precisam existir com estes nomes exatos; um
  -- GRANT em coluna inexistente falha, mas um REVOKE amplo seguido de GRANT
  -- incompleto deixaria o produto sem poder escrever.
  select string_agg(esperada, ', ') into faltando
  from unnest(array[
    'id','organization_id','template_id','audience','display_name','tone',
    'brand_config','process_config','active','created_by','updated_by',
    'created_at','updated_at','slug','role','soul_markdown','is_default'
  ]) esperada
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and column_name = esperada
  );
  if faltando is not null then
    raise exception 'hardening abortado: assistant_profiles nao tem a(s) coluna(s) %', faltando;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_agent_set_default' and p.prosecdef
  ) then
    raise exception 'hardening abortado: a RPC de troca de padrao nao existe ou nao e security definer — fechar is_default sem ela deixaria o produto sem como trocar o padrao';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/3. assistant_profiles: privilégio de tabela sai, privilégio de coluna entra.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.assistant_profiles from authenticated;

-- INSERT: tudo o que define um agente no nascimento.
-- Fora da lista, e por quê:
--   `id`         -> `gen_random_uuid()` gera; deixar o cliente escolher a
--                   identidade não serve a nada e permite colisão dirigida.
--   `is_default` -> `default false`. É isto que faz "agente nasce comum" ser
--                   uma garantia do BANCO, e não uma boa intenção do
--                   JavaScript. Promover é a RPC.
--   `created_at` / `updated_at` -> `now()`.
grant insert (
  organization_id, template_id, audience, display_name, slug, role, tone,
  soul_markdown, brand_config, process_config, active, created_by, updated_by
) on public.assistant_profiles to authenticated;

-- UPDATE: identidade humana e comportamento. `audience` e `organization_id`
-- entram no INSERT mas NÃO aqui — é assim que "definido na criação, imutável
-- depois" vira regra do banco.
grant update (
  template_id, display_name, slug, role, tone, soul_markdown,
  brand_config, process_config, active, updated_by
) on public.assistant_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3/3. assistant_profile_skills: o vínculo não muda de dono.
-- ---------------------------------------------------------------------------
-- Aqui a estrutura já protege o essencial: a FK composta
-- `(profile_id, organization_id) -> assistant_profiles(id, organization_id)`
-- torna impossível amarrar skill a agente de outra organização. O que falta é
-- impedir que um vínculo existente seja *movido* de agente ou de skill por um
-- UPDATE — o que faria uma skill trocar de dono sem passar por nenhuma
-- validação de vínculo.
revoke insert, update, delete, truncate on public.assistant_profile_skills from authenticated;

grant insert (
  organization_id, profile_id, skill_id, enabled, priority, configuration, updated_by
) on public.assistant_profile_skills to authenticated;

grant update (
  enabled, priority, configuration, updated_by
) on public.assistant_profile_skills to authenticated;

-- ---------------------------------------------------------------------------
-- Prova do que esta migration promete.
-- ---------------------------------------------------------------------------
do $$
declare
  vazou text;
  faltando text;
begin
  -- Nenhuma coluna estrutural pode ter ficado gravável.
  select string_agg(format('%s.%s(%s)', c.table_name, c.column_name, c.privilege_type), ', ')
  into vazou
  from information_schema.column_privileges c
  where c.table_schema = 'public' and c.grantee = 'authenticated'
    and c.privilege_type in ('INSERT', 'UPDATE')
    and (
      (c.table_name = 'assistant_profiles' and (
        (c.column_name in ('id', 'is_default'))
        or (c.column_name in ('organization_id', 'audience') and c.privilege_type = 'UPDATE')))
      or (c.table_name = 'assistant_profile_skills'
          and c.column_name in ('organization_id', 'profile_id', 'skill_id')
          and c.privilege_type = 'UPDATE')
    );
  if vazou is not null then
    raise exception 'hardening falhou: coluna estrutural ainda gravavel -> %', vazou;
  end if;

  -- E nenhuma coluna legítima pode ter ficado de fora: um hardening que fecha
  -- o produto junto com o buraco é indisponibilidade, não segurança.
  select string_agg(esperada, ', ') into faltando
  from unnest(array[
    'display_name', 'slug', 'role', 'tone', 'soul_markdown',
    'brand_config', 'process_config', 'active', 'updated_by'
  ]) esperada
  where not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
      and column_name = esperada
  );
  if faltando is not null then
    raise exception 'hardening falhou: coluna editavel perdeu UPDATE -> %', faltando;
  end if;

  -- `audience` e `organization_id` precisam continuar INSERÍVEIS, senão não há
  -- como criar agente nenhum.
  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and grantee = 'authenticated' and privilege_type = 'INSERT'
      and column_name in ('audience', 'organization_id')
    having count(*) = 2
  ) then
    raise exception 'hardening falhou: criar agente ficou impossivel (audience/organization_id sem INSERT)';
  end if;

  -- TRUNCATE não passa por RLS: é o único caminho que apagaria a tabela
  -- inteira apesar das policies. Tem de ter saído.
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and table_name in ('assistant_profiles', 'assistant_profile_skills')
      and privilege_type = 'TRUNCATE'
  ) then
    raise exception 'hardening falhou: TRUNCATE continua concedido';
  end if;

  -- E a RPC continua sendo o caminho sancionado de troca de padrão.
  if not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'nucleo_agent_set_default'
      and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'hardening falhou: authenticated perdeu EXECUTE na RPC de troca de padrao';
  end if;
end $$;

commit;
