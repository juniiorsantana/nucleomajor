-- Núcleo de Conhecimento multiempresa: Markdown virtual com herança e versões.

begin;

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_type text not null check (scope_type in ('organization', 'team', 'personal')),
  scope_user_id uuid references public.profiles(id) on delete cascade,
  path text not null,
  title text not null,
  content_markdown text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_vector tsvector generated always as (
    setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(path, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(content_markdown, '')), 'C')
  ) stored,
  unique (id, organization_id),
  check (
    (scope_type = 'personal' and scope_user_id is not null)
    or (scope_type in ('organization', 'team') and scope_user_id is null)
  ),
  check (length(path) between 4 and 500),
  check (path = trim(path)),
  check (path ~ '^[^/].*\\.md$'),
  check (path !~ '(^|/)\\.{1,2}(/|$)' and path !~ '//'),
  check (length(trim(title)) between 1 and 180),
  check (octet_length(content_markdown) <= 1048576)
);

create unique index knowledge_documents_active_path_unique
  on public.knowledge_documents (
    organization_id,
    scope_type,
    coalesce(scope_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(path)
  )
  where deleted_at is null;

create index knowledge_documents_scope_idx
  on public.knowledge_documents (organization_id, scope_type, scope_user_id, updated_at desc)
  where deleted_at is null;

create index knowledge_documents_search_idx
  on public.knowledge_documents using gin (search_vector)
  where deleted_at is null and status = 'active';

create table public.knowledge_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  organization_id uuid not null,
  version bigint not null check (version > 0),
  scope_type text not null check (scope_type in ('organization', 'team', 'personal')),
  scope_user_id uuid references public.profiles(id) on delete cascade,
  path text not null,
  title text not null,
  content_markdown text not null,
  status text not null check (status in ('active', 'archived')),
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (document_id, organization_id)
    references public.knowledge_documents(id, organization_id) on delete cascade,
  unique (document_id, version),
  check (
    (scope_type = 'personal' and scope_user_id is not null)
    or (scope_type in ('organization', 'team') and scope_user_id is null)
  )
);

create index knowledge_document_versions_lookup_idx
  on public.knowledge_document_versions (organization_id, document_id, version desc);

create or replace function private.touch_knowledge_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  new.updated_by = auth.uid();
  return new;
end;
$$;

create or replace function private.capture_knowledge_document_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.knowledge_document_versions (
    document_id,
    organization_id,
    version,
    scope_type,
    scope_user_id,
    path,
    title,
    content_markdown,
    status,
    changed_by,
    created_at
  ) values (
    new.id,
    new.organization_id,
    new.version,
    new.scope_type,
    new.scope_user_id,
    new.path,
    new.title,
    new.content_markdown,
    new.status,
    new.updated_by,
    new.updated_at
  );
  return new;
end;
$$;

create trigger knowledge_documents_touch
before update on public.knowledge_documents
for each row execute function private.touch_knowledge_document();

create trigger knowledge_documents_capture_version
after insert or update on public.knowledge_documents
for each row execute function private.capture_knowledge_document_version();

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_document_versions enable row level security;

revoke all on public.knowledge_documents from anon;
revoke all on public.knowledge_document_versions from anon;
revoke all on public.knowledge_document_versions from authenticated;
grant select, insert, update on public.knowledge_documents to authenticated;
grant select on public.knowledge_document_versions to authenticated;

create policy knowledge_documents_select
on public.knowledge_documents for select to authenticated
using (
  private.is_org_member(organization_id)
  and (scope_type <> 'personal' or scope_user_id = auth.uid())
);

create policy knowledge_documents_insert
on public.knowledge_documents for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and (
    (scope_type in ('organization', 'team') and private.can_manage_org(organization_id))
    or (scope_type = 'personal' and scope_user_id = auth.uid())
  )
);

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
    or (scope_type = 'personal' and scope_user_id = auth.uid())
  )
);

create policy knowledge_document_versions_select
on public.knowledge_document_versions for select to authenticated
using (
  private.is_org_member(organization_id)
  and (scope_type <> 'personal' or scope_user_id = auth.uid())
);

