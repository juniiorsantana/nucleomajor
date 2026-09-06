-- O agente da conversa deixa de ser sempre o padrao.
--
-- FASE 13 (Agent Router), primeira fatia. A FASE E deu ao banco N agentes por
-- audience e a FASE F deu a gestao deles, mas quem responde continuou sendo
-- SEMPRE o `is_default`: um agente nao-padrao existia, era configuravel, e nao
-- atendia ninguem. Esta migration instala a precedencia que faltava, e so ela.
--
-- A regra que entra, inteira:
--
--     conversa em atendimento humano        -> recusa (como ja era)
--     contexto ativo                        -> o agente PINADO na conversa
--     conversa nova + campanha customer     -> o agente DA CAMPANHA
--     nada disso                            -> o agente `is_default` (como ja era)
--
-- Tres coisas dessa lista precisam ser lidas com atencao, porque sao o ponto
-- da fase e nao detalhes de implementacao:
--
-- 1. **A afinidade passa a existir de verdade.** A linha por conversa
--    (`conversation_intelligence_contexts`) sempre teve `assistant_profile_id`,
--    mas o corpo vigente (FASE D) o sobrescrevia com o padrao a cada turno:
--
--        set assistant_profile_id = selected_profile.id   -- e selected_profile
--                                                         -- era sempre o padrao
--
--    Ou seja: o campo existia, a chave da afinidade existia, e a afinidade
--    NAO existia. Aqui a selecao passa a LER esse campo antes de decidir, e a
--    escrita continua identica -- no ramo pinado ela reescreve o mesmo id, o
--    que e um no-op. Nenhuma coluna nova, nenhum backfill.
--
-- 2. **Recusar continua sendo mais importante que responder.** A FASE D
--    estabeleceu que um agente nao herda conversa por indisponibilidade de
--    outro. Isso vale agora para os tres ramos: pinado inativo recusa, agente
--    de campanha inativo recusa, padrao inativo recusa. Nenhum deles cai no
--    seguinte. Um cliente que estava falando com o SDR e volta a falar depois
--    de o SDR ser desligado ouve o silencio de sempre -- ele nao passa a ser
--    atendido, sem avisar ninguem, por um agente com outra personalidade,
--    outras skills e outro conhecimento.
--
-- 3. **A mensagem publica nao muda.** As seis recusas usam a string que ja
--    existe, `assistant profile is inactive or unavailable`, exatamente como a
--    FASE D fez ao colapsar "nao existe padrao" e "o padrao esta inativo".
--    Runtime, worker e portal reconhecem essa string hoje; inventar codigo novo
--    aqui obrigaria a mexer no repositorio do runtime, que esta fora do escopo
--    desta fatia.
--
-- O que esta fatia NAO faz, de proposito:
--
-- * nao cria coluna, tabela, indice ou tipo -- e so um CREATE OR REPLACE;
-- * nao toca `nucleo_intelligence_context_resolve_v2` nem o `_v3`. O v3 nao
--   escolhe agente: ele le `context_row.assistant_profile_id`, que e o mesmo
--   campo que esta migration passa a respeitar. Uma semantica, nao duas;
-- * nao muda `schemaVersion` ('fase-h-1' aqui dentro, 'fase-h-2'/'fase-h-3' na
--   borda) nem qualquer chave de `runtimeContext.assistant`;
-- * nao cria `targetAgentId`, nem `targetMode = 'agent'`, nem campo novo de
--   payload, nem ferramenta nova. O worker (`whatsapp-mcp-hardened`) nao muda
--   uma linha por causa desta migration -- ele ja manda tudo que o banco
--   precisa: `conversation_key_hash`, `requester_phone`, `incoming_text` e
--   `source_data`;
-- * nao cria roteamento de agente por keyword. Keywords continuam escolhendo
--   campanha e skill, como hoje. Rotear agente por palavra exigiria modelo
--   novo, e modelo novo nao entra numa fatia que se prova por reescrita de uma
--   funcao so;
-- * nao renomeia `assistente` para `agente` em lugar nenhum do payload.
--
-- Duas consequencias que precisam estar escritas, porque mudam comportamento
-- observavel e nenhuma delas e acidente:
--
-- * **Trocar o agente padrao nao move as conversas ja abertas.** Elas
--   continuam com quem estavam. Isso e a definicao de afinidade; quem quiser o
--   contrario encerra o contexto (`state`) em vez de esperar que o roteador
--   mude de ideia no meio da conversa.
-- * **Uma conversa NOVA que casa com campanha vinculada a agente inativo passa
--   a recusar**, onde antes era atendida pelo padrao com a campanha de outro
--   agente colada no contexto. Esse "antes" e exatamente a mistura que a fase
--   remove. Em producao hoje isso nao alcanca ninguem: a unica campanha viva
--   ('Piloto Atendimento Major') aponta para o proprio padrao de clientes.
--
-- Sobre `limit 1`: nenhuma das tres selecoes de agente usa. A pinada e a de
-- campanha entram por `id + organization_id + audience`, e a do padrao depende
-- explicitamente de `is_default`, protegida pelo indice parcial
-- `assistant_profiles_one_default_idx` (FASE C), que garante no maximo um
-- padrao por (organizacao, audience). Os `limit 1` que sobram no corpo
-- escolhem contexto, campanha e skill -- nunca agente.
--
-- Um desempate, e so um, foi acrescentado a descoberta de campanha:
-- `campaign.id` como ULTIMA chave do `order by`, depois de `campaign.created_at`.
-- Ele nao muda precedencia nenhuma -- as chaves anteriores (tipo de fonte,
-- prioridade da fonte, data de criacao) decidem antes e continuam identicas.
-- Ele so troca "empate resolvido pelo plano de execucao" por "empate resolvido
-- sempre igual", que e o que faz duas chamadas iguais devolverem a mesma
-- campanha quando duas campanhas nascem no mesmo instante. Sem ele, o `limit 1`
-- do fim seria, nesse caso, o mesmo sorteio silencioso que a FASE D tirou da
-- selecao de agente.
--
-- O corpo abaixo sai da definicao vigente
-- (`20260904230000_resolvers_usam_agente_padrao.sql`, FASE D). As unicas
-- diferencas sao: a carga do contexto subiu para antes da selecao do agente, a
-- selecao virou tres ramos, a campanha da conversa ja existente passou a ser
-- validada contra o agente pinado, e o desempate acima. Persistencia, skills,
-- colecoes, politicas e o JSON de retorno estao byte a byte iguais.

