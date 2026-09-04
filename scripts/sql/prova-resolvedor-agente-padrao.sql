-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Prova COMPORTAMENTAL da FASE D (os resolvedores selecionam o agente padrão).
--
-- NUNCA rode isto em produção. Além de inserir agentes e credenciais de
-- mentira, o item F **remove a UNIQUE (organization_id, audience)** para
-- simular o mundo pós-FASE-E. Tudo termina em ROLLBACK, mas gatilhos de
-- auditoria disparam e sequências avançam de qualquer jeito, e um `commit`
-- digitado por engano deixaria produção sem a constraint que hoje impede
-- multi-agent. Use um Postgres descartável.
--
-- Os testes de test/agent-default-resolution-migration.test.mjs provam que a
-- migration DECLARA a regra certa. Este script prova que o Postgres a APLICA —
-- e, principalmente, prova o caso que nenhuma leitura de SQL prova sozinha:
-- que um padrão inativo faz o sistema RECUSAR em vez de falar por outro
-- agente.
--
-- Sequência completa, num Postgres descartável:
--   1. harness-supabase-minimo.sql
--   2. migrations do repositório até a FASE B (20260904160000) inclusive
--      — NÃO aplicar a FASE C ainda
--   3. prova-agente-padrao-seed.sql        <-- fixtures pré-C, COMMIT
--   4. migration da FASE C (20260904190000)
--   5. migration da FASE D (20260904230000)
--   6. este arquivo
--
-- O seed EXIGE rodar antes da FASE C — ele mesmo verifica e recusa se
-- `is_default` já existir (ver prova-agente-padrao-seed.sql). A ordem acima
-- não é intercambiável com "aplicar tudo e só depois semear".
--
-- Itens:
--   A-D  `private.intelligence_payload` — o ponto por onde passam v1, v2, v3
--        e o preview. Provar o payload prova os quatro; é justamente por isso
--        que a FASE D não duplicou a regra em cada um. D também prova, à
--        parte, que o CONTEXTO grava o perfil resolvido — é dali que o v3 lê
--        (`context_row.assistant_profile_id`), então D é a prova indireta de
--        que o v3 herda a correção sem ter sido tocado.
--   E    `nucleo_customer_assistant_access` — alvo direto da FASE D, com
--        seleção PRÓPRIA (não delega ao payload). Testado fim a fim através
--        de uma credencial de robô simulada via GUC de JWT (o harness
--        implementa `auth.uid()`/`auth.jwt()` lendo `request.jwt.claim.*`).
--   F-G  o cenário FUTURO: dois agentes na mesma audience, com a UNIQUE
--        antiga removida dentro da transação, e o controle negativo.
--   H    pós-rollback: confirma que o ambiente de teste não vazou estado.
--
-- Sobre o v3 (`nucleo_intelligence_context_resolve_v3`) especificamente: ele
-- não tem seleção de agente própria — lê `context_row.assistant_profile_id`,
-- que o item D prova ser preenchido com o padrão. Exercitá-lo ponta a ponta
-- exigiria montar skill de recepção publicada, sessão de skill e roteamento —
-- máquina inteira da FASE H3, alheia ao que a FASE D mudou, e que ampliaria o
-- escopo desta prova para muito além do que a ETAPA 9A pediu ("não é para
-- transformar em Agent Router"). A cobertura do v3 aqui é por D (o mecanismo
-- de que ele depende) mais o contrato estático `H` de
-- test/agent-default-resolution-migration.test.mjs (que trava que o v3 só
-- pode alcançar o perfil por `profile.id = context_row.assistant_profile_id`,
-- nunca por organização + audience). Registrado como escopo, não como prova
-- ausente.

\set ON_ERROR_STOP on

-- A organização e o ator são os do seed (prova-agente-padrao-seed.sql),
-- identificador fixo — não um `limit 1` sem ordem, que poderia inspecionar
-- linha de outra organização.
begin;

-- ===========================================================================
-- SETUP: credencial de robô simulada, para os itens que leem a organização
-- via `private.robot_organization()`/`private.robot_connection()` (JWT), em
-- vez de receberem `target_organization` como parâmetro explícito (que é
-- como A-D chamam o payload direto).
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  auth_robo uuid := 'aaaaaaaa-0003-4000-8000-00000000fa5e';
  conexao uuid;
