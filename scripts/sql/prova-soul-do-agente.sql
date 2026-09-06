-- ============================================================================
-- NUNCA EXECUTAR CONTRA PRODUÇÃO. Só em Postgres descartável.
-- ============================================================================
--
-- Prova COMPORTAMENTAL da FASE 13C (o Soul do agente escolhido chega ao
-- payload), migration `20260906010000_fase_13c_soul_do_agente_no_prompt.sql`.
--
-- NUNCA rode isto em produção: cria agentes, campanhas e personas de mentira.
-- Termina em ROLLBACK, mas gatilhos de auditoria disparam de qualquer jeito.
--
-- `test/agent-soul-migration.test.mjs` prova que a migration DECLARA a regra;
-- `whatsapp-assistant/test_intelligence.py` prova o lado do prompt. Este
-- arquivo prova o que só o Postgres responde: que a persona que sai do payload
-- é a do agente que o Router escolheu, e **nunca** a de outro — inclusive
-- quando o outro é o agente padrão, que é o caso perigoso.
--
-- Sequência, num Postgres descartável: a mesma de
-- `README-prova-agent-router.md`, com a migration da 13C aplicada no fim,
-- antes deste arquivo.
--
-- Itens:
--   A  o agente com persona devolve a persona dele, com hash sha256 correto;
--   B  agente SEM persona devolve null -- e não a persona do padrão (o item
--      central: é aqui que a persona vazaria);
--   C  a persona segue a AFINIDADE: conversa pinada no não-padrão recebe a
--      persona do não-padrão, não a do padrão;
--   D  a persona segue a CAMPANHA, pelo mesmo caminho;
--   E  persona só de espaço vale como ausente;
--   F  persona acima de 8000 é descartada pelo payload, sem derrubar o turno;
--   G  a constraint do banco recusa gravar persona acima de 8000;
--   H  trocar a persona muda o hash, e persona igual em dois agentes dá o
--      mesmo hash (é hash de conteúdo, não de agente);
--   I  o resto do payload não mudou: schemaVersion, chaves e skills;
--   J  pós-rollback: a prova não deixou estado.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- SETUP: dois agentes de clientes no mesmo público — um padrão, um não —, e
-- uma campanha ligada ao não-padrão.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  ator uuid := 'aaaaaaaa-0000-4000-8000-00000000fa5e';
  agente_padrao uuid;
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  campanha uuid := 'cccccccc-0002-4000-8000-00000000fa5e';
begin
  select id into strict agente_padrao from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  -- O PADRÃO tem persona. É ela que não pode vazar para ninguém.
  update public.assistant_profiles
  set soul_markdown = '# Assistente Major' || chr(10) || 'Falo pela empresa inteira, com formalidade.',
      active = true
  where id = agente_padrao;

  insert into public.assistant_profiles (
    id, organization_id, template_id, audience, display_name, slug,
    created_by, updated_by, is_default, active, soul_markdown
  ) values (
    agente_sdr, organizacao,
    (select template_id from public.assistant_profiles where id = agente_padrao),
    'customer', 'SDR da prova soul', 'sdr-da-prova-soul', ator, ator, false, true,
    '# SDR' || chr(10) || 'Sou objetivo e faco uma pergunta por vez.'
  );

  insert into public.organization_campaigns (
    id, organization_id, assistant_profile_id, name, status,
    is_default, created_by, updated_by
  ) values (
    campanha, organizacao, agente_sdr, 'Campanha da prova soul', 'test',
    false, ator, ator
  );
  insert into public.campaign_sources (
    organization_id, campaign_id, source_type, source_value, active
  ) values (organizacao, campanha, 'keyword', 'proposta', true);

  update public.organization_campaigns set is_default = false
  where organization_id = organizacao and is_default and status in ('test', 'active')
    and id <> campanha;

  raise notice 'SETUP ok: padrao % (com persona), sdr % (com persona), campanha %',
    agente_padrao, agente_sdr, campanha;
end $$;

-- ===========================================================================
-- A: o agente com persona devolve a persona dele, e o hash é o sha256 dela.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  resultado jsonb;
  esperado text;
