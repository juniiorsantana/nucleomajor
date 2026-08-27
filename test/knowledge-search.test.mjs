import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FERRAMENTA_LER_DOCUMENTO,
  LIMITE_DO_TRECHO,
  knowledgeContext,
  readKnowledgeDocument,
  searchKnowledge,
  searchQuery,
  selectSnippets,
  trimSnippet,
} from "../src/knowledgeSearch.mjs";

const MIGRATION = fileURLToPath(
  new URL("../supabase/migrations/20260827160000_busca_conhecimento_web.sql", import.meta.url),
);

function documento(extra = {}) {
  return {
    documentoId: "9f0a2b1c-3d4e-4f50-9a6b-7c8d9e0f1a2b",
    titulo: "Protocolo de avaliação",
    caminho: "clinica/protocolo.md",
    escopo: "organization",
    audiencia: "internal",
    trecho: "conteúdo do trecho",
    documentoMaior: false,
    ...extra,
  };
}

function resultado(documentos, cobertura = {}) {
  return {
    schemaVersion: "busca-web-1",
    consulta: "protocolo or avaliacao",
    documentos,
    cobertura: { total: documentos.length, retornados: documentos.length, limite: 5, temMais: false, ...cobertura },
  };
}

test("consulta une os termos com OU, porque o E da frase inteira não casaria com nada", () => {
  const query = searchQuery("Como faço para cancelar o plano de um aluno?");
  assert.equal(query, "como or faço or para or cancelar or plano or aluno");
});

test("consulta neutraliza aspas, hífen e o operador or digitado pelo usuário", () => {
  // Aspas abririam uma frase e o hífen inicial viraria negação: os dois mudam
  // o significado da busca sem que ninguém perceba.
  assert.equal(searchQuery('"treino" -musculação'), "treino or musculação");
  assert.equal(searchQuery("plano or treino"), "plano or treino");
  assert.equal(searchQuery("plano OR OR treino"), "plano or treino");
});

test("consulta descarta termo curto, repetido e mensagem sem termo", () => {
  assert.equal(searchQuery("o de um a"), "");
  assert.equal(searchQuery("treino treino TREINO"), "treino");
  assert.equal(searchQuery(""), "");
  assert.equal(searchQuery(null), "");
});

test("consulta respeita o teto de termos", () => {
  const query = searchQuery("um dois tres quatro cinco seis sete oito nove dez onze doze treze catorze", { maxTerms: 12 });
  assert.equal(query.split(" or ").length, 12);
});

test("trecho é cortado no limite, em palavra inteira", () => {
  const longo = "palavra ".repeat(400);
  const cortado = trimSnippet(longo, LIMITE_DO_TRECHO);
  assert.ok(cortado.length <= LIMITE_DO_TRECHO + 1);
  assert.ok(cortado.endsWith("…"));
  assert.ok(!cortado.includes("palav…"));
  assert.equal(trimSnippet("curto", LIMITE_DO_TRECHO), "curto");
});

test("injeta apenas os três melhores, mantendo a ordem do banco", () => {
  const cinco = ["a", "b", "c", "d", "e"].map((letra) => documento({ documentoId: letra, titulo: letra }));
  const trechos = selectSnippets(resultado(cinco));
  assert.equal(trechos.length, 3);
  assert.deepEqual(trechos.map((item) => item.titulo), ["a", "b", "c"]);
});

test("avisa quando a busca encontrou mais do que coube no prompt", () => {
  const cinco = ["a", "b", "c", "d", "e"].map((letra) => documento({ documentoId: letra }));
  const contexto = knowledgeContext(resultado(cinco, { total: 31, temMais: true }));
  assert.equal(contexto.cobertura.total, 31);
  assert.equal(contexto.cobertura.injetados, 3);
  assert.ok(contexto.avisos.some((aviso) => aviso.includes("31")));
});

test("avisa que o trecho é recorte quando o documento é maior", () => {
  const contexto = knowledgeContext(resultado([documento({ documentoMaior: true })]));
  assert.ok(contexto.avisos.some((aviso) => aviso.includes("ler_documento")));
});

test("busca sem resultado pede honestidade; busca que falhou não vira ausência de documento", () => {
  const vazio = knowledgeContext(resultado([]));
  assert.deepEqual(vazio.trechos, []);
  assert.ok(vazio.avisos.some((aviso) => aviso.includes("Nenhum documento")));

  const falhou = knowledgeContext(null);
  assert.deepEqual(falhou.trechos, []);
  assert.ok(falhou.avisos.some((aviso) => aviso.includes("não conseguiu consultar")));
  assert.ok(!falhou.avisos.some((aviso) => aviso.includes("Nenhum documento")));
});

