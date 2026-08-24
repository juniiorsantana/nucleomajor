-- Fase H: agentes, skills, conhecimento contextual e campanhas multiempresa.
-- A migration e aditiva: o contrato fase-g-1 continua ativo durante o rollout.

begin;

alter table public.knowledge_documents
  add column if not exists audience text not null default 'internal'
    check (audience in ('internal', 'external')),
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.profiles(id) on delete set null;

alter table public.knowledge_document_versions
  add column if not exists audience text not null default 'internal'
    check (audience in ('internal', 'external')),
  add column if not exists published_at timestamptz;

create or replace function private.capture_knowledge_document_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.knowledge_document_versions (
    document_id, organization_id, version, scope_type, scope_user_id,
    path, title, content_markdown, status, audience, published_at,
    changed_by, created_at
  ) values (
    new.id, new.organization_id, new.version, new.scope_type, new.scope_user_id,
    new.path, new.title, new.content_markdown, new.status, new.audience,
    new.published_at, new.updated_by, new.updated_at
  );
  return new;
end;
$$;

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_external_scope_check;
alter table public.knowledge_documents
  add constraint knowledge_documents_external_scope_check
  check (audience = 'internal' or scope_type in ('organization', 'team'));

drop policy if exists knowledge_documents_insert on public.knowledge_documents;
create policy knowledge_documents_insert
on public.knowledge_documents for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and created_by = auth.uid() and updated_by = auth.uid()
  and (
    (scope_type in ('organization', 'team') and private.can_manage_org(organization_id))
    or (scope_type = 'personal' and scope_user_id = auth.uid() and audience = 'internal')
  )
);

drop policy if exists knowledge_documents_update on public.knowledge_documents;
create policy knowledge_documents_update
on public.knowledge_documents for update to authenticated
using (
  private.is_org_member(organization_id)
  and (
    (scope_type in ('organization', 'team') and private.can_manage_org(organization_id))
    or (scope_type = 'personal' and scope_user_id = auth.uid())
  )
)
with check (
  private.is_org_member(organization_id)
  and (
    (scope_type in ('organization', 'team') and private.can_manage_org(organization_id))
    or (scope_type = 'personal' and scope_user_id = auth.uid() and audience = 'internal')
  )
);

create table if not exists public.assistant_templates (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  audience text not null check (audience in ('internal', 'customer')),
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '' check (length(description) <= 1000),
  core_instructions text not null default '' check (length(core_instructions) <= 20000),
  default_config jsonb not null default '{}'::jsonb check (jsonb_typeof(default_config) = 'object'),
  status text not null default 'published' check (status in ('draft', 'published', 'retired')),
  current_version integer not null default 1 check (current_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.assistant_templates(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  release_notes text not null default '',
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create table if not exists public.skill_definitions (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('platform', 'organization')),
  organization_id uuid references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 2 and 120),
  description text not null default '' check (length(description) <= 1200),
  audience text not null default 'both' check (audience in ('internal', 'customer', 'both')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version integer not null default 1 check (current_version > 0),
  spec jsonb not null default '{}'::jsonb check (jsonb_typeof(spec) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_type = 'platform' and organization_id is null)
    or (owner_type = 'organization' and organization_id is not null)
  ),
  unique (id, organization_id)
);

create unique index if not exists skill_definitions_platform_slug_unique
  on public.skill_definitions (slug) where owner_type = 'platform';
create unique index if not exists skill_definitions_org_slug_unique
  on public.skill_definitions (organization_id, slug) where owner_type = 'organization';
create index if not exists skill_definitions_catalog_idx
  on public.skill_definitions (owner_type, organization_id, audience, status, name);

alter table public.skill_definitions
  drop constraint if exists skill_definitions_spec_shape_check;
alter table public.skill_definitions
  add constraint skill_definitions_spec_shape_check check (
    jsonb_typeof(spec) = 'object'
    and (
      not (spec ? 'activation')
      or jsonb_typeof(spec -> 'activation') = 'object'
    )
    and (
      (spec #> '{activation,keywords}') is null
      or jsonb_typeof(spec #> '{activation,keywords}') = 'array'
    )
    and (
      (spec -> 'allowedTools') is null
      or jsonb_typeof(spec -> 'allowedTools') = 'array'
    )
  );

create table if not exists public.skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skill_definitions(id) on delete cascade,
  version integer not null check (version > 0),
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  name text not null,
  description text not null default '',
  audience text not null check (audience in ('internal', 'customer', 'both')),
  status text not null check (status in ('draft', 'published', 'archived')),
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (skill_id, version)
);

create table if not exists public.assistant_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.assistant_templates(id) on delete restrict,
  audience text not null check (audience in ('internal', 'customer')),
  display_name text not null check (length(trim(display_name)) between 2 and 100),
  tone text not null default 'claro, cordial e objetivo' check (length(tone) <= 500),
  brand_config jsonb not null default '{}'::jsonb check (jsonb_typeof(brand_config) = 'object'),
  process_config jsonb not null default '{}'::jsonb check (jsonb_typeof(process_config) = 'object'),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, audience)
);

create table if not exists public.assistant_profile_skills (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  skill_id uuid not null references public.skill_definitions(id) on delete cascade,
  enabled boolean not null default true,
  priority integer not null default 100 check (priority between 0 and 10000),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, skill_id),
  foreign key (profile_id, organization_id)
    references public.assistant_profiles(id, organization_id) on delete cascade
);

create table if not exists public.knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '' check (length(description) <= 1000),
  scope_type text not null default 'organization'
    check (scope_type in ('organization', 'team', 'personal', 'campaign')),
  scope_user_id uuid references public.profiles(id) on delete cascade,
  audience text not null default 'internal' check (audience in ('internal', 'external')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, slug),
  check (
    (scope_type = 'personal' and scope_user_id is not null and audience = 'internal')
    or (scope_type <> 'personal' and scope_user_id is null)
  )
);

create table if not exists public.knowledge_document_collections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  collection_id uuid not null,
  document_id uuid not null,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (collection_id, document_id),
  foreign key (collection_id, organization_id)
    references public.knowledge_collections(id, organization_id) on delete cascade,
  foreign key (document_id, organization_id)
    references public.knowledge_documents(id, organization_id) on delete cascade
);

create table if not exists public.organization_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assistant_profile_id uuid not null,
  name text not null check (length(trim(name)) between 2 and 140),
  status text not null default 'draft' check (status in ('draft', 'test', 'active', 'paused', 'closed')),
  objective text not null default '' check (length(objective) <= 2000),
  offer text not null default '' check (length(offer) <= 4000),
  audience_description text not null default '' check (length(audience_description) <= 2000),
  desired_outcome text not null default '' check (length(desired_outcome) <= 2000),
  is_default boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (assistant_profile_id, organization_id)
    references public.assistant_profiles(id, organization_id) on delete restrict,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create unique index if not exists organization_campaigns_one_default_idx
  on public.organization_campaigns (organization_id)
  where is_default and status in ('test', 'active');
