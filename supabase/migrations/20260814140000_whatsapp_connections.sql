-- Conexões de WhatsApp multi-tenant.
--
-- A unidade operacional é a conexão, não o processo nem o número. Ver
-- ADR-001-CONEXOES-MULTITENANT.md. Nada aqui guarda QR, token em claro, JID
-- completo ou conteúdo de conversa: o telefone entra como hash com sal e como
-- últimos quatro dígitos, o suficiente para conferir e mascarar.

begin;

create type public.whatsapp_connection_status as enum (
  'created',            -- registrada, sem runtime atribuído
  'provisioning',       -- host escolhido, runtime subindo
  'awaiting_pairing',   -- runtime vivo, sem sessão do WhatsApp
  'connected',          -- sessão válida e identidade conferida
  'identity_mismatch',  -- identidade real ≠ esperada: envio bloqueado
  'disconnected',       -- sessão existe, WhatsApp fora do ar
  'logged_out',         -- sessão revogada do lado do WhatsApp
  'revoked',            -- desligada pelo administrador
  'error'
);

create type public.whatsapp_automation_status as enum ('paused', 'test', 'active');
create type public.whatsapp_device_kind as enum ('web', 'bridge');
create type public.whatsapp_device_status as enum ('active', 'stale', 'revoked');

create table public.connection_hosts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  -- Referência opaca (ex.: "wsl://junin"). Nunca porta, nunca caminho: host e
  -- diretório são detalhes de execução, não identidade de conexão.
  host_ref text not null,
  agent_version text not null default '',
  capacity integer not null default 1 check (capacity > 0),
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),

  -- Identidade esperada: o que o administrador declarou ao criar a conexão.
  -- Hash com sal = sha256(id || ':' || dígitos). O sal é a própria conexão,
  -- então o mesmo número em duas conexões produz hashes diferentes e não dá
  -- para correlacionar pessoas entre tenants a partir desta tabela.
  expected_phone_hash text check (expected_phone_hash ~ '^[0-9a-f]{64}$'),
  expected_phone_last4 text check (expected_phone_last4 ~ '^[0-9]{4}$'),

  -- Identidade verificada: o que o WhatsApp devolveu no dispositivo pareado.
  --
  -- ATENÇÃO à derivação: diferente dos hashes de telefone abaixo, este valor é
  -- salgado GLOBALMENTE, nunca por conexão:
  --
  --   verified_account_ref = sha256('emyleads:whatsapp-account:' || dígitos)
  --
  -- O índice único mais abaixo é o que impede a mesma identidade de estar ativa
  -- em duas organizações. Ele só funciona se o mesmo WhatsApp produzir sempre o
  -- mesmo valor. Salgar por conexão faria cada conexão gerar um ref diferente e
  -- a restrição nunca dispararia — um invariante que parece existir e não
  -- existe.
  --
  -- O preço é assumido: telefone tem entropia baixa, então este hash é opaco
  -- para quem lê a tabela, não para quem ataca. Não é o elo mais fraco deste
  -- banco — contacts.phone já guarda telefone em claro.
  verified_account_ref text,
  verified_phone_hash text check (verified_phone_hash ~ '^[0-9a-f]{64}$'),
  verified_phone_last4 text check (verified_phone_last4 ~ '^[0-9]{4}$'),

  status public.whatsapp_connection_status not null default 'created',
  connection_host_id uuid,
  active_device_session_id uuid,
  automation_status public.whatsapp_automation_status not null default 'paused',

  last_activity_at timestamptz,
  version bigint not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  revoked_at timestamptz,

  unique (id, organization_id),
  unique (organization_id, name),
  -- FK composta: um host de outra organização não pode ser referenciado.
  foreign key (connection_host_id, organization_id)
    references public.connection_hosts(id, organization_id),
  -- Verificado é tudo-ou-nada: sem referência da conta não há o que conferir.
  constraint verified_identity_complete check (
    (verified_account_ref is null and verified_phone_hash is null and verified_phone_last4 is null)
    or (verified_account_ref is not null and verified_phone_hash is not null and verified_phone_last4 is not null)
  )
);

-- A mesma identidade verificada não pode estar ativa em duas organizações.
-- Não impede web + bridge da MESMA conexão: sessões vivem noutra tabela.
create unique index whatsapp_connections_identity_unique
  on public.whatsapp_connections (verified_account_ref)
  where verified_account_ref is not null
    and revoked_at is null
    and status <> 'revoked';

