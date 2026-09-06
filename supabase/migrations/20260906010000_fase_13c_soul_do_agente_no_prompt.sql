-- O agente passa a falar com a propria persona.
--
-- FASE 13C, primeira metade (banco). A FASE B criou
-- `assistant_profiles.soul_markdown` e a tela ja escreve nele, mas o texto
-- nunca saiu da tabela: nenhum resolvedor o lia, entao a persona existia no
-- cadastro e nao existia na conversa. Esta migration transporta o Soul do
-- **mesmo agente que o Router da 13B escolheu** ate o payload, e nada alem
-- disso.
--
-- Tres decisoes que sao o conteudo da fase, e nao detalhe de implementacao:
--
-- 1. **O Soul sai de `selected_profile`, e de nenhum outro lugar.** E a mesma
--    linha que os tres ramos da 13B (afinidade / campanha / padrao) fixaram.
--    Nao existe consulta separada a `assistant_profiles` para buscar persona --
--    seria exatamente por ali que a persona de um agente vazaria para a
--    conversa de outro. Agente sem soul manda `null`; **nunca** o soul do
--    padrao. Herdar persona por ausencia e o mesmo erro que a FASE D proibiu
--    para disponibilidade.
--
-- 2. **Soul e persona, nunca permissao.** Ele entra no payload como texto ao
--    lado de `tom` e `marca`, no mesmo objeto `assistente`, e nao toca
--    `skillsPermitidos`, `colecoesPermitidas`, `politicas` nem coisa alguma que
--    autorize. Quem autoriza continua sendo `allowedTools` da skill mais RLS.
--    O runtime coloca o Soul ABAIXO das politicas e ACIMA da skill no prompt,
--    e isso e escolha de ordem no prompt, nao de precedencia de seguranca.
--
-- 3. **O hash viaja junto.** `soulHash` (sha256 hex, mesmo formato do
--    `contentHash` de skill) existe para o runtime poder REGISTRAR qual persona
--    entrou no turno sem escrever o conteudo dela em log nenhum. Persona e
--    texto livre escrito por gente da organizacao; ela nao pertence a arquivo
--    de log.
--
-- O que esta migration NAO faz:
--
-- * nao muda `schemaVersion`. O objeto `assistente` ganha duas chaves, e
--   `resolve_v2` (linha `'assistant', payload -> 'assistente'`) e `resolve_v3`
--   (`'assistant', base_payload -> 'assistente'`) copiam o objeto INTEIRO --
--   as duas chaves chegam ao `runtimeContext` sem que nenhuma das duas funcoes
--   seja tocada. Contratos `fase-h-1`, `fase-h-2` e `fase-h-3` intactos;
-- * nao muda `allowedTools`, nao cria ferramenta e nao mexe em permissao,
--   policy, grant ou RLS;
-- * nao altera a precedencia do Router da 13B -- a selecao de agente e o
--   objeto `campanha`, `skillAtivo`, `skillsPermitidos`, `colecoesPermitidas`,
--   `politicas` e a persistencia continuam byte a byte iguais;
-- * nao usa `source_data`, nao cria `targetAgentId` nem `targetMode = 'agent'`;
-- * nao renomeia `assistente` para `agente`;
-- * nao cria tela: a criacao, edicao e leitura de `soul_markdown` ja existem no
--   portal;
-- * nao inicia handoff entre agentes (FASE 14).
--
-- ## O limite de tamanho, e por que ele existe em tres lugares
--
-- `soul_markdown` nasceu `text` sem limite nenhum (FASE B), enquanto `tone` tem
-- `<= 500` no banco e o mesmo 500 espelhado em JavaScript. Persona sem teto vai
-- parar dentro de todo prompt de todo turno daquele agente: custo por turno,
-- risco de estourar contexto e, no limite, um texto capaz de empurrar a skill
-- para fora da janela.
--
-- O teto passa a ser **8000 caracteres** -- entre `tone` (500) e as instrucoes
-- de skill (20000, o teto que o runtime ja aplica), o que mantem a escala
-- coerente com o que ja existe.
--
-- Ele e imposto em tres camadas, de proposito:
--
-- * **banco**, na constraint desta migration: e o unico lugar que vale mesmo,
--   porque o portal escreve por REST direto na tabela;
-- * **payload**, no `if` desta funcao: descarta soul acima do teto em vez de
--   levantar excecao. Alcanca so linha anterior a constraint (hoje nao existe
--   nenhuma), e descarta porque persona nao e permissao -- derrubar o turno
--   inteiro por um texto longo demais troca um problema cosmetico por um
--   problema real;
-- * **runtime e JavaScript**, com a mesma regra, para o erro aparecer na tela
--   na hora de escrever, e nao seis meses depois numa conversa.
--
-- ## Estado de partida exigido
--
-- Esta migration se recusa a rodar se a 13B nao estiver aplicada: ela reescreve
-- o corpo da 13B, e aplicar por cima do corpo da FASE D apagaria o Router
-- inteiro em silencio. A guarda esta no bloco 1/4.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guardas. Fail closed, e antes de qualquer alteracao.
-- ---------------------------------------------------------------------------
do $$
declare
  soul_gigante integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and column_name = 'soul_markdown'
  ) then
    raise exception 'FASE 13C abortada: a coluna soul_markdown (FASE B) nao existe';
  end if;

  -- A 13B tem de estar viva. Sem esta guarda, aplicar aqui por cima do corpo da
  -- FASE D removeria a afinidade e a campanha do roteamento sem aviso nenhum.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%existing_context.assistant_profile_id%'
      and p.prosrc like '%selected_campaign.assistant_profile_id%'
  ) then
    raise exception 'FASE 13C abortada: o Router da 13B nao esta aplicado; reescrever por cima apagaria o roteamento';
  end if;

  -- E o corpo vivo nao pode ja carregar Soul (aplicacao repetida).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%selected_profile.soul_markdown%'
  ) then
    raise exception 'FASE 13C abortada: intelligence_payload ja transporta Soul; conferir o que esta vivo antes de reescrever';
  end if;

  -- pgcrypto no schema `extensions` e o que permite calcular o hash de dentro
  -- de uma funcao com search_path vazio. Os resolvedores ja dependem dela.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'digest'
  ) then
    raise exception 'FASE 13C abortada: extensions.digest (pgcrypto) nao existe';
  end if;

  -- Nenhuma linha pode violar o teto que a constraint vai impor. Sem esta
  -- checagem o ALTER falharia com erro de constraint, que nao diz de quem.
  select count(*) into soul_gigante
  from public.assistant_profiles
  where soul_markdown is not null and length(soul_markdown) > 8000;
  if soul_gigante > 0 then
    raise exception 'FASE 13C abortada: % perfil(is) com soul_markdown acima de 8000 caracteres; decidir o que fazer com eles antes', soul_gigante;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/4. O teto de tamanho vira regra do banco.
