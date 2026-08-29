/**
 * Busca contextual do assistente web.
 *
 * Antes disto o servidor injetava os doze documentos internos mais recentes,
 * inteiros, sem nenhuma relação com a pergunta. O décimo terceiro era
 * invisível e nada avisava. Aqui a pergunta vira consulta, o Postgres devolve
 * até cinco trechos ordenados por relevância, e só os três melhores entram no
 * prompt — o documento completo é lido sob demanda, pela ferramenta.
 *
 * As funções puras ficam separadas da chamada de rede de propósito: a tela de
 * Conhecimento não roda na bancada local e `npm run dev` não exercita este
 * caminho, então o que dá para testar precisa ser testável sem Supabase.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Palavras que o `websearch_to_tsquery` lê como operador, não como termo. */
const OPERADORES_DE_BUSCA = new Set(["or", "and"]);

export const TRECHOS_RETORNADOS = 5;
export const TRECHOS_INJETADOS = 3;
export const LIMITE_DO_TRECHO = 900;
export const LIMITE_DO_DOCUMENTO = 8000;
export const MAXIMO_DE_TERMOS = 12;

/**
 * Transforma a mensagem do usuário em consulta de busca.
 *
 * `websearch_to_tsquery` junta palavras soltas com E, não com OU. Passar a
 * frase inteira ("como faço para cancelar o plano de um aluno") exigiria que
 * todos os termos aparecessem no mesmo documento — o resultado normal seria
 * vazio, e o assistente responderia de memória achando que não há
 * conhecimento. Por isso os termos são reunidos com "or" e a ordenação por
 * `ts_rank` faz o resto: quem casa com mais termos sobe.
 *
 * Cada termo é reduzido a letras e dígitos antes de entrar. É o que impede
 * que uma aspas solta abra uma frase, que um hífen inicial vire negação e
 * apague justamente o documento certo, e que um "or" digitado pelo usuário
 * mude a estrutura da consulta.
 *
 * TEM ESPELHO: `public.nucleo_knowledge_query` (20260828180000) repete estas
 * regras em SQL, porque a etapa de revisão da tela de Conhecimento testa um
 * rascunho — que a busca real não encontra — e precisa montar a mesma
 * consulta. As duas raízes de build são separadas e nenhum import cruza as
 * duas, então não dá para compartilhar. Mudou aqui, mude lá.
 */