test("saudação sem termo não gera aviso de conhecimento inexistente", () => {
  const contexto = knowledgeContext({ consulta: "", documentos: [], cobertura: { total: 0, temMais: false } });
  assert.deepEqual(contexto.avisos, []);
});

test("mensagem sem termo não chega a consultar o banco", async () => {
  let chamadas = 0;
  const busca = await searchKnowledge({
    callSupabase: async () => { chamadas += 1; return {}; },
    token: "t", organizationId: "org", message: "oi",
  });
  assert.equal(chamadas, 0);
  assert.deepEqual(busca.documentos, []);
  assert.equal(busca.consulta, "");
});

test("busca chama a função web, nunca a do robô, e pede cinco trechos", async () => {
  const chamadas = [];
  await searchKnowledge({
    callSupabase: async (path, token, options) => {
      chamadas.push({ path, token, body: JSON.parse(options.body) });
      return resultado([]);
    },
    token: "token-do-usuario",
    organizationId: "3f8c2a10-1111-4222-8333-444444444444",
    message: "qual é o protocolo de avaliação?",
  });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].path, "/rest/v1/rpc/nucleo_web_knowledge_search");
  assert.equal(chamadas[0].token, "token-do-usuario");
  assert.equal(chamadas[0].body.result_limit, 5);
  assert.equal(chamadas[0].body.target_organization, "3f8c2a10-1111-4222-8333-444444444444");
  assert.match(chamadas[0].body.search_query, / or /);
});

test("leitura recusa id que não é UUID antes de tocar o banco", async () => {
  let chamadas = 0;
  await assert.rejects(
    () => readKnowledgeDocument({
      callSupabase: async () => { chamadas += 1; return {}; },
      token: "t", organizationId: "org", documentId: "protocolo.md",
    }),
    /Documento inválido/,
  );
  assert.equal(chamadas, 0);
});

test("leitura devolve o documento cortado no tamanho do prompt", async () => {
  const documentoLido = await readKnowledgeDocument({
    callSupabase: async () => ({
      documentoId: "9f0a2b1c-3d4e-4f50-9a6b-7c8d9e0f1a2b",
      titulo: "Protocolo", caminho: "clinica/protocolo.md",
      escopo: "organization", audiencia: "internal", versao: 4,
      conteudoMarkdown: "linha ".repeat(5000),
    }),
    token: "t",
    organizationId: "org",
    documentId: "9f0a2b1c-3d4e-4f50-9a6b-7c8d9e0f1a2b",
    limit: 200,
  });
  assert.equal(documentoLido.cortado, true);
  assert.ok(documentoLido.conteudo.length <= 201);
  assert.equal(documentoLido.versao, 4);
});

test("a ferramenta de leitura exige o id que a busca devolveu", () => {
  assert.equal(FERRAMENTA_LER_DOCUMENTO.name, "ler_documento");
  assert.deepEqual(FERRAMENTA_LER_DOCUMENTO.input_schema.required, ["documentoId"]);
});

test("a migration isola organização, escopo pessoal e publicação externa", async () => {
  const arquivo = (await readFile(MIGRATION, "utf8")).toLowerCase();
  // Os comentários citam as funções do robô para explicar por que elas não
  // servem aqui; a verificação é sobre o código executável.
  const sql = arquivo.replace(/--[^\n]*/g, "");

  // Autenticação de usuário, nunca de robô: é o que separa esta busca das
  // duas que já existiam.
  assert.ok(sql.includes("private.is_org_member(target_organization)"));
  assert.ok(!sql.includes("private.robot_organization"));
  assert.ok(!sql.includes("nucleo_operator_context"));
  assert.ok(!sql.includes("conversation_key_hash"));

  // A cláusula que impede ler o pessoal de terceiros, nas duas funções.
  assert.equal(
    sql.split("document.scope_type <> 'personal' or document.scope_user_id = auth.uid()").length - 1,
    3,
  );

  // Publicação externa: nunca sem data de publicação, nunca sem coleção.
  assert.ok(sql.includes("document.published_at is not null"));
  assert.ok(sql.includes("collection.audience = 'external'"));
  assert.ok(sql.includes("collection.status = 'active'"));
  assert.ok(sql.includes("public.campaign_knowledge_collections"));

  // Convenções do repositório: security definer com search_path vazio, e
  // permissão explícita só para quem está autenticado.
  assert.equal(sql.split("set search_path = ''").length - 1, 2);
  assert.equal(sql.split("security definer").length - 1, 2);
  assert.ok(sql.includes("revoke all on function public.nucleo_web_knowledge_search(uuid, text, integer) from public"));
  assert.ok(sql.includes("grant execute on function public.nucleo_web_knowledge_search(uuid, text, integer) to authenticated"));
  assert.ok(sql.includes("revoke all on function public.nucleo_web_knowledge_document(uuid, uuid) from public"));
  assert.ok(sql.includes("grant execute on function public.nucleo_web_knowledge_document(uuid, uuid) to authenticated"));
  assert.equal(sql.split("begin;").length - 1, 1);
  assert.equal(sql.split("commit;").length - 1, 1);
});

