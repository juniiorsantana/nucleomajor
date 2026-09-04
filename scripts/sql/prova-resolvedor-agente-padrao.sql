-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Prova COMPORTAMENTAL da FASE D (os resolvedores selecionam o agente padrão).
--
-- NUNCA rode isto em produção. Além de inserir agentes de mentira, o bloco
-- final **remove a UNIQUE (organization_id, audience)** para simular o mundo
-- pós-FASE-E. Tudo termina em ROLLBACK, mas gatilhos de auditoria disparam e
-- sequências avançam de qualquer jeito, e um `commit` digitado por engano
-- deixaria produção sem a constraint que hoje impede multi-agent. Use um
-- Postgres descartável.
--
-- Os testes de test/agent-default-resolution-migration.test.mjs provam que a
-- migration DECLARA a regra certa. Este script prova que o Postgres a APLICA —
-- e, principalmente, prova o caso que nenhuma leitura de SQL prova sozinha:
-- que um padrão inativo faz o sistema RECUSAR em vez de falar por outro
-- agente.
--
-- Sequência completa, num Postgres descartável:
--   1. harness-supabase-minimo.sql
--   2. migrations do repositório até a FASE C (20260904190000) inclusive
--   3. prova-agente-padrao-seed.sql        <-- fixtures pré-C, COMMIT
--   4. migration da FASE D (20260904230000)
--   5. este arquivo
--
-- O alvo é `private.intelligence_payload`: é por ele que passam v1, v2, v3 e o
-- preview, e é nele que a seleção do agente vive. Provar o payload prova os
-- quatro; é justamente por isso que a FASE D não duplicou a regra em cada um.

\set ON_ERROR_STOP on

-- A organização e o perfil vêm do seed, de identificador fixo — não de um
-- `limit 1` sem ordem, que poderia inspecionar linha de outra organização.
\set organizacao '\'00000000-0000-4000-8000-0000000000fa\''
\set ator '\'00000000-0000-4000-8000-0000000000fb\''

begin;

-- ===========================================================================
-- A: com um único padrão ativo, o payload resolve normalmente.
--    É o comportamento de hoje, e a FASE D não pode tê-lo mudado.
-- ===========================================================================
do $$
declare
  organizacao uuid := '00000000-0000-4000-8000-0000000000fa';
  resultado jsonb;
  perfil_esperado uuid;
