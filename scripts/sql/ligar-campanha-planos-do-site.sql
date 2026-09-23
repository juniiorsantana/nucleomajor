-- Liga a campanha "Planos do Site" ao popup de planos da landing (nucleomajor.com).
--
-- Mesmo mecanismo da campanha "Diagnóstico do Site": a migration
-- 20260915000000_o_lead_do_site_chama_a_ia.sql (JÁ APLICADA em produção em
-- 14/09/2026; o arquivo mora na branch feat/leads-do-site) e o comando
-- `site_lead_welcome` do runtime (já na release ativa da VPS).
--
-- Ordem:
--   1. No portal, Inteligência → Campanhas: criar a campanha com o nome exato
--      "Planos do Site", no agente de clientes, com as habilidades
--      pre-qualificacao e solicitacao-agenda (as mesmas do Diagnóstico).
--   2. Rodar este arquivo INTEIRO no SQL Editor.
--   3. Copiar `token_para_a_hostinger` para a variável NUCLEO_LEAD_TOKEN do
--      Node na Hostinger e reimplantar (o servidor só lê variável na partida).
--
-- O token NÃO aparece de novo: o banco guarda só o sha256. Rodar este arquivo
-- outra vez gera um token novo e invalida o anterior.
--
-- `{nome}` vira o primeiro nome do lead. O plano escolhido não entra na
-- mensagem (a RPC só conhece `{nome}` e `{site}`); ele chega no aviso à equipe.
--
-- Esta campanha é SÓ a primeira mensagem: o atendimento depois dela é da
-- equipe. Por isso a etiqueta é "Não atender IA" (o portão
-- `nucleo_customer_assistant_access` recusa quem a carrega, desde a migration
-- 20260911150000) e não uma etiqueta própria. O lead continua identificável
-- pela origem do contato ("Site · Planos do Site") e pelo evento `lead.site`.

with campanha as (
  select campaign.id, campaign.organization_id, campaign.created_by
  from public.organization_campaigns campaign
  where campaign.name = 'Planos do Site'
), unica as (
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
    'Oi, {nome}! Aqui é da Major 👋 Recebemos o seu pedido pelos planos do Núcleo Major.

O Núcleo Major reúne clientes, funil de vendas, agenda, tarefas e equipe em um só lugar, com o EmyLeads atendendo no WhatsApp. Os planos são semestrais:
• Base: R$ 97/mês, sem IA
• Atendimento com IA: R$ 197/mês, com 1.000 créditos de IA por mês
• Completo: R$ 297/mês, com 2.000 créditos de IA e o assistente da equipe
• Empresarial: sob medida

A implantação é acompanhada pela nossa equipe em todos os planos.

Para indicarmos o plano certo, conta pra gente: qual é o seu segmento e quantas pessoas atendem no WhatsApp hoje? Alguém do nosso time continua com você por aqui.',
    -- A etiqueta é a "Não atender IA": a primeira mensagem sai (ela não passa
    -- pelo portão do agente), e quando o lead responder a IA ignora e a
    -- conversa fica com a equipe. Só esta campanha faz isso.
    'Não atender IA',
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
    else 'ERRO: nenhuma campanha "Planos do Site", ou mais de uma'
  end as token_para_a_hostinger,
  (select gravado.campaign_id from gravado) as campanha;

-- Trocar só a mensagem inicial, mantendo o token:
--
-- update public.campaign_site_intakes intake
-- set welcome_template = 'Oi, {nome}! ...', updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Planos do Site';
--
-- Desligar a entrada de leads sem apagar nada (o popup passa a mostrar erro):
--
-- update public.campaign_site_intakes intake
-- set enabled = false, updated_at = now()
-- from public.organization_campaigns campaign
-- where campaign.id = intake.campaign_id and campaign.name = 'Planos do Site';
