-- Liga a campanha "Diagnóstico do Site" ao formulário do site (majorhub).
--
-- Rodar no SQL Editor DEPOIS da migration 20260915000000 e DEPOIS de criar a
-- campanha na tela Inteligência → Campanhas.
--
-- O resultado tem uma coluna `token_para_a_vercel`. Copie o valor para a
-- variável NUCLEO_LEAD_TOKEN do projeto majorhub na Vercel. Ele NÃO aparece de
-- novo: o banco guarda só o sha256. Rodar este arquivo outra vez gera um token
-- novo e invalida o anterior — é assim que se troca um token vazado.
--
-- Para mudar só a mensagem, sem trocar o token, use o UPDATE comentado no fim.
--
-- `{nome}` vira o primeiro nome do lead; `{site}`, o domínio que ele analisou.

with campanha as (
  select campaign.id, campaign.organization_id, campaign.created_by
  from public.organization_campaigns campaign
  where campaign.name = 'Diagnóstico do Site'
), unica as (
  -- Nome repetido (em duas organizações, ou duas campanhas com o mesmo nome)
  -- não liga nada: escolher uma seria adivinhar.
  select campanha.* from campanha where (select count(*) from campanha) = 1
), token as (
  select encode(extensions.gen_random_bytes(32), 'hex') as valor
), gravado as (
  insert into public.campaign_site_intakes (
    campaign_id, organization_id, token_hash, welcome_template, tag_name, enabled_by
  )
  select
    unica.id,
    unica.organization_id,
    encode(extensions.digest(token.valor, 'sha256'), 'hex'),
    'Oi, {nome}! Aqui é da Major 👋 Vi que você fez o diagnóstico do site {site}. Posso te fazer duas perguntas rápidas pra gente marcar uma conversa com o nosso time e te mostrar o que dá pra melhorar?',
    'Lead Diagnóstico',
    unica.created_by
  from unica, token
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
    else 'ERRO: nenhuma campanha com esse nome, ou mais de uma'
  end as token_para_a_vercel,
  (select gravado.campaign_id from gravado) as campanha;

-- Trocar só a mensagem inicial, mantendo o token:
--
-- update public.campaign_site_intakes intake
-- set welcome_template = 'Oi, {nome}! ...', updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Diagnóstico do Site';
--
-- Desligar a entrada de leads sem apagar nada (o site passa a receber recusa):
--
-- update public.campaign_site_intakes intake
-- set enabled = false, updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Diagnóstico do Site';
