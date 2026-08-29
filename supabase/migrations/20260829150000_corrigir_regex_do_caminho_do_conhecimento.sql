-- Corrige as duas expressões regulares de `knowledge_documents.path`.
--
-- 20260823010000 declarou os checks com DUAS barras invertidas:
--
--   check (path ~ '^[^/].*\\.md$')
--   check (path !~ '(^|/)\\.{1,2}(/|$)' and path !~ '//')
--
-- Com `standard_conforming_strings = on` — o padrão do Postgres e do Supabase
-- — a barra invertida não tem significado no literal, então o motor de regex
-- recebe `\\` e o lê como UMA BARRA INVERTIDA LITERAL, não como um ponto
-- escapado. As duas mudaram de sentido de formas opostas:
--
--   1. o primeiro passou a exigir que o caminho contenha `\` antes de `.md`.
--      Nenhum caminho de arquivo real satisfaz isso, e por isso NENHUM
--      documento jamais pôde ser gravado. É a origem do erro
--      `violates check constraint "knowledge_documents_path_check2"`.
--
--   2. o segundo passou a procurar `\` onde procurava `.` e `..`, nunca casa,
--      e a negação virou sempre verdadeira. A guarda contra travessia de
--      caminho existe no arquivo e não existe no banco.
--
-- O primeiro encobria o segundo: como nada entrava, nada podia atravessar.
-- Corrigir só o primeiro abriria a travessia — por isso os dois vêm juntos,
-- na mesma transação.
--
-- A convenção correta já estava no repositório: 20260822090000, linha 68,
-- valida e-mail com `\.` de uma barra só. As linhas 32 e 33 de 20260823010000
-- são as duas únicas de todo o histórico que usam `\\`.
--
-- `knowledge_document_versions` não tem check de `path` e não é tocada.

begin;

-- Os checks originais são anônimos, e o nome que o Postgres deu a eles depende
-- da ordem de declaração (`..._path_check2` e `..._path_check3`, pela
-- contagem). Derrubar pelo nome presumido deixaria a migration passar sem
-- fazer nada se a numeração real divergir — e, pior, criaria uma segunda
-- constraint ao lado da que continuaria barrando tudo.
--
-- Então a varredura é pela FORMA, não pelo nome nem pelo defeito: toda
-- constraint de check desta tabela que aplique um operador de regex sobre
-- `path`. São exatamente as duas que esta migration substitui, quaisquer que
-- sejam seus nomes e sua expressão atual. Os outros checks da tabela não
-- casam: `length(path) between 4 and 500` vira `length(path) >= 4`,
-- `path = trim(path)` vira `path = btrim(path)`, e nenhum dos dois contém
-- `path ~`.
--
-- `strpos` é usado de propósito no lugar de `like` — `like` tem a própria
-- barra invertida como caractere de escape, e foi exatamente esse tipo de
-- camada de escape que produziu o bug.
--
-- O `raise notice` imprime a definição inteira: aplicada pelo SQL Editor, esta
-- migration é o próprio diagnóstico. Duas linhas com `\\` confirmam a causa;
-- nenhuma linha significa que a tabela já estava diferente do repositório e o
-- caso precisa ser reaberto.
do $$
declare
  antiga record;
  removidas integer := 0;
begin
  for antiga in
    select constraint_row.conname,
           pg_get_constraintdef(constraint_row.oid) as definicao
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.knowledge_documents'::regclass
      and constraint_row.contype = 'c'
      and (
        strpos(pg_get_constraintdef(constraint_row.oid), 'path ~') > 0
        or strpos(pg_get_constraintdef(constraint_row.oid), 'path !~') > 0
      )
  loop
    raise notice 'removendo check de caminho: % => %', antiga.conname, antiga.definicao;
    execute format(
      'alter table public.knowledge_documents drop constraint %I',
      antiga.conname
    );
    removidas := removidas + 1;
  end loop;
  raise notice 'checks de caminho removidos: %', removidas;
end;
$$;

-- Daqui em diante os dois checks têm nome próprio. Constraint anônima é o que
-- permitiu que um erro de digitação ficasse cinco dias sem ser visto: ninguém
-- reconhece `knowledge_documents_path_check2` na mensagem de erro.
alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_path_extensao;
alter table public.knowledge_documents
  add constraint knowledge_documents_path_extensao
  check (path ~ '^[^/].*\.md$');

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_path_travessia;
alter table public.knowledge_documents
  add constraint knowledge_documents_path_travessia
  check (path !~ '(^|/)\.{1,2}(/|$)' and path !~ '//');

-- Prova de que as expressões fazem o que dizem, dentro da mesma transação que
-- as criou. Sem isto a migration voltaria a ser um texto que ninguém executa:
-- foi assim que o `\\` chegou em produção. Qualquer linha abaixo que falhe
-- desfaz a migration inteira.
do $$
begin
  if not ('empresa/sobre.md' ~ '^[^/].*\.md$') then
    raise exception 'caminho relativo válido foi rejeitado';
  end if;
  if not ('atendimento/perguntas-frequentes.md' ~ '^[^/].*\.md$') then
    raise exception 'caminho com hífen foi rejeitado';
  end if;
  if not ('sobre.md' ~ '^[^/].*\.md$') then
    raise exception 'caminho sem pasta foi rejeitado';
  end if;
  if '/empresa/sobre.md' ~ '^[^/].*\.md$' then
    raise exception 'caminho com barra inicial foi aceito';
  end if;
  if 'empresa/sobre.txt' ~ '^[^/].*\.md$' then
    raise exception 'extensão diferente de .md foi aceita';
  end if;

  if not ('empresa/../../etc/senha.md' ~ '(^|/)\.{1,2}(/|$)') then
    raise exception 'travessia com .. não foi detectada';
  end if;
  if not ('./sobre.md' ~ '(^|/)\.{1,2}(/|$)') then
    raise exception 'travessia com . não foi detectada';
  end if;
  if 'empresa/sobre.md' ~ '(^|/)\.{1,2}(/|$)' then
    raise exception 'caminho válido foi marcado como travessia';
  end if;
  if not ('empresa//sobre.md' ~ '//') then
    raise exception 'barra dupla não foi detectada';
  end if;
end;
$$;

commit;
