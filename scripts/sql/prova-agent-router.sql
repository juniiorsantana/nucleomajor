-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Prova COMPORTAMENTAL da FASE 13, primeira fatia (Agent Router no Supabase,
-- migration `20260905220000_fase_13_agent_router.sql`).
--
-- NUNCA rode isto em produção. O script cria agentes, campanhas, skills,
-- organização e credencial de robô de mentira, e desliga o agente padrão no
-- meio do caminho. Tudo termina em ROLLBACK, mas gatilhos de auditoria
-- disparam e sequências avançam de qualquer jeito, e um `commit` digitado por
-- engano deixaria lixo numa base real.
--
-- `test/agent-router-migration.test.mjs` prova que a migration DECLARA a
-- precedência certa. Este arquivo prova que o Postgres a APLICA — e,
-- principalmente, prova os dois casos que nenhuma leitura de SQL prova
-- sozinha: que um agente pinado inativo faz o sistema RECUSAR em vez de
-- devolver a conversa ao padrão, e que o padrão ativo não rouba de volta uma
-- conversa que já pertence a outro agente.
--
-- Sequência completa, num Postgres descartável:
--   1. harness-supabase-minimo.sql
--   2. migrations do repositório, em ordem, até a FASE B (20260904160000)
--      inclusive — NÃO aplicar a FASE C ainda
--   3. prova-agente-padrao-seed.sql        <-- fixtures pré-C, COMMIT
--   4. 20260904190000  (FASE C)
--   5. 20260904230000  (FASE D)
--   6. 20260905000000  (FASE E)
--   7. 20260905120000 e 20260905160000  (FASE F, nesta ordem)
--   8. 20260905200000  (hardening da RPC da FASE F)
--   9. 20260905220000  (FASE 13 — o que está sendo provado)
--  10. este arquivo
--
-- Ao contrário da prova da FASE D, aqui NÃO é preciso remover constraint
-- nenhuma para montar o cenário de dois agentes: a FASE E já removeu
-- `unique (organization_id, audience)`. Se este script precisar de um `alter
-- table` algum dia, é sinal de que a sequência acima foi rodada errada.
--
-- Itens:
--   A    o padrão ativo continua atendendo (nada regrediu);
--   B    conversa pinada em agente não-padrão vence o padrão;
--   C    o padrão ativo não sobrescreve a afinidade, nem depois de persistir;
--   D    agente pinado inativo RECUSA, mesmo com o padrão ativo ao lado;
--   E    campanha elegível seleciona o agente dela, e não o padrão;
--   F    agente da campanha inativo RECUSA, sem cair no padrão;
--   G    campanha de audience/organização incompatível não atravessa escopo;
--   H    sem afinidade e sem campanha, o padrão é usado;
--   I    nenhum agente é escolhido por `limit 1` sem critério (+ controle
--        negativo: a regra antiga teria escolhido alguém);
--   J    `schemaVersion` e `runtimeContext.assistant` seguem compatíveis;
--   K    o v3 continua lendo o `assistant_profile_id` pinado — ponta a ponta;
--   L    pós-rollback: a prova não deixou estado.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- SETUP. Identificadores fixos e obviamente falsos, para o item L reencontrar
-- cada linha sem depender de `limit 1` numa tabela que não controla.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  auth_robo uuid := 'bbbbbbbb-0003-4000-8000-00000000fa5e';
  agente_a uuid;
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  campanha_b uuid := 'bbbbbbbb-0002-4000-8000-00000000fa5e';
  conexao uuid := 'bbbbbbbb-0004-4000-8000-00000000fa5e';
  campanhas_padrao integer;
