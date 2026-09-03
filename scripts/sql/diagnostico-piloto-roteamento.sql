-- Terceira rodada: por que a mensagem do numero em piloto nao gerou contexto.
--
-- O que ja se sabe:
--   - a guarda do piloto aprovaria o numero (perfil ativo, modo pilot, contato
--     casado, campanha em test);
--   - o runtime resolve contexto INTERNO normalmente (4 contextos, o ultimo
--     as 03:56), entao o caminho da fase H esta implantado ao menos em parte;
--   - nenhum contexto de cliente jamais foi criado.
--
-- Antes de resolver o assistente, a Bridge decide de que lado a mensagem cai:
-- se o numero for um operador verificado da conexao, ela segue pelo caminho
-- INTERNO e nunca consulta a guarda de cliente. Um numero de teste cadastrado
-- como operador explica exatamente o silencio observado.
--
-- Somente leitura.

with alvo as (
  select '5565992475324'::text as telefone_informado
),

-- Chave tolerante: DDD + os 8 digitos finais, ignorando DDI e nono digito.
-- Serve para comparar cadastros gravados em formatos diferentes.
chave_alvo as (
  select left(sem_ddi, 2) || right(sem_ddi, 8) as chave, digitos.valor
  from (
    select regexp_replace(telefone_informado, '[^0-9]', '', 'g') as valor
    from alvo
  ) digitos
  cross join lateral (
    select case
      when length(digitos.valor) >= 12 and left(digitos.valor, 2) = '55'
        then substring(digitos.valor from 3) else digitos.valor end as sem_ddi
  ) recorte
),

perfil as (
  select profile.id, profile.organization_id
  from public.assistant_profiles profile
  where profile.audience = 'customer'
),

campanha as (
  select campaign.id
  from perfil
  join public.organization_campaigns campaign
    on campaign.organization_id = perfil.organization_id
   and campaign.assistant_profile_id = perfil.id
   and campaign.name = 'Piloto Atendimento Major'
),

oficiais as (
  select * from (values
    ('recepcao'), ('pre-qualificacao'), ('vendas'), ('suporte'),
    ('solicitacao-agenda')
  ) as lista(slug)
),

operadores as (
  select operador.phone_e164, operador.status, operador.verified_at,
    left(sem_ddi.valor, 2) || right(sem_ddi.valor, 8) as chave
  from public.whatsapp_connection_operators operador
  cross join lateral (
    select case
      when length(operador.phone_e164) >= 12 and left(operador.phone_e164, 2) = '55'
        then substring(operador.phone_e164 from 3) else operador.phone_e164 end as valor
  ) sem_ddi
)

select bloco, chave, valor, observacao from (

  -- 1. A pergunta decisiva: o numero de teste e um operador?
  select '1. numero e operador?'::text as bloco,
    coalesce(operadores.phone_e164, '-')::text as chave,
    coalesce(operadores.status, '-')::text as valor,
    ('ESTE E O NUMERO DO TESTE. Enquanto ele for operador da conexao, a '
      || 'Bridge trata a mensagem como interna e nunca chega a consultar a '
      || 'guarda de cliente. Verificado em '
      || coalesce(operadores.verified_at::text, 'nao verificado'))::text as observacao
  from operadores
  join chave_alvo on chave_alvo.chave = operadores.chave

  union all
  select '1. numero e operador?', 'resumo',
    case when exists (
      select 1 from operadores
      join chave_alvo on chave_alvo.chave = operadores.chave
    ) then 'SIM' else 'nao' end,
    case when exists (
      select 1 from operadores
      join chave_alvo on chave_alvo.chave = operadores.chave
    ) then 'causa provavel do silencio: use outro numero, que nao seja '
      || 'operador, para testar o piloto'
      else 'o numero de teste nao e operador; a Bridge deveria trata-lo '
      || 'como cliente' end

  -- 2. Todos os operadores cadastrados, para conferencia visual
  union all
  select '2. operadores da conexao', operadores.phone_e164, operadores.status,
    coalesce(operadores.verified_at::text, 'nao verificado')
  from operadores

  -- 3. A credencial que o runtime usa para chamar as RPCs
  union all
  select '3. credencial do robo', credencial.status,
    coalesce(credencial.last_used_at::text, 'nunca usada'),
    'se last_used_at estiver parado, o runtime nao esta chamando as RPCs '
      || 'do Nucleo'
  from public.connection_robot_credentials credencial
  join perfil on perfil.organization_id = credencial.organization_id

  -- 4. As cinco skills oficiais corretas desde a fase H.4
  union all
  select '4. skill oficial', oficiais.slug,
    case when exists (
      select 1 from campanha
      join public.campaign_skills binding on binding.campaign_id = campanha.id
      join public.skill_definitions skill on skill.id = binding.skill_id
      where skill.slug = oficiais.slug
    ) then 'ligada' else 'FALTANDO' end,
    coalesce((
      select string_agg(skill.owner_type || '/' || skill.status, ', ')
      from public.skill_definitions skill
      where skill.slug = oficiais.slug
    ), 'nao existe skill_definitions com este slug')
  from oficiais

  -- 5. Os contextos internos, para cruzar com o horario do seu teste
  union all
  select '5. contextos internos', contexto.state,
    contexto.last_message_at::text,
    'compare com o horario em que voce mandou a mensagem do numero em piloto'
  from public.conversation_intelligence_contexts contexto
  join perfil on perfil.organization_id = contexto.organization_id
  where contexto.audience = 'internal'

) resultado
order by bloco, chave;
