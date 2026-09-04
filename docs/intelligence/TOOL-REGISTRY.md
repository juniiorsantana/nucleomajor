# Tool Registry

## O que é

A fonte canônica, em código, dos nomes de ferramenta ("tools") que o sistema
de inteligência conhece. Vive em
`packages/intelligence/src/tools.mjs`.

Antes deste módulo existir, o mesmo conjunto de 15 nomes estava espalhado sem
dono claro: `RUNTIME_TOOLS` em `catalog.mjs`, o enum espelhado em
`skill.schema.json`, e duas listas independentes em SQL
(`nucleo_intelligence_context_resolve_v2` e `_v3`) — que já divergiram entre
si mais de uma vez em produção (ver `test/skill-tools-whitelist.test.mjs` para
o histórico do incidente). O Registry não elimina as cópias em SQL nesta
etapa, mas dá a elas algo para serem comparadas por teste.

Cada ferramenta é uma definição estruturada mínima, não só uma string:

```js
{ name: "calendar.request.prepare", domain: "calendar", action: "request.prepare", status: "active" }
```

> **Registrar uma ferramenta no Tool Registry não concede permissão de uso a
> nenhum agente, skill ou etapa.** Quem concede uso é `allowedTools` em cada
> `skill.json`, validado por `packages/intelligence/src/catalog.mjs`. O
> Registry só descreve o que existe.

## Onde vive

- `packages/intelligence/src/tools.mjs` — `TOOL_DEFINITIONS`, `TOOL_NAMES`,
  `isKnownTool(name)`, `getToolDefinition(name)`.
- `packages/intelligence/src/catalog.mjs` — reexporta `RUNTIME_TOOLS` (agora
  igual a `TOOL_NAMES`, por compatibilidade com quem já importava esse nome)
  e usa `isKnownTool` para validar `allowedTools` de skill e de estágio.
- `packages/intelligence/skills/skill.schema.json` — mantém, à mão, o mesmo
  enum em `$defs.ferramentas` (JSON Schema não importa JavaScript). A
  equivalência com o Registry é garantida por teste, não por importação.

## Quem ainda NÃO usa o Registry

- `supabase/migrations/*.sql` — os resolvedores
  `nucleo_intelligence_context_resolve_v2` e `_v3` continuam com suas próprias
  listas literais em SQL. Não foram tocados nesta etapa.
- O runtime Python externo (`KNOWN_TOOLS`, `SEMANTIC_TOOL_MAP`, MCP, Bridge,
  VPS) — não está neste repositório.
- `scripts/sql/diagnostico-skills-do-cliente.sql` — mantém uma 4ª cópia
  hardcoded (hoje desatualizada) da lista, usada só como script de
  diagnóstico manual.
- `apps/emyleads/src/page/telas/Inteligencia.jsx` — a UI de skill privada
  aceita qualquer nome de ferramenta digitado em texto livre; a única
  validação que ele sofre continua sendo a do resolvedor SQL em tempo de
  conversa.

## Como adicionar uma tool

1. Acrescente uma linha em `TOOL_DEFINITIONS`, em
   `packages/intelligence/src/tools.mjs`, usando `definirFerramenta(...)`.
2. Acrescente o mesmo nome ao enum `$defs.ferramentas.items.enum` em
   `packages/intelligence/skills/skill.schema.json`.
3. Rode a suíte de testes (abaixo). `test/skill-schema.test.mjs` falha se o
   schema e o Registry divergirem.
4. Se alguma skill de cliente (`audience: "customer"` ou `"both"`) vai
   declarar essa ferramenta em algum estágio, atualize também a whitelist SQL
   de `nucleo_intelligence_context_resolve_v3` (e de `_v2`, se a skill for
   interna ou `both`) — isso ainda não é automático. Ver
   `test/skill-tools-whitelist.test.mjs`, que falha se ficarem fora de
   sincronia.

## Quais testes precisam passar

- `test/tool-registry.test.mjs` — contratos do próprio Registry: sem
  duplicatas, exatamente as tools esperadas, `isKnownTool`/`getToolDefinition`
  corretos, toda ferramenta usada por skill existe no Registry, rejeição de
  ferramenta inexistente pelo catálogo.
- `test/skill-schema.test.mjs` — equivalência entre o enum do
  `skill.schema.json` e o Registry (via `RUNTIME_TOOLS` reexportado).
- `test/skill-tools-whitelist.test.mjs` — equivalência entre o Registry e as
  whitelists SQL de `resolve_v2`/`resolve_v3`.
- `test/intelligence-skills.test.mjs` — contratos nominais por skill.
