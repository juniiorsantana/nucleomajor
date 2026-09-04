# Contrato Canônico do Intelligence Core

> A ETAPA 5 criou o primeiro Core executável que usa este contrato —
> `resolveIntelligence()`, sem lógica de roteamento própria ainda. Ver
> [INTELLIGENCE-CORE.md](./INTELLIGENCE-CORE.md).

## 1. O problema

Hoje existem pelo menos sete caminhos que produzem ou consomem "o resultado
de uma resolução de inteligência", e nenhum compartilha uma linguagem comum:

- `private.intelligence_payload` (a base, em português: `assistente`,
  `campanha`, `skillAtivo`, `politicas`, `colecoesPermitidas`)
- `nucleo_intelligence_context_resolve_v2` (acrescenta `runtimeContext` em
  inglês, sem `stage`/`workflow`)
- `nucleo_intelligence_context_resolve_v3` (acrescenta `runtimeContext.workflow`
  com `stage`/`stack`/`pendingSensitiveAction`, só para `audience: "customer"`)
- `intelligence_context_preview` (usado pelo Simulador do Portal — devolve o
  payload cru de `intelligence_payload`, **sem passar por v2 nem v3**)
- `apps/emyleads/src/domain/intelligenceRouter.js` (reimplementação
  client-side da prioridade de roteamento de v3, com um campo `reason` que
  não existe em nenhum SQL)
- `src/intelligenceContext.mjs` (poda tudo isso para montar o prompt do
  assistente web, removendo `allowedTools`/`workflow` inteiramente)
- o runtime Python externo (fora deste repositório) que efetivamente executa
  as ferramentas para o WhatsApp

O payload final de v2/v3 acumula **dois vocabulários coexistindo** — chaves
em português (`assistente`, `campanha`, `skillAtivo`) e um `runtimeContext`
em inglês construído ao lado, sem que o primeiro seja removido. `allowedTools`
tem quatro formatos diferentes dependendo de por onde se olha. `stage` só
existe em v3, mesmo skills internas com múltiplos estágios (`tarefas`,
`agenda`) nunca o expondo. `routingReason` só existe no JavaScript do
Simulador. Ver a auditoria completa no histórico desta etapa (ETAPA 4) —
resumida na seção 4 abaixo.

Esta etapa não conserta esse estado. Ela dá um nome único e uma forma
verificável para "o que entra" e "o que sai" de uma resolução — para que a
próxima etapa (o Core executável) tenha uma linguagem para falar, em vez de
inventar mais uma variante.

```text
Current Resolver (v2 / v3, SQL)
      ↓
Adapter (resolutionFromV2 / resolutionFromV3)
      ↓
IntelligenceResolution (contrato canônico)
```

## 2. `IntelligenceRequest`

`packages/intelligence/src/contracts/intelligence-request.mjs`

O que o Core recebe para tomar uma decisão — modelado a partir dos
parâmetros reais de `private.intelligence_payload`/v2/v3, não inventado:

| Campo | Tipo | Obrigatório | Origem real |
|---|---|---|---|
| `organizationId` | uuid | sim | `target_organization` |
| `audience` | `"internal"` \| `"customer"` | sim | `target_audience` |
| `channel` | `"whatsapp"` \| `"web"` \| `"simulator"` | sim | `target_channel` |
| `conversationKeyHash` | sha256 hex (64 chars) | sim | `conversation_hash` / `conversation_key_hash` |
| `requesterPhone` | texto | não (default `""`) | `requester_phone` (só v2/v3) |
| `incomingText` | texto | não (default `""`) | `incoming_text` |
| `sourceData` | objeto | não (default `{}`) | `source_data` — chaves conhecidas quando `audience === "customer"`: `targetMode` (`"reception"`\|`"skill"`\|`"campaign"`), `targetSkillId`, `targetCampaignId` (só v3) |
| `shouldPersist` | booleano | não (default `true`) | `should_persist` (`false` no preview do Simulador) |

**Decisão deliberada**: não existe `currentState`/`pendingAction` de entrada.
Nenhum resolvedor real aceita estado de sessão como parâmetro — v2/v3 leem o
estado internamente a partir de `conversationKeyHash` + `organizationId` +
`audience` (tabelas `conversation_intelligence_contexts`,
`conversation_skill_sessions`, `customer_pending_actions`). Um campo desses
aqui fingiria uma capacidade que o sistema não tem. `intelligenceRouter.js`
(client-side) *aceita* `currentSkillId`/`pendingSensitiveAction` como
parâmetros porque ele não tem banco — é uma aproximação para o Simulador, não
o contrato real.

## 3. `IntelligenceResolution`

`packages/intelligence/src/contracts/intelligence-resolution.mjs`