begin
  insert into auth.users (id, email)
  values (auth_robo, 'robo-da-prova-fase-d@exemplo.invalido')
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name)
  values (auth_robo, 'Robo da prova FASE D')
  on conflict (id) do nothing;

  insert into public.whatsapp_connections (id, organization_id, name, status)
  values (gen_random_uuid(), organizacao, 'Conexao da prova FASE D', 'connected')
  returning id into conexao;

  insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id, status)
  values (conexao, organizacao, auth_robo, 'active');

  perform set_config('request.jwt.claim.sub', auth_robo::text, false);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'app_metadata', jsonb_build_object(
        'is_robot', true,
        'organization_id', organizacao::text,
        'connection_id', conexao::text
      )
    )::text,
    false
  );

  raise notice 'SETUP ok: credencial de robo simulada para organizacao % via conexao %', organizacao, conexao;
end $$;

-- ===========================================================================
-- A: com um único padrão ativo, o payload resolve normalmente.
--    É o comportamento de hoje, e a FASE D não pode tê-lo mudado.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
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
--    prova a recusa; o item F prova que ela continua valendo com um segundo
--    agente ativo disponível ao lado.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
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
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
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
--    semântica da FASE D sem ter sido tocado. Ver a nota sobre v3 no
--    cabeçalho deste arquivo.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
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
-- E: nucleo_customer_assistant_access, fim a fim, com a credencial de robô
--    do SETUP. Esta função tem seleção PRÓPRIA (não delega ao payload) e é
--    alvo direto da FASE D. process_config é '{}'::jsonb (default), então o
--    modo de rollout cai em 'off' — o que basta para confirmar que a SELEÇÃO
--    encontrou o perfil certo, sem depender de configurar piloto/campanha.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  resposta jsonb;
begin
  -- E.1 — default ativo: a seleção encontra o perfil (reason != profile_inactive).
  update public.assistant_profiles set is_default = true, active = true
  where organization_id = organizacao and audience = 'customer';

  resposta := public.nucleo_customer_assistant_access('+5511999998888');
  if (resposta ->> 'reason') = 'profile_inactive' then
    raise exception 'E.1 FALHOU: default ativo foi tratado como profile_inactive: %', resposta;
  end if;
  raise notice 'E.1 PASS: default ativo e encontrado (reason=%)', resposta ->> 'reason';

  -- E.2 — default inativo: profile_inactive, mensagem pública preservada.
  update public.assistant_profiles set active = false
  where organization_id = organizacao and audience = 'customer' and is_default;

  resposta := public.nucleo_customer_assistant_access('+5511999998888');
  if (resposta ->> 'reason') is distinct from 'profile_inactive' then
    raise exception 'E.2 FALHOU: default inativo deveria devolver profile_inactive, devolveu %', resposta;
  end if;
  if (resposta ->> 'allowed') is distinct from 'false' then
    raise exception 'E.2 FALHOU: default inativo nao pode devolver allowed=true';
  end if;
  raise notice 'E.2 PASS: default inativo devolve profile_inactive';

  update public.assistant_profiles set active = true
  where organization_id = organizacao and audience = 'customer' and is_default;

  -- E.3 — SEM default (perfil existe e está ativo, mas não é o padrão):
  --        fail closed, mesma mensagem de E.2. Nada de cair no perfil ativo.
  update public.assistant_profiles set is_default = false
  where organization_id = organizacao and audience = 'customer';

  resposta := public.nucleo_customer_assistant_access('+5511999998888');
  if (resposta ->> 'reason') is distinct from 'profile_inactive' then
    raise exception 'E.3 FALHOU: sem default, com perfil ativo disponivel, deveria falhar fechado com profile_inactive, devolveu %', resposta;
  end if;
  raise notice 'E.3 PASS: sem default falha fechado, mesmo com perfil ativo disponivel';

  update public.assistant_profiles set is_default = true
  where organization_id = organizacao and audience = 'customer';
end $$;

