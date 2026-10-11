-- O canal oficial do WhatsApp (Cloud API da Meta), etapa de fundação.
--
-- Ver docs/adr/ADR-0008-CANAL-OFICIAL-E-COEXISTENCIA.md. Resumo do desenho:
--
--   Meta ──webhook──▶ servidor do portal (/api/webhooks/whatsapp-cloud)
--                       confere a assinatura e chama
--                       nucleo_whatsapp_cloud_receive(token, eventos)
--                                   │
--                    private.whatsapp_cloud_inbox (fila por conexão)
--                                   │
--   VPS (adaptador da conexão) ◀── nucleo_whatsapp_cloud_inbox_claim
--
-- O webhook é UM endereço para o app inteiro, e a Meta manda para ele os
-- eventos de todos os números de todos os clientes. Quem diz de qual conexão
-- é cada evento é `phone_number_id`, registrado em
-- `public.whatsapp_cloud_numbers`. Evento de número desconhecido é contado e
-- descartado: guardar mensagem de cliente sem dono é guardar dado pessoal que
-- ninguém vai tratar.
--
-- A VPS não tem endereço público, e não precisa ter: ela PUXA a fila com a
-- mesma credencial de robô que já usa para os comandos do portal. É a mesma
-- garantia de nucleo_runtime_commands_claim: um robô só enxerga a própria
-- conexão.
--
-- O que esta migration NÃO faz: guardar o token de acesso da Meta (ele vive
-- no env da conexão na VPS, ADR-0005), nem ligar número nenhum. Ligar é a
-- etapa do Embedded Signup.

begin;

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.robot_organization()') is null then
    raise exception 'abortado: private.robot_organization() nao existe';
  end if;
  if to_regprocedure('private.is_org_member(uuid)') is null
    or to_regprocedure('private.can_manage_org(uuid)') is null then
    raise exception 'abortado: os ajudantes de RLS de organizacao nao existem';
  end if;
  if to_regclass('public.connection_robot_credentials') is null then
    raise exception 'abortado: public.connection_robot_credentials nao existe';
  end if;
  if to_regclass('public.whatsapp_cloud_numbers') is not null then
    raise exception 'abortado: o canal oficial ja foi criado; esta migration ja esta aplicada';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. O número oficial de uma conexão
-- ---------------------------------------------------------------------------
-- Uma conexão tem no máximo um número oficial. Sem linha aqui, a conexão é do
-- Bridge, como sempre foi: nada muda para as conexões existentes.
create table public.whatsapp_cloud_numbers (
  connection_id uuid primary key,
  organization_id uuid not null,
  -- Quem faz a ponte com a Meta. 'meta' é o app próprio (Tech Provider);
  -- '360dialog' fica previsto para o plano B, sem código ainda.
  provider text not null default 'meta' check (provider in ('meta', '360dialog')),
  -- 'coexistence': o número continua no app WhatsApp Business do celular.
  -- 'cloud_only': número só na API, sem app.
  mode text not null default 'coexistence' check (mode in ('coexistence', 'cloud_only')),
  waba_id text not null check (waba_id ~ '^[0-9]{5,25}$'),
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,25}$'),
  display_phone_last4 text check (display_phone_last4 ~ '^[0-9]{4}$'),
  -- 'pending': cadastrado, ainda sem receber (o webhook descarta).
  -- 'active': recebe. 'disabled': desligado sem apagar o histórico de ligação.
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

comment on table public.whatsapp_cloud_numbers is
  'Numero da Cloud API da Meta ligado a uma conexao. Sem linha, a conexao e do Bridge. O token de acesso NAO fica aqui: vive no env da conexao na VPS (ADR-0005).';

alter table public.whatsapp_cloud_numbers enable row level security;

-- Membro vê; ninguém escreve pela API. A escrita vem pela ligação (Embedded
-- Signup), que é uma RPC própria de etapa seguinte, ou pelo SQL Editor.
create policy whatsapp_cloud_numbers_select on public.whatsapp_cloud_numbers
for select to authenticated
using (private.is_org_member(organization_id));

revoke all on public.whatsapp_cloud_numbers from anon;
revoke insert, update, delete on public.whatsapp_cloud_numbers from authenticated;
grant select on public.whatsapp_cloud_numbers to authenticated;