begin
  -- O agente padrão de clientes, que veio do seed. Por id fixo não dá: ele
  -- nasce do gatilho de provisionamento. Por (organização, audience,
  -- is_default) dá, e é exatamente o critério que a fase inteira defende.
  select id into strict agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  update public.assistant_profiles set active = true where id = agente_a;

  -- O segundo agente do mesmo público: ativo, e deliberadamente NÃO padrão.
  insert into public.assistant_profiles (
    id, organization_id, template_id, audience, display_name, slug,
    created_by, updated_by, is_default, active
  ) values (
    agente_b, organizacao,
    (select template_id from public.assistant_profiles where id = agente_a),
    'customer', 'SDR da prova', 'sdr-da-prova', ator, ator, false, true
  );

  -- Campanha vinculada ao agente B, elegível só por keyword. Sem keyword na
  -- mensagem, ela não entra — é o que separa os itens E e H.
  insert into public.organization_campaigns (
    id, organization_id, assistant_profile_id, name, status,
    is_default, created_by, updated_by
  ) values (
    campanha_b, organizacao, agente_b, 'Campanha da prova FASE 13', 'test',
    false, ator, ator
  );
  insert into public.campaign_sources (
    organization_id, campaign_id, source_type, source_value, active
  ) values (organizacao, campanha_b, 'keyword', 'orcamento', true);

  -- Se o seed trouxe alguma campanha padrão, ela casaria com QUALQUER mensagem
  -- e o item H deixaria de provar o que promete. Desligar aqui dentro (a
  -- transação volta no fim) e registrar.
  select count(*) into campanhas_padrao from public.organization_campaigns
  where organization_id = organizacao and is_default and status in ('test', 'active');
  if campanhas_padrao > 0 then
    update public.organization_campaigns set is_default = false
    where organization_id = organizacao and is_default and status in ('test', 'active');
    raise notice 'SETUP: % campanha(s) padrao desligada(s) para nao capturar toda mensagem', campanhas_padrao;
  end if;

  -- Credencial de robô simulada, para os itens que entram por
  -- `private.robot_organization()` (o v3, item K).
  insert into auth.users (id, email)
  values (auth_robo, 'robo-da-prova-fase-13@exemplo.invalido')
  on conflict (id) do nothing;
  insert into public.profiles (id, full_name)
  values (auth_robo, 'Robo da prova FASE 13')
  on conflict (id) do nothing;
  insert into public.whatsapp_connections (id, organization_id, name, status)
  values (conexao, organizacao, 'Conexao da prova FASE 13', 'connected');
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

  raise notice 'SETUP ok: padrao %, nao-padrao %, campanha % por keyword "orcamento"',
    agente_a, agente_b, campanha_b;
end $$;

-- ===========================================================================
-- A: o padrão ativo continua atendendo. É o comportamento de hoje, e a fatia
--    não pode tê-lo mudado para conversa nova sem campanha.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_a uuid;
  resolvido text;
begin
  select id into strict agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  resolvido := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('a', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,id}';

  if resolvido is distinct from agente_a::text then
    raise exception 'A FALHOU: conversa nova sem campanha resolveu % em vez do padrao %',
      resolvido, agente_a;
  end if;
  raise notice 'A PASS: conversa nova sem campanha continua indo para o agente padrao';
end $$;

-- ===========================================================================
-- B: conversa PINADA em agente não-padrão vence o padrão. É a fase inteira em
--    um item: antes desta migration, o padrão respondia aqui.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_a uuid;
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  hash_conversa text := repeat('b', 64);
  resolvido text;
begin
  select id into strict agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  insert into public.conversation_intelligence_contexts (
    organization_id, assistant_profile_id, audience, channel, conversation_key_hash
  ) values (organizacao, agente_b, 'customer', 'simulator', hash_conversa);

  resolvido := private.intelligence_payload(
    organizacao, 'customer', 'simulator', hash_conversa, 'ola', '{}'::jsonb, false
  ) #>> '{assistente,id}';

  if resolvido is distinct from agente_b::text then
    raise exception 'B FALHOU: a conversa pinada em % foi atendida por % (o padrao e %)',
      agente_b, resolvido, agente_a;
  end if;
  raise notice 'B PASS: a conversa pinada e atendida pelo agente dela, nao pelo padrao';
end $$;

-- ===========================================================================
-- C: o padrão ativo NÃO sobrescreve a afinidade — nem no payload, nem na
--    persistência. Este item existe porque o corpo da FASE D fazia
--    exatamente isso: `set assistant_profile_id = selected_profile.id`, com
--    selected_profile sendo sempre o padrão. A afinidade tinha campo e não
--    tinha efeito.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  hash_conversa text := repeat('b', 64);
  gravado uuid;
  resolvido text;
