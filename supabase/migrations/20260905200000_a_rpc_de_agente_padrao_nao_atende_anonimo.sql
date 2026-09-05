-- A RPC de agente padrão deixa de atender anônimo.
--
-- ETAPA 11D. Hardening PONTUAL de menor privilégio, só da RPC que a FASE F
-- criou. Não muda comportamento: nenhuma linha de código da função é tocada.
--
-- O QUE ACONTECEU, E POR QUE A PROVA NÃO PEGOU
--
-- A migration da FASE F fez `revoke all on function ... from public` — e isso
-- funcionou: `has_function_privilege('public', ..., 'EXECUTE')` é `false`. Mas
-- em produção a função saiu mesmo assim com EXECUTE para `anon`,
-- `authenticated` e `service_role`, porque o projeto tem
-- `ALTER DEFAULT PRIVILEGES` concedendo EXECUTE a esses três papéis em toda
-- função criada no schema `public`. O `revoke ... from public` não alcança
-- concessão nominal a papel.
--
-- O Postgres descartável do harness NÃO tem esses default privileges, então
-- lá o ACL saiu "limpo" (`owner | authenticated`) e a prova passou sem ver o
-- problema. Foi a conferência do catálogo em PRODUÇÃO que pegou. Fica
-- registrado como limite do harness: ele prova semântica de SQL, não
-- configuração de projeto.
--
-- ISTO NÃO ERA EXPLORÁVEL, e a migration não existe por pânico
--
-- A função é `security definer` e a primeira coisa que faz depois de achar o
-- agente é `private.can_manage_org(...)`, que depende de `auth.uid()`. Uma
-- chamada anônima não tem `auth.uid()`, logo `org_role` é nulo,
-- `can_manage_org` é falso e a função levanta `organization management
-- required` antes de escrever qualquer coisa. O que se corrige aqui é
-- superfície, não vazamento: `anon` não deveria nem conseguir invocar uma
-- operação de gestão.
--
-- `service_role` FICA, e é decisão, não descuido
--
-- É o papel dos caminhos servidor, a chave nunca chega ao navegador, e **toda**
-- RPC deste projeto a concede — as seis conferidas em 05/09/2026
-- (`nucleo_customer_assistant_access`, `customer_assistant_rollout_update`,
-- `intelligence_context_preview`, `resolve_v2`, `nucleo_knowledge_save` e esta)
-- têm ACL idêntico. Tirar só desta faria dela a única exceção do projeto, que é
-- o tipo de detalhe que surpreende alguém seis meses depois. E não amplia
-- nada: sem JWT de usuário, `can_manage_org` falha fechado para ela também.
--
-- ESCOPO: só esta função. A dívida ampla — 37 funções do schema `private` com
-- ACL padrão — continua em trilha separada, registrada em docs/STATUS.md.

begin;

-- ---------------------------------------------------------------------------
-- 1/3. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_agent_set_default'
      and p.oid::regprocedure::text = 'nucleo_agent_set_default(uuid)'
  ) then
    raise exception 'hardening abortado: nucleo_agent_set_default(uuid) nao existe com essa assinatura';
  end if;

  -- Se ela deixou de ser `security definer` ou perdeu o `search_path`, o
  -- problema é outro e maior que grants — não seguimos por cima disso.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_agent_set_default'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=%'
      and p.prosrc like '%can_manage_org%'
  ) then
    raise exception 'hardening abortado: a RPC nao esta no estado aprovado (security definer + search_path + can_manage_org)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/3. Os grants. Nominal, porque foi nominal que a concessão entrou.
-- ---------------------------------------------------------------------------
revoke execute on function public.nucleo_agent_set_default(uuid) from public;
revoke execute on function public.nucleo_agent_set_default(uuid) from anon;
grant execute on function public.nucleo_agent_set_default(uuid) to authenticated;
grant execute on function public.nucleo_agent_set_default(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3/3. Prova, pelo privilégio EFETIVO e não pelo texto do ACL.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.nucleo_agent_set_default(uuid)', 'EXECUTE') then
    raise exception 'hardening falhou: anon ainda executa a RPC';
  end if;
  if has_function_privilege('public', 'public.nucleo_agent_set_default(uuid)', 'EXECUTE') then
    raise exception 'hardening falhou: PUBLIC ainda executa a RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.nucleo_agent_set_default(uuid)', 'EXECUTE') then
    raise exception 'hardening falhou: authenticated perdeu EXECUTE — o produto ficaria sem como trocar o padrao';
  end if;
  if not has_function_privilege('service_role', 'public.nucleo_agent_set_default(uuid)', 'EXECUTE') then
    raise exception 'hardening falhou: service_role perdeu EXECUTE (decisao foi preservar)';
  end if;

  -- E a fronteira de escrita da ETAPA 11B não pode ter regredido de carona.
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE')
      and (
        (table_name = 'assistant_profiles' and (
          column_name in ('id', 'is_default')
          or (column_name in ('organization_id', 'audience') and privilege_type = 'UPDATE')))
        or (table_name = 'assistant_profile_skills'
            and column_name in ('organization_id', 'profile_id', 'skill_id')
            and privilege_type = 'UPDATE')
      )
  ) then
    raise exception 'hardening falhou: coluna estrutural voltou a ser gravavel';
  end if;
  if not has_table_privilege('authenticated', 'public.assistant_profiles', 'SELECT') then
    raise exception 'hardening falhou: authenticated perdeu SELECT em assistant_profiles';
  end if;
end $$;

commit;
