-- A faxina do gatilho nao pode travar a escrita que a disparou.
--
-- Defeito medido em 11/09/2026, com numero: entre 08 e 10/09 o runtime levou
-- 2.828 recusas na sincronia de conversas (414 + 1413 + 1001) e dezenas por dia
-- na reserva de comandos. Todas apareciam no log como a mesma frase sem causa,
-- "Supabase recusou X" -- ate o runtime passar a registrar o status HTTP. A
-- primeira recusa depois disso disse o que era:
--
--     Supabase recusou reserva de comandos do runtime (HTTP 500, codigo 40P01)
--
-- `40P01` e `deadlock_detected`. Nao era limite de taxa, nao era permissao, nao
-- era o Supabase fora do ar: era o banco matando uma das duas transacoes.
--
-- ## Onde elas se encontravam
--
-- Nove gatilhos `for each row` desembocam em `public.portal_realtime_events` --
-- conexoes, credenciais de robo, operadores, verificacoes, status do runtime,
-- comandos do runtime, contatos do piloto, pedidos de handoff e CONVERSAS. E
-- cada disparo de cada um deles rodava, dentro da transacao de quem escreveu:
--
--     delete from public.portal_realtime_events
--     where created_at < now() - interval '7 days';
--
-- Sem teto, sem ordem declarada e -- o que importa -- ESPERANDO. Um delete sem
-- `skip locked` fica na fila por linha que outra transacao ja travou.
--
-- O gatilho e por LINHA, entao um `update` de N linhas roda a faxina N vezes,
-- intercalada com os locks da tabela de origem. Duas escritas simultaneas
-- quaisquer -- a sincronia de conversas do runtime a cada 15s e a reserva de
-- comandos, por exemplo -- pegavam as linhas velhas e as linhas de origem em
-- ordens intercaladas. Isso fecha ciclo, e ciclo e deadlock. Explica tambem o
-- formato do estrago: intermitente (~20-25%), nunca queda total, espalhado por
-- RPCs que nao tem nada a ver uma com a outra. Deadlock e assim -- quem perde a
-- corrida morre, quem ganha passa.
--
-- ## O que muda
--
-- A faxina continua fazendo o mesmo e apagando o mesmo. Muda o que ela aceita
-- esperar:
--
-- * `for update skip locked` -- linha travada agora e PULADA. Uma transacao que
--   nunca espera nao pode entrar num ciclo de espera. Essa e a garantia inteira;
--   a ordem e cinto e suspensorio.
-- * `limit` -- a faxina deixa de poder segurar a transacao de quem escreveu por
--   tempo indeterminado.
--
-- Linha velha que estiver travada neste instante fica para o proximo evento.
-- Faxina e manutencao, nao tem hora marcada, e a tabela e explicitamente um
-- sinal efemero -- nao ha nada a preservar num intervalo de segundos.
--
-- O mesmo tratamento vai para a varredura de expiracao de
-- `public.nucleo_runtime_commands_claim`, que tem o mesmo formato de defeito:
-- um `update` sem teto e sem `skip locked` no caminho quente, chamado em laco
-- pelo runtime. Ali a espera e sobre as proprias linhas de comando.
--
-- Nao muda: o que o gatilho insere, a janela de 7 dias, a ordem FIFO da
-- entrega de comandos, o teto de tentativas, a assinatura das funcoes, o
-- SECURITY DEFINER, o search_path e o ACL.

begin;

-- ---------------------------------------------------------------------------
-- 1/4. Conferir o que esta vivo antes de reescrever
-- ---------------------------------------------------------------------------
do $$
declare
  corpo_gatilho text;
  corpo_claim text;
begin
  select pg_get_functiondef(p.oid) into corpo_gatilho
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'portal_realtime_notify';

  if corpo_gatilho is null then
    raise exception 'ABORTADA: private.portal_realtime_notify nao existe neste banco';
  end if;

  if corpo_gatilho like '%skip locked%' then
    raise exception 'ABORTADA: a faxina do gatilho ja foi consertada; esta migration ja esta aplicada';
  end if;

  if corpo_gatilho not like '%delete from public.portal_realtime_events%' then
    raise exception 'ABORTADA: o corpo vivo do gatilho nao tem a faxina que esta migration espera consertar';
  end if;

  select pg_get_functiondef(p.oid) into corpo_claim
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim';

  if corpo_claim is null then
    raise exception 'ABORTADA: public.nucleo_runtime_commands_claim nao existe neste banco';
  end if;

  -- A varredura de expiracao vive ANTES do `with selected`, que ja usa
  -- `skip locked`. Por isso a conferencia e pelo texto da varredura, e nao pela
  -- ausencia de `skip locked` na funcao inteira.
  if corpo_claim not like '%status = ''expired''%' then
    raise exception 'ABORTADA: a varredura de expiracao da reserva de comandos nao esta onde esta migration espera';
  end if;