begin
  -- Persistindo de verdade, que é como o runtime chama.
  perform private.intelligence_payload(
    organizacao, 'customer', 'simulator', hash_conversa, 'ola de novo', '{}'::jsonb, true
  );

  select assistant_profile_id into strict gravado
  from public.conversation_intelligence_contexts
  where organization_id = organizacao and conversation_key_hash = hash_conversa
    and channel = 'simulator' and state = 'active';

  if gravado is distinct from agente_b then
    raise exception 'C FALHOU: depois de persistir, a conversa passou a apontar para % em vez de %',
      gravado, agente_b;
  end if;

  -- E o turno seguinte continua no mesmo agente.
  resolvido := private.intelligence_payload(
    organizacao, 'customer', 'simulator', hash_conversa, 'terceiro turno', '{}'::jsonb, true
  ) #>> '{assistente,id}';
  if resolvido is distinct from agente_b::text then
    raise exception 'C FALHOU: o terceiro turno escapou para %', resolvido;
  end if;
  raise notice 'C PASS: persistir nao devolve a conversa ao padrao; a afinidade sobrevive aos turnos';
end $$;

-- ===========================================================================
-- D: agente pinado INATIVO recusa, mesmo havendo padrão ativo ao lado. Este é
--    o item que a fatia existe para garantir. Cair no padrão aqui significa
--    trocar personalidade, skills e conhecimento no meio da conversa sem
--    avisar ninguém.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_a uuid;
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  hash_conversa text := repeat('b', 64);
  recusou boolean := false;
begin
  select id into strict agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  if not (select active from public.assistant_profiles where id = agente_a) then
    raise exception 'D FALHOU: o cenario exige o padrao ATIVO ao lado, senao nao prova nada';
  end if;

  update public.assistant_profiles set active = false where id = agente_b;

  begin
    perform private.intelligence_payload(
      organizacao, 'customer', 'simulator', hash_conversa, 'oi', '{}'::jsonb, false
    );
  exception when others then
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'D FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;

  if not recusou then
    raise exception 'D FALHOU: agente pinado inativo caiu no padrao — e exatamente isso que a fatia proibe';
  end if;
  raise notice 'D PASS: agente pinado inativo RECUSA, com a mensagem publica de sempre';

  update public.assistant_profiles set active = true where id = agente_b;
end $$;

-- ===========================================================================
-- E: conversa NOVA que casa com campanha elegível é atendida pelo agente DA
--    CAMPANHA. Antes, o padrão respondia com a campanha de outro agente
--    colada no contexto — a mistura que a fase remove.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_a uuid;
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  campanha_b uuid := 'bbbbbbbb-0002-4000-8000-00000000fa5e';
  resultado jsonb;
