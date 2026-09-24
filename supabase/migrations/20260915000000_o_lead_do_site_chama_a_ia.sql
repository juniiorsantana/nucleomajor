-- O lead que preenche o formulário do site passa a ser chamado pela IA.
--
-- Pedido do dono em 14/09/2026: o diagnóstico gratuito do site da Major
-- (`majorhub`, Next.js na Vercel) coleta nome, WhatsApp e e-mail, e até hoje o
-- lead parava no log da Vercel. Agora ele entra no CRM, recebe a primeira
-- mensagem da campanha no WhatsApp, a IA continua a conversa dentro da campanha
-- e o resumo do diagnóstico chega ao WhatsApp da equipe.
--
--
-- 1. QUEM CHAMA ESTA FUNÇÃO, e por que ela aceita `anon`
--
-- O servidor do site, e só ele. `/api/lead` na Vercel faz o POST para
-- `/rest/v1/rpc/nucleo_site_lead_receive` com a chave publicável e um TOKEN da
-- campanha que vive numa variável de ambiente do servidor — nunca no navegador.
--
-- A chave publicável sozinha não faz nada aqui: sem o token não há campanha,
-- organização nem mensagem. O token é guardado como sha256, e é gerado pelo SQL
-- de ligação (`scripts/sql/ligar-campanha-do-site.sql`), que o mostra UMA vez.
--
--
-- 2. O QUE ESTA FUNÇÃO NÃO DEIXA ACONTECER
--
--  * disparo em massa: teto de leads novos por hora POR CAMPANHA
--    (`hourly_limit`, 30 por padrão). Acima dele, recusa;
--  * mensagem repetida: o mesmo telefone na mesma campanha é um lead só, com as
--    duas formas do celular (com e sem o nono dígito) valendo como uma. Quem
--    refaz o diagnóstico não recebe a mensagem de novo; a equipe fica sabendo,
--    no máximo uma vez a cada 12 horas;
--  * mensagem sem consentimento: sem a caixa marcada o lead entra no CRM e a
--    equipe é avisada, mas ninguém chama pelo WhatsApp;
--  * destinatário escolhido pela carga: o comando leva o telefone DO LEAD e
--    nada mais. Quem recebe o aviso da equipe é configuração da VPS
--    (`EMYLEADS_HANDOFF_NOTIFY_PHONES`, senão o dono).
--
--
-- 3. POR QUE A PRIMEIRA MENSAGEM NÃO USA `conversation_send`
--
-- Porque o runtime trata todo `conversation_send` como "a equipe respondeu
-- pelo portal" (`runtime_commands._conversa_enviar` → `assumir_pela_equipe`), e
-- a IA sairia da conversa exatamente com o lead que ela deveria atender. O
-- comando novo, `site_lead_welcome`, envia pela mesma rota manual do Bridge,
-- anota a mensagem como `bot` e deixa a conversa com a IA. Precisa do runtime
-- da branch `feat/leads-do-site` do whatsapp-mcp-hardened (a partir de
-- `483356d`); runtime antigo recusa o comando como `unsupported_command`, o
-- lead fica gravado e nada sai — por isso o runtime vai ANTES da ligação.
--
--
-- 4. COMO A CONVERSA JÁ NASCE DENTRO DA CAMPANHA
--
-- O lead vai responder "sim" ou "pode", e nenhuma palavra-chave casa com isso.
-- Em vez de ensinar `private.intelligence_payload` (o Router da FASE 13) a
-- procurar lead por telefone, esta função cria ANTES o contexto de inteligência
-- da conversa, já com o agente e a campanha. Quando a resposta chega, o Router
-- entra pelo ramo de AFINIDADE — que existe e está provado — e carrega a
-- campanha e as skills dela. `private.intelligence_payload` não é tocada.
--
-- A chave do contexto é `sha256(telefone)`, a mesma que o runtime calcula a
-- partir do remetente (`worker._resolve_intelligence_context`). Como a conta
-- do lead pode estar registrada com ou sem o nono dígito, são criados os dois
-- contextos; o que a conversa real não usar nunca é lido.
--
-- Contexto que já existe não é sobrescrito: conversa que já pertence a outro
-- agente continua dele, e conversa transferida para gente (`handed_off`)
-- continua com gente — criar um contexto ativo ao lado dela furaria a recusa
-- por atendimento humano, que o Router confere antes de tudo.
--
--
-- O que esta migration NÃO faz:
--
--  * não toca `private.intelligence_payload`, os resolvedores, `conversation_send`
--    nem `nucleo_conversation_start`;
--  * não cria linha em `whatsapp_conversations`: a sincronia cria a conversa
--    real quando a mensagem sai, com o telefone que o WhatsApp informar;
--  * não cria tela. A campanha é criada na tela Campanhas que já existe; a
--    ligação com o site é o SQL de `scripts/sql/ligar-campanha-do-site.sql`;
--  * não usa tabela temporária — o SQL Editor não é `psql -f`.