end $$;

-- O ACL das duas funcoes e capturado antes para ser conferido depois. CREATE OR
-- REPLACE preserva dono e privilegios, mas isso e promessa do Postgres, e a
-- divida de menor privilegio deste projeto e velha o bastante para nao se
-- conferir sozinha.
create temporary table _faxina_acl_antes on commit drop as
select p.oid, p.proname, p.proacl, p.proowner, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'private' and p.proname = 'portal_realtime_notify')
   or (n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim');

-- ---------------------------------------------------------------------------
-- 2/4. O gatilho de realtime -- a faxina deixa de esperar
-- ---------------------------------------------------------------------------
create or replace function private.portal_realtime_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      old.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(old)->>'id', '')::uuid,
        nullif(to_jsonb(old)->>'connection_id', '')::uuid
      )
    );
  else
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      new.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(new)->>'id', '')::uuid,
        nullif(to_jsonb(new)->>'connection_id', '')::uuid
      )
    );
  end if;

  -- A tabela e um sinal efemero, nao historico de auditoria.
  --
  -- E a limpeza dela nao pode derrubar quem escreveu: `skip locked` faz esta
  -- transacao nunca esperar por linha velha que outra ja tenha em maos, e o
  -- teto impede que uma faxina atrasada segure a escrita de quem a disparou.
  -- O que sobrar sai no proximo evento -- e ha um evento a cada escrita.
  delete from public.portal_realtime_events evento
  using (
    select velho.id
    from public.portal_realtime_events velho
    where velho.created_at < now() - interval '7 days'
    order by velho.created_at, velho.id
    for update skip locked
    limit 200
  ) alvo
  where evento.id = alvo.id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3/4. A reserva de comandos -- a expiracao deixa de esperar
-- ---------------------------------------------------------------------------
-- Identica a vigente, exceto pela varredura de expiracao. Reescrita inteira
-- porque CREATE OR REPLACE nao tem meio-termo.
create or replace function public.nucleo_runtime_commands_claim(
  max_items integer default 10,
  runtime_instance uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  safe_limit integer := greatest(1, least(coalesce(max_items, 10), 20));
  claimed_commands jsonb;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
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

  -- Expirar o que venceu, sem esperar por ninguem.
  --
  -- Antes era um `update` direto, sem teto e sem `skip locked`, no caminho que
  -- o runtime chama em laco. Comando travado agora e pulado e expira na
  -- proxima chamada; ninguem o entrega nesse meio-tempo, porque a selecao
  -- abaixo ja exige `expires_at > now()`.
  with vencidos as (
    select command.id
    from public.connection_runtime_commands command
    where command.organization_id = robot_org
      and command.connection_id = robot_connection
      and command.status in ('pending', 'claimed')
      and command.expires_at <= now()
    order by command.created_at, command.id
    for update skip locked
    limit 100
  )
  update public.connection_runtime_commands command
  set status = 'expired',
      private_payload = '{}'::jsonb,
      error_code = 'expired',
      completed_at = now(),
      updated_at = now()
  from vencidos
  where command.id = vencidos.id;

  with selected as (
    select command.id
    from public.connection_runtime_commands command
    where command.organization_id = robot_org
      and command.connection_id = robot_connection
      and command.status = 'pending'
      and command.available_at <= now()
      and command.expires_at > now()
      and command.attempts < 3
    order by command.created_at
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.connection_runtime_commands command
    set status = 'claimed',
        claimed_by = auth.uid(),
        claimed_instance = runtime_instance,
        claimed_at = now(),
        attempts = command.attempts + 1,
        updated_at = now()
    from selected
    where command.id = selected.id
    returning command.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'commandId', claimed.id,
    'organizationId', claimed.organization_id,
    'connectionId', claimed.connection_id,
    'commandType', claimed.command_type,
    'payload', claimed.private_payload,
    'expiresAt', claimed.expires_at
  ) order by claimed.created_at), '[]'::jsonb)
  into claimed_commands
  from claimed;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid()
    and organization_id = robot_org
    and connection_id = robot_connection
    and status = 'active';

  return jsonb_build_object('commands', claimed_commands);
