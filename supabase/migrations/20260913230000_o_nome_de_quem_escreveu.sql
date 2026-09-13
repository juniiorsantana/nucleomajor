-- O nome de quem escreveu, na bolha do portal.
--
-- Terceira queixa do dono em 13/09/2026: "não dá para saber, nas mensagens,
-- quem escreveu". Ela é verdadeira no nível do DADO, e não da tela. Toda
-- mensagem que sai da empresa chega ao Bridge como `is_from_me = 1` — a IA, o
-- atendente no portal e o dono digitando no celular produzem exatamente a
-- mesma linha, e o Bridge não tem como distingui-las porque do lado dele são a
-- mesma coisa. A sincronia então manda `fromMe` e nada mais, e
-- `whatsapp_messages` não tem onde guardar o que ninguém contou.
--
-- A tela, essa, já está pronta: a `Bolha` (`conversas/pecas.jsx`) desenha
-- `autor` + `tom` (`bot`/`ia`/`humano`) desde a Leva 2. Faltava só o dado.
--
--
-- 1. DE ONDE VEM A AUTORIA
--
-- Do runtime, que é o único que sabe. Ele já anota o que ele próprio manda
-- (`presenca_humana.saida_do_agente`, o "livro de saídas") para não confundir
-- a própria resposta com um atendente e se calar sozinho — a regra que a
-- Fase 1 consertou em 13/09. Esta migration é o outro lado da mesma anotação:
-- o livro passou a guardar TIPO, NOME e ID de quem escreveu, e a sincronia
-- cruza cada `is_from_me` com ele antes de subir.
--
-- Os valores, e o que cada um quer dizer:
--
--   contato  — a pessoa do outro lado (`fromMe = false`). Sem nome: quem ela é
--              já está no topo da conversa, e repeti-lo em toda bolha é ruído.
--   ia       — um agente respondeu. `author_name` é o `display_name` do agente
--              que o Router escolheu; `author_id`, o `assistant_profiles.id`.
--   humano   — alguém da equipe escreveu PELO PORTAL. `author_name` é o nome
--              curto de quem clicou; `author_id`, o `auth.uid()` dele.
--   bot      — saída automática que não é turno de agente: lembrete de agenda.
--   vazio    — ninguém anotou. É RESPOSTA, e não falta de resposta: pela
--              decisão do dono, mensagem sem registro de autor foi digitada no
--              aplicativo do celular, e a bolha sai sem nome. Não existe rótulo
--              "celular" porque seria palpite — o aparelho envia direto, sem
--              passar por lugar nenhum do runtime, e nada prova que foi ele.
--
-- `author_id` guarda dois tipos de identidade — `assistant_profiles.id` quando
-- o autor é `ia`, `profiles.id` quando é `humano` — e por isso NÃO tem chave
-- estrangeira. Uma FK teria de apontar para duas tabelas, e apagar um agente
-- apagaria a autoria de conversas antigas que já aconteceram. O `author_kind`
-- ao lado diz em qual tabela procurar.
--
--
-- 2. QUAL FUNÇÃO ESTA MIGRATION TOCA — e por que não a de fora
--
-- `nucleo_conversation_sync` deixou de ser o corpo da sincronia em 10/09
-- (`20260910120000_fotos_nas_conversas.sql`): aquela migration renomeou o
-- corpo para `nucleo_conversation_sync_without_photos` e pôs no lugar um
-- invólucro que chama o corpo e depois enriquece a foto do contato.
--
-- Quem grava mensagem é o CORPO. Substituir o invólucro apagaria o
-- enriquecimento da foto sem aviso nenhum — a sincronia continuaria
-- respondendo `accepted: true` e as fotos parariam de chegar. Por isso esta
-- migration substitui `nucleo_conversation_sync_without_photos`, e o invólucro
-- fica intocado.
--
--
-- 3. POR QUE O `do nothing` TEVE DE VIRAR `do update`
--
-- Esta é a parte que precisa de atenção. A sincronia terminava em
-- `on conflict (connection_id, contact_phone, message_id) do nothing`: uma
-- mensagem já espelhada nunca mais era tocada. Com autoria isso vira perda
-- permanente, porque existe uma corrida de milissegundos — o Bridge grava a
-- linha durante o envio, o runtime anota quem escreveu logo depois que o envio
-- confirma, e um ciclo de sincronia no meio publicaria a mensagem sem autor. A
-- marca d'água só anda para a frente: aquela mensagem jamais seria reavaliada,
-- e apareceria para sempre como se tivesse saído do celular.
--
-- O `do update` daqui é o mais estreito que resolve isso:
--
--   * toca SOMENTE as três colunas de autoria. `content`, `sent_at`,
--     `is_from_me` e a mídia continuam imutáveis depois de gravados — o
--     espelho não reescreve mensagem, e nunca deve;
--   * só preenche o que está VAZIO. Autoria já gravada não é sobrescrita, nem
--     por outra autoria nem (principalmente) por vazio: um lote atrasado do
--     runtime não pode apagar o nome que já está na tela;
--   * o `where` no fim impede escrita inútil. Sem ele, toda mensagem
--     reoferecida geraria uma atualização de linha — e um UPDATE por mensagem
--     repetida acorda o gatilho de realtime a cada ciclo, que é exatamente o
--     que a migration de 11/09 passou a semana consertando.
--
-- O runtime reoferece as saídas recentes sem autor uma vez por ciclo
-- (`conversation_sync._reparo_de_autoria`, janela de 20 min). É este
-- `do update` que dá sentido àquela passada.
--
--
-- 4. QUEM ASSINA PELO PORTAL — resolvido no banco, nunca no navegador
--
-- `nucleo_conversation_command_enqueue` passa a pôr `authorName` e `authorId`
-- no payload de `conversation_send`, resolvidos a partir do `auth.uid()` com a
-- MESMA regra que já vale para `attendantName` (`display_name`, senão
-- `full_name`). Aceitar um nome vindo do cliente deixaria qualquer membro
-- assinar com o nome de outro — numa mensagem que sai para fora da empresa,
-- chega ao WhatsApp de um cliente e não tem como ser desmentida depois.
--
-- O runtime usa esse nome para duas coisas: a assinatura `*Nome:*` na primeira
-- linha da mensagem e o registro de autoria. Portal antigo (sem os campos)
-- continua enviando: a mensagem sai sem assinatura e sem nome, como ontem.
--
--
-- O que esta migration NÃO faz:
--
--  * não reescreve histórico. Mensagem que já está no espelho fica sem autor,
--    e a bolha dela sai sem nome — inclusive as que a IA mandou antes de hoje.
--    Vale para as próximas;
--  * não cria tela, tabela nem RLS. `whatsapp_messages` continua com a mesma
--    policy de leitura por organização, e ninguém além da credencial de robô
--    escreve nela;
--  * não toca em `whatsapp_conversations`, `owner`, `attendant_name`, na foto
--    do contato nem no árbitro;
--  * não muda o teto do lote, a poda de 90 dias nem a idempotência por
--    `message_id`.

