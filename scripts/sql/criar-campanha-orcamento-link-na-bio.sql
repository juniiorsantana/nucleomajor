-- Cria a campanha "Orçamento pelo link na bio" e a liga ao modal
-- "Solicitar orçamento" de /juniiorsantana7/ (POST /api/orcamento).
--
-- Um statement só, para o SQL Editor. Mesmo mecanismo da "Planos do Site" e do
-- "Raio-X Clínicas" (`criar-campanha-raio-x-clinicas.sql`), que já rodam em
-- produção: migration 20260915000000 e comando `site_lead_welcome` da VPS.
-- Nada de banco nem de VPS muda.
--
-- O que acontece quando alguém envia o pedido:
--   1. o contato entra no CRM da Major, origem "Site · Orçamento pelo link na bio";
--   2. a mensagem abaixo sai pelo WhatsApp da Major;
--   3. a equipe recebe o aviso no WhatsApp (EMYLEADS_HANDOFF_NOTIFY_PHONES da
--      VPS, senão o dono) com nome, telefone, e-mail e o assunto
--      "Orçamento · link na bio".
--
-- Como nas outras duas, a conversa depois da primeira mensagem é da equipe: a
-- etiqueta é "Não atender IA", e a IA ignora quando o lead responder. O agente
-- da campanha é o mesmo da "Planos do Site" (a RPC exige um agente ativo para
-- mandar a primeira mensagem, mesmo sem a IA atender depois).
--
-- Não há token novo para copiar. O servidor deriva o desta campanha do token
-- da "Planos do Site" (NUCLEO_LEAD_TOKEN, já na Hostinger):
--   token = sha256("orcamento-link-na-bio:" + sha256(NUCLEO_LEAD_TOKEN))
-- e o banco já guarda sha256(NUCLEO_LEAD_TOKEN) em `campaign_site_intakes`.
-- Aqui se grava sha256(token), calculado a partir desse hash. Ver
-- `tokenDoOrcamento` em src/orcamentoLead.mjs.
--
-- Se o token da "Planos do Site" for trocado (`ligar-campanha-planos-do-site.sql`),
-- rode este arquivo de novo, senão o modal passa a ser recusado. Rodar outra
-- vez não duplica a campanha.
--
-- `{nome}` vira o primeiro nome do lead.

with base as (
  -- A campanha que já roda na landing oficial. Nome repetido não liga nada.
  select campaign.organization_id, campaign.assistant_profile_id, campaign.created_by,
         intake.token_hash as hash_da_planos
  from public.organization_campaigns campaign
  join public.campaign_site_intakes intake on intake.campaign_id = campaign.id
  where campaign.name = 'Planos do Site' and intake.enabled
), unica as (
  select base.* from base where (select count(*) from base) = 1
), ja_existe as (
  select campaign.id, campaign.organization_id
  from public.organization_campaigns campaign
  join unica on unica.organization_id = campaign.organization_id
  where campaign.name = 'Orçamento pelo link na bio'
), nova as (
  insert into public.organization_campaigns (
    organization_id, assistant_profile_id, name, status, objective, offer,
    audience_description, desired_outcome, is_default, created_by, updated_by
  )
  select
    unica.organization_id, unica.assistant_profile_id, 'Orçamento pelo link na bio', 'active',
    'Pessoa que pediu orçamento pelo link na bio do Juniior (Instagram @juniiorsantana7) e deixou nome, e-mail e WhatsApp. A conversa é conduzida pela equipe da Major.',
    'Proposta da Major para estruturação comercial, site, identidade visual e outros projetos digitais.',
    'Empresários e profissionais que acompanham o Juniior no Instagram.',
    'Proposta enviada e reunião marcada com a equipe da Major.',
    false, unica.created_by, unica.created_by
  from unica
  where not exists (select 1 from ja_existe)
  returning id, organization_id
), campanha as (
  select nova.id, nova.organization_id from nova
  union all
  select ja_existe.id, ja_existe.organization_id from ja_existe
), token as (
  select encode(extensions.digest('orcamento-link-na-bio:' || unica.hash_da_planos, 'sha256'), 'hex') as valor
  from unica
), gravado as (
  insert into public.campaign_site_intakes (
    campaign_id, organization_id, token_hash, welcome_template, tag_name, enabled_by
  )
  select
    campanha.id, campanha.organization_id,
    encode(extensions.digest(token.valor, 'sha256'), 'hex'),
    'Oi, {nome}! Aqui é da Major 👋 Recebemos o seu pedido de orçamento pelo link na bio do Juniior.

Pra preparar uma proposta sob medida: o que você está buscando hoje? Site, identidade visual, estruturação comercial ou outro projeto?',
    'Não atender IA',
    unica.created_by
  from campanha, token, unica
  on conflict (campaign_id) do update
    set token_hash = excluded.token_hash,
        welcome_template = excluded.welcome_template,
        tag_name = excluded.tag_name,
        enabled = true,
        updated_at = now()
  returning campaign_id
)
select
  case when (select count(*) from gravado) = 1
    then 'ok: campanha ligada ao modal do orçamento'
    else 'ERRO: "Planos do Site" nao encontrada, repetida ou desligada'
  end as resultado,
  (select count(*) from nova) = 1 as campanha_criada_agora,
  (select gravado.campaign_id from gravado) as campanha;

-- Trocar só a mensagem, mantendo o token:
--
-- update public.campaign_site_intakes intake
-- set welcome_template = 'Oi, {nome}! ...', updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Orçamento pelo link na bio';
--
-- Desligar a entrada sem apagar nada (o modal passa a responder com erro):
--
-- update public.campaign_site_intakes intake
-- set enabled = false, updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Orçamento pelo link na bio';
