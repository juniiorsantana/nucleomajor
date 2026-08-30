-- Conteúdo publicado para clientes passa a ser visível também para a equipe.
--
-- Havia uma assimetria entre os dois leitores internos:
--
--   nucleo_web_knowledge_search        (assistente do portal)
--     document.audience = 'internal' OR (external com coleção externa ativa)
--
--   nucleo_contextual_knowledge_search (operador no WhatsApp)
--     context.audience = 'internal' AND document.audience = 'internal'
--
-- Ou seja: a tabela de preços publicada para clientes aparecia para quem
-- perguntasse pelo portal e sumia para quem atendesse pelo celular — que é
-- justamente quem mais precisa dela na mão. A saída que sobrava para o
-- usuário era duplicar o documento em duas audiências, e duas cópias divergem
-- na primeira edição: a cópia externa desatualizada faz o cliente receber
-- informação errada com confiança total.
--
-- Depois disto, `external` passa a significar "também visível para clientes",
-- e não "deixou de ser da equipe". A categoria "compartilhado" fica
-- representável sem coluna nova, sem migração de dados e sem duplicação.
--
-- O QUE NÃO MUDA, e é o que importa para a segurança:
--
--   * o ramo `customer` está intacto. Continua exigindo
--     `document.audience = 'external'` mais coleção externa ativa mais, se a
--     coleção for de campanha, vínculo com a campanha do contexto. Nenhum
--     documento passa a ser alcançável por cliente que já não fosse;
--   * `published_at is not null` continua valendo nos dois ramos: rascunho não
--     chega a runtime nenhum;
--   * a cláusula de escopo pessoal continua fora do bloco de audiência, onde
--     um ramo novo não pode esquecer de repeti-la.
--
-- A audiência é escrita como `in ('internal', 'external')` e não pela remoção
-- da condição. São hoje os dois únicos valores que o CHECK admite, mas um
-- terceiro valor futuro precisa ser considerado de propósito, e não herdado
-- por omissão.

begin;

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
      (context_row.audience = 'internal' and document.audience in ('internal', 'external')
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
        (context_row.audience = 'internal' and document.audience in ('internal', 'external')
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
      (context_row.audience = 'internal' and document.audience in ('internal', 'external')
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

revoke all on function public.nucleo_contextual_knowledge_search(text, text, text, integer, integer) from public;
grant execute on function public.nucleo_contextual_knowledge_search(text, text, text, integer, integer) to authenticated;
revoke all on function public.nucleo_contextual_knowledge_document(text, text, uuid) from public;
grant execute on function public.nucleo_contextual_knowledge_document(text, text, uuid) to authenticated;

commit;