begin;

-- Aborta cedo se o mundo não for o que este arquivo supõe. Uma migration que
-- recria a sincronia em cima de uma base diferente da esperada é o jeito mais
-- rápido de perder o espelho de conversas inteiro.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_conversation_sync_without_photos'
  ) then
    raise exception 'abortado: nucleo_conversation_sync_without_photos nao existe; a migration das fotos (20260910120000) precisa estar aplicada';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_conversation_sync'
      and p.prosrc like '%nucleo_conversation_sync_without_photos%'
  ) then
    raise exception 'abortado: nucleo_conversation_sync nao e mais o involucro que chama o corpo; conferir o que mudou antes de prosseguir';
  end if;
end $$;

-- --------------------------------------------------------------- 1. colunas

alter table public.whatsapp_messages
  add column if not exists author_kind text not null default '',
  add column if not exists author_name text not null default '',
  add column if not exists author_id uuid;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_author_kind;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_author_kind
  check (author_kind in ('', 'contato', 'ia', 'humano', 'celular', 'bot'));

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_author_name;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_author_name
  check (length(author_name) <= 120);

comment on column public.whatsapp_messages.author_kind is
  'Quem escreveu: contato (a pessoa do outro lado), ia (agente), humano (equipe pelo portal), bot (lembrete automatico). Vazio e resposta, nao falta dela: a mensagem foi digitada no aplicativo do celular, que envia direto do aparelho sem passar pelo runtime, e a bolha sai sem nome. Preenchido pela sincronia, cruzando cada is_from_me com o livro de saidas do runtime (presenca_humana.saida_do_agente). O valor celular existe no check por compatibilidade e nao e escrito por ninguem.';