begin;

-- Aborta cedo se a lista de comandos não for a que este arquivo reescreve.
-- Reescrever o check por cima de um tipo novo que outra migration tenha criado
-- apagaria aquele tipo sem aviso.
do $$
declare
  definicao text;
begin
  select pg_get_constraintdef(constraint_row.oid) into definicao
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.connection_runtime_commands'::regclass
    and constraint_row.conname = 'connection_runtime_commands_command_type_check';
  if definicao is null then
    raise exception 'abortado: o check de command_type da fila de comandos nao existe';
  end if;
  if (length(definicao) - length(replace(definicao, '::text', ''))) / length('::text')
       not in (8, 9)
     or definicao not like '%connection_pair_qr%' then
    raise exception 'abortado: a lista de comandos mudou desde 20260910010000; conferir antes de reescrever: %', definicao;
  end if;
end $$;

-- ---------------------------------------------------------------- 1. tabelas

-- A ligação de UMA campanha com o formulário do site.
--
-- Separada de `organization_campaigns.configuration` de propósito: aquela coluna
-- vai inteira para o prompt do agente (`'configuracao'` no payload do Router), e
-- nem o hash do token nem o texto da mensagem inicial são assunto do modelo.
create table if not exists public.campaign_site_intakes (
  campaign_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  welcome_template text not null
    check (length(trim(welcome_template)) between 1 and 1000),
  tag_name text not null default 'Lead Diagnóstico'
    check (length(trim(tag_name)) between 1 and 80),
  hourly_limit integer not null default 30 check (hourly_limit between 1 and 200),
  enabled boolean not null default true,
  -- Quem assina os comandos da fila, que exigem um perfil. É quem criou a
  -- campanha: o lead chega sem sessão nenhuma, e a fila precisa de um dono.
  enabled_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id)
    references public.organization_campaigns(id, organization_id) on delete cascade
);

comment on table public.campaign_site_intakes is
  'Liga uma campanha ao formulario do site. token_hash e o sha256 do token que o servidor do site envia; o token em si so aparece uma vez, no SQL de ligacao. Fora de organization_campaigns.configuration porque aquela coluna vai para o prompt do agente.';

-- Um lead por telefone por campanha.
create table if not exists public.campaign_site_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  contact_id uuid references public.contacts(id) on delete set null,
  phone text not null check (phone ~ '^[0-9]{12,13}$'),
  name text not null check (length(name) between 1 and 120),
  email text check (email is null or length(email) <= 160),
  site text not null default '' check (length(site) <= 200),
  consent boolean not null default false,
  diagnosis jsonb not null default '{}'::jsonb
    check (jsonb_typeof(diagnosis) = 'object' and octet_length(diagnosis::text) <= 8192),
  submissions integer not null default 1 check (submissions >= 1),
  welcome_requested boolean not null default false,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  last_notified_at timestamptz,
  last_command_id uuid,
  unique (campaign_id, phone),
  foreign key (campaign_id, organization_id)
    references public.organization_campaigns(id, organization_id) on delete cascade
);