-- ---------------------------------------------------------------------------
-- `if not exists` no nome porque migration corretiva nao pode falhar por ja ter
-- rodado. O nome e proprio, e nao numerado pelo Postgres: constraint anonima e
-- o que torna a mensagem de erro ilegivel para quem estiver escrevendo persona
-- pela tela.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_soul_markdown_tamanho'
  ) then
    alter table public.assistant_profiles
      add constraint assistant_profiles_soul_markdown_tamanho
      check (soul_markdown is null or length(soul_markdown) <= 8000);
  end if;
end $$;

comment on column public.assistant_profiles.soul_markdown is
  'Persona do agente em markdown: quem ele e e como se comporta. NUNCA autorizacao -- soul nao concede ferramenta, escopo nem acesso a dado. Limite de 8000 caracteres (constraint assistant_profiles_soul_markdown_tamanho), espelhado no runtime e no JavaScript. Entra no prompt abaixo das politicas e acima da skill, e so para o agente que o Router escolheu. Ver docs/intelligence/MULTI-AGENT-MIGRATION.md.';

-- ---------------------------------------------------------------------------
-- 3/4. private.intelligence_payload -- o mesmo corpo da 13B, mais o Soul
-- ---------------------------------------------------------------------------
-- A diferenca em relacao ao corpo aplicado da 13B e exatamente esta, e o teste
-- estatico compara os dois arquivos para provar que nao ha nenhuma outra:
--
--   * duas variaveis novas no `declare` (soul_texto, soul_hash);
--   * um bloco que le `selected_profile.soul_markdown` depois de o agente estar
--     escolhido e validado;
--   * duas chaves novas no objeto `assistente` do retorno.
--
-- Selecao de agente, campanha, skill, colecoes, politicas e persistencia:
-- inalteradas.
CREATE OR REPLACE FUNCTION private.intelligence_payload(target_organization uuid, target_audience text, target_channel text, conversation_hash text, incoming_text text, source_data jsonb, should_persist boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_profile public.assistant_profiles%rowtype;
  selected_campaign public.organization_campaigns%rowtype;
  existing_context public.conversation_intelligence_contexts%rowtype;
  selected_skill public.skill_definitions%rowtype;
  skills_payload jsonb;
  collections_payload jsonb;
  saved_context uuid;
  normalized_message text := lower(left(coalesce(incoming_text, ''), 2000));
  safe_source jsonb := coalesce(source_data, '{}'::jsonb);
  soul_texto text;
  soul_hash text;
begin
  if target_audience not in ('internal', 'customer') then raise exception 'invalid assistant audience'; end if;
  if target_channel not in ('whatsapp', 'web', 'simulator') then raise exception 'invalid assistant channel'; end if;
  if conversation_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid conversation context key'; end if;

  -- A CONVERSA VEM PRIMEIRO. Ate a FASE D o agente era escolhido antes de se
  -- olhar a conversa, o que so nao dava problema porque a escolha nunca
  -- dependia dela. Agora depende: a afinidade e o primeiro criterio, e a
  -- recusa por atendimento humano continua sendo anterior a tudo.
  select * into existing_context from public.conversation_intelligence_contexts context
  where context.organization_id = target_organization
    and context.channel = target_channel
    and context.conversation_key_hash = conversation_hash
    and context.state = 'active'
  limit 1;

  if existing_context.id is null and exists (
    select 1 from public.conversation_intelligence_contexts context
    where context.organization_id = target_organization
      and context.channel = target_channel
      and context.conversation_key_hash = conversation_hash
      and context.state = 'handed_off'
  ) then
    raise exception 'conversation is assigned to human service';
  end if;

  -- Descoberta automatica de campanha, e so quando a conversa ainda nao tem
  -- uma. Numa conversa nova, ela pode ESCOLHER o agente (logo abaixo); numa
  -- conversa ja aberta, o agente ja esta decidido e a campanha descoberta
  -- ainda passa pela validacao de escopo do bloco seguinte. As regras de
  -- elegibilidade (fonte, keyword, campanha padrao, janela de vigencia) sao as
  -- mesmas de antes, sem uma virgula de diferenca.
  if existing_context.campaign_id is null and target_audience = 'customer' then
    select campaign.* into selected_campaign
    from public.organization_campaigns campaign
    left join public.campaign_sources source
      on source.campaign_id = campaign.id and source.organization_id = campaign.organization_id and source.active
    where campaign.organization_id = target_organization
      and campaign.status in ('test', 'active')
      and (campaign.starts_at is null or campaign.starts_at <= now())
      and (campaign.ends_at is null or campaign.ends_at > now())
      and (
        (source.source_type in ('link', 'qr', 'ad', 'tag', 'semantic') and safe_source ->> source.source_type = source.source_value)
        or (source.source_type = 'keyword' and source.source_value <> '' and position(lower(source.source_value) in normalized_message) > 0)
        or campaign.is_default
      )
    order by
      case when source.source_type in ('link', 'qr', 'ad', 'tag', 'semantic') then 0
           when source.source_type = 'keyword' then 1
           when campaign.is_default then 3 else 2 end,
      source.priority nulls last,
      campaign.created_at, campaign.id
    limit 1;
  end if;

  -- O AGENTE. Precedencia: afinidade > campanha > padrao. Os tres ramos sao
  -- excludentes, os tres fixam o agente por criterio explicito (id ou
  -- is_default), e os tres recusam em vez de procurar substituto.
  if existing_context.id is not null then
    -- 1. AFINIDADE. A conversa ja pertence a alguem. `audience` entra na busca
    --    porque a FK composta garante organizacao, nao publico: um contexto
    --    apontando para agente de outro publico e dado corrompido, e vira
    --    recusa, nao troca silenciosa.
    select * into selected_profile from public.assistant_profiles profile
    where profile.id = existing_context.assistant_profile_id
      and profile.organization_id = target_organization
      and profile.audience = target_audience;
    if not found then raise exception 'assistant profile is inactive or unavailable'; end if;
    if not selected_profile.active then raise exception 'assistant profile is inactive or unavailable'; end if;
  elsif selected_campaign.id is not null then
    -- 2. CAMPANHA. Conversa nova que casou com campanha de clientes: quem
    --    atende e o agente daquela campanha, e nao o padrao com a campanha de
    --    outro agente colada por cima.
    select * into selected_profile from public.assistant_profiles profile
    where profile.id = selected_campaign.assistant_profile_id
      and profile.organization_id = target_organization
      and profile.audience = target_audience;
    if not found then raise exception 'assistant profile is inactive or unavailable'; end if;
    if not selected_profile.active then raise exception 'assistant profile is inactive or unavailable'; end if;
  else
    -- 3. PADRAO. O comportamento da FASE D, intacto, para todo o resto:
    --    conversa nova sem campanha, e o publico interno inteiro.
    select * into selected_profile from public.assistant_profiles profile
    where profile.organization_id = target_organization
      and profile.audience = target_audience
      and profile.is_default;
    if not found then raise exception 'assistant profile is inactive or unavailable'; end if;
    if not selected_profile.active then raise exception 'assistant profile is inactive or unavailable'; end if;
  end if;

  -- O SOUL, do agente que acabou de ser escolhido -- e de nenhum outro. Ele sai
  -- de `selected_profile`, a mesma linha que os tres ramos acima fixaram, entao
  -- nao existe caminho pelo qual a persona de um agente alcance a conversa de
  -- outro. Agente sem soul manda `null`, nunca o soul do padrao: heranca de
  -- persona por ausencia e o mesmo erro que a FASE D proibiu para disponibilidade.
  --
  -- `btrim` + `nullif` fazem soul so de espaco valer como ausente, para o
  -- runtime nao precisar decidir isso de novo do outro lado.
  soul_texto := nullif(btrim(coalesce(selected_profile.soul_markdown, '')), '');

  -- Guarda de tamanho. Depois desta migration a constraint da tabela impede que
  -- um soul maior que 8000 seja gravado, entao este ramo so alcanca linha
  -- anterior a ela. Ele DESCARTA em vez de levantar: persona nao e permissao, e
  -- derrubar o atendimento inteiro por causa de um texto longo demais troca um
  -- problema cosmetico por um problema real. O runtime repete a mesma regra.
  if soul_texto is not null and length(soul_texto) > 8000 then
    soul_texto := null;
  end if;

  -- O hash viaja junto para que o runtime possa REGISTRAR qual persona entrou no
  -- turno sem nunca escrever o conteudo dela em log. Mesmo formato do
  -- `contentHash` de skill: sha256 em hex.
  soul_hash := case
    when soul_texto is null then null
    else encode(extensions.digest(soul_texto, 'sha256'), 'hex')
  end;

  -- A campanha de uma conversa JA ABERTA nunca atravessa o agente pinado. Sao
  -- os dois caminhos possiveis: a campanha que ja estava gravada no contexto
  -- (recarregada e validada) e a que a descoberta acima achou (descartada se
  -- for de outro agente). Descartar e nao recusar porque campanha e do funil,
  -- nao da conversa: perder a campanha degrada o atendimento, misturar a
  -- campanha de um agente com a personalidade de outro corrompe.
  if existing_context.id is not null then
    if existing_context.campaign_id is not null then
      select * into selected_campaign from public.organization_campaigns campaign
      where campaign.id = existing_context.campaign_id
        and campaign.organization_id = target_organization
        and campaign.assistant_profile_id = selected_profile.id;
    elsif selected_campaign.id is not null
      and selected_campaign.assistant_profile_id is distinct from selected_profile.id then
      selected_campaign := null;
    end if;
  end if;

  if existing_context.active_skill_id is not null then
    select * into selected_skill from public.skill_definitions skill
    where skill.id = existing_context.active_skill_id and skill.status = 'published';
  end if;
  if selected_skill.id is null and selected_campaign.id is not null then
    select skill.* into selected_skill
    from public.campaign_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    where binding.organization_id = target_organization and binding.campaign_id = selected_campaign.id
    order by
      case when exists (
        select 1 from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,keywords}', '[]'::jsonb)) keyword
        where position(lower(keyword) in normalized_message) > 0
      ) then 0 else 1 end,
      binding.priority, skill.name
    limit 1;
  end if;
  if selected_skill.id is null then
    select skill.* into selected_skill
    from public.assistant_profile_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    where binding.organization_id = target_organization
      and binding.profile_id = selected_profile.id and binding.enabled
      and skill.audience in (target_audience, 'both')
    order by
      case when exists (
        select 1 from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,keywords}', '[]'::jsonb)) keyword
        where position(lower(keyword) in normalized_message) > 0
      ) then 0 else 1 end,
      binding.priority, skill.name
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', skill.id, 'slug', skill.slug, 'nome', skill.name,
    'descricao', skill.description, 'versao', skill.current_version,
    'spec', skill.spec, 'prioridade', binding.priority,
    'configuracao', binding.configuration
  ) order by binding.priority, skill.name), '[]'::jsonb)
  into skills_payload
  from public.assistant_profile_skills binding
  join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
  where binding.organization_id = target_organization
    and binding.profile_id = selected_profile.id and binding.enabled
    and skill.audience in (target_audience, 'both');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', collection.id, 'nome', collection.name, 'escopo', collection.scope_type,
    'audiencia', collection.audience
  ) order by collection.name), '[]'::jsonb)
  into collections_payload
  from public.knowledge_collections collection
  where collection.organization_id = target_organization and collection.status = 'active'
    and (
      (target_audience = 'internal' and collection.audience = 'internal' and collection.scope_type <> 'personal')
      or (target_audience = 'customer' and collection.audience = 'external' and (
        collection.scope_type <> 'campaign'
        or exists (
          select 1 from public.campaign_knowledge_collections campaign_collection
          where campaign_collection.organization_id = target_organization
            and campaign_collection.collection_id = collection.id
            and campaign_collection.campaign_id = selected_campaign.id
        )
      ))
    );

  if should_persist then
    if existing_context.id is not null then
      update public.conversation_intelligence_contexts context
      set assistant_profile_id = selected_profile.id,
          campaign_id = coalesce(context.campaign_id, selected_campaign.id),
          active_skill_id = coalesce(selected_skill.id, context.active_skill_id),
          last_message_at = now(), source_context = context.source_context || safe_source
      where context.id = existing_context.id
      returning context.id into saved_context;
    else
      insert into public.conversation_intelligence_contexts (
        organization_id, assistant_profile_id, campaign_id, active_skill_id,
        audience, channel, conversation_key_hash, source_context
      ) values (
        target_organization, selected_profile.id, selected_campaign.id, selected_skill.id,
        target_audience, target_channel, conversation_hash, safe_source
      ) returning id into saved_context;
    end if;
  end if;

  return jsonb_build_object(
    'schemaVersion', 'fase-h-1',
    'contextoId', coalesce(saved_context, existing_context.id),
    'audiencia', target_audience,
    'assistente', jsonb_build_object(
      'id', selected_profile.id, 'nome', selected_profile.display_name,
      'tom', selected_profile.tone, 'marca', selected_profile.brand_config,
      'processo', selected_profile.process_config, 'templateId', selected_profile.template_id,
      'soul', soul_texto, 'soulHash', soul_hash
    ),
    'campanha', case when selected_campaign.id is null then null else jsonb_build_object(
      'id', selected_campaign.id, 'nome', selected_campaign.name,
      'objetivo', selected_campaign.objective, 'oferta', selected_campaign.offer,
      'publico', selected_campaign.audience_description,
      'resultadoEsperado', selected_campaign.desired_outcome,
      'configuracao', selected_campaign.configuration
    ) end,
    'skillAtivo', case when selected_skill.id is null then null else jsonb_build_object(
      'id', selected_skill.id, 'slug', selected_skill.slug, 'nome', selected_skill.name,
      'versao', selected_skill.current_version, 'spec', selected_skill.spec
    ) end,
    'skillsPermitidos', skills_payload,
    'colecoesPermitidas', collections_payload,
    'politicas', jsonb_build_object(
      'organizacaoDerivada', true,
      'confirmacaoParaEscrita', true,
      'documentosComoDados', true,
      'transferenciaHumana', target_audience = 'customer'
    )
  );
