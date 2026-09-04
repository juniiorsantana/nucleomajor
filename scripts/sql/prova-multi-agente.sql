-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Prova COMPORTAMENTAL da FASE E (a audience deixa de valer por um agente só).
--
-- NUNCA rode isto em produção. Ele cria agentes de mentira, desliga o padrão,
-- remove o padrão e provisiona organizações falsas. Termina em ROLLBACK, mas
-- gatilhos de auditoria disparam e sequências avançam de qualquer jeito, e um
-- `commit` digitado por engano deixaria lixo numa base que importa.
--
-- O que esta prova existe para responder, e que nenhuma leitura de SQL
-- responde: **agora que o banco PERMITE N agentes por audience, o produto
-- continua falando por um só — o padrão — e recusa quando ele não pode
-- atender, em vez de passar a vez para o vizinho.**
--
-- Sequência completa, num Postgres descartável:
--   1. harness-supabase-minimo.sql
--   2. migrations do repositório até a FASE B (20260904160000) inclusive
--   3. prova-agente-padrao-seed.sql        <-- fixtures pré-C, COMMIT
--   4. migration da FASE C (20260904190000)
--   5. migration da FASE D (20260904230000)
--   6. migration da FASE E (20260905000000)
--   7. este arquivo
--
-- Itens:
--   A    a unique antiga saiu e o que segura a integridade continua.
--   B-C  2 e depois 3 agentes customer na mesma organização (+2 internal).
--   D    dois padrões na mesma audience continuam rejeitados.
--   E    customer e internal, cada um com o seu padrão, convivem.
--   F    o resolvedor escolhe o padrão, com 3 candidatos disponíveis.
--   G    padrão inativo RECUSA — não cai no não-padrão ativo.
--   H    sem padrão nenhum, falha fechado.
--   I-J  provision_intelligence: idempotente e preserva não-padrão.
--   K    slug com N agentes.
--   L    RLS não passou a depender de audience.
--   N    a FASE E não inventou Agent Router.
--
-- (M — a UI não escolher agente por `.find(audience)` — é JavaScript e está
-- em test/agent-multi-audience.test.mjs, não aqui.)

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- SETUP: credencial de robô simulada, para o item F.2
-- (`nucleo_customer_assistant_access` lê a organização do JWT, não recebe).
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  auth_robo uuid := 'aaaaaaaa-0004-4000-8000-00000000fa5e';
  conexao uuid;
begin
  insert into auth.users (id, email)
  values (auth_robo, 'robo-da-prova-fase-e@exemplo.invalido')
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name)
  values (auth_robo, 'Robo da prova FASE E')
  on conflict (id) do nothing;

  insert into public.whatsapp_connections (id, organization_id, name, status)
  values (gen_random_uuid(), organizacao, 'Conexao da prova FASE E', 'connected')
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

  raise notice 'SETUP ok: robo simulado para organizacao % via conexao %', organizacao, conexao;
end $$;

-- ===========================================================================
-- A: a unique antiga saiu, e só ela.
-- ===========================================================================
do $$
declare
  faltando text;
begin
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.assistant_profiles'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(c.conkey) as k(attnum)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['audience', 'organization_id']
  ) then
    raise exception 'A FALHOU: unique (organization_id, audience) ainda existe';
  end if;

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
    raise exception 'A FALHOU: indice(s) levado(s) junto: %', faltando;
  end if;

  raise notice 'A ok: unique (organization_id, audience) removida; pkey, padrao, slug e (id,org) intactos';
end $$;

-- ===========================================================================
-- B: dois agentes customer na mesma organização. Impossível antes desta fase.
-- C: e um terceiro, mais dois internal — o cenário do item 12 da etapa.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  customers integer;
  internals integer;
