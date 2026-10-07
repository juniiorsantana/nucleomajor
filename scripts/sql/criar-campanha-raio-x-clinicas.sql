-- Cria a campanha "Raio-X Clínicas" e a liga ao quiz de /clinicas/raio-x/.
--
-- Um statement só, para o SQL Editor. Mesmo mecanismo da "Planos do Site"
-- (`ligar-campanha-planos-do-site.sql`), que já roda na página oficial:
-- migration 20260915000000 e comando `site_lead_welcome` da VPS, os dois já em
-- produção. Nada de banco nem de VPS muda.
--
-- O que acontece quando alguém termina o quiz:
--   1. o contato entra no CRM da Major, origem "Site · Raio-X Clínicas";
--   2. a mensagem abaixo sai pelo WhatsApp da Major;
--   3. a equipe recebe o aviso no WhatsApp (EMYLEADS_HANDOFF_NOTIFY_PHONES da
--      VPS, senão o dono) com a nota, as quatro áreas e o que ficou abaixo.
--
-- Como na "Planos do Site", a conversa depois da primeira mensagem é da
-- equipe: a etiqueta é "Não atender IA", e a IA ignora quando o lead responder.
-- O agente da campanha é o mesmo da "Planos do Site" (a RPC exige um agente
-- ativo para mandar a primeira mensagem, mesmo sem a IA atender depois).
--
-- Depois de rodar:
--   copiar `token_para_a_hostinger` para NUCLEO_CLINICAS_LEAD_TOKEN no Node da
--   Hostinger e reimplantar (o servidor só lê variável na partida). O token
--   NÃO aparece de novo: o banco guarda só o sha256. Rodar outra vez reaproveita
--   a campanha e gera um token novo (o anterior deixa de valer).
--
-- `{nome}` vira o primeiro nome do lead.

with base as (
  -- A campanha que já roda na landing oficial. Nome repetido não liga nada.
  select campaign.organization_id, campaign.assistant_profile_id, campaign.created_by
  from public.organization_campaigns campaign
  where campaign.name = 'Planos do Site'
), unica as (
  select base.* from base where (select count(*) from base) = 1
), ja_existe as (
  select campaign.id, campaign.organization_id
  from public.organization_campaigns campaign
  join unica on unica.organization_id = campaign.organization_id
  where campaign.name = 'Raio-X Clínicas'
), nova as (
  insert into public.organization_campaigns (
    organization_id, assistant_profile_id, name, status, objective, offer,
    audience_description, desired_outcome, is_default, created_by, updated_by
  )
  select
    unica.organization_id, unica.assistant_profile_id, 'Raio-X Clínicas', 'active',
    'Dono ou gestor de clínica que respondeu o Raio-X de Crescimento (anúncio no Meta), confirmou orçamento de ao menos R$ 1.500/mês para anúncios e deixou o WhatsApp. A conversa é conduzida pela equipe da Major.',
    'Conversa com a equipe da Major sobre as prioridades do diagnóstico: captação com Meta Ads na região da clínica e atendimento comercial até o agendamento.',
    'Clínicas (odontologia, estética, médicas e outras áreas da saúde) que já investem ou podem investir em anúncios.',
    'Reunião marcada com a equipe da Major.',
    false, unica.created_by, unica.created_by
  from unica
  where not exists (select 1 from ja_existe)
  returning id, organization_id
), campanha as (
  select nova.id, nova.organization_id from nova
  union all
  select ja_existe.id, ja_existe.organization_id from ja_existe
), token as (
  select encode(extensions.gen_random_bytes(32), 'hex') as valor
), gravado as (
  insert into public.campaign_site_intakes (
    campaign_id, organization_id, token_hash, welcome_template, tag_name, enabled_by
  )
  select
    campanha.id, campanha.organization_id,
    encode(extensions.digest(token.valor, 'sha256'), 'hex'),
    'Oi, {nome}! Aqui é da Major 👋 Recebemos o Raio-X da sua clínica, obrigado por responder.

Nossa equipe já está olhando as suas respostas e vai continuar com você por aqui para conversar sobre as prioridades que apareceram no diagnóstico.

Pra gente adiantar: qual é o melhor horário para conversarmos?',
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
    then (select token.valor from token)
    else 'ERRO: "Planos do Site" nao encontrada ou repetida'
  end as token_para_a_hostinger,
  (select count(*) from nova) = 1 as campanha_criada_agora,
  (select gravado.campaign_id from gravado) as campanha;

-- Trocar só a mensagem, mantendo o token:
--
-- update public.campaign_site_intakes intake
-- set welcome_template = 'Oi, {nome}! ...', updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Raio-X Clínicas';
--
-- Desligar a entrada sem apagar nada (o quiz passa a responder com erro):
--
-- update public.campaign_site_intakes intake
-- set enabled = false, updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Raio-X Clínicas';
