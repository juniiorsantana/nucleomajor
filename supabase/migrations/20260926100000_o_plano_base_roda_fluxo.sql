-- O plano sem IA passa a rodar fluxo, e o desconhecido vira contato.
--
-- Decisão do dono em 23/09/2026: o construtor de fluxos e as respostas
-- automáticas entram no plano Base (R$ 97); a IA no atendimento continua a
-- partir do Atendimento com IA. Hoje isso é impossível por duas razões, as
-- duas resolvidas aqui.
--
--
-- 1. O PORTEIRO RECUSA QUEM NÃO TEM IA
--
-- Toda mensagem de cliente passa por `public.nucleo_customer_assistant_access`
-- antes de o assistente da VPS enfileirar qualquer coisa. Desde a trava de IA
-- (20260920110000), a casca pública devolve `allowed: false,
-- reason: plan_without_assistant` para quem não tem `ai_customer` — e o
-- chatbot está atrás desse portão. Um cliente do Base não roda fluxo nenhum.
--
-- A casca passa a distinguir três situações:
--
--   * tem `ai_customer`  -> delega à função viva, como sempre;
--   * não tem, mas tem `chatbots` -> `allowed: false` + `chatbotOnly: true`;
--   * não tem nenhuma das duas -> `plan_without_assistant`, como hoje.
--
-- **`allowed` continua `false` de propósito.** O runtime que não conhece o
-- campo novo segue recusando a mensagem, que é exatamente o comportamento de
-- hoje; só o runtime novo lê `chatbotOnly` e encaminha ao executor de chatbot,
-- sem nunca chamar o Claude. Com isso a ordem de aplicação deixa de importar e
-- o estado intermediário é seguro.
--
-- A etiqueta "Não atender IA" continua valendo no caminho novo. Ela é a
-- decisão de uma pessoa da equipe sobre aquele contato, e quem a aplicou não
-- quer automação nenhuma ali — nem IA, nem chatbot. Como a conferência mora
-- dentro da função viva, que este caminho não chama, o predicado vira
-- `private.contact_opted_out_of_ai`, com a mesma regra da 20260911150000
-- (casa por `legacy_id` ou pelo nome normalizado, contato apagado não conta).
-- A função viva não é tocada; a conferência no fim prova que as duas
-- concordam.
--
--
-- 2. O FLUXO EXIGE CONTATO JÁ CADASTRADO
--
-- `nucleo_flow_start` procura o contato pelo telefone e levanta
-- `flow contact unavailable` se não achar. Quem chega por anúncio chega
-- desconhecido, então **hoje anúncio não dispara fluxo** — que é justamente o
-- caso que o plano Base precisa atender.
--
-- Agora, quando não existe contato, ele é criado com o telefone e origem
-- `WhatsApp`, e o fluxo segue. Só no início do fluxo: quem manda "oi" sem
-- gatilho nenhum continua fora do CRM.
--
-- Antes de criar, uma segunda busca usa `private.customer_phone_matches`, que
-- casa o celular brasileiro com e sem o nono dígito. Sem ela, um contato
-- cadastrado numa forma e escrevendo pela outra viraria um contato duplicado a
-- cada conversa — e hoje nem isso: levantava `flow contact unavailable`.
--
-- Pré-requisitos, todos aplicados em produção:
--   20260907010000 (execução durável), 20260911150000 (etiqueta),
--   20260920110000 (trava de IA), 20260924100000 (catálogo de funções).
--
-- Aplicar pelo SQL Editor. Conferir depois com
-- scripts/sql/validar-plano-base-roda-fluxo.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guardas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.nucleo_customer_assistant_access(text)') is null then
    raise exception 'abortado: aplicar 20260920110000 antes';
  end if;
  if to_regprocedure('private.org_has_feature(uuid, text)') is null then
    raise exception 'abortado: aplicar 20260924100000 antes';
  end if;
  if to_regprocedure('public.nucleo_flow_start(text, text, uuid, bigint, uuid, bigint)') is null then
    raise exception 'abortado: aplicar 20260907010000 antes';
  end if;
  if to_regprocedure('private.customer_phone_matches(text, text)') is null then
    raise exception 'abortado: private.customer_phone_matches nao existe';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2/4. O predicado da etiqueta, isolado.
