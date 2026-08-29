-- Conhecimento seguro: rascunhos nunca chegam ao runtime e documento +
-- coleções são persistidos na mesma transação.

begin;

create or replace function public.nucleo_knowledge_save(
  target_organization uuid,
  target_document uuid default null,
  document_scope text default 'personal',
  document_path text default '',
  document_title text default '',
  document_content text default '',
  document_audience text default 'internal',
  collection_ids uuid[] default '{}'::uuid[],
  publish_document boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_document public.knowledge_documents%rowtype;
  saved_document public.knowledge_documents%rowtype;
  normalized_scope text := lower(trim(coalesce(document_scope, '')));
  normalized_path text := trim(coalesce(document_path, ''));
  normalized_title text := trim(coalesce(document_title, ''));
  normalized_audience text := lower(trim(coalesce(document_audience, '')));
  safe_collection_ids uuid[];
  valid_collection_count integer := 0;
  published_at_value timestamptz := null;
  published_by_value uuid := null;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  if not private.is_org_member(target_organization) then raise exception 'organization membership required'; end if;
  if normalized_scope not in ('organization', 'team', 'personal') then raise exception 'invalid knowledge scope'; end if;
  if normalized_audience not in ('internal', 'external') then raise exception 'invalid knowledge audience'; end if;
  if normalized_title = '' then raise exception 'knowledge title required'; end if;
  if normalized_path = '' then raise exception 'knowledge path required'; end if;
  if normalized_scope = 'personal' and normalized_audience <> 'internal' then
    raise exception 'personal knowledge must remain internal';
  end if;
  if normalized_scope <> 'personal' and not private.can_manage_org(target_organization) then
    raise exception 'organization knowledge requires administrator role';
  end if;

  if target_document is not null then
    select document.* into existing_document
    from public.knowledge_documents document
    where document.id = target_document
      and document.organization_id = target_organization
      and document.deleted_at is null
    for update;
    if not found then raise exception 'knowledge document not found'; end if;
    if existing_document.scope_type = 'personal' and existing_document.scope_user_id <> actor_id then
      raise exception 'personal knowledge belongs to another user';
    end if;
    if existing_document.scope_type <> 'personal' and not private.can_manage_org(target_organization) then
      raise exception 'organization knowledge requires administrator role';
    end if;
  end if;

  select coalesce(array_agg(distinct item.id), '{}'::uuid[])
    into safe_collection_ids
  from unnest(coalesce(collection_ids, '{}'::uuid[])) item(id);

  if normalized_scope = 'personal' and cardinality(safe_collection_ids) > 0 then
    raise exception 'personal knowledge cannot be assigned to collections';
  end if;

  if cardinality(safe_collection_ids) > 0 then
    select count(*)::integer into valid_collection_count
    from public.knowledge_collections collection
    where collection.organization_id = target_organization
      and collection.id = any(safe_collection_ids)
      and collection.status = 'active'
      and collection.scope_type <> 'personal'
      and collection.audience = normalized_audience;
    if valid_collection_count <> cardinality(safe_collection_ids) then
      raise exception 'knowledge collection is invalid for this audience';
    end if;
  end if;

  if publish_document and normalized_audience = 'external' and cardinality(safe_collection_ids) = 0 then
    raise exception 'published external knowledge requires an external collection';
  end if;

  if publish_document then
    published_at_value := coalesce(existing_document.published_at, now());
    published_by_value := coalesce(existing_document.published_by, actor_id);
  end if;

  if target_document is null then
    insert into public.knowledge_documents (
      organization_id, scope_type, scope_user_id, path, title,
      content_markdown, status, audience, published_at, published_by,
      created_by, updated_by
    ) values (
      target_organization, normalized_scope,
      case when normalized_scope = 'personal' then actor_id else null end,
      normalized_path, normalized_title, coalesce(document_content, ''),
      'active', normalized_audience, published_at_value, published_by_value,
      actor_id, actor_id
    ) returning * into saved_document;
  else
    update public.knowledge_documents document set
      scope_type = normalized_scope,
      scope_user_id = case when normalized_scope = 'personal' then actor_id else null end,
      path = normalized_path,
      title = normalized_title,
      content_markdown = coalesce(document_content, ''),
      status = 'active',
      audience = normalized_audience,
      published_at = published_at_value,
      published_by = published_by_value,
      updated_by = actor_id
    where document.id = target_document
      and document.organization_id = target_organization
    returning * into saved_document;
  end if;

  delete from public.knowledge_document_collections membership
  where membership.organization_id = target_organization
    and membership.document_id = saved_document.id;

  if cardinality(safe_collection_ids) > 0 then
    insert into public.knowledge_document_collections (
      organization_id, collection_id, document_id, added_by
    )
    select target_organization, item.id, saved_document.id, actor_id
    from unnest(safe_collection_ids) item(id);
  end if;

  return to_jsonb(saved_document) - 'search_vector';
end;
$$;

-- Vínculos passam exclusivamente pela RPC transacional. As policies ficam
-- restritas também, para que um grant acidental futuro não reabra a brecha.
revoke insert, update, delete on public.knowledge_document_collections from authenticated;
drop policy if exists knowledge_document_collections_insert on public.knowledge_document_collections;
create policy knowledge_document_collections_insert on public.knowledge_document_collections
for insert to authenticated with check (private.can_manage_org(organization_id));
drop policy if exists knowledge_document_collections_update on public.knowledge_document_collections;
create policy knowledge_document_collections_update on public.knowledge_document_collections
for update to authenticated using (private.can_manage_org(organization_id))
with check (private.can_manage_org(organization_id));
drop policy if exists knowledge_document_collections_delete on public.knowledge_document_collections;
create policy knowledge_document_collections_delete on public.knowledge_document_collections
for delete to authenticated using (private.can_manage_org(organization_id));


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
  where document.organization_id = robot_org
    and document.deleted_at is null
    and document.status = 'active'
    and document.published_at is not null
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
    where document.organization_id = robot_org
      and document.deleted_at is null
      and document.status = 'active'
      and document.published_at is not null
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
    'schemaVersion', 'fase-h-2', 'audiencia', context_row.audience,
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
    and document.deleted_at is null
    and document.status = 'active'
    and document.published_at is not null
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
    'schemaVersion', 'fase-h-2', 'documentoId', document_row.id,
    'titulo', document_row.title, 'caminho', document_row.path,
    'conteudoMarkdown', document_row.content_markdown,
    'versao', document_row.version, 'atualizadoEm', document_row.updated_at
  );
end;
$$;

revoke all on function public.nucleo_knowledge_save(uuid, uuid, text, text, text, text, text, uuid[], boolean) from public;
grant execute on function public.nucleo_knowledge_save(uuid, uuid, text, text, text, text, text, uuid[], boolean) to authenticated;
revoke all on function public.nucleo_contextual_knowledge_search(text, text, text, integer, integer) from public;
grant execute on function public.nucleo_contextual_knowledge_search(text, text, text, integer, integer) to authenticated;
revoke all on function public.nucleo_contextual_knowledge_document(text, text, uuid) from public;
grant execute on function public.nucleo_contextual_knowledge_document(text, text, uuid) to authenticated;

commit;
