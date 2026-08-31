-- Diagnostico do atendimento externo em modo piloto.
--
-- Responde a UMA pergunta: quando um numero em piloto manda mensagem e nada
-- volta, em que camada parou? O portal grava a selecao no banco, mas quem
-- responde e o runtime na VPS. Sao dois lados, e o sintoma "nao respondeu" e
-- identico nos dois. Este script separa os dois lados sem tocar em nada.
--
-- Somente leitura. Nenhuma linha e criada, alterada ou removida.
--
-- COMO USAR: em `alvo`, ponha o telefone de teste NA FORMA QUE O WHATSAPP
-- ENTREGA, ou seja com o DDI 55 na frente (formatado ou so digitos, tanto
-- faz). Rode o arquivo inteiro no SQL Editor. Cada linha do resultado e uma
-- etapa da guarda, na ordem em que o runtime a atravessa: leia de cima para
-- baixo e pare na primeira que disser FALHA.
--
-- Se a base tiver mais de uma organizacao, preencha tambem organizacao_alvo
-- para nao misturar os resultados.

with alvo as (
  select
    '5565992475324'::text as telefone_informado,
    null::uuid as organizacao_alvo
),

-- Mesma normalizacao de private.customer_phone_matches, reescrita aqui para
-- que o diagnostico nao dependa de permissao sobre o schema private: compara
-- so digitos e trata o nono digito do celular brasileiro como variante, nos
-- dois sentidos.
procurado as (
  select
    digitos.valor,
    case when length(digitos.valor) = 13 and digitos.valor like '55__9%'
      then substring(digitos.valor from 1 for 4) || substring(digitos.valor from 6)
      else digitos.valor end as valor_legado
  from (
    select regexp_replace(telefone_informado, '[^0-9]', '', 'g') as valor
    from alvo
  ) digitos
),