create index if not exists organization_campaigns_status_idx
  on public.organization_campaigns (organization_id, status, starts_at, ends_at);

create table if not exists public.campaign_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  source_type text not null check (source_type in ('link', 'qr', 'ad', 'tag', 'keyword', 'semantic', 'default')),
  source_value text not null default '' check (length(source_value) <= 500),
  priority integer not null default 100 check (priority between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, campaign_id, source_type, source_value),
  foreign key (campaign_id, organization_id)
    references public.organization_campaigns(id, organization_id) on delete cascade
);

create table if not exists public.campaign_skills (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  skill_id uuid not null references public.skill_definitions(id) on delete cascade,
  priority integer not null default 100 check (priority between 0 and 10000),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  primary key (campaign_id, skill_id),
  foreign key (campaign_id, organization_id)
    references public.organization_campaigns(id, organization_id) on delete cascade
);

create table if not exists public.campaign_knowledge_collections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  collection_id uuid not null,
  primary key (campaign_id, collection_id),
  foreign key (campaign_id, organization_id)
    references public.organization_campaigns(id, organization_id) on delete cascade,
  foreign key (collection_id, organization_id)
    references public.knowledge_collections(id, organization_id) on delete cascade
);

create table if not exists public.conversation_intelligence_contexts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.whatsapp_connections(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  assistant_profile_id uuid not null,
  campaign_id uuid,
  active_skill_id uuid references public.skill_definitions(id) on delete set null,
  audience text not null check (audience in ('internal', 'customer')),
  channel text not null check (channel in ('whatsapp', 'web', 'simulator')),
  conversation_key_hash text not null check (conversation_key_hash ~ '^[0-9a-f]{64}$'),
  intent text not null default '' check (length(intent) <= 200),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  state text not null default 'active' check (state in ('active', 'closed', 'handed_off')),
  context_version text not null default 'fase-h-1',
  source_context jsonb not null default '{}'::jsonb check (jsonb_typeof(source_context) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (assistant_profile_id, organization_id)
    references public.assistant_profiles(id, organization_id) on delete restrict,
  foreign key (campaign_id, organization_id)
    references public.organization_campaigns(id, organization_id) on delete set null
);

create unique index if not exists conversation_intelligence_active_key_idx
  on public.conversation_intelligence_contexts (organization_id, channel, conversation_key_hash)
  where state = 'active';
create index if not exists conversation_intelligence_campaign_idx
  on public.conversation_intelligence_contexts (organization_id, campaign_id, last_message_at desc);

create table if not exists public.intelligence_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  entity_type text not null check (entity_type in ('template', 'profile', 'skill', 'collection', 'campaign', 'conversation', 'simulation')),
  entity_id uuid,
  action text not null check (length(action) between 2 and 100),
  version integer,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.intelligence_simulations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  audience text not null check (audience in ('internal', 'customer')),
  input_excerpt text not null check (length(input_excerpt) between 1 and 1000),
  resolved_context jsonb not null check (jsonb_typeof(resolved_context) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.contact_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  campaign_id uuid,
  context_id uuid,
  status text not null default 'collecting'
    check (status in ('collecting', 'qualified', 'disqualified', 'needs_human')),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 16384),
  score numeric(5,2) check (score is null or score between 0 and 100),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, context_id),
  foreign key (contact_id, organization_id) references public.contacts(id, organization_id) on delete cascade,
  foreign key (campaign_id, organization_id) references public.organization_campaigns(id, organization_id) on delete set null,
  foreign key (context_id, organization_id) references public.conversation_intelligence_contexts(id, organization_id) on delete set null
);

create table if not exists public.customer_handoff_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.whatsapp_connections(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  context_id uuid not null,
  reason_code text not null check (reason_code in ('requested_human', 'low_confidence', 'sensitive_topic', 'commercial_exception', 'tool_unavailable', 'skill_limit')),
  summary text not null default '' check (length(summary) <= 1000),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  foreign key (context_id, organization_id) references public.conversation_intelligence_contexts(id, organization_id) on delete cascade
);
create unique index if not exists customer_handoff_one_open_idx
  on public.customer_handoff_requests (organization_id, context_id)
  where status in ('requested', 'accepted');

create or replace function private.audit_intelligence_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_org uuid;
  target_id uuid;
  target_version integer;
begin
  if nullif(row_data->>'organization_id', '') is not null then
    target_org := (row_data->>'organization_id')::uuid;
  end if;
  if nullif(row_data->>'id', '') is not null then target_id := (row_data->>'id')::uuid; end if;
  if nullif(row_data->>'current_version', '') is not null then
    target_version := (row_data->>'current_version')::integer;
  end if;
  insert into public.intelligence_audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, version, metadata
  ) values (
    target_org, auth.uid(), tg_argv[0], target_id, lower(tg_op), target_version,
    jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(row_data->>'name', row_data->>'display_name'),
      'status', row_data->>'status', 'audience', row_data->>'audience'
    ))
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.touch_skill_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.current_version := old.current_version + 1;
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;

create or replace function private.capture_skill_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.skill_versions (
    skill_id, version, spec, name, description, audience, status, changed_by
  ) values (
    new.id, new.current_version, new.spec, new.name, new.description,
    new.audience, new.status, new.updated_by
  );
  return new;
end;
$$;

drop trigger if exists skill_definitions_capture_version on public.skill_definitions;
create trigger skill_definitions_capture_version
after insert or update on public.skill_definitions
for each row execute function private.capture_skill_version();
drop trigger if exists skill_definitions_touch on public.skill_definitions;
create trigger skill_definitions_touch
before update on public.skill_definitions
for each row execute function private.touch_skill_definition();

create or replace function private.touch_intelligence_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists assistant_profiles_touch on public.assistant_profiles;
create trigger assistant_profiles_touch before update on public.assistant_profiles
for each row execute function private.touch_intelligence_record();
drop trigger if exists knowledge_collections_touch on public.knowledge_collections;
create trigger knowledge_collections_touch before update on public.knowledge_collections
for each row execute function private.touch_intelligence_record();
drop trigger if exists organization_campaigns_touch on public.organization_campaigns;
create trigger organization_campaigns_touch before update on public.organization_campaigns
for each row execute function private.touch_intelligence_record();
drop trigger if exists conversation_intelligence_touch on public.conversation_intelligence_contexts;
create trigger conversation_intelligence_touch before update on public.conversation_intelligence_contexts
for each row execute function private.touch_intelligence_record();

drop trigger if exists assistant_profiles_audit on public.assistant_profiles;
create trigger assistant_profiles_audit after insert or update on public.assistant_profiles
for each row execute function private.audit_intelligence_change('profile');
drop trigger if exists skill_definitions_audit on public.skill_definitions;
create trigger skill_definitions_audit after insert or update on public.skill_definitions
for each row execute function private.audit_intelligence_change('skill');
drop trigger if exists knowledge_collections_audit on public.knowledge_collections;
create trigger knowledge_collections_audit after insert or update on public.knowledge_collections
for each row execute function private.audit_intelligence_change('collection');
drop trigger if exists organization_campaigns_audit on public.organization_campaigns;
create trigger organization_campaigns_audit after insert or update on public.organization_campaigns
for each row execute function private.audit_intelligence_change('campaign');

