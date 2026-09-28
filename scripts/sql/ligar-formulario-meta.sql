-- Liga o formulário instantâneo do Meta (Lead Ads) de uma organização, com a
-- primeira mensagem feita por um FLUXO do chatbot, sem IA.
--
-- Mesma tabela e mesma função do lead do site (20260915000000), no modo
-- 'flow' de 20260926180000: a função grava o contato com a etiqueta, confere
-- repetido e consentimento, e o fluxo de gatilho "campanha" manda a mensagem.
-- O webhook `/api/webhooks/meta-leads` chama a função com o token gerado aqui.
--
-- Antes de rodar:
--   1. Migration 20260926180000 aplicada.
--   2. Trocar o nome da ORGANIZAÇÃO e o da CAMPANHA nas linhas marcadas <<<.
--      A campanha é criada aqui se não existir (status "active", com o
--      assistente de clientes da organização só porque a tabela exige um; no
--      modo fluxo ele não é chamado).
--
-- Depois de rodar:
--   * O resultado tem `token_para_o_servidor`. Ele entra em META_LEADS_INTAKES
--     no servidor do Núcleo (Hostinger), como {"<id da página do Facebook>":
--     "<token>"}. O token NÃO aparece de novo: o banco guarda só o sha256.
--     Rodar outra vez gera um token novo e invalida o anterior.
--   * No portal da organização, Chatbots: criar o fluxo com gatilho
--     "Lead da campanha" = esta campanha. O primeiro bloco é a mensagem
--     ("Oi, {nome}! ..."); `{nome}` vira o primeiro nome do lead. O texto sai
--     no WhatsApp do cliente e em nome dele: precisa da aprovação dele.
--     Sem fluxo ativo, o lead entra no CRM com a etiqueta e ninguém chama.
--
-- O contato criado fica com origem "Site · <nome da campanha>", porque a
-- função é a do site. Por isso o nome da campanha diz que é o formulário do Meta.

with organizacao as (
  select org.id
  from public.organizations org
  where org.name = 'Adriani Ademicon'                 -- <<< ORGANIZAÇÃO
), unica_org as (
  select organizacao.id from organizacao where (select count(*) from organizacao) = 1
), dono as (
  select member.user_id
  from public.organization_members member
  join unica_org on unica_org.id = member.organization_id
  where member.status = 'active' and member.role = 'owner'
  order by member.joined_at, member.user_id
  limit 1
), assistente as (
  select profile.id
  from public.assistant_profiles profile
  join unica_org on unica_org.id = profile.organization_id
  where profile.audience = 'customer' and profile.active
  order by profile.created_at
  limit 1
), existente as (
  select campaign.id, campaign.organization_id, campaign.created_by
  from public.organization_campaigns campaign
  join unica_org on unica_org.id = campaign.organization_id
  where campaign.name = 'Formulário Meta · Adriani'   -- <<< CAMPANHA
), criada as (
  insert into public.organization_campaigns (
    organization_id, assistant_profile_id, name, status, objective, created_by, updated_by
  )
  select unica_org.id, assistente.id, 'Formulário Meta · Adriani',   -- <<< CAMPANHA
         'active', 'Chamar no WhatsApp quem preenche o formulário do anúncio.',
         dono.user_id, dono.user_id
  from unica_org, assistente, dono
  where not exists (select 1 from existente)
  returning id, organization_id, created_by
), campanha as (
  select * from existente
  union all
  select * from criada
), unica as (
  select campanha.* from campanha where (select count(*) from campanha) = 1
), token as (
  select encode(extensions.gen_random_bytes(32), 'hex') as valor
), gravado as (
  insert into public.campaign_site_intakes (
    campaign_id, organization_id, token_hash, welcome_template, tag_name,
    hourly_limit, enabled_by, first_message
  )
  select
    unica.id,
    unica.organization_id,
    encode(extensions.digest(token.valor, 'sha256'), 'hex'),
    -- Não é usado no modo fluxo (quem escreve é o fluxo), mas a coluna exige
    -- texto. Fica o motivo, para quem abrir a tabela.
    'Modo fluxo: a primeira mensagem é o primeiro bloco do fluxo de gatilho campanha.',
    'Lead Meta',
    -- Formulário de anúncio chega aos poucos. Dez por hora já é muito para a
    -- verba de hoje e protege o número de um pico que pareça disparo em massa.
    10,
    unica.created_by,
    'flow'
  from unica, token
  on conflict (campaign_id) do update
    set token_hash = excluded.token_hash,
        welcome_template = excluded.welcome_template,
        tag_name = excluded.tag_name,
        hourly_limit = excluded.hourly_limit,
        first_message = excluded.first_message,
        enabled = true,
        updated_at = now()
  returning campaign_id
)
select
  case when (select count(*) from gravado) = 1
    then (select token.valor from token)
    else 'ERRO: organização não achada (ou mais de uma), sem dono ou assistente, ou campanha repetida'
  end as token_para_o_servidor,
  (select gravado.campaign_id from gravado) as campanha;

-- Desligar a entrada de leads sem apagar nada (o webhook passa a receber
-- recusa e o Meta não reenvia):
--
-- update public.campaign_site_intakes intake
-- set enabled = false, updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id
--   and campaign.name = 'Formulário Meta · Adriani';   -- <<< CAMPANHA
