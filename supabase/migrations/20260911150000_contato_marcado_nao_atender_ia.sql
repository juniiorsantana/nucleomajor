-- Quem a IA atende passa a ter uma exceção marcável no CRM.
--
-- O número da empresa também é pessoal. Com o rollout do agente de clientes em
-- `active`, todo DM que não é de operador vira atendimento: em 11/09/2026 um
-- amigo do dono recebeu três cumprimentos e uma transferência falsa, e outro
-- ganhou seis balões antes de "acho que você se enganou de conversa". Mudar o
-- rollout para `pilot` resolveria isso bloqueando os leads de verdade — que é
-- o contrário do que se quer.
--
-- A exceção é uma etiqueta do CRM, `nao-atender-ia` (nome "Não atender IA"),
-- que a Ficha do contato já sabe aplicar. Escolha deliberada, e não uma coluna
-- nova: a etiqueta existe, aparece no CRM como qualquer outra, e a tela de
-- Conversas já a edita — nenhuma tabela, nenhuma policy, nenhum comando novo
-- para o runtime. A decisão continua onde sempre esteve: em
-- `nucleo_customer_assistant_access`, a RPC que o gateway da VPS consulta ANTES
-- de enfileirar qualquer mensagem de não operador. Negada, a mensagem é
-- ignorada (`customer_rollout_denied`) e nada é enviado — o mesmo caminho que
-- `pilot` já usa para quem não está na lista.
--
-- A verificação vem depois do perfil e do `off`, e ANTES de `active`/`pilot`:
-- vale nos dois modos, e vale mesmo que o contato também esteja na lista do
-- piloto (a exceção explícita vence a inclusão).
--
-- Casamento por `legacy_id = 'nao-atender-ia'` OU pelo nome normalizado, porque
-- a etiqueta pode ter nascido pela tela (que gera o slug a partir do nome) ou
-- pelo seed de 11/09 (legacy_id explícito). Contato apagado não conta.
--
-- Fora daqui: o runtime não muda; o portal ganha só um atalho na Ficha para
-- ligar/desligar esta etiqueta com um clique.

begin;

-- ---------------------------------------------------------------------------
-- 1/3. Guardas. A função viva precisa ser a que este arquivo espera.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access';
  if corpo is null then
    raise exception 'abortado: nucleo_customer_assistant_access nao existe';
  end if;
  if corpo like '%contact_opted_out%' then
    raise exception 'abortado: nucleo_customer_assistant_access ja trata contato marcado; conferir o que esta vivo antes de reescrever';
  end if;
  if corpo not like '%''reason'', ''active''%' or corpo not like '%customer_assistant_pilot_contacts%' then
    raise exception 'abortado: o corpo vivo nao e o da FASE H (piloto) que este arquivo reescreve';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tags' and column_name = 'legacy_id'
  ) then
    raise exception 'abortado: tags.legacy_id nao existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contact_tags' and column_name = 'tag_id'
  ) then
    raise exception 'abortado: contact_tags nao existe';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'customer_phone_matches'
  ) then
    raise exception 'abortado: private.customer_phone_matches nao existe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/3. A função: o corpo vivo de 11/09/2026, mais o bloco da etiqueta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nucleo_customer_assistant_access(requester_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid := private.robot_connection();
  profile_row public.assistant_profiles%rowtype;
  safe_mode text;
  matched_contacts uuid[];
  pilot_campaign uuid;
  opted_out boolean := false;