create or replace function public.nucleo_knowledge_search(
  operator_phone text,
  search_query text default '',
  scope_filter text default 'todos',
  page_limit integer default 10,
  page_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operator record;
  normalized_query text := left(trim(coalesce(search_query, '')), 200);
  normalized_scope text := lower(trim(coalesce(scope_filter, 'todos')));
  safe_limit integer := least(greatest(coalesce(page_limit, 10), 1), 30);
  safe_offset integer := least(greatest(coalesce(page_offset, 0), 0), 3000);
  query_terms tsquery;
  result_rows jsonb;
  result_total integer;
begin
  if normalized_scope not in ('todos', 'organization', 'team', 'personal') then
    raise exception 'invalid knowledge scope';
  end if;

  select * into operator
  from public.nucleo_operator_context(operator_phone);
  if not found then
    raise exception 'verified operator context required';
  end if;

  if normalized_query <> '' then
    query_terms := websearch_to_tsquery('portuguese', normalized_query);
  end if;

  select count(*)::integer into result_total
  from public.knowledge_documents document
  where document.organization_id = operator.organization_id
    and document.deleted_at is null
    and document.status = 'active'
    and (normalized_scope = 'todos' or document.scope_type = normalized_scope)
    and (document.scope_type <> 'personal' or document.scope_user_id = operator.user_id)
    and (
      normalized_query = ''
      or document.search_vector @@ query_terms
      or document.title ilike '%' || normalized_query || '%'
      or document.path ilike '%' || normalized_query || '%'
    );

  select coalesce(jsonb_agg(to_jsonb(matched_row) order by matched_row.relevance desc, matched_row.updated_at desc), '[]'::jsonb)
  into result_rows
  from (
    select
      document.id as "documentoId",
      document.scope_type as escopo,
      document.path as caminho,
      document.title as titulo,
      left(document.content_markdown, 500) as trecho,
      document.version as versao,
      document.updated_at,
      case
        when normalized_query = '' then 0::real
        else ts_rank(document.search_vector, query_terms)
      end as relevance
    from public.knowledge_documents document
    where document.organization_id = operator.organization_id
      and document.deleted_at is null
      and document.status = 'active'
      and (normalized_scope = 'todos' or document.scope_type = normalized_scope)
      and (document.scope_type <> 'personal' or document.scope_user_id = operator.user_id)
      and (
        normalized_query = ''
        or document.search_vector @@ query_terms
        or document.title ilike '%' || normalized_query || '%'
        or document.path ilike '%' || normalized_query || '%'
      )
    order by relevance desc, document.updated_at desc
    limit safe_limit offset safe_offset
  ) matched_row;

  return jsonb_build_object(
    'documentos', result_rows,
    'paginacao', jsonb_build_object(
      'total', result_total,
      'limite', safe_limit,
      'offset', safe_offset,
      'temMais', safe_offset + safe_limit < result_total
    )
  );
end;
$$;

create or replace function public.nucleo_knowledge_document(
  operator_phone text,
  target_document uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operator record;
  document public.knowledge_documents%rowtype;
begin
  select * into operator
  from public.nucleo_operator_context(operator_phone);
  if not found then
    raise exception 'verified operator context required';
  end if;

  select item.* into document
  from public.knowledge_documents item
  where item.id = target_document
    and item.organization_id = operator.organization_id
    and item.deleted_at is null
    and item.status = 'active'
    and (item.scope_type <> 'personal' or item.scope_user_id = operator.user_id);
  if not found then
    raise exception 'knowledge document not found or not allowed';
  end if;

  return jsonb_build_object(
    'documentoId', document.id,
    'escopo', document.scope_type,
    'caminho', document.path,
    'titulo', document.title,
    'conteudoMarkdown', document.content_markdown,
    'versao', document.version,
    'atualizadoEm', document.updated_at
  );
end;
$$;

revoke all on function public.nucleo_knowledge_search(text, text, text, integer, integer) from public;
revoke all on function public.nucleo_knowledge_document(text, uuid) from public;
grant execute on function public.nucleo_knowledge_search(text, text, text, integer, integer) to authenticated;
grant execute on function public.nucleo_knowledge_document(text, uuid) to authenticated;

commit;
