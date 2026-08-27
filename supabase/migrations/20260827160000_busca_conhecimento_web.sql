-- Busca de conhecimento do assistente web, autenticada por auth.uid().
--
-- As duas buscas que já existiam autenticam pelo robô do WhatsApp:
-- public.nucleo_knowledge_search (20260823010000) exige telefone de operador
-- verificado, e public.nucleo_contextual_knowledge_search (20260823120000)
-- exige, além disso, private.robot_organization() e o hash de uma conversa
-- ativa. O servidor web não tem nenhum dos três: ele carrega token de usuário.
-- Chamar qualquer uma delas de lá levanta exceção. Por isso existe esta.
--
-- A semântica de audiência é copiada de nucleo_contextual_knowledge_search —
-- inclusive a cadeia de coleção do conteúdo externo. Só a autenticação muda.
--
-- O que cada cargo enxerga: owner, admin e member leem o mesmo conjunto.
-- A diferença de cargo no conhecimento é de escrita, não de leitura — a
-- policy knowledge_documents_select (20260823010000) já define assim, e estas
-- funções são security definer, ou seja, passam por cima da RLS. Ampliar aqui
-- abriria um buraco que a tabela nega; estreitar por cargo inventaria uma
-- regra de produto que ninguém pediu. O cargo volta no retorno para o
-- chamador saber com que permissão a lista foi montada.

begin;

