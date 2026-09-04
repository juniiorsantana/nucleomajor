# Intelligence Core

## O que é, nesta etapa

**Nesta fase o Intelligence Core não decide roteamento. Ele normaliza a
execução dos resolvedores existentes.** Skill, campanha, estágio, handoff,
prioridade — tudo isso continua sendo decidido inteiramente pelo SQL
(`nucleo_intelligence_context_resolve_v2`/`_v3`). O Core só dá um único
ponto de entrada, com validação de entrada e saída, para chamar esse SQL sem
que quem chama precise conhecer o formato bruto do payload.

```text
IntelligenceRequest
      ↓
resolveIntelligence(request, options, dependencies)
      ↓
Resolver Port (dependencies.resolver)
      ↓
resolveV2 / resolveV3  ──→  RPC nucleo_intelligence_context_resolve_v2/_v3 (Supabase)
      ↓
payload cru (JSON do SQL)
      ↓
Adapter (resolutionFromV2 / resolutionFromV3, da ETAPA 4)
      ↓
IntelligenceResolution validada (inclui checar allowedTools no Tool Registry)
```

## Por que uma "porta" em vez de importar Supabase direto

`packages/intelligence` não tem — e não pode ganhar — nenhum import de
`fetch`, SDK do Supabase, env var ou URL de banco. Isso está provado por
teste (`test/intelligence-core.test.mjs` roda inteiro com um resolver fake,
sem rede) e por auditoria de imports (nenhum arquivo de
`packages/intelligence/src/core.mjs`, `resolver-port.mjs` ou `contracts/*`
importa nada de I/O externo). Isso permite o mesmo Core ser reutilizado por
Portal, Simulador, testes e futuros canais sem duplicar a lógica de
adaptação/validação em cada um.

## Resolver Port

`packages/intelligence/src/resolver-port.mjs`

Contrato mínimo, duck-typed (sem classe/interface):

```js
resolver.resolveV2(request: IntelligenceRequest) => Promise<rawPayload>
resolver.resolveV3(request: IntelligenceRequest) => Promise<rawPayload>
```

`rawPayload` é o JSON cru que os resolvedores SQL devolvem — o mesmo formato
que `resolutionFromV2`/`resolutionFromV3` (ETAPA 4) já sabem traduzir.
`isResolverPort(value)` confere só a forma (duas funções), não a origem do
objeto — um fake de teste, a implementação Supabase real, ou qualquer outra
coisa que "pareça um resolver" serve.

## `resolveIntelligence`

`packages/intelligence/src/core.mjs`

```js
resolveIntelligence(request, options = {}, dependencies = {})
// options.resolverVersion: "v2" | "v3" (obrigatório)
// dependencies.resolver: Resolver Port (obrigatório)
// → Promise<IntelligenceResolution> | lança IntelligenceCoreError
```

A versão do resolvedor é **política de execução**, não conteúdo da
conversa — por isso vive em `options`, nunca dentro de `IntelligenceRequest`
(que continua sem `resolverVersion`/`routingMode`/`faseH`, como já era na
ETAPA 4). `shadow` (rodar os dois e comparar, como o runtime Python faz
hoje) fica para uma etapa futura, como uma Execution Policy separada — aqui
só os dois modos determinísticos e explícitos que já existem em SQL.

### Erros

`IntelligenceCoreError extends Error`, com `.code` e (quando aplicável)
`.details` (mensagens já produzidas pelos próprios validadores, seguras de
expor) ou `.cause` (o erro original de infraestrutura — nunca colocado em
`.message`, para não vazar detalhe interno a quem só precisa do código):

| Código | Quando |
|---|---|
| `INVALID_REQUEST` | `IntelligenceRequest` não passa em `validateIntelligenceRequest` |
| `UNSUPPORTED_RESOLVER_VERSION` | `options.resolverVersion` não é `"v2"` nem `"v3"` |
| `RESOLVER_UNAVAILABLE` | `dependencies.resolver` ausente/malformado, ou `resolveV2`/`resolveV3` rejeitou (rede, RPC, etc.) |
| `INVALID_RESOLVER_PAYLOAD` | o payload adaptado não passa em `validateIntelligenceResolution` — inclui `allowedTools` com ferramenta fora do Tool Registry |

## Implementação Supabase

`src/intelligenceResolver.mjs` — `createSupabaseIntelligenceResolver({ supabaseUrl, supabaseKey, token, fetchImpl })`.