-- ---------------------------------------------------------------------------
-- 2. O token do servidor do portal
-- ---------------------------------------------------------------------------
-- O mesmo arranjo do formulário do site: a função aceita a chave publicável,
-- mas sem o token não faz nada. Guarda-se só o sha256; o token aparece uma vez,
-- no SQL de ligação, e vai para o env do servidor (WHATSAPP_CLOUD_INTAKE_TOKEN).
create table private.whatsapp_cloud_intake (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

revoke all on private.whatsapp_cloud_intake from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A fila de entrada
-- ---------------------------------------------------------------------------
-- Em `private`: guarda conteúdo de mensagem de cliente, e nada disso deve
-- aparecer na API REST. Só as duas RPCs abaixo tocam aqui.
create table private.whatsapp_cloud_inbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  connection_id uuid not null,
  phone_number_id text not null,
  -- 'message': o cliente escreveu. 'echo': alguém respondeu pelo app do
  -- celular (só existe na coexistência, e é o que pausa a IA). 'status':
  -- entregue/lida/falhou, de algo que nós enviamos.
  kind text not null check (kind in ('message', 'echo', 'status')),
  -- O id da Meta (wamid). Com `kind` e `connection_id`, impede o reenvio do
  -- mesmo aviso de virar duas mensagens. Status repete o wamid da mensagem,
  -- então a chave dele leva o próprio status (sent/delivered/read/failed).
  external_id text not null check (length(external_id) between 1 and 200),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed')),
  attempts integer not null default 0,
  claimed_instance uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  received_at timestamptz not null default now(),
  unique (connection_id, kind, external_id),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

create index whatsapp_cloud_inbox_pending
  on private.whatsapp_cloud_inbox (connection_id, received_at)
  where status in ('pending', 'claimed');

revoke all on private.whatsapp_cloud_inbox from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Receber (servidor do portal → fila)
-- ---------------------------------------------------------------------------
-- `events` é a lista que o servidor montou a partir do POST da Meta:
--   [{"phoneNumberId": "...", "kind": "message|echo|status",
--     "externalId": "...", "payload": {...}}]
-- Devolve contagens, nunca conteúdo.
create or replace function public.nucleo_whatsapp_cloud_receive(
  intake_token text,
  events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_limpo text := lower(trim(coalesce(intake_token, '')));
  item jsonb;
  numero record;
  aceitos integer := 0;
  repetidos integer := 0;
  desconhecidos integer := 0;
  invalidos integer := 0;
  inseridos integer;
begin
  if token_limpo !~ '^[0-9a-f]{64}$' or not exists (
    select 1 from private.whatsapp_cloud_intake intake
    where intake.token_hash = encode(extensions.digest(token_limpo, 'sha256'), 'hex')
  ) then
    raise exception 'intake token is invalid';
  end if;

  if events is null or jsonb_typeof(events) <> 'array' then
    raise exception 'events payload is invalid';
  end if;
  -- Um POST da Meta traz poucos eventos; teto contra abuso do token.
  if jsonb_array_length(events) > 200 then
    raise exception 'too many events';
  end if;

  for item in select value from jsonb_array_elements(events) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'kind', '') not in ('message', 'echo', 'status')
      or coalesce(item->>'phoneNumberId', '') !~ '^[0-9]{5,25}$'
      or length(coalesce(item->>'externalId', '')) not between 1 and 200
      or jsonb_typeof(item->'payload') <> 'object'
      or octet_length((item->'payload')::text) > 64000 then
      invalidos := invalidos + 1;
      continue;
    end if;

    select n.connection_id, n.organization_id into numero
    from public.whatsapp_cloud_numbers n
    join public.whatsapp_connections c
      on c.id = n.connection_id and c.organization_id = n.organization_id
    where n.phone_number_id = item->>'phoneNumberId'
      and n.status = 'active'
      and c.status <> 'revoked'
      and c.revoked_at is null;

    if not found then
      desconhecidos := desconhecidos + 1;
      continue;
    end if;

    insert into private.whatsapp_cloud_inbox (
      organization_id, connection_id, phone_number_id, kind, external_id, payload
    ) values (
      numero.organization_id, numero.connection_id, item->>'phoneNumberId',
      item->>'kind', item->>'externalId', item->'payload'
    )
    on conflict (connection_id, kind, external_id) do nothing;

    get diagnostics inseridos = row_count;
    if inseridos = 1 then
      aceitos := aceitos + 1;
    else
      repetidos := repetidos + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'accepted', aceitos,
    'duplicates', repetidos,
    'unknownNumber', desconhecidos,
    'invalid', invalidos
  );
end;
$$;