insert into public.assistant_templates (
  id, slug, audience, name, description, core_instructions, default_config, status, current_version
) values
  (
    '10000000-0000-0000-0000-000000000001', 'assistente-interno', 'internal',
    'Assistente interno', 'Ajuda cada profissional com agenda, tarefas, CRM e conhecimento autorizado.',
    'Atenda somente o profissional autenticado. Respeite cargo, privacidade e confirmação antes de escritas.',
    '{"confirmationRequired":true,"personalIsolation":true}'::jsonb, 'published', 1
  ),
  (
    '10000000-0000-0000-0000-000000000002', 'assistente-atendimento', 'customer',
    'Assistente de atendimento', 'Atende clientes com uma identidade única e skills contextuais.',
    'Use apenas conhecimento publicado para clientes. Qualifique, agende com confirmação e transfira quando necessário.',
    '{"confirmationRequired":true,"humanHandoff":true,"externalKnowledgeOnly":true}'::jsonb, 'published', 1
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  core_instructions = excluded.core_instructions,
  default_config = excluded.default_config,
  status = excluded.status,
  current_version = excluded.current_version,
  updated_at = now();

insert into public.assistant_template_versions (template_id, version, snapshot, release_notes)
select template.id, template.current_version, jsonb_build_object(
  'slug', template.slug, 'audience', template.audience, 'name', template.name,
  'description', template.description, 'coreInstructions', template.core_instructions,
  'defaultConfig', template.default_config, 'status', template.status
), 'Versão inicial da Fase H'
from public.assistant_templates template
on conflict (template_id, version) do nothing;

insert into public.skill_definitions (
  id, owner_type, slug, name, description, audience, status, current_version, spec
) values
  (
    '20000000-0000-0000-0000-000000000001', 'platform', 'agenda', 'Agenda',
    'Consulta disponibilidade e prepara compromissos com confirmação.', 'both', 'published', 1,
    '{"objective":"Consultar e organizar compromissos","activation":{"keywords":["agenda","agendar","reunião","horário","disponibilidade"]},"requiredFields":["title","date","time","duration"],"questions":["Qual é a duração?"],"allowedTools":["calendar.read","calendar.availability","calendar.prepare","calendar.confirm"],"guardrails":["explicit_confirmation","no_task_substitution"],"handoff":["tool_unavailable","permission_denied"]}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000002', 'platform', 'vendas', 'Vendas',
    'Entende interesse, apresenta a oferta autorizada e conduz o próximo passo.', 'customer', 'published', 1,
    '{"objective":"Conduzir oportunidades comerciais sem inventar condições","activation":{"keywords":["preço","valor","comprar","contratar","proposta"]},"requiredFields":["need"],"questions":["O que você precisa resolver?"],"allowedTools":["crm.contact.upsert","crm.tag.apply","crm.deal.qualify"],"guardrails":["published_offer_only","no_discount_without_rule"],"handoff":["commercial_exception","low_confidence"]}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000003', 'platform', 'pre-qualificacao', 'Pré-qualificação',
    'Coleta dados essenciais e registra a qualificação no CRM.', 'customer', 'published', 1,
    '{"objective":"Descobrir perfil, necessidade e momento do lead","activation":{"keywords":["interesse","quero saber","informações","como funciona"]},"requiredFields":["name","need","timing"],"questions":["Qual é a sua principal necessidade?","Para quando você precisa?"],"allowedTools":["crm.contact.upsert","crm.tag.apply","crm.deal.qualify"],"guardrails":["minimal_data","purpose_limitation"],"handoff":["requested_human","low_confidence"]}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000004', 'platform', 'suporte', 'Suporte',
    'Orienta com base no conteúdo publicado e transfere casos não resolvidos.', 'customer', 'published', 1,
    '{"objective":"Resolver dúvidas e encaminhar incidentes","activation":{"keywords":["ajuda","erro","problema","suporte","não funciona"]},"requiredFields":["issue"],"questions":["O que aconteceu e o que você esperava?"],"allowedTools":["knowledge.search","crm.contact.read","conversation.handoff"],"guardrails":["published_knowledge_only","no_secret_disclosure"],"handoff":["sensitive_topic","two_failed_clarifications","tool_unavailable"]}'::jsonb
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  audience = excluded.audience,
  status = excluded.status,
  spec = excluded.spec,
  updated_at = now();

create or replace function private.provision_intelligence(target_organization uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal_profile uuid;
  customer_profile uuid;
begin
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, created_by, updated_by
  ) values (
    target_organization, '10000000-0000-0000-0000-000000000001', 'internal',
    'Assistente interno', actor, actor
  ) on conflict (organization_id, audience) do nothing;
  insert into public.assistant_profiles (
    organization_id, template_id, audience, display_name, created_by, updated_by
  ) values (
    target_organization, '10000000-0000-0000-0000-000000000002', 'customer',
    'Assistente da empresa', actor, actor
  ) on conflict (organization_id, audience) do nothing;

  select id into internal_profile from public.assistant_profiles
  where organization_id = target_organization and audience = 'internal';
  select id into customer_profile from public.assistant_profiles
  where organization_id = target_organization and audience = 'customer';

  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values (target_organization, internal_profile, '20000000-0000-0000-0000-000000000001', 10, actor)
  on conflict (profile_id, skill_id) do nothing;
  insert into public.assistant_profile_skills (organization_id, profile_id, skill_id, priority, updated_by)
  values
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000003', 10, actor),
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000002', 20, actor),
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000004', 30, actor),
    (target_organization, customer_profile, '20000000-0000-0000-0000-000000000001', 40, actor)
  on conflict (profile_id, skill_id) do nothing;

  insert into public.knowledge_collections (
    organization_id, name, slug, description, scope_type, audience, created_by, updated_by
  ) values
    (target_organization, 'Conhecimento interno', 'conhecimento-interno',
     'Regras e referências disponíveis somente para a equipe.', 'organization', 'internal', actor, actor),
    (target_organization, 'Conhecimento para clientes', 'conhecimento-clientes',
     'Conteúdo publicado explicitamente para atendimento externo.', 'organization', 'external', actor, actor)
  on conflict (organization_id, slug) do nothing;
end;
$$;

select private.provision_intelligence(organization.id, organization.created_by)
from public.organizations organization;

create or replace function private.provision_intelligence_after_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_intelligence(new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists organizations_provision_intelligence on public.organizations;
create trigger organizations_provision_intelligence
after insert on public.organizations
for each row execute function private.provision_intelligence_after_organization();

-- Documentos existentes permanecem internos e entram na coleção interna padrão.
insert into public.knowledge_document_collections (organization_id, collection_id, document_id, added_by)
select document.organization_id, collection.id, document.id, document.updated_by
from public.knowledge_documents document
join public.knowledge_collections collection
  on collection.organization_id = document.organization_id
 and collection.slug = 'conhecimento-interno'
where document.deleted_at is null
on conflict (collection_id, document_id) do nothing;

alter table public.assistant_templates enable row level security;
alter table public.assistant_template_versions enable row level security;
alter table public.skill_definitions enable row level security;
alter table public.skill_versions enable row level security;
alter table public.assistant_profiles enable row level security;
alter table public.assistant_profile_skills enable row level security;
alter table public.knowledge_collections enable row level security;
alter table public.knowledge_document_collections enable row level security;
alter table public.organization_campaigns enable row level security;
alter table public.campaign_sources enable row level security;
alter table public.campaign_skills enable row level security;
alter table public.campaign_knowledge_collections enable row level security;
alter table public.conversation_intelligence_contexts enable row level security;
alter table public.intelligence_audit_log enable row level security;
alter table public.intelligence_simulations enable row level security;
alter table public.contact_qualifications enable row level security;
alter table public.customer_handoff_requests enable row level security;

revoke all on public.assistant_templates, public.assistant_template_versions,
  public.skill_definitions, public.skill_versions, public.assistant_profiles,
  public.assistant_profile_skills, public.knowledge_collections,
  public.knowledge_document_collections, public.organization_campaigns,
  public.campaign_sources, public.campaign_skills,
  public.campaign_knowledge_collections, public.conversation_intelligence_contexts,
  public.intelligence_audit_log, public.intelligence_simulations from anon;
revoke all on public.contact_qualifications, public.customer_handoff_requests from anon;

grant select on public.assistant_templates, public.assistant_template_versions to authenticated;
grant select, insert, update on public.skill_definitions to authenticated;
grant select on public.skill_versions to authenticated;
grant select, insert, update on public.assistant_profiles, public.assistant_profile_skills,
  public.knowledge_collections, public.organization_campaigns to authenticated;
grant select, insert, update, delete on public.knowledge_document_collections,
  public.campaign_sources, public.campaign_skills,
  public.campaign_knowledge_collections to authenticated;
grant select on public.conversation_intelligence_contexts, public.intelligence_audit_log to authenticated;
grant select, insert on public.intelligence_simulations to authenticated;
grant select on public.contact_qualifications, public.customer_handoff_requests to authenticated;
grant update on public.customer_handoff_requests to authenticated;

create policy assistant_templates_read on public.assistant_templates for select to authenticated
using (status = 'published');
create policy assistant_template_versions_read on public.assistant_template_versions for select to authenticated
using (exists (select 1 from public.assistant_templates template where template.id = template_id and template.status = 'published'));

create policy skill_definitions_read on public.skill_definitions for select to authenticated
using (
  (owner_type = 'platform' and status = 'published')
  or (owner_type = 'organization' and private.is_org_member(organization_id))
);
create policy skill_definitions_insert on public.skill_definitions for insert to authenticated
with check (owner_type = 'organization' and private.can_manage_org(organization_id) and created_by = auth.uid() and updated_by = auth.uid());
create policy skill_definitions_update on public.skill_definitions for update to authenticated
using (owner_type = 'organization' and private.can_manage_org(organization_id))
with check (owner_type = 'organization' and private.can_manage_org(organization_id));
create policy skill_versions_read on public.skill_versions for select to authenticated
using (exists (
  select 1 from public.skill_definitions skill
  where skill.id = skill_id and (
    (skill.owner_type = 'platform' and skill.status = 'published')
    or (skill.owner_type = 'organization' and private.is_org_member(skill.organization_id))
  )
));

create policy assistant_profiles_read on public.assistant_profiles for select to authenticated
using (private.is_org_member(organization_id));
create policy assistant_profiles_insert on public.assistant_profiles for insert to authenticated
with check (private.can_manage_org(organization_id) and created_by = auth.uid() and updated_by = auth.uid());
create policy assistant_profiles_update on public.assistant_profiles for update to authenticated
using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));
create policy assistant_profile_skills_read on public.assistant_profile_skills for select to authenticated
using (private.is_org_member(organization_id));
create policy assistant_profile_skills_insert on public.assistant_profile_skills for insert to authenticated
with check (
  private.can_manage_org(organization_id)
  and exists (
    select 1 from public.skill_definitions skill where skill.id = skill_id
      and (skill.owner_type = 'platform' or skill.organization_id = assistant_profile_skills.organization_id)
  )
);
create policy assistant_profile_skills_update on public.assistant_profile_skills for update to authenticated
using (private.can_manage_org(organization_id))
with check (
  private.can_manage_org(organization_id)
  and exists (
    select 1 from public.skill_definitions skill where skill.id = skill_id
      and (skill.owner_type = 'platform' or skill.organization_id = assistant_profile_skills.organization_id)
  )
);

create policy knowledge_collections_read on public.knowledge_collections for select to authenticated
using (private.is_org_member(organization_id) and (scope_type <> 'personal' or scope_user_id = auth.uid()));
create policy knowledge_collections_insert on public.knowledge_collections for insert to authenticated
with check (
  private.is_org_member(organization_id) and created_by = auth.uid() and updated_by = auth.uid()
  and ((scope_type = 'personal' and scope_user_id = auth.uid()) or (scope_type <> 'personal' and private.can_manage_org(organization_id)))
);
create policy knowledge_collections_update on public.knowledge_collections for update to authenticated
using ((scope_type = 'personal' and scope_user_id = auth.uid()) or (scope_type <> 'personal' and private.can_manage_org(organization_id)))
with check ((scope_type = 'personal' and scope_user_id = auth.uid()) or (scope_type <> 'personal' and private.can_manage_org(organization_id)));
create policy knowledge_document_collections_read on public.knowledge_document_collections for select to authenticated
using (private.is_org_member(organization_id));
create policy knowledge_document_collections_insert on public.knowledge_document_collections for insert to authenticated
with check (private.can_manage_org(organization_id) or added_by = auth.uid());
create policy knowledge_document_collections_update on public.knowledge_document_collections for update to authenticated
using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));
create policy knowledge_document_collections_delete on public.knowledge_document_collections for delete to authenticated
using (private.can_manage_org(organization_id) or added_by = auth.uid());

