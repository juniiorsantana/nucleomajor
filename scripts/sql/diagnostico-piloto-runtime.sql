-- Segunda rodada do diagnostico do piloto, depois que a primeira apontou
-- etapa 5 (4 das 5 skills) e etapa 8 (nenhum contexto de cliente) com o runtime
-- reportando contract_version = fase-g-1.
--
-- Duas perguntas, uma consulta:
--
--   A. o runtime da VPS ja usou ALGUMA vez o caminho da fase H, ou so o da
--      fase G? Se nunca criou contexto nenhum (nem interno) e nunca escreveu
--      no log de inteligencia, o build implantado nao tem o caminho de
--      atendimento externo. Nesse caso nao ha nada a corrigir no banco: falta
--      implantar o runtime.
--
--   B. qual das cinco skills oficiais nao esta ligada a campanha do piloto, e
--      por que.
--
-- Somente leitura.

with perfil as (
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
)

select bloco, chave, valor, observacao from (

  -- A. rastro da fase H no banco
  select 'A. contextos'::text as bloco,
    coalesce(contexto.audience, 'nenhum')::text as chave,
    count(contexto.id)::text as valor,
    coalesce(max(contexto.last_message_at)::text, 'nunca')::text as observacao
  from public.conversation_intelligence_contexts contexto
  group by contexto.audience

  union all
  select 'A. contextos', 'total geral', count(*)::text,
    case when count(*) = 0
      then 'o runtime nunca resolveu contexto: caminho da fase H nao implantado'
      else 'o runtime ja usou o caminho da fase H ao menos uma vez' end
  from public.conversation_intelligence_contexts

  union all
  select 'A. log de inteligencia', 'registros de conversa', count(*)::text,
    coalesce(max(created_at)::text, 'nunca')
  from public.intelligence_audit_log
  where entity_type = 'conversation'

  union all
  select 'A. runtime', 'contrato reportado',
    coalesce(string_agg(distinct nullif(contract_version, ''), ', '), 'vazio'),
    'o caminho de atendimento externo e fase-h; fase-g-1 e o assistente '
      || 'interno de operador'
  from public.connection_runtime_status

  union all
  select 'A. runtime', 'versao reportada',
    coalesce(string_agg(distinct nullif(runtime_version, ''), ', '), 'vazia'),
    'compare com a versao do build publicado na VPS'
  from public.connection_runtime_status

  -- B. skills oficiais da campanha
  union all
  select 'B. skill oficial', oficiais.slug,
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
    ), 'nao existe nenhuma skill_definitions com este slug')
  from oficiais

) resultado
order by bloco, chave;