--
-- Mesma regra da 20260911150000, que continua embutida na função viva. Isolar
-- aqui é o que permite conferi-la no caminho novo sem reescrever a função que
-- atende a Major hoje.
-- ---------------------------------------------------------------------------
create or replace function private.contact_opted_out_of_ai(
  target_organization uuid, requester_phone text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contacts contact
    join public.contact_tags marcacao
      on marcacao.contact_id = contact.id
     and marcacao.organization_id = contact.organization_id
    join public.tags tag
      on tag.id = marcacao.tag_id
     and tag.organization_id = marcacao.organization_id
    where contact.organization_id = target_organization
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
  );
$$;

comment on function private.contact_opted_out_of_ai(uuid, text) is
  'Contato marcado com a etiqueta nao-atender-ia nesta organizacao. Mesmo predicado embutido em private.nucleo_customer_assistant_access (20260911150000); usado pelo caminho chatbotOnly, que nao passa por ela. Ver 20260926100000.';

revoke all on function private.contact_opted_out_of_ai(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/4. O porteiro passa a conhecer "só chatbot".
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_customer_assistant_access(requester_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
begin
  -- Sem credencial de robô, a viva levanta como sempre levantou.
  if robot_org is not null and not private.org_has_feature(robot_org, 'ai_customer') then
    -- Plano sem IA, mas com chatbot: o fluxo pode rodar. `allowed` fica false
    -- para o runtime antigo continuar recusando; o novo lê `chatbotOnly`.
    if private.org_has_feature(robot_org, 'chatbots')
       and not private.contact_opted_out_of_ai(robot_org, requester_phone) then
      return jsonb_build_object(
        'schemaVersion', 'customer-rollout-1', 'allowed', false,
        'chatbotOnly', true, 'mode', 'off', 'reason', 'chatbot_only'
      );
    end if;
    return jsonb_build_object(
      'schemaVersion', 'customer-rollout-1', 'allowed', false,
      'mode', 'off', 'reason', 'plan_without_assistant'
    );
  end if;
  return private.nucleo_customer_assistant_access(requester_phone);
end;
$$;

comment on function public.nucleo_customer_assistant_access(text) is
  'Confere o plano da empresa do robo. Com ai_customer delega a private.nucleo_customer_assistant_access. Sem ela, mas com chatbots e sem a etiqueta nao-atender-ia: allowed false + chatbotOnly true (so o fluxo, nunca o Claude). Sem nenhuma das duas: reason plan_without_assistant. Ver 20260926100000.';

-- ---------------------------------------------------------------------------
-- 4/4. O fluxo cria o contato que ainda não existe.
--
-- Corpo idêntico ao de 20260907010000, com uma única mudança: onde levantava
-- `flow contact unavailable`, agora procura pelas duas formas do celular e,
-- se ainda assim não houver, cria.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_flow_start(
  requester_phone text, external_message text, selected_chatbot uuid,
  expected_version bigint, conversation_session uuid, conversation_epoch bigint default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org uuid:=private.robot_organization(); conn uuid:=private.flow_connection();
  safe_phone text:=regexp_replace(coalesce(requester_phone,''),'[^0-9]','','g');
  bot public.chatbot_definitions%rowtype; run public.chatbot_flow_executions%rowtype;
  contact uuid;
begin
  if length(safe_phone) not between 10 and 15 or conversation_session is null or conversation_epoch is null or conversation_epoch<0
    or length(trim(coalesce(external_message,''))) not between 1 and 500 then
    raise exception 'flow identity invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||conn::text||':'||safe_phone,0));
  select * into run from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.external_message_id=external_message;
  if found then
    if run.requester_phone<>safe_phone or run.chatbot_id<>selected_chatbot
      or run.conversation_session_id<>conversation_session or run.conversation_epoch<>conversation_epoch then raise exception 'flow identity mismatch'; end if;
    return private.flow_envelope(run);
  end if;
  if exists(select 1 from public.chatbot_flow_executions f where f.organization_id=org
    and f.connection_id=conn and f.requester_phone=safe_phone
    and f.status in ('ready','executing','suspended','needs_review')) then
    raise exception 'flow conversation already running';
  end if;
  select * into bot from public.chatbot_definitions b where b.id=selected_chatbot
    and b.organization_id=org and b.active and b.deleted_at is null and b.version=expected_version for share;
  if not found then raise exception 'flow definition changed'; end if;
  perform private.flow_validate(bot.definition);
  select c.id into contact from public.contacts c where c.organization_id=org and c.deleted_at is null
    and (regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=safe_phone
      or regexp_replace(coalesce(c.whatsapp_id,''),'[^0-9]','','g')=safe_phone)
    order by c.updated_at desc limit 1;
  -- As duas formas do celular brasileiro, antes de criar: o contato pode estar
  -- gravado sem o nono dígito e escrever com ele, ou o contrário.
  if contact is null then
    select c.id into contact from public.contacts c
      where c.organization_id=org and c.deleted_at is null
        and (private.customer_phone_matches(safe_phone, c.phone)
          or private.customer_phone_matches(safe_phone, c.whatsapp_id))
      order by c.updated_at desc limit 1;
  end if;
  -- Quem chega por anúncio chega desconhecido. O fluxo já é a intenção
  -- declarada, então aqui o contato nasce; o nome fica vazio até alguém
  -- preencher ou a sincronia do WhatsApp trazer.
  if contact is null then
    insert into public.contacts(organization_id, phone, source)
    values(org, safe_phone, 'WhatsApp')
    returning id into contact;
  end if;
  if exists(select 1 from public.conversation_intelligence_contexts c where c.organization_id=org
    and c.contact_id=contact and c.channel='whatsapp' and c.state='handed_off') then
    raise exception 'flow conversation with human';
  end if;
  insert into public.chatbot_flow_executions(organization_id,connection_id,contact_id,chatbot_id,
    chatbot_version,definition_snapshot,requester_phone,conversation_session_id,conversation_epoch,external_message_id,cursor_node_id)
  values(org,conn,contact,bot.id,bot.version,bot.definition,safe_phone,conversation_session,nucleo_flow_start.conversation_epoch,external_message,
    private.flow_target(bot.definition,'condicoes','padrao')) returning * into run;
  return private.flow_envelope(run);
end;
$$;

comment on function public.nucleo_flow_start(text, text, uuid, bigint, uuid, bigint) is
  'Inicia uma execucao de fluxo. Procura o contato pelo telefone exato, depois pelas duas formas do celular, e cria um contato novo se nao houver — lead de anuncio chega desconhecido. Ver 20260926100000.';

-- ---------------------------------------------------------------------------
-- Conferência: o predicado isolado concorda com o embutido na função viva.
--
-- Prova por amostra real: para cada contato marcado com a etiqueta, o
-- predicado novo tem de responder `true`; para um telefone que não existe,
-- `false`. Se divergir, a migration não passa.
-- ---------------------------------------------------------------------------
do $$
declare
  marcado record;
  conferidos integer := 0;
begin
  for marcado in
    select contact.organization_id as org, contact.phone as phone
    from public.contacts contact
    join public.contact_tags marcacao
      on marcacao.contact_id = contact.id
     and marcacao.organization_id = contact.organization_id
    join public.tags tag
      on tag.id = marcacao.tag_id
     and tag.organization_id = marcacao.organization_id
    where contact.deleted_at is null
      and tag.deleted_at is null
      and coalesce(nullif(trim(contact.phone), ''), '') <> ''
      and (
        lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'
        or lower(regexp_replace(tag.name, '[^A-Za-z]', '', 'g')) in ('noatenderia', 'naoatenderia')
      )
    limit 50
  loop
    if not private.contact_opted_out_of_ai(marcado.org, marcado.phone) then
      raise exception 'conferencia: contato marcado nao foi reconhecido pelo predicado novo';
    end if;
    conferidos := conferidos + 1;
  end loop;

  if exists (
    select 1 from public.organizations o
    where private.contact_opted_out_of_ai(o.id, '5500000000000')
  ) then
    raise exception 'conferencia: telefone inexistente foi tratado como marcado';
  end if;

  raise notice 'contatos marcados conferidos: %', conferidos;
end;
$$;

commit;