create index whatsapp_connections_org_idx
  on public.whatsapp_connections (organization_id, created_at desc);

create table public.whatsapp_device_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  kind public.whatsapp_device_kind not null,
  -- Referência opaca do dispositivo devolvida pelo provedor. Nunca JID cru.
  provider_device_ref text,
  runtime_instance_id text,
  -- Ponteiro opaco para o armazenamento no host. O plano de controle não
  -- resolve caminho: quem sabe onde o store mora é o connection manager.
  session_ref text,
  status public.whatsapp_device_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organization_id),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

-- Uma sessão ativa de bridge por conexão (invariante 2 da especificação).
-- Sessão web fica de fora: o operador pode ter várias abas, e isso não é
-- duplicidade de conexão.
create unique index whatsapp_device_sessions_one_bridge
  on public.whatsapp_device_sessions (connection_id)
  where kind = 'bridge' and status = 'active';

create index whatsapp_device_sessions_connection_idx
  on public.whatsapp_device_sessions (organization_id, connection_id, kind);

alter table public.whatsapp_connections
  add constraint whatsapp_connections_active_session_fk
  foreign key (active_device_session_id, organization_id)
  references public.whatsapp_device_sessions(id, organization_id)
  deferrable initially deferred;

create table public.connection_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  -- Instalação local da extensão. Opaco e gerado no cliente; serve para
  -- revogar uma máquina sem derrubar as outras.
  extension_installation_id text not null,
  label text not null default '',
  -- Somente o hash. O bearer de envio do bridge nunca é reaproveitado aqui:
  -- consultar status e mandar mensagem são autoridades diferentes.
  token_hash text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days'),
  rotated_at timestamptz,
  revoked_at timestamptz,
  unique (id, organization_id),
  unique (connection_id, extension_installation_id),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

create index connection_installations_lookup_idx
  on public.connection_installations (organization_id, connection_id)
  where revoked_at is null;

create table public.connection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  event_type text not null check (length(trim(event_type)) between 1 and 80),
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  correlation_id text,
  -- Metadados sanitizados. QR, token, JID completo e conteúdo de conversa não
  -- entram aqui — a barreira real é o produtor do evento; o comentário existe
  -- para que ninguém "só adicione um campinho" depois.
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.whatsapp_connections(id, organization_id) on delete cascade
);

create index connection_events_timeline_idx
  on public.connection_events (organization_id, connection_id, occurred_at desc);

create trigger connection_hosts_touch before update on public.connection_hosts
for each row execute function private.touch_timestamp();
create trigger whatsapp_connections_touch before update on public.whatsapp_connections
for each row execute function private.touch_versioned_record();
create trigger whatsapp_connections_org_immutable before update on public.whatsapp_connections
for each row execute function private.prevent_organization_change();
create trigger whatsapp_device_sessions_org_immutable before update on public.whatsapp_device_sessions
for each row execute function private.prevent_organization_change();
create trigger connection_installations_org_immutable before update on public.connection_installations
for each row execute function private.prevent_organization_change();

-- A conexão não pode trocar de tenant nem por update direto nem por FK: o
-- gatilho acima cobre a coluna, e este cobre a troca de conexão de uma sessão
-- para outra organização, que a FK composta já barra mas cujo erro seria
-- ilegível.
create or replace function private.enforce_connection_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner_org uuid;
begin
  select c.organization_id into owner_org
  from public.whatsapp_connections c
  where c.id = new.connection_id;

  if owner_org is null then
    raise exception 'connection % does not exist', new.connection_id;
  end if;
  if owner_org <> new.organization_id then
    raise exception 'connection % belongs to another organization', new.connection_id;
  end if;
  return new;
end;
$$;

create trigger whatsapp_device_sessions_tenant before insert or update on public.whatsapp_device_sessions
for each row execute function private.enforce_connection_tenant();
create trigger connection_installations_tenant before insert or update on public.connection_installations
for each row execute function private.enforce_connection_tenant();
create trigger connection_events_tenant before insert on public.connection_events
for each row execute function private.enforce_connection_tenant();

alter table public.connection_hosts enable row level security;
alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_device_sessions enable row level security;
alter table public.connection_installations enable row level security;
alter table public.connection_events enable row level security;

revoke all on public.connection_hosts from anon;
revoke all on public.whatsapp_connections from anon;
revoke all on public.whatsapp_device_sessions from anon;
revoke all on public.connection_installations from anon;
revoke all on public.connection_events from anon;

