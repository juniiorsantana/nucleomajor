-- A troca voluntária de WhatsApp pelo portal: desconectar, e conectar outro
-- número na MESMA conexão.
--
-- Pedido do dono (ORCH-014/015/016, 10/10/2026). O administrador desconecta o
-- WhatsApp por escolha própria, a conexão fica sem sessão e outro número é
-- conectado nela. A conexão continua a mesma: connection_id, organização,
-- conversas, contatos e credencial do robô. Nada aqui provisiona conexão nova
-- nem apaga mensagem.
--
-- QUEM PODE: uma liberação por conexão (private.connection_change_policies),
-- gravada só pelo SQL Editor. Sem liberação, ninguém (falha fechada).
--
--   'direct'         A operação controlada da Major (ORCH-016). Sem código
--                    extra: a confirmação é a segunda etapa explícita, feita
--                    pela mesma pessoa em até 10 minutos. O servidor exige
--                    liberação com prazo (no máximo 7 dias) E quem pede ser
--                    administrador da plataforma E dono ou administrador da
--                    empresa. Nunca vale como padrão para todos.
--   'whatsapp_code'  O desenho da liberação geral (D2, ainda pendente): um
--                    código vai para o WhatsApp ANTIGO, na conversa "você
--                    mesmo", pelo Bridge da conexão; o banco guarda só o hash.
--                    O transporte desse código no runtime AINDA NÃO EXISTE:
--                    sem ele o código não chega e nada é confirmado.
--
-- O CAMINHO:
--   1. start: abre o pedido (desconectar, ou trocar para um número novo). Exige
--      a VPS respondendo e o WhatsApp conectado, ou a sessão já liberada por
--      um pedido anterior (desconectou e agora conecta outro número).
--   2. confirm: quem pediu confirma (com o código, no modo 'whatsapp_code').
--      A geração da conexão sobe e a ação vai para a fila com ela.
--   3. A VPS aplica e conclui o comando. O gatilho da fila marca o pedido
--      'applied' e, na troca, fecha o período de identidade antigo, abre o
--      novo e atualiza o número esperado, na MESMA transação da conclusão.
--      Antes disso a tela mostra "aguardando a VPS", nunca sucesso.
--   4. A geração ordena: o Bridge recusa comando com geração menor que a já
--      aplicada e trata a mesma geração como repetição.
--
-- Fora daqui, de propósito: avisos de queda (outra frente), pausa automática
-- de automações (D3) e e-mail (D4). O ponto de integração com o aviso de
-- queda está no fim deste arquivo.

begin;

do $$
begin
  if to_regclass('public.connection_runtime_commands') is null
     or to_regclass('public.connection_runtime_status') is null
     or to_regprocedure('private.can_manage_org(uuid)') is null
     or to_regprocedure('private.is_robot()') is null
     or to_regprocedure('private.is_notification_worker()') is null
     or to_regprocedure('private.is_platform_admin()') is null
     or to_regprocedure('private.org_access_state(uuid)') is null
     or to_regprocedure('private.platform_audit(uuid,text,text,jsonb,jsonb,text)') is null then
    raise exception 'abortado: faltam a fila de comandos, o status do runtime, o historico da plataforma ou as funcoes de permissao';
  end if;
  if to_regclass('public.whatsapp_connection_change_requests') is not null then
    raise exception 'abortado: whatsapp_connection_change_requests ja existe; esta migration ja foi aplicada';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1/9. A liberação, por conexão. Só o SQL Editor grava.
-- ---------------------------------------------------------------------------
create table private.connection_change_policies (
  connection_id uuid primary key references public.whatsapp_connections(id) on delete cascade,
  mode text not null check (mode in ('direct', 'whatsapp_code')),
  -- Quem pediu e por quê. Vai para o histórico da plataforma.
  reason text not null check (length(trim(reason)) between 3 and 300),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  check (expires_at is null or expires_at > granted_at),
  -- A troca sem código extra é sempre temporária.
  check (mode <> 'direct' or (expires_at is not null and expires_at <= granted_at + interval '7 days'))
);
alter table private.connection_change_policies enable row level security;
revoke all on private.connection_change_policies from public, anon, authenticated;

-- Toda liberação dada, mudada ou retirada fica no histórico da plataforma.
create or replace function private.connection_change_policy_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha private.connection_change_policies%rowtype;
  organizacao uuid;
begin
  if tg_op = 'DELETE' then
    linha := old;
  else
    linha := new;
  end if;
  select connection.organization_id into organizacao
  from public.whatsapp_connections connection
  where connection.id = linha.connection_id;
  perform private.platform_audit(
    organizacao,
    'whatsapp.change_policy_' || lower(tg_op),
    linha.connection_id::text,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    linha.reason
  );
  return linha;
end;
$$;
revoke all on function private.connection_change_policy_audit() from public, anon, authenticated;

create trigger connection_change_policies_audit
after insert or update or delete on private.connection_change_policies
for each row execute function private.connection_change_policy_audit();

-- O padrão para quem não tem liberação. Hoje: ninguém. A liberação geral
-- (D2) troca isto por 'whatsapp_code' depois de o transporte existir.
create or replace function private.connection_change_default_mode()
returns text
language sql
stable
set search_path = ''
as $$
  select 'off'::text;
$$;
revoke all on function private.connection_change_default_mode() from public, anon, authenticated;

