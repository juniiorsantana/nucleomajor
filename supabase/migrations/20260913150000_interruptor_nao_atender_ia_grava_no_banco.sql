-- O interruptor "Atendimento pela IA" passa a gravar no banco, e a ler de lá.
--
-- Em 13/09/2026 o dono ligou "Não atender IA" em alguns contatos e a IA seguiu
-- respondendo; teve de desligar o agente inteiro. A consulta de diagnóstico
-- (`scripts/sql/diagnostico-nao-atender-ia.sql`) mostrou a etiqueta existindo e
-- reconhecida pelo gate — e ZERO contatos com ela. A marca nunca chegou aqui.
--
-- O gate (`nucleo_customer_assistant_access`, 20260911150000) estava certo. O
-- defeito era o caminho: o interruptor gravava no IndexedDB do navegador e
-- dependia da fila local para subir, e essa fila descarta em silêncio — contato
-- recém-criado sem id remoto, conflito "remoto vence", etiqueta sem entrada no
-- mapa local. A tela mostrava "desligado" lendo a própria cópia.
--
-- Duas funções, as duas no banco e com a MESMA regra de casamento do gate:
--
--   * `nucleo_contact_ai_opt_out_set` — numa transação só: acha os contatos do
--     número (ou cria um), garante a etiqueta, aplica ou remove, e devolve o
--     estado que ficou gravado;
--   * `nucleo_contact_ai_opt_out_status` — o que o gate vai decidir para este
--     número, para a tela mostrar a verdade e não a cópia local.
--
-- Permissão: membro ativo da organização, a mesma de responder uma conversa
-- (`nucleo_conversation_command_enqueue`). Tirar a IA de um contato pessoal é
-- trabalho de quem atende, não privilégio de administrador.
--
-- Aplicação manual pelo SQL Editor. Sem tabela temporária e sem estado entre
-- statements: cada bloco se sustenta sozinho.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Guardas. O gate vivo precisa ser o que trata a etiqueta.
-- ---------------------------------------------------------------------------
do $$
declare
  corpo text;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_customer_assistant_access';
  if corpo is null or corpo not like '%contact_opted_out%' then
    raise exception 'abortado: o gate vivo nao trata a etiqueta nao-atender-ia (aplicar 20260911150000 antes)';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'customer_phone_matches'
  ) then
    raise exception 'abortado: private.customer_phone_matches nao existe';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'is_org_member'
  ) then
    raise exception 'abortado: private.is_org_member nao existe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2/4. O que o gate vai decidir para este número.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_contact_ai_opt_out_status(
  target_organization uuid,
  target_chat text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  chat text := pg_catalog.regexp_replace(coalesce(target_chat, ''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  if chat !~ '^[0-9]{10,15}$' then
    raise exception 'phone number is invalid';
  end if;

  -- O mesmo predicado do gate, linha por linha: etiqueta por legacy_id ou nome
  -- normalizado, contato e etiqueta não apagados, telefone pelo casamento com e
  -- sem o nono dígito. Divergir daqui faria a tela dizer uma coisa e o gate
  -- decidir outra — que é exatamente o defeito que esta migration desfaz.
  return jsonb_build_object(
    'optedOut', exists (
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
          private.customer_phone_matches(chat, contact.phone)
          or private.customer_phone_matches(chat, contact.whatsapp_id)
        )
    ),
    'contactFound', exists (
      select 1
      from public.contacts contact
      where contact.organization_id = target_organization
        and contact.deleted_at is null
        and (
          private.customer_phone_matches(chat, contact.phone)
          or private.customer_phone_matches(chat, contact.whatsapp_id)
        )
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/4. Ligar ou desligar, numa transação só.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_contact_ai_opt_out_set(
  target_organization uuid,
  target_chat text,
  opt_out boolean,
  contact_name text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  chat text := pg_catalog.regexp_replace(coalesce(target_chat, ''), '[^0-9]', '', 'g');
  contatos uuid[];
  etiqueta uuid;
  nome text := '';
  novo uuid;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  if chat !~ '^[0-9]{10,15}$' then
    raise exception 'phone number is invalid';
  end if;
  if opt_out is null then
    raise exception 'opt out flag is required';
  end if;

  -- Todos os contatos do número, e não um só: dois cadastros do mesmo telefone
  -- (com e sem o nono dígito) existem, e o gate recusa se QUALQUER um estiver
  -- marcado. Marcar um e esquecer o outro não mudaria nada; desmarcar um e
  -- esquecer o outro também não.
  select coalesce(array_agg(contact.id order by contact.created_at), '{}'::uuid[])
  into contatos
  from public.contacts contact
  where contact.organization_id = target_organization
    and contact.deleted_at is null
    and (
      private.customer_phone_matches(chat, contact.phone)
      or private.customer_phone_matches(chat, contact.whatsapp_id)
    );

  if opt_out then
    -- A etiqueta: a do slug antes da do nome, e a mais antiga no empate.
    select tag.id into etiqueta
    from public.tags tag
    where tag.organization_id = target_organization
      and tag.deleted_at is null
      and (
        lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'
        or lower(regexp_replace(tag.name, '[^A-Za-z]', '', 'g')) in ('noatenderia', 'naoatenderia')
      )
    order by (lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia') desc, tag.created_at, tag.id
    limit 1;

    if etiqueta is null then
      -- Uma apagada com o mesmo slug volta à vida, em vez de bater na unicidade.
      insert into public.tags (organization_id, legacy_id, name, color, created_by, updated_by)
      values (target_organization, 'nao-atender-ia', 'Não atender IA', '#6C3483', auth.uid(), auth.uid())
      on conflict (organization_id, legacy_id) do update
        set deleted_at = null, updated_by = excluded.updated_by
      returning id into etiqueta;
    end if;

    if cardinality(contatos) = 0 then
      -- Sem contato salvo, nasce um, com o nome que a conversa já mostra.
      --
      -- O parâmetro vai qualificado pelo nome da função: `contact_name` também
      -- é coluna de `whatsapp_conversations`, e sem isso o PL/pgSQL recusa a
      -- referência ambígua.
      select coalesce(
        nullif(trim(nucleo_contact_ai_opt_out_set.contact_name), ''),
        conversa.contact_name,
        ''
      )
      into nome
      from public.whatsapp_conversations conversa
      where conversa.organization_id = target_organization
        and conversa.contact_phone = chat
      order by conversa.last_message_at desc nulls last
      limit 1;
      nome := coalesce(
        nullif(trim(coalesce(nome, nucleo_contact_ai_opt_out_set.contact_name, '')), ''),
        ''
      );
      -- O número no lugar do nome é o carimbo de quem a agenda não conhece.
      if pg_catalog.regexp_replace(nome, '[^0-9]', '', 'g') = chat then
        nome := '';
      end if;

      insert into public.contacts (organization_id, name, phone, source, created_by, updated_by)
      values (target_organization, left(nome, 200), chat, 'WhatsApp', auth.uid(), auth.uid())
      returning id into novo;
      contatos := array[novo];
    end if;

    insert into public.contact_tags (organization_id, contact_id, tag_id)
    select target_organization, contato, etiqueta
    from unnest(contatos) as contato
    on conflict (contact_id, tag_id) do nothing;
  else
    delete from public.contact_tags marcacao
    using public.tags tag
    where marcacao.organization_id = target_organization
      and marcacao.contact_id = any(contatos)
      and tag.id = marcacao.tag_id
      and tag.organization_id = marcacao.organization_id
      and (
        lower(coalesce(tag.legacy_id, '')) = 'nao-atender-ia'
        or lower(regexp_replace(tag.name, '[^A-Za-z]', '', 'g')) in ('noatenderia', 'naoatenderia')
      );
  end if;

  -- Tocar os contatos é o que faz as cópias locais (a tela de Contatos, o CRM)
  -- puxarem a etiqueta nova na próxima sincronia.
  update public.contacts
  set updated_by = auth.uid(), updated_at = now()
  where organization_id = target_organization
    and id = any(contatos);

  -- O estado que ficou, lido de novo e pelo predicado do gate — e não o que se
  -- pediu. É isso que a tela mostra.
  return jsonb_build_object(
    'optedOut', exists (
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
          private.customer_phone_matches(chat, contact.phone)
          or private.customer_phone_matches(chat, contact.whatsapp_id)
        )
    ),
    'contactIds', to_jsonb(contatos)
  );
end;
$$;

comment on function public.nucleo_contact_ai_opt_out_status(uuid, text) is
  'O que o gate do agente de clientes decide para este numero: optedOut = etiqueta nao-atender-ia aplicada a algum contato do numero. Mesmo predicado de nucleo_customer_assistant_access.';
comment on function public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text) is
  'Liga ou desliga a IA para um numero, gravando a etiqueta nao-atender-ia em todos os contatos dele (criando contato e etiqueta se preciso). Devolve o estado gravado.';

revoke all on function public.nucleo_contact_ai_opt_out_status(uuid, text) from public, anon;
revoke all on function public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text) from public, anon;
grant execute on function public.nucleo_contact_ai_opt_out_status(uuid, text) to authenticated;
grant execute on function public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4/4. Conferência pelo catálogo, e não pela mensagem de sucesso.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_contact_ai_opt_out_set'
      and p.prosecdef and pg_get_functiondef(p.oid) like '%SET search_path TO ''''%'
  ) then
    raise exception 'conferencia: nucleo_contact_ai_opt_out_set sem security definer ou search_path vazio';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_contact_ai_opt_out_status'
      and p.prosecdef and pg_get_functiondef(p.oid) like '%SET search_path TO ''''%'
  ) then
    raise exception 'conferencia: nucleo_contact_ai_opt_out_status sem security definer ou search_path vazio';
  end if;
  if has_function_privilege('anon', 'public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text)', 'execute') then
    raise exception 'conferencia: anon nao pode executar nucleo_contact_ai_opt_out_set';
  end if;
  if not has_function_privilege('authenticated', 'public.nucleo_contact_ai_opt_out_set(uuid, text, boolean, text)', 'execute') then
    raise exception 'conferencia: authenticated precisa executar nucleo_contact_ai_opt_out_set';
  end if;
end $$;

commit;