begin
  -- B: o segundo customer.
  insert into public.assistant_profiles (
    id, organization_id, template_id, audience, display_name,
    created_by, updated_by, is_default
  ) values (
    'bbbbbbbb-0002-4000-8000-00000000fa5e', organizacao,
    '10000000-0000-0000-0000-000000000002', 'customer',
    'Agente de vendas da prova', ator, ator, false
  );

  select count(*) into customers from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer';
  if customers <> 2 then
    raise exception 'B FALHOU: esperava 2 agentes customer e encontrei %', customers;
  end if;
  raise notice 'B ok: 2 agentes customer coexistem';

  -- C: o terceiro customer, e o segundo internal.
  insert into public.assistant_profiles (
    id, organization_id, template_id, audience, display_name,
    created_by, updated_by, is_default
  ) values (
    'bbbbbbbb-0003-4000-8000-00000000fa5e', organizacao,
    '10000000-0000-0000-0000-000000000002', 'customer',
    'Agente de suporte da prova', ator, ator, false
  ), (
    'bbbbbbbb-0004-4000-8000-00000000fa5e', organizacao,
    '10000000-0000-0000-0000-000000000001', 'internal',
    'Agente interno secundario da prova', ator, ator, false
  );

  select count(*) into customers from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer';
  select count(*) into internals from public.assistant_profiles
  where organization_id = organizacao and audience = 'internal';
  if customers <> 3 then
    raise exception 'C FALHOU: esperava 3 agentes customer e encontrei %', customers;
  end if;
  if internals <> 2 then
    raise exception 'C FALHOU: esperava 2 agentes internal e encontrei %', internals;
  end if;
  raise notice 'C ok: 3 customer + 2 internal na mesma organizacao';
end $$;

-- ===========================================================================
-- D: dois padrões na mesma audience continuam REJEITADOS.
--    É o índice parcial da FASE C assumindo o posto que a unique deixou.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  recusou boolean := false;
begin
  begin
    update public.assistant_profiles
    set is_default = true
    where id = 'bbbbbbbb-0002-4000-8000-00000000fa5e';
  exception when unique_violation then
    recusou := true;
  end;

  if not recusou then
    raise exception 'D FALHOU: o banco aceitou um SEGUNDO agente padrao em customer';
  end if;

  -- E o padrão de verdade continua sendo um só.
  if (select count(*) from public.assistant_profiles
      where organization_id = organizacao and audience = 'customer' and is_default) <> 1 then
    raise exception 'D FALHOU: a audience customer nao tem exatamente 1 padrao';
  end if;
  raise notice 'D ok: segundo padrao rejeitado pelo indice parcial';
end $$;

-- ===========================================================================
-- E: customer e internal, cada um com o seu padrão, ao mesmo tempo.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  padroes integer;
begin
  select count(*) into padroes from public.assistant_profiles
  where organization_id = organizacao and is_default;
  if padroes <> 2 then
    raise exception 'E FALHOU: esperava 2 padroes (1 por audience) e encontrei %', padroes;
  end if;
  if not exists (
    select 1 from public.assistant_profiles
    where organization_id = organizacao and audience = 'internal' and is_default
  ) or not exists (
    select 1 from public.assistant_profiles
    where organization_id = organizacao and audience = 'customer' and is_default
  ) then
    raise exception 'E FALHOU: falta o padrao de alguma audience';
  end if;
  raise notice 'E ok: um padrao por audience, com 5 agentes na organizacao';
end $$;

-- ===========================================================================
-- F: o resolvedor escolhe o PADRÃO, tendo 3 candidatos customer disponíveis.
--    F.1 `private.intelligence_payload` (por onde passam v1, v2, v3, preview)
--    F.2 `nucleo_customer_assistant_access` (seleção própria)
--    F.3 internal: o payload escolhe o padrão interno, com 2 candidatos
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  padrao_customer uuid;
  padrao_internal uuid;
  resultado jsonb;
  escolhido uuid;