begin
  update public.assistant_profiles set is_default = true, active = true
  where organization_id = organizacao and audience = 'customer';

  select id into perfil_esperado from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator',
    repeat('a', 64), 'ola', '{}'::jsonb, false
  );

  if resultado is null then
    raise exception 'A FALHOU: o payload nao resolveu com padrao ativo';
  end if;
  if (resultado #>> '{assistente,id}') is distinct from perfil_esperado::text then
    raise exception 'A FALHOU: o payload resolveu o agente % em vez do padrao %',
      resultado #>> '{assistente,id}', perfil_esperado;
  end if;
  raise notice 'A PASS: padrao ativo resolve, e resolve o agente padrao';
end $$;

-- ===========================================================================
-- B: padrão INATIVO recusa. Não existe outro agente aqui ainda — este item
--    prova a recusa; o item E prova que ela continua valendo com um segundo
--    agente ativo disponível ao lado.
-- ===========================================================================
do $$
declare
  organizacao uuid := '00000000-0000-4000-8000-0000000000fa';
  recusou boolean := false;
begin
  update public.assistant_profiles set active = false
  where organization_id = organizacao and audience = 'customer' and is_default;

  begin
    perform private.intelligence_payload(
      organizacao, 'customer', 'simulator',
      repeat('b', 64), 'ola', '{}'::jsonb, false
    );
  exception when others then
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'B FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;

  if not recusou then
    raise exception 'B FALHOU: padrao inativo deveria ter recusado';
  end if;
  raise notice 'B PASS: padrao inativo recusa, com a mensagem publica de sempre';

  update public.assistant_profiles set active = true
  where organization_id = organizacao and audience = 'customer';
end $$;

-- ===========================================================================
-- C: SEM padrão nenhum, falha fechado. Nada de "pega qualquer perfil ativo".
-- ===========================================================================
do $$
declare
  organizacao uuid := '00000000-0000-4000-8000-0000000000fa';
  recusou boolean := false;
begin
  -- O perfil continua existindo e ATIVO; só deixa de ser o padrão.
  update public.assistant_profiles set is_default = false
  where organization_id = organizacao and audience = 'customer';

  begin
    perform private.intelligence_payload(
      organizacao, 'customer', 'simulator',
      repeat('c', 64), 'ola', '{}'::jsonb, false
    );
  exception when others then
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'C FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;

  if not recusou then
    raise exception 'C FALHOU: sem padrao, e com perfil ativo disponivel, deveria falhar fechado';
  end if;
  raise notice 'C PASS: sem padrao falha fechado, mesmo havendo perfil ativo';

  update public.assistant_profiles set is_default = true
  where organization_id = organizacao and audience = 'customer';
end $$;

-- ===========================================================================
-- D: o agente resolvido é o que fica gravado no contexto — é daqui que o v3
--    lê (`context_row.assistant_profile_id`). Se isto vale, o v3 herda a
--    semântica da FASE D sem ter sido tocado.
-- ===========================================================================
do $$
declare
  organizacao uuid := '00000000-0000-4000-8000-0000000000fa';
  hash_conversa text := repeat('d', 64);
  perfil_padrao uuid;
  perfil_no_contexto uuid;
begin
  select id into perfil_padrao from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  perform private.intelligence_payload(
    organizacao, 'customer', 'simulator', hash_conversa, 'ola', '{}'::jsonb, true
  );

  select assistant_profile_id into perfil_no_contexto
  from public.conversation_intelligence_contexts
  where organization_id = organizacao and conversation_key_hash = hash_conversa;

  if perfil_no_contexto is distinct from perfil_padrao then
    raise exception 'D FALHOU: o contexto gravou % em vez do padrao %',
      perfil_no_contexto, perfil_padrao;
  end if;
  raise notice 'D PASS: o contexto (de onde o v3 le) recebe o agente padrao';
end $$;

-- ===========================================================================
-- E: O CENÁRIO FUTURO. Aqui a UNIQUE (organization_id, audience) é removida
--    DENTRO DO TESTE, para simular o mundo pós-FASE-E. É o único item que
--    prova o que a FASE D existe para garantir: com dois agentes na mesma
--    audience, o padrão inativo NÃO cai no outro.
--
--    A partial unique de is_default continua de pé — é ela que impede dois
--    padrões e é o que torna a seleção sem `limit 1` correta.
-- ===========================================================================
do $$
declare
  organizacao uuid := '00000000-0000-4000-8000-0000000000fa';
  ator uuid := '00000000-0000-4000-8000-0000000000fb';
  agente_a uuid;
  agente_b uuid;
  resolvido text;
  recusou boolean := false;
begin
  -- Só no teste. Nunca na migration.
  alter table public.assistant_profiles
    drop constraint assistant_profiles_organization_id_audience_key;

  select id into agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  update public.assistant_profiles set active = true, slug = 'agente-a'
  where id = agente_a;

  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, slug,
    created_by, updated_by, is_default, active
  ) values (
    organizacao,
    (select template_id from public.assistant_profiles where id = agente_a),
    'customer', 'Agente B', 'agente-b', ator, ator, false, true
  ) returning id into agente_b;

  -- A partial unique tem de continuar impedindo um segundo padrão.
  begin
    update public.assistant_profiles set is_default = true where id = agente_b;
    raise exception 'E FALHOU: aceitou dois agentes padrao na mesma audience';
  exception when unique_violation then
    null;
  end;

  -- E.1 — com A padrão e ativo, e B ativo ao lado, resolve A.
  resolvido := private.intelligence_payload(
    organizacao, 'customer', 'simulator',
    repeat('e', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,id}';

  if resolvido is distinct from agente_a::text then
    raise exception 'E.1 FALHOU: com dois agentes, resolveu % em vez do padrao %',
      resolvido, agente_a;
  end if;
  raise notice 'E.1 PASS: com dois agentes na mesma audience, resolve o padrao';

  -- E.2 — o padrão fica inativo, o OUTRO continua ativo. Tem de RECUSAR.
  --        Este é o item que a FASE D existe para garantir.
  update public.assistant_profiles set active = false where id = agente_a;
  update public.assistant_profiles set active = true  where id = agente_b;

  begin
    perform private.intelligence_payload(
      organizacao, 'customer', 'simulator',
      repeat('f', 64), 'ola', '{}'::jsonb, false
    );
  exception when others then
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'E.2 FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;

  if not recusou then
    raise exception 'E.2 FALHOU: padrao inativo caiu no agente B — e exatamente isso que a FASE D proibe';
  end if;
  raise notice 'E.2 PASS: padrao inativo RECUSA, mesmo com outro agente ativo ao lado';
end $$;

-- ===========================================================================
-- F: controle negativo. Se a seleção voltasse a filtrar `active` junto (o
--    comportamento pré-FASE-D), E.2 teria caído no agente B. Provamos aqui que
--    a prova sabe reprovar: a consulta antiga, rodada à mão no mesmo estado,
--    encontra B — ou seja, E.2 não passou por acidente.
-- ===========================================================================
do $$
declare
  organizacao uuid := '00000000-0000-4000-8000-0000000000fa';
  escolhido_pela_regra_antiga uuid;
begin
  select id into escolhido_pela_regra_antiga
  from public.assistant_profiles profile
  where profile.organization_id = organizacao
    and profile.audience = 'customer' and profile.active
  limit 1;

  if escolhido_pela_regra_antiga is null then
    raise exception 'F FALHOU: o controle negativo nao encontrou ninguem; o cenario de E nao estava montado';
  end if;
  if (select is_default from public.assistant_profiles where id = escolhido_pela_regra_antiga) then
    raise exception 'F FALHOU: a regra antiga achou o proprio padrao; o cenario nao distingue as duas regras';
  end if;
  raise notice 'F PASS: a regra antiga teria caido no agente nao-padrao %, e a nova recusou',
    escolhido_pela_regra_antiga;
end $$;

rollback;

-- Depois do rollback: a UNIQUE antiga tem de estar de volta. Se este item
-- reprovar, o banco de teste ficou num estado que não representa produção.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_organization_id_audience_key'
  ) then
    raise exception 'G FALHOU: a UNIQUE antiga nao voltou depois do rollback';
  end if;
  raise notice 'G PASS: a UNIQUE (organization_id, audience) voltou com o rollback';
end $$;
