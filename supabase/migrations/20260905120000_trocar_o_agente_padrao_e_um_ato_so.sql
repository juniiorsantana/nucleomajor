-- Trocar o agente padrão é um ato só.
--
-- FASE F de docs/intelligence/MULTI-AGENT-MIGRATION.md. A FASE E liberou N
-- agentes por audience; esta migration dá a operação que faltava para usar
-- isso sem quebrar a invariável do padrão.
--
-- POR QUE UMA RPC, E NÃO DUAS ESCRITAS DO FRONTEND
--
-- A arquitetura de escrita da Central de Inteligência é frontend → PostgREST
-- com RLS, e só usa RPC quando a operação precisa ser atômica ou privilegiada
-- (`customer_assistant_rollout_update`, `customer_handoff_transition`). Trocar
-- o padrão é exatamente esse caso, e por dois motivos independentes:
--
-- 1. **Atomicidade.** Promover B exige rebaixar A, e o índice parcial
--    `assistant_profiles_one_default_idx` garante que os dois não coexistem.
--    Feito como duas chamadas do navegador, existe uma janela real entre elas:
--    se a segunda falhar — aba fechada, rede caindo, token expirando —, a
--    organização fica SEM padrão naquela audience. E sem padrão o resolvedor
--    falha fechado (FASE D): aquele público simplesmente para de ser atendido,
--    por causa de uma promoção que ninguém terminou. Dentro de uma função, ou
--    as duas linhas mudam, ou nenhuma muda.
--
-- 2. **Ordem.** Mesmo com as duas chamadas dando certo, a ordem importa:
--    promover B antes de rebaixar A viola o índice parcial e o banco recusa.
--    Isso empurraria o frontend a "rebaixar primeiro", que é justamente a
--    ordem que deixa a janela sem padrão. Aqui a ordem é interna e testada.
--
-- O que ela NÃO faz:
--
-- * não cria agente, não apaga agente, não altera `active`;
-- * não atravessa audience: promover um agente de clientes não toca no padrão
--   interno, e vice-versa;
-- * não promove nada sozinha — só faz o que foi pedido explicitamente;
-- * não é Agent Router. Continua existindo UM padrão por audience, e é ele
--   quem responde. Escolher entre os N elegíveis por turno é a FASE G.

begin;

-- ---------------------------------------------------------------------------
-- 1/2. A troca.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_agent_set_default(target_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo public.assistant_profiles%rowtype;
  anterior uuid;
begin
  -- `for update` porque duas promoções simultâneas na mesma audience são um
  -- cenário real (duas abas, dois gestores) e o índice parcial transformaria a
  -- perdedora num erro feio em vez de numa espera.
  select * into alvo
  from public.assistant_profiles profile
  where profile.id = target_agent
  for update;

  if not found then
    raise exception 'agent not found';
  end if;
  if not private.can_manage_org(alvo.organization_id) then
    raise exception 'organization management required';
  end if;

  if alvo.is_default then
    -- Já é o padrão. Idempotente de propósito: um duplo clique não pode virar
    -- uma organização sem padrão.
    return jsonb_build_object(
      'schemaVersion', 'agent-default-1',
      'organizationId', alvo.organization_id,
      'audience', alvo.audience,
      'previousAgentId', alvo.id,
      'agentId', alvo.id,
      'changed', false
    );
  end if;

  select profile.id into anterior
  from public.assistant_profiles profile
  where profile.organization_id = alvo.organization_id
    and profile.audience = alvo.audience
    and profile.is_default
  for update;

  -- Rebaixa primeiro, promove depois: a ordem inversa colidiria com
  -- `assistant_profiles_one_default_idx`. Dentro da transação não existe
  -- instante observável sem padrão.
  if anterior is not null then
    update public.assistant_profiles set is_default = false, updated_by = auth.uid()
    where id = anterior;
  end if;

  update public.assistant_profiles set is_default = true, updated_by = auth.uid()
  where id = alvo.id;

  -- `active` NÃO é tocado, nos dois lados. `is_default` é identidade e
  -- `active` é elegibilidade; promover um agente parado é uma escolha
  -- legítima de quem está configurando, e o runtime sabe recusar até que ele
  -- seja ligado. Ligar por conta própria seria colocar no ar um agente que
  -- ninguém revisou.
  return jsonb_build_object(
    'schemaVersion', 'agent-default-1',
    'organizationId', alvo.organization_id,
    'audience', alvo.audience,
    'previousAgentId', anterior,
    'agentId', alvo.id,
    'changed', true
  );
end;
$$;

revoke all on function public.nucleo_agent_set_default(uuid) from public;
grant execute on function public.nucleo_agent_set_default(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2/2. Prova do que a função promete.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
begin
  select prosrc into corpo from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nucleo_agent_set_default';

  if corpo is null then
    raise exception 'FASE F falhou: nucleo_agent_set_default nao foi criada';
  end if;
  if corpo not like '%can_manage_org%' then
    raise exception 'FASE F falhou: a troca de padrao nao verifica autorizacao';
  end if;
  if corpo not like '%and profile.audience = alvo.audience%' then
    raise exception 'FASE F falhou: a troca de padrao nao esta restrita a audience';
  end if;
  if corpo like '%set active%' or corpo like '%active = true%' then
    raise exception 'FASE F falhou: a troca de padrao nao pode mexer em active';
  end if;
  if corpo like '%delete from%' or corpo like '%insert into%' then
    raise exception 'FASE F falhou: a troca de padrao nao pode criar nem apagar agente';
  end if;

  -- Continua sendo o índice parcial quem garante um padrão só.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and indexname = 'assistant_profiles_one_default_idx'
      and indexdef like '%WHERE is_default%'
  ) then
    raise exception 'FASE F falhou: o indice parcial de agente padrao sumiu';
  end if;

  -- E a FASE F não pode ter devolvido a unique que a FASE E removeu.
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.assistant_profiles'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(c.conkey) as k(attnum)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['audience', 'organization_id']
  ) then
    raise exception 'FASE F falhou: a unique (organization_id, audience) reapareceu';
  end if;
end $$;

commit;
