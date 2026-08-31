-- Por que nucleo_intelligence_context_resolve_v2 recusa o turno de cliente.
--
-- A Bridge ja entrega a mensagem (customer_rollout.allowed, mode=pilot), e a
-- resolucao do contexto falha logo depois. A v2, redefinida em
-- 20260828210000_corrigir_roteamento_tarefas_interno.sql, valida a skill ativa
-- antes de devolver o payload e levanta excecao em tres casos:
--
--   'published skill instructions are invalid'    -> texto < 80 ou > 20000
--   'published skill tools are invalid'           -> allowedTools nao e array
--   'published skill contains an unsupported tool'-> ferramenta fora da lista
--
-- A lista aceita nao inclui `calendar.create`, que aparece em outras
-- migrations. Se alguma skill publicada do cliente declarar uma ferramenta
-- fora da lista, todo turno externo cai na excecao e vira handoff.
--
-- Somente leitura.

with aceitas as (
  select * from (values
    ('knowledge.search'), ('crm.contact.read'), ('crm.contact.upsert'),
    ('crm.tag.apply'), ('crm.deal.qualify'), ('conversation.handoff'),
    ('calendar.read'), ('calendar.availability'), ('calendar.prepare'),
    ('calendar.confirm'), ('task.read'), ('task.prepare'), ('task.confirm')
  ) as lista(ferramenta)
),

perfil as (
  select profile.id, profile.organization_id
  from public.assistant_profiles profile
  where profile.audience = 'customer'
),

-- Toda skill que pode virar skill ativa num turno de cliente: as ligadas a
-- campanha do piloto e as ligadas ao proprio perfil.
candidatas as (
  select distinct skill.id, skill.slug, skill.name, skill.status,
    skill.spec #> '{allowedTools}' as ferramentas,
    length(coalesce(skill.spec ->> 'instructionsMarkdown', '')) as tamanho_instrucoes
  from perfil
  join public.assistant_profile_skills binding
    on binding.organization_id = perfil.organization_id
   and binding.profile_id = perfil.id
   and binding.enabled
  join public.skill_definitions skill
    on skill.id = binding.skill_id
   and skill.status = 'published'

  union

  select distinct skill.id, skill.slug, skill.name, skill.status,
    skill.spec #> '{allowedTools}' as ferramentas,
    length(coalesce(skill.spec ->> 'instructionsMarkdown', '')) as tamanho_instrucoes
  from perfil
  join public.organization_campaigns campaign
    on campaign.organization_id = perfil.organization_id
   and campaign.assistant_profile_id = perfil.id
   and campaign.name = 'Piloto Atendimento Major'
  join public.campaign_skills binding on binding.campaign_id = campaign.id
  join public.skill_definitions skill
    on skill.id = binding.skill_id
   and skill.status = 'published'
)

select bloco, chave, valor, observacao from (

  -- 1. Ferramenta fora da lista: a causa mais provavel.
  select '1. ferramenta recusada'::text as bloco,
    candidatas.slug::text as chave,
    item::text as valor,
    'esta ferramenta nao esta na lista da v2; todo turno de cliente que caia '
      || 'nesta skill levanta published skill contains an unsupported tool' as observacao
  from candidatas
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(candidatas.ferramentas) = 'array'
      then candidatas.ferramentas else '[]'::jsonb end
  ) item
  where item not in (select ferramenta from aceitas)

  union all
  select '2. resumo por skill', candidatas.slug,
    case
      when jsonb_typeof(candidatas.ferramentas) is distinct from 'array' then 'TOOLS INVALIDAS'
      when exists (
        select 1 from jsonb_array_elements_text(candidatas.ferramentas) item
        where item not in (select ferramenta from aceitas)
      ) then 'FERRAMENTA RECUSADA'
      when candidatas.tamanho_instrucoes between 1 and 79 then 'INSTRUCOES CURTAS'
      when candidatas.tamanho_instrucoes > 20000 then 'INSTRUCOES LONGAS'
      else 'ok'
    end,
    'ferramentas=' || coalesce(candidatas.ferramentas::text, 'ausente')
      || ' instrucoes=' || candidatas.tamanho_instrucoes::text || ' chars'
  from candidatas

  -- 3. O handoff aberto pela falha mantem a automacao calada mesmo depois de
  -- corrigida a causa. Precisa ser fechado para o teste voltar a valer.
  union all
  select '3. handoff aberto', pedido.status,
    pedido.created_at::text,
    'enquanto houver transferencia aberta, a proxima mensagem do cliente volta '
      || 'como inbound.ignored motivo=ignored_handoff'
  from public.customer_handoff_requests pedido
  join perfil on perfil.organization_id = pedido.organization_id
  where pedido.status in ('requested', 'accepted')

  union all
  select '4. contexto do cliente', contexto.state,
    contexto.last_message_at::text,
    'estado handed_off faz intelligence_payload levantar '
      || 'conversation is assigned to human service'
  from public.conversation_intelligence_contexts contexto
  join perfil on perfil.organization_id = contexto.organization_id
  where contexto.audience = 'customer'

) resultado
order by bloco, chave, valor;
