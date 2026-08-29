-- Prévia da busca sobre um texto que ainda não foi salvo.
--
-- A etapa 5 do assistente de criação promete "faça uma pergunta de verdade e
-- veja o que o assistente encontraria". Ela não pode cumprir isso pela busca
-- real: o documento em teste é rascunho, e desde 20260828170000 a busca não
-- encontra rascunho. Testar pelo caminho normal devolveria "nada encontrado"
-- para todo documento, sempre — o teste diria o contrário do que a pessoa
-- precisa saber.
--
-- Então a prévia recebe o texto e monta o mesmo tsvector que a coluna gerada
-- `search_vector` monta em knowledge_documents (20260823010000): título com
-- peso A, caminho com B, conteúdo com C. Os pesos importam — um termo que só
-- aparece no título rende mais que um perdido no meio do texto, e a prévia
-- mentiria sobre a ordem se achatasse tudo.
--
-- Reproduzir isso em JavaScript seria uma imitação: o dicionário 'portuguese'
-- decide radical, acento e palavra vazia, e nenhuma reimplementação acerta a
-- mesma lista. Aqui é o mesmo Postgres, com a mesma configuração, respondendo
-- a mesma pergunta.
--
-- A função não lê nenhuma tabela: o texto vem de quem chama. Por isso não é
-- security definer e não recebe organização — não há nada que ela possa
-- vazar, porque não há nada que ela leia.

begin;

-- Espelho SQL de `searchQuery` (src/knowledgeSearch.mjs).
--
-- ACOPLAMENTO DELIBERADO: as duas precisam produzir a mesma string, senão a
-- prévia diz "este texto responde" para uma pergunta que a busca real não
-- casaria — ou o contrário, que é pior. Não dá para compartilhar a função:
-- `apps/emyleads` e `src/` são raízes de build separadas e nenhum import
-- cruza as duas hoje. Mudou uma, mude a outra.
--
-- As regras, na ordem: minúsculas; corta em tudo que não é letra ou dígito;
-- cada termo vale até 40 caracteres; termo com menos de 3 sai; "or" e "and"
-- saem porque o websearch_to_tsquery os leria como operador; repetido sai,
-- mantendo a primeira posição; no máximo 12; junta com " or " porque o
-- websearch junta palavra solta com E, e a frase inteira não casaria nada.
create or replace function public.nucleo_knowledge_query(question text)
returns text
language sql
immutable
set search_path = ''
as $$
  with bruto as (
    select termo, ordem
    from unnest(
      regexp_split_to_array(lower(coalesce(question, '')), '[^[:alnum:]]+')
    ) with ordinality as t(termo, ordem)
  ),
  util as (
    select left(termo, 40) as termo, min(ordem) as ordem
    from bruto
    where length(termo) >= 3 and termo not in ('or', 'and')
    group by left(termo, 40)
  )
  select coalesce(string_agg(termo, ' or ' order by ordem), '')
  from (select termo, ordem from util order by ordem limit 12) as limitado;
$$;

comment on function public.nucleo_knowledge_query(text) is
  'Espelho SQL de searchQuery (src/knowledgeSearch.mjs). Mudou uma, mude a outra.';

create or replace function public.nucleo_knowledge_preview(
  document_title text default '',
  document_path text default '',
  document_text text default '',
  question text default ''
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- O mesmo teto de 20260827160000: 12 termos de até 40 caracteres mais os
  -- separadores " or " dão 524, e cortar antes partiria o último termo.
  normalized_query text := left(public.nucleo_knowledge_query(question), 600);
  snippet_limit constant integer := 900;
  query_terms tsquery;
  document_vector tsvector;
  matched boolean;
begin
  if normalized_query = '' then
    return jsonb_build_object('consulta', '', 'casou', false, 'trecho', '', 'relevancia', 0);
  end if;

  query_terms := websearch_to_tsquery('portuguese', normalized_query);

  -- Pergunta só de palavras vazias ("o que é que") vira tsquery vazia. Sem
  -- este ramo o `@@` devolveria false e a tela diria que o texto não responde
  -- a pergunta, quando o que houve é que não havia pergunta.
  if query_terms is null or query_terms = ''::tsquery then
    return jsonb_build_object('consulta', normalized_query, 'casou', false, 'trecho', '', 'relevancia', 0);
  end if;

  document_vector :=
    setweight(to_tsvector('portuguese', coalesce(document_title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(document_path, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(document_text, '')), 'C');

  matched := document_vector @@ query_terms;

  return jsonb_build_object(
    'consulta', normalized_query,
    'casou', matched,
    'relevancia', ts_rank(document_vector, query_terms),
    'trecho', case
      when matched then left(
        -- Mesmo destaque da busca: negrito de Markdown, porque o trecho já é
        -- Markdown e é assim que o assistente o recebe.
        ts_headline(
          'portuguese',
          coalesce(document_text, ''),
          query_terms,
          'StartSel="**", StopSel="**", MaxFragments=3, MaxWords=45, MinWords=20, FragmentDelimiter=" [...] "'
        ),
        snippet_limit
      )
      else ''
    end
  );
end;
$$;

comment on function public.nucleo_knowledge_preview(text, text, text, text) is
  'Prévia da busca sobre texto não salvo. Espelha o search_vector de knowledge_documents para que a etapa de revisão funcione em rascunho.';

revoke all on function public.nucleo_knowledge_query(text) from public;
revoke all on function public.nucleo_knowledge_preview(text, text, text, text) from public;
grant execute on function public.nucleo_knowledge_query(text) to authenticated;
grant execute on function public.nucleo_knowledge_preview(text, text, text, text) to authenticated;

commit;
