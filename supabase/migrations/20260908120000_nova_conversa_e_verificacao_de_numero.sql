-- Iniciar conversa com quem ainda não falou com a empresa.
--
-- A Leva 2 (20260902200000) abriu a escrita, e fechou uma porta de propósito:
-- `nucleo_conversation_command_enqueue` só enfileira para conversa JÁ
-- ESPELHADA. O comentário de lá é explícito sobre o motivo — sem essa guarda a
-- fila viraria uma via de envio frio para qualquer número, que é justamente o
-- que `allowed_recipients` no Bridge existe para barrar.
--
-- A guarda cumpriu o papel dela e agora atrapalha o produto: uma caixa de
-- entrada que só sabe responder não sabe começar. O que esta migration faz NÃO
-- é remover a guarda — é substituí-la por outra, mais estreita no que importa:
--
--   * a de espelho continua valendo, intacta, para `conversation_send` e
--     `conversation_owner`. Nada do caminho de responder muda;
--   * quem pode criar destinatário novo é UMA função nova,
--     `nucleo_conversation_start`, e não a `enqueue` afrouxada. Uma superfície
--     de risco se audita de uma vez; uma condição a mais dentro de uma função
--     que faz três coisas, não;
--   * essa função só aceita telefone individual (`^[0-9]{10,15}$`, SEM traço),
--     o que exclui grupo por construção — o check da coluna aceita traço por
--     causa de grupo antigo, e este não;
--   * e tem teto: 30 conversas iniciadas por organização por hora. Sem ele, a
--     porta que se abre aqui é a de disparo em massa, que é um produto
--     diferente e não é este.
--
-- Antes de criar linha nenhuma, o portal PERGUNTA se o número existe no
-- WhatsApp. A capacidade sempre esteve lá — `resolveSendRecipientJID` no Bridge
-- chama `IsOnWhatsApp` dentro do próprio caminho de envio —, mas nunca foi
-- exposta como consulta. `conversation_check` é essa pergunta, e ela é o único
-- comando desta fila que NÃO exige conversa espelhada: perguntar não envia
-- nada, e exigir espelho para perguntar seria exigir a resposta antes da
-- pergunta.
--
-- `public_result` já existe desde 20260826010000 e o runtime já a escreve. O
-- que faltava era `nucleo_conversation_command_status` devolvê-la — sem isso a
-- resposta da verificação morre no banco.

begin;

-- ------------------------------------------------------------------ tabela

-- Quem semeou a linha, e quando.
--
-- Duas funções. É a trilha de uma conversa que o portal criou antes de o
-- aparelho saber dela — a única linha do espelho cuja origem não é o WhatsApp.
-- E é o contador do teto: sem `started_at` não há como perguntar "quantas
-- foram iniciadas na última hora" sem varrer a tabela inteira.
--
-- Sem FK para `profiles`, pela mesma razão de `attendant_id` em
-- 20260902200000: quem iniciou uma conversa e depois saiu da equipe é
-- história, não erro, e uma FK faria a sincronia inteira falhar por causa
-- disso.
alter table public.whatsapp_conversations
  add column if not exists started_by uuid;
alter table public.whatsapp_conversations
  add column if not exists started_at timestamptz;

-- Índice parcial: só as linhas semeadas têm `started_at`, e são elas que o
-- teto conta. Um índice sobre a coluna inteira indexaria as centenas de
-- conversas reais para responder uma pergunta que só olha as poucas semeadas.
create index if not exists whatsapp_conversations_iniciadas_idx
  on public.whatsapp_conversations (organization_id, started_at)
  where started_at is not null;

-- ------------------------------------------------------- a conexão da vez

/*
 * Qual WhatsApp da empresa, quando o chamador não disse.
 *
 * Numa conversa que já existe o portal sabe a conexão, porque ela é metade do
 * id da linha. Numa conversa que ainda NÃO existe não há id de onde tirá-la — e
 * o caso extremo é o que torna esta função necessária em vez de opcional: numa
 * organização com a caixa de entrada vazia, NÃO EXISTE conversa nenhuma de onde
 * ler a conexão, e sem isto a primeira conversa de todas seria a única
 * impossível de começar.
 *
 * Com mais de uma conexão viva, RECUSA em vez de escolher. Escolher seria
 * decidir por qual número a empresa fala com aquele cliente, e essa decisão não
 * é de uma função de banco. A mensagem diz o que fazer.
 */