create index if not exists campaign_site_leads_recentes_idx
  on public.campaign_site_leads (campaign_id, first_received_at desc);

comment on table public.campaign_site_leads is
  'Leads que chegaram pelo formulario do site, um por telefone por campanha. welcome_requested diz se a primeira mensagem foi PEDIDA a fila; o desfecho do envio esta em connection_runtime_commands.public_result do last_command_id.';
comment on column public.campaign_site_leads.welcome_requested is
  'A primeira mensagem foi enfileirada para este lead. Nao garante entrega: o desfecho (sent, not_on_whatsapp, human_attending...) fica no public_result do comando.';

alter table public.campaign_site_intakes enable row level security;
alter table public.campaign_site_leads enable row level security;
-- O Supabase concede tudo em tabela nova do schema public a anon e
-- authenticated. Aqui ninguém escreve direto: só a função abaixo.
revoke all on public.campaign_site_intakes from anon, authenticated;
revoke all on public.campaign_site_leads from anon, authenticated;
grant select on public.campaign_site_leads to authenticated;

drop policy if exists campaign_site_leads_select on public.campaign_site_leads;
create policy campaign_site_leads_select on public.campaign_site_leads
  for select to authenticated
  using (private.is_org_member(organization_id));

-- ------------------------------------------------------------------ 2. a fila
--
-- O check reescrito por inteiro, com a lista toda, pela mesma disciplina de
-- 20260902200000: a lista mora num lugar só.
alter table public.connection_runtime_commands
  drop constraint if exists connection_runtime_commands_command_type_check;
alter table public.connection_runtime_commands
  add constraint connection_runtime_commands_command_type_check
  check (command_type in (
    'operator_verification_send', 'handoff_return_to_ai', 'handoff_close',
    'conversation_send', 'conversation_owner', 'conversation_check',
    'connection_pair_start', 'connection_pair_qr',
    'site_lead_welcome'
  ));

-- ------------------------------------------------- 3. receber o lead do site