create policy organization_campaigns_read on public.organization_campaigns for select to authenticated
using (private.is_org_member(organization_id));
create policy organization_campaigns_insert on public.organization_campaigns for insert to authenticated
with check (private.can_manage_org(organization_id) and created_by = auth.uid() and updated_by = auth.uid());
create policy organization_campaigns_update on public.organization_campaigns for update to authenticated
using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));

create policy campaign_sources_read on public.campaign_sources for select to authenticated
using (private.is_org_member(organization_id));
create policy campaign_sources_insert on public.campaign_sources for insert to authenticated
with check (private.can_manage_org(organization_id));
create policy campaign_sources_update on public.campaign_sources for update to authenticated
using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));
create policy campaign_sources_delete on public.campaign_sources for delete to authenticated
using (private.can_manage_org(organization_id));
create policy campaign_skills_read on public.campaign_skills for select to authenticated
using (private.is_org_member(organization_id));
create policy campaign_skills_insert on public.campaign_skills for insert to authenticated
with check (
  private.can_manage_org(organization_id)
  and exists (
    select 1 from public.skill_definitions skill where skill.id = skill_id
      and (skill.owner_type = 'platform' or skill.organization_id = campaign_skills.organization_id)
  )
);
create policy campaign_skills_update on public.campaign_skills for update to authenticated
using (private.can_manage_org(organization_id))
with check (
  private.can_manage_org(organization_id)
  and exists (
    select 1 from public.skill_definitions skill where skill.id = skill_id
      and (skill.owner_type = 'platform' or skill.organization_id = campaign_skills.organization_id)
  )
);
create policy campaign_skills_delete on public.campaign_skills for delete to authenticated
using (private.can_manage_org(organization_id));
create policy campaign_collections_read on public.campaign_knowledge_collections for select to authenticated
using (private.is_org_member(organization_id));
create policy campaign_collections_insert on public.campaign_knowledge_collections for insert to authenticated
with check (private.can_manage_org(organization_id));
create policy campaign_collections_update on public.campaign_knowledge_collections for update to authenticated
using (private.can_manage_org(organization_id)) with check (private.can_manage_org(organization_id));
create policy campaign_collections_delete on public.campaign_knowledge_collections for delete to authenticated
using (private.can_manage_org(organization_id));