begin;

-- ---------------------------------------------------------------------------
-- 1/3. Guardas. Fail closed, e antes de qualquer alteracao.
-- ---------------------------------------------------------------------------
-- Nenhuma delas corrige dado. Se o schema nao estiver no estado que as FASES
-- C-F deixaram, esta migration recusa rodar e nao deixa nada pela metade.
do $$
declare
  contexto_nulavel boolean;
  campanha_nulavel boolean;
begin
  -- A coluna da FASE C. Sem ela o ramo do padrao nao existe.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and column_name = 'is_default'
  ) then
    raise exception 'FASE 13 abortada: a coluna is_default (FASE C) nao existe';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assistant_profiles'
      and column_name = 'active'
  ) then
    raise exception 'FASE 13 abortada: a coluna active de assistant_profiles nao existe';
  end if;

  -- O indice parcial e o que torna correta a selecao do padrao SEM limit 1:
  -- ele garante no maximo um padrao por (organizacao, audience). Sem ele,
  -- `select into` sem `strict` voltaria a poder escolher em silencio.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'assistant_profiles'
      and indexname = 'assistant_profiles_one_default_idx'
      and indexdef like '%WHERE is_default%'
  ) then
    raise exception 'FASE 13 abortada: o indice parcial de agente padrao (FASE C) nao existe';
  end if;

  -- A afinidade. E a coluna que esta fatia inteira passa a respeitar.
  select is_nullable = 'YES' into contexto_nulavel
  from information_schema.columns
  where table_schema = 'public' and table_name = 'conversation_intelligence_contexts'
    and column_name = 'assistant_profile_id';
  if contexto_nulavel is null then
    raise exception 'FASE 13 abortada: conversation_intelligence_contexts.assistant_profile_id nao existe';
  end if;
  if contexto_nulavel then
    raise exception 'FASE 13 abortada: conversation_intelligence_contexts.assistant_profile_id virou nulavel; o ramo da afinidade supoe NOT NULL';
  end if;

  -- O vinculo campanha -> agente. E o unico sinal de roteamento que esta fatia
  -- consome alem da afinidade.
  select is_nullable = 'YES' into campanha_nulavel
  from information_schema.columns
  where table_schema = 'public' and table_name = 'organization_campaigns'
    and column_name = 'assistant_profile_id';
  if campanha_nulavel is null then
    raise exception 'FASE 13 abortada: organization_campaigns.assistant_profile_id nao existe';
  end if;
  if campanha_nulavel then
    raise exception 'FASE 13 abortada: organization_campaigns.assistant_profile_id virou nulavel; o ramo da campanha supoe NOT NULL';
  end if;

  -- As duas FKs compostas. Sao ELAS que tornam impossivel atravessar
  -- organizacao, e e por isso que as buscas por id abaixo podem confiar em
  -- (id, organization_id) como escopo.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversation_intelligence_contexts'::regclass
      and contype = 'f'
      and confrelid = 'public.assistant_profiles'::regclass
      and array_length(conkey, 1) = 2
  ) then
    raise exception 'FASE 13 abortada: a FK composta (assistant_profile_id, organization_id) do contexto sumiu';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.organization_campaigns'::regclass
      and contype = 'f'
      and confrelid = 'public.assistant_profiles'::regclass
      and array_length(conkey, 1) = 2
  ) then
    raise exception 'FASE 13 abortada: a FK composta (assistant_profile_id, organization_id) da campanha sumiu';
  end if;

  -- A FASE D precisa estar aplicada: e o corpo dela que esta migration
  -- reescreve. Se o que estiver vivo for o corpo pre-D, reescrever por cima
  -- apagaria a correcao do padrao sem que ninguem percebesse.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%profile.is_default%'
  ) then
    raise exception 'FASE 13 abortada: intelligence_payload nao seleciona por is_default (FASE D ausente)';
  end if;

  -- E o corpo vivo tem de ser o da FASE D mesmo, nao um Agent Router que
  -- alguem ja tenha instalado por outro caminho.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosrc like '%existing_context.assistant_profile_id%'
  ) then
    raise exception 'FASE 13 abortada: intelligence_payload ja le a afinidade; conferir o que esta vivo antes de reescrever';
  end if;