perfil as (
  select profile.id, profile.organization_id, profile.active,
    coalesce(profile.process_config #>> '{rollout,mode}', 'off') as modo,
    profile.process_config #>> '{rollout,updatedAt}' as modo_desde
  from public.assistant_profiles profile
  cross join alvo
  where profile.audience = 'customer'
    and (alvo.organizacao_alvo is null
      or profile.organization_id = alvo.organizacao_alvo)
),

-- Contatos selecionados no piloto, com telefone e whatsapp_id ja normalizados.
selecionados as (
  select contact.id, contact.name,
    regexp_replace(coalesce(contact.phone, ''), '[^0-9]', '', 'g') as telefone,
    regexp_replace(coalesce(contact.whatsapp_id, ''), '[^0-9]', '', 'g') as whatsapp
  from perfil
  join public.customer_assistant_pilot_contacts pilot
    on pilot.organization_id = perfil.organization_id
   and pilot.profile_id = perfil.id
   and pilot.active
  join public.contacts contact
    on contact.id = pilot.contact_id
   and contact.organization_id = pilot.organization_id
   and contact.deleted_at is null
),

variantes as (
  select selecionados.id, selecionados.name,
    selecionados.telefone, selecionados.whatsapp,
    case when length(selecionados.telefone) = 13 and selecionados.telefone like '55__9%'
      then substring(selecionados.telefone from 1 for 4)
        || substring(selecionados.telefone from 6)
      else selecionados.telefone end as telefone_legado,
    case when length(selecionados.whatsapp) = 13 and selecionados.whatsapp like '55__9%'
      then substring(selecionados.whatsapp from 1 for 4)
        || substring(selecionados.whatsapp from 6)
      else selecionados.whatsapp end as whatsapp_legado
  from selecionados
),

-- A guarda nucleo_customer_assistant_access exige EXATAMENTE UM casamento:
-- zero devolve contact_not_selected, dois ou mais devolvem contact_ambiguous,
-- e nos dois casos a automacao fica calada.
casados as (
  select variantes.id, variantes.name, variantes.telefone, variantes.whatsapp
  from variantes
  cross join procurado
  where length(procurado.valor) between 10 and 15
    and (
      (
        length(variantes.telefone) between 10 and 15
        and variantes.telefone in (procurado.valor, procurado.valor_legado)
      ) or (
        length(variantes.telefone_legado) between 10 and 15
        and variantes.telefone_legado in (procurado.valor, procurado.valor_legado)
      ) or (
        length(variantes.whatsapp) between 10 and 15
        and variantes.whatsapp in (procurado.valor, procurado.valor_legado)
      ) or (
        length(variantes.whatsapp_legado) between 10 and 15
        and variantes.whatsapp_legado in (procurado.valor, procurado.valor_legado)
      )
    )
),

-- Casamento TOLERANTE, so para diagnostico: reduz qualquer forma do numero a
-- DDD + os 8 digitos finais. Isso ignora o DDI 55 e o nono digito de uma vez.
-- A guarda real NAO faz isso: private.customer_phone_matches trata o nono
-- digito mas nao trata a ausencia do DDI. Se a etapa 3 falhar e a etapa 10
-- passar, o contato esta no piloto e o unico problema e o formato gravado no
-- cadastro.
chave_procurada as (
  select case
    when length(valor) >= 12 and left(valor, 2) = '55'
      then substring(valor from 3) else valor end as sem_ddi
  from procurado
),
alvo_chave as (
  select left(sem_ddi, 2) || right(sem_ddi, 8) as chave
  from chave_procurada
  where length(sem_ddi) in (10, 11)
),
selecionados_chave as (
  select selecionados.id, selecionados.name, selecionados.telefone,
    case
      when length(selecionados.telefone) >= 12 and left(selecionados.telefone, 2) = '55'
        then substring(selecionados.telefone from 3)
      else selecionados.telefone end as sem_ddi
  from selecionados
),
casados_tolerante as (
  select selecionados_chave.id, selecionados_chave.name,
    selecionados_chave.telefone
  from selecionados_chave
  join alvo_chave
    on alvo_chave.chave =
       left(selecionados_chave.sem_ddi, 2) || right(selecionados_chave.sem_ddi, 8)
  where length(selecionados_chave.sem_ddi) in (10, 11)
),

campanha as (
  select campaign.id, campaign.status
  from perfil
  join public.organization_campaigns campaign
    on campaign.organization_id = perfil.organization_id
   and campaign.assistant_profile_id = perfil.id
   and campaign.name = 'Piloto Atendimento Major'
),

skills_ligadas as (
  select count(*) as total
  from campanha
  join public.campaign_skills binding on binding.campaign_id = campanha.id
  join public.skill_definitions skill on skill.id = binding.skill_id
  where skill.slug in ('recepcao', 'pre-qualificacao', 'vendas', 'suporte', 'solicitacao-agenda')
),

-- to_jsonb de proposito: as colunas de prontidao foram acrescentadas em fases
-- diferentes (H.4, H.5) e o diagnostico nao pode quebrar num banco que ainda
-- nao recebeu a ultima.
runtime as (
  select to_jsonb(status) as campos
  from public.connection_runtime_status status
  join perfil on perfil.organization_id = status.organization_id
),

contextos as (
  select contexto.state, contexto.last_message_at
  from public.conversation_intelligence_contexts contexto
  join perfil on perfil.organization_id = contexto.organization_id
  where contexto.audience = 'customer'
),

transferencias as (
  select count(*) as abertas
  from public.customer_handoff_requests pedido
  join perfil on perfil.organization_id = pedido.organization_id
  where pedido.status in ('requested', 'accepted')
)

select etapa, camada, situacao, detalhe from (

  select 1 as etapa,
    'perfil de cliente'::text as camada,
    (case when (select count(*) from perfil) = 0 then 'FALHA'
      when (select bool_and(active) from perfil) then 'ok'
      else 'FALHA' end)::text as situacao,
    (case when (select count(*) from perfil) = 0
        then 'nenhum assistant_profiles com audience = customer nesta base'
      when not (select bool_and(active) from perfil)
        then 'o perfil de cliente existe mas esta inativo'
      else 'perfil de cliente ativo' end)::text as detalhe

  union all
  select 2, 'modo do rollout',
    case when (select modo from perfil limit 1) in ('pilot', 'active')
      then 'ok' else 'FALHA' end,
    coalesce(
      'modo = ' || (select modo from perfil limit 1)
      || coalesce(' desde ' || (select modo_desde from perfil limit 1), '')
      || case when (select modo from perfil limit 1) = 'off'
           then ' (em off a guarda recusa todo mundo)' else '' end,
      'sem perfil de cliente')

  union all
  select 3, 'contato no piloto',
    case when (select count(*) from casados) = 1 then 'ok' else 'FALHA' end,
    case (select count(*) from casados)
      when 0 then 'o telefone informado nao casa com nenhum contato selecionado. '
        || 'Selecionados no piloto: '
        || coalesce((select string_agg(name || ' [' || telefone || ']', ', ')
                     from selecionados), 'nenhum')
      when 1 then 'casou com o contato '
        || (select name from casados limit 1)
      else 'casou com ' || (select count(*) from casados)::text
        || ' contatos; a guarda exige exatamente um e recusa por ambiguidade'
    end

  union all
  select 4, 'campanha do piloto',
    case when exists (select 1 from campanha where status = 'test')
      then 'ok' else 'FALHA' end,
    case when not exists (select 1 from campanha)
        then 'a campanha Piloto Atendimento Major nao existe para este perfil'
      when not exists (select 1 from campanha where status = 'test')
        then 'a campanha existe com status '
          || (select status from campanha limit 1)
          || '; a guarda so aceita test'
      else 'campanha em test' end

  union all
  select 5, 'skills da campanha',
    case when (select total from skills_ligadas) = 5 then 'ok' else 'FALHA' end,
    (select total from skills_ligadas)::text
      || ' das 5 skills oficiais ligadas a campanha'

  union all
  select 6, 'runtime da conexao',
    case when exists (
      select 1 from runtime
      where campos->>'bridge_status' = 'online'
        and campos->>'assistant_status' = 'online'
        and campos->>'whatsapp_status' = 'connected'
    ) then 'ok' else 'FALHA' end,
    coalesce(
      (select string_agg(
        'bridge=' || coalesce(campos->>'bridge_status', '?')
        || ' whatsapp=' || coalesce(campos->>'whatsapp_status', '?')
        || ' assistente=' || coalesce(campos->>'assistant_status', '?')
        || ' mcp=' || coalesce(campos->>'mcp_status', '?')
        || ' automacao=' || coalesce(campos->>'automation_enabled', '?')
        || ' dono_padrao=' || coalesce(campos->>'default_owner', '?')
        || ' modelo=' || coalesce(campos->>'model_status', 'n/d')
        || ' erro_modelo=' || coalesce(campos->>'last_model_error_code', 'nenhum')
        || ' versao=' || coalesce(nullif(campos->>'runtime_version', ''), 'vazia')
        || ' contrato=' || coalesce(nullif(campos->>'contract_version', ''), 'vazio'),
        ' || ') from runtime),
      'nenhuma linha em connection_runtime_status para esta organizacao')

  union all
  select 7, 'heartbeat',
    case when exists (
      select 1 from runtime
      where (campos->>'heartbeat_at')::timestamptz > now() - interval '5 minutes'
    ) then 'ok' else 'FALHA' end,
    coalesce(
      (select 'ultimo sinal em '
        || max((campos->>'heartbeat_at')::timestamptz)::text from runtime),
      'sem heartbeat registrado')

  union all
  -- A prova decisiva. Se ha contexto recente, a mensagem chegou ao runtime e
  -- ele atravessou a guarda: o problema esta depois (modelo, skill, envio).
  -- Se nao ha, o runtime nem chegou a consultar: o problema esta antes.
  select 8, 'a mensagem chegou ao runtime?',
    case when exists (
      select 1 from contextos where last_message_at > now() - interval '2 hours'
    ) then 'ok' else 'FALHA' end,
    coalesce(
      (select 'contexto de cliente mais recente em '
        || max(last_message_at)::text from contextos),
      'nenhum contexto de cliente jamais criado: o runtime nao atendeu '
        || 'nenhuma mensagem externa nesta organizacao')

  union all
  -- A automacao fica em silencio de proposito quando um humano assumiu.
  select 9, 'atendimento humano aberto',
    case when (select abertas from transferencias) > 0 then 'ATENCAO' else 'ok' end,
    case when (select abertas from transferencias) > 0
      then (select abertas from transferencias)::text
        || ' transferencia(s) em aberto; enquanto houver, a automacao nao '
        || 'responde nessas conversas'
      else 'nenhuma transferencia humana em aberto' end


  union all
  select 10, 'o numero esta no piloto, ignorando formato?',
    case
      when (select count(*) from casados) = 1 then 'ok'
      when (select count(*) from casados_tolerante) >= 1 then 'CAUSA'
      else 'ok' end,
    case
      when (select count(*) from casados) = 1
        then 'etapa 3 ja passou; nada a investigar aqui'
      when (select count(*) from casados_tolerante) >= 1
        then 'O CONTATO ESTA NO PILOTO, mas o telefone gravado ('
          || coalesce((select string_agg(telefone, ', ')
                       from casados_tolerante), '?')
          || ') nao casa com o numero que o WhatsApp entrega ('
          || (select valor from procurado)
          || ') pela regra da guarda, que trata o nono digito mas nao a '
          || 'ausencia do DDI 55. Regravar o contato com o DDI resolve.'
      else 'o numero nao esta entre os contatos selecionados nem ignorando '
        || 'DDI e nono digito; selecione o contato certo no piloto'
    end

) resultado
order by etapa;