comment on column public.whatsapp_messages.author_name is
  'Nome curto de quem escreveu, como aparece na bolha. Agente: assistant_profiles.display_name. Equipe: profiles.display_name (senao full_name), resolvido pela RPC a partir do auth.uid(), nunca enviado pelo navegador. Vazio para contato e para saida sem autoria.';
comment on column public.whatsapp_messages.author_id is
  'Identidade de quem escreveu. assistant_profiles.id quando author_kind = ia; profiles.id quando author_kind = humano. Sem chave estrangeira de proposito: sao duas tabelas, e apagar um agente nao pode apagar a autoria de uma conversa que ja aconteceu. O author_kind ao lado diz onde procurar.';

-- ------------------------------------------------- 2. a sincronia grava autor
--
-- Corpo idêntico ao de `20260902200000`, com UMA diferença: o trecho das
-- mensagens ganhou as três colunas e o `do nothing` virou o `do update`
-- estreito descrito no tópico 3. O trecho das conversas, a poda de 90 dias, as
-- guardas de tamanho de lote e a resolução da credencial de robô estão letra
-- por letra como estavam.

create or replace function public.nucleo_conversation_sync_without_photos(sync_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  conversas jsonb := coalesce(sync_payload -> 'conversations', '[]'::jsonb);
  mensagens jsonb := coalesce(sync_payload -> 'messages', '[]'::jsonb);
  conversas_gravadas integer := 0;
  mensagens_gravadas integer := 0;
  podadas integer := 0;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if jsonb_typeof(sync_payload) <> 'object'
    or pg_catalog.octet_length(sync_payload::text) > 262144 then
    raise exception 'conversation sync payload is invalid';
  end if;
  if jsonb_typeof(conversas) <> 'array' or jsonb_typeof(mensagens) <> 'array' then
    raise exception 'conversation sync payload is invalid';
  end if;
  if pg_catalog.jsonb_array_length(conversas) > 500
    or pg_catalog.jsonb_array_length(mensagens) > 2000 then
    raise exception 'conversation sync batch is too large';
  end if;

  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  join public.whatsapp_connections connection
    on connection.id = credential.connection_id
   and connection.organization_id = credential.organization_id
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
    and credential.revoked_at is null
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  limit 1;
  if robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;

  /*
   * Texto longo continua truncado, e não recusado. O identificador continua
   * sendo FILTRO — o que muda é o que passa por ele: agora o traço do grupo
   * antigo também passa, e `kind` diz como a tela deve ler o que passou.
   *
   * `attendant` só sobrevive quando o dono é `humano`, e é a mesma regra que o
   * árbitro aplica do outro lado. Repeti-la aqui não é redundância: sem ela,
   * um lote fora de ordem gravaria "Atendente · Lucas" numa conversa que já
   * tinha voltado para a IA, e a lista mentiria sobre quem responde.
   */
  with bruta as (
    select
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9-]', '', 'g') as phone,
      case when coalesce(item ->> 'kind', 'direto') = 'grupo'
        then 'grupo' else 'direto' end as kind,
      left(trim(coalesce(item ->> 'name', '')), 120) as name,
      left(trim(coalesce(item ->> 'preview', '')), 200) as preview,
      (item ->> 'lastMessageAt')::timestamptz as last_at,
      coalesce((item ->> 'fromMe')::boolean, false) as from_me,
      greatest(0, least(coalesce((item ->> 'unread')::integer, 0), 100000)) as unread,
      case when coalesce(item ->> 'owner', 'bot') in ('bot', 'ia', 'humano')
        then item ->> 'owner' else 'bot' end as owner,
      case when coalesce(item ->> 'owner', 'bot') = 'humano'
        then nullif(trim(coalesce(item ->> 'attendantId', '')), '') end as attendant_id,
      case when coalesce(item ->> 'owner', 'bot') = 'humano'
        then left(trim(coalesce(item ->> 'attendantName', '')), 120) else '' end as attendant_name
    from pg_catalog.jsonb_array_elements(conversas) as item
  ), entrada as (
    select distinct on (bruta.phone) bruta.*
    from bruta
    order by bruta.phone, bruta.last_at desc nulls last
  ), gravadas as (
    insert into public.whatsapp_conversations (
      connection_id, organization_id, contact_phone, chat_kind, contact_name,
      last_message_preview, last_message_at, last_message_from_me,
      unread_count, owner, attendant_id, attendant_name, updated_at
    )
    select
      robot_connection, robot_org, entrada.phone, entrada.kind, entrada.name,
      entrada.preview, entrada.last_at, entrada.from_me,
      entrada.unread, entrada.owner,
      -- Um id de atendente que não seja UUID é descartado em vez de derrubar o
      -- lote: o árbitro aceita qualquer texto ali, e uma sessão antiga pode
      -- carregar um identificador de outro formato.
      case when entrada.attendant_id ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then entrada.attendant_id::uuid end,
      entrada.attendant_name, now()
    from entrada
    where entrada.phone ~ '^[0-9][0-9-]{5,39}$'
    on conflict (connection_id, contact_phone) do update set
      chat_kind = excluded.chat_kind,
      contact_name = excluded.contact_name,
      last_message_preview = excluded.last_message_preview,
      last_message_at = excluded.last_message_at,
      last_message_from_me = excluded.last_message_from_me,
      unread_count = excluded.unread_count,
      owner = excluded.owner,
      attendant_id = excluded.attendant_id,
      attendant_name = excluded.attendant_name,
      updated_at = now()
    returning 1
  )
  select pg_catalog.count(*)::integer into conversas_gravadas from gravadas;

  with entrada as (
    select
      pg_catalog.regexp_replace(item ->> 'phone', '[^0-9-]', '', 'g') as phone,
      left(trim(coalesce(item ->> 'id', '')), 128) as message_id,
      left(coalesce(item ->> 'content', ''), 8000) as content,
      (item ->> 'sentAt')::timestamptz as sent_at,
      coalesce((item ->> 'fromMe')::boolean, false) as from_me,
      left(trim(coalesce(item ->> 'mediaType', '')), 32) as media_type,
      left(trim(coalesce(item ->> 'mediaFilename', '')), 200) as media_filename,
      -- Autoria. Um valor que esta versão não conheça vira vazio, e vazio é
      -- "ninguém anotou" — nunca um erro, que derrubaria o lote inteiro e
      -- travaria a marca d'água no mesmo ponto para sempre.
      case when coalesce(item ->> 'authorKind', '') in ('contato', 'ia', 'humano', 'bot')
        then item ->> 'authorKind' else '' end as author_kind,
      left(trim(coalesce(item ->> 'authorName', '')), 120) as author_name,
      -- Mesmo cuidado do id de atendente: identificador fora do formato é
      -- descartado, não derruba o lote.
      case when trim(coalesce(item ->> 'authorId', '')) ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (trim(item ->> 'authorId'))::uuid end as author_id
    from pg_catalog.jsonb_array_elements(mensagens) as item
  ), gravadas as (
    insert into public.whatsapp_messages (
      connection_id, organization_id, contact_phone, message_id,
      content, sent_at, is_from_me, media_type, media_filename,
      author_kind, author_name, author_id
    )
    select
      robot_connection, robot_org, entrada.phone, entrada.message_id,
      entrada.content, entrada.sent_at, entrada.from_me,
      entrada.media_type, entrada.media_filename,
      entrada.author_kind, entrada.author_name, entrada.author_id
    from entrada
    where entrada.phone ~ '^[0-9][0-9-]{5,39}$'
      and entrada.message_id <> ''
      and entrada.sent_at is not null
    -- Estreito de propósito. Ver o tópico 3 do cabeçalho: o conteúdo da
    -- mensagem continua imutável depois de gravado, autoria só é escrita sobre
    -- autoria VAZIA, e o `where` impede o UPDATE inútil que acordaria o
    -- gatilho de realtime a cada ciclo.
    on conflict (connection_id, contact_phone, message_id) do update
    set author_kind = case
          when public.whatsapp_messages.author_kind = '' and excluded.author_kind <> ''
          then excluded.author_kind else public.whatsapp_messages.author_kind end,
        author_name = case
          when public.whatsapp_messages.author_name = '' and excluded.author_name <> ''
          then excluded.author_name else public.whatsapp_messages.author_name end,
        author_id = coalesce(public.whatsapp_messages.author_id, excluded.author_id)
    where (public.whatsapp_messages.author_kind = '' and excluded.author_kind <> '')
       or (public.whatsapp_messages.author_name = '' and excluded.author_name <> '')
       or (public.whatsapp_messages.author_id is null and excluded.author_id is not null)
    returning 1
  )
  select pg_catalog.count(*)::integer into mensagens_gravadas from gravadas;

  with alvo as (
    select mensagem.ctid
    from public.whatsapp_messages mensagem
    where mensagem.connection_id = robot_connection
      and mensagem.sent_at < now() - interval '90 days'
    limit 500
  ), removidas as (
    delete from public.whatsapp_messages
    where ctid in (select alvo.ctid from alvo)
    returning 1
  )
  select pg_catalog.count(*)::integer into podadas from removidas;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = robot_org
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object(
    'accepted', true,
    'connectionId', robot_connection,
    'conversations', conversas_gravadas,
    'messages', mensagens_gravadas,
    'pruned', podadas,
    'syncedAt', now()
  );
