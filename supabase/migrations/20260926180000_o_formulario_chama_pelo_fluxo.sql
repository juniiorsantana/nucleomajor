-- O formulário pode chamar o lead pelo fluxo do chatbot, sem IA.
--
-- Pedido do dono em 26/09/2026, para a Adriani (plano Base): o lead do
-- formulário do Meta recebe a primeira mensagem no WhatsApp dela, e quem segue
-- a conversa é um fluxo do construtor — não a IA.
--
-- Até aqui, `nucleo_site_lead_receive` (20260915000000) só chamava o lead com
-- um agente de IA ativo na campanha (senão `agent_inactive`), e a VPS passava a
-- conversa para a IA depois de mandar. O gatilho "campanha" dos fluxos
-- (20260926120000) já existia, mas disparava em todo lead que entrava —
-- inclusive sem consentimento e com a campanha pausada — e ao lado da
-- mensagem da IA, que então sairia em dobro.
--
--
-- 1. O QUE MUDA
--
--   * `campaign_site_intakes.first_message`: 'agent' (o de sempre, padrão) ou
--     'flow'. As ligações que já existem continuam 'agent' e não mudam em nada.
--   * Com 'flow', a função decide igual — repetido, sem consentimento,
--     campanha fora de Teste/Ativa — e, quando cabe chamar, só marca
--     `welcome_requested`. Nada de comando para a VPS, nada de contexto da IA,
--     nada de aviso à equipe (o aviso da VPS fala do diagnóstico do site). O
--     motivo devolvido é 'flow'.
--   * `private.flow_trigger_on_campaign_lead`: numa campanha em modo 'flow', o
--     fluxo dispara quando `welcome_requested` vira true, e só então. Assim a
--     decisão é uma só (a da função), quem voltou com consentimento é chamado,
--     e o repetido não recebe de novo. Campanha em modo 'agent' segue a regra
--     antiga, sem mudança.
--
-- O fluxo precisa existir: v3, ativo, gatilho "campanha" apontando para a
-- campanha. Sem ele o lead entra no CRM com a etiqueta e ninguém chama —
-- `flow_trigger_enqueue` devolve 0 e o lead não é perdido.
--
-- A VPS não muda: o `flow_trigger` já é atendido pela release `fluxos-aguardar`
-- (dono `bot`, envio pela rota manual, que alcança quem nunca escreveu).
--
-- As duas funções substituídas foram conferidas iguais ao repositório em
-- produção em 26/09/2026 (md5 do corpo sem CR): receive bbdae709…,
-- gatilho 9809894d…. O corpo de `nucleo_site_lead_receive` abaixo é o de
-- 20260915000000 com três trocas, marcadas por comentário.
--
-- Aplicar pelo SQL Editor, depois de 20260926170000.

begin;

do $$
begin
  if to_regprocedure('public.nucleo_site_lead_receive(text, jsonb)') is null then
    raise exception 'abortado: aplicar 20260915000000 antes';
  end if;
  if to_regprocedure('private.flow_trigger_enqueue(uuid, uuid, text, uuid, uuid, text)') is null then
    raise exception 'abortado: aplicar 20260926120000 antes';
  end if;
end;
$$;

-- ------------------------------------------------------- 1. quem chama o lead

alter table public.campaign_site_intakes
  add column if not exists first_message text not null default 'agent';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_site_intakes_first_message_check') then
    alter table public.campaign_site_intakes add constraint campaign_site_intakes_first_message_check
      check (first_message in ('agent', 'flow'));
  end if;
end;
$$;

comment on column public.campaign_site_intakes.first_message is
  'Quem chama o lead: agent (a VPS manda welcome_template e a IA da campanha segue) ou flow (o fluxo v3 de gatilho campanha manda tudo, sem IA). Ver 20260926180000.';