begin
  select id into padrao_customer from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  select id into padrao_internal from public.assistant_profiles
  where organization_id = organizacao and audience = 'internal' and is_default;

  -- F.1
  resultado := private.intelligence_payload(
    organizacao, 'customer', 'whatsapp', repeat('f', 64), 'ola', '{}'::jsonb, false
  );
  escolhido := (resultado #>> '{assistente,id}')::uuid;
  if escolhido <> padrao_customer then
    raise exception 'F.1 FALHOU: payload escolheu % em vez do padrao %', escolhido, padrao_customer;
  end if;
  raise notice 'F.1 ok: payload escolheu o padrao customer entre 3 candidatos';

  -- F.3
  resultado := private.intelligence_payload(
    organizacao, 'internal', 'whatsapp', repeat('e', 64), 'ola', '{}'::jsonb, false
  );
  escolhido := (resultado #>> '{assistente,id}')::uuid;
  if escolhido <> padrao_internal then
    raise exception 'F.3 FALHOU: payload escolheu % em vez do padrao interno %', escolhido, padrao_internal;
  end if;
  raise notice 'F.3 ok: payload escolheu o padrao internal entre 2 candidatos';
end $$;

-- F.2: `nucleo_customer_assistant_access` tem seleção própria e precisa achar
-- o mesmo padrão. Com `rollout.mode` ausente ela devolve `rollout_off` — o que
-- já prova que ela ENCONTROU o padrão (o caminho de perfil ausente/inativo
-- devolveria `profile_inactive`).
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  padrao_customer uuid;
  resposta jsonb;
begin
  select id into padrao_customer from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  -- Marca o padrão com um rollout reconhecível, e um NÃO-padrão com rollout
  -- 'active'. Se a função pegasse o agente errado, ela devolveria 'active'.
  update public.assistant_profiles
  set process_config = jsonb_set(coalesce(process_config, '{}'::jsonb), '{rollout}',
        jsonb_build_object('mode', 'off'), true)
  where id = padrao_customer;
  update public.assistant_profiles
  set process_config = jsonb_set(coalesce(process_config, '{}'::jsonb), '{rollout}',
        jsonb_build_object('mode', 'active'), true)
  where id = 'bbbbbbbb-0002-4000-8000-00000000fa5e';

  resposta := public.nucleo_customer_assistant_access('5565999990000');

  if resposta ->> 'reason' <> 'rollout_off' then
    raise exception
      'F.2 FALHOU: esperava rollout_off (lido do padrao) e recebi reason=% mode=%',
      resposta ->> 'reason', resposta ->> 'mode';
  end if;
  raise notice 'F.2 ok: customer_assistant_access leu o rollout do PADRAO, nao o do agente ativo vizinho';
end $$;

-- ===========================================================================
-- G: o item central da fase. Padrão INATIVO recusa; não cai no vizinho ativo.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  padrao_customer uuid;
  recusou boolean := false;
  resposta jsonb;
  resultado jsonb;
begin
  select id into padrao_customer from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  -- O padrão para; os outros dois customer continuam ATIVOS de propósito.
  update public.assistant_profiles set active = false where id = padrao_customer;
  if (select count(*) from public.assistant_profiles
      where organization_id = organizacao and audience = 'customer'
        and active and not is_default) <> 2 then
    raise exception 'G INVALIDO: a prova precisa de 2 agentes customer ativos nao-padrao';
  end if;

  -- G.1 payload
  begin
    resultado := private.intelligence_payload(
      organizacao, 'customer', 'whatsapp', repeat('a', 64), 'ola', '{}'::jsonb, false
    );
  exception when others then
    recusou := true;
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'G.1 FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
  end;
  if not recusou then
    raise exception
      'G.1 FALHOU: o payload respondeu por % em vez de recusar com o padrao inativo',
      resultado #>> '{assistente,id}';
  end if;
  raise notice 'G.1 ok: padrao inativo -> payload RECUSA, com 2 agentes ativos disponiveis';

  -- G.2 customer_assistant_access
  resposta := public.nucleo_customer_assistant_access('5565999990000');
  if resposta ->> 'reason' <> 'profile_inactive' then
    raise exception 'G.2 FALHOU: esperava profile_inactive e recebi %', resposta ->> 'reason';
  end if;
  if (resposta ->> 'allowed')::boolean then
    raise exception 'G.2 FALHOU: liberou atendimento com o padrao inativo';
  end if;
  raise notice 'G.2 ok: padrao inativo -> customer_assistant_access devolve profile_inactive';

  update public.assistant_profiles set active = true where id = padrao_customer;
end $$;

-- ===========================================================================
-- H: sem padrão nenhum, falha fechado — mesmo com 3 agentes ativos.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  recusou boolean := false;
  resposta jsonb;
  resultado jsonb;
begin
  update public.assistant_profiles set is_default = false
  where organization_id = organizacao and audience = 'customer';

  if (select count(*) from public.assistant_profiles
      where organization_id = organizacao and audience = 'customer' and active) <> 3 then
    raise exception 'H INVALIDO: a prova precisa dos 3 agentes customer ativos';
  end if;

  begin
    resultado := private.intelligence_payload(
      organizacao, 'customer', 'whatsapp', repeat('b', 64), 'ola', '{}'::jsonb, false
    );
  exception when others then
    recusou := true;
    if sqlerrm not like '%assistant profile is inactive or unavailable%' then
      raise exception 'H FALHOU: recusou com a mensagem errada: %', sqlerrm;
    end if;
  end;
  if not recusou then
    raise exception
      'H FALHOU: sem padrao, o payload ainda respondeu por %',
      resultado #>> '{assistente,id}';
  end if;

  resposta := public.nucleo_customer_assistant_access('5565999990000');
  if resposta ->> 'reason' <> 'profile_inactive' then
    raise exception 'H FALHOU: sem padrao, customer_assistant_access devolveu %', resposta ->> 'reason';
  end if;
  raise notice 'H ok: sem padrao -> os dois caminhos falham FECHADO, com 3 agentes ativos';

  update public.assistant_profiles set is_default = true
  where id = (select id from public.assistant_profiles
              where organization_id = organizacao and audience = 'customer'
                and template_id = '10000000-0000-0000-0000-000000000002'
                and display_name = 'Assistente da empresa');
end $$;

-- ===========================================================================
-- I: provision_intelligence continua idempotente DEPOIS do DROP.
--    Este é o item que a FASE C e a D registraram como dívida: o
--    `on conflict (organization_id, audience)` antigo apontava para o índice
--    que a FASE E removeu. Se a inferência pelo índice parcial não funcionar,
--    é AQUI que aparece — e o erro é `there is no unique or exclusion
--    constraint matching the ON CONFLICT specification`.
-- J: e ela não toca nos agentes não-padrão.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  padrao_antes uuid;
  padrao_depois uuid;
  customers_antes integer;
  customers_depois integer;
  nao_padrao_antes jsonb;
  nao_padrao_depois jsonb;
begin
  select id into padrao_antes from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  select count(*) into customers_antes from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer';
  select jsonb_agg(jsonb_build_object('id', id, 'nome', display_name, 'ativo', active) order by id)
  into nao_padrao_antes
  from public.assistant_profiles
  where organization_id = organizacao and not is_default;

  -- Duas vezes seguidas, numa organização que já tem 5 agentes.
  perform private.provision_intelligence(organizacao, ator);
  perform private.provision_intelligence(organizacao, ator);

  select id into padrao_depois from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  select count(*) into customers_depois from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer';
  select jsonb_agg(jsonb_build_object('id', id, 'nome', display_name, 'ativo', active) order by id)
  into nao_padrao_depois
  from public.assistant_profiles
  where organization_id = organizacao and not is_default;

  if customers_depois <> customers_antes then
    raise exception
      'I FALHOU: provision_intelligence criou agente customer (%  -> %)',
      customers_antes, customers_depois;
  end if;
  if padrao_depois is distinct from padrao_antes then
    raise exception 'I FALHOU: o padrao customer mudou de % para %', padrao_antes, padrao_depois;
  end if;
  if (select count(*) from public.assistant_profiles
      where organization_id = organizacao and audience = 'customer' and is_default) <> 1 then
    raise exception 'I FALHOU: sobrou mais de um padrao customer';
  end if;
  raise notice 'I ok: provision_intelligence rodou 2x sem duplicar padrao nem criar agente';

  if nao_padrao_depois is distinct from nao_padrao_antes then
    raise exception 'J FALHOU: agentes nao-padrao mudaram. antes=% depois=%',
      nao_padrao_antes, nao_padrao_depois;
  end if;
  raise notice 'J ok: os 3 agentes nao-padrao ficaram intactos (nem promovidos, nem apagados)';
end $$;

-- I.2: e numa organização NOVA ela continua provisionando os dois padrões.
do $$
declare
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  nova uuid := 'aaaaaaaa-0009-4000-8000-00000000fa5e';
  internos integer;
  clientes integer;
begin
  -- O gatilho `organizations_provision_intelligence` chama a função sozinho.
  insert into public.organizations (id, name, slug, created_by)
  values (nova, 'Organizacao nova da prova FASE E', 'organizacao-nova-prova-fase-e', ator);

  select count(*) into internos from public.assistant_profiles
  where organization_id = nova and audience = 'internal' and is_default;
  select count(*) into clientes from public.assistant_profiles
  where organization_id = nova and audience = 'customer' and is_default;

  if internos <> 1 or clientes <> 1 then
    raise exception
      'I.2 FALHOU: organizacao nova saiu com % padrao interno e % padrao customer',
      internos, clientes;
  end if;
  if (select count(*) from public.assistant_profiles where organization_id = nova) <> 2 then
    raise exception 'I.2 FALHOU: organizacao nova nao saiu com exatamente 2 agentes';
  end if;
  raise notice 'I.2 ok: organizacao nova nasce com 1 padrao internal + 1 padrao customer';
end $$;

-- ===========================================================================
-- K: slug com N agentes.
--    K.1 mesmo display_name, slugs diferentes -> permitido
--    K.2 mesmo slug na mesma organizacao       -> rejeitado
--    K.3 mesmo slug em organizacao diferente   -> permitido
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  outra uuid := 'aaaaaaaa-0009-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  slug_alvo text;
  recusou boolean := false;
begin
  -- K.1: dois agentes com o MESMO display_name, slugs distintos explicitados.
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, slug,
    created_by, updated_by, is_default
  ) values (
    organizacao, '10000000-0000-0000-0000-000000000002', 'customer',
    'Agente homonimo', 'agente-homonimo-um', ator, ator, false
  ), (
    organizacao, '10000000-0000-0000-0000-000000000002', 'customer',
    'Agente homonimo', 'agente-homonimo-dois', ator, ator, false
  );
  if (select count(*) from public.assistant_profiles
      where organization_id = organizacao and display_name = 'Agente homonimo') <> 2 then
    raise exception 'K.1 FALHOU: nao foi possivel ter dois agentes com o mesmo nome';
  end if;
  raise notice 'K.1 ok: mesmo display_name convive, desde que o slug diferencie';

  -- K.2: repetir o slug dentro da organização.
  begin
    insert into public.assistant_profiles (
      organization_id, template_id, audience, display_name, slug,
      created_by, updated_by, is_default
    ) values (
      organizacao, '10000000-0000-0000-0000-000000000002', 'customer',
      'Outro nome qualquer', 'agente-homonimo-um', ator, ator, false
    );
  exception when unique_violation then
    recusou := true;
  end;
  if not recusou then
    raise exception 'K.2 FALHOU: o banco aceitou slug repetido na mesma organizacao';
  end if;
  raise notice 'K.2 ok: slug repetido na mesma organizacao rejeitado';

  -- K.3: o mesmo slug em OUTRA organização.
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, slug,
    created_by, updated_by, is_default
  ) values (
    outra, '10000000-0000-0000-0000-000000000002', 'customer',
    'Agente homonimo', 'agente-homonimo-um', ator, ator, false
  );
  select slug into slug_alvo from public.assistant_profiles
  where organization_id = outra and slug = 'agente-homonimo-um';
  if slug_alvo is null then
    raise exception 'K.3 FALHOU: o mesmo slug deveria ser permitido em outra organizacao';
  end if;
  raise notice 'K.3 ok: o slug e unico por organizacao, nao globalmente';
