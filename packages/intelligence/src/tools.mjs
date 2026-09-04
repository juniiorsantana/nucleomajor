/**
 * Fonte canônica dos nomes de ferramenta que o sistema de inteligência
 * conhece. Antes desta lista existir aqui, o mesmo conjunto de nomes vivia
 * espalhado e sem dono: `RUNTIME_TOOLS` em catalog.mjs, o enum espelhado em
 * skill.schema.json, e duas listas independentes em SQL
 * (`nucleo_intelligence_context_resolve_v2` e `_v3`) que já divergiram entre
 * si mais de uma vez em produção. Ver docs/intelligence/TOOL-REGISTRY.md.
 *
 * Este módulo NÃO concede permissão de uso a nada. Ele só descreve o que
 * existe. Quem decide o que uma skill ou etapa pode chamar continua sendo
 * `allowedTools` em cada skill.json, validado por catalog.mjs.
 */

function definirFerramenta(name, status = "active") {
  const [domain, ...resto] = name.split(".");
  return Object.freeze({ name, domain, action: resto.join("."), status });
}

export const TOOL_DEFINITIONS = Object.freeze([
  definirFerramenta("knowledge.search"),
  definirFerramenta("crm.contact.read"),
  definirFerramenta("crm.contact.upsert"),
  definirFerramenta("crm.tag.apply"),
  definirFerramenta("crm.deal.qualify"),
  definirFerramenta("conversation.handoff"),
  definirFerramenta("calendar.read"),
  definirFerramenta("calendar.availability"),
  definirFerramenta("calendar.prepare"),
  definirFerramenta("calendar.confirm"),
  definirFerramenta("calendar.request.prepare"),
  definirFerramenta("calendar.request.submit"),
  definirFerramenta("task.read"),
  definirFerramenta("task.prepare"),
  definirFerramenta("task.confirm"),
]);

export const TOOL_NAMES = Object.freeze(new Set(TOOL_DEFINITIONS.map((tool) => tool.name)));

const POR_NOME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

export function isKnownTool(name) {
  return typeof name === "string" && POR_NOME.has(name);
}

export function getToolDefinition(name) {
  return POR_NOME.get(name) ?? null;
}