create policy conversation_intelligence_read on public.conversation_intelligence_contexts for select to authenticated
using (private.can_manage_org(organization_id));
create policy intelligence_audit_read on public.intelligence_audit_log for select to authenticated
using (organization_id is not null and private.can_manage_org(organization_id));
create policy intelligence_simulations_read on public.intelligence_simulations for select to authenticated
using (private.can_manage_org(organization_id));
create policy intelligence_simulations_insert on public.intelligence_simulations for insert to authenticated
with check (private.can_manage_org(organization_id) and user_id = auth.uid());
create policy contact_qualifications_read on public.contact_qualifications for select to authenticated
using (private.is_org_member(organization_id));
create policy customer_handoff_requests_read on public.customer_handoff_requests for select to authenticated
using (private.is_org_member(organization_id));
create policy customer_handoff_requests_update on public.customer_handoff_requests for update to authenticated
using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));

create or replace function private.intelligence_payload(
  target_organization uuid,
  target_audience text,
  target_channel text,
  conversation_hash text,
  incoming_text text,
  source_data jsonb,
  should_persist boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_profile public.assistant_profiles%rowtype;
  selected_campaign public.organization_campaigns%rowtype;
  existing_context public.conversation_intelligence_contexts%rowtype;
  selected_skill public.skill_definitions%rowtype;
  skills_payload jsonb;
  collections_payload jsonb;
  saved_context uuid;
  normalized_message text := lower(left(coalesce(incoming_text, ''), 2000));
  safe_source jsonb := coalesce(source_data, '{}'::jsonb);
begin
  if target_audience not in ('internal', 'customer') then raise exception 'invalid assistant audience'; end if;
  if target_channel not in ('whatsapp', 'web', 'simulator') then raise exception 'invalid assistant channel'; end if;
  if conversation_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid conversation context key'; end if;

  select * into selected_profile from public.assistant_profiles profile
  where profile.organization_id = target_organization
    and profile.audience = target_audience and profile.active
  limit 1;
  if not found then raise exception 'assistant profile is inactive or unavailable'; end if;

  select * into existing_context from public.conversation_intelligence_contexts context
  where context.organization_id = target_organization
    and context.channel = target_channel
    and context.conversation_key_hash = conversation_hash
    and context.state = 'active'
  limit 1;

  if existing_context.id is null and exists (
    select 1 from public.conversation_intelligence_contexts context
    where context.organization_id = target_organization
      and context.channel = target_channel
      and context.conversation_key_hash = conversation_hash
      and context.state = 'handed_off'
  ) then
    raise exception 'conversation is assigned to human service';
  end if;

  if existing_context.id is not null and existing_context.campaign_id is not null then
    select * into selected_campaign from public.organization_campaigns campaign
    where campaign.id = existing_context.campaign_id
      and campaign.organization_id = target_organization;
  elsif target_audience = 'customer' then
    select campaign.* into selected_campaign
    from public.organization_campaigns campaign
    left join public.campaign_sources source
      on source.campaign_id = campaign.id and source.organization_id = campaign.organization_id and source.active
    where campaign.organization_id = target_organization
      and campaign.status in ('test', 'active')
      and (campaign.starts_at is null or campaign.starts_at <= now())
      and (campaign.ends_at is null or campaign.ends_at > now())
      and (
        (source.source_type in ('link', 'qr', 'ad', 'tag', 'semantic') and safe_source ->> source.source_type = source.source_value)
        or (source.source_type = 'keyword' and source.source_value <> '' and position(lower(source.source_value) in normalized_message) > 0)
        or campaign.is_default
      )
    order by
      case when source.source_type in ('link', 'qr', 'ad', 'tag', 'semantic') then 0
           when source.source_type = 'keyword' then 1
           when campaign.is_default then 3 else 2 end,
      source.priority nulls last,
      campaign.created_at
    limit 1;
  end if;

  if existing_context.active_skill_id is not null then
    select * into selected_skill from public.skill_definitions skill
    where skill.id = existing_context.active_skill_id and skill.status = 'published';
  end if;
  if selected_skill.id is null and selected_campaign.id is not null then
    select skill.* into selected_skill
    from public.campaign_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    where binding.organization_id = target_organization and binding.campaign_id = selected_campaign.id
    order by
      case when exists (
        select 1 from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,keywords}', '[]'::jsonb)) keyword
        where position(lower(keyword) in normalized_message) > 0
      ) then 0 else 1 end,
      binding.priority, skill.name
    limit 1;
  end if;
  if selected_skill.id is null then
    select skill.* into selected_skill
    from public.assistant_profile_skills binding
    join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
    where binding.organization_id = target_organization
      and binding.profile_id = selected_profile.id and binding.enabled
      and skill.audience in (target_audience, 'both')
    order by
      case when exists (
        select 1 from jsonb_array_elements_text(coalesce(skill.spec #> '{activation,keywords}', '[]'::jsonb)) keyword
        where position(lower(keyword) in normalized_message) > 0
      ) then 0 else 1 end,
      binding.priority, skill.name
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', skill.id, 'slug', skill.slug, 'nome', skill.name,
    'descricao', skill.description, 'versao', skill.current_version,
    'spec', skill.spec, 'prioridade', binding.priority,
    'configuracao', binding.configuration
  ) order by binding.priority, skill.name), '[]'::jsonb)
  into skills_payload
  from public.assistant_profile_skills binding
  join public.skill_definitions skill on skill.id = binding.skill_id and skill.status = 'published'
  where binding.organization_id = target_organization
    and binding.profile_id = selected_profile.id and binding.enabled
    and skill.audience in (target_audience, 'both');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', collection.id, 'nome', collection.name, 'escopo', collection.scope_type,
    'audiencia', collection.audience
  ) order by collection.name), '[]'::jsonb)
  into collections_payload
  from public.knowledge_collections collection
  where collection.organization_id = target_organization and collection.status = 'active'
    and (
      (target_audience = 'internal' and collection.audience = 'internal' and collection.scope_type <> 'personal')
      or (target_audience = 'customer' and collection.audience = 'external' and (
        collection.scope_type <> 'campaign'
        or exists (
          select 1 from public.campaign_knowledge_collections campaign_collection
          where campaign_collection.organization_id = target_organization
            and campaign_collection.collection_id = collection.id
            and campaign_collection.campaign_id = selected_campaign.id
        )
      ))
    );

  if should_persist then
    if existing_context.id is not null then
      update public.conversation_intelligence_contexts context
      set assistant_profile_id = selected_profile.id,
          campaign_id = coalesce(context.campaign_id, selected_campaign.id),
          active_skill_id = coalesce(selected_skill.id, context.active_skill_id),
          last_message_at = now(), source_context = context.source_context || safe_source
      where context.id = existing_context.id
      returning context.id into saved_context;
    else
      insert into public.conversation_intelligence_contexts (
        organization_id, assistant_profile_id, campaign_id, active_skill_id,
        audience, channel, conversation_key_hash, source_context
      ) values (
        target_organization, selected_profile.id, selected_campaign.id, selected_skill.id,
        target_audience, target_channel, conversation_hash, safe_source
      ) returning id into saved_context;
    end if;
  end if;

  return jsonb_build_object(
    'schemaVersion', 'fase-h-1',
    'contextoId', coalesce(saved_context, existing_context.id),
    'audiencia', target_audience,
    'assistente', jsonb_build_object(
      'id', selected_profile.id, 'nome', selected_profile.display_name,
      'tom', selected_profile.tone, 'marca', selected_profile.brand_config,
      'processo', selected_profile.process_config, 'templateId', selected_profile.template_id
    ),
    'campanha', case when selected_campaign.id is null then null else jsonb_build_object(
      'id', selected_campaign.id, 'nome', selected_campaign.name,
      'objetivo', selected_campaign.objective, 'oferta', selected_campaign.offer,
      'publico', selected_campaign.audience_description,
      'resultadoEsperado', selected_campaign.desired_outcome,
      'configuracao', selected_campaign.configuration
    ) end,
    'skillAtivo', case when selected_skill.id is null then null else jsonb_build_object(
      'id', selected_skill.id, 'slug', selected_skill.slug, 'nome', selected_skill.name,
      'versao', selected_skill.current_version, 'spec', selected_skill.spec
    ) end,
    'skillsPermitidos', skills_payload,
    'colecoesPermitidas', collections_payload,
    'politicas', jsonb_build_object(
      'organizacaoDerivada', true,
      'confirmacaoParaEscrita', true,
      'documentosComoDados', true,
      'transferenciaHumana', target_audience = 'customer'
    )
  );