create or replace function public.nucleo_site_lead_receive(
  intake_token text,
  lead jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_limpo text := lower(trim(coalesce(intake_token, '')));
  config public.campaign_site_intakes%rowtype;
  campanha public.organization_campaigns%rowtype;
  registro public.campaign_site_leads%rowtype;
  telefone_bruto text;
  telefone text;
  variantes text[];
  nome_do_lead text;
  email_do_lead text;
  site_do_lead text;
  consentiu boolean;
  diagnostico_bruto jsonb;
  diagnostico jsonb;
  repetido boolean := false;
  ja_chamado boolean := false;
  avisar boolean := true;
  enviar boolean := false;
  motivo text := '';
  texto text := '';
  primeiro_nome text;
  conexao uuid;
  contato uuid;
  etiqueta uuid;
  comando uuid;
  variante text;
begin
  if jsonb_typeof(lead) is distinct from 'object'
     or pg_catalog.octet_length(lead::text) > 16384 then
    raise exception 'lead payload is invalid';
  end if;
  if token_limpo !~ '^[0-9a-f]{64}$' then
    raise exception 'intake token is invalid';
  end if;

  select intake.* into config
  from public.campaign_site_intakes intake
  where intake.token_hash = encode(extensions.digest(token_limpo, 'sha256'), 'hex')
    and intake.enabled;
  if not found then
    raise exception 'intake token is invalid';
  end if;

  select campaign.* into campanha
  from public.organization_campaigns campaign
  where campaign.id = config.campaign_id
    and campaign.organization_id = config.organization_id;

  -- ---------------------------------------------------------- o que chegou
  --
  -- Tudo o que vem do formulário é texto não confiável: corte de tamanho,
  -- espaço colapsado, e nada disto vira SQL dinâmico nem destinatário.

  -- Só número brasileiro, com a mesma régua do formulário do site
  -- (`isValidWhatsapp` em `LeadForm.tsx`): DDD de 11 a 99, e celular de onze
  -- dígitos começando com 9. Sem ela, um número americano de onze dígitos
  -- ganharia um 55 na frente e viraria um destinatário que não existe.
  telefone_bruto := pg_catalog.regexp_replace(coalesce(lead ->> 'telefone', ''), '[^0-9]', '', 'g');
  if length(telefone_bruto) in (12, 13) and telefone_bruto like '55%' then
    telefone_bruto := substr(telefone_bruto, 3);
  end if;
  if length(telefone_bruto) not in (10, 11)
     -- Comparação de TEXTO de dois dígitos, e não cast: o Postgres não promete
     -- a ordem do `or`, e um cast de vazio derrubaria com outra mensagem.
     or substr(telefone_bruto, 1, 2) < '11'
     or (length(telefone_bruto) = 11 and substr(telefone_bruto, 3, 1) <> '9') then
    raise exception 'phone number is invalid';
  end if;
  telefone := '55' || telefone_bruto;

  -- O mesmo celular com e sem o nono dígito. Mesma regra de
  -- `lead_do_site.variantes_do_telefone` no runtime e de
  -- `private.customer_phone_matches`: as três pontas precisam concordar.
  variantes := case
    when length(telefone) = 13 and substr(telefone, 5, 1) = '9'
      then array[telefone, substr(telefone, 1, 4) || substr(telefone, 6)]
    when length(telefone) = 12 and substr(telefone, 5, 1) in ('6', '7', '8', '9')
      then array[telefone, substr(telefone, 1, 4) || '9' || substr(telefone, 5)]
    else array[telefone]
  end;

  nome_do_lead := left(pg_catalog.regexp_replace(trim(coalesce(lead ->> 'nome', '')), '\s+', ' ', 'g'), 120);
  if nome_do_lead = '' then
    raise exception 'lead name is required';
  end if;
  email_do_lead := nullif(left(trim(coalesce(lead ->> 'email', '')), 160), '');
  if email_do_lead is not null and email_do_lead !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    email_do_lead := null;
  end if;
  -- Só caracteres de domínio. O site entra no texto que sai pelo WhatsApp da
  -- empresa, e sem este filtro o campo viraria um lugar para escrever qualquer
  -- frase — ou um link — numa mensagem assinada pela Major.
  site_do_lead := left(pg_catalog.regexp_replace(lower(trim(coalesce(lead ->> 'site', ''))), '[^a-z0-9.-]', '', 'g'), 200);
  if site_do_lead !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    site_do_lead := '';
  end if;
  -- Só `true` de verdade é consentimento. Chave ausente, texto "sim" ou nulo
  -- são "não" — um nulo aqui passaria pelo `elsif not consentiu` abaixo.
  consentiu := coalesce(lead -> 'consentimento' = 'true'::jsonb, false);

  -- O diagnóstico, só com o que o aviso usa. Número fora de 0..100 não é nota.
  -- Os `case` aninhados são de propósito: o Postgres não promete a ordem de um
  -- `and`, e um cast de texto inválido derrubaria o lead inteiro.
  diagnostico_bruto := case
    when jsonb_typeof(lead -> 'diagnostico') = 'object' then lead -> 'diagnostico'
    else '{}'::jsonb
  end;
  diagnostico := jsonb_strip_nulls(jsonb_build_object(
    'notaGeral', case
      when (diagnostico_bruto ->> 'notaGeral') ~ '^[0-9]{1,3}(\.[0-9]+)?$' then
        case when (diagnostico_bruto ->> 'notaGeral')::numeric <= 100
          then round((diagnostico_bruto ->> 'notaGeral')::numeric)::integer end
    end,
    'faixa', nullif(left(trim(coalesce(diagnostico_bruto ->> 'faixa', '')), 20), ''),
    'servico', nullif(left(trim(coalesce(diagnostico_bruto ->> 'servico', '')), 60), ''),
    'categorias', (
      select jsonb_agg(jsonb_build_object('nome', item.nome, 'nota', item.nota) order by item.ordem)
      from (
        select
          elemento.ordem,
          left(trim(coalesce(elemento.valor ->> 'nome', '')), 30) as nome,
          case when (elemento.valor ->> 'nota') ~ '^[0-9]{1,3}(\.[0-9]+)?$' then
            case when (elemento.valor ->> 'nota')::numeric <= 100
              then round((elemento.valor ->> 'nota')::numeric)::integer end
          end as nota
        from jsonb_array_elements(
          case when jsonb_typeof(diagnostico_bruto -> 'categorias') = 'array'
            then diagnostico_bruto -> 'categorias' else '[]'::jsonb end
        ) with ordinality as elemento(valor, ordem)
        where jsonb_typeof(elemento.valor) = 'object'
      ) item
      where item.ordem <= 6 and item.nome <> '' and item.nota is not null
    ),
    'falhas', (
      select jsonb_agg(left(trim(elemento.valor), 90) order by elemento.ordem)
      from jsonb_array_elements_text(
        case when jsonb_typeof(diagnostico_bruto -> 'falhas') = 'array'
          then diagnostico_bruto -> 'falhas' else '[]'::jsonb end
      ) with ordinality as elemento(valor, ordem)
      where elemento.ordem <= 5 and trim(elemento.valor) <> ''
    )
  ));

  -- A conexão antes de qualquer escrita: sem ela nada sai, e é melhor o site
  -- registrar a recusa no log dele do que gravar um lead que ninguém avisa.
  conexao := private.conexao_da_organizacao(config.organization_id);

  -- --------------------------------------------------- um lead por telefone

  select site_lead.* into registro
  from public.campaign_site_leads site_lead
  where site_lead.campaign_id = campanha.id
    and site_lead.phone = any(variantes)
  order by (site_lead.phone = telefone) desc
  limit 1
  for update;

  if found then
    repetido := true;
    ja_chamado := registro.welcome_requested;
    avisar := registro.last_notified_at is null
      or registro.last_notified_at < now() - interval '12 hours';
    update public.campaign_site_leads site_lead
    set submissions = site_lead.submissions + 1,
        last_received_at = now(),
        email = coalesce(site_lead.email, email_do_lead),
        site = case when site_do_lead <> '' then site_do_lead else site_lead.site end,
        consent = site_lead.consent or consentiu,
        diagnosis = case when diagnostico <> '{}'::jsonb then diagnostico else site_lead.diagnosis end,
        last_notified_at = case when avisar then now() else site_lead.last_notified_at end
    where site_lead.id = registro.id
    returning site_lead.* into registro;
  else
    if (
      select count(*)
      from public.campaign_site_leads site_lead
      where site_lead.campaign_id = campanha.id
        and site_lead.first_received_at > now() - interval '1 hour'
    ) >= config.hourly_limit then
      raise exception 'too many leads in the last hour';
    end if;
    insert into public.campaign_site_leads (
      organization_id, campaign_id, phone, name, email, site, consent,
      diagnosis, last_notified_at
    ) values (
      config.organization_id, campanha.id, telefone, nome_do_lead, email_do_lead,
      site_do_lead, consentiu, diagnostico, now()
    )
    returning * into registro;
  end if;

  -- ------------------------------------------------------------- o CRM

  select contact.id into contato
  from public.contacts contact
  where contact.organization_id = config.organization_id
    and contact.deleted_at is null
    and contact.phone = any(variantes)
  order by (contact.phone = telefone) desc, contact.created_at
  limit 1;

  if contato is null then
    insert into public.contacts (organization_id, name, phone, email, source)
    values (
      config.organization_id, nome_do_lead, telefone, email_do_lead,
      left('Site · ' || campanha.name, 120)
    )
    returning id into contato;
  else
    -- Contato que já existe não perde nada: nome e e-mail só entram onde
    -- estavam vazios. Quem cadastrou o cliente sabe o nome dele melhor que um
    -- formulário.
    update public.contacts contact
    set name = case when trim(contact.name) = '' then nome_do_lead else contact.name end,
        email = coalesce(nullif(trim(contact.email), ''), email_do_lead)
    where contact.id = contato
      and (trim(contact.name) = '' or (nullif(trim(contact.email), '') is null and email_do_lead is not null));
  end if;

  select tag.id into etiqueta
  from public.tags tag
  where tag.organization_id = config.organization_id
    and tag.deleted_at is null
    and lower(trim(tag.name)) = lower(trim(config.tag_name))
  order by tag.created_at
  limit 1;
  if etiqueta is null then
    insert into public.tags (organization_id, name, color)
    values (config.organization_id, trim(config.tag_name), '#0099FF')
    returning id into etiqueta;
  end if;
  insert into public.contact_tags (organization_id, contact_id, tag_id)
  values (config.organization_id, contato, etiqueta)
  on conflict (contact_id, tag_id) do nothing;

  insert into public.contact_events (
    organization_id, contact_id, event_type, entity_type, entity_id, source, payload
  ) values (
    config.organization_id, contato, 'lead.site', 'campaign', campanha.id, 'site',
    jsonb_build_object(
      'campanha', campanha.name,
      'site', site_do_lead,
      'notaGeral', diagnostico -> 'notaGeral',
      'repetido', repetido,
      'consentimento', consentiu
    )
  );

  update public.campaign_site_leads site_lead
  set contact_id = contato
  where site_lead.id = registro.id;

  -- ------------------------------------------------- manda ou não manda

  -- Repetido só pesa para quem JÁ foi chamado. Quem mandou o formulário sem
  -- consentimento, ou com a campanha pausada, e volta agora com tudo certo,
  -- é chamado agora.
  if ja_chamado then
    motivo := 'repeated';
  elsif not consentiu then
    motivo := 'no_consent';
  elsif campanha.status not in ('test', 'active')
     or (campanha.starts_at is not null and campanha.starts_at > now())
     or (campanha.ends_at is not null and campanha.ends_at <= now()) then
    motivo := 'campaign_paused';
  elsif not exists (
    select 1
    from public.assistant_profiles profile
    where profile.id = campanha.assistant_profile_id
      and profile.organization_id = config.organization_id
      and profile.audience = 'customer'
      and profile.active
  ) then
    -- O Router recusaria a conversa com `assistant profile is inactive`. Mandar
    -- a mensagem seria chamar o lead para uma conversa que ninguém atende.
    motivo := 'agent_inactive';
  else
    enviar := true;
  end if;

  if enviar then
    -- A conversa nasce dentro da campanha. Ver o tópico 4 do cabeçalho.
    foreach variante in array variantes loop
      if not exists (
        select 1
        from public.conversation_intelligence_contexts context
        where context.organization_id = config.organization_id
          and context.channel = 'whatsapp'
          and context.conversation_key_hash = encode(extensions.digest(variante, 'sha256'), 'hex')
          and context.state in ('active', 'handed_off')
      ) then
        insert into public.conversation_intelligence_contexts (
          organization_id, connection_id, contact_id, assistant_profile_id,
          campaign_id, audience, channel, conversation_key_hash, source_context
        ) values (
          config.organization_id, conexao, contato, campanha.assistant_profile_id,
          campanha.id, 'customer', 'whatsapp',
          encode(extensions.digest(variante, 'sha256'), 'hex'),
          jsonb_build_object('origem', 'site', 'leadId', registro.id)
        )
        on conflict do nothing;
      end if;
    end loop;

    -- `{nome}` é o primeiro nome com letras e nada mais. É o único trecho da
    -- mensagem que um visitante escreve, e a mensagem sai pelo WhatsApp da
    -- empresa para o telefone que ele informou: sem o filtro, "Oi, {nome}!"
    -- viraria "Oi, www.golpe.com!" assinado pela Major. Nome que não sobra
    -- nada vira "tudo bem".
    primeiro_nome := initcap(left(pg_catalog.regexp_replace(
      split_part(nome_do_lead, ' ', 1), '[^A-Za-zÀ-ÖØ-öø-ÿ''-]', '', 'g'
    ), 20));
    texto := left(trim(
      replace(
        replace(config.welcome_template, '{nome}', coalesce(nullif(primeiro_nome, ''), 'tudo bem')),
        '{site}', coalesce(nullif(site_do_lead, ''), 'da sua empresa')
      )
    ), 1000);
  end if;

  if enviar or avisar then
    insert into public.connection_runtime_commands (
      organization_id, connection_id, command_type, private_payload,
      created_by, idempotency_key, expires_at
    ) values (
      config.organization_id, conexao, 'site_lead_welcome',
      jsonb_build_object(
        'phone', telefone,
        'sendWelcome', enviar,
        'skipReason', motivo,
        'text', texto,
        'authorName', left(campanha.name, 120),
        'lead', jsonb_build_object(
          'campanha', campanha.name,
          'nome', nome_do_lead,
          'telefone', telefone,
          'email', email_do_lead,
          'site', site_do_lead
        ) || diagnostico
      ),
      config.enabled_by,
      encode(extensions.digest(
        concat_ws(':', 'site-lead', registro.id::text, registro.submissions::text), 'sha256'
      ), 'hex'),
      -- Doze horas. Um lead que chegou com a VPS fora do ar ainda merece a
      -- mensagem de manhã; um de ontem, não.
      now() + interval '12 hours'
    )
    on conflict (organization_id, idempotency_key) do nothing
    returning id into comando;

    update public.campaign_site_leads site_lead
    set last_command_id = coalesce(comando, site_lead.last_command_id),
        welcome_requested = site_lead.welcome_requested or enviar
    where site_lead.id = registro.id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'leadId', registro.id,
    'repeated', repetido,
    'welcome', enviar,
    'reason', nullif(motivo, ''),
    'teamNotified', enviar or avisar
  );
