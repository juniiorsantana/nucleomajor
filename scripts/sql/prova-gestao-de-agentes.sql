-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Prova COMPORTAMENTAL da FASE F (gestão de Agents) e da sua integração com
-- as FASES D e E.
--
-- NUNCA rode isto em produção: cria organização e agentes falsos, promove,
-- rebaixa e desativa agente. Termina em ROLLBACK, mas gatilhos de auditoria
-- disparam e sequências avançam de qualquer jeito.
--
-- A pergunta central: **agora que dá para criar N agentes e trocar o padrão,
-- o runtime continua falando por exatamente um — o padrão — e continua
-- recusando quando ele não pode atender?**
--
-- Sequência, num Postgres descartável:
--   1..7  igual a README-prova-multi-agente.md (harness → FASE E)
--   8. migration da FASE F (20260905120000)
--   9. este arquivo
--
-- Cenário (o do item 13 da ETAPA 11A):
--   customer:  Emília (padrão) · Closer · Agenda
--   internal:  Operações (padrão) · QA
--
-- Itens:
--   A    o cenário monta: 3 customer + 2 internal, um padrão por audience.
--   B    o resolvedor usa Emília.
--   C-D  trocar o padrão para Closer é UM ato, e o resolvedor acompanha.
--   E    trocar padrão de customer não toca no padrão interno.
--   F    Closer inativo + Agenda ativa -> o resolvedor RECUSA. Não usa Agenda.
--   G    desativar o padrão não promove ninguém.
--   H    gestor de outra organização não troca o padrão desta.
--   I    a troca é atômica, e o modo de falha que ela evita é demonstrado.
--   J    idempotência: promover quem já é padrão não deixa a org sem padrão.
--   K-M  Agent ↔ Skills continua N:N de verdade.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- SETUP: a organização da prova, com o elenco do item 13.
-- ===========================================================================
do $$
declare
  dona uuid := 'cccccccc-0000-4000-8000-00000000fa5e';
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
begin
  insert into auth.users (id, email) values (dona, 'dona-fase-f@exemplo.invalido')
  on conflict (id) do nothing;
  insert into public.profiles (id, full_name) values (dona, 'Dona da prova FASE F')
  on conflict (id) do nothing;

  -- O gatilho `organizations_provision_intelligence` cria os dois padrões.
  insert into public.organizations (id, name, slug, created_by)
  values (org, 'Clinica da prova FASE F', 'clinica-da-prova-fase-f', dona);

  insert into public.organization_members (organization_id, user_id, role, status, responsibility)
  values (org, dona, 'owner', 'active', 'Prova')
  on conflict (organization_id, user_id) do update set role = 'owner', status = 'active';

  -- Batiza os padrões que nasceram do provisionamento.
  update public.assistant_profiles
  set display_name = 'Emilia', slug = 'emilia'
  where organization_id = org and audience = 'customer' and is_default;
  update public.assistant_profiles
  set display_name = 'Operacoes', slug = 'operacoes'
  where organization_id = org and audience = 'internal' and is_default;

  -- E o elenco não-padrão.
  insert into public.assistant_profiles (
    id, organization_id, template_id, audience, display_name, slug,
    created_by, updated_by, is_default, active
  ) values
    ('dddddddd-0001-4000-8000-00000000fa5e', org, '10000000-0000-0000-0000-000000000002',
     'customer', 'Closer', 'closer', dona, dona, false, true),
    ('dddddddd-0002-4000-8000-00000000fa5e', org, '10000000-0000-0000-0000-000000000002',
     'customer', 'Agenda', 'agenda-agente', dona, dona, false, true),
    ('dddddddd-0003-4000-8000-00000000fa5e', org, '10000000-0000-0000-0000-000000000001',
     'internal', 'QA', 'qa', dona, dona, false, true);

  perform set_config('request.jwt.claim.sub', dona::text, false);
  perform set_config('request.jwt.claims', '{}', false);

  raise notice 'SETUP ok: organizacao % com Emilia/Closer/Agenda e Operacoes/QA', org;
end $$;

-- ===========================================================================
-- A: o cenário monta.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  customers integer;
  internals integer;
  padroes integer;
begin
  select count(*) into customers from public.assistant_profiles
  where organization_id = org and audience = 'customer';
  select count(*) into internals from public.assistant_profiles
  where organization_id = org and audience = 'internal';
  select count(*) into padroes from public.assistant_profiles
  where organization_id = org and is_default;

  if customers <> 3 then raise exception 'A FALHOU: esperava 3 customer, achei %', customers; end if;
  if internals <> 2 then raise exception 'A FALHOU: esperava 2 internal, achei %', internals; end if;
  if padroes <> 2 then raise exception 'A FALHOU: esperava 2 padroes (1 por audience), achei %', padroes; end if;
  raise notice 'A ok: 3 customer + 2 internal, um padrao por audience';
