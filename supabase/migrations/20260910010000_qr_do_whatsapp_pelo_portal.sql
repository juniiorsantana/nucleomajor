begin;

/*
 * O QR do WhatsApp passa a caber no portal.
 *
 * O QR já existe: o bridge o gera e já o devolve como PNG em
 * `GET /api/internal/v1/pairing/qr`. O que não existe é rota — aquela porta
 * escuta só em loopback na VPS, e o portal fala com o Supabase, não com a VPS.
 * Esta migration abre o correio que faltava, na fila que já existe.
 *
 * Duas decisões que valem mais que o código:
 *
 * 1. FUNÇÃO SEPARADA, e não mais um tipo dentro de
 *    `nucleo_conversation_command_enqueue`. Aquela função é a superfície que
 *    pode escolher destinatário, e a guarda dela é `is_org_member`. Pedir QR
 *    exige `owner`/`admin`, que é outra régua. Duas réguas dentro da mesma
 *    função é exatamente como uma delas afrouxa sem ninguém ver. Mesmo
 *    raciocínio que separou `nucleo_conversation_start` em 20260908120000.
 *
 * 2. O QR É UMA CREDENCIAL. Quem escaneia vincula um aparelho à conta e passa
 *    a ler tudo. Por isso: só dono/admin pede E só dono/admin lê o resultado;
 *    a validade é de segundos, não de minutos; e a imagem é apagada da linha
 *    assim que a janela dela passa — não fica QR guardado em tabela.
 */

-- ------------------------------------------------------------------ a lista

-- O check reescrito por inteiro, com a lista toda. Mesma disciplina de
-- 20260902200000 e 20260908120000: a lista mora num lugar só e é reescrita,
-- nunca "acrescentada".
alter table public.connection_runtime_commands
  drop constraint if exists connection_runtime_commands_command_type_check;
alter table public.connection_runtime_commands
  add constraint connection_runtime_commands_command_type_check
  check (command_type in (
    'operator_verification_send', 'handoff_return_to_ai', 'handoff_close',
    'conversation_send', 'conversation_owner', 'conversation_check',
    'connection_pair_start', 'connection_pair_qr'
  ));

-- --------------------------------------------------------------- pedir o QR

/*
 * Pedir pareamento, em dois passos.
 *
 * `connection_pair_start` abre a janela de pareamento no bridge. É o passo
 * sensível: ele só é aceito quando NÃO há sessão — o bridge recusa com
 * `session_exists` sobre uma conta que está funcionando, e essa recusa é uma
 * barreira de segurança, não um erro chato.
 *
 * `connection_pair_qr` só lê o código atual. O whatsmeow troca o código a cada
 * ~20 segundos e fecha a janela em ~2 minutos, então a tela pergunta várias
 * vezes durante um único pareamento. É por isso que os dois passos têm tetos
 * diferentes: contar as leituras junto com as aberturas fecharia a porta no
 * meio da primeira tentativa de quem está com o celular na mão.
 */