end;
$$;

revoke all on function public.nucleo_runtime_commands_claim(integer, uuid) from public;
grant execute on function public.nucleo_runtime_commands_claim(integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4/4. A migration confere a si mesma
-- ---------------------------------------------------------------------------
do $$
declare
  corpo_gatilho text;
  corpo_claim text;
  varredura text;
begin
  select pg_get_functiondef(p.oid) into corpo_gatilho
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'portal_realtime_notify';

  -- A garantia inteira: a faxina nao espera e nao e ilimitada.
  if corpo_gatilho not like '%for update skip locked%' then
    raise exception 'FALHOU: a faxina do gatilho voltou a poder esperar';
  end if;
  if corpo_gatilho not like '%limit 200%' then
    raise exception 'FALHOU: a faxina do gatilho ficou sem teto';
  end if;

  -- E continua sendo a mesma faxina: mesma janela, mesma tabela.
  if corpo_gatilho not like '%interval ''7 days''%' then
    raise exception 'FALHOU: a janela de retencao de 7 dias mudou';
  end if;

  -- O sinal em si nao mudou -- os dois ramos continuam inserindo.
  if (length(corpo_gatilho) - length(replace(corpo_gatilho, 'insert into public.portal_realtime_events', ''))) / length('insert into public.portal_realtime_events') <> 2 then
    raise exception 'FALHOU: o gatilho deixou de inserir nos dois ramos (INSERT/UPDATE e DELETE)';
  end if;

  select pg_get_functiondef(p.oid) into corpo_claim
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim';

  -- A varredura de expiracao: do inicio do CTE ate o `update` que ela alimenta.
  varredura := substring(corpo_claim from 'with vencidos as.*?from vencidos');
  if varredura is null then
    raise exception 'FALHOU: a varredura de expiracao nao ficou no formato esperado';
  end if;
  if varredura not like '%for update skip locked%' then
    raise exception 'FALHOU: a varredura de expiracao voltou a poder esperar';
  end if;
  if varredura not like '%limit 100%' then
    raise exception 'FALHOU: a varredura de expiracao ficou sem teto';
  end if;

  -- E a entrega nao mudou: FIFO, com o mesmo teto de tentativas e o mesmo
  -- recorte de disponibilidade.
  if corpo_claim not like '%order by command.created_at%' then
    raise exception 'FALHOU: a entrega de comandos deixou de ser FIFO';
  end if;
  if corpo_claim not like '%command.attempts < 3%' then
    raise exception 'FALHOU: o teto de tentativas da entrega mudou';
  end if;
  if corpo_claim not like '%command.expires_at > now()%' then
    raise exception 'FALHOU: a entrega deixou de excluir comando vencido';
  end if;
  if corpo_claim not like '%least(coalesce(max_items, 10), 20)%' then
    raise exception 'FALHOU: o teto de itens por chamada mudou';
  end if;

  -- SECURITY DEFINER e search_path continuam como estavam, nas duas.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where ((n.nspname = 'private' and p.proname = 'portal_realtime_notify')
        or (n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim'))
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%SET search_path TO ''''%'
    having count(*) = 2
  ) then
    raise exception 'FALHOU: SECURITY DEFINER ou search_path mudou em alguma das duas funcoes';
  end if;

  -- E o ACL, o dono e as flags sao os mesmos de antes do CREATE OR REPLACE.
  if (
    select count(*)
    from _faxina_acl_antes antes
    join pg_proc p on p.oid = antes.oid
    where p.proowner = antes.proowner
      and p.proacl is not distinct from antes.proacl
      and p.prosecdef = antes.prosecdef
      and p.proconfig is not distinct from antes.proconfig
  ) <> (select count(*) from _faxina_acl_antes) then
    raise exception 'FALHOU: dono, ACL ou configuracao mudou em alguma das duas funcoes';
  end if;
end $$;

commit;