end;
$$;

revoke all on function public.nucleo_site_lead_receive(text, jsonb) from public;
revoke all on function public.nucleo_site_lead_receive(text, jsonb) from authenticated;
grant execute on function public.nucleo_site_lead_receive(text, jsonb) to anon;

comment on function public.nucleo_site_lead_receive(text, jsonb) is
  'Recebe um lead do formulario do site, chamada pelo servidor do site com a chave publicavel e o token da campanha. Grava o lead e o contato, cria o contexto de inteligencia ja com a campanha e enfileira site_lead_welcome (primeira mensagem + aviso a equipe). Ver 20260915000000.';

-- ------------------------------------------------------ 4. conferência final

do $$
begin
  if not has_function_privilege('anon', 'public.nucleo_site_lead_receive(text, jsonb)', 'execute') then
    raise exception 'conferencia: anon precisa executar nucleo_site_lead_receive';
  end if;
  if has_table_privilege('anon', 'public.campaign_site_intakes', 'select')
     or has_table_privilege('authenticated', 'public.campaign_site_intakes', 'select')
     or has_table_privilege('anon', 'public.campaign_site_leads', 'select')
     or has_table_privilege('anon', 'public.campaign_site_leads', 'insert')
     or has_table_privilege('authenticated', 'public.campaign_site_leads', 'insert') then
    raise exception 'conferencia: as tabelas de lead do site nao podem ser lidas nem escritas de fora';
  end if;
  if not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.connection_runtime_commands'::regclass
      and constraint_row.conname = 'connection_runtime_commands_command_type_check'
      and pg_get_constraintdef(constraint_row.oid) like '%site_lead_welcome%'
      and pg_get_constraintdef(constraint_row.oid) like '%connection_pair_qr%'
  ) then
    raise exception 'conferencia: a fila nao aceita site_lead_welcome';
  end if;
end $$;

commit;