end $$;

-- ===========================================================================
-- L: RLS continua ligada, com as mesmas policies, e nenhuma por audience.
-- ===========================================================================
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.assistant_profiles'::regclass) then
    raise exception 'L FALHOU: RLS desligada em assistant_profiles';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'assistant_profiles') <> 3 then
    raise exception 'L FALHOU: o numero de policies mudou';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%audience%'
  ) then
    raise exception 'L FALHOU: alguma policy passou a depender de audience';
  end if;
  -- As amarrações continuam por profile_id, que é o que impede skill de um
  -- agente vazar para outro agora que há vários na mesma organizacao.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profile_skills'::regclass and contype = 'f'
      and confrelid = 'public.assistant_profiles'::regclass
  ) then
    raise exception 'L FALHOU: assistant_profile_skills perdeu a FK para o agente';
  end if;
  raise notice 'L ok: RLS por organizacao, amarracoes por profile_id, nada por audience';
end $$;

-- L.2: skills de um agente não aparecem no payload de outro.
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  resultado jsonb;
  skills_do_padrao integer;
begin
  -- Uma skill amarrada só ao agente NÃO-padrão.
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values (organizacao, 'bbbbbbbb-0002-4000-8000-00000000fa5e',
          '20000000-0000-0000-0000-000000000002', 10, ator)
  on conflict (profile_id, skill_id) do nothing;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'whatsapp', repeat('c', 64), 'ola', '{}'::jsonb, false
  );

  select count(*) into skills_do_padrao
  from jsonb_array_elements(resultado -> 'skillsPermitidos') skill
  where (skill ->> 'id')::uuid = '20000000-0000-0000-0000-000000000002'
    and not exists (
      select 1 from public.assistant_profile_skills binding
      where binding.profile_id = (resultado #>> '{assistente,id}')::uuid
        and binding.skill_id = '20000000-0000-0000-0000-000000000002'
    );
  if skills_do_padrao > 0 then
    raise exception 'L.2 FALHOU: skill amarrada ao agente vizinho vazou para o payload do padrao';
  end if;
  raise notice 'L.2 ok: as skills do payload sao as do agente resolvido, nao as da organizacao';
end $$;

-- ===========================================================================
-- N: a FASE E não inventou Agent Router.
-- ===========================================================================
do $$
begin
  -- Nenhum resolvedor ganhou critério de escolha novo: continuam pedindo o
  -- padrão, que é o oposto de rotear entre elegíveis.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%profile.is_default%'
  ) then
    raise exception 'N FALHOU: intelligence_payload deixou de pedir o padrao';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'provision_intelligence'
      and p.prosrc like '%on conflict (organization_id, audience) do nothing%'
  ) then
    raise exception 'N FALHOU: provision_intelligence ainda infere a unique removida';
  end if;
  raise notice 'N ok: nenhum roteador de agente foi criado; o padrao continua sendo quem responde';
end $$;

rollback;

-- ===========================================================================
-- Pós-rollback: nada vazou.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agentes integer;
begin
  select count(*) into agentes from public.assistant_profiles
  where organization_id = organizacao;
  if agentes <> 2 then
    raise exception
      'POS-ROLLBACK FALHOU: a organizacao da prova ficou com % agentes (esperado 2)', agentes;
  end if;
  if exists (select 1 from public.organizations
             where id = 'aaaaaaaa-0009-4000-8000-00000000fa5e') then
    raise exception 'POS-ROLLBACK FALHOU: a organizacao nova sobreviveu ao rollback';
  end if;
  -- A unique antiga NÃO volta: ela foi removida pela migration, fora desta
  -- transação. Este é o estado esperado do banco descartável pós-FASE-E.
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.assistant_profiles'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(c.conkey) as k(attnum)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['audience', 'organization_id']
  ) then
    raise exception 'POS-ROLLBACK FALHOU: a unique antiga reapareceu';
  end if;
  raise notice 'POS-ROLLBACK ok: 2 agentes na organizacao da prova, organizacao nova desfeita';
  raise notice 'PROVA DA FASE E: TODOS OS ITENS PASSARAM';
end $$;