create or replace function private.connection_change_mode(target_connection uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  modo text;
begin
  select policy.mode into modo
  from private.connection_change_policies policy
  where policy.connection_id = target_connection
    and (policy.expires_at is null or policy.expires_at > now());
  if modo is not null then
    return modo;
  end if;
  -- O padrão nunca dispensa a verificação extra: 'direct' só existe por
  -- conexão, com prazo.
  modo := private.connection_change_default_mode();
  if modo = 'whatsapp_code' then
    return modo;
  end if;
  return 'off';
end;
$$;
revoke all on function private.connection_change_mode(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2/9. A geração da conexão, a sessão liberada e o histórico de identidades.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_connections
  add column control_generation bigint not null default 0 check (control_generation >= 0),
  -- Quando a VPS aplicou um pedido voluntário (desconectar ou trocar). Some
  -- quando a conexão volta a 'connected'. É o que distingue "desconectou por
  -- escolha" de "caiu sozinho" para quem quer conectar outro número.
  add column session_released_at timestamptz;

create table public.whatsapp_connection_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  generation bigint not null check (generation >= 0),
  phone_hash text check (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$'),
  phone_last4 text not null check (phone_last4 ~ '^[0-9]{4}$'),
  reason text not null check (reason in ('initial', 'voluntary', 'changed_in_app', 'lost_or_banned')),
  import_history boolean not null default true,
  active_from timestamptz not null default now(),
  active_until timestamptz,
  applied_at timestamptz,
  request_id uuid,
  requested_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (connection_id, generation),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);
create unique index whatsapp_connection_identities_open_idx
  on public.whatsapp_connection_identities (connection_id)
  where active_until is null;

-- O que a conexão já esperava vira o primeiro período (geração 0, aplicado).
insert into public.whatsapp_connection_identities (
  organization_id, connection_id, generation, phone_hash, phone_last4, reason,
  import_history, active_from, applied_at
)
select connection.organization_id, connection.id, 0, connection.expected_phone_hash,
       connection.expected_phone_last4, 'initial', true, connection.created_at, connection.created_at
from public.whatsapp_connections connection
where connection.expected_phone_last4 is not null
  and connection.status <> 'revoked'
  and connection.revoked_at is null;

-- Sem leitura direta: o hash é salgado só pelo id da conexão, e o espaço de
-- telefones é pequeno o bastante para ser revertido por força bruta. A tela
-- lê pela RPC de status (dono e administrador), que devolve só o final.
alter table public.whatsapp_connection_identities enable row level security;
revoke all on public.whatsapp_connection_identities from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3/9. Os pedidos. Só as RPCs leem e escrevem.
-- ---------------------------------------------------------------------------
create table public.whatsapp_connection_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  kind text not null check (kind in ('disconnect', 'change_number')),
  status text not null default 'awaiting_confirmation' check (status in (
    'awaiting_confirmation', 'queued', 'running', 'applied',
    'failed', 'expired', 'cancelled', 'superseded'
  )),
  -- Só o caminho voluntário existe nesta leva. Queda e banimento têm outro
  -- fluxo (recuperação), ainda sem decisão.
  reason text not null default 'voluntary' check (reason = 'voluntary'),
  -- Como foi confirmado, e sob qual liberação: é a trilha da auditoria.
  confirmation_method text not null check (confirmation_method in ('direct', 'whatsapp_code')),
  policy_reason text,
  request_key text not null check (request_key ~ '^[0-9a-fA-F-]{8,64}$'),
  requested_by uuid not null references public.profiles(id),
  old_phone_hash text check (old_phone_hash is null or old_phone_hash ~ '^[0-9a-f]{64}$'),
  old_phone_last4 text check (old_phone_last4 is null or old_phone_last4 ~ '^[0-9]{4}$'),
  new_phone_hash text check (new_phone_hash is null or new_phone_hash ~ '^[0-9a-f]{64}$'),
  new_phone_last4 text check (new_phone_last4 is null or new_phone_last4 ~ '^[0-9]{4}$'),
  import_history boolean not null default false,
  -- A janela para confirmar: 10 minutos, nos dois modos.
  confirm_until timestamptz not null,
  code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  code_attempts integer not null default 0 check (code_attempts between 0 and 5),
  code_sends integer not null default 0 check (code_sends between 0 and 3),
  code_sent_at timestamptz,
  confirmation_command_id uuid,
  confirmed_at timestamptz,
  generation bigint check (generation is null or generation > 0),
  action_command_id uuid,
  applied_at timestamptz,
  -- O WhatsApp aceitou o desligamento do aparelho? Falso: a sessão foi apagada
  -- só na VPS, e o aparelho pode continuar listado no celular antigo.
  remote_logout boolean,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_-]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, requested_by, request_key),
  check ((kind = 'change_number') = (new_phone_hash is not null and new_phone_last4 is not null)),
  check (confirmation_method = 'whatsapp_code' or (code_hash is null and code_sends = 0)),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);
-- Um pedido vivo por conexão.
create unique index whatsapp_connection_change_requests_active_idx
  on public.whatsapp_connection_change_requests (connection_id)
  where status in ('awaiting_confirmation', 'queued', 'running');
create index whatsapp_connection_change_requests_recent_idx
  on public.whatsapp_connection_change_requests (connection_id, created_at desc);

alter table public.whatsapp_connection_change_requests enable row level security;
revoke all on public.whatsapp_connection_change_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4/9. Os três comandos novos na fila (acrescentados ao que já existe).
-- ---------------------------------------------------------------------------
do $$
declare
  tipos text[];
  novo text;
