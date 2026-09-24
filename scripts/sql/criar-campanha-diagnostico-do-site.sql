-- Cria a campanha "Diagnóstico do Site" e já a liga ao formulário do site.
--
-- Um statement só, para o SQL Editor. Faz o mesmo que a tela Campanhas grava
-- (organization_campaigns + campaign_skills + campaign_knowledge_collections) e
-- em seguida o que `ligar-campanha-do-site.sql` faz (token da Vercel).
--
-- IDs lidos do banco em 14/09/2026: organização Núcleo Major, agente
-- "Assistente Major" (clientes, ativo, padrão) e a coleção externa
-- "Conhecimento para clientes".
--
-- A skill de agenda só é ligada se o resolvedor v3 aceitar as ferramentas
-- `calendar.request.*` (migration 20260904120000). Sem isso, um turno que
-- chegasse ao estágio de pedir o horário quebraria com "unsupported tool"; sem
-- a skill, a IA qualifica e transfere para a equipe marcar.
--
-- Rodar de novo não duplica a campanha: reaproveita a existente e só gera um
-- token novo (o anterior deixa de valer).

with org as (
  select organization.id, organization.created_by
  from public.organizations organization
  where organization.id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
), agente as (
  select profile.id
  from public.assistant_profiles profile
  join org on org.id = profile.organization_id
  where profile.id = 'de7c940c-e0f4-480e-be2b-5a249bcf3534'
    and profile.audience = 'customer'
    and profile.active
), agenda_ok as (
  select coalesce(bool_or(strpos(pg_get_functiondef(p.oid), 'calendar.request.prepare') > 0), false) as ok
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_intelligence_context_resolve_v3'
), ja_existe as (
  select campaign.id, campaign.organization_id
  from public.organization_campaigns campaign
  join org on org.id = campaign.organization_id
  where campaign.name = 'Diagnóstico do Site'
), nova as (
  insert into public.organization_campaigns (
    organization_id, assistant_profile_id, name, status, objective, offer,
    audience_description, desired_outcome, is_default, created_by, updated_by
  )
  select
    org.id, agente.id, 'Diagnóstico do Site', 'test',
    'O contato fez o Diagnóstico gratuito do site na página da Major e deixou o WhatsApp para receber as recomendações. Ele já recebeu uma primeira mensagem nossa perguntando se pode conversar.

Conduza assim:
1. Início: agradeça a resposta e confirme se ele é o responsável pela empresa e pelo site analisado.
2. Meio: faça no máximo 3 perguntas, uma por vez: qual é o negócio e a cidade; como os clientes chegam hoje (indicação, Google, Instagram, anúncios); o que mais incomoda hoje no site ou na presença digital.
3. Fim: convide para uma reunião online e gratuita com o time da Major para explicar o resultado do diagnóstico e o plano de correção, e use a agenda para marcar o horário.

Regras: você não tem acesso às notas do diagnóstico, então não invente números; se ele perguntar pelo resultado, diga que o time mostra item por item na reunião. Não passe preço nem prazo de projeto. Se ele disser que não tem interesse, agradeça e encerre sem insistir. Se pedir para falar com uma pessoa, transfira.',
    'Reunião online e gratuita, de cerca de 30 minutos, com o time da Major para: explicar o resultado do diagnóstico do site (desempenho, SEO, visibilidade para IA e presença digital); mostrar por que o Google e a IA podem estar recomendando o concorrente; e apresentar o plano de correção. Serviços que podem entrar no plano: Site Profissional, Identidade Visual e Estruturação Comercial.',
    'Donos e responsáveis por empresas que fizeram o diagnóstico gratuito do site e querem ser encontrados no Google e recomendados por IAs como ChatGPT e Gemini.',
    'Reunião agendada com o time da Major, com o nome da empresa, o site e o principal incômodo do lead registrados.',
    false, org.created_by, org.created_by
  from org, agente
  where not exists (select 1 from ja_existe)
  returning id, organization_id
), campanha as (
  select nova.id, nova.organization_id from nova
  union all
  select ja_existe.id, ja_existe.organization_id from ja_existe
), skills as (
  insert into public.campaign_skills (organization_id, campaign_id, skill_id, priority)
  select nova.organization_id, nova.id, skill.id,
         case skill.slug when 'pre-qualificacao' then 10 else 20 end
  from nova
  join public.skill_definitions skill
    on skill.owner_type = 'platform'
   and skill.status = 'published'
   and (skill.slug = 'pre-qualificacao'
        or (skill.slug = 'solicitacao-agenda' and (select agenda_ok.ok from agenda_ok)))
  returning skill_id
), colecao as (
  insert into public.campaign_knowledge_collections (organization_id, campaign_id, collection_id)
  select nova.organization_id, nova.id, collection.id
  from nova
  join public.knowledge_collections collection
    on collection.id = '2c3eff03-028b-4b42-b08a-62d4cca6a98c'
   and collection.organization_id = nova.organization_id
  returning collection_id
), token as (
  select encode(extensions.gen_random_bytes(32), 'hex') as valor
), gravado as (
  insert into public.campaign_site_intakes (
    campaign_id, organization_id, token_hash, welcome_template, tag_name, enabled_by
  )
  select
    campanha.id, campanha.organization_id,
    encode(extensions.digest(token.valor, 'sha256'), 'hex'),
    'Oi, {nome}! Aqui é da Major 👋 Vi que você fez o diagnóstico do site {site}. Posso te fazer duas perguntas rápidas pra gente marcar uma conversa com o nosso time e te mostrar o que dá pra melhorar?',
    'Lead Diagnóstico',
    org.created_by
  from campanha, token, org
  on conflict (campaign_id) do update
    set token_hash = excluded.token_hash,
        enabled = true,
        updated_at = now()
  returning campaign_id
)
select
  case when (select count(*) from gravado) = 1
    then (select token.valor from token)
    else 'ERRO: agente inativo, organizacao nao encontrada ou campanha repetida'
  end as token_para_a_vercel,
  (select count(*) from nova) = 1 as campanha_criada_agora,
  (select count(*) from skills) as skills_ligadas,
  (select agenda_ok.ok from agenda_ok) as agenda_ligada,
  (select count(*) from colecao) as colecao_ligada;