// --- laço de leitura sob demanda -------------------------------------------

const { assistantCompletion } = await import("../src/server.mjs");

function texto(valor) {
  return { content: [{ type: "text", text: valor }] };
}

function pedeLeitura(documentoId, id = "tool-1") {
  return { content: [{ type: "tool_use", id, name: "ler_documento", input: { documentoId } }] };
}

test("uma leitura resolvida volta como tool_result e a resposta seguinte é a final", async () => {
  const rodadas = [];
  const lidos = [];
  const completion = await assistantCompletion({
    organization: "Major",
    context: {},
    messages: [{ role: "user", content: "qual o protocolo?" }],
    readDocument: async (id) => { lidos.push(id); return { titulo: "Protocolo", conteudo: "texto inteiro" }; },
    ask: async ({ messages, allowDocumentRead }) => {
      rodadas.push({ tamanho: messages.length, allowDocumentRead });
      return rodadas.length === 1 ? pedeLeitura("doc-1") : texto("resposta final");
    },
  });
  assert.deepEqual(lidos, ["doc-1"]);
  assert.equal(rodadas.length, 2);
  assert.equal(rodadas[1].tamanho, 3);
  assert.equal(completion.content[0].text, "resposta final");
});

test("o laço para no teto de leituras e a última rodada não oferece a ferramenta", async () => {
  let leituras = 0;
  const ofertas = [];
  await assistantCompletion({
    organization: "Major",
    context: {},
    messages: [{ role: "user", content: "leia tudo" }],
    readDocument: async () => { leituras += 1; return { conteudo: "texto" }; },
    // Modelo teimoso: pede leitura em toda rodada em que a ferramenta existir.
    ask: async ({ allowDocumentRead }) => {
      ofertas.push(allowDocumentRead);
      return allowDocumentRead ? pedeLeitura("doc-1", `tool-${ofertas.length}`) : texto("respondo com o que tenho");
    },
  });
  assert.equal(leituras, 2);
  assert.deepEqual(ofertas, [true, true, false]);
});

test("propor_evento encerra o laço mesmo vindo junto de uma leitura", async () => {
  let leituras = 0;
  const completion = await assistantCompletion({
    organization: "Major",
    context: {},
    messages: [{ role: "user", content: "marque amanhã às 9h" }],
    readDocument: async () => { leituras += 1; return {}; },
    ask: async () => ({
      content: [
        { type: "tool_use", id: "tool-1", name: "ler_documento", input: { documentoId: "doc-1" } },
        { type: "tool_use", id: "tool-2", name: "propor_evento", input: { title: "Consulta" } },
      ],
    }),
  });
  assert.equal(leituras, 0);
  assert.ok(completion.content.some((item) => item.name === "propor_evento"));
});

test("documento inacessível vira erro de ferramenta, não derruba a conversa", async () => {
  let conversaFinal = null;
  const completion = await assistantCompletion({
    organization: "Major",
    context: {},
    messages: [{ role: "user", content: "e o documento pessoal do Lucas?" }],
    readDocument: async () => { throw new Error("knowledge document not found or not allowed"); },
    ask: async ({ messages }) => {
      conversaFinal = messages;
      return messages.length === 1 ? pedeLeitura("doc-de-terceiro") : texto("não tenho acesso a esse documento");
    },
  });
  const resultado = conversaFinal.at(-1).content[0];
  assert.equal(resultado.type, "tool_result");
  assert.equal(resultado.is_error, true);
  assert.equal(completion.content[0].text, "não tenho acesso a esse documento");
});
