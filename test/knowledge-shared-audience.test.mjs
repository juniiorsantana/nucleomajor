import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const ANTERIOR = new URL(
  "../supabase/migrations/20260828200000_conhecimento_publicacao_atomica.sql",
  import.meta.url,
);
const MIGRATION = new URL(
  "../supabase/migrations/20260829170000_conhecimento_externo_visivel_para_equipe.sql",
  import.meta.url,
);

// Normaliza o fim de linha antes de comparar. `.gitattributes` fixa `eol=lf`
// para `.sql`, mas a comparação do ramo do cliente é byte a byte de propósito,
// e um checkout com outra configuração transformaria isso numa falha
// incompreensível — o diff mostraria dois textos idênticos.
const semComentario = (sql) => sql.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");

async function corpo() {
  return semComentario(await readFile(MIGRATION, "utf8"));
}

/** As duas funções, recortadas, para uma asserção não vazar para a outra. */
async function funcoes() {
  const sql = await corpo();
  const inicioBusca = sql.indexOf("create or replace function public.nucleo_contextual_knowledge_search");
  const inicioDocumento = sql.indexOf("create or replace function public.nucleo_contextual_knowledge_document");
  assert.ok(inicioBusca >= 0 && inicioDocumento > inicioBusca, "as duas funções precisam estar na migration");
  return { busca: sql.slice(inicioBusca, inicioDocumento), documento: sql.slice(inicioDocumento) };
}

test("o operador interno passa a enxergar o conteúdo publicado para clientes", async () => {
  const { busca, documento } = await funcoes();
  const alvo = "context_row.audience = 'internal' and document.audience in ('internal', 'external')";

  // Duas na busca — contagem e listagem — e uma na leitura do documento.
  assert.equal(busca.split(alvo).length - 1, 2);
  assert.equal(documento.split(alvo).length - 1, 1);

  // A forma antiga não pode sobreviver em lugar nenhum.
  const antiga = "document.audience = 'internal'";
  assert.equal((await corpo()).split(antiga).length - 1, 0);
});

test("o ramo do cliente fica exatamente como estava", async () => {
  // É a fronteira que separa o que sai da empresa. Esta migration só amplia o
  // que o lado interno enxerga; se ela mexer aqui, o risco muda de categoria.
  const anterior = semComentario(await readFile(ANTERIOR, "utf8"));
  const atual = await corpo();

  const trecho = /context_row\.audience = 'customer' and document\.audience = 'external' and exists \([\s\S]*?\n\s*\)\)/g;
  const antes = anterior.match(trecho) || [];
  const depois = atual.match(trecho) || [];

  assert.equal(antes.length, 3, "a migration anterior tem três ramos de cliente");
  assert.equal(depois.length, 3, "a nova precisa ter os mesmos três");
  for (let i = 0; i < depois.length; i += 1) {
    assert.equal(depois[i], antes[i], `o ramo de cliente ${i + 1} foi alterado`);
  }
});

test("rascunho continua invisível para runtime, nas duas audiências", async () => {
  const { busca, documento } = await funcoes();
  assert.equal(busca.split("document.published_at is not null").length - 1, 2);
  assert.equal(documento.split("document.published_at is not null").length - 1, 1);
});

test("o escopo pessoal continua protegido e fora do bloco de audiência", async () => {
  // Se a cláusula entrasse no bloco de audiência, bastaria um ramo novo
  // esquecer a cópia para o documento pessoal de outra pessoa vazar.
  const sql = await corpo();
  assert.equal(sql.split("document.scope_type <> 'personal' or document.scope_user_id = operator_row.user_id").length - 1, 3);
});

test("a coleção de campanha continua exigida para o cliente", async () => {
  const sql = await corpo();
  assert.equal(sql.split("collection.scope_type <> 'campaign'").length - 1, 3);
  assert.equal(sql.split("public.campaign_knowledge_collections binding").length - 1, 3);
});

test("a migration é uma transação só e não toca em nucleo_knowledge_save", async () => {
  const sql = await corpo();
  assert.equal(sql.split(/^begin;$/m).length - 1, 1);
  assert.equal(sql.split(/^commit;$/m).length - 1, 1);
  // A gravação já está aplicada em produção e não tem nada a ver com leitura.
  assert.ok(!sql.includes("nucleo_knowledge_save"));
  assert.ok(!sql.includes("knowledge_documents_path_"));
});

test("os grants são reemitidos para as duas funções recriadas", async () => {
  const sql = await corpo();
  for (const nome of ["nucleo_contextual_knowledge_search", "nucleo_contextual_knowledge_document"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${nome}\\(`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${nome}\\([^)]*\\) to authenticated`));
  }
});