end;
$$;

create or replace function public.intelligence_context_preview(
  target_organization uuid,
  target_audience text,
  incoming_text text default '',
  source_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preview_hash text;
  payload jsonb;
begin
  if auth.uid() is null or not private.can_manage_org(target_organization) then
    raise exception 'organization management required';
  end if;
  preview_hash := encode(extensions.digest(auth.uid()::text || ':' || clock_timestamp()::text, 'sha256'), 'hex');
  payload := private.intelligence_payload(
    target_organization, target_audience, 'simulator', preview_hash,
    left(coalesce(incoming_text, ''), 2000), coalesce(source_data, '{}'::jsonb), false
  );
  insert into public.intelligence_simulations (
    organization_id, user_id, audience, input_excerpt, resolved_context
  ) values (
    target_organization, auth.uid(), target_audience,
    left(trim(incoming_text), 1000), payload
  );
  return payload;
end;
$$;

create or replace function public.nucleo_intelligence_context_resolve(
  conversation_key_hash text,
  requester_phone text default '',
  incoming_text text default '',
  source_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid;
  operator_row record;
  resolved_audience text := 'customer';
  resolved_payload jsonb;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  select credential.connection_id into robot_connection
  from public.connection_robot_credentials credential
  where credential.auth_user_id = auth.uid()
    and credential.organization_id = robot_org
    and credential.status = 'active'
  limit 1;
  if robot_connection is null then raise exception 'active robot connection required'; end if;
  if trim(coalesce(requester_phone, '')) <> '' then
    select * into operator_row from public.nucleo_operator_context(requester_phone) limit 1;
    if found and operator_row.organization_id = robot_org then resolved_audience := 'internal'; end if;
  end if;
  resolved_payload := private.intelligence_payload(
    robot_org, resolved_audience, 'whatsapp', conversation_key_hash,
    left(coalesce(incoming_text, ''), 2000), coalesce(source_data, '{}'::jsonb), true
  );
  update public.conversation_intelligence_contexts context
  set connection_id = robot_connection
  where context.organization_id = robot_org
    and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_intelligence_context_resolve.conversation_key_hash
    and context.state = 'active';
  return resolved_payload || jsonb_build_object('conexaoId', robot_connection);
end;
$$;

create or replace function public.intelligence_internal_context(
  target_organization uuid,
  conversation_key_hash text,
  incoming_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_org_member(target_organization) then
    raise exception 'active organization membership required';
  end if;
  return private.intelligence_payload(
    target_organization, 'internal', 'web', conversation_key_hash,
    left(coalesce(incoming_text, ''), 2000), '{}'::jsonb, true
  );
end;
$$;

create or replace function public.intelligence_skill_rollback(
  target_skill uuid,
  target_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  skill_row public.skill_definitions%rowtype;
  version_row public.skill_versions%rowtype;
  restored_row public.skill_definitions%rowtype;
begin
  select * into skill_row from public.skill_definitions skill
  where skill.id = target_skill and skill.owner_type = 'organization'
  limit 1 for update;
  if not found or not private.can_manage_org(skill_row.organization_id) then
    raise exception 'organization skill management required';
  end if;
  select * into version_row from public.skill_versions version
  where version.skill_id = skill_row.id and version.version = target_version
  limit 1;
  if not found then raise exception 'skill version not found'; end if;
  update public.skill_definitions skill set
    name = version_row.name,
    description = version_row.description,
    audience = version_row.audience,
    status = version_row.status,
    spec = version_row.spec,
    updated_by = auth.uid()
  where skill.id = skill_row.id
  returning * into restored_row;
  return jsonb_build_object(
    'status', 'restored', 'skillId', restored_row.id,
    'restoredFromVersion', target_version,
    'newVersion', restored_row.current_version
  );
end;
$$;

create or replace function public.nucleo_contextual_knowledge_search(
  conversation_key_hash text,
  requester_phone text,
  search_query text default '',
  page_limit integer default 10,
  page_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  operator_row record;
  normalized_query text := left(trim(coalesce(search_query, '')), 200);
  safe_limit integer := least(greatest(coalesce(page_limit, 10), 1), 30);
  safe_offset integer := least(greatest(coalesce(page_offset, 0), 0), 3000);
  query_terms tsquery;
  result_rows jsonb;
  result_total integer;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if conversation_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid conversation context key'; end if;
  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_contextual_knowledge_search.conversation_key_hash
    and context.state = 'active' limit 1;
  if not found then raise exception 'resolve intelligence context before searching knowledge'; end if;
  if context_row.audience = 'internal' then
    select * into operator_row from public.nucleo_operator_context(requester_phone) limit 1;
    if not found or operator_row.organization_id <> robot_org then raise exception 'verified operator context required'; end if;
  end if;
  if normalized_query <> '' then query_terms := websearch_to_tsquery('portuguese', normalized_query); end if;

  select count(distinct document.id)::integer into result_total
  from public.knowledge_documents document
  where document.organization_id = robot_org and document.deleted_at is null and document.status = 'active'
    and (
      (context_row.audience = 'internal' and document.audience = 'internal'
        and (document.scope_type <> 'personal' or document.scope_user_id = operator_row.user_id))
      or (context_row.audience = 'customer' and document.audience = 'external' and exists (
        select 1 from public.knowledge_document_collections membership
        join public.knowledge_collections collection
          on collection.id = membership.collection_id and collection.organization_id = membership.organization_id
        where membership.organization_id = robot_org and membership.document_id = document.id
          and collection.status = 'active' and collection.audience = 'external'
          and (collection.scope_type <> 'campaign' or exists (
            select 1 from public.campaign_knowledge_collections binding
            where binding.organization_id = robot_org and binding.collection_id = collection.id
              and binding.campaign_id = context_row.campaign_id
          ))
      ))
    )
    and (normalized_query = '' or document.search_vector @@ query_terms
      or document.title ilike '%' || normalized_query || '%' or document.path ilike '%' || normalized_query || '%');

  select coalesce(jsonb_agg(to_jsonb(found_row) order by found_row.relevance desc, found_row.updated_at desc), '[]'::jsonb)
  into result_rows
  from (
    select distinct on (document.id)
      document.id as "documentoId", document.title as titulo, document.path as caminho,
      left(document.content_markdown, 700) as trecho, document.version as versao,
      document.updated_at,
      case when normalized_query = '' then 0::real else ts_rank(document.search_vector, query_terms) end as relevance
    from public.knowledge_documents document
    where document.organization_id = robot_org and document.deleted_at is null and document.status = 'active'
      and (
        (context_row.audience = 'internal' and document.audience = 'internal'
          and (document.scope_type <> 'personal' or document.scope_user_id = operator_row.user_id))
        or (context_row.audience = 'customer' and document.audience = 'external' and exists (
          select 1 from public.knowledge_document_collections membership
          join public.knowledge_collections collection
            on collection.id = membership.collection_id and collection.organization_id = membership.organization_id
          where membership.organization_id = robot_org and membership.document_id = document.id
            and collection.status = 'active' and collection.audience = 'external'
            and (collection.scope_type <> 'campaign' or exists (
              select 1 from public.campaign_knowledge_collections binding
              where binding.organization_id = robot_org and binding.collection_id = collection.id
                and binding.campaign_id = context_row.campaign_id
            ))
        ))
      )
      and (normalized_query = '' or document.search_vector @@ query_terms
        or document.title ilike '%' || normalized_query || '%' or document.path ilike '%' || normalized_query || '%')
    order by document.id, relevance desc, document.updated_at desc
    limit safe_limit offset safe_offset
  ) found_row;

  return jsonb_build_object(
    'schemaVersion', 'fase-h-1', 'audiencia', context_row.audience,
    'campanhaId', context_row.campaign_id, 'documentos', result_rows,
    'paginacao', jsonb_build_object('total', result_total, 'limite', safe_limit,
      'offset', safe_offset, 'temMais', safe_offset + safe_limit < result_total)
  );
end;
$$;

create or replace function public.nucleo_contextual_knowledge_document(
  conversation_key_hash text,
  requester_phone text,
  target_document uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  operator_row record;
  document_row public.knowledge_documents%rowtype;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_contextual_knowledge_document.conversation_key_hash
    and context.state = 'active' limit 1;
  if not found then raise exception 'resolve intelligence context before reading knowledge'; end if;
  if context_row.audience = 'internal' then
    select * into operator_row from public.nucleo_operator_context(requester_phone) limit 1;
    if not found or operator_row.organization_id <> robot_org then raise exception 'verified operator context required'; end if;
  end if;
  select document.* into document_row
  from public.knowledge_documents document
  where document.id = target_document and document.organization_id = robot_org
    and document.deleted_at is null and document.status = 'active'
    and (
      (context_row.audience = 'internal' and document.audience = 'internal'
        and (document.scope_type <> 'personal' or document.scope_user_id = operator_row.user_id))
      or (context_row.audience = 'customer' and document.audience = 'external' and exists (
        select 1 from public.knowledge_document_collections membership
        join public.knowledge_collections collection
          on collection.id = membership.collection_id and collection.organization_id = membership.organization_id
        where membership.organization_id = robot_org and membership.document_id = document.id
          and collection.status = 'active' and collection.audience = 'external'
          and (collection.scope_type <> 'campaign' or exists (
            select 1 from public.campaign_knowledge_collections binding
            where binding.organization_id = robot_org and binding.collection_id = collection.id
              and binding.campaign_id = context_row.campaign_id
          ))
      ))
    );
  if not found then raise exception 'knowledge document not found or not allowed'; end if;
  return jsonb_build_object(
    'schemaVersion', 'fase-h-1', 'documentoId', document_row.id,
    'titulo', document_row.title, 'caminho', document_row.path,
    'conteudoMarkdown', document_row.content_markdown,
    'versao', document_row.version, 'atualizadoEm', document_row.updated_at
  );
end;
$$;

create or replace function public.nucleo_customer_qualification_update(
  conversation_key_hash text,
  requester_phone text,
  customer_name text default '',
  customer_company text default '',
  customer_email text default '',
  qualification_status text default 'collecting',
  qualification_answers jsonb default '{}'::jsonb,
  qualification_score numeric default null,
  tag_slugs text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  contact_row public.contacts%rowtype;
  normalized_phone text := regexp_replace(coalesce(requester_phone, ''), '[^0-9]', '', 'g');
  safe_name text := left(trim(coalesce(customer_name, '')), 180);
  safe_company text := left(trim(coalesce(customer_company, '')), 180);
  safe_email text := left(lower(trim(coalesce(customer_email, ''))), 320);
  safe_tags text[] := coalesce(tag_slugs, '{}'::text[]);
  qualification_id uuid;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if length(normalized_phone) not between 10 and 15 then raise exception 'valid customer phone required'; end if;
  if qualification_status not in ('collecting', 'qualified', 'disqualified', 'needs_human') then raise exception 'invalid qualification status'; end if;
  if jsonb_typeof(coalesce(qualification_answers, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(qualification_answers, '{}'::jsonb)::text) > 16384 then
    raise exception 'invalid qualification answers';
  end if;
  if qualification_score is not null and (qualification_score < 0 or qualification_score > 100) then
    raise exception 'qualification score must be between 0 and 100';
  end if;
  if cardinality(safe_tags) > 10 then raise exception 'at most ten tags may be applied'; end if;

  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_qualification_update.conversation_key_hash
    and context.state = 'active' and context.audience = 'customer' limit 1;
  if not found then raise exception 'active customer intelligence context required'; end if;
  if not exists (
    select 1
    from public.skill_definitions skill
    cross join lateral jsonb_array_elements_text(
      coalesce(skill.spec -> 'allowedTools', '[]'::jsonb)
    ) allowed_tool(value)
    where skill.id = context_row.active_skill_id
      and skill.status = 'published'
      and allowed_tool.value in ('crm.contact.upsert', 'crm.tag.apply', 'crm.deal.qualify')
  ) then
    raise exception 'active skill does not allow CRM qualification';
  end if;

  select * into contact_row from public.contacts contact
  where contact.organization_id = robot_org and contact.deleted_at is null
    and regexp_replace(contact.phone, '[^0-9]', '', 'g') = normalized_phone
  limit 1 for update;
  if not found then
    insert into public.contacts (
      organization_id, name, phone, company, email, source, created_by, updated_by
    ) values (
      robot_org, coalesce(nullif(safe_name, ''), 'Contato WhatsApp'), normalized_phone,
      safe_company, nullif(safe_email, ''),
      case when context_row.campaign_id is null then 'WhatsApp' else 'Campanha WhatsApp' end,
      auth.uid(), auth.uid()
    ) returning * into contact_row;
  else
    update public.contacts contact set
      name = coalesce(nullif(safe_name, ''), contact.name),
      company = coalesce(nullif(safe_company, ''), contact.company),
      email = coalesce(nullif(safe_email, ''), contact.email),
      last_interaction_at = now(), updated_by = auth.uid()
    where contact.id = contact_row.id returning * into contact_row;
  end if;

  update public.conversation_intelligence_contexts context
  set contact_id = contact_row.id, last_message_at = now()
  where context.id = context_row.id;

  insert into public.contact_qualifications (
    organization_id, contact_id, campaign_id, context_id, status, answers, score
  ) values (
    robot_org, contact_row.id, context_row.campaign_id, context_row.id,
    qualification_status, coalesce(qualification_answers, '{}'::jsonb), qualification_score
  ) on conflict (organization_id, context_id) do update set
    contact_id = excluded.contact_id, campaign_id = excluded.campaign_id,
    status = excluded.status, answers = excluded.answers, score = excluded.score,
    updated_at = now()
  returning id into qualification_id;

  insert into public.contact_tags (organization_id, contact_id, tag_id)
  select robot_org, contact_row.id, tag.id
  from public.tags tag
  where tag.organization_id = robot_org and tag.deleted_at is null
    and (lower(tag.legacy_id) = any(select lower(item) from unnest(safe_tags) item)
      or lower(tag.name) = any(select lower(item) from unnest(safe_tags) item))
  on conflict (contact_id, tag_id) do nothing;

  return jsonb_build_object(
    'status', 'updated', 'contactId', contact_row.id,
    'qualificationId', qualification_id, 'campaignId', context_row.campaign_id,
    'message', 'Qualificação registrada no CRM.'
  );
end;
$$;

create or replace function public.nucleo_customer_handoff_request(
  conversation_key_hash text,
  requester_phone text,
  handoff_reason text,
  handoff_summary text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  context_row public.conversation_intelligence_contexts%rowtype;
  request_id uuid;
begin
  if robot_org is null then raise exception 'active robot credential required'; end if;
  if handoff_reason not in ('requested_human', 'low_confidence', 'sensitive_topic', 'commercial_exception', 'tool_unavailable', 'skill_limit') then
    raise exception 'invalid handoff reason';
  end if;
  select * into context_row from public.conversation_intelligence_contexts context
  where context.organization_id = robot_org and context.channel = 'whatsapp'
    and context.conversation_key_hash = nucleo_customer_handoff_request.conversation_key_hash
    and context.state in ('active', 'handed_off') and context.audience = 'customer'
  order by case when context.state = 'active' then 0 else 1 end
  limit 1 for update;
  if not found then raise exception 'customer intelligence context required'; end if;
  if context_row.state = 'handed_off' then
    select request.id into request_id
    from public.customer_handoff_requests request
    where request.organization_id = robot_org and request.context_id = context_row.id
      and request.status in ('requested', 'accepted')
    limit 1;
    return jsonb_build_object(
      'status', 'handoff_requested', 'handoffId', request_id,
      'reason', handoff_reason, 'alreadyRequested', true,
      'message', 'A transferência humana já estava solicitada.'
    );
  end if;
  update public.conversation_intelligence_contexts set state = 'handed_off', updated_at = now()
  where id = context_row.id;
  insert into public.customer_handoff_requests (
    organization_id, connection_id, contact_id, context_id, reason_code, summary
  ) values (
    robot_org, context_row.connection_id, context_row.contact_id, context_row.id,
    handoff_reason, left(trim(coalesce(handoff_summary, '')), 1000)
  ) on conflict (organization_id, context_id) where status in ('requested', 'accepted')
    do update set reason_code = excluded.reason_code, summary = excluded.summary
  returning id into request_id;
  return jsonb_build_object(
    'status', 'handoff_requested', 'handoffId', request_id,
    'reason', handoff_reason,
    'message', 'Transferência humana solicitada; a automação deve encerrar este atendimento.'
  );
end;
$$;

revoke all on function public.intelligence_context_preview(uuid, text, text, jsonb) from public;
revoke all on function public.nucleo_intelligence_context_resolve(text, text, text, jsonb) from public;
revoke all on function public.intelligence_internal_context(uuid, text, text) from public;
revoke all on function public.intelligence_skill_rollback(uuid, integer) from public;
revoke all on function public.nucleo_contextual_knowledge_search(text, text, text, integer, integer) from public;
revoke all on function public.nucleo_contextual_knowledge_document(text, text, uuid) from public;
revoke all on function public.nucleo_customer_qualification_update(text, text, text, text, text, text, jsonb, numeric, text[]) from public;
revoke all on function public.nucleo_customer_handoff_request(text, text, text, text) from public;
grant execute on function public.intelligence_context_preview(uuid, text, text, jsonb) to authenticated;
grant execute on function public.nucleo_intelligence_context_resolve(text, text, text, jsonb) to authenticated;
grant execute on function public.intelligence_internal_context(uuid, text, text) to authenticated;
grant execute on function public.intelligence_skill_rollback(uuid, integer) to authenticated;
grant execute on function public.nucleo_contextual_knowledge_search(text, text, text, integer, integer) to authenticated;
grant execute on function public.nucleo_contextual_knowledge_document(text, text, uuid) to authenticated;
grant execute on function public.nucleo_customer_qualification_update(text, text, text, text, text, text, jsonb, numeric, text[]) to authenticated;
grant execute on function public.nucleo_customer_handoff_request(text, text, text, text) to authenticated;

commit;