grant select, insert, update, delete on public.connection_hosts to authenticated;
grant select, insert, update, delete on public.whatsapp_connections to authenticated;
grant select, insert, update, delete on public.whatsapp_device_sessions to authenticated;
grant select, insert, update, delete on public.connection_installations to authenticated;
grant select, insert on public.connection_events to authenticated;

-- Ler exige ser membro. Criar, parear, transferir ou revogar exige papel
-- administrativo: uma conexão de WhatsApp é uma credencial da empresa, não um
-- registro de CRM qualquer.
create policy connection_hosts_select on public.connection_hosts for select to authenticated
using (organization_id is null or private.is_org_member(organization_id));
create policy connection_hosts_manage on public.connection_hosts for all to authenticated
using (organization_id is not null and private.can_manage_org(organization_id))
with check (organization_id is not null and private.can_manage_org(organization_id));

create policy whatsapp_connections_select on public.whatsapp_connections for select to authenticated
using (private.is_org_member(organization_id));
create policy whatsapp_connections_insert on public.whatsapp_connections for insert to authenticated
with check (private.can_manage_org(organization_id));
create policy whatsapp_connections_update on public.whatsapp_connections for update to authenticated
using (private.can_manage_org(organization_id))
with check (private.can_manage_org(organization_id));
create policy whatsapp_connections_delete on public.whatsapp_connections for delete to authenticated
using (private.can_manage_org(organization_id));

create policy whatsapp_device_sessions_select on public.whatsapp_device_sessions for select to authenticated
using (private.is_org_member(organization_id));
create policy whatsapp_device_sessions_manage on public.whatsapp_device_sessions for all to authenticated
using (private.can_manage_org(organization_id))
with check (private.can_manage_org(organization_id));

-- Instalações nunca são legíveis por membro comum: a linha guarda o hash de
-- uma credencial de acesso ao runtime.
create policy connection_installations_manage on public.connection_installations for all to authenticated
using (private.can_manage_org(organization_id))
with check (private.can_manage_org(organization_id));

create policy connection_events_select on public.connection_events for select to authenticated
using (private.is_org_member(organization_id));
create policy connection_events_insert on public.connection_events for insert to authenticated
with check (private.is_org_member(organization_id));

-- Transferência de identidade entre organizações precisa ser explícita e
-- auditada. Sem isto, o índice único acima só produziria um erro de constraint
-- sem revogar nada e sem deixar rastro.
create or replace function public.transfer_whatsapp_connection(
  source_connection uuid,
  target_organization uuid,
  target_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  origem public.whatsapp_connections%rowtype;
  nova uuid := extensions.gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into origem from public.whatsapp_connections where id = source_connection for update;
  if origem.id is null then raise exception 'connection not found'; end if;

  -- Os dois lados: quem entrega e quem recebe precisam de administração.
  if not private.can_manage_org(origem.organization_id) then
    raise exception 'management of the source organization is required';
  end if;
  if not private.can_manage_org(target_organization) then
    raise exception 'management of the target organization is required';
  end if;

  update public.whatsapp_connections
  set status = 'revoked', revoked_at = now(), automation_status = 'paused',
      active_device_session_id = null
  where id = origem.id;

  update public.whatsapp_device_sessions
  set status = 'revoked', revoked_at = now()
  where connection_id = origem.id and status <> 'revoked';

  update public.connection_installations
  set revoked_at = now()
  where connection_id = origem.id and revoked_at is null;

  insert into public.whatsapp_connections (
    id, organization_id, name, expected_phone_hash, expected_phone_last4,
    status, automation_status, created_by, updated_by
  )
  values (
    nova, target_organization, trim(target_name),
    origem.verified_phone_hash, origem.verified_phone_last4,
    'created', 'paused', auth.uid(), auth.uid()
  );

  insert into public.connection_events (organization_id, connection_id, event_type, severity, metadata)
  values
    (origem.organization_id, origem.id, 'connection.transferred_out', 'warning',
     jsonb_build_object('target_organization', target_organization, 'target_connection', nova)),
    (target_organization, nova, 'connection.transferred_in', 'warning',
     jsonb_build_object('source_organization', origem.organization_id, 'source_connection', origem.id));

  return nova;
end;
$$;

revoke all on function public.transfer_whatsapp_connection(uuid, uuid, text) from public;
grant execute on function public.transfer_whatsapp_connection(uuid, uuid, text) to authenticated;

commit;