end $$;

-- ===========================================================================
-- B: o resolvedor usa Emília.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  escolhido text;
begin
  escolhido := private.intelligence_payload(
    org, 'customer', 'whatsapp', repeat('1', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,nome}';
  if escolhido <> 'Emilia' then
    raise exception 'B FALHOU: o resolvedor escolheu % em vez de Emilia', escolhido;
  end if;
  raise notice 'B ok: com 3 agentes customer, o resolvedor fala por Emilia (a padrao)';
end $$;

-- ===========================================================================
-- C: trocar o padrão para Closer é UM ato.
-- D: e o resolvedor acompanha.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  closer uuid := 'dddddddd-0001-4000-8000-00000000fa5e';
  emilia uuid;
  resposta jsonb;
  escolhido text;
  padroes integer;
begin
  select id into emilia from public.assistant_profiles
  where organization_id = org and slug = 'emilia';

  resposta := public.nucleo_agent_set_default(closer);

  if not (resposta ->> 'changed')::boolean then
    raise exception 'C FALHOU: a troca reportou changed=false';
  end if;
  if (resposta ->> 'previousAgentId')::uuid <> emilia then
    raise exception 'C FALHOU: o padrao anterior reportado nao era Emilia';
  end if;
  if (resposta ->> 'agentId')::uuid <> closer then
    raise exception 'C FALHOU: o novo padrao reportado nao era Closer';
  end if;

  -- Um padrão, e é o Closer. Emília rebaixada, não apagada.
  select count(*) into padroes from public.assistant_profiles
  where organization_id = org and audience = 'customer' and is_default;
  if padroes <> 1 then
    raise exception 'C FALHOU: a audience customer ficou com % padroes', padroes;
  end if;
  if (select is_default from public.assistant_profiles where id = emilia) then
    raise exception 'C FALHOU: Emilia continuou padrao';
  end if;
  if not exists (select 1 from public.assistant_profiles where id = emilia) then
    raise exception 'C FALHOU: Emilia foi APAGADA em vez de rebaixada';
  end if;
  if not (select active from public.assistant_profiles where id = emilia) then
    raise exception 'C FALHOU: rebaixar Emilia desativou Emilia — active nao e do escopo da troca';
  end if;
  raise notice 'C ok: Closer promovido num ato; Emilia rebaixada, viva e ativa';

  -- D
  escolhido := private.intelligence_payload(
    org, 'customer', 'whatsapp', repeat('2', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,nome}';
  if escolhido <> 'Closer' then
    raise exception 'D FALHOU: o resolvedor continuou em % depois da troca', escolhido;
  end if;
  raise notice 'D ok: o resolvedor passou a falar por Closer — FASE F conversa com a FASE D';
end $$;

-- ===========================================================================
-- E: a troca não atravessa audience.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  interno text;
begin
  select display_name into interno from public.assistant_profiles
  where organization_id = org and audience = 'internal' and is_default;
  if interno <> 'Operacoes' then
    raise exception 'E FALHOU: o padrao interno virou %', interno;
  end if;
  if (select count(*) from public.assistant_profiles
      where organization_id = org and audience = 'internal' and is_default) <> 1 then
    raise exception 'E FALHOU: a audience internal nao tem exatamente 1 padrao';
  end if;
  raise notice 'E ok: promover um agente de clientes nao tocou no padrao interno';
end $$;

-- ===========================================================================
-- F: o item central. Padrão inativo RECUSA — não cai na Agenda, que está ativa.
-- G: e desativar o padrão não promoveu ninguém.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  closer uuid := 'dddddddd-0001-4000-8000-00000000fa5e';
  recusou boolean := false;
  resultado jsonb;
  padrao_agora uuid;
begin
  update public.assistant_profiles set active = false where id = closer;

  -- Agenda continua ativa, de propósito: é a tentação.
  if not (select active from public.assistant_profiles
          where organization_id = org and slug = 'agenda-agente') then
    raise exception 'F INVALIDO: a prova precisa da Agenda ativa';
  end if;

  begin
    resultado := private.intelligence_payload(
      org, 'customer', 'whatsapp', repeat('3', 64), 'ola', '{}'::jsonb, false
    );
  exception when others then
    recusou := true;
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'F FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
  end;

  if not recusou then
    raise exception 'F FALHOU: respondeu por % com o padrao inativo',
      resultado #>> '{assistente,nome}';
  end if;
  raise notice 'F ok: padrao inativo -> RECUSA. Agenda estava ativa e NAO foi usada';

  -- G
  select id into padrao_agora from public.assistant_profiles
  where organization_id = org and audience = 'customer' and is_default;
  if padrao_agora <> closer then
    raise exception 'G FALHOU: desativar o padrao promoveu outro agente (%)', padrao_agora;
  end if;
  raise notice 'G ok: desativar o padrao nao promoveu ninguem — quem decide e pessoa';

  update public.assistant_profiles set active = true where id = closer;
end $$;

-- ===========================================================================
-- H: gestor de OUTRA organização não troca o padrão desta.
-- ===========================================================================
do $$
declare
  closer uuid := 'dddddddd-0001-4000-8000-00000000fa5e';
  estranho uuid := 'cccccccc-000e-4000-8000-00000000fa5e';
  outra_org uuid := 'cccccccc-000f-4000-8000-00000000fa5e';
  recusou boolean := false;
  padrao_antes uuid;
  padrao_depois uuid;
begin
  insert into auth.users (id, email) values (estranho, 'estranho-fase-f@exemplo.invalido')
  on conflict (id) do nothing;
  insert into public.profiles (id, full_name) values (estranho, 'Gestor de outra org')
  on conflict (id) do nothing;
  insert into public.organizations (id, name, slug, created_by)
  values (outra_org, 'Outra organizacao FASE F', 'outra-organizacao-fase-f', estranho);
  insert into public.organization_members (organization_id, user_id, role, status, responsibility)
  values (outra_org, estranho, 'owner', 'active', 'Prova')
  on conflict (organization_id, user_id) do update set role = 'owner', status = 'active';

  select id into padrao_antes from public.assistant_profiles
  where organization_id = 'cccccccc-0001-4000-8000-00000000fa5e'
    and audience = 'customer' and is_default;

  -- Passa a ser o estranho: dono da SUA organização, nada na desta.
  perform set_config('request.jwt.claim.sub', estranho::text, false);

  begin
    perform public.nucleo_agent_set_default(closer);
  exception when others then
    recusou := true;
    if sqlerrm not like '%organization management required%' then
      raise exception 'H FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
  end;

  if not recusou then
    raise exception 'H FALHOU: um gestor de outra organizacao trocou o padrao desta';
  end if;

  select id into padrao_depois from public.assistant_profiles
  where organization_id = 'cccccccc-0001-4000-8000-00000000fa5e'
    and audience = 'customer' and is_default;
  if padrao_depois is distinct from padrao_antes then
    raise exception 'H FALHOU: o padrao mudou apesar da recusa';
  end if;
  raise notice 'H ok: gestor de outra organizacao recusado, e o padrao daqui nao mudou';

  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-00000000fa5e', false);
end $$;

-- ===========================================================================
-- I: a troca é atômica — e o modo de falha que ela EVITA, demonstrado.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  emilia uuid;
  padrao_antes uuid;
  padrao_depois uuid;
  sem_padrao integer;
begin
  select id into emilia from public.assistant_profiles where organization_id = org and slug = 'emilia';
  select id into padrao_antes from public.assistant_profiles
  where organization_id = org and audience = 'customer' and is_default;

  -- I.1: a função inteira dentro de um savepoint; erro depois dela desfaz
  -- TUDO que ela escreveu. Nunca sobra "um lado" da troca.
  begin
    perform public.nucleo_agent_set_default(emilia);
    raise exception 'interrupcao simulada';
  exception when others then
    if sqlerrm <> 'interrupcao simulada' then raise; end if;
  end;

  select id into padrao_depois from public.assistant_profiles
  where organization_id = org and audience = 'customer' and is_default;
  if padrao_depois is distinct from padrao_antes then
    raise exception 'I.1 FALHOU: o padrao mudou apesar do erro (% -> %)', padrao_antes, padrao_depois;
  end if;
  if (select count(*) from public.assistant_profiles
      where organization_id = org and audience = 'customer' and is_default) <> 1 then
    raise exception 'I.1 FALHOU: a organizacao ficou sem padrao (ou com dois) apos o erro';
  end if;
  raise notice 'I.1 ok: erro depois da troca preserva o padrao anterior — all-or-nothing';

  -- I.2: o modo de falha que a RPC existe para impedir. Duas escritas
  -- independentes, como o frontend faria; a segunda não acontece.
  begin
    update public.assistant_profiles set is_default = false where id = padrao_antes;
    -- ...e aqui a aba fecha / a rede cai / o token expira.
    select count(*) into sem_padrao from public.assistant_profiles
    where organization_id = org and audience = 'customer' and is_default;
    if sem_padrao <> 0 then
      raise exception 'I.2 INVALIDO: esperava a janela sem padrao para demonstrar';
    end if;
    raise exception 'desfazendo a demonstracao';
  exception when others then
    if sqlerrm <> 'desfazendo a demonstracao' then raise; end if;
  end;

  if (select count(*) from public.assistant_profiles
      where organization_id = org and audience = 'customer' and is_default) <> 1 then
    raise exception 'I.2 FALHOU: a demonstracao nao foi desfeita';
  end if;
  raise notice 'I.2 ok: em duas escritas soltas existe uma janela SEM padrao — e sem padrao o resolvedor recusa tudo. E por isso que a troca e RPC';
end $$;

-- ===========================================================================
-- J: idempotência — promover quem já é padrão não deixa a org sem padrão.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  atual uuid;
  resposta jsonb;
begin
  select id into atual from public.assistant_profiles
  where organization_id = org and audience = 'customer' and is_default;

  resposta := public.nucleo_agent_set_default(atual);
  if (resposta ->> 'changed')::boolean then
    raise exception 'J FALHOU: promover o proprio padrao reportou changed=true';
  end if;
  if (select count(*) from public.assistant_profiles
      where organization_id = org and audience = 'customer' and is_default) <> 1 then
    raise exception 'J FALHOU: duplo clique deixou a audience sem exatamente 1 padrao';
  end if;
  raise notice 'J ok: promover quem ja e padrao e inofensivo (changed=false)';
end $$;

-- ===========================================================================
-- K: um agente com várias skills.
-- L: uma skill em vários agentes.
-- M: desvincular de um agente não desvincula do outro.
-- ===========================================================================
do $$
declare
  org uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  dona uuid := 'cccccccc-0000-4000-8000-00000000fa5e';
  closer uuid := 'dddddddd-0001-4000-8000-00000000fa5e';
  agenda uuid := 'dddddddd-0002-4000-8000-00000000fa5e';
  skill_a uuid := '20000000-0000-0000-0000-000000000002';
  skill_b uuid := '20000000-0000-0000-0000-000000000003';
begin
  -- K: Closer recebe duas skills.
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values (org, closer, skill_a, 10, dona), (org, closer, skill_b, 20, dona)
  on conflict (profile_id, skill_id) do nothing;
  if (select count(*) from public.assistant_profile_skills
      where organization_id = org and profile_id = closer) < 2 then
    raise exception 'K FALHOU: o agente nao ficou com duas skills';
  end if;
  raise notice 'K ok: um agente carrega varias skills';

  -- L: a MESMA skill também na Agenda.
  --
  -- A contagem aqui é por AGENTE, não total: `provision_intelligence` já
  -- amarra esta skill ao agente padrão de clientes quando a organização
  -- nasce, então o total inclui a Emilia. O que a prova afirma é que Closer e
  -- Agenda passam a tê-la ao mesmo tempo — não que existam exatamente dois
  -- vínculos no mundo.
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values (org, agenda, skill_a, 10, dona)
  on conflict (profile_id, skill_id) do nothing;
  if not exists (select 1 from public.assistant_profile_skills
                 where organization_id = org and profile_id = closer and skill_id = skill_a)
     or not exists (select 1 from public.assistant_profile_skills
                    where organization_id = org and profile_id = agenda and skill_id = skill_a) then
    raise exception 'L FALHOU: a mesma skill nao ficou em Closer E Agenda ao mesmo tempo';
  end if;
  if (select count(distinct profile_id) from public.assistant_profile_skills
      where organization_id = org and skill_id = skill_a) < 2 then
    raise exception 'L FALHOU: a skill nao esta em mais de um agente';
  end if;
  raise notice 'L ok: a mesma skill vive em varios agentes — a relacao e N:N por profile_id';

  -- M: desvincular do Closer não mexe na Agenda.
  delete from public.assistant_profile_skills
  where organization_id = org and profile_id = closer and skill_id = skill_a;

  if exists (select 1 from public.assistant_profile_skills
             where organization_id = org and profile_id = closer and skill_id = skill_a) then
    raise exception 'M FALHOU: a skill nao saiu do Closer';
  end if;
  if not exists (select 1 from public.assistant_profile_skills
                 where organization_id = org and profile_id = agenda and skill_id = skill_a) then
    raise exception 'M FALHOU: desvincular do Closer removeu a skill da Agenda tambem';
  end if;
  raise notice 'M ok: desvincular de um agente nao desvincula do outro';
end $$;

rollback;

-- ===========================================================================
-- Pós-rollback: nada vazou.
-- ===========================================================================
do $$
begin
  if exists (select 1 from public.organizations where id in (
    'cccccccc-0001-4000-8000-00000000fa5e',
    'cccccccc-000f-4000-8000-00000000fa5e'
  )) then
    raise exception 'POS-ROLLBACK FALHOU: organizacao da prova sobreviveu';
  end if;
  if exists (select 1 from public.assistant_profiles
             where slug in ('emilia', 'closer', 'agenda-agente', 'operacoes', 'qa')) then
    raise exception 'POS-ROLLBACK FALHOU: agente da prova sobreviveu';
  end if;
  raise notice 'POS-ROLLBACK ok: nada da prova sobreviveu';
  raise notice 'PROVA DA FASE F: TODOS OS ITENS PASSARAM';
end $$;
