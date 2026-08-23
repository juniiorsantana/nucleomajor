-- Corrige conflito entre o alias da busca e a variável PL/pgSQL FOUND.

begin;

create or replace function public.nucleo_knowledge_search(
  operator_phone text,
  search_query text default '',
  scope_filter text default 'todos',
  page_limit integer default 10,
  page_offset integer default 0
)r
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

  select coalesce(
    jsonb_agg(
      to_jsonb(matched_row)
      order by matched_row.relevance desc, matched_row.updated_at desc
    ),
    '[]'::jsonb
  )
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

revoke all on function public.nucleo_knowledge_search(text, text, text, integer, integer) from public;
grant execute on function public.nucleo_knowledge_search(text, text, text, integer, integer) to authenticated;

commit;