-- -------------------------------------------------- 2. receber o lead

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
  elsif config.first_message = 'flow' then
    -- Quem chama é o fluxo de gatilho "campanha" da organização. Nada de
    -- mensagem daqui nem de contexto da IA: a conversa fica com o fluxo.
    motivo := 'flow';
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

  -- No modo fluxo a VPS não recebe comando nenhum, nem o aviso à equipe (que
  -- fala do diagnóstico do site). A marca `welcome_requested` é o que dispara
  -- o fluxo: ver `private.flow_trigger_on_campaign_lead`, abaixo.
  if config.first_message = 'flow' then
    if motivo = 'flow' then
      update public.campaign_site_leads site_lead
      set welcome_requested = true
      where site_lead.id = registro.id
        and not site_lead.welcome_requested;
    end if;
  elsif enviar or avisar then
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
    'flow', motivo = 'flow',
    'reason', nullif(motivo, ''),
    'teamNotified', config.first_message <> 'flow' and (enviar or avisar)
  );
end;
$$;

revoke all on function public.nucleo_site_lead_receive(text, jsonb) from public;
revoke all on function public.nucleo_site_lead_receive(text, jsonb) from authenticated;
grant execute on function public.nucleo_site_lead_receive(text, jsonb) to anon;

comment on function public.nucleo_site_lead_receive(text, jsonb) is
  'Recebe um lead do formulario do site ou do Meta, chamada pelo servidor com a chave publicavel e o token da campanha. Grava o lead e o contato; no modo agent cria o contexto da IA e enfileira site_lead_welcome, no modo flow so marca welcome_requested e o fluxo de gatilho campanha chama. Ver 20260915000000 e 20260926180000.';

-- ------------------------------------------- 3. o fluxo dispara pela marca

create or replace function private.flow_trigger_on_campaign_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pelo_fluxo boolean;
begin
  select intake.first_message = 'flow' into pelo_fluxo
  from public.campaign_site_intakes intake
  where intake.campaign_id = new.campaign_id;

  if coalesce(pelo_fluxo, false) then
    -- A função do lead já decidiu (repetido, consentimento, campanha pausada)
    -- e marcou `welcome_requested`. Dispara na virada para true, uma vez.
    if new.contact_id is not null and new.welcome_requested
       and (tg_op = 'INSERT' or not old.welcome_requested) then
      begin
        perform private.flow_trigger_enqueue(new.organization_id, new.contact_id, 'campanha', new.campaign_id, null, 'campanha');
      exception when others then
        null;  -- disparar fluxo nunca impede o lead de entrar
      end;
    end if;
  elsif new.contact_id is not null and (tg_op = 'INSERT' or old.contact_id is distinct from new.contact_id) then
    begin
      perform private.flow_trigger_enqueue(new.organization_id, new.contact_id, 'campanha', new.campaign_id, null, 'campanha');
    exception when others then
      null;  -- disparar fluxo nunca impede o lead de entrar
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.flow_trigger_on_campaign_lead() from public, anon, authenticated;

drop trigger if exists chatbot_flow_trigger_on_campaign_lead on public.campaign_site_leads;
create trigger chatbot_flow_trigger_on_campaign_lead
after insert or update of contact_id, welcome_requested on public.campaign_site_leads
for each row execute function private.flow_trigger_on_campaign_lead();

-- ------------------------------------------------------ 4. conferência final

do $$
begin
  if exists (select 1 from public.campaign_site_intakes where first_message <> 'agent') then
    raise exception 'conferencia: nenhuma ligacao existente pode mudar de modo nesta migration';
  end if;
  if not has_function_privilege('anon', 'public.nucleo_site_lead_receive(text, jsonb)', 'execute') then
    raise exception 'conferencia: anon precisa executar nucleo_site_lead_receive';
  end if;
  if has_function_privilege('anon', 'private.flow_trigger_on_campaign_lead()', 'execute') then
    raise exception 'conferencia: o gatilho nao pode ser chamado de fora';
  end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.campaign_site_leads'::regclass
      and t.tgname = 'chatbot_flow_trigger_on_campaign_lead'
      and pg_get_triggerdef(t.oid) like '%welcome_requested%'
  ) then
    raise exception 'conferencia: o gatilho precisa olhar welcome_requested';
  end if;
end $$;

commit;