revoke all on function public.nucleo_whatsapp_cloud_receive(text, jsonb) from public;
grant execute on function public.nucleo_whatsapp_cloud_receive(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reservar (VPS ← fila)
-- ---------------------------------------------------------------------------
-- Mesma autenticação de nucleo_runtime_commands_claim: o robô só enxerga a
-- própria conexão. Entrega em ordem de chegada; o que ficou reservado por mais
-- de 2 minutos (adaptador caiu no meio) volta a ficar disponível, até 5 vezes.
create or replace function public.nucleo_whatsapp_cloud_inbox_claim(
  max_items integer default 20,
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
  safe_limit integer := greatest(1, least(coalesce(max_items, 20), 50));
  entregues jsonb;
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

  -- Faxina com teto e sem esperar ninguém (a lição de 20260911050000): o que
  -- já foi tratado sai depois de 7 dias.
  with velhos as (
    select inbox.id
    from private.whatsapp_cloud_inbox inbox
    where inbox.connection_id = robot_connection
      and inbox.status in ('done', 'failed')
      and inbox.completed_at < now() - interval '7 days'
    order by inbox.id
    for update skip locked
    limit 200
  )
  delete from private.whatsapp_cloud_inbox inbox
  using velhos
  where inbox.id = velhos.id;

  with escolhidos as (
    select inbox.id
    from private.whatsapp_cloud_inbox inbox
    where inbox.organization_id = robot_org
      and inbox.connection_id = robot_connection
      and inbox.attempts < 5
      and (
        inbox.status = 'pending'
        or (inbox.status = 'claimed' and inbox.claimed_at < now() - interval '2 minutes')
      )
    order by inbox.received_at, inbox.id
    for update skip locked
    limit safe_limit
  ), reservados as (
    update private.whatsapp_cloud_inbox inbox
    set status = 'claimed',
        claimed_instance = runtime_instance,
        claimed_at = now(),
        attempts = inbox.attempts + 1
    from escolhidos
    where inbox.id = escolhidos.id
    returning inbox.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reservados.id,
    'kind', reservados.kind,
    'externalId', reservados.external_id,
    'phoneNumberId', reservados.phone_number_id,
    'payload', reservados.payload,
    'receivedAt', reservados.received_at
  ) order by reservados.received_at, reservados.id), '[]'::jsonb)
  into entregues
  from reservados;

  return jsonb_build_object(
    'connectionId', robot_connection,
    'items', entregues
  );
end;
$$;

revoke all on function public.nucleo_whatsapp_cloud_inbox_claim(integer, uuid) from public;
grant execute on function public.nucleo_whatsapp_cloud_inbox_claim(integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Concluir
-- ---------------------------------------------------------------------------
-- O adaptador devolve o que tratou. 'failed' é definitivo (evento que nunca vai
-- dar certo); falha temporária não chama esta função e o item volta sozinho.
create or replace function public.nucleo_whatsapp_cloud_inbox_complete(
  item_ids bigint[],
  completion_status text default 'done'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  concluidos integer;
begin
  if robot_org is null then
    raise exception 'robot credential is inactive or connection was revoked';
  end if;
  if completion_status not in ('done', 'failed') then
    raise exception 'completion status is invalid';
  end if;
  if item_ids is null or cardinality(item_ids) = 0 then
    return jsonb_build_object('completed', 0);
  end if;
  if cardinality(item_ids) > 50 then
    raise exception 'too many items';
  end if;

  update private.whatsapp_cloud_inbox inbox
  set status = completion_status,
      completed_at = now(),
      -- Concluído, o conteúdo já está no messages.db da conexão. Guardar aqui
      -- de novo por 7 dias seria uma segunda cópia sem uso.
      payload = case when completion_status = 'done' then '{}'::jsonb else inbox.payload end
  where inbox.id = any(item_ids)
    and inbox.organization_id = robot_org
    and inbox.status = 'claimed'
    and inbox.connection_id in (
      select credential.connection_id
      from public.connection_robot_credentials credential
      where credential.auth_user_id = auth.uid()
        and credential.organization_id = robot_org
        and credential.status = 'active'
        and credential.revoked_at is null
    );

  get diagnostics concluidos = row_count;
  return jsonb_build_object('completed', concluidos);
end;
$$;

revoke all on function public.nucleo_whatsapp_cloud_inbox_complete(bigint[], text) from public;
grant execute on function public.nucleo_whatsapp_cloud_inbox_complete(bigint[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Conferência do estado que esta migration quer
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.nucleo_whatsapp_cloud_inbox_claim(integer, uuid)', 'execute') then
    raise exception 'abortado: anon nao pode reservar a fila';
  end if;
  if has_function_privilege('anon', 'public.nucleo_whatsapp_cloud_inbox_complete(bigint[], text)', 'execute') then
    raise exception 'abortado: anon nao pode concluir itens da fila';
  end if;
  if not has_function_privilege('anon', 'public.nucleo_whatsapp_cloud_receive(text, jsonb)', 'execute') then
    raise exception 'abortado: o servidor do portal chama a recepcao com a chave publicavel';
  end if;
  if has_table_privilege('authenticated', 'private.whatsapp_cloud_inbox', 'select') then
    raise exception 'abortado: a fila nao pode ser legivel pela API';
  end if;
end;
$$;

commit;
