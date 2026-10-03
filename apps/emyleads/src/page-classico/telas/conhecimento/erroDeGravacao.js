/**
 * O que dizer quando a gravação falha.
 *
 * A tela mostrava o texto cru do Postgres. Alguém que escreveu um documento
 * sobre a empresa lia `new row for relation "knowledge_documents" violates
 * check constraint "knowledge_documents_path_check2"` e não tinha como saber
 * que o problema era o caminho do arquivo — nem que existe um caminho de
 * arquivo. Um erro que não diz o que fazer é indistinguível de um travamento,
 * e a reação previsível é clicar de novo.
 *
 * Fica fora do componente porque é a parte que precisa de teste: cada frase
 * aqui corresponde a uma condição que o banco levanta, e as duas listas só
 * ficam alinhadas se alguém puder compará-las sem montar a árvore React.
 *
 * `campo` acompanha a mensagem para a tela poder devolver o foco. Sem ele a
 * pessoa lê "o caminho não é válido" e ainda tem de procurar onde fica o
 * caminho — que, no assistente, está três etapas atrás.
 */

/** O texto que veio do Supabase, venha ele de onde vier. */
function textoDoErro(erro) {
  if (!erro) return "";
  return [erro.message, erro.details, erro.hint].filter(Boolean).join(" · ");
}

/**
 * As regras que o banco impõe, na ordem em que precisam ser testadas.
 *
 * A ordem importa em um ponto: `active_path_unique` também menciona `path`, e
 * se a regra de caminho inválido viesse antes, um documento duplicado seria
 * anunciado como caminho malformado. O específico vem sempre antes do geral.
 */
const REGRAS = [
  {
    // 20260823010000: unique index (organization_id, scope_type, scope_user_id, lower(path))
    casa: (texto) => /knowledge_documents_active_path_unique|duplicate key/i.test(texto),
    campo: "caminho",
    mensagem: "Já existe um documento neste caminho. Mude o título ou o caminho do arquivo.",
  },
  {
    // knowledge_documents_path_extensao / _travessia — e os nomes anônimos
    // antigos (_path_check, _path_check1, _path_check2, _path_check3), que
    // continuam aparecendo enquanto a migration corretiva não for aplicada.
    casa: (texto) => /knowledge_documents_path_|check constraint .*path/i.test(texto),
    campo: "caminho",
    mensagem:
      "O caminho do arquivo não é válido. Ele não pode começar com “/”, precisa terminar em .md e não pode conter “..”.",
  },
  {
    casa: (texto) => /knowledge path required/i.test(texto),
    campo: "caminho",
    mensagem: "Informe o caminho do arquivo.",
  },
  {
    casa: (texto) => /knowledge_documents_title_check|knowledge title required/i.test(texto),
    campo: "titulo",
    mensagem: "Dê um título ao documento — de 1 a 180 caracteres.",
  },
  {
    casa: (texto) => /content_markdown/i.test(texto),
    campo: "conteudo",
    mensagem: "O documento passa de 1 MB. Divida em documentos menores.",
  },
  {
    casa: (texto) => /published external knowledge requires an external collection/i.test(texto),
    campo: "colecoes",
    mensagem:
      "Para publicar para clientes é preciso escolher ao menos uma coleção externa — sem ela o atendimento não encontra este documento.",
  },
  {
    casa: (texto) => /knowledge collection is invalid for this audience/i.test(texto),
    campo: "colecoes",
    mensagem: "A coleção escolhida não vale para este público. Recarregue a página e escolha de novo.",
  },
  {
    casa: (texto) => /personal knowledge cannot be assigned to collections/i.test(texto),
    campo: "publico",
    mensagem: "Conteúdo pessoal não entra em coleção. Troque o público para Equipe ou Clientes.",
  },
  {
    casa: (texto) => /personal knowledge must remain internal|external_scope_check/i.test(texto),
    campo: "publico",
    mensagem: "Conteúdo pessoal não pode ser aberto para clientes.",
  },
  {
    casa: (texto) => /personal knowledge belongs to another user/i.test(texto),
    campo: null,
    mensagem: "Este documento pessoal é de outra pessoa.",
  },
  {
    casa: (texto) => /organization knowledge requires administrator role/i.test(texto),
    campo: "publico",
    mensagem: "Só o dono ou um administrador grava conhecimento da empresa. Você pode salvar como pessoal.",
  },
  {
    casa: (texto) => /organization membership required|invalid knowledge scope/i.test(texto),
    campo: null,
    mensagem: "Entre em uma empresa para gravar conhecimento.",
  },
  {
    casa: (texto) => /knowledge document not found/i.test(texto),
    campo: null,
    mensagem: "Este documento não existe mais. Recarregue a página.",
  },
  {
    casa: (texto) => /authentication required|JWT|expired/i.test(texto),
    campo: null,
    mensagem: "Sua sessão expirou. Entre novamente — o que você escreveu continua aqui.",
  },
  {
    casa: (texto) => /Failed to fetch|NetworkError|ERR_INTERNET/i.test(texto),
    campo: null,
    mensagem: "Não deu para falar com o servidor. Confira a conexão e tente de novo.",
  },
];

/**
 * A frase que vai para a tela, e o campo que deve receber o foco.
 *
 * Sem correspondência, devolve o texto original: esconder um erro desconhecido
 * atrás de "algo deu errado" tira do usuário a única pista que ele tinha para
 * relatar o problema.
 */
export function mensagemDeGravacao(erro) {
  const texto = textoDoErro(erro);
  if (!texto) return { mensagem: "Não foi possível salvar. Tente de novo.", campo: null };
  const regra = REGRAS.find((item) => item.casa(texto));
  if (!regra) return { mensagem: texto, campo: null };
  return { mensagem: regra.mensagem, campo: regra.campo };
}

/**
 * A etapa do assistente onde cada campo é editável.
 *
 * Espelha as cinco etapas de `ETAPAS`. Quando as etapas 3 e 4 forem fundidas,
 * `colecoes` passa a 3 — e este é o único lugar a mudar.
 */
export const ETAPA_DO_CAMPO = {
  conteudo: 2,
  publico: 3,
  colecoes: 4,
  titulo: 5,
  caminho: 5,
};