begin
  select soul_markdown into strict esperado from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('a', 64), 'ola', '{}'::jsonb, false
  );

  if (resultado #>> '{assistente,soul}') is distinct from esperado then
    raise exception 'A FALHOU: o payload devolveu persona diferente da do agente';
  end if;
  if (resultado #>> '{assistente,soulHash}') is distinct from
     encode(extensions.digest(esperado, 'sha256'), 'hex') then
    raise exception 'A FALHOU: o soulHash nao e o sha256 da persona';
  end if;
  if length(resultado #>> '{assistente,soulHash}') <> 64 then
    raise exception 'A FALHOU: o soulHash nao tem 64 caracteres';
  end if;
  raise notice 'A PASS: a persona do agente sai no payload, com hash sha256 correto';
end $$;

-- ===========================================================================
-- B: agente SEM persona devolve null — e NÃO a persona do padrão. É o item
--    central da fase: herdar persona por ausência é o mesmo erro que a FASE D
--    proibiu para disponibilidade.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  hash_conversa text := repeat('b', 64);
  resultado jsonb;
  persona_do_padrao text;
begin
  update public.assistant_profiles set soul_markdown = null where id = agente_sdr;

  select soul_markdown into strict persona_do_padrao from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;
  if persona_do_padrao is null then
    raise exception 'B FALHOU: o cenario exige o PADRAO COM persona, senao nao prova nada';
  end if;

  insert into public.conversation_intelligence_contexts (
    organization_id, assistant_profile_id, audience, channel, conversation_key_hash
  ) values (organizacao, agente_sdr, 'customer', 'simulator', hash_conversa);

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', hash_conversa, 'ola', '{}'::jsonb, false
  );

  if (resultado #>> '{assistente,id}') is distinct from agente_sdr::text then
    raise exception 'B FALHOU: o cenario nao esta montado; quem atendeu foi %',
      resultado #>> '{assistente,id}';
  end if;
  if (resultado #> '{assistente,soul}') is distinct from 'null'::jsonb then
    raise exception 'B FALHOU: agente sem persona devolveu %',
      resultado #>> '{assistente,soul}';
  end if;
  if (resultado #>> '{assistente,soul}') = persona_do_padrao then
    raise exception 'B FALHOU: A PERSONA DO PADRAO VAZOU para o agente sem persona';
  end if;
  if (resultado #> '{assistente,soulHash}') is distinct from 'null'::jsonb then
    raise exception 'B FALHOU: sem persona, o hash tinha de ser null';
  end if;
  raise notice 'B PASS: agente sem persona devolve null, e NAO a persona do padrao';
end $$;

-- ===========================================================================
-- C: a persona segue a AFINIDADE. Conversa pinada no não-padrão recebe a
--    persona do não-padrão, com o padrão ativo e com persona ao lado.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  hash_conversa text := repeat('b', 64);
  resultado jsonb;
  persona_sdr text := '# SDR' || chr(10) || 'Sou objetivo e faco uma pergunta por vez.';
begin
  update public.assistant_profiles set soul_markdown = persona_sdr where id = agente_sdr;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', hash_conversa, 'ola', '{}'::jsonb, false
  );

  if (resultado #>> '{assistente,soul}') is distinct from persona_sdr then
    raise exception 'C FALHOU: a conversa pinada no SDR recebeu a persona %',
      resultado #>> '{assistente,soul}';
  end if;
  if (resultado #>> '{assistente,soul}') like '%Falo pela empresa inteira%' then
    raise exception 'C FALHOU: a persona do padrao atravessou para a conversa do SDR';
  end if;
  raise notice 'C PASS: a persona acompanha a afinidade, nao o padrao';
end $$;

-- ===========================================================================
-- D: a persona segue a CAMPANHA, pelo mesmo caminho — conversa nova que casa
--    com a campanha do SDR recebe a persona do SDR.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  resultado jsonb;
begin
  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('d', 64),
    'quero uma proposta', '{}'::jsonb, false
  );

  if (resultado #>> '{assistente,id}') is distinct from agente_sdr::text then
    raise exception 'D FALHOU: a campanha nao levou ao SDR, levou a %',
      resultado #>> '{assistente,id}';
  end if;
  if (resultado #>> '{assistente,soul}') not like '%uma pergunta por vez%' then
    raise exception 'D FALHOU: a persona do SDR nao veio junto com a campanha dele';
  end if;
  if (resultado #>> '{assistente,soul}') like '%Falo pela empresa inteira%' then
    raise exception 'D FALHOU: a persona do padrao vazou pela campanha';
  end if;
  raise notice 'D PASS: a persona acompanha o agente da campanha';
end $$;

-- ===========================================================================
-- E: persona só de espaço vale como ausente — o runtime não precisa decidir
--    isso de novo do outro lado.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  resultado jsonb;
begin
  update public.assistant_profiles set soul_markdown = '     ' where id = agente_sdr;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('b', 64), 'ola', '{}'::jsonb, false
  );
  if (resultado #> '{assistente,soul}') is distinct from 'null'::jsonb then
    raise exception 'E FALHOU: persona so de espaco deveria valer como ausente, veio %',
      resultado #>> '{assistente,soul}';
  end if;
  raise notice 'E PASS: persona so de espaco vale como ausente';
end $$;

-- ===========================================================================
-- F: persona acima do teto é DESCARTADA pelo payload, e o turno continua de
--    pé. Persona não é permissão: derrubar o atendimento por causa de um texto
--    longo demais trocaria um problema cosmético por um problema real.
--
--    A linha é gravada com a constraint temporariamente removida, porque é
--    exatamente o caso "linha anterior à constraint" que este ramo protege.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  resultado jsonb;
begin
  alter table public.assistant_profiles
    drop constraint assistant_profiles_soul_markdown_tamanho;
  update public.assistant_profiles set soul_markdown = repeat('x', 8001) where id = agente_sdr;

  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('b', 64), 'ola', '{}'::jsonb, false
  );
  if (resultado #> '{assistente,soul}') is distinct from 'null'::jsonb then
    raise exception 'F FALHOU: persona acima de 8000 deveria ter sido descartada';
  end if;
  if (resultado #>> '{assistente,id}') is distinct from agente_sdr::text then
    raise exception 'F FALHOU: o turno deveria continuar de pe, com o mesmo agente';
  end if;
  if resultado #>> '{skillsPermitidos}' is null then
    raise exception 'F FALHOU: o resto do payload sumiu junto com a persona';
  end if;

  -- No limite exato, passa.
  update public.assistant_profiles set soul_markdown = repeat('y', 8000) where id = agente_sdr;
  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('b', 64), 'ola', '{}'::jsonb, false
  );
  if length(resultado #>> '{assistente,soul}') <> 8000 then
    raise exception 'F FALHOU: persona de exatamente 8000 deveria passar';
  end if;

  update public.assistant_profiles
  set soul_markdown = '# SDR' || chr(10) || 'Sou objetivo e faco uma pergunta por vez.'
  where id = agente_sdr;
  alter table public.assistant_profiles
    add constraint assistant_profiles_soul_markdown_tamanho
    check (soul_markdown is null or length(soul_markdown) <= 8000);
  raise notice 'F PASS: persona acima do teto e descartada, e o turno continua de pe';
end $$;

-- ===========================================================================
-- G: e o banco recusa gravar persona acima do teto — que é o lugar onde o
--    limite vale de verdade, porque o portal escreve por REST direto na tabela.
-- ===========================================================================
do $$
declare
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
begin
  begin
    update public.assistant_profiles set soul_markdown = repeat('z', 8001) where id = agente_sdr;
    raise exception 'G FALHOU: o banco aceitou persona acima de 8000';
  exception when check_violation then
    raise notice 'G PASS: a constraint recusa persona acima de 8000';
  end;
end $$;

-- ===========================================================================
-- H: o hash é de CONTEÚDO, não de agente. Duas personas iguais em agentes
--    diferentes dão o mesmo hash; mudar a persona muda o hash. É o que torna o
--    log capaz de dizer "a persona mudou" sem nunca registrar o texto.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  agente_sdr uuid := 'cccccccc-0001-4000-8000-00000000fa5e';
  agente_padrao uuid;
  hash_antes text;
  hash_depois text;
  hash_padrao text;
  texto text := '# Identica' || chr(10) || 'Mesma persona nos dois agentes.';
begin
  select id into strict agente_padrao from public.assistant_profiles
  where organization_id = organizacao and audience = 'customer' and is_default;

  hash_antes := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('b', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,soulHash}';

  update public.assistant_profiles set soul_markdown = texto where id = agente_sdr;
  hash_depois := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('b', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,soulHash}';

  if hash_antes = hash_depois then
    raise exception 'H FALHOU: trocar a persona nao mudou o hash';
  end if;

  update public.assistant_profiles set soul_markdown = texto where id = agente_padrao;
  -- Conversa NOVA, para cair no padrao e observar a persona dele. O hash tem de
  -- ser hex: o resolvedor exige `^[0-9a-f]{64}$` e recusa com
  -- `invalid conversation context key` antes de chegar na selecao de agente.
  hash_padrao := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('c', 64), 'ola', '{}'::jsonb, false
  ) #>> '{assistente,soulHash}';

  if hash_padrao is distinct from hash_depois then
    raise exception 'H FALHOU: personas identicas em agentes diferentes deram hashes diferentes';
  end if;
  raise notice 'H PASS: o hash e de conteudo, nao de agente';
end $$;

-- ===========================================================================
-- I: o resto do payload não mudou. A 13C acrescenta duas chaves e não mexe em
--    mais nada — inclusive não encosta em ferramenta nem em política.
-- ===========================================================================
do $$
declare
  organizacao uuid := 'aaaaaaaa-0001-4000-8000-00000000fa5e';
  resultado jsonb;
  chaves text[];
begin
  resultado := private.intelligence_payload(
    organizacao, 'customer', 'simulator', repeat('e', 64), 'ola', '{}'::jsonb, false
  );

  if (resultado ->> 'schemaVersion') is distinct from 'fase-h-1' then
    raise exception 'I FALHOU: schemaVersion virou %', resultado ->> 'schemaVersion';
  end if;

  select array_agg(chave order by chave) into chaves
  from jsonb_object_keys(resultado -> 'assistente') chave;
  if chaves is distinct from array[
    'id', 'marca', 'nome', 'processo', 'soul', 'soulHash', 'templateId', 'tom'
  ] then
    raise exception 'I FALHOU: as chaves de assistente sao %', chaves;
  end if;

  select array_agg(chave order by chave) into chaves
  from jsonb_object_keys(resultado) chave;
  if chaves is distinct from array[
    'assistente', 'audiencia', 'campanha', 'colecoesPermitidas', 'contextoId',
    'politicas', 'schemaVersion', 'skillAtivo', 'skillsPermitidos'
  ] then
    raise exception 'I FALHOU: as chaves de primeiro nivel mudaram: %', chaves;
  end if;

  if (resultado #>> '{politicas,documentosComoDados}') is distinct from 'true' then
    raise exception 'I FALHOU: as politicas mudaram';
  end if;
  raise notice 'I PASS: fora as duas chaves novas, o payload e o mesmo';
end $$;

rollback;

-- ===========================================================================
-- J: pós-rollback. A prova removeu e recriou uma constraint no meio do
--    caminho; se algo escapou, o banco de teste não representa mais produção.
-- ===========================================================================
do $$
begin
  if exists (select 1 from public.assistant_profiles where slug = 'sdr-da-prova-soul') then
    raise exception 'J FALHOU: o agente da prova sobreviveu ao rollback';
  end if;
  if exists (select 1 from public.organization_campaigns where id = 'cccccccc-0002-4000-8000-00000000fa5e') then
    raise exception 'J FALHOU: a campanha da prova sobreviveu ao rollback';
  end if;
  if exists (
    select 1 from public.conversation_intelligence_contexts
    where conversation_key_hash in (
      repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64)
    )
  ) then
    raise exception 'J FALHOU: o contexto da prova sobreviveu ao rollback';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_soul_markdown_tamanho'
  ) then
    raise exception 'J FALHOU: a constraint de tamanho do soul nao voltou depois do rollback';
  end if;
  if exists (
    select 1 from public.assistant_profiles
    where soul_markdown is not null and soul_markdown like '%prova%'
  ) then
    raise exception 'J FALHOU: sobrou persona de prova em algum perfil';
  end if;
  raise notice 'J PASS: nada da prova sobreviveu, e a constraint esta de volta';
end $$;