create or replace function public.nucleo_connection_pair_request(
  target_organization uuid,
  target_connection uuid,
  requested_step text,
  command_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  passo text := lower(trim(coalesce(requested_step, '')));
  conexao uuid := target_connection;
  cliente text := trim(coalesce(command_payload ->> 'clientId', ''));
  validade interval;
  aberturas integer;
  leituras integer;
  chave text;
  comando_id uuid;
begin
  -- Ser da organização não basta. Parear é entregar a conta a um aparelho.
  if auth.uid() is null or private.org_role(target_organization) not in ('owner', 'admin') then
    raise exception 'organization admin required';
  end if;

  if passo not in ('connection_pair_start', 'connection_pair_qr') then
    raise exception 'pairing step is invalid';
  end if;

  if cliente !~ '^[0-9a-fA-F-]{8,64}$' then
    raise exception 'pairing request needs a client id';
  end if;

  -- A conexão pode vir nula: a organização com uma conexão só não precisa
  -- escolher. Vindo preenchida, ela tem que ser desta organização e estar
  -- viva — senão uma organização abriria pareamento na conta de outra.
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

  if passo = 'connection_pair_start' then
    /*
     * Dez aberturas por hora. Quem está parado na frente da tela lendo um QR
     * tenta duas, três vezes; dez é folgado para isso e estreito para um laço
     * que tivesse escapado.
     */
    select count(*) into aberturas
    from public.connection_runtime_commands command
    where command.organization_id = target_organization
      and command.command_type = 'connection_pair_start'
      and command.created_at > now() - interval '1 hour';
    if aberturas >= 10 then
      raise exception 'too many pairing attempts in the last hour';
    end if;
    -- Sessenta segundos. Uma abertura que ficou parada na fila além disso não
    -- serve mais: o código que ela produziria já teria girado.
    validade := interval '1 minute';
  else
    -- As leituras acompanham o código que gira. O teto aqui existe só para
    -- barrar laço desgovernado, e não para limitar quem está pareando.
    select count(*) into leituras
    from public.connection_runtime_commands command
    where command.organization_id = target_organization
      and command.command_type = 'connection_pair_qr'
      and command.created_at > now() - interval '1 hour';
    if leituras >= 400 then
      raise exception 'too many pairing reads in the last hour';
    end if;
    -- Trinta segundos. Uma leitura mais velha que isso responderia com um
    -- código que já não vale.
    validade := interval '30 seconds';
  end if;

  -- Nada sensível trafega na ida: os dois passos são ordens sem argumento.
  -- O que é sensível volta, e volta em `public_result`.
  chave := encode(
    extensions.digest(
      concat_ws(':', 'connection-pair', passo, conexao::text, cliente),
      'sha256'
    ),
    'hex'
  );

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload,
    created_by, idempotency_key, expires_at
  ) values (
    target_organization, conexao, passo, '{}'::jsonb,
    auth.uid(), chave, now() + validade
  )
  /*
   * Um `clientId` repetido volta a perguntar, em vez de devolver a resposta
   * velha. É o contrário do que a fila de conversas faz, e de propósito: lá,
   * repetir um clique mandaria a mesma mensagem duas vezes ao cliente; aqui,
   * devolver o resultado guardado entregaria à tela um QR que já expirou —
   * e a tela ficaria mostrando para sempre um código que não funciona.
   */
  on conflict (organization_id, idempotency_key) do update
    set available_at = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then now()
          else connection_runtime_commands.available_at end,
        expires_at = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then now() + validade
          else connection_runtime_commands.expires_at end,
        status = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then 'pending'
          else connection_runtime_commands.status end,
        error_code = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then null
          else connection_runtime_commands.error_code end,
        public_result = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then '{}'::jsonb
          else connection_runtime_commands.public_result end,
        attempts = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then 0
          else connection_runtime_commands.attempts end,
        claimed_by = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then null
          else connection_runtime_commands.claimed_by end,
        claimed_instance = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then null
          else connection_runtime_commands.claimed_instance end,
        claimed_at = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then null
          else connection_runtime_commands.claimed_at end,
        completed_at = case
          when connection_runtime_commands.status in ('completed', 'failed', 'expired') then null
          else connection_runtime_commands.completed_at end,
        updated_at = now()
  returning id into comando_id;

  return jsonb_build_object(
    'commandId', comando_id,
    'command', passo,
    'status', 'pending'
  );
end;
$$;

-- ------------------------------------------------------------- ler o desfecho

/*
 * O desfecho do pareamento — e a única porta por onde a imagem do QR sai.
 *
 * Três coisas que esta função faz e a irmã das conversas não faz:
 *
 *   1. Exige `owner`/`admin` para LER, não só para pedir. Uma função de status
 *      que devolvesse a imagem a qualquer membro tornaria a guarda da outra
 *      função decorativa.
 *   2. Varre e apaga imagem vencida da organização a cada consulta. Um QR
 *      guardado numa linha é uma chave esquecida na porta, e a tela pode parar
 *      de perguntar a qualquer momento — fechando o navegador, por exemplo.
 *   3. Não devolve nada de comando vencido: o `expired` volta sem resultado.
 */
