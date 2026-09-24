-- Liga uma campanha da organização ao formulário instantâneo do Meta (Lead Ads).
--
-- Mesma tabela e mesma função do lead do site (migration 20260915000000, branch
-- feat/leads-do-site, já aplicada em produção). O webhook `/api/webhooks/meta-leads`
-- chama `nucleo_site_lead_receive` com o token gerado aqui.
--
-- Antes de rodar:
--   1. Criar a campanha na tela Inteligência → Campanhas da organização, com um
--      agente ativo e status "teste" ou "ativa". Sem agente ativo o lead entra no
--      CRM, a equipe é avisada, e ninguém chama pelo WhatsApp (`agent_inactive`).
--   2. Trocar o nome da campanha nas DUAS linhas marcadas com  <<< NOME
--   3. A mensagem sai no WhatsApp do cliente e em nome dele: o texto precisa da
--      aprovação do cliente antes de ligar.
--
-- O resultado tem a coluna `token_para_o_servidor`. Ele entra em
-- META_LEADS_INTAKES no servidor do Núcleo (Hostinger), como
-- {"<id da página do Facebook>": "<token>"}. O token NÃO aparece de novo: o banco
-- guarda só o sha256. Rodar outra vez gera um token novo e invalida o anterior.
--
-- `{nome}` vira o primeiro nome do lead. `{site}` não se aplica ao formulário do
-- Meta: não use.
--
-- O contato criado fica com origem "Site · <nome da campanha>", porque a função
-- é a do site. Por isso o nome da campanha deve dizer que é o formulário do Meta.

with campanha as (
  select campaign.id, campaign.organization_id, campaign.created_by
  from public.organization_campaigns campaign
  where campaign.name = 'Formulário Meta · Adriani'   -- <<< NOME
), unica as (
  select campanha.* from campanha where (select count(*) from campanha) = 1
), token as (
  select encode(extensions.gen_random_bytes(32), 'hex') as valor
), gravado as (
  insert into public.campaign_site_intakes (
    campaign_id, organization_id, token_hash, welcome_template, tag_name, hourly_limit, enabled_by
  )
  select
    unica.id,
    unica.organization_id,
    encode(extensions.digest(token.valor, 'sha256'), 'hex'),
    'Oi, {nome}! Aqui é a Adriani, consultora de consórcio 😊 Recebi o seu cadastro agora há pouco. Pra eu te ajudar do jeito certo: o seu objetivo hoje é imóvel ou veículo?',
    'Lead Meta',
    -- Formulário de anúncio chega aos poucos. Dez por hora já é muito para a
    -- verba de hoje e protege o número de um pico que pareça disparo em massa.
    10,
    unica.created_by
  from unica, token
  on conflict (campaign_id) do update
    set token_hash = excluded.token_hash,
        welcome_template = excluded.welcome_template,
        tag_name = excluded.tag_name,
        hourly_limit = excluded.hourly_limit,
        enabled = true,
        updated_at = now()
  returning campaign_id
)
select
  case when (select count(*) from gravado) = 1
    then (select token.valor from token)
    else 'ERRO: nenhuma campanha com esse nome, ou mais de uma'
  end as token_para_o_servidor,
  (select gravado.campaign_id from gravado) as campanha;

-- Desligar a entrada de leads sem apagar nada (o webhook passa a receber
-- recusa e o Meta não reenvia):
--
-- update public.campaign_site_intakes intake
-- set enabled = false, updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id
--   and campaign.name = 'Formulário Meta · Adriani';   -- <<< NOME
