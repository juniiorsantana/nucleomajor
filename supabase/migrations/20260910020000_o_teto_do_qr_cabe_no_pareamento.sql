begin;

/*
 * O teto do pareamento passa a caber num pareamento.
 *
 * O que aconteceu em 10/09/2026, meia hora depois de a frente do QR entrar no
 * ar: a tela de Conexões atualiza a cada 2,5 segundos — cadência certa para
 * manter o cartão vivo — e a leitura do QR pegou carona nesse laço. Cada volta
 * virou um comando na fila: 24 por minuto, 1.440 por hora, contra um teto de
 * 400 dimensionado para "algumas leituras por pareamento". Em dezessete
 * minutos o teto fechou, e quem estava com o celular na mão levou
 * `too many pairing reads in the last hour` no lugar do QR.
 *
 * A cadência da tela é corrigida no portal, e é lá que estava o erro de fato.
 * Esta migration conserta a outra metade, que é de desenho:
 *
 *   1. A JANELA ENCURTA. Um teto por hora transforma um engano de trinta
 *      segundos numa hora sem poder conectar. Contar em minutos faz o sistema
 *      se recuperar sozinho enquanto a pessoa ainda está na frente da tela.
 *   2. O TETO PASSA A SER DIMENSIONADO PELO USO REAL. Com a leitura a cada 15
 *      segundos, um pareamento inteiro (~2 minutos) gasta 8 leituras. Sessenta
 *      em cinco minutos deixa margem para várias tentativas seguidas e continua
 *      barrando laço desgovernado, que é o que um teto deve barrar.
 *
 * O que NÃO muda, e é bom deixar dito: as duas guardas que protegem a
 * credencial continuam iguais — cargo de `owner`/`admin` para pedir e para ler,
 * e validade em segundos. Teto é proteção contra desperdício, não contra
 * acesso indevido; quem faz o segundo trabalho é a guarda de papel.
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
  janela interval;
  teto integer;
  recentes integer;
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
    -- Abrir pareamento é clique de gente. Dez em dez minutos é folgado para
    -- quem tenta de novo, e a janela curta devolve a permissão antes de a
    -- pessoa desistir.
    janela := interval '10 minutes';
    teto := 10;
    -- Sessenta segundos. Uma abertura parada na fila além disso não serve: o
    -- código que ela produziria já teria girado.
    validade := interval '1 minute';
  else
    -- Leitura acompanha o código, que gira a cada ~20s e vive ~2 minutos. A
    -- tela lê a cada 15 segundos: 8 leituras por pareamento.
    janela := interval '5 minutes';
    teto := 60;
    -- Trinta segundos. Uma leitura mais velha responderia com um código que
    -- já não vale.
    validade := interval '30 seconds';
  end if;

  select count(*) into recentes
  from public.connection_runtime_commands command
  where command.organization_id = target_organization
    and command.command_type = passo
    and command.created_at > now() - janela;
  if recentes >= teto then
    -- A frase diz o passo e o tempo, porque "tente de novo" sem prazo faz a
    -- pessoa recarregar a tela por uma hora sem saber que não adianta.
    raise exception 'too many pairing requests: % in the last %', recentes, janela;
  end if;

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
   * devolver o resultado guardado entregaria à tela um QR que já expirou.
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

grant execute on function public.nucleo_connection_pair_request(uuid, uuid, text, jsonb) to authenticated;

/*
 * A prova, na mesma transação.
 *
 * O que se afirma aqui é o que o incidente ensinou: o teto tem que caber num
 * pareamento, e a guarda de papel não pode ter sido perdida na reescrita.
 */
do $$
declare
  corpo text;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_connection_pair_request';

  if corpo is null then
    raise exception 'a RPC de pareamento sumiu';
  end if;
  if corpo not like '%org_role%' or corpo not like '%admin%' then
    raise exception 'a reescrita perdeu a guarda de cargo';
  end if;
  if corpo like '%interval ''1 hour''%' then
    raise exception 'a janela de uma hora voltou: um engano de 30s tranca por 60 min';
  end if;
  if corpo not like '%interval ''5 minutes''%' or corpo not like '%interval ''10 minutes''%' then
    raise exception 'as janelas curtas nao estao na funcao';
  end if;
  if corpo not like '%interval ''30 seconds''%' or corpo not like '%interval ''1 minute''%' then
    raise exception 'a validade curta dos comandos se perdeu';
  end if;
end;
$$;

commit;
