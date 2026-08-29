/**
 * Regras de publicação do conhecimento.
 *
 * Ficam fora da tela porque são a parte que não pode errar: o mesmo cálculo
 * decide se o botão salva, o que a mensagem diz e — quando o assistente de
 * criação existir — o que a etapa "Onde será usado" exige.
 */

/**
 * Documento externo só é encontrável se estiver numa coleção externa.
 *
 * `nucleo_contextual_knowledge_search` (migration 20260823120000) resolve o
 * conhecimento do cliente assim:
 *
 *   context.audience = 'customer'
 *   AND document.audience = 'external'
 *   AND EXISTS (knowledge_document_collections -> knowledge_collections
 *               com status 'active' e audience 'external',
 *               e se a coleção for scope_type 'campaign',
 *               vinculada à campanha daquele contexto)
 *
 * Ou seja: marcar o documento como externo é condição necessária e não
 * suficiente. Sem coleção ele é salvo, aparece na lista para quem escreveu, e
 * a Recepção nunca o encontra — falha silenciosa, do pior tipo, porque o
 * autor acredita ter publicado.
 *
 * Escopo pessoal nunca é externo: a tela força `internal` ao salvar.
 */
export function exigeColecaoExterna(rascunho) {
  if (!rascunho) return false;
  if (rascunho.escopo === "personal") return false;
  return rascunho.audiencia === "external";
}

/** Coleções que podem receber um documento externo. */
export function colecoesExternasDisponiveis(colecoes = []) {
  return colecoes.filter((item) => item?.audience === "external" && item?.scope_type !== "personal");
}

/**
 * O que impede salvar, e por quê — em uma frase que o autor entenda.
 *
 * Devolve `null` quando está tudo certo. A separação entre "escolha uma" e
 * "não existe nenhuma" importa: a primeira é um clique, a segunda manda a
 * pessoa para outra tela, e tratar as duas com o mesmo texto faz alguém
 * procurar por um botão que não está ali.
 */
export function motivoParaNaoPublicar(rascunho, colecoes = []) {
  if (!exigeColecaoExterna(rascunho)) return null;
  if ((rascunho.colecoesIds || []).length) return null;
  return colecoesExternasDisponiveis(colecoes).length
    ? "Escolha ao menos uma coleção externa — sem ela o atendimento não encontra este documento."
    : "Não há nenhuma coleção externa nesta empresa. Crie uma na Central de Inteligência antes de publicar para clientes.";
}

/**
 * Coleção já marcada ao trocar o público para externo.
 *
 * Com uma coleção externa só, escolher é cerimônia: a resposta é óbvia e a
 * pergunta só existe para dar chance de errar. Com duas ou mais, marcar uma
 * por conta seria adivinhar em qual campanha o documento entra.
 */
export function colecaoAutomatica(audiencia, colecoes = []) {
  if (audiencia !== "external") return [];
  const externas = colecoesExternasDisponiveis(colecoes);
  return externas.length === 1 ? [externas[0].id] : [];
}