-- ===========================================================================
-- F: O CENÁRIO FUTURO. Aqui a UNIQUE (organization_id, audience) é removida
--    DENTRO DO TESTE, para simular o mundo pós-FASE-E. É o único item que
--    prova o que a FASE D existe para garantir: com dois agentes na mesma
--    audience, o padrão inativo NÃO cai no outro.
--
--    A partial unique de is_default continua de pé — é ela que impede dois
--    padrões e é o que torna a seleção sem `limit 1` correta.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
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
    raise exception 'F FALHOU: aceitou dois agentes padrao na mesma audience';
  exception when unique_violation then
    null;
  end;

  -- F.1 — com A padrão e ativo, e B ativo ao lado, resolve A.
  resolvido := private.intelligence_payload(
    organizacao, 'customer', 'simulator',
    repeat('e', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,id}';

  if resolvido is distinct from agente_a::text then
    raise exception 'F.1 FALHOU: com dois agentes, resolveu % em vez do padrao %',
      resolvido, agente_a;
  end if;
  raise notice 'F.1 PASS: com dois agentes na mesma audience, resolve o padrao';

  -- F.2 — o padrão fica inativo, o OUTRO continua ativo. Tem de RECUSAR.
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
      raise exception 'F.2 FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;

  if not recusou then
    raise exception 'F.2 FALHOU: padrao inativo caiu no agente B — e exatamente isso que a FASE D proibe';
  end if;
  raise notice 'F.2 PASS: padrao inativo RECUSA, mesmo com outro agente ativo ao lado';

  -- F.3 — o mesmo teste, mas por nucleo_customer_assistant_access, que tem
  --        seleção própria e independente do payload.
  begin
    perform public.nucleo_customer_assistant_access('+5511999998888');
  exception when others then
    raise exception 'F.3 FALHOU: nucleo_customer_assistant_access nao deveria lancar excecao, deveria devolver profile_inactive: %', sqlerrm;
  end;
  if (public.nucleo_customer_assistant_access('+5511999998888') ->> 'reason') is distinct from 'profile_inactive' then
    raise exception 'F.3 FALHOU: com dois agentes e o padrao inativo, customer_access deveria recusar com profile_inactive';
  end if;
  raise notice 'F.3 PASS: customer_assistant_access tambem recusa com o padrao inativo, mesmo com o agente B ativo ao lado';
end $$;

-- ===========================================================================
-- G: controle negativo. Se a seleção voltasse a filtrar `active` junto (o
--    comportamento pré-FASE-D), F.2 teria caído no agente B. Provamos aqui
--    que a prova sabe reprovar: a consulta antiga, rodada à mão no mesmo
--    estado, encontra B — ou seja, F.2 não passou por acidente.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  escolhido_pela_regra_antiga uuid;
begin
  select id into escolhido_pela_regra_antiga
  from public.assistant_profiles profile
  where profile.organization_id = organizacao
    and profile.audience = 'customer' and profile.active
  limit 1;

  if escolhido_pela_regra_antiga is null then
    raise exception 'G FALHOU: o controle negativo nao encontrou ninguem; o cenario de F nao estava montado';
  end if;
  if (select is_default from public.assistant_profiles where id = escolhido_pela_regra_antiga) then
    raise exception 'G FALHOU: a regra antiga achou o proprio padrao; o cenario nao distingue as duas regras';
  end if;
  raise notice 'G PASS: a regra antiga teria caido no agente nao-padrao %, e a nova recusou',
    escolhido_pela_regra_antiga;
end $$;

rollback;

-- Depois do rollback: a UNIQUE antiga tem de estar de volta, e o robô e a
-- conexão simulados têm de ter sumido com o resto do teste. Se este item
-- reprovar, o banco de teste ficou num estado que não representa produção.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_organization_id_audience_key'
  ) then
    raise exception 'H FALHOU: a UNIQUE antiga nao voltou depois do rollback';
  end if;
  if exists (
    select 1 from public.connection_robot_credentials
    where auth_user_id = 'aaaaaaaa-0003-4000-8000-00000000fa5e'
  ) then
    raise exception 'H FALHOU: a credencial de robo simulada sobreviveu ao rollback';
  end if;
  raise notice 'H PASS: a UNIQUE (organization_id, audience) voltou, e o robo simulado nao sobreviveu ao rollback';
end $$;