end;
$function$;
-- ---------------------------------------------------------------------------
-- 4/4. Asseracoes finais. Se alguma reprovar, a transacao inteira volta.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
  buscas int;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'intelligence_payload';
  if corpo is null then
    raise exception 'FASE 13C falhou: intelligence_payload sumiu';
  end if;

  -- O Soul sai do perfil selecionado, e de nenhuma consulta propria.
  if corpo not like '%selected_profile.soul_markdown%' then
    raise exception 'FASE 13C falhou: o Soul nao esta sendo lido do agente selecionado';
  end if;
  if corpo not like '%''soul'', soul_texto%' or corpo not like '%''soulHash'', soul_hash%' then
    raise exception 'FASE 13C falhou: o payload nao carrega soul e soulHash';
  end if;

  -- A 13B continua inteira: os tres criterios, as seis recusas e as tres (e so
  -- tres) consultas a assistant_profiles. Uma quarta seria uma busca de persona
  -- por fora do agente escolhido -- o caminho de vazamento entre agentes.
  buscas := (length(corpo) - length(replace(corpo, 'from public.assistant_profiles profile', ''))) / length('from public.assistant_profiles profile');
  if buscas <> 3 then
    raise exception 'FASE 13C falhou: esperava 3 selecoes de agente, achei % -- alguma busca nova de perfil apareceu', buscas;
  end if;
  if corpo not like '%profile.id = existing_context.assistant_profile_id%'
     or corpo not like '%profile.id = selected_campaign.assistant_profile_id%'
     or corpo not like '%profile.is_default%' then
    raise exception 'FASE 13C falhou: a precedencia do Router da 13B foi perdida';
  end if;
  if (length(corpo) - length(replace(corpo, 'assistant profile is inactive or unavailable', ''))) / length('assistant profile is inactive or unavailable') <> 6 then
    raise exception 'FASE 13C falhou: as seis recusas da 13B nao estao mais la';
  end if;

  -- O contrato de saida nao mudou.
  if corpo not like '%''schemaVersion'', ''fase-h-1''%' then
    raise exception 'FASE 13C falhou: o schemaVersion do payload mudou';
  end if;
  if corpo not like '%''assistente'', jsonb_build_object%' then
    raise exception 'FASE 13C falhou: a chave assistente do payload mudou';
  end if;

  -- Soul e persona: ele nao pode ter encostado em ferramenta nem em politica.
  if corpo like '%allowedTools%' or corpo like '%allowed_tools%' then
    raise exception 'FASE 13C falhou: o payload passou a mencionar ferramentas';
  end if;

  -- O teto existe nos dois lugares do banco.
  if corpo not like '%length(soul_texto) > 8000%' then
    raise exception 'FASE 13C falhou: o payload nao aplica o teto de 8000';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_profiles'::regclass
      and conname = 'assistant_profiles_soul_markdown_tamanho'
  ) then
    raise exception 'FASE 13C falhou: a constraint de tamanho do soul nao existe';
  end if;

  -- E o resto da funcao continua sendo o que era.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%SET search_path TO ''''%'
  ) then
    raise exception 'FASE 13C falhou: SECURITY DEFINER ou search_path da funcao mudou';
  end if;
end $$;

-- E os resolvedores de fora nao foram tocados: v2 e v3 continuam copiando o
-- objeto `assistente` inteiro, que e o mecanismo pelo qual as duas chaves novas
-- chegam ao runtimeContext sem mudanca de contrato.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_intelligence_context_resolve_v2'
      and p.prosrc like '%''assistant'', payload -> ''assistente''%'
  ) then
    raise exception 'FASE 13C falhou: o v2 deixou de copiar o objeto assistente inteiro';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_intelligence_context_resolve_v3'
      and p.prosrc like '%''assistant'', base_payload -> ''assistente''%'
  ) then
    raise exception 'FASE 13C falhou: o v3 deixou de copiar o objeto assistente inteiro';
  end if;
end $$;

commit;