create or replace function public.nucleo_connection_pair_status(
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
  if auth.uid() is null or private.org_role(target_organization) not in ('owner', 'admin') then
    raise exception 'organization admin required';
  end if;

  -- Nenhuma imagem sobrevive à janela em que valia. Dois minutos é a vida
  -- inteira de um pareamento no whatsmeow.
  update public.connection_runtime_commands
  set public_result = '{}'::jsonb,
      updated_at = now()
  where organization_id = target_organization
    and command_type in ('connection_pair_start', 'connection_pair_qr')
    and public_result <> '{}'::jsonb
    and updated_at < now() - interval '2 minutes';

  update public.connection_runtime_commands
  set status = 'expired',
      private_payload = '{}'::jsonb,
      public_result = '{}'::jsonb,
      error_code = 'expired',
      completed_at = now(),
      updated_at = now()
  where id = target_command
    and organization_id = target_organization
    and command_type in ('connection_pair_start', 'connection_pair_qr')
    and status in ('pending', 'claimed')
    and expires_at <= now();

  select command.* into comando
  from public.connection_runtime_commands command
  where command.id = target_command
    and command.organization_id = target_organization
    and command.command_type in ('connection_pair_start', 'connection_pair_qr');
  if not found then
    raise exception 'pairing command not found';
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

grant execute on function public.nucleo_connection_pair_request(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.nucleo_connection_pair_status(uuid, uuid) to authenticated;

/*
 * A prova, na mesma transação.
 *
 * Cada linha existe porque a promessa correspondente é fácil de quebrar sem
 * erro visível: um check não reescrito recusaria o comando novo só no primeiro
 * uso em produção, e uma guarda de papel trocada por guarda de membro só
 * apareceria no dia em que alguém de fora pedisse o QR.
 */
do $$
declare
  definicao text;
  corpo text;
  quantos integer;
begin
  select pg_get_constraintdef(oid) into definicao
  from pg_constraint
  where conrelid = 'public.connection_runtime_commands'::regclass
    and conname = 'connection_runtime_commands_command_type_check';

  if definicao is null then
    raise exception 'o check de command_type nao existe';
  end if;
  if definicao not like '%connection_pair_start%' or definicao not like '%connection_pair_qr%' then
    raise exception 'o check nao aceita os comandos de pareamento: %', definicao;
  end if;
  -- A lista foi reescrita inteira, e não substituída: os seis tipos antigos
  -- continuam lá. Perder um deles calaria a fila de conversas.
  if definicao not like '%conversation_send%'
    or definicao not like '%conversation_owner%'
    or definicao not like '%conversation_check%'
    or definicao not like '%operator_verification_send%'
    or definicao not like '%handoff_return_to_ai%'
    or definicao not like '%handoff_close%' then
    raise exception 'a lista de command_type perdeu um tipo antigo: %', definicao;
  end if;

  select count(*) into quantos
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('nucleo_connection_pair_request', 'nucleo_connection_pair_status');
  if quantos <> 2 then
    raise exception 'esperadas as duas RPCs de pareamento, encontradas %', quantos;
  end if;

  -- As duas exigem cargo, e não apenas participação. É a diferença entre
  -- "trabalha aqui" e "pode entregar a conta a um aparelho".
  for corpo in
    select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('nucleo_connection_pair_request', 'nucleo_connection_pair_status')
  loop
    if corpo not like '%org_role%' or corpo not like '%admin%' then
      raise exception 'uma RPC de pareamento nao exige cargo de administrador';
    end if;
  end loop;
end;
$$;

commit;