begin
  if robot_org is null or robot_connection is null then
    raise exception 'active robot credential required';
  end if;

  select profile.* into profile_row
  from public.assistant_profiles profile
  where profile.organization_id = robot_org and profile.audience = 'customer'
    and profile.is_default;
  if not found or not profile_row.active then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', 'off', 'reason', 'profile_inactive'
    );
  end if;

  safe_mode := coalesce(profile_row.process_config #>> '{rollout,mode}', 'off');
  if safe_mode not in ('off', 'pilot', 'active') then safe_mode := 'off'; end if;
  if safe_mode = 'off' then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode, 'reason', 'rollout_off'
    );
  end if;

  -- Contato marcado "Não atender IA" no CRM: a IA não fala com ele em modo
  -- nenhum. A etiqueta é a decisão de uma pessoa da equipe; vence inclusive a
  -- lista do piloto. Casa por legacy_id ou por nome normalizado, porque a
  -- etiqueta pode ter nascido pela tela ou pelo seed.
  select exists (
    select 1
    from public.contacts contact
    join public.contact_tags marcacao
      on marcacao.contact_id = contact.id
     and marcacao.organization_id = contact.organization_id
    join public.tags tag
      on tag.id = marcacao.tag_id
     and tag.organization_id = marcacao.organization_id
    where contact.organization_id = robot_org
      and contact.deleted_at is null
      and tag.deleted_at is null
      and (
        lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'
        or lower(regexp_replace(tag.name, '[^A-Za-z]', '', 'g')) in ('noatenderia', 'naoatenderia')
      )
      and (
        private.customer_phone_matches(requester_phone, contact.phone)
        or private.customer_phone_matches(requester_phone, contact.whatsapp_id)
      )
  ) into opted_out;
  if opted_out then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode, 'reason', 'contact_opted_out'
    );
  end if;

  if safe_mode = 'active' then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', true,
      'mode', safe_mode, 'reason', 'active'
    );
  end if;

  select coalesce(array_agg(distinct contact.id), '{}'::uuid[])
  into matched_contacts
  from public.customer_assistant_pilot_contacts pilot
  join public.contacts contact
    on contact.id = pilot.contact_id
   and contact.organization_id = pilot.organization_id
  where pilot.organization_id = robot_org
    and pilot.profile_id = profile_row.id
    and pilot.active
    and contact.deleted_at is null
    and (
      private.customer_phone_matches(requester_phone, contact.phone)
      or private.customer_phone_matches(requester_phone, contact.whatsapp_id)
    );

  if cardinality(matched_contacts) <> 1 then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode,
      'reason', case when cardinality(matched_contacts) = 0
        then 'contact_not_selected' else 'contact_ambiguous' end
    );
  end if;

  select campaign.id into pilot_campaign
  from public.organization_campaigns campaign
  where campaign.organization_id = robot_org
    and campaign.assistant_profile_id = profile_row.id
    and campaign.name = 'Piloto Atendimento Major'
    and campaign.status = 'test'
  order by campaign.created_at
  limit 1;
  if pilot_campaign is null then
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', safe_mode, 'reason', 'pilot_campaign_unavailable'
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', 'customer-rollout-1', 'allowed', true,
    'mode', safe_mode, 'reason', 'pilot_contact',
    'contactId', matched_contacts[1],
    'sourceData', jsonb_build_object(
      'targetMode', 'campaign', 'targetCampaignId', pilot_campaign
    )
  );
end;
$function$;

comment on function public.nucleo_customer_assistant_access(text) is
  'Decide se o agente de clientes atende este remetente. Contato com a etiqueta nao-atender-ia (Nao atender IA) e recusado em qualquer modo de rollout (reason contact_opted_out); o gateway ignora a mensagem e nada e enviado.';

-- ---------------------------------------------------------------------------
-- 3/3. Asserções. Se alguma reprovar, a transação inteira volta.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access';
  if corpo not like '%contact_opted_out%' then
    raise exception 'falhou: a recusa por etiqueta nao entrou';
  end if;
  -- A recusa por etiqueta precisa vir ANTES do retorno de `active`.
  if position('contact_opted_out' in corpo) > position('''reason'', ''active''' in corpo) then
    raise exception 'falhou: a recusa por etiqueta ficou depois do modo active e nao valeria nele';
  end if;
  -- O piloto continua intacto.
  if corpo not like '%customer_assistant_pilot_contacts%' or corpo not like '%pilot_contact%' then
    raise exception 'falhou: o ramo do piloto foi perdido';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access'
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%SET search_path TO ''''%'
  ) then
    raise exception 'falhou: SECURITY DEFINER ou search_path mudou';
  end if;
end $$;

commit;