A decisão produzida — modelada a partir do que `runtimeContext` de v2/v3 já
compila hoje, com nomes normalizados para inglês (a "linguagem comum" que
esta etapa existe para criar):

| Campo | Tipo | Origem real |
|---|---|---|
| `contractVersion` | `1` | novo — ver seção 7 |
| `sourceSchemaVersion` | texto | `schemaVersion` (`fase-h-1`/`fase-h-2`/`fase-h-3`), preservado por rastreabilidade |
| `contextId` | uuid \| `null` | `contextoId` |
| `audience` | `"internal"` \| `"customer"` | `runtimeContext.audience` |
| `assistant` | `{id,name,tone,brand,process,templateId}` \| `null` | `runtimeContext.assistant` (`assistente`, renomeado) |
| `campaign` | `{id,name,objective,offer,targetAudience,expectedResult,settings}` \| `null` | `runtimeContext.campaign` (`campanha`, renomeado) |
| `skill` | `{id,slug,name,version,contentHash,objective,instructions}` \| `null` | `runtimeContext.activeSkill`, sem `allowedTools`/`guardrails`/`handoff` (promovidos ao topo) |
| `stage` | `{id,objective,requiredFields,allowedTools,completion}` \| `null` | `runtimeContext.workflow.stageSpec` — **só existe vindo de v3/customer** |
| `allowedTools` | `string[]`, validado contra o Tool Registry | `stage.allowedTools` quando há estágio, senão `activeSkill.allowedTools` |
| `guardrails` | `string[]` | `activeSkill.guardrails` |
| `handoff` | `string[]` | `activeSkill.handoff` |
| `knowledge` | `Array<{id,name,scope,audience}>` | `runtimeContext.allowedCollections` (`colecoesPermitidas`, renomeado) |
| `policies` | objeto opaco | `runtimeContext.policies`, repassado sem remapear chaves (é um saco de booleanos extensível na origem; formalizar cada chave seria inventar estrutura que o sistema real não impõe) |
| `runtimeContext` | `{sessionId,revision,primarySkillId,activeSkillId,stack,expiresAt,subflowExpiresAt,confirmationMinutes}` \| `null` | `runtimeContext.workflow`, menos `stage`/`stageSpec`/`pendingSensitiveAction` (que viraram campos próprios) — **só existe vindo de v3/customer** |
| `pendingAction` | `{pending: boolean}` \| `null` | `runtimeContext.workflow.pendingSensitiveAction` — **só v3 expõe**; v2 calcula `pending_task` internamente mas nunca serializa |
| `routingReason` | texto \| `null` | não existe em nenhum SQL hoje; só em `intelligenceRouter.js`. Os adapters de v2/v3 sempre preenchem `null` — o campo existe para dar um lugar a esse conceito quando (e se) o Core vier a serializá-lo |

Ainda usa `assistant` (`assistant_profiles`), não `agent`. Não introduz
`agentId`, `agentRouter`, `agentTeam` ou `soul` — ver seção 6.

## 4. Relação com v2/v3 — matriz de adapters

`packages/intelligence/src/contracts/adapters.mjs` exporta
`resolutionFromV2(payload)` e `resolutionFromV3(payload)`. Nenhum dos dois
chama o banco nem substitui os resolvedores — só traduzem o JSON que eles já
devolvem.

| Campo atual (SQL) | Campo canônico | Preservado? |
|---|---|---|
| `schemaVersion` | `sourceSchemaVersion` | sim |
| `contextoId` | `contextId` | sim |
| `runtimeContext.audience` | `audience` | sim |
| `runtimeContext.assistant.{nome,tom,marca,processo,templateId}` | `assistant.{name,tone,brand,process,templateId}` | sim, renomeado |
| `runtimeContext.campaign.{nome,objetivo,oferta,publico,resultadoEsperado,configuracao}` | `campaign.{name,objective,offer,targetAudience,expectedResult,settings}` | sim, renomeado — inclusive `configuracao`/`settings` (jsonb livre, potencialmente sensível; ver nota no código do adapter) |
| `runtimeContext.activeSkill.{id,slug,name,version,contentHash,objective,instructions}` | `skill.{...}` | sim, sem renomear (já estava em inglês) |
| `runtimeContext.activeSkill.allowedTools/guardrails/handoff` | topo: `allowedTools`/`guardrails`/`handoff` | sim, promovidos |
| `runtimeContext.workflow.stageSpec` (só v3) | `stage` | sim, quando existe |
| `runtimeContext.workflow.{sessionId,revision,primarySkillId,activeSkillId,stack,expiresAt,subflowExpiresAt,confirmationMinutes}` (só v3) | `runtimeContext.{...}` | sim, quando existe |
| `runtimeContext.workflow.pendingSensitiveAction` (só v3) | `pendingAction.pending` | sim, quando existe |
| `runtimeContext.allowedCollections.{nome,escopo,audiencia}` | `knowledge[].{name,scope,audience}` | sim, renomeado |
| `runtimeContext.policies` | `policies` | sim, sem remapear chaves |