begin
  select array_agg(m[1] order by ord) into tipos
  from pg_constraint c,
       lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') with ordinality as r(m, ord)
  where c.conrelid = 'public.connection_runtime_commands'::regclass
    and c.conname = 'connection_runtime_commands_command_type_check';
  if tipos is null then
    raise exception 'abortado: o check de command_type da fila de comandos nao existe';
  end if;
  foreach novo in array array['connection_confirmation_send', 'connection_logout', 'connection_identity_replace'] loop
    if not (novo = any(tipos)) then
      tipos := tipos || array[novo];
    end if;
  end loop;
  alter table public.connection_runtime_commands drop constraint connection_runtime_commands_command_type_check;
  execute format(
    'alter table public.connection_runtime_commands add constraint connection_runtime_commands_command_type_check check (command_type = any (array[%s]::text[]))',
    (select string_agg(quote_literal(t), ', ' order by ord) from unnest(tipos) with ordinality as u(t, ord)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5/9. Guardas comuns.
-- ---------------------------------------------------------------------------
-- Quem pode mexer: uma pessoa (não robô, não worker de avisos), dono ou
-- administrador, de empresa não bloqueada, numa conexão viva desta empresa.
-- Trava a linha da conexão: os pedidos de uma conexão andam em fila.
create or replace function private.connection_change_guard(target_organization uuid, target_connection uuid)
returns public.whatsapp_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  conexao public.whatsapp_connections%rowtype;
begin
  if private.is_robot() or private.is_notification_worker() then
    raise exception 'runtime credentials cannot change connections';
  end if;
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  if private.org_access_state(target_organization) = 'blocked' then
    raise exception 'subscription is not active';
  end if;
  select * into conexao
  from public.whatsapp_connections connection
  where connection.id = target_connection
    and connection.organization_id = target_organization
    and connection.status <> 'revoked'
    and connection.revoked_at is null
  for update;
  if conexao.id is null then
    raise exception 'connection is not available for this organization';
  end if;
  return conexao;
end;
$$;
revoke all on function private.connection_change_guard(uuid, uuid) from public, anon, authenticated;

-- A liberação que vale agora, para esta pessoa. Com `expected_method`, exige
-- que seja a mesma com que o pedido nasceu: uma liberação que venceu ou mudou
-- no meio do caminho não confirma nem repete nada.
create or replace function private.connection_change_require_mode(target_connection uuid, expected_method text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  modo text := private.connection_change_mode(target_connection);
begin
  if modo = 'off' then
    raise exception 'connection change is not enabled for this connection';
  end if;
  if expected_method is not null and modo <> expected_method then
    raise exception 'connection change policy changed; start again';
  end if;
  -- A operação sem código extra é da equipe da plataforma, não do cliente.
  if modo = 'direct' and not private.is_platform_admin() then
    raise exception 'direct connection change requires a platform administrator';
  end if;
  return modo;
end;
$$;
revoke all on function private.connection_change_require_mode(uuid, text) from public, anon, authenticated;

-- O código: 8 hexadecimais, o mesmo formato da verificação de operadores. O
-- hash é salgado pelo pedido.
create or replace function private.connection_change_code_hash(request_id uuid, code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(request_id::text || ':' || lower(trim(code)), 'sha256'), 'hex');
$$;
revoke all on function private.connection_change_code_hash(uuid, text) from public, anon, authenticated;

-- Modo 'whatsapp_code': gera um código novo, guarda o hash e enfileira o envio
-- para o WhatsApp antigo. O código em claro só existe na carga privada do
-- comando, que a fila apaga ao concluir.
create or replace function private.connection_change_send_code(pedido public.whatsapp_connection_change_requests)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  codigo text := encode(extensions.gen_random_bytes(4), 'hex');
  comando uuid;
begin
  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload,
    created_by, idempotency_key, expires_at
  ) values (
    pedido.organization_id, pedido.connection_id, 'connection_confirmation_send',
    jsonb_build_object(
      'requestId', pedido.id,
      'code', codigo,
      'kind', pedido.kind,
      'newLast4', coalesce(pedido.new_phone_last4, '')
    ),
    auth.uid(),
    encode(extensions.digest(
      concat_ws(':', 'connection-change-code', pedido.id::text, (pedido.code_sends + 1)::text), 'sha256'), 'hex'),
    now() + interval '10 minutes'
  )
  returning id into comando;

  update public.whatsapp_connection_change_requests
  set code_hash = private.connection_change_code_hash(pedido.id, codigo),
      confirm_until = now() + interval '10 minutes',
      code_attempts = 0,
      code_sends = pedido.code_sends + 1,
      code_sent_at = now(),
      confirmation_command_id = comando,
      error_code = null,
      updated_at = now()
  where id = pedido.id;
end;
$$;
revoke all on function private.connection_change_send_code(public.whatsapp_connection_change_requests) from public, anon, authenticated;

-- A ação confirmada vai para a fila com a geração seguinte da conexão.
create or replace function private.connection_change_enqueue_action(
  pedido public.whatsapp_connection_change_requests,
  conexao public.whatsapp_connections
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  geracao bigint := conexao.control_generation + 1;
  comando uuid;
begin
  update public.whatsapp_connections set control_generation = geracao where id = conexao.id;

  insert into public.connection_runtime_commands (
    organization_id, connection_id, command_type, private_payload,
    created_by, idempotency_key, expires_at
  ) values (
    conexao.organization_id, conexao.id,
    case pedido.kind when 'disconnect' then 'connection_logout' else 'connection_identity_replace' end,
    jsonb_build_object(
      'requestId', pedido.id,
      'generation', geracao,
      'kind', pedido.kind,
      'newLast4', coalesce(pedido.new_phone_last4, ''),
      'newPhoneHash', coalesce(pedido.new_phone_hash, ''),
      'previousLast4', coalesce(pedido.old_phone_last4, ''),
      'importHistory', pedido.import_history
    ),
    auth.uid(),
    encode(extensions.digest(concat_ws(':', 'connection-change-action', pedido.id::text, geracao::text), 'sha256'), 'hex'),
    -- A VPS pode estar fora do ar: o pedido espera até um dia.
    now() + interval '24 hours'
  )
  returning id into comando;

  update public.whatsapp_connection_change_requests
  set status = 'queued', code_hash = null, generation = geracao,
      confirmed_at = coalesce(confirmed_at, now()),
      action_command_id = comando, error_code = null, updated_at = now()
  where id = pedido.id;
end;
$$;
revoke all on function private.connection_change_enqueue_action(public.whatsapp_connection_change_requests, public.whatsapp_connections) from public, anon, authenticated;

-- A visão de um pedido para a tela. Nunca o código nem o telefone inteiro.
create or replace function private.connection_change_view(pedido public.whatsapp_connection_change_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requestId', pedido.id,
    'kind', pedido.kind,
    'status', pedido.status,
    'reason', pedido.reason,
    'confirmationMethod', pedido.confirmation_method,
    'oldLast4', pedido.old_phone_last4,
    'newLast4', pedido.new_phone_last4,
    'importHistory', pedido.import_history,
    'mine', pedido.requested_by = auth.uid(),
    'confirmUntil', pedido.confirm_until,
    'attemptsLeft', 5 - pedido.code_attempts,
    'sendsLeft', 3 - pedido.code_sends,
    'confirmedAt', pedido.confirmed_at,
    'generation', pedido.generation,
    'appliedAt', pedido.applied_at,
    'remoteLogout', pedido.remote_logout,
    'errorCode', pedido.error_code,
    'createdAt', pedido.created_at,
    'commandStatus', (select command.status from public.connection_runtime_commands command
                      where command.id = coalesce(pedido.action_command_id, pedido.confirmation_command_id))
  );
$$;
revoke all on function private.connection_change_view(public.whatsapp_connection_change_requests) from public, anon, authenticated;

-- O que vai para o histórico da plataforma: o tipo, o modo e os finais. Nunca
-- código, hash ou telefone inteiro.
create or replace function private.connection_change_audit(
  pedido public.whatsapp_connection_change_requests,
  acao text,
  nota text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.platform_audit(
    pedido.organization_id,
    'whatsapp.change_' || acao,
    pedido.connection_id::text,
    null,
    jsonb_build_object(
      'requestId', pedido.id,
      'kind', pedido.kind,
      'status', pedido.status,
      'confirmationMethod', pedido.confirmation_method,
      'oldLast4', pedido.old_phone_last4,
      'newLast4', pedido.new_phone_last4,
      'generation', pedido.generation,
      'errorCode', pedido.error_code
    ),
    coalesce(nota, '')
  );
$$;
revoke all on function private.connection_change_audit(public.whatsapp_connection_change_requests, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6/9. As RPCs do portal.
-- ---------------------------------------------------------------------------
create or replace function public.nucleo_connection_change_start(
  target_organization uuid,
  target_connection uuid,
  change_kind text,
  new_phone text,
  import_history boolean,
  request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conexao public.whatsapp_connections%rowtype;
  modo text;
  tipo text := lower(trim(coalesce(change_kind, '')));
  chave text := trim(coalesce(request_key, ''));
  digitos text := regexp_replace(coalesce(new_phone, ''), '[^0-9]', '', 'g');
  variante text;
  novo_hash text;
  novo_last4 text;
  runtime public.connection_runtime_status%rowtype;
  existente public.whatsapp_connection_change_requests%rowtype;
  vivo public.whatsapp_connection_change_requests%rowtype;
  pedido public.whatsapp_connection_change_requests%rowtype;
  recentes integer;
begin
  conexao := private.connection_change_guard(target_organization, target_connection);

  if chave !~ '^[0-9a-fA-F-]{8,64}$' then
    raise exception 'change request needs a request key';
  end if;
  -- Duplo clique e repetição: a mesma pessoa com a mesma chave recebe o mesmo
  -- pedido, sem código novo.
  select * into existente
  from public.whatsapp_connection_change_requests change_request
  where change_request.connection_id = conexao.id
    and change_request.requested_by = auth.uid()
    and change_request.request_key = chave;
  if existente.id is not null then
    return private.connection_change_view(existente) || jsonb_build_object('repeated', true);
  end if;

  modo := private.connection_change_require_mode(conexao.id, null);

  if tipo not in ('disconnect', 'change_number') then
    raise exception 'change kind is invalid';
  end if;

  if tipo = 'change_number' then
    if length(digitos) in (10, 11) then
      digitos := '55' || digitos;
    end if;
    if digitos !~ '^[1-9][0-9]{9,14}$' then
      raise exception 'invalid phone';
    end if;
    novo_hash := encode(extensions.digest(conexao.id::text || ':' || digitos, 'sha256'), 'hex');
    novo_last4 := right(digitos, 4);
    -- O mesmo celular com e sem o nono dígito é o mesmo número: o WhatsApp
    -- ainda guarda muitas contas brasileiras sem o 9 (ver lid.go no Bridge).
    variante := case
      when length(digitos) = 13 and left(digitos, 2) = '55' and substr(digitos, 5, 1) = '9'
        then left(digitos, 4) || substr(digitos, 6)
      when length(digitos) = 12 and left(digitos, 2) = '55'
        then left(digitos, 4) || '9' || substr(digitos, 5)
    end;
    -- O mesmo número não é troca: é reconectar.
    if conexao.expected_phone_hash in (
         novo_hash,
         encode(extensions.digest(conexao.id::text || ':' || coalesce(variante, digitos), 'sha256'), 'hex'))
       or (conexao.expected_phone_hash is null and novo_last4 = conexao.expected_phone_last4) then
      raise exception 'same number: reconnect instead of changing';
    end if;
  end if;

  -- A VPS precisa estar respondendo: é ela que aplica.
  select * into runtime from public.connection_runtime_status where connection_id = conexao.id;
  if runtime.connection_id is null or runtime.heartbeat_at <= now() - interval '2 minutes' then
    raise exception 'runtime is not online';
  end if;
  -- Voluntário é com o WhatsApp de pé, ou depois de uma liberação voluntária.
  -- O que caiu sozinho (desvinculado, banido) é outro fluxo, ainda sem
  -- decisão: tratá-lo como escolha do cliente registraria o motivo errado.
  -- O código do modo 'whatsapp_code' só chega com a sessão antiga viva.
  if runtime.whatsapp_status <> 'connected'
     and (modo = 'whatsapp_code' or conexao.session_released_at is null) then
    raise exception 'old whatsapp is not connected';
  end if;

  select count(*) into recentes
  from public.whatsapp_connection_change_requests change_request
  where change_request.connection_id = conexao.id
    and change_request.created_at > now() - interval '1 hour';
  if recentes >= 5 then
    raise exception 'too many change requests in the last hour';
  end if;

  -- Um pedido vivo por conexão. Aguardando confirmação: o novo o substitui (o
  -- código antigo deixa de valer). Já confirmado ou em execução: não.
  select * into vivo
  from public.whatsapp_connection_change_requests change_request
  where change_request.connection_id = conexao.id
    and change_request.status in ('awaiting_confirmation', 'queued', 'running');
  if vivo.id is not null then
    if vivo.status <> 'awaiting_confirmation' then
      raise exception 'a confirmed change is already in progress';
    end if;
    update public.whatsapp_connection_change_requests
    set status = 'superseded', code_hash = null, updated_at = now()
    where id = vivo.id;
    update public.connection_runtime_commands
    set status = 'expired', private_payload = '{}'::jsonb, error_code = 'superseded', updated_at = now()
    where id = vivo.confirmation_command_id and status = 'pending';
  end if;

  insert into public.whatsapp_connection_change_requests (
    organization_id, connection_id, kind, confirmation_method, policy_reason, request_key,
    requested_by, old_phone_hash, old_phone_last4, new_phone_hash, new_phone_last4,
    import_history, confirm_until
  ) values (
    conexao.organization_id, conexao.id, tipo, modo,
    (select policy.reason from private.connection_change_policies policy where policy.connection_id = conexao.id),
    chave, auth.uid(),
    conexao.expected_phone_hash, conexao.expected_phone_last4, novo_hash, novo_last4,
    tipo = 'change_number' and coalesce(nucleo_connection_change_start.import_history, false),
    now() + interval '10 minutes'
  )
  returning * into pedido;

  if modo = 'whatsapp_code' then
    perform private.connection_change_send_code(pedido);
  end if;
  select * into pedido from public.whatsapp_connection_change_requests where id = pedido.id;
  perform private.connection_change_audit(pedido, 'requested', null);
  return private.connection_change_view(pedido) || jsonb_build_object('repeated', false);
end;
$$;

create or replace function public.nucleo_connection_change_resend(
  target_organization uuid,
  target_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pedido public.whatsapp_connection_change_requests%rowtype;
begin
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  if pedido.id is null or pedido.organization_id <> target_organization then
    raise exception 'change request not found';
  end if;
  perform private.connection_change_guard(target_organization, pedido.connection_id);
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request for update;
  if pedido.confirmation_method <> 'whatsapp_code' then
    raise exception 'this change is not confirmed by code';
  end if;
  if pedido.status <> 'awaiting_confirmation' then
    raise exception 'change request is not awaiting confirmation';
  end if;
  if pedido.requested_by <> auth.uid() then
    raise exception 'only the requester can resend the code';
  end if;
  perform private.connection_change_require_mode(pedido.connection_id, pedido.confirmation_method);
  if pedido.code_sends >= 3 then
    raise exception 'code send limit reached';
  end if;
  if pedido.code_sent_at > now() - interval '30 seconds' then
    raise exception 'wait before resending the code';
  end if;
  perform 1
  from public.connection_runtime_status runtime
  where runtime.connection_id = pedido.connection_id
    and runtime.whatsapp_status = 'connected'
    and runtime.heartbeat_at > now() - interval '2 minutes';
  if not found then
    raise exception 'old whatsapp is not connected';
  end if;
  update public.connection_runtime_commands
  set status = 'expired', private_payload = '{}'::jsonb, error_code = 'resent', updated_at = now()
  where id = pedido.confirmation_command_id and status = 'pending';
  perform private.connection_change_send_code(pedido);
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  return private.connection_change_view(pedido);
end;
$$;

create or replace function public.nucleo_connection_change_confirm(
  target_organization uuid,
  target_request uuid,
  confirmation_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pedido public.whatsapp_connection_change_requests%rowtype;
  conexao public.whatsapp_connections%rowtype;
begin
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  if pedido.id is null or pedido.organization_id <> target_organization then
    raise exception 'change request not found';
  end if;
  conexao := private.connection_change_guard(target_organization, pedido.connection_id);
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request for update;

  -- Os desfechos que não confirmam devolvem o motivo em vez de exceção: a
  -- tentativa contada não pode ser desfeita junto com a transação.
  if pedido.status <> 'awaiting_confirmation' then
    return jsonb_build_object('confirmed', false, 'result', 'not-awaiting-confirmation')
      || private.connection_change_view(pedido);
  end if;
  if pedido.requested_by <> auth.uid() then
    raise exception 'only the requester can confirm the change';
  end if;
  perform private.connection_change_require_mode(pedido.connection_id, pedido.confirmation_method);
  if pedido.confirm_until <= now()
     or (pedido.confirmation_method = 'whatsapp_code' and pedido.code_hash is null) then
    return jsonb_build_object('confirmed', false, 'result', 'expired')
      || private.connection_change_view(pedido);
  end if;
  if pedido.confirmation_method = 'whatsapp_code' and pedido.code_attempts >= 5 then
    return jsonb_build_object('confirmed', false, 'result', 'too-many-attempts')
      || private.connection_change_view(pedido);
  end if;
  -- A identidade antiga não pode ter mudado desde o pedido.
  if conexao.expected_phone_hash is distinct from pedido.old_phone_hash
     or conexao.expected_phone_last4 is distinct from pedido.old_phone_last4 then
    update public.whatsapp_connection_change_requests
    set status = 'cancelled', code_hash = null, error_code = 'identity-changed', updated_at = now()
    where id = pedido.id;
    return jsonb_build_object('confirmed', false, 'result', 'identity-changed');
  end if;
  if pedido.confirmation_method = 'whatsapp_code' and (
       coalesce(confirmation_code, '') !~ '^[0-9a-fA-F]{8}$'
       or private.connection_change_code_hash(pedido.id, confirmation_code) <> pedido.code_hash) then
    update public.whatsapp_connection_change_requests
    set code_attempts = code_attempts + 1, updated_at = now()
    where id = pedido.id;
    select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
    return jsonb_build_object('confirmed', false, 'result', 'invalid-code')
      || private.connection_change_view(pedido);
  end if;

  -- Confirmado: o código (se houve) é consumido e a ação entra na fila.
  perform private.connection_change_enqueue_action(pedido, conexao);
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  perform private.connection_change_audit(pedido, 'confirmed', null);
  return jsonb_build_object('confirmed', true) || private.connection_change_view(pedido);
end;
$$;

create or replace function public.nucleo_connection_change_cancel(
  target_organization uuid,
  target_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pedido public.whatsapp_connection_change_requests%rowtype;
  comando_status text;
begin
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  if pedido.id is null or pedido.organization_id <> target_organization then
    raise exception 'change request not found';
  end if;
  -- Cancelar não exige liberação: desistir é sempre seguro.
  perform private.connection_change_guard(target_organization, pedido.connection_id);
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request for update;

  if pedido.status = 'awaiting_confirmation' then
    update public.connection_runtime_commands
    set status = 'expired', private_payload = '{}'::jsonb, error_code = 'cancelled', updated_at = now()
    where id = pedido.confirmation_command_id and status = 'pending';
  elsif pedido.status in ('queued', 'running', 'failed', 'expired') then
    -- Só se a VPS ainda não pegou: depois disso a ação pode estar em curso.
    select command.status into comando_status
    from public.connection_runtime_commands command
    where command.id = pedido.action_command_id
    for update;
    if comando_status = 'claimed' then
      return jsonb_build_object('cancelled', false, 'result', 'in-progress') || private.connection_change_view(pedido);
    end if;
    update public.connection_runtime_commands
    set status = 'expired', private_payload = '{}'::jsonb, error_code = 'cancelled', updated_at = now()
    where id = pedido.action_command_id and status = 'pending';
  else
    return jsonb_build_object('cancelled', false, 'result', 'not-cancellable') || private.connection_change_view(pedido);
  end if;

  update public.whatsapp_connection_change_requests
  set status = 'cancelled', code_hash = null, updated_at = now()
  where id = pedido.id;
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  perform private.connection_change_audit(pedido, 'cancelled', null);
  return jsonb_build_object('cancelled', true) || private.connection_change_view(pedido);
end;
$$;

-- Repetir uma ação já confirmada que falhou ou expirou (VPS fora do ar), sem
-- confirmar de novo, dentro de 24 h da confirmação. A geração sobe: um comando
-- antigo que ainda apareça é recusado pelo Bridge.
create or replace function public.nucleo_connection_change_retry(
  target_organization uuid,
  target_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pedido public.whatsapp_connection_change_requests%rowtype;
  conexao public.whatsapp_connections%rowtype;
begin
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  if pedido.id is null or pedido.organization_id <> target_organization then
    raise exception 'change request not found';
  end if;
  conexao := private.connection_change_guard(target_organization, pedido.connection_id);
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request for update;
  if pedido.status not in ('failed', 'expired') or pedido.confirmed_at is null then
    raise exception 'change request cannot be retried';
  end if;
  perform private.connection_change_require_mode(pedido.connection_id, pedido.confirmation_method);
  if pedido.confirmed_at <= now() - interval '24 hours' then
    raise exception 'confirmation is too old; start a new change';
  end if;
  if exists (
    select 1 from public.whatsapp_connection_change_requests other
    where other.connection_id = pedido.connection_id and other.id <> pedido.id
      and other.status in ('awaiting_confirmation', 'queued', 'running')
  ) then
    raise exception 'another change is in progress';
  end if;
  if conexao.expected_phone_hash is distinct from pedido.old_phone_hash
     or conexao.expected_phone_last4 is distinct from pedido.old_phone_last4 then
    raise exception 'identity changed since the confirmation; start a new change';
  end if;

  perform private.connection_change_enqueue_action(pedido, conexao);
  select * into pedido from public.whatsapp_connection_change_requests where id = target_request;
  perform private.connection_change_audit(pedido, 'retried', null);
  return private.connection_change_view(pedido);
end;
$$;

-- O estado para a tela: a liberação, o último pedido, a identidade vigente e
-- o sinal da VPS. Leitura: dono ou administrador. Não exige liberação, para a
-- tela poder dizer que a troca ainda não foi liberada.
create or replace function public.nucleo_connection_change_status(
  target_organization uuid,
  target_connection uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conexao public.whatsapp_connections%rowtype;
  modo text;
  pedido public.whatsapp_connection_change_requests%rowtype;
  identidade public.whatsapp_connection_identities%rowtype;
  runtime public.connection_runtime_status%rowtype;
begin
  if private.is_robot() or private.is_notification_worker() then
    raise exception 'runtime credentials cannot read connection changes';
  end if;
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  select * into conexao from public.whatsapp_connections connection
  where connection.id = target_connection and connection.organization_id = target_organization;
  if conexao.id is null then
    raise exception 'connection is not available for this organization';
  end if;

  modo := private.connection_change_mode(target_connection);
  select * into pedido
  from public.whatsapp_connection_change_requests change_request
  where change_request.connection_id = target_connection
  order by change_request.created_at desc
  limit 1;
  select * into identidade
  from public.whatsapp_connection_identities identity_row
  where identity_row.connection_id = target_connection and identity_row.active_until is null;
  select * into runtime from public.connection_runtime_status where connection_id = target_connection;

  return jsonb_build_object(
    'mode', modo,
    -- Para a tela orientar, não para proteger: quem barra é o start.
    'actorAllowed', case modo
      when 'off' then false
      when 'direct' then private.is_platform_admin()
      else true end,
    'sessionReleasedAt', conexao.session_released_at,
    'request', case when pedido.id is null then null else private.connection_change_view(pedido) end,
    'identity', case when identidade.id is null then null else jsonb_build_object(
      'last4', identidade.phone_last4, 'generation', identidade.generation,
      'reason', identidade.reason, 'activeFrom', identidade.active_from, 'appliedAt', identidade.applied_at) end,
    'runtime', case when runtime.connection_id is null then null else jsonb_build_object(
      'whatsappStatus', runtime.whatsapp_status,
      'fresh', runtime.heartbeat_at > now() - interval '2 minutes',
      'heartbeatAt', runtime.heartbeat_at) end
  );
end;
$$;

revoke all on function public.nucleo_connection_change_start(uuid, uuid, text, text, boolean, text) from public, anon;
revoke all on function public.nucleo_connection_change_resend(uuid, uuid) from public, anon;
revoke all on function public.nucleo_connection_change_confirm(uuid, uuid, text) from public, anon;
revoke all on function public.nucleo_connection_change_cancel(uuid, uuid) from public, anon;
revoke all on function public.nucleo_connection_change_retry(uuid, uuid) from public, anon;
revoke all on function public.nucleo_connection_change_status(uuid, uuid) from public, anon;
grant execute on function public.nucleo_connection_change_start(uuid, uuid, text, text, boolean, text) to authenticated;
grant execute on function public.nucleo_connection_change_resend(uuid, uuid) to authenticated;
grant execute on function public.nucleo_connection_change_confirm(uuid, uuid, text) to authenticated;
grant execute on function public.nucleo_connection_change_cancel(uuid, uuid) to authenticated;
grant execute on function public.nucleo_connection_change_retry(uuid, uuid) to authenticated;
grant execute on function public.nucleo_connection_change_status(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7/9. A confirmação da VPS move o pedido. Na troca, a identidade muda AQUI,
--      na mesma transação em que o runtime conclui o comando.
-- ---------------------------------------------------------------------------
create or replace function private.connection_change_track_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pedido public.whatsapp_connection_change_requests%rowtype;
  resultado jsonb := coalesce(new.public_result, '{}'::jsonb);
begin
  begin
    if new.command_type = 'connection_confirmation_send' then
      select * into pedido from public.whatsapp_connection_change_requests
      where confirmation_command_id = new.id and status = 'awaiting_confirmation'
      for update;
      if pedido.id is not null and new.status in ('failed', 'expired') and new.error_code is distinct from 'resent'
         and new.error_code is distinct from 'cancelled' and new.error_code is distinct from 'superseded' then
        update public.whatsapp_connection_change_requests
        set error_code = 'confirmation-' || coalesce(new.error_code, new.status), updated_at = now()
        where id = pedido.id;
      end if;
      return new;
    end if;

    select * into pedido from public.whatsapp_connection_change_requests
    where action_command_id = new.id
    for update;
    if pedido.id is null then
      return new;
    end if;

    if new.status = 'claimed' and pedido.status = 'queued' then
      update public.whatsapp_connection_change_requests
      set status = 'running', updated_at = now() where id = pedido.id;
    elsif new.status = 'completed' then
      if resultado ->> 'status' = 'applied'
         and (resultado ->> 'generation') ~ '^[0-9]+$'
         and (resultado ->> 'generation')::bigint = pedido.generation then
        update public.whatsapp_connection_change_requests
        set status = 'applied', applied_at = now(), error_code = null,
            remote_logout = case jsonb_typeof(resultado -> 'remoteLogout')
              when 'boolean' then (resultado ->> 'remoteLogout')::boolean end,
            updated_at = now()
        where id = pedido.id;
        update public.whatsapp_connections
        set session_released_at = now()
        where id = pedido.connection_id;
        if pedido.kind = 'change_number' then
          update public.whatsapp_connection_identities
          set active_until = now()
          where connection_id = pedido.connection_id and active_until is null;
          insert into public.whatsapp_connection_identities (
            organization_id, connection_id, generation, phone_hash, phone_last4, reason,
            import_history, active_from, applied_at, request_id, requested_by
          ) values (
            pedido.organization_id, pedido.connection_id, pedido.generation, pedido.new_phone_hash,
            pedido.new_phone_last4, pedido.reason, pedido.import_history, now(), now(), pedido.id,
            pedido.requested_by
          );
          -- A identidade verificada era a do número antigo e deixa de valer.
          -- Mantê-la mostraria o final antigo como "verificado" e prenderia a
          -- conta antiga ao índice único entre empresas.
          update public.whatsapp_connections
          set expected_phone_hash = pedido.new_phone_hash,
              expected_phone_last4 = pedido.new_phone_last4,
              verified_account_ref = null,
              verified_phone_hash = null,
              verified_phone_last4 = null,
              verified_at = null
          where id = pedido.connection_id;
        end if;
        select * into pedido from public.whatsapp_connection_change_requests where id = pedido.id;
        perform private.connection_change_audit(pedido, 'applied', null);
      else
        update public.whatsapp_connection_change_requests
        set status = 'failed', error_code = coalesce(nullif(resultado ->> 'reason', ''), 'unexpected-result'),
            updated_at = now()
        where id = pedido.id;
      end if;
    elsif new.status = 'failed' then
      update public.whatsapp_connection_change_requests
      set status = 'failed', error_code = coalesce(new.error_code, 'failed'), updated_at = now()
      where id = pedido.id and status in ('queued', 'running');
    elsif new.status = 'expired' and coalesce(new.error_code, '') <> 'cancelled' then
      update public.whatsapp_connection_change_requests
      set status = 'expired', error_code = coalesce(new.error_code, 'expired'), updated_at = now()
      where id = pedido.id and status in ('queued', 'running');
    end if;
  exception when others then
    -- A conclusão do runtime nunca falha por causa da tela.
    raise warning 'connection_change_track_command falhou para %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.connection_change_track_command() from public, anon, authenticated;

create trigger connection_runtime_commands_change_track
after update of status on public.connection_runtime_commands
for each row
when (new.command_type in ('connection_confirmation_send', 'connection_logout', 'connection_identity_replace')
      and old.status is distinct from new.status)
execute function private.connection_change_track_command();

-- ---------------------------------------------------------------------------
-- 8/9. A sessão volta: o WhatsApp conectou de novo, a liberação acabou.
-- ---------------------------------------------------------------------------
create or replace function private.connection_change_session_back()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.whatsapp_connections
    set session_released_at = null
    where id = new.connection_id and session_released_at is not null;
  exception when others then
    -- O sinal da VPS nunca falha por causa disto.
    raise warning 'connection_change_session_back falhou para %: %', new.connection_id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.connection_change_session_back() from public, anon, authenticated;

-- Só na transição: o heartbeat regrava o status a cada volta.
create trigger connection_runtime_status_session_back_insert
after insert on public.connection_runtime_status
for each row
when (new.whatsapp_status = 'connected')
execute function private.connection_change_session_back();

create trigger connection_runtime_status_session_back_update
after update of whatsapp_status on public.connection_runtime_status
for each row
when (new.whatsapp_status = 'connected' and old.whatsapp_status is distinct from 'connected')
execute function private.connection_change_session_back();

-- ---------------------------------------------------------------------------
-- 9/9. Ponto de integração (NÃO implementado aqui).
-- ---------------------------------------------------------------------------
-- O aviso de queda (frente feat/aviso-de-conexao-caida-v2, ainda não
-- aplicada) abre alerta quando o status sai de `connected` para um estado
-- sem sessão. Uma liberação VOLUNTÁRIA aplicada faz exatamente essa
-- transição, e `whatsapp_connections.session_released_at` diz que foi por
-- escolha. Quando as duas frentes se encontrarem, o gatilho do aviso precisa
-- ignorar a queda de uma conexão com `session_released_at` preenchido. A
-- pausa de automações depois da troca (D3) e o e-mail aos administradores
-- (D4) também entram por aqui, sem política decidida.

commit;
