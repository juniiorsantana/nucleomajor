import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const CORRECAO = new URL("20260829150000_corrigir_regex_do_caminho_do_conhecimento.sql", MIGRATIONS);

const BARRA = String.fromCharCode(92);
const DUAS_BARRAS = BARRA + BARRA;

test("nenhuma migration nova volta a escrever regex com duas barras invertidas", async () => {
  // A origem do bug: `'\\.md$'` com standard_conforming_strings=on entrega ao
  // motor de regex uma barra invertida LITERAL, não um ponto escapado. A única
  // migration que pode conter `\\` é a que remove as duas defeituosas — e lá
  // ele aparece dentro de comentário e de `chr(92)`, nunca num literal de
  // regex. Esta trava impede que o mesmo deslize volte por outro arquivo.
  const arquivos = (await readdir(MIGRATIONS)).filter((nome) => nome.endsWith(".sql"));
  const permitidas = new Set([
    // 20260823010000 é o arquivo defeituoso original. Já está aplicado em
    // produção e, por contrato de implantação, migration aplicada nunca é
    // editada: a correção vem por 20260829150000.
    "20260823010000_nucleo_conhecimento.sql",
    "20260829150000_corrigir_regex_do_caminho_do_conhecimento.sql",
  ]);

  const reincidentes = [];
  for (const nome of arquivos) {
    if (permitidas.has(nome)) continue;
    const conteudo = await readFile(new URL(nome, MIGRATIONS), "utf8");
    const semComentario = conteudo.replace(/--[^\n]*/g, "");
    if (semComentario.includes(DUAS_BARRAS)) reincidentes.push(nome);
  }
  assert.deepEqual(reincidentes, [], `regex com ${DUAS_BARRAS} voltou em: ${reincidentes.join(", ")}`);
});

test("a correção derruba os checks pela forma, não pelo nome presumido", async () => {
  const sql = await readFile(CORRECAO, "utf8");
  const corpo = sql.replace(/--[^\n]*/g, "");

  // Derrubar por `knowledge_documents_path_check2` deixaria a migration passar
  // sem fazer nada se a numeração automática do Postgres divergir da contagem
  // — e ainda criaria uma segunda constraint ao lado da que barra tudo.
  assert.match(corpo, /from pg_constraint/i);
  assert.match(corpo, /drop constraint %I/i);
  assert.ok(
    !/drop constraint if exists knowledge_documents_path_check\d/i.test(corpo),
    "não derrubar pelo nome anônimo presumido",
  );

  // A varredura é pelos dois operadores de regex sobre `path`. Só `!~` não
  // bastaria: deixaria a constraint de extensão, que é a que bloqueia tudo.
  assert.match(corpo, /strpos\(pg_get_constraintdef\([^)]*\), 'path ~'\)/i);
  assert.match(corpo, /strpos\(pg_get_constraintdef\([^)]*\), 'path !~'\)/i);

  // `like` tem a própria barra invertida como escape — foi esse tipo de camada
  // que produziu o bug. A busca precisa ser por strpos.
  assert.ok(!/pg_get_constraintdef\([^)]*\)\s+like/i.test(corpo), "não usar like na varredura");
});

test("a varredura não alcança os outros checks da tabela", async () => {
  // `pg_get_constraintdef` devolve a forma deparseada. Estes são os outros
  // checks de 20260823010000 sobre a mesma coluna; nenhum pode casar com o
  // filtro, senão a migration removeria regra que não veio substituir.
  const sql = await readFile(CORRECAO, "utf8");
  const alvos = ["path ~", "path !~"];
  const outros = [
    "CHECK (((length(path) >= 4) AND (length(path) <= 500)))",
    "CHECK ((path = btrim(path)))",
    "CHECK (((audience = 'internal'::text) OR (scope_type = ANY (ARRAY['organization'::text, 'team'::text]))))",
  ];
  for (const definicao of outros) {
    for (const alvo of alvos) {
      assert.ok(!definicao.includes(alvo), `${definicao} não pode casar com "${alvo}"`);
    }
  }
  // E os dois que ela substitui têm de casar.
  assert.ok("CHECK ((path ~ '^[^/].*.md$'::text))".includes("path ~"));
  assert.ok("CHECK (((path !~ '(^|/).{1,2}(/|$)'::text) AND (path !~ '//'::text)))".includes("path !~"));
  assert.ok(sql.includes("strpos"));
});

test("as duas constraints são recriadas com nome próprio e uma barra só", async () => {
  const sql = (await readFile(CORRECAO, "utf8")).replace(/--[^\n]*/g, "");

  assert.match(sql, /add constraint knowledge_documents_path_extensao/);
  assert.match(sql, /add constraint knowledge_documents_path_travessia/);

  // Corrigir só a extensão abriria a travessia: hoje ela é inofensiva apenas
  // porque nada entra na tabela.
  const extensao = sql.slice(sql.indexOf("knowledge_documents_path_extensao\n  check"));
  assert.ok(extensao.includes(`~ '^[^/].*${BARRA}.md$'`), "a regex de extensão precisa de uma barra só");
  assert.ok(!extensao.includes(DUAS_BARRAS), "a regex de extensão não pode ter duas barras");

  assert.ok(sql.includes(`!~ '(^|/)${BARRA}.{1,2}(/|$)'`), "a regex de travessia precisa de uma barra só");
  assert.ok(sql.includes("!~ '//'"), "a barra dupla continua bloqueada");
});

test("a correção se prova dentro da própria transação", async () => {
  const sql = await readFile(CORRECAO, "utf8");

  // Sem a prova, a migration volta a ser um texto que ninguém executa — foi
  // assim que o `\\` chegou em produção.
  assert.match(sql, /raise exception 'caminho relativo válido foi rejeitado'/);
  assert.match(sql, /raise exception 'caminho com barra inicial foi aceito'/);
  assert.match(sql, /raise exception 'extensão diferente de \.md foi aceita'/);
  assert.match(sql, /raise exception 'travessia com \.\. não foi detectada'/);
  assert.match(sql, /raise exception 'barra dupla não foi detectada'/);

  // Uma transação só: se a prova falhar, nada da migration permanece.
  assert.equal(sql.split(/^begin;$/m).length - 1, 1);
  assert.equal(sql.split(/^commit;$/m).length - 1, 1);
  assert.ok(sql.indexOf("begin;") < sql.indexOf("do $$"), "a prova roda dentro da transação");
});

test("knowledge_document_versions não é tocada", async () => {
  // A tabela de versões não tem check de `path`; incluí-la aqui seria alterar
  // o que não está quebrado.
  const sql = await readFile(CORRECAO, "utf8");
  const corpo = sql.replace(/--[^\n]*/g, "");
  assert.ok(!corpo.includes("knowledge_document_versions"));
});