end $$;

-- O ACL da funcao e capturado antes para ser conferido depois. CREATE OR
-- REPLACE preserva dono e privilegios, mas isso e promessa do Postgres, e a
-- divida de menor privilegio deste projeto (ver docs/STATUS.md) e velha o
-- bastante para nao se conferir sozinha.
create temporary table _fase_13_acl_antes on commit drop as
select p.oid, p.proacl, p.proowner, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname = 'intelligence_payload';

-- ---------------------------------------------------------------------------
-- 2/3. private.intelligence_payload -- o unico ponto de decisao
-- ---------------------------------------------------------------------------
-- Por aqui passam v1, v2, v3 e o preview. Reescrever so este corpo e o que
-- garante UMA semantica de roteamento, e nao uma por chamador.
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
      'processo', selected_profile.process_config, 'templateId', selected_profile.template_id
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
-- 3/3. Asseracoes finais. Se alguma reprovar, a transacao inteira volta.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
  recusas int;
  buscas int;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'intelligence_payload';
  if corpo is null then
    raise exception 'FASE 13 falhou: intelligence_payload sumiu';
  end if;

  -- Os tres criterios de selecao existem, e sao estes tres.
  if corpo not like '%profile.id = existing_context.assistant_profile_id%' then
    raise exception 'FASE 13 falhou: a selecao por afinidade nao esta no corpo aplicado';
  end if;
  if corpo not like '%profile.id = selected_campaign.assistant_profile_id%' then
    raise exception 'FASE 13 falhou: a selecao pelo agente da campanha nao esta no corpo aplicado';
  end if;
  if corpo not like '%profile.is_default%' then
    raise exception 'FASE 13 falhou: a selecao do agente padrao (FASE D) foi perdida';
  end if;

  -- A regra da FASE D que esta fatia herda: `active` nunca volta para dentro
  -- do where da selecao, senao um agente parado faz o banco procurar outro.
  if corpo like '%and profile.audience = target_audience and profile.active%'
     or corpo like '%and profile.organization_id = target_organization and profile.active%' then
    raise exception 'FASE 13 falhou: a selecao de agente voltou a filtrar active junto';
  end if;

  -- Seis recusas: tres ramos, cada um com "nao existe" e "existe mas esta
  -- parado". Todas com a string publica de sempre.
  recusas := (length(corpo) - length(replace(corpo, 'assistant profile is inactive or unavailable', ''))) / length('assistant profile is inactive or unavailable');
  if recusas <> 6 then
    raise exception 'FASE 13 falhou: esperava 6 recusas com a mensagem publica de sempre, achei %', recusas;
  end if;

  -- Exatamente tres consultas a assistant_profiles: uma por ramo. Uma quarta
  -- seria, quase certamente, alguem procurando substituto para um agente
  -- indisponivel -- que e o que a FASE D proibiu e esta fatia mantem proibido.
  buscas := (length(corpo) - length(replace(corpo, 'from public.assistant_profiles profile', ''))) / length('from public.assistant_profiles profile');
  if buscas <> 3 then
    raise exception 'FASE 13 falhou: esperava 3 selecoes de agente (afinidade, campanha, padrao), achei %', buscas;
  end if;

  -- O desempate da campanha e determinista, e e a ULTIMA chave da ordenacao.
  if corpo not like '%campaign.created_at, campaign.id%' then
    raise exception 'FASE 13 falhou: o desempate por campaign.id saiu da descoberta de campanha';
  end if;

  -- O contexto continua sendo gravado com o agente resolvido -- e dele que o
  -- v3 le.
  if corpo not like '%set assistant_profile_id = selected_profile.id%' then
    raise exception 'FASE 13 falhou: o contexto deixou de gravar o agente resolvido';
  end if;

  -- E o contrato de saida nao mudou.
  if corpo not like '%''schemaVersion'', ''fase-h-1''%' then
    raise exception 'FASE 13 falhou: o schemaVersion do payload mudou';
  end if;
  if corpo not like '%''assistente'', jsonb_build_object%' then
    raise exception 'FASE 13 falhou: a chave assistente do payload mudou';
  end if;

  -- SECURITY DEFINER e search_path continuam como estavam. A conferencia do
  -- search_path e feita pelo texto que o proprio Postgres gera, e nao pelo
  -- formato interno de `proconfig`, que varia com a versao.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'intelligence_payload'
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%SET search_path TO ''''%'
  ) then
    raise exception 'FASE 13 falhou: SECURITY DEFINER ou search_path da funcao mudou';
  end if;

  -- E o ACL, o dono e as flags sao os mesmos de antes do CREATE OR REPLACE.
  if not exists (
    select 1
    from _fase_13_acl_antes antes
    join pg_proc p on p.oid = antes.oid
    where p.proowner = antes.proowner
      and p.proacl is not distinct from antes.proacl
      and p.prosecdef = antes.prosecdef
      and p.proconfig is not distinct from antes.proconfig
  ) then
    raise exception 'FASE 13 falhou: dono, ACL ou configuracao da funcao mudou no replace';
  end if;
end $$;

commit;