create or replace function public.nucleo_web_knowledge_search(
  target_organization uuid,
  search_query text default '',
  result_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_role public.organization_role;
  normalized_query text := left(trim(coalesce(search_query, '')), 400);
  -- Cinco é o teto do contrato: o assistente injeta três no prompt e guarda os
  -- outros dois para citar quando o usuário pedir mais sobre o mesmo assunto.
  safe_limit integer := least(greatest(coalesce(result_limit, 5), 1), 5);
  snippet_limit constant integer := 900;
  query_terms tsquery;
  result_rows jsonb;
  result_total integer;
  returned_count integer;
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;
  member_role := private.org_role(target_organization);

  if normalized_query <> '' then
    query_terms := websearch_to_tsquery('portuguese', normalized_query);
  end if;

  -- Pergunta vazia devolve conhecimento vazio, de propósito. O caminho antigo
  -- despejava os doze documentos mais recentes mesmo sem relação com a
  -- conversa; era isso que fazia o custo de contexto crescer com o acervo.
  -- numnode() pega também a pergunta que virou nada depois das stopwords
  -- ("o que é que é isso?"): sem esta guarda ela viraria um @@ que não casa
  -- com nada e ainda assim paga a varredura.
  if query_terms is null or numnode(query_terms) = 0 then
    return jsonb_build_object(
      'schemaVersion', 'busca-web-1',
      'cargo', member_role::text,
      'consulta', normalized_query,
      'documentos', '[]'::jsonb,
      'cobertura', jsonb_build_object(
        'total', 0, 'retornados', 0, 'limite', safe_limit, 'temMais', false
      )
    );
  end if;

  select count(*)::integer into result_total
  from public.knowledge_documents document
  where document.organization_id = target_organization
    and document.deleted_at is null
    and document.status = 'active'
    -- Cláusula sozinha que impede ler o pessoal de terceiro. Fica fora do
    -- bloco de audiência de propósito: dentro dele bastaria um ramo novo
    -- esquecer a cópia para o documento pessoal de outra pessoa vazar.
    and (document.scope_type <> 'personal' or document.scope_user_id = auth.uid())
    and (
      document.audience = 'internal'
      or (
        document.audience = 'external'
        and document.published_at is not null
        and exists (
          select 1
          from public.knowledge_document_collections membership
          join public.knowledge_collections collection
            on collection.id = membership.collection_id
           and collection.organization_id = membership.organization_id
          where membership.organization_id = target_organization
            and membership.document_id = document.id
            and collection.status = 'active'
            and collection.audience = 'external'
            -- Coleção de campanha sem vínculo nenhum é conteúdo que nenhuma
            -- conversa alcança. Aqui não há campanha no contexto — o usuário
            -- web não está dentro de uma —, então exigimos ao menos um
            -- vínculo: senão o assistente trataria como publicado um
            -- documento que nenhum cliente jamais vai receber.
            and (
              collection.scope_type <> 'campaign'
              or exists (
                select 1 from public.campaign_knowledge_collections binding
                where binding.organization_id = target_organization
                  and binding.collection_id = collection.id
              )
            )
        )
      )
    )
    and document.search_vector @@ query_terms;

  -- ts_headline lê o markdown inteiro e não usa índice: um documento de 1 MB
  -- custa caro. Por isso ele só aparece depois do limit, sobre as cinco linhas
  -- que sobraram, nunca sobre o acervo.
  with ranked as (
    select
      document.id,
      document.title,
      document.path,
      document.scope_type,
      document.audience,
      document.version,
      document.updated_at,
      document.content_markdown,
      ts_rank(document.search_vector, query_terms) as relevance
    from public.knowledge_documents document
    where document.organization_id = target_organization
      and document.deleted_at is null
      and document.status = 'active'
      and (document.scope_type <> 'personal' or document.scope_user_id = auth.uid())
      and (
        document.audience = 'internal'
        or (
          document.audience = 'external'
          and document.published_at is not null
          and exists (
            select 1
            from public.knowledge_document_collections membership
            join public.knowledge_collections collection
              on collection.id = membership.collection_id
             and collection.organization_id = membership.organization_id
            where membership.organization_id = target_organization
              and membership.document_id = document.id
              and collection.status = 'active'
              and collection.audience = 'external'
              and (
                collection.scope_type <> 'campaign'
                or exists (
                  select 1 from public.campaign_knowledge_collections binding
                  where binding.organization_id = target_organization
                    and binding.collection_id = collection.id
                )
              )
          )
        )
      )
      and document.search_vector @@ query_terms
    order by relevance desc, document.updated_at desc
    limit safe_limit
  )
  select coalesce(
    jsonb_agg(to_jsonb(found_row) order by found_row.relevancia desc, found_row."atualizadoEm" desc),
    '[]'::jsonb
  )
  into result_rows
  from (
    select
      ranked.id as "documentoId",
      ranked.title as titulo,
      ranked.path as caminho,
      ranked.scope_type as escopo,
      ranked.audience as audiencia,
      ranked.version as versao,
      ranked.updated_at as "atualizadoEm",
      ranked.relevance as relevancia,
      left(
        -- StartSel e StopSel vazios são recusados pelo Postgres, então o
        -- destaque vira negrito de Markdown: o trecho já é Markdown e o
        -- assistente lê a marcação sem estranhar.
        ts_headline(
          'portuguese',
          ranked.content_markdown,
          query_terms,
          'StartSel="**", StopSel="**", MaxFragments=3, MaxWords=45, MinWords=20, FragmentDelimiter=" [...] "'
        ),
        snippet_limit
      ) as trecho,
      length(ranked.content_markdown) > snippet_limit as "documentoMaior"
    from ranked
  ) found_row;

  returned_count := jsonb_array_length(result_rows);

  return jsonb_build_object(
    'schemaVersion', 'busca-web-1',
    'cargo', member_role::text,
    'consulta', normalized_query,
    'documentos', result_rows,
    -- O caminho antigo cortava em doze sem dizer: o décimo terceiro documento
    -- sumia e nada avisava. 'temMais' existe para o assistente poder dizer que
    -- a resposta está parcial, em vez de afirmar que não há mais nada.
    'cobertura', jsonb_build_object(
      'total', result_total,
      'retornados', returned_count,
      'limite', safe_limit,
      'temMais', result_total > returned_count
    )
  );
end;
$$;

-- Documento inteiro, sob demanda. O trecho da busca serve para decidir; quando
-- o assistente precisa do texto completo ele pede aqui, um documento por vez,
-- em vez de carregar o acervo na entrada.
create or replace function public.nucleo_web_knowledge_document(
  target_organization uuid,
  target_document uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_row public.knowledge_documents%rowtype;
begin
  if not private.is_org_member(target_organization) then
    raise exception 'organization membership required';
  end if;

  select document.* into document_row
  from public.knowledge_documents document
  where document.id = target_document
    and document.organization_id = target_organization
    and document.deleted_at is null
    and document.status = 'active'
    and (document.scope_type <> 'personal' or document.scope_user_id = auth.uid())
    and (
      document.audience = 'internal'
      or (
        document.audience = 'external'
        and document.published_at is not null
        and exists (
          select 1
          from public.knowledge_document_collections membership
          join public.knowledge_collections collection
            on collection.id = membership.collection_id
           and collection.organization_id = membership.organization_id
          where membership.organization_id = target_organization
            and membership.document_id = document.id
            and collection.status = 'active'
            and collection.audience = 'external'
            and (
              collection.scope_type <> 'campaign'
              or exists (
                select 1 from public.campaign_knowledge_collections binding
                where binding.organization_id = target_organization
                  and binding.collection_id = collection.id
              )
            )
        )
      )
    );

  -- Mesma mensagem para "não existe" e "não pode": distinguir as duas
  -- transformaria esta função em um teste de existência de documento pessoal
  -- alheio, respondido um id por vez.
  if not found then
    raise exception 'knowledge document not found or not allowed';
  end if;

  return jsonb_build_object(
    'schemaVersion', 'busca-web-1',
    'documentoId', document_row.id,
    'titulo', document_row.title,
    'caminho', document_row.path,
    'escopo', document_row.scope_type,
    'audiencia', document_row.audience,
    'conteudoMarkdown', document_row.content_markdown,
    'versao', document_row.version,
    'atualizadoEm', document_row.updated_at
  );
end;
$$;

revoke all on function public.nucleo_web_knowledge_search(uuid, text, integer) from public;
revoke all on function public.nucleo_web_knowledge_document(uuid, uuid) from public;
grant execute on function public.nucleo_web_knowledge_search(uuid, text, integer) to authenticated;
grant execute on function public.nucleo_web_knowledge_document(uuid, uuid) to authenticated;

commit;