create or replace function private.conexao_da_organizacao(target_organization uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  quantas integer;
  escolhida uuid;
begin
  select count(*), min(connection.id) into quantas, escolhida
  from public.whatsapp_connections connection
  where connection.organization_id = target_organization
    and connection.status <> 'revoked'
    and connection.revoked_at is null;
  if quantas = 0 then
    raise exception 'connection is not available for this organization';
  end if;
  if quantas > 1 then
    raise exception 'organization has more than one connection; choose one';
  end if;
  return escolhida;
end;
$$;

revoke all on function private.conexao_da_organizacao(uuid) from public;

-- ---------------------------------------------------------------- a fila

-- O check reescrito por inteiro, com a lista toda. Mesma disciplina de
-- 20260902200000: a lista mora num lugar só e é reescrita, nunca "acrescentada".
alter table public.connection_runtime_commands
  drop constraint if exists connection_runtime_commands_command_type_check;
alter table public.connection_runtime_commands
  add constraint connection_runtime_commands_command_type_check
  check (command_type in (
    'operator_verification_send', 'handoff_return_to_ai', 'handoff_close',
    'conversation_send', 'conversation_owner', 'conversation_check'
  ));

/*
 * Enfileirar um comando de conversa — agora com três tipos.
 *
 * Reescrita por inteiro porque `create or replace` de função é isso, e porque
 * o corpo dela é o contrato com o runtime, que precisa ser lido de uma vez.
 *
 * A mudança é UMA: `conversation_check` não passa pela guarda de espelho, e é
 * o único que não passa. `conversation_send` e `conversation_owner` continuam
 * exigindo conversa espelhada, palavra por palavra como estavam — quem cria
 * conversa nova é `nucleo_conversation_start`, e não este caminho.
 *
 * O telefone de `conversation_check` é validado aqui e é mais estreito que o
 * `chat` dos outros dois: só dígitos, sem traço. Perguntar "este grupo tem
 * WhatsApp?" não é uma pergunta.
 */
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
      carga := jsonb_build_object('chat', chat, 'kind', conversa.chat_kind, 'text', texto);
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

/*
 * O desfecho de um comando, agora com o resultado junto.
 *
 * `public_result` é a única coisa que muda. Ela existe desde 20260826010000 e o
 * runtime sempre a escreveu; o que não existia era um caminho de volta para a
 * tela. Sem ele, a resposta de `conversation_check` — o `onWhatsApp` que decide
 * se a conversa nasce — morreria no banco.
 *
 * `private_payload` continua fora, e é a diferença que importa: ali mora o
 * texto da mensagem, que a conclusão apaga. `public_result` nasceu para ser
 * lida por quem pediu.
 */
create or replace function public.nucleo_conversation_command_status(
  target_organization uuid,
  target_command uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comando public.connection_runtime_commands%rowtype;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;

  update public.connection_runtime_commands
  set status = 'expired',
      private_payload = '{}'::jsonb,
      error_code = 'expired',
      completed_at = now(),
      updated_at = now()
  where id = target_command
    and organization_id = target_organization
    and command_type in ('conversation_send', 'conversation_owner', 'conversation_check')
    and status in ('pending', 'claimed')
    and expires_at <= now();

  select command.* into comando
  from public.connection_runtime_commands command
  where command.id = target_command
    and command.organization_id = target_organization
    and command.command_type in ('conversation_send', 'conversation_owner', 'conversation_check');
  if not found then
    raise exception 'conversation command not found';
  end if;

  return jsonb_build_object(
    'commandId', comando.id,
    'command', comando.command_type,
    'status', comando.status,
    'errorCode', comando.error_code,
    'result', comando.public_result,
    'completedAt', comando.completed_at
  );
end;
$$;

-- ------------------------------------------------------- iniciar conversa

/*
 * A conversa que o portal cria antes de o aparelho saber dela.
 *
 * Função separada, e não uma condição a mais na `enqueue`, porque é ela a
 * superfície que pode inventar destinatário. Tudo que a Leva 2 protegia
 * continua protegido lá; o que se abre, se abre aqui, e se lê de uma vez.
 *
 * O que segura, em ordem de quanto cada coisa importa:
 *
 *   1. `private.is_org_member` — a mesma régua de responder cliente. Começar
 *      conversa é trabalho de quem atende, e exigir cargo de administrador
 *      transformaria prospecção em privilégio de dono.
 *   2. `^[0-9]{10,15}$` — telefone individual, SEM traço. O check da coluna
 *      aceita traço por causa de grupo antigo; este não aceita, e é assim que
 *      grupo fica de fora sem precisar de uma condição sobre `chat_kind`.
 *   3. O teto por hora. É o que substitui a guarda de espelho: sem ele, o que
 *      se abre aqui é disparo em massa.
 *   4. A conexão precisa ser desta organização e estar viva.
 *
 * O dono nasce `humano`, com quem clicou como atendente. Não é detalhe: uma
 * conversa que uma pessoa abriu de propósito e a IA responde por cima é pior
 * que não poder abrir. O árbitro da VPS continua sendo quem manda em quem
 * atende — por isso a função também ENFILEIRA `conversation_owner`, para ele
 * concordar. O que se escreve aqui é o palpite que a tela mostra enquanto a
 * sincronia não devolve a resposta dele.
 *
 * Não manda mensagem. A conversa abre vazia e a primeira mensagem sai pelo
 * composer, pelo mesmo caminho de qualquer outra — que a esta altura já
 * funciona, porque a linha passou a existir.
 */
create or replace function public.nucleo_conversation_start(
  target_organization uuid,
  target_connection uuid,
  target_phone text,
  contact_name text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  telefone text := pg_catalog.regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g');
  nome text := left(trim(coalesce(contact_name, '')), 120);
  conexao uuid := target_connection;
  iniciadas integer;
  meu_nome text := '';
  ja_existe boolean := false;
  comando jsonb;
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  if telefone !~ '^[0-9]{10,15}$' then
    raise exception 'phone number is invalid';
  end if;

  /*
   * A conexão pode vir nula.
   *
   * Numa conversa que já existe o portal sabe a conexão, porque ela é metade
   * do id da linha. Numa conversa que ainda não existe não há id de onde
   * tirá-la, e obrigar a tela a listar conexões antes de abrir um modal seria
   * uma consulta a mais para responder algo que o banco já sabe. Com mais de
   * uma conexão viva, a escolha volta a ser de quem chama — adivinhar qual
   * WhatsApp da empresa fala com o cliente é decisão de gente.
   */
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

  -- Já falou com a empresa? Então não há nada a criar: iniciar conversa com
  -- quem já tem conversa é ABRIR a dela. Sair daqui antes do teto é de
  -- propósito — reabrir uma conversa existente não gasta cota de conversa nova.
  perform 1
  from public.whatsapp_conversations conversation
  where conversation.organization_id = target_organization
    and conversation.connection_id = conexao
    and conversation.contact_phone = telefone;
  ja_existe := found;

  if not ja_existe then
    /*
     * O teto.
     *
     * Trinta por hora é folgado para uma equipe que prospecta e estreito para
     * quem quisesse usar a caixa de entrada como disparador. Conta só o que o
     * portal semeou (`started_at is not null`): conversa que chegou pelo
     * aparelho nunca entra na conta, senão um dia movimentado fecharia a porta
     * sozinho.
     */
    select count(*) into iniciadas
    from public.whatsapp_conversations conversation
    where conversation.organization_id = target_organization
      and conversation.started_at is not null
      and conversation.started_at > now() - interval '1 hour';
    if iniciadas >= 30 then
      raise exception 'too many conversations started in the last hour';
    end if;

    -- O nome de quem assume sai do perfil, e num `select` separado do `insert`.
    -- Juntá-los faria a linha inteira deixar de ser criada quando o perfil
    -- faltasse, e a falha apareceria três passos adiante, como "conversa não
    -- espelhada" — um erro que não tem nada a ver com o que aconteceu.
    select coalesce(nullif(trim(profile.display_name), ''), profile.full_name, '')
    into meu_nome
    from public.profiles profile
    where profile.id = auth.uid();

    insert into public.whatsapp_conversations (
      connection_id, organization_id, contact_phone, chat_kind, contact_name,
      last_message_preview, last_message_at, last_message_from_me,
      unread_count, owner, attendant_id, attendant_name,
      started_by, started_at, updated_at
    ) values (
      conexao, target_organization, telefone, 'direto', nome,
      '', now(), false, 0, 'humano', auth.uid(), left(coalesce(meu_nome, ''), 120),
      auth.uid(), now(), now()
    )
    -- Uma corrida entre duas abas da mesma pessoa não deve levantar erro: as
    -- duas queriam a mesma conversa, e ela agora existe.
    on conflict (connection_id, contact_phone) do nothing;
  end if;

  -- O árbitro da VPS é quem manda em quem atende. O que ficou na linha acima é
  -- o palpite da tela; isto aqui é o pedido, e a sincronia devolve a resposta.
  comando := public.nucleo_conversation_command_enqueue(
    target_organization,
    conexao,
    telefone,
    'conversation_owner',
    jsonb_build_object(
      'owner', 'humano',
      'attendantId', auth.uid()::text,
      'clientId', extensions.gen_random_uuid()::text
    )
  );

  return jsonb_build_object(
    'connectionId', conexao,
    'chat', telefone,
    'created', not ja_existe,
    'commandId', comando ->> 'commandId'
  );
end;
$$;

revoke all on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.nucleo_conversation_command_status(uuid, uuid) from public;
revoke all on function public.nucleo_conversation_start(uuid, uuid, text, text) from public;
grant execute on function public.nucleo_conversation_command_enqueue(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.nucleo_conversation_command_status(uuid, uuid) to authenticated;
grant execute on function public.nucleo_conversation_start(uuid, uuid, text, text) to authenticated;

/*
 * A prova, na mesma transação.
 *
 * O que se afirma aqui é o que o comentário do cabeçalho promete, e cada linha
 * existe porque a promessa correspondente é fácil de quebrar sem erro visível:
 * uma regex frouxa deixaria grupo entrar, um check não reescrito deixaria o
 * comando novo ser recusado no primeiro uso em produção, e a coluna que o teto
 * conta não existir só apareceria no dia em que alguém tentasse estourá-lo.
 */
do $$
declare
  quantos integer;
begin
  -- O telefone de `nucleo_conversation_start` recusa o que o check da coluna
  -- aceita. É essa diferença que mantém grupo fora sem uma condição extra.
  if '120363402768343021' ~ '^[0-9]{10,15}$' then
    raise exception 'o identificador de grupo novo passa como telefone';
  end if;
  if '556592178164-1600000000' ~ '^[0-9]{10,15}$' then
    raise exception 'o identificador de grupo antigo passa como telefone';
  end if;
  if not ('5565992178164' ~ '^[0-9]{10,15}$') then
    raise exception 'um celular brasileiro não passa como telefone';
  end if;
  if '5565' ~ '^[0-9]{10,15}$' then
    raise exception 'a regex de telefone aceita número curto demais';
  end if;

  -- O check dos tipos precisa conhecer o comando novo. Se o `drop` não tivesse
  -- casado com o nome real, o check antigo sobreviveria e a primeira
  -- verificação em produção morreria com violação de constraint.
  select count(*) into quantos
  from pg_constraint restricao
  join pg_class tabela on tabela.oid = restricao.conrelid
  join pg_namespace esquema on esquema.oid = tabela.relnamespace
  where esquema.nspname = 'public'
    and tabela.relname = 'connection_runtime_commands'
    and restricao.contype = 'c'
    and pg_get_constraintdef(restricao.oid) like '%conversation_check%';
  if quantos <> 1 then
    raise exception 'esperado um check citando conversation_check, encontrado %', quantos;
  end if;

  -- As colunas do teto e da trilha.
  select count(*) into quantos
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'whatsapp_conversations'
    and column_name in ('started_by', 'started_at');
  if quantos <> 2 then
    raise exception 'esperadas as colunas started_by e started_at, encontradas %', quantos;
  end if;

  -- O helper que resolve a conexão quando o chamador não a informa. Sem ele,
  -- uma organização com a caixa de entrada vazia nunca conseguiria começar a
  -- primeira conversa: não haveria linha nenhuma de onde a tela lesse a
  -- conexão, e as duas RPCs recusariam por conexão ausente.
  select count(*) into quantos
  from pg_proc funcao
  join pg_namespace esquema on esquema.oid = funcao.pronamespace
  where esquema.nspname = 'private'
    and funcao.proname = 'conexao_da_organizacao';
  if quantos <> 1 then
    raise exception 'private.conexao_da_organizacao não foi instalada';
  end if;
end;
$$;

commit;