export function searchQuery(message, { maxTerms = MAXIMO_DE_TERMOS } = {}) {
  const termos = [];
  const vistos = new Set();
  for (const bruto of String(message || "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const termo = bruto.slice(0, 40);
    if (termo.length < 3 || OPERADORES_DE_BUSCA.has(termo)) continue;
    if (vistos.has(termo)) continue;
    vistos.add(termo);
    termos.push(termo);
    if (termos.length >= maxTerms) break;
  }
  return termos.join(" or ");
}

/**
 * Corta o trecho no limite acordado, respeitando a última palavra inteira.
 *
 * Cortar no caractere exato parte a palavra final e, num trecho de Markdown,
 * às vezes parte também a marcação — o assistente passa a citar "**consulta
 * de reto" como se fosse o texto do documento.
 */
export function trimSnippet(text, limit = LIMITE_DO_TRECHO) {
  const conteudo = String(text || "").trim();
  if (conteudo.length <= limit) return conteudo;
  const cortado = conteudo.slice(0, limit);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  const base = ultimoEspaco > limit * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado;
  return `${base.trimEnd()}…`;
}

/** Os melhores trechos, já recortados, na ordem de relevância que o banco deu. */
export function selectSnippets(result, { max = TRECHOS_INJETADOS, limit = LIMITE_DO_TRECHO } = {}) {
  const documentos = Array.isArray(result?.documentos) ? result.documentos : [];
  return documentos.slice(0, max).map((documento) => ({
    documentoId: documento.documentoId,
    titulo: documento.titulo,
    caminho: documento.caminho,
    escopo: documento.escopo,
    audiencia: documento.audiencia,
    trecho: trimSnippet(documento.trecho, limit),
    documentoMaior: Boolean(documento.documentoMaior),
  }));
}

/**
 * O bloco de conhecimento que entra no prompt.
 *
 * O aviso existe porque o silêncio é o pior resultado possível: sem ele o
 * assistente não distingue "não há documento sobre isso" de "há trinta e você
 * está vendo três", e nos dois casos responde com a mesma confiança.
 */
export function knowledgeContext(result, { max = TRECHOS_INJETADOS, limit = LIMITE_DO_TRECHO } = {}) {
  const disponivel = Boolean(result && Array.isArray(result.documentos));
  const trechos = disponivel ? selectSnippets(result, { max, limit }) : [];
  const encontrados = disponivel ? result.documentos.length : 0;
  const total = Number(result?.cobertura?.total || 0);
  const consulta = String(result?.consulta || "");
  const avisos = [];

  if (!disponivel) {
    avisos.push("A busca de conhecimento falhou nesta mensagem. Não afirme que a empresa não tem o documento; diga que não conseguiu consultar agora.");
  } else if (!consulta) {
    // Mensagem sem termo nenhum ("oi", "bom dia") não gera aviso: dizer "não
    // encontrei documentos" numa saudação inventa um problema que não existe.
  } else if (!trechos.length) {
    avisos.push("Nenhum documento do conhecimento casou com esta pergunta. Diga isso em vez de responder de memória.");
  } else {
    if (total > trechos.length) {
      avisos.push(`Há ${total} documentos que casam com esta pergunta e você está vendo ${trechos.length}. Se faltar informação, diga que a busca está parcial e peça termos mais específicos.`);
    }
    if (trechos.some((item) => item.documentoMaior)) {
      avisos.push("Os textos acima são trechos recortados. Antes de afirmar que algo não está no documento, leia o documento inteiro com a ferramenta ler_documento.");
    }
  }

  return {
    consulta,
    trechos,
    cobertura: {
      total,
      encontrados,
      injetados: trechos.length,
      temMais: Boolean(result?.cobertura?.temMais),
    },
    avisos,
  };
}

/**
 * Ferramenta de leitura sob demanda.
 *
 * Fica aqui, ao lado da busca, porque o `documentoId` que ela aceita só existe
 * porque a busca o devolveu: separar as duas faria alguém mudar o formato do
 * id em um arquivo e descobrir no outro.
 */
export const FERRAMENTA_LER_DOCUMENTO = {
  name: "ler_documento",
  description:
    "Lê o conteúdo completo de um documento do conhecimento da organização. Use apenas com um documentoId que apareceu nos trechos do contexto, quando o trecho não bastar para responder.",
  input_schema: {
    type: "object",
    properties: {
      documentoId: { type: "string", description: "UUID do documento, exatamente como veio no contexto" },
    },
    required: ["documentoId"],
  },
};

/**
 * Consulta o conhecimento autorizado para esta pergunta.
 *
 * `callSupabase` é injetado para o servidor manter uma única porta de saída
 * para o Supabase — e para este módulo continuar testável sem rede.
 */
export async function searchKnowledge({ callSupabase, token, organizationId, message, limit = TRECHOS_RETORNADOS }) {
  const query = searchQuery(message);
  // Sem termo não há o que buscar. Chamar mesmo assim devolveria vazio, mas
  // pagando uma ida ao banco em toda saudação ("oi", "bom dia").
  if (!query) return { schemaVersion: "busca-web-1", consulta: "", documentos: [], cobertura: { total: 0, retornados: 0, temMais: false } };
  return callSupabase("/rest/v1/rpc/nucleo_web_knowledge_search", token, {
    method: "POST",
    body: JSON.stringify({
      target_organization: organizationId,
      search_query: query,
      result_limit: limit,
    }),
  });
}

/**
 * Lê um documento inteiro, já cortado no tamanho que cabe no prompt.
 *
 * O UUID é conferido antes da chamada: um id inventado pelo modelo viraria
 * erro 400 do PostgREST, e o assistente tentaria de novo com o mesmo id.
 */
export async function readKnowledgeDocument({ callSupabase, token, organizationId, documentId, limit = LIMITE_DO_DOCUMENTO }) {
  const id = String(documentId || "").trim();
  if (!UUID_PATTERN.test(id)) throw new Error("Documento inválido.");
  const documento = await callSupabase("/rest/v1/rpc/nucleo_web_knowledge_document", token, {
    method: "POST",
    body: JSON.stringify({ target_organization: organizationId, target_document: id }),
  });
  const conteudo = String(documento?.conteudoMarkdown || "");
  return {
    documentoId: documento?.documentoId || id,
    titulo: documento?.titulo || "",
    caminho: documento?.caminho || "",
    escopo: documento?.escopo || "",
    audiencia: documento?.audiencia || "",
    versao: documento?.versao || null,
    conteudo: trimSnippet(conteudo, limit),
    cortado: conteudo.length > limit,
  };
}