begin
  select id into strict agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('e', 64),
    'queria um orcamento, por favor', '{}'::jsonb, false
  );

  if (resultado #>> '{assistente,id}') is distinct from agente_b::text then
    raise exception 'E FALHOU: a campanha de % foi atendida por % (padrao %)',
      agente_b, resultado #>> '{assistente,id}', agente_a;
  end if;
  if (resultado #>> '{campanha,id}') is distinct from campanha_b::text then
    raise exception 'E FALHOU: a campanha resolvida foi % em vez de %',
      resultado #>> '{campanha,id}', campanha_b;
  end if;
  raise notice 'E PASS: campanha elegivel leva a conversa nova para o agente dela';
end $$;

-- ===========================================================================
-- F: agente da campanha INATIVO recusa, sem fallback para o padrão. Aqui a
--    decisão é a mesma do item D, e por um motivo diferente: se a campanha
--    pertence a um agente parado, atender por outro entrega a oferta errada
--    com a voz errada.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_a uuid;
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  recusou boolean := false;
begin
  select id into strict agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  if not (select active from public.assistant_profiles where id = agente_a) then
    raise exception 'F FALHOU: o cenario exige o padrao ATIVO ao lado';
  end if;

  update public.assistant_profiles set active = false where id = agente_b;

  begin
    perform private.intelligence_payload(
      organizacao, 'customer', 'simulator', repeat('f', 64),
      'quero um orcamento', '{}'::jsonb, false
    );
  exception when others then
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'F FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;

  if not recusou then
    raise exception 'F FALHOU: campanha de agente inativo caiu no padrao';
  end if;
  raise notice 'F PASS: campanha de agente inativo RECUSA, sem fallback silencioso';

  update public.assistant_profiles set active = true where id = agente_b;
end $$;

-- ===========================================================================
-- G: escopo. A campanha não pode arrastar a conversa para um agente de outro
--    público (G.1) nem de outra organização (G.2, impedido pela FK composta),
--    e a conversa de uma organização não enxerga contexto de outra (G.3).
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  organizacao_2 uuid := 'bbbbbbbb-0005-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  campanha_b uuid := 'bbbbbbbb-0002-4000-8000-00000000fa5e';
  agente_interno uuid;
  agente_de_fora uuid;
  hash_pinado text := repeat('b', 64);
  recusou boolean := false;
  resolvido text;
begin
  -- G.1 — campanha de clientes apontando para agente INTERNO: recusa, não cai
  --       no padrão de clientes.
  select id into strict agente_interno from public.assistant_profiles
  where organization_id = organizacao and audience = 'internal' and is_default;

  update public.organization_campaigns set assistant_profile_id = agente_interno
  where id = campanha_b;

  begin
    perform private.intelligence_payload(
      organizacao, 'customer', 'simulator', repeat('7', 64),
      'quero um orcamento', '{}'::jsonb, false
    );
  exception when others then
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'G.1 FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;
  if not recusou then
    raise exception 'G.1 FALHOU: campanha apontando para agente de outro publico nao deveria resolver';
  end if;
  raise notice 'G.1 PASS: campanha de clientes com agente interno recusa, sem cair no padrao';

  update public.organization_campaigns set assistant_profile_id = agente_b
  where id = campanha_b;

  -- G.2 — outra organização é impedida pela ESTRUTURA, não por política: a FK
  --       composta (assistant_profile_id, organization_id).
  insert into public.organizations (id, name, slug, created_by)
  values (organizacao_2, 'Organizacao 2 da prova FASE 13', 'organizacao-2-prova-fase-13', ator);

  select id into strict agente_de_fora from public.assistant_profiles
  where organization_id = organizacao_2 and audience = 'customer' and is_default;

  begin
    update public.organization_campaigns set assistant_profile_id = agente_de_fora
    where id = campanha_b;
    raise exception 'G.2 FALHOU: aceitou campanha apontando para agente de outra organizacao';
  exception when foreign_key_violation then
    raise notice 'G.2 PASS: a FK composta recusa campanha apontando para agente de outra organizacao';
  end;

  -- G.3 — a mesma chave de conversa, em outra organização, não enxerga a
  --       afinidade da primeira: resolve o padrão da organização 2.
  resolvido := private.intelligence_payload(
    organizacao_2, 'customer', 'simulator', hash_pinado, 'ola', '{}'::jsonb, false
  ) #>> '{assistente,id}';
  if resolvido is distinct from agente_de_fora::text then
    raise exception 'G.3 FALHOU: a organizacao 2 resolveu % em vez do proprio padrao %',
      resolvido, agente_de_fora;
  end if;
  if resolvido = agente_b::text then
    raise exception 'G.3 FALHOU: a afinidade atravessou organizacao';
  end if;
  raise notice 'G.3 PASS: a mesma chave de conversa em outra organizacao nao herda a afinidade';
end $$;

-- ===========================================================================
-- H: sem afinidade e sem campanha, o padrão é usado. O caminho de todo dia,
--    que a fatia não pode ter quebrado ao criar dois ramos novos antes dele.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_a uuid;
  resultado jsonb;
begin
  select id into strict agente_a from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('8', 64),
    'bom dia, tudo bem?', '{}'::jsonb, false
  );
  if (resultado #>> '{assistente,id}') is distinct from agente_a::text then
    raise exception 'H FALHOU: sem afinidade e sem campanha resolveu % em vez do padrao %',
      resultado #>> '{assistente,id}', agente_a;
  end if;
  if (resultado #>> '{campanha,id}') is not null then
    raise exception 'H FALHOU: nenhuma campanha deveria ter casado, e casou %',
      resultado #>> '{campanha,id}';
  end if;

  -- E o público interno, que nunca passa por campanha, continua no padrão dele.
  if (private.intelligence_payload(
        organizacao, 'internal', 'web', repeat('9', 64), 'ola', '{}'::jsonb, false
      ) #>> '{assistente,id}') is distinct from (
        select id::text from public.assistant_profiles
        where organization_id = organizacao and audience = 'internal' and is_default
      ) then
    raise exception 'H FALHOU: o publico interno deixou de resolver o proprio padrao';
  end if;
  raise notice 'H PASS: sem afinidade e sem campanha, o padrao atende — nos dois publicos';
end $$;

-- ===========================================================================
-- I: nenhum agente é escolhido por `limit 1` sem critério. Sem padrão, com um
--    agente ativo disponível ao lado, tem de falhar fechado — e o controle
--    negativo mostra que a regra antiga teria escolhido alguém.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  escolhido_pela_regra_antiga uuid;
  recusou boolean := false;
begin
  update public.assistant_profiles set is_default = false
  where organization_id = organizacao and audience = 'customer';

  begin
    perform private.intelligence_payload(
      organizacao, 'customer', 'simulator', repeat('1', 64), 'ola', '{}'::jsonb, false
    );
  exception when others then
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'I FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
    recusou := true;
  end;
  if not recusou then
    raise exception 'I FALHOU: sem padrao, e com dois agentes ativos, deveria falhar fechado';
  end if;

  -- Controle negativo: a prova sabe reprovar? A regra antiga (audience +
  -- active + limit 1) encontra alguém no MESMO estado em que a nova recusou.
  select id into escolhido_pela_regra_antiga
  from public.assistant_profiles profile
  where profile.organization_id = organizacao
    and profile.audience = 'customer' and profile.active
  limit 1;
  if escolhido_pela_regra_antiga is null then
    raise exception 'I FALHOU: o controle negativo nao encontrou ninguem; o cenario nao estava montado';
  end if;
  raise notice 'I PASS: sem padrao falha fechado; a regra antiga teria sorteado %',
    escolhido_pela_regra_antiga;

  -- Devolve o padrão ao agente A (o que NÃO é o agente_b).
  update public.assistant_profiles set is_default = true
  where organization_id = organizacao and audience = 'customer' and id <> agente_b;
end $$;

-- ===========================================================================
-- J: o contrato de saída não mudou. É o que o runtime valida na borda: um
--    campo a mais ou a menos aqui derruba o turno em produção.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  resultado jsonb;
  chaves text[];
begin
  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('a', 64), 'ola', '{}'::jsonb, false
  );

  if (resultado ->> 'schemaVersion') is distinct from 'fase-h-1' then
    raise exception 'J FALHOU: schemaVersion virou %', resultado ->> 'schemaVersion';
  end if;

  select array_agg(chave order by chave) into chaves
  from jsonb_object_keys(resultado -> 'assistente') chave;
  if chaves is distinct from array['id', 'marca', 'nome', 'processo', 'templateId', 'tom'] then
    raise exception 'J FALHOU: as chaves de assistente mudaram: %', chaves;
  end if;

  select array_agg(chave order by chave) into chaves
  from jsonb_object_keys(resultado) chave;
  if chaves is distinct from array[
    'assistente', 'audiencia', 'campanha', 'colecoesPermitidas', 'contextoId',
    'politicas', 'schemaVersion', 'skillAtivo', 'skillsPermitidos'
  ] then
    raise exception 'J FALHOU: as chaves de primeiro nivel do payload mudaram: %', chaves;
  end if;
  raise notice 'J PASS: schemaVersion e as chaves do payload seguem as de sempre';
end $$;

-- ===========================================================================
-- K: o v3 continua lendo o `assistant_profile_id` PINADO — ponta a ponta, e
--    não por introspecção.
--
--    O discriminador é a skill de recepção: ela é publicada e vinculada
--    SOMENTE ao agente B. Se o v3 (ou o payload, por baixo dele) resolvesse o
--    padrão, o v3 morreria em 'published reception skill is required for
--    customer routing'. Ele só consegue responder se estiver mesmo lendo o
--    agente da conversa.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  agente_b uuid := 'bbbbbbbb-0001-4000-8000-00000000fa5e';
  skill_recepcao uuid := 'bbbbbbbb-0006-4000-8000-00000000fa5e';
  hash_conversa text := repeat('c', 64);
  resultado jsonb;
begin
  insert into public.skill_definitions (
    id, owner_type, organization_id, slug, name, audience, status, spec,
    created_by, updated_by
  ) values (
    skill_recepcao, 'organization', organizacao, 'recepcao-da-prova',
    'Recepcao da prova FASE 13', 'customer', 'published',
    -- `instructionsMarkdown` com pelo menos 80 caracteres e `allowedTools`
    -- dentro da lista fechada: são as duas exigências que o v3 faz da skill
    -- antes de responder (`published skill instructions are invalid` /
    -- `published skill contains an unsupported tool`).
    jsonb_build_object(
      'routing', jsonb_build_object('fallback', true),
      'objective', 'Acolher e entender a necessidade',
      'allowedTools', jsonb_build_array('knowledge.search'),
      'instructionsMarkdown', repeat('Acolha o cliente com clareza e nao prometa nada. ', 4)
    ),
    ator, ator
  );
  insert into public.assistant_profile_skills (
    organization_id, profile_id, skill_id, enabled, priority, updated_by
  ) values (organizacao, agente_b, skill_recepcao, true, 10, ator);

  -- A conversa do WhatsApp já pertence ao agente B.
  insert into public.conversation_intelligence_contexts (
    organization_id, assistant_profile_id, audience, channel, conversation_key_hash
  ) values (organizacao, agente_b, 'customer', 'whatsapp', hash_conversa);

  resultado := public.nucleo_intelligence_context_resolve_v3(hash_conversa, '', 'ola', '{}'::jsonb);

  if (resultado #>> '{runtimeContext,assistant,id}') is distinct from agente_b::text
     and (resultado #>> '{assistente,id}') is distinct from agente_b::text then
    raise exception 'K FALHOU: o v3 respondeu pelo agente % / %, e nao pelo pinado %',
      resultado #>> '{runtimeContext,assistant,id}', resultado #>> '{assistente,id}', agente_b;
  end if;
  if (resultado ->> 'schemaVersion') is distinct from 'fase-h-3' then
    raise exception 'K FALHOU: o schemaVersion do v3 virou %', resultado ->> 'schemaVersion';
  end if;
  raise notice 'K PASS: o v3 resolve pelo agente pinado, e o contrato fase-h-3 segue de pe';
end $$;

rollback;

-- ===========================================================================
-- L: pós-rollback. Se este item reprovar, o banco de teste ficou num estado
--    que não representa produção — e qualquer prova seguinte estaria olhando
--    lixo desta.
-- ===========================================================================
do $$
declare
  sobrou text[] := '{}';
begin
  if exists (select 1 from public.assistant_profiles where id = 'bbbbbbbb-0001-4000-8000-00000000fa5e') then
    sobrou := sobrou || 'agente nao-padrao';
  end if;
  if exists (select 1 from public.organization_campaigns where id = 'bbbbbbbb-0002-4000-8000-00000000fa5e') then
    sobrou := sobrou || 'campanha';
  end if;
  if exists (select 1 from public.connection_robot_credentials where auth_user_id = 'bbbbbbbb-0003-4000-8000-00000000fa5e') then
    sobrou := sobrou || 'credencial de robo';
  end if;
  if exists (select 1 from public.whatsapp_connections where id = 'bbbbbbbb-0004-4000-8000-00000000fa5e') then
    sobrou := sobrou || 'conexao';
  end if;
  if exists (select 1 from public.organizations where id = 'bbbbbbbb-0005-4000-8000-00000000fa5e') then
    sobrou := sobrou || 'organizacao 2';
  end if;
  if exists (select 1 from public.skill_definitions where id = 'bbbbbbbb-0006-4000-8000-00000000fa5e') then
    sobrou := sobrou || 'skill de recepcao';
  end if;
  if exists (
    select 1 from public.conversation_intelligence_contexts
    where conversation_key_hash in (repeat('b', 64), repeat('c', 64))
  ) then
    sobrou := sobrou || 'contexto de conversa';
  end if;

  if cardinality(sobrou) > 0 then
    raise exception 'L FALHOU: a prova deixou estado: %', array_to_string(sobrou, ', ');
  end if;

  -- E o padrão da organização do seed continua sendo um só, ativo.
  if (select count(*) from public.assistant_profiles
      where organization_id = 'aaaaaaaa-0001-4000-8000-00000000fa5e'
        and audience = 'customer' and is_default) <> 1 then
    raise exception 'L FALHOU: a organizacao do seed nao tem exatamente um padrao de clientes';
  end if;
  raise notice 'L PASS: nada da prova sobreviveu ao rollback, e o padrao do seed esta intacto';
end $$;
