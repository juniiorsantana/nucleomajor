/**
 * Slug estável a partir de um nome.
 *
 * Usado para gerar id de estágio e de tag. O id é gerado UMA vez, na criação,
 * e nunca mais muda — renomear "Qualificação" para "Diagnóstico" mantém o id
 * `qualificacao`, e por isso nenhum negócio muda de lugar. Regenerar o id no
 * rename moveria todo mundo para um estágio que não existe.
 */
export function paraSlug(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}