Fica em `src/` (backend do Portal Público), ao lado de
`intelligenceContext.mjs`, e reusa o mesmo mecanismo que `supabaseRequest()`
em `src/server.mjs` já usa — `fetch` cru contra o REST/RPC do PostgREST, sem
introduzir `@supabase/supabase-js` (que este workspace não tem como
dependência; só `apps/emyleads` usa o SDK). Chama:

```text
resolveV2 → POST {supabaseUrl}/rest/v1/rpc/nucleo_intelligence_context_resolve_v2
resolveV3 → POST {supabaseUrl}/rest/v1/rpc/nucleo_intelligence_context_resolve_v3
body: { conversation_key_hash, requester_phone, incoming_text, source_data }
```

### Achado da auditoria desta etapa

`nucleo_intelligence_context_resolve_v2`/`_v3` recebem só esses 4 parâmetros
— **não** `organization_id`/`audience`/`channel`. O SQL deriva organização e
audiência internamente (telefone do solicitante via
`nucleo_operator_context`, credencial do robô que chama a função). Isso é
diferente de `intelligence_context_preview` (usada pelo Simulador), que
recebe `target_organization`/`target_audience` explícitos. Consequência:
`IntelligenceRequest.organizationId`/`.audience`/`.channel` **não são
enviados** nesta chamada — ficam no Request porque fazem parte do que "pedir
uma resolução" significa conceitualmente (e são usados por
`intelligence_context_preview`, um resolvedor que esta etapa não integrou),
mas o adapter para v2/v3 real não os usa. Documentado, não escondido — ver
`src/intelligenceResolver.mjs`.

**Auditoria também confirmou**: nenhum arquivo JS deste repositório chama
`nucleo_intelligence_context_resolve_v2`/`_v3` hoje — elas só existem como
SQL, consumidas por um runtime externo (Bridge/Python na VPS, outro
repositório). As únicas RPCs de inteligência chamadas por este repo são
`intelligence_internal_context` (`src/server.mjs`, usada pelo assistente
web) e `intelligence_context_preview` (`apps/emyleads`, usada pelo
Simulador) — nenhuma das duas é v2/v3. Por isso criar
`createSupabaseIntelligenceResolver` não migra nenhum consumidor: é
capacidade nova, ainda não usada por ninguém em produção.

## `LIVE_RESOLVER_INTEGRATION = PENDING`

A validação do Resolver Port contra um Supabase real (ETAPA 5.1) **não foi
feita** e é **pré-condição** para migrar qualquer consumidor real para o
Core. Motivo:

- `nucleo_intelligence_context_resolve_v2`/`_v3` **persistem estado**. A
  função base passa `should_persist => true` fixo
  (`supabase/migrations/20260823120000_fase_h_inteligencia_contextual.sql:1063-1066`),
  e v3 ainda escreve em `conversation_skill_sessions`. Não são operações
  puras — `resolveIntelligence` não deve ser tratado como read-only.
- As duas exigem **credencial de robô ativa**: a base levanta
  `active robot credential required` se `private.robot_organization()` for
  nulo (mesma migration, linha 1051), e ainda exige uma
  `connection_robot_credentials` ativa (linhas 1052-1058) — a identidade de
  uma conexão de WhatsApp real.
- Não há ambiente seguro disponível: `.env` e `.env.skills.local` apontam
  para o mesmo projeto (produção), não há staging, e a stack local
  (`supabase/config.toml` existe) precisa de Docker, indisponível.

Antes de qualquer consumidor real passar a usar o Core, é preciso um
Supabase de staging/local com organização e credencial de robô **de teste**
dedicadas.

## O que ainda NÃO usa isto

- Nenhum SQL foi alterado.
- Nenhum consumidor (WhatsApp, Portal, Simulador, runtime Python, MCP) foi
  migrado para chamar `resolveIntelligence`.
- `src/server.mjs` continua chamando `intelligence_internal_context`
  diretamente, como antes.
- `apps/emyleads/src/web/intelligenceProvider.js` continua chamando
  `intelligence_context_preview` diretamente, como antes.
- Não existe roteamento próprio do Core, nem Shadow, nem Agents/Agent
  Router/`soul.md` — nada disso foi antecipado.

## Testes

- `test/intelligence-core.test.mjs` — Core inteiro com Resolver Port fake,
  prova de isolamento (sem Supabase/rede).
- `test/intelligence-resolver-supabase.test.mjs` — implementação Supabase
  com `fetch` mockado, prova o mapeamento request → RPC (path/params), sem
  rede real nem produção.