end;
$$;

-- `create or replace` preserva a ACL, mas a permissão desta função é assunto
-- sensível demais para ficar implícita: quem executa é o invólucro, nunca um
-- cliente.
revoke all on function public.nucleo_conversation_sync_without_photos(jsonb) from public;

-- --------------------------------------------- 3. quem assina pelo portal
--
-- Corpo identico ao de `20260908120000`, com DUAS diferencas: a variavel
-- `autor_nome` no `declare` e a carga de `conversation_send`, que passou a
-- levar `authorId` e `authorName`. O resto -- as guardas de associacao, a
-- exigencia de conversa espelhada, a chave de idempotencia, os prazos de cada
-- comando e o ramo de `conversation_owner` -- esta letra por letra como estava.

create or replace function public.nucleo_conversation_command_enqueue(
  target_organization uuid,
  target_connection uuid,
  target_chat text,
  requested_command text,
  command_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comando text := lower(trim(coalesce(requested_command, '')));
  chat text := pg_catalog.regexp_replace(coalesce(target_chat, ''), '[^0-9-]', '', 'g');
  conexao uuid := target_connection;
  conversa public.whatsapp_conversations%rowtype;
  cliente text := trim(coalesce(command_payload ->> 'clientId', ''));
  texto text := trim(coalesce(command_payload ->> 'text', ''));
  dono text := lower(trim(coalesce(command_payload ->> 'owner', '')));
  atendente uuid;
  atendente_nome text := '';
  autor_nome text := '';
  carga jsonb;
  validade interval;
  chave text;
  comando_id uuid;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  if comando not in ('conversation_send', 'conversation_owner', 'conversation_check') then
    raise exception 'conversation command is invalid';
  end if;
  if cliente !~ '^[0-9a-fA-F-]{8,64}$' then
    raise exception 'conversation command needs a client id';
  end if;

  if comando = 'conversation_check' then
    /*
     * A pergunta. Não escreve nada, não envia nada, e por isso não exige
     * espelho — é ela que decide se vale a pena criar a conversa.
     *
     * A conexão ainda precisa ser desta organização e estar viva: uma consulta
     * ao WhatsApp sai da conta pareada, e deixar o chamador apontar para uma
     * conexão qualquer faria uma organização perguntar pela conta de outra.
     */
    if chat !~ '^[0-9]{10,15}$' then
      raise exception 'phone number is invalid';
    end if;
    -- A conexão pode vir nula, e vem: perguntar é o que se faz ANTES de existir
    -- conversa, inclusive na caixa de entrada vazia, onde não há linha nenhuma
    -- de onde a tela pudesse tirar a conexão.
    if conexao is null then
      conexao := private.conexao_da_organizacao(target_organization);
    else
      perform 1
      from public.whatsapp_connections connection
      where connection.id = conexao
        and connection.organization_id = target_organization
        and connection.status <> 'revoked'
        and connection.revoked_at is null;
      if not found then
        raise exception 'connection is not available for this organization';
      end if;
    end if;
    carga := jsonb_build_object('phone', chat);
    -- Dois minutos. Uma verificação que ficou parada além disso não interessa
    -- mais a ninguém: quem perguntou já fechou o modal.
    validade := interval '2 minutes';
  else
    -- A conversa precisa já existir no espelho. Esta é a guarda que impede a
    -- fila de virar envio para número arbitrário — quem nunca falou com a
    -- organização não tem linha aqui, e portanto não tem como receber.
    select conversation.* into conversa
    from public.whatsapp_conversations conversation
    where conversation.organization_id = target_organization
      and conversation.connection_id = conexao
      and conversation.contact_phone = chat;
    if not found then
      raise exception 'conversation is not mirrored for this connection';
    end if;

    if comando = 'conversation_send' then
      if texto = '' or length(texto) > 4000 then
        raise exception 'message text is invalid';
      end if;
      /*
       * Quem escreveu, resolvido AQUI dentro.
       *
       * O nome vai para duas coisas do outro lado: a assinatura `*Nome:*` na
       * primeira linha da mensagem que chega ao WhatsApp do contato, e o
       * registro de autoria que faz a bolha do portal dizer quem falou.
       *
       * Aceitar um nome vindo do navegador deixaria qualquer membro assinar
       * com o nome de outro -- numa mensagem que sai para fora da empresa e
       * nao tem como ser desmentida depois. A regra e a mesma de
       * `attendantName` logo abaixo: nome curto, senao o inteiro.
       *
       * A associacao ja foi conferida no topo da funcao
       * (`private.is_org_member`), entao aqui basta o perfil. Perfil sem nome
       * nenhum devolve vazio, e o runtime manda a mensagem sem assinatura --
       * o que nao pode acontecer e' a mensagem nao sair por causa disto.
       */
      select coalesce(nullif(trim(profile.display_name), ''), profile.full_name, '')
      into autor_nome
      from public.profiles profile
      where profile.id = auth.uid();
      carga := jsonb_build_object(
        'chat', chat, 'kind', conversa.chat_kind, 'text', texto,
        'authorId', auth.uid()::text,
        'authorName', left(coalesce(autor_nome, ''), 120)
      );
      -- Dez minutos. Uma mensagem que ficou parada na fila além disso não deve
      -- sair sozinha: quem a escreveu já saiu da tela, e a conversa já mudou.
      validade := interval '10 minutes';
    else
      if dono not in ('bot', 'ia', 'humano') then
        raise exception 'conversation owner is invalid';
      end if;
      if dono = 'humano' then
        -- Sem `attendantId` a transição continua válida e significa "alguém
        -- pegue" — é o que um fluxo automático diz quando pede gente sem saber
        -- quem. Com id, ele precisa ser de alguém ativo NESTA organização.
        atendente := nullif(trim(coalesce(command_payload ->> 'attendantId', '')), '')::uuid;
        if atendente is not null then
          select coalesce(nullif(trim(profile.display_name), ''), profile.full_name, '')
          into atendente_nome
          from public.organization_members membro
          join public.profiles profile on profile.id = membro.user_id
          where membro.organization_id = target_organization
            and membro.user_id = atendente
            and membro.status = 'active';
          if not found then
            raise exception 'attendant is not an active member of this organization';
          end if;
        end if;
      end if;
      carga := jsonb_build_object(
        'chat', chat, 'kind', conversa.chat_kind, 'owner', dono,
        'attendantId', coalesce(atendente::text, ''),
        'attendantName', left(atendente_nome, 120)
      );
      validade := interval '5 minutes';
    end if;
  end if;

  chave := encode(
    extensions.digest(
      concat_ws(':', 'conversation-command', comando, conexao::text, chat, cliente),
      'sha256'
    ),
    'hex'
  );

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload,
    created_by, idempotency_key, expires_at
  ) values (
    target_organization, conexao, comando, carga,
    auth.uid(), chave, now() + validade
  )
  -- Reenviar o MESMO clique depois de uma falha volta a valer; reenviá-lo
  -- enquanto o comando ainda está de pé devolve o comando existente sem
  -- duplicar a mensagem no WhatsApp de quem recebe.
  on conflict (organization_id, idempotency_key) do update
    set available_at = case
          when connection_runtime_commands.status in ('failed', 'expired') then now()
          else connection_runtime_commands.available_at end,
        expires_at = case
          when connection_runtime_commands.status in ('failed', 'expired') then now() + validade
          else connection_runtime_commands.expires_at end,
        status = case
          when connection_runtime_commands.status in ('failed', 'expired') then 'pending'
          else connection_runtime_commands.status end,
        private_payload = case
          when connection_runtime_commands.status in ('failed', 'expired') then excluded.private_payload
          else connection_runtime_commands.private_payload end,
        error_code = case
          when connection_runtime_commands.status in ('failed', 'expired') then null
          else connection_runtime_commands.error_code end,
        updated_at = now()
  returning id into comando_id;

  return jsonb_build_object(
    'commandId', comando_id,
    'command', comando,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) to authenticated;

commit;