v3, quando `audience !== "customer"`, devolve exatamente o payload de v2
(early return na função SQL) — `resolutionFromV3` lida com isso sozinho,
porque `runtimeContext.workflow` simplesmente não existe nesse caso, e
`stage`/`runtimeContext`/`pendingAction` saem `null` como em
`resolutionFromV2`.

### Informação não representada (reportada, não escondida)

- **`skillsPermitidos`** (lista de TODAS as skills habilitadas ao perfil, não
  só a ativa) não tem campo correspondente na Resolution. A Resolution
  modela "a decisão" (uma skill ativa), não "o menu de opções" — mas isso é
  uma lacuna real se algum consumidor futuro precisar saber o que mais
  estava disponível.
- **`activation`** (keywords/negativeKeywords da skill ativa) não é
  representado — é "como a skill foi escolhida", não "o que foi escolhido".
- **`workflow.stages`/`delegatesTo` completos** (a topologia inteira do
  fluxo da skill) não são representados — só o estágio atual (`stage`). Um
  consumidor que precise saber para onde uma skill pode delegar precisa ler
  o `skill.json` publicado, não a Resolution.
- **`routingReason`** não é preenchido pelos adapters de v2/v3 porque o SQL
  não o calcula/serializa — é uma lacuna do sistema de origem, não do
  adapter. Só `intelligenceRouter.js` (fora do escopo desta etapa) o produz.
- **`stage` para skills internas** (`tarefas`, `agenda`) é sempre `null` ao
  vir de v2, mesmo essas skills tendo workflow de múltiplos estágios em
  `skill.json` — v2 nunca rastreia/expõe estágio, então o adapter não tem de
  onde tirar essa informação sem inventá-la.

## 5. Relação com o Tool Registry

`allowedTools` (no topo e dentro de `stage`) é validado por
`validateIntelligenceResolution` contra `isKnownTool()` de
`packages/intelligence/src/tools.mjs` — a mesma fonte canônica criada na
ETAPA 3. Nenhuma lista paralela foi criada. Uma Resolution com
`allowedTools: ["tool.inexistente"]` é inválida (ver
`test/tool-registry.test.mjs` do Registry e `test/intelligence-contract.test.mjs`
contrato D).

## 6. O que ainda NÃO usa este contrato

- `nucleo_intelligence_context_resolve_v2`/`_v3` (SQL) — não foram tocados;
  continuam a única fonte de verdade em produção.
- WhatsApp, Portal, Simulador, runtime Python externo, MCP — nenhum consumidor
  foi alterado para depender disto nesta etapa.
- Não existe `resolveIntelligence(request)` executável. Esta etapa criou
  linguagem (`IntelligenceRequest`/`IntelligenceResolution` + adapters +
  validadores), não um novo cérebro que decide skill/estágio.
- Não existe `agentId`/`agentRouter`/`agentTeam`/`soul` no contrato. O
  sistema atual usa `assistant`/`assistant_profiles`; o contrato foi desenhado
  para não precisar de uma mudança de forma quando `assistant` evoluir para
  `agent` — mas essa evolução em si não foi antecipada.

## 7. `contractVersion`

`CONTRACT_VERSION = 1`, exportado de `intelligence-resolution.mjs`.

**Decisão**: não reaproveitar `fase-h-2`/`fase-h-3` como versão deste
contrato — esses nomes descrevem a evolução dos *resolvedores SQL*
(`nucleo_intelligence_context_resolve_v2`/`_v3`), não a deste contrato, que é
uma camada acima e pode evoluir em ritmo diferente. Por exemplo: um adapter
novo (de `intelligenceRouter.js`, ou de um futuro Core executável) pode
passar a preencher `routingReason` sem que uma linha de SQL mude — isso seria
`contractVersion: 2`, sem tocar em `fase-h-4`. O valor de origem continua
rastreável em `sourceSchemaVersion`, então nenhuma informação de proveniência
se perde ao separar os dois números.

## 8. Evolução futura para Agents

`assistant_profiles` é a entidade real hoje. Quando o sistema evoluir para
`agent` (múltiplos agentes, `soul.md`, Agent Router, `agent_tools`), o campo
`IntelligenceResolution.assistant` é o ponto de extensão natural — mas essa
migração não é desta etapa. O contrato foi desenhado para não ter que mudar
de *forma* quando isso acontecer (ainda haverá "quem está respondendo",
"que ferramentas pode usar", "qual estágio está em curso"), mas o *conteúdo*
de `assistant` vai crescer — e só então.
