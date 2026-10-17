/**
 * O tamanho que as instruções de uma habilidade precisam ter.
 *
 * Não é preferência deste módulo: é a regra que o BANCO aplica, em todas as
 * gerações de resolvedor desde 24/08, e que o runtime da VPS repete em
 * `MAX_INSTRUCTIONS`. Quem grava uma habilidade fora desta faixa não recebe um
 * aviso — a resolução de contexto levanta `published skill instructions are
 * invalid` e a conversa do cliente morre no meio.
 *
 * Vive num módulo próprio, sem nenhum `import`, porque os dois lados precisam
 * dele e um deles é o navegador: `catalog.mjs` (o validador do catálogo Git)
 * usa Node — `node:crypto`, `node:fs` — e não pode ser importado pelo portal.
 * Repetir o número na tela seria criar a quarta cópia de um limite que já mora
 * em três lugares.
 */

/** Abaixo disto o resolvedor recusa a habilidade. */
export const INSTRUCTIONS_MIN = 80;

/** Acima disto, também — e é o mesmo teto do `MAX_INSTRUCTIONS` do runtime. */
export const INSTRUCTIONS_MAX = 20000;
