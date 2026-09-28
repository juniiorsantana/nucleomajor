# Migração multi-agent: de `assistant_profiles` para Agents

> **Assumindo o trabalho agora?** Comece por
> [CONTINUACAO-MULTI-AGENT.md](./CONTINUACAO-MULTI-AGENT.md): o que está
> aplicado em produção, o que está só escrito, o que bloqueia a próxima etapa e
> as armadilhas de ambiente que já custaram tempo. Este documento é o
> **desenho**; aquele é o **estado**.

## O estado de hoje

`assistant_profiles` carrega `unique (organization_id, audience)`
(`supabase/migrations/20260823120000_fase_h_inteligencia_contextual.sql:174`).
Cada organização tem exatamente **um** agente interno e **um** de cliente,
criados automaticamente por `private.provision_intelligence()` no trigger de
criação da organização (mesma migration, linhas 554-602).

O objetivo de produto é permitir N agentes por audience, cada um com nome,
identidade, papel, tom, `soul.md`, skills, canais, conhecimento, guardrails,
handoffs e permissões. Esta etapa (FASE A) criou só o **conceito de domínio**
— `packages/intelligence/src/agent.mjs` — sem tocar em banco, RPC, UI ou
runtime.

```text
assistant_profiles (persistência atual, inalterada)
        ↓ assistantProfileToAgentDefinition (adapter puro)
AgentDefinition (conceito canônico novo)
```

## A pergunta central: e se removêssemos a UNIQUE hoje?

**Nada quebraria com erro.** É exatamente por isso que é perigoso.

Quase todo o sistema resolve o agente com `limit 1` **sem `order by`**, o que
não lança exceção com 2+ linhas — apenas escolhe uma de forma não
determinística, dependente do plano de execução do Postgres. Remover a
constraint sozinha transformaria um sistema hoje determinístico (uma linha,
sempre a mesma) em um onde o agente que responde pode variar entre chamadas,
**em silêncio, sem log e sem erro**.

Os pontos afetados, do mais crítico para o menos:

| # | Ponto | Arquivo:linha | O que acontece com N agentes |
|---|---|---|---|
| 1 | `private.intelligence_payload` | `20260823120000...sql:832-836` | `limit 1` sem `order by`. É a base de `nucleo_intelligence_context_resolve` (WhatsApp), `intelligence_internal_context` (assistente web) e `intelligence_context_preview` (Simulador) — **os três** passariam a usar um agente arbitrário |
| 2 | `nucleo_customer_assistant_access` | `20260826150000_fase_h_piloto_externo.sql:268-271` | Guarda de entrada de todo atendimento externo. O `rollout mode` (`off`/`pilot`/`active`) e os contatos-piloto ficam presos ao agente sorteado — o modo efetivo pareceria "piscar" entre configurações |
| 3 | `nucleo_intelligence_context_resolve_v2` (lookup da skill `tarefas`) | `20260828210000_corrigir_roteamento_tarefas_interno.sql` | Join `assistant_profiles × assistant_profile_skills` filtrando só por `audience='internal'`; o `order by` desempata a skill, nunca o perfil |
| 4 | `private.provision_intelligence` | `20260823120000...sql:554-602` | `on conflict (organization_id, audience) do nothing` deixa de proteger; o `select id into internal_profile` seguinte passa a pegar linha arbitrária |
| 5 | Tela de Campanhas | `apps/emyleads/src/page/telas/Inteligencia.jsx:91-93` | `data.profiles.find(item => item.audience === "customer")` — toda campanha nova seria amarrada ao **primeiro** perfil customer, ignorando os demais sem aviso |
| 6 | `nucleo_intelligence_context_resolve_v3` | `20260904120000...sql` (vigente) | Busca por `context_row.assistant_profile_id` (FK, seguro), mas herda o agente que o item 1 sorteou no primeiro turno — a conversa inteira fica presa a ele |
| 7 | Scripts de diagnóstico | `scripts/sql/diagnostico-*.sql`, `reproduzir-falha-do-contexto.sql` | `bool_and(active)` reportaria "inativo" se **qualquer** um dos N estivesse pausado; `limit 1` reportaria rollout de um agente arbitrário como se fosse "o" da organização |

### O que **não** quebraria

Tudo que opera por `id` explícito já é multi-agent-safe:

- `customer_assistant_rollout_update(target_profile, ...)` — recebe o `id`.
- `inteligencia.salvarPerfil` / `configurarSkill` / `configurarRollout`
  (`apps/emyleads/src/web/intelligenceProvider.js`) — sempre por `id`.
- `assistant_profile_skills` — PK `(profile_id, skill_id)`, já é N:N **por
  perfil**, não por audience. Não precisa de mudança de schema.
- `organization_campaigns.assistant_profile_id` — campanha já pertence a um
  agente específico, não a uma audience.
- RLS de `assistant_profiles` — nenhuma policy filtra por `audience`; a de
  INSERT já permitiria N linhas hoje. **Remover a unique não exige mudança de
  RLS.**
- `inteligencia.carregar` — já traz os perfis como array, sem `.single()`.

### O buraco de escrita

Não existe **nenhum** `insert` em `assistant_profiles` no portal
(`intelligenceProvider.js` só tem `update` por `id`). Hoje agentes só nascem
pelo trigger de provisionamento. Permitir N agentes exige criar essa rota —
ela não existe nem parcialmente.

## Matriz de compatibilidade

| Componente | Assume 1 agent/audience? | Como adaptar depois |
|---|---|---|
| `private.intelligence_payload` | **Sim** (`limit 1`, sem ordem) | FASE D: trocar por lookup do agente padrão explícito (`is_default`), com `order by` determinístico |
| `nucleo_intelligence_context_resolve_v2` | **Sim** (join por audience) | FASE D: filtrar pelo agente já resolvido, não por audience |
| `nucleo_intelligence_context_resolve_v3` | Parcial (herda do payload) | Nenhuma mudança própria — resolve por `assistant_profile_id`; corrigir a origem basta |
| `nucleo_customer_assistant_access` | **Sim** (`limit 1`) | FASE D: buscar o agente padrão de `customer` |
| `private.provision_intelligence` | **Sim** (`on conflict`) | FASE C: marcar os dois perfis criados como `is_default = true` |
| `intelligence_context_preview` (Simulador) | **Sim** (via payload) | FASE F: aceitar `target_agent` opcional para simular um agente específico |
| `organization_campaigns` / `campaign_skills` | **Não** (FK por `id`) | Nenhuma |
| `assistant_profile_skills` | **Não** (PK por `profile_id`) | Nenhuma no schema; rever a semântica de `salvarSkill`, que hoje vincula a **todos** os perfis do audience |
| Central de Inteligência — aba Assistentes | Parcial (itera, mas UX binária) | FASE F: agrupar por audience, permitir criar/arquivar |
| Central de Inteligência — aba Campanhas | **Sim** (`.find(audience === "customer")`) | FASE F: seletor explícito de agente |
| `inteligencia.salvarPerfil` / `configurarRollout` / `configurarSkill` | **Não** (por `id`) | Nenhuma |
| Criação de agente via API/UI | **Inexistente** | FASE F: criar a rota de `insert` |
| `intelligenceRouter.js` (Simulador) | **Sim** (mistura skills de todos os perfis) | FASE F: filtrar bindings por agente escolhido |
| `src/intelligenceContext.mjs` | **Sim** (`payload.assistente` singular) | Nenhuma enquanto a RPC devolver um agente resolvido |
| Contrato `IntelligenceResolution.assistant` | **Sim** (objeto único) | Nenhuma — a Resolution representa **a decisão**, um agente por turno. Vira `agent` quando a FASE G existir |
| Scripts `scripts/sql/diagnostico-*.sql` | **Sim** | FASE D/E: agrupar por agente em vez de por organização |
| `test/visual_phase_h.py` | **Sim** (fixture 1+1) | FASE F: fixture com N |

## FASE B: identidade persistida

Migration: `supabase/migrations/20260904160000_identidade_do_agente_em_assistant_profiles.sql`.
Aditiva. Acrescenta três colunas e nada mais:

| Coluna | Tipo | Backfill |
|---|---|---|
| `slug` | `text not null` | `private.agent_slug(display_name, audience)` para toda linha existente; gatilho `assistant_profiles_fill_slug` preenche toda linha nova |
| `role` | `text` nullable | `NULL` — não há de onde tirar sem inventar |
| `soul_markdown` | `text` nullable | `NULL` — migrar prompt antigo para soul é decisão de produto, com etapa própria |

`tone` **não** ganhou coluna nova: já existia (`text not null default 'claro, cordial e objetivo'`, `length <= 500`), e o domínio espelha esse limite.

### `slug` ≠ `display_name`

Os dois **não são equivalentes** e não devem ser tratados como tal:

- **`slug` é identidade TÉCNICA**: estável, calculada uma vez, nunca reescrita
  quando o nome muda. É por ela que código, URL e configuração referenciam um
  agente.
- **`display_name`/`name` é identidade HUMANA**: pode ser reescrita à vontade
  pelo portal, quantas vezes quiserem, sem consequência para nada que
  referencie o agente.

Renomear "Marina" para "Marina — Recepção" muda o nome e **não** muda o slug.
Por isso o adapter prefere `row.slug` e só cai na derivação como
compatibilidade de transição.

### A regra de slug tem uma fonte canônica

Ela existe em dois lugares por necessidade (um em JS, um em SQL), e a
divergência entre eles é impedida por três camadas:

1. `slugFromAgentName` (`packages/intelligence/src/agent.mjs`) bate com o
   corpus de `test/fixtures/agent/agent-slug-cases.json`;
2. o bloco de prova dentro da própria migration declara **exatamente** o mesmo
   corpus — comparado textualmente em `test/agent-slug-equivalence.test.mjs`;
3. na aplicação, aquele bloco roda no Postgres real e **levanta exceção** se o
   banco computar qualquer coisa diferente. A migration falha em vez de gravar
   slug divergente.

A camada 3 é a única que prova o comportamento do Postgres, e não pode rodar
sem banco. As camadas 1 e 2 garantem que, quando ela rodar, estará checando a
coisa certa.

### Colisão de slug: analisada, não imposta

`unique (organization_id, slug)` **não** foi criada. A preferência
arquitetural é identidade única por organização, mas não há como provar hoje
que o backfill não colide: dois perfis da mesma organização podem ter sido
renomeados para o mesmo nome pelo portal, e não existe ambiente seguro para
consultar os dados reais antes de aplicar (ver `LIVE_RESOLVER_INTEGRATION`).

Impor a constraint agora arriscaria uma migration que falha em produção.
Resolver a colisão com sufixo automático quebraria a igualdade
`slug = agent_slug(display_name)` justamente na linha colidida — trocaria uma
divergência silenciosa por outra.

Em vez disso, a migration **mede**: um bloco final conta os pares
`(organization_id, slug)` repetidos e reporta por `RAISE NOTICE`. Quem
aplicar sai sabendo se a FASE C pode impor a constraint. Enquanto ninguém
resolve agente por slug — e hoje ninguém resolve —, a colisão não tem
consequência de runtime.

### `role` não é permissão

O sistema já usa `role` com outro significado: `public.organization_role`
(owner/admin/member), que é **autorização de pessoa**.
`assistant_profiles.role` é papel/função do agente — "recepcionista",
"vendedor" — e não concede nada. A distinção está gravada no schema, via
`comment on column`.

## Estratégia de agente padrão (`isDefault`)

O runtime legado precisa de um agente **determinístico** enquanto o Agent
Router não existir. A pergunta que ele faz hoje é implícita:

```text
organization + audience → o assistant (garantido pela UNIQUE)
```

No mundo multi-agent ela vira explícita:

```text
organization + audience → o agente PADRÃO daquela audience
```

```text
organização
  customer:  Agente A ← default    internal:  Agente D ← default
             Agente B                         Agente E
             Agente C
```

Por isso `AgentDefinition.isDefault` existe já nesta etapa. Hoje o adapter o
deriva como `true` **sempre** — porque a UNIQUE garante que a única linha
daquela audience é, por definição, a padrão. **Essa derivação morre no
instante em que a constraint cair**, e é exatamente por isso que a ordem das
fases importa: a coluna real de default (FASE C) e a troca dos resolvers
(FASE D) precisam vir **antes** da remoção da UNIQUE (FASE E). Inverter essa
ordem produz o cenário silencioso descrito acima.

## FASE C: o padrão vira coluna

Migration: `supabase/migrations/20260904190000_agente_padrao_explicito.sql`.

### Três conceitos que não se confundem

| | O que é | Quem decide |
|---|---|---|
| `is_default` | Identidade de fallback: "este é o agente padrão desta audience na organização" | Operador, pela UI (FASE F) |
| `active` | Elegibilidade operacional: se o agente pode atender agora | Operador, pela UI (já existe) |
| Agent Router selection | Qual agente atende **este turno**, entre os elegíveis | O router (FASE G, não existe) |

`is_default` **não** é seleção do Agent Router, **não** é obrigatoriedade para
toda conversa, **não** é prioridade comercial e **não** concede permissão
nenhuma.

### `is_default` é ortogonal a `active`

Pode existir `is_default = true` com `active = false`. Nesse caso o resolvedor
deve recusar com "sem padrão ativo" — **não** escolher outro agente por conta
própria.

Isso não é regra nova: é o que o sistema já faz. `private.intelligence_payload`
filtra `and profile.active` e, não achando, levanta
`assistant profile is inactive or unavailable`;
`nucleo_customer_assistant_access` devolve `reason: 'profile_inactive'`. Os
dois **recusam**. A coluna só dá nome ao que já era verdade — e por isso não
existe nenhuma constraint amarrando `is_default` a `active`.

### "No máximo um" ≠ "pelo menos um"

Duas invariantes diferentes, em camadas diferentes:

- **Banco**: no máximo um padrão, garantido pelo índice parcial
  `assistant_profiles_one_default_idx` — `(organization_id, audience) where is_default`.
- **Aplicação/resolvedor**: quando precisa responder, exige exatamente um
  padrão ativo. Isso é da FASE D e do fluxo de escrita.

Não há gatilho de eleição automática, de propósito: ele tornaria o banco
responsável por uma decisão de produto e impediria despromover alguém sem que
o banco escolhesse um substituto sozinho.

### Precedente do próprio projeto

`organization_campaigns` já resolve exatamente este problema desde agosto:
`is_default boolean not null default false` mais o índice parcial
`organization_campaigns_one_default_idx`. A FASE C segue a mesma forma e o
mesmo padrão de nome.

Com **uma divergência deliberada**: o índice de campanhas é
`where is_default and status in ('test','active')` — uma campanha padrão
encerrada libera a vaga. Para agente não filtramos por `active`, porque
`is_default` e `active` são ortogonais (acima). Filtrar permitiria duas linhas
`is_default = true` ao mesmo tempo, uma inativa e uma ativa, e tornaria a
coluna ambígua de ler.

### `unique (organization_id, slug)` entrou

A FASE B mediu zero colisões em produção, então a constraint foi criada.
Decisão de produto: **dois agentes da mesma organização não podem ter o mesmo
slug**, independentemente de audience. `display_name` continua livre para
repetir — dois agentes podem se chamar "Emília"; o que não podem é responder
pelo mesmo identificador técnico.

A migration reconta as colisões antes de impor e falha com mensagem clara se
encontrar alguma, em vez de estourar com violação de constraint.

### Provisionamento

`private.provision_intelligence` foi redefinida (a partir da definição **viva**
em produção, conferida por `pg_get_functiondef`) para informar
`is_default = true` nos dois inserts de perfil inicial. Sem isso, o
`default false` da coluna faria toda organização nova nascer sem agente
padrão — exatamente o que a FASE D precisa encontrar.

**Pendência que a FASE E vai encontrar:** os dois `on conflict
(organization_id, audience)` dessa função dependem da unique antiga. Quando ela
for removida, o `ON CONFLICT` fica sem índice correspondente e a função passa a
falhar. Precisa ser tratado junto com a FASE E, não depois.

## Agent ↔ Skills

A relação já existe e **não deve ser duplicada** dentro do agente:

```text
Agent ──── assistant_profile_skills (N:N, por profile_id) ──── Skill
```

`AgentDefinition` não tem campo `skills`, `skillIds` nem `allowedTools`, e o
adapter nunca os produz (provado em `test/agent-definition.test.mjs`,
contratos H e I). Skill continua entidade independente, publicada pelo
catálogo (`packages/intelligence/skills/`), validada contra o Tool Registry.

Ponto de atenção para a FASE F: `inteligencia.salvarSkill` hoje vincula uma
skill nova a **todos** os perfis daquele audience
(`Inteligencia.jsx:81`). Com um perfil só isso é indistinguível de "vincula
ao agente"; com N vira "toda skill nova vai para todo agente", que
provavelmente não é o desejado.

## Soul = persona. Permission Engine = segurança.

`soulMarkdown` descreve **quem o agente é e como se comporta**: tom, jeito de
abrir conversa, o que evita dizer, como se apresenta.

Ele **não** é autorização. Não deve conter — e o modelo não tem lugar para —
allowlist de ferramenta, ACL, escopo de dado ou permissão de banco. Um soul
pode pedir "seja formal"; não pode conceder `crm.contact.upsert`. Quem
autoriza é o Permission Engine, que ainda não existe, somado ao que já
existe hoje: `allowedTools` da skill (validado contra o Tool Registry) e as
policies de RLS do Postgres.

Isso é a mesma regra já registrada em
[TOOL-REGISTRY.md](./TOOL-REGISTRY.md): *registrar uma ferramenta no Tool
Registry não concede permissão de uso a nenhum agente, skill ou etapa*.

## Fases propostas

| Fase | O que | Estado |
|---|---|---|
| **A** | Conceito `AgentDefinition` no domínio + adapter puro + validação | ✅ **Feita** |
| **B** | Colunas novas em `assistant_profiles`, sem remover a unique: `slug`, `role`, `soul_markdown`. Backfill do slug a partir de `display_name` | ✅ **Aplicada em produção** em 04/09/2026 — `20260904160000_identidade_do_agente_em_assistant_profiles.sql` |
| **C** | Coluna explícita de default (`is_default`), com backfill `true` para as linhas existentes e constraint garantindo **no máximo um** default por `(organization_id, audience)` — a unique antiga continua de pé | ✅ **Aplicada em produção** em 04/09/2026 — `20260904190000_agente_padrao_explicito.sql` |
| **D** | Trocar os resolvers legados (itens 1-4 e 7 da tabela acima) para buscar o agente **padrão** em vez de assumir unicidade. Nenhum comportamento muda enquanto houver um agente só — é justamente por isso que essa fase é segura | ✅ **Aplicada em produção** em 04/09/2026 — `20260904230000_resolvers_usam_agente_padrao.sql` |
| **E** | Remover `unique (organization_id, audience)`. Só depois de D, e com o `pre-condição` da FASE C ativa | ✅ **Aplicada em produção** em 05/09/2026 — `20260905000000_a_audience_deixa_de_limitar_a_um_agente.sql` |
| **F** | API/UI: criar agente, listar por audience, escolher agente em campanha e no Simulador, revisar a semântica de `salvarSkill` | ✅ **Banco/API aplicados em produção** em 05/09/2026 (`20260905120000` + `20260905160000`). Código de gestão versionado e **não ativo**; UI é a próxima etapa |
| **G** (= FASE 13) | Agent Router: escolher entre os N elegíveis por turno (hoje inexistente — o mais próximo é a unicidade de banco). Aqui `IntelligenceResolution.assistant` vira `agent` | ✅ **Primeira fatia aplicada em produção** em 06/09/2026 — `20260905220000_fase_13_agent_router.sql`. O rename `assistant` → `agent` **não** entrou nesta fatia |

Ordem inegociável: **C e D antes de E.** Remover a constraint antes de os
resolvers saberem o que é "o agente padrão" é o cenário de regressão
silenciosa descrito no início deste documento.

O Permission Engine é ortogonal a essas fases e tem etapa própria.

## Aplicação das migrations

### FASE B — aplicada em produção, 04/09/2026

Aplicada por `supabase db query --linked -f supabase/migrations/20260904160000_identidade_do_agente_em_assistant_profiles.sql`.
Só essa migration, e nunca `db push`: o histórico remoto está incompleto desde
`20260821120000` e o push é destrutivo neste projeto
([[nucleomajor-nao-usar-supabase-db-push]]). O histórico remoto **não** foi
reparado — `supabase migration repair` para esta migration sozinha criaria uma
inconsistência maior do que a que resolve.

Antes do DDL, a equivalência do slug foi provada no próprio Postgres 17 de
produção contra o corpus canônico do domínio: **11/11 casos, zero
divergências**, incluindo acento, cedilha, til e os dois de fallback. É a
verificação que o ambiente local não podia dar, porque a stack local precisa de
Docker (mesmo bloqueio de `LIVE_RESOLVER_INTEGRATION`).

Estado depois, conferido pelo catálogo do Postgres e não pela mensagem de
sucesso do CLI:

| Verificação | Resultado |
|---|---|
| `slug`, `role`, `soul_markdown` existem | sim |
| `slug` NOT NULL, `role` e `soul_markdown` nullable | sim |
| perfis sem slug | 0 |
| `slug = private.agent_slug(display_name, audience)` | 100% das linhas |
| `role` / `soul_markdown` preenchidos artificialmente | 0 — todos NULL |
| total de perfis | 2, inalterado |
| `unique (organization_id, audience)` | intacta |
| `is_default` | ainda inexistente |
| colisões reais de `(organization_id, slug)` | **0** |

Esse zero é o dado que destravou a FASE C: `unique (organization_id, slug)`
deixou de ser aposta.

**Efeito colateral que vale registrar.** O backfill é um `UPDATE`, e a tabela
já tinha os gatilhos `assistant_profiles_touch` e `assistant_profiles_audit`.
Consequência: `updated_at` subiu nos dois perfis e `intelligence_audit_log`
ganhou duas linhas `profile`/`update`. Inofensivo, mas observável — quem
auditar depois vai ver duas edições de perfil em 04/09 que ninguém fez pela
tela.

**O que não foi verificado:** logs do Postgres e do serviço. O CLI não os expõe
por essa via e a VPS do Bridge está fora deste ambiente
([[vps-do-runtime-tem-codigo-fora-do-git]]). O que se verificou foi ausência de
sinais de erro no estado do banco: projeto `ACTIVE_HEALTHY`, 2 perfis ativos,
credencial do Bridge ativa.

### FASE C — pronta, não aplicada

`20260904190000_agente_padrao_explicito.sql` existe, passa nos testes
estáticos e **não foi aplicada em lugar nenhum**. Ela é auto-verificável: o
bloco de guarda recusa o backfill se já houver mais de um perfil por
(organização, audience), o de slug recusa a constraint se houver colisão, e o
bloco final falha se a unique antiga tiver sumido, se o índice parcial não for
parcial ou se sobrar perfil sem padrão.

O que os testes de `test/agent-default-migration.test.mjs` **não** conseguem
provar é comportamento: que o índice parcial de fato rejeita o segundo padrão,
que `default false` de fato vale para insert genérico, que a unicidade de slug
de fato barra a colisão. Isso exige um Postgres. Está em
`scripts/sql/prova-agente-padrao.sql`, que termina em `ROLLBACK` e é para banco
descartável — **nunca produção**, mesmo terminando em rollback: os gatilhos de
auditoria disparam de qualquer forma.

Ordem sugerida:

1. **Postgres descartável primeiro** (`supabase start`, ou uma cópia
   restaurada): aplicar a migration e rodar `prova-agente-padrao.sql`.
2. **Provar organização nova**, que é o caminho de maior risco: a
   `provision_intelligence` redefinida precisa terminar com os dois perfis
   iniciais `is_default = true`, e o gatilho de slug continua sendo o que torna
   `slug not null` seguro para quem nasce sem slug.
3. **Só então produção**, pelo mesmo fluxo controlado da FASE B.

Rollback: `drop index assistant_profiles_one_default_idx`, `alter table
public.assistant_profiles drop constraint assistant_profiles_organization_slug_key`,
`alter table ... drop column is_default`, e restaurar
`private.provision_intelligence` para a definição sem `is_default`. Nada
pré-existente é alterado — o backfill só escreve em coluna recém-nascida.

## FASE D — aplicada em produção, 04/09/2026

`20260904230000_resolvers_usam_agente_padrao.sql`, escrita em 04/09/2026 a
partir da definição **viva** em produção das três funções (`pg_get_functiondef`
na hora), **aplicada em produção em 04/09/2026**. O registro da aplicação, com
os hashes antes/depois e o que foi e o que não foi verificado, está em
[`docs/STATUS.md`](../STATUS.md).

### A regra

```
organização + audience + is_default = true   ->   o agente
depois, e só depois, verifica-se `active`
```

Em uma frase: **o Default Agent é o fallback explícito daquela audience, e um
padrão indisponível recusa a operação em vez de passar a vez.**

Três consequências que valem estar escritas, porque são o que distingue esta
fase de uma troca cosmética de `where`:

- **Default inativo = operação recusada.** `is_default` é identidade;
  `active` é elegibilidade. As duas são ortogonais desde a FASE C, e agora o
  código age assim: a seleção pergunta só quem é o padrão, e a checagem de
  `active` vem depois, separada, para poder recusar.
- **Outro agente ativo ≠ fallback automático.** Nenhuma das funções procura
  substituto. Promover agente é ato de pessoa, não consequência de
  indisponibilidade — senão uma conversa migraria de agente sozinha, sem
  ninguém ter decidido nada, e ninguém saberia dizer por quê.
- **A ordem do `where` era o bug latente.** `intelligence_payload` filtrava
  `and profile.active` dentro da seleção. Com um agente só, isso é
  indistinguível de checar depois. Com dois, é exatamente a diferença entre
  recusar e falar pelo outro. A FASE E teria transformado esse detalhe de
  sintaxe em troca silenciosa de agente.

### O que mudou, e o que deliberadamente não mudou

| Objeto | Mudou? | Por quê |
|---|---|---|
| `private.intelligence_payload` | **Sim** | O ponto de resolução de todo o runtime. Seleção por `is_default`, sem `limit 1`, `active` checado depois |
| `nucleo_customer_assistant_access` | **Sim** | Passa a pedir o padrão de `customer`. Já separava seleção de disponibilidade; faltava dizer *qual* perfil |
| `nucleo_intelligence_context_resolve_v2` | **Sim** | Tinha seleção implícita própria (entrava por um perfil `internal` qualquer para achar o skill `tarefas`). Agora entra pelo padrão |
| `nucleo_intelligence_context_resolve_v3` | Não | Nunca escolheu agente: lê `context_row.assistant_profile_id`, gravado pelo payload a cada turno. Corrigir o payload já o corrige |
| `nucleo_intelligence_context_resolve` (v1) | Não | Delega inteiramente ao payload; só decide a *audience* |
| `intelligence_context_preview` | Não | Também delega ao payload. Redefinir seria criar uma segunda semântica de padrão |
| `private.provision_intelligence` | Não | A FASE C já a deixou criando os dois perfis iniciais com `is_default = true` |

O critério aqui foi **uma** semântica de padrão, não várias implementações
convergentes por coincidência. Onde a função herda a seleção, ela não foi
tocada — e os testes (`H`, `F` de
`test/agent-default-resolution-migration.test.mjs`) travam isso: se alguém
redefinir o v3 ou o preview dentro desta fase, o teste reprova.

### Mensagens públicas preservadas

Nada virou erro genérico para simplificar SQL. `intelligence_payload` continua
levantando `assistant profile is inactive or unavailable` — agora por dois
caminhos (não existe padrão / o padrão está inativo), o que já era o caso
antes, já que o filtro único também colapsava os dois. E
`nucleo_customer_assistant_access` continua devolvendo `profile_inactive`,
tanto para padrão inativo quanto para ausência de padrão (fail closed).

### O que a FASE D **não** faz

Não remove a `unique (organization_id, audience)` — a migration inclusive
**falha** se ela não estiver lá. Não cria agente, não implementa Agent Router,
não encosta em UI, Portal ou Simulador, e não migra consumidor para o
Intelligence Core. É só isto: fazer o backend existente resolver o agente
padrão explicitamente, para que a FASE E possa remover a constraint sem que
nada passe a sortear agente.

**Dívida repetida da FASE E:** os dois `on conflict (organization_id,
audience)` de `provision_intelligence` dependem da unique antiga e vão falhar
quando ela cair. Tratar junto com a FASE E, não depois.

### Provas

Estáticas, em `test/agent-default-resolution-migration.test.mjs` (A–L, 12/12):
que a migration declara a regra, que a recusa é separada da seleção, que
nenhum `limit 1` decide qual agente, que a unique antiga continua exigida e que
o v3/preview/provision não foram redefinidos.

Comportamental, em `scripts/sql/prova-resolvedor-agente-padrao.sql`, para
Postgres descartável — **nunca produção**, e neste caso a advertência é mais
séria que a de costume: o item F **remove a UNIQUE antiga** dentro da
transação para simular o mundo pós-FASE-E. Ele prova o cenário que nenhuma
leitura de SQL prova sozinha: com Agent A (padrão) e Agent B convivendo na
mesma audience, resolve A; e com A inativo e **B ativo ao lado**, recusa em vez
de cair em B, tanto por `intelligence_payload` (F.2) quanto por
`nucleo_customer_assistant_access` (F.3) — as duas funções alteradas com
seleção própria. O item G é o controle negativo — mostra que a regra antiga
*teria* caído em B, ou seja, que o item F não passou por acaso. O item E prova
`nucleo_customer_assistant_access` fim a fim (default ativo/inativo/ausente),
via credencial de robô simulada através dos GUCs de JWT que o harness já
implementa.

> **Executada em 04/09/2026, PostgreSQL 17.6 userspace descartável na VPS**
> (mesmo ambiente e receita da prova da FASE C — ver
> [[prova-comportamental-da-fase-c-na-vps]]): **A–H, 100% PASS**, incluindo
> E.1–E.3 (customer access) e F.1–F.3 (cenário de dois agentes, com o padrão
> inativo recusando nas duas funções). Produção reconferida por hash das 5
> funções antes e depois: **idêntica**. Ambiente destruído por completo ao
> final — processo, cluster e diretório em `/tmp`, nada residual na VPS.
>
> O que essa prova **não** cobre, por desenho e não por lacuna: `v3` não tem
> chamada direta, porque ele não tem seleção de agente própria — o item D
> prova que o mecanismo do qual ele depende (o contexto gravado pelo payload)
> está correto, e o contrato estático `H` do arquivo de teste trava que ele só
> pode ler por `assistant_profile_id` pinado. Exercitar v3 ponta a ponta
> exigiria montar skill de recepção publicada e sessão de skill — máquina da
> FASE H3, alheia ao que a FASE D mudou.
>
> A FASE D está, portanto, **validada comportamentalmente**, no mesmo grau que
> a FASE C.

## FASE E — aplicada em produção, 05/09/2026

`20260905000000_a_audience_deixa_de_limitar_a_um_agente.sql`, escrita em
04/09/2026 e **aplicada em produção em 05/09/2026**. O registro da aplicação,
com os hashes antes/depois e o que foi e o que não foi verificado, está em
[`docs/STATUS.md`](../STATUS.md). Ela remove
`unique (organization_id, audience)` de `assistant_profiles` — a constraint que
até a FASE D era a única razão pela qual o produto acertava o agente: não havia
critério de escolha, havia impossibilidade de erro.

### Auditoria das dependências da unique antiga

Todo ponto do repositório e do banco cuja semântica dependia de existir no
máximo um agente por audience, classificado:

| Dependência | Classe | Por quê |
|---|---|---|
| `private.provision_intelligence` — 2× `on conflict (organization_id, audience)` | **A** | O árbitro deixa de existir com o DROP e a função passa a falhar (`there is no unique or exclusion constraint matching the ON CONFLICT specification`). Reescrita nesta migration. |
| `private.provision_intelligence` — 2× `select id into … where audience = …` | **A** | Achado novo, não registrado nas FASES C/D. `select into` sem `strict` pega a **primeira** linha e descarta o resto sem erro: com N agentes, amarra as skills iniciais a um agente sorteado. Passa a exigir `is_default`. |
| `Inteligencia.jsx` — `profiles.find(item => item.audience === "customer")` | **A** | Caminho de escrita ativo: o `customer.id` vira o `profileId` da campanha. Passa a exigir `is_default`, com guarda para o caso de não haver padrão. |
| `private.intelligence_payload`, `nucleo_customer_assistant_access`, `resolve_v2` | **B** | A FASE D já os fez pedir `is_default` explicitamente. |
| `nucleo_intelligence_context_resolve` (v1), `_v3`, `intelligence_context_preview` | **B** | Não têm seleção própria: delegam ao payload, ou leem `context_row.assistant_profile_id` pinado. |
| RLS de `assistant_profiles` (3 policies) | **B** | `is_org_member` / `can_manage_org` — por organização, nunca por audience. |
| Gatilhos (`audit`, `fill_slug`, `touch`) | **B** | Row-level, agnósticos de audience. |
| FKs que apontam para `assistant_profiles` (`assistant_profile_skills`, `conversation_intelligence_contexts`, `customer_assistant_pilot_contacts`, `organization_campaigns`) | **B** | Todas por `id` do agente — é o que impede skill de um agente vazar para outro. |
| `customer_assistant_rollout_update` | **B** | Opera por `id` recebido do chamador. |
| `intelligence_scheduling_bindings_sync` | **B** | Opera sobre o **conjunto** de agentes customer, não escolhe um. Com N agentes passa a amarrar a skill de agenda a todos — comportamento inalterado hoje, a revisitar na FASE F. |
| `Inteligencia.jsx` — `salvarSkill` com `profiles.filter(audience)` | **C** | Amarra a skill nova a todos os agentes daquela audience. É filtro, não escolha arbitrária; a semântica de "para quais agentes publico este skill" é da FASE F. |
| `Inteligencia.jsx` — rollout por agente | **C** | Só o rollout do **padrão** é lido por `nucleo_customer_assistant_access`. Com N agentes a tela precisa dizer isso. FASE F. |
| `scripts/sql/diagnostico-*.sql` | **D** | Diagnóstico read-only; passam a listar mais linhas, e isso é o correto. |

Não existe **nenhum** `insert`/`upsert` de `assistant_profiles` no código do
portal ou do servidor — a única via de criação é `provision_intelligence`. Criar
um segundo agente pela API é, portanto, FASE F.

### A invariável, depois desta fase

O banco garante **no máximo um** padrão por `(organization_id, audience)`, pelo
índice parcial da FASE C. Ele **não** garante "pelo menos um": isso não vira
gatilho aqui, e o resolvedor continua falhando fechado quando não houver padrão.

Mas a migration **exige exatamente um** padrão para toda audience que já existe,
como guarda de execução. Entrar no multi-agent com uma audience órfã seria
escolher, em silêncio, que aquele público para de ser atendido. Ela recusa e não
corrige dado.

### Consequência que precisa estar escrita

Depois do DROP, a policy `assistant_profiles_insert` (`can_manage_org` +
`created_by = auth.uid()`) passa a permitir que um gestor crie um segundo agente
pela API REST, sem UI. É o modelo de dados sendo liberado antes da tela, que é o
objetivo da fase. É seguro porque `is_default` nasce `false`: o agente entra como
comum e **não** atende ninguém. Promover exige `update` explícito, e o índice
parcial rejeita o segundo padrão.

### Provas

> Estáticas: `test/agent-multi-audience.test.mjs`, 9 itens — a migration remove
> uma constraint e só ela, as guardas existem, `provision_intelligence` deixa de
> inferir a unique removida e passa a ler o padrão, nenhum resolvedor é
> redefinido, e a UI não escolhe agente por audience arbitrária.
>
> Comportamental: `scripts/sql/prova-multi-agente.sql` rodou em PostgreSQL
> **17.9** userspace descartável na VPS, com **PASS em A–N**, incluindo 3
> agentes customer + 2 internal na mesma organização; padrão inativo recusando
> com dois agentes ativos disponíveis; ausência de padrão falhando fechado;
> `provision_intelligence` idempotente **depois** do DROP; e slug por
> organização. Controle negativo: devolver o `on conflict` antigo reproduz
> exatamente `there is no unique or exclusion constraint matching the ON
> CONFLICT specification`, e remover a FASE D faz a guarda abortar — a prova
> sabe reprovar.
>
> Desvio de versão registrado: a prova da FASE C/D usou 17.6, igual a produção.
> O 17.6 saiu do pool do PGDG e o mais próximo disponível para noble era o
> **17.9**. A semântica sob teste — inferência de `ON CONFLICT` por índice
> parcial, unique, RLS — não varia entre patches do mesmo major. Produção
> reconferida por hash das 6 funções antes e depois: **idêntica**, e a unique
> antiga continua de pé lá. Ambiente da VPS destruído por completo ao final;
> nada foi instalado no sistema (binários extraídos em `/tmp`).

### Revisão semântica de `provision_intelligence` (ETAPA 10B)

Feita antes de aplicar em produção, contra a definição **viva**
(`pg_get_functiondef`), não contra o arquivo da FASE C.

**O antigo nunca foi `DO UPDATE`.** Os dois `on conflict (organization_id,
audience)` da versão em produção são `do nothing`. Nenhum campo — `display_name`,
`tone`, `active`, `template_id`, `brand_config`, `process_config`, `updated_by`
— jamais foi atualizado ao reencontrar um perfil existente. Reencontrar sempre
significou reutilizar.

O diff semântico entre vivo e proposto tem **exatamente as três mudanças
previstas** e nada mais. (Um `referÃªncias` apareceu no diff textual; conferido
direto no catálogo, produção tem a acentuação correta — era mojibake do cliente
Windows, não diferença real.)

#### A única divergência de comportamento observável

O árbitro muda de escopo, e isso importa em um único estado:

| Estado de `(org, audience)` quando a função roda | Árbitro antigo (unique inteira) | Árbitro novo (índice parcial) |
|---|---|---|
| Sem nenhum agente | insere | insere |
| Um agente, `is_default = true` | conflito → nada | conflito → nada |
| **Agentes, mas nenhum padrão** | **conflito → nada** (audience fica órfã) | **insere o padrão que faltava** |
| Vários agentes, um padrão (só pós-FASE-E) | n/a | conflito → nada |

Classificação: **A — desejada**. Uma audience povoada e sem padrão é uma
audience que parou de ser atendida, porque os resolvedores falham fechado sem
padrão. O novo comportamento repara isso sem violar nenhuma das regras da fase:
cria um agente **novo**, não promove o que já estava lá, não altera e não apaga
ninguém (itens `Q` e `P` da prova).

**Esse estado é inalcançável pelo chamador real.** Ver call sites abaixo.

O custo dessa divergência está provado e registrado (item `Q.2`): se o agente
órfão tiver o mesmo `display_name` que a função insere, o slug gerado colide com
`unique (organization_id, slug)` e a função **falha alto** (`unique_violation`).
O árbitro do `ON CONFLICT` é o índice de padrão, não o de slug, então essa
violação não é absorvida. Falha ruidosa num caminho inalcançável é aceitável;
fica escrito para a FASE F, que é quem pode tornar o caminho alcançável.

#### Call sites

Um só: o gatilho `organizations_provision_intelligence`, **`AFTER INSERT ON
public.organizations FOR EACH ROW`**, via
`private.provision_intelligence_after_organization`, que só faz
`perform private.provision_intelligence(new.id, new.created_by)`.

`AFTER INSERT`, não `AFTER UPDATE`: a função roda uma vez por organização, com a
organização recém-criada e **sem nenhum perfil**. É bootstrap puro. Nunca
reexecuta sobre organização com agentes já configurados — e é por isso que a
divergência acima não tem como aparecer em produção hoje.

Observação de escopo, **pré-existente e não introduzida pela FASE E**: o schema
`private` tem `USAGE` para `authenticated` e a função tem `EXECUTE` para
`PUBLIC` (o padrão do Postgres). Ela só não é chamável pela API porque o
PostgREST não expõe o schema `private`. Vale conferir `PGRST_DB_SCHEMAS` numa
etapa própria; se algum dia `private` for exposto, o problema é bem maior que
esta fase.

#### Decisão: `DO NOTHING`, mantido

Reencontrar o padrão **não** deve atualizar campos de configuração. Trocar por
`DO UPDATE` seria comportamento novo, não preservação do atual, e criaria uma
regressão concreta: uma organização que renomeou o próprio assistente pela tela
teria o nome revertido para `Assistente da empresa` no próximo provisionamento.
Como o único chamador é bootstrap, não existe nem o caso de uso que justificaria
atualizar. O item `O` da prova trava isso: depois de personalizar o padrão
(nome, tom, `active`, template, `brand_config`, `process_config`) e chamar a
função, a linha volta **byte a byte idêntica**.

## FASE F — aplicada em produção, 05/09/2026

Migrations `20260905120000_trocar_o_agente_padrao_e_um_ato_so.sql` e
`20260905160000_protege_campos_estruturais_dos_agentes.sql`, escritas em
05/09/2026 e **aplicadas em produção em 05/09/2026**, nesta ordem. O registro
da aplicação está em [`docs/STATUS.md`](../STATUS.md). A FASE E liberou o modelo; esta fase
dá as operações para usá-lo sem reintroduzir na aplicação as ambiguidades que
as FASES C–E tiraram do banco.

### Security gate (pré-requisito da fase)

Antes de criar qualquer superfície de escrita nova, o achado da FASE E foi
auditado. Resultado: **PASS**, com a exposição classificada como **B —
desnecessária, sem acesso externo**.

O PostgREST responde `PGRST106 — "Only the following schemas are exposed:
public, graphql_public"` a uma chamada com `Content-Profile: private`. O schema
`private` **não** está exposto, então os `EXECUTE` amplos não são alcançáveis
pela API. A exposição continua desnecessária e continua registrada como dívida
de hardening: 37 das 50 funções `private` estão no ACL padrão (`EXECUTE` para
`PUBLIC`), incluindo `intelligence_payload` e `provision_intelligence`, ambas
`security definer`. Nenhuma foi alterada aqui — mexer em grants no meio de uma
fase de produto é como uma correção de segurança passa despercebida.

### A arquitetura que já existia, e que esta fase segue

Auditada antes de desenhar qualquer coisa. A Central de Inteligência escreve
**frontend → PostgREST, com RLS decidindo**, e usa **RPC** só quando a operação
precisa ser atômica ou privilegiada (`customer_assistant_rollout_update`,
`customer_handoff_transition`, `intelligence_skill_rollback`). O servidor Node
**não participa** desta tela — ele serve `/api/assistant` e `/api/invitations`.
Padrão: **híbrido, predominantemente frontend-direto, com RPC onde a
atomicidade exige**.

A FASE F não cria arquitetura paralela: leitura e escrita simples continuam
diretas com RLS, e a troca de padrão — a única operação multi-linha — vira RPC.

| Camada | Arquivo | Papel |
|---|---|---|
| Domínio (puro) | `packages/intelligence/src/agent-management.mjs` | Valida comandos, normaliza entrada, traduz erro de banco em erro de domínio. Não fala com o Supabase. |
| Acesso | `apps/emyleads/src/web/agentsProvider.js` | As chamadas ao Supabase, no mesmo formato do `intelligenceProvider`. |
| Banco | `20260905120000_…sql` | `public.nucleo_agent_set_default(uuid)`. |

### Operações

`agents.listar` · `agents.ler` · `agents.criar` · `agents.editar` ·
`agents.definirAtivo` · `agents.tornarPadrao` · `agents.listarSkills` ·
`agents.definirSkill`.

Não existe *delete*. Desativar basta nesta fase, e apagar um agente com
conversas, campanhas e contexto amarrados é decisão com consequências próprias.

### Três regras que a camada não afrouxa

1. **Agente novo nasce comum.** `isDefault` nunca é escolhido por quem cria —
   `buildCreateAgentCommand` força `false` mesmo que o chamador mande `true`.
   Promover é ato explícito e separado.
2. **`active` e `isDefault` são ortogonais.** Desativar o padrão **não** promove
   ninguém; o runtime recusa (FASE D) até que uma pessoa decida. A tela deve
   avisar — o backend não escolhe por ela.
3. **`soulMarkdown` é persona, não permissão.** O comando de criação não tem, e
   não pode ganhar, campo de ferramenta ou permissão. Skills continuam entidade
   separada em `assistant_profile_skills`.

### Erros de domínio

`23505` cru não diz nada a uma tela. As duas unicidades que um gestor consegue
violar significam coisas diferentes e pedem ações diferentes:

| Código | Quando | O que a UI deve oferecer |
|---|---|---|
| `AGENT_SLUG_ALREADY_EXISTS` | colisão em `(organization_id, slug)` | renomear o agente |
| `AGENT_DEFAULT_ALREADY_EXISTS` | colisão no índice parcial de padrão | trocar o padrão, em vez de criar outro |
| `AGENT_AUDIENCE_IMMUTABLE` | patch tentando mudar `audience` | criar outro agente |
| `AGENT_ORGANIZATION_IMMUTABLE` | patch tentando mudar `organization_id` | — |
| `AGENT_FORBIDDEN` | RLS recusou, ou `can_manage_org` falhou | — |
| `AGENT_NOT_FOUND` / `AGENT_INVALID` | — | — |

Erro que o domínio **não** reconhece não é traduzido: `mapDatabaseError`
devolve `null` e o original sobe. Traduzir tudo esconderia falha de infra.

### Por que trocar o padrão é RPC, e não dois updates

Duas razões independentes, e as duas estão provadas em
`scripts/sql/prova-gestao-de-agentes.sql`:

- **Atomicidade.** Promover B exige rebaixar A. Em duas chamadas do navegador
  existe uma janela real entre elas; se a segunda não acontecer — aba fechada,
  rede caindo, token expirando — a organização fica **sem padrão** naquela
  audience, e sem padrão o resolvedor falha fechado: aquele público para de ser
  atendido por causa de uma promoção que ninguém terminou. O item `I.2` da
  prova **demonstra essa janela** em vez de argumentar sobre ela.
- **Ordem.** Promover antes de rebaixar viola o índice parcial e o banco
  recusa; isso empurraria o frontend a rebaixar primeiro, que é exatamente a
  ordem que abre a janela.

A função é `security definer`, verifica `can_manage_org`, usa `for update`
(duas abas promovendo ao mesmo tempo é cenário real), é idempotente
(`changed: false` quando o alvo já é o padrão, para um duplo clique não virar
organização sem padrão) e **não toca `active`** de nenhum dos lados.

### `audience` é imutável — a decisão pedida

A ETAPA 11A pediu para reportar antes de decidir. A recomendação é **não
permitir**, e a razão não é purismo: `audience` não é atributo de exibição.
Ela decide qual conhecimento o agente enxerga (`internal` vs `external`), quais
skills podem ser amarradas, se existe transferência humana, e qual índice
parcial de padrão ele disputa. Um agente de clientes com contexto, skills e
campanhas amarrados que virasse `internal` levaria tudo isso para um público
que nunca deveria ver. Trocar audiência é criar outro agente — é mais barato
dizer isso do que migrar as consequências.

### Dívida da FASE E que esta fase pagou

`assistantProfileToAgentDefinition` derivava `isDefault: true` quando a coluna
não vinha na linha. O próprio comentário do módulo avisava que isso "deixa de
ser defensável" quando a FASE E removesse a unique — e a FASE E foi aplicada em
05/09/2026. O fallback passou a **`false`**: uma linha sem `is_default` legível
não é promovida a padrão por omissão. É a leitura que falha fechado, e evita o
erro mais caro do modelo — um agente comum ser tratado como o padrão em
silêncio.

### Knowledge: o que existe hoje (auditado, não construído)

**Não existe relação Agent ↔ Knowledge.** As coleções pertencem à organização
(`knowledge_collections.organization_id`) e são escolhidas por **audience** em
`intelligence_payload`, mais o vínculo por campanha
(`campaign_knowledge_collections`). Nenhuma FK liga conhecimento a
`assistant_profiles`.

Consequência prática do multi-agent: **todos os agentes da mesma audience
enxergam o mesmo conhecimento**. Para o cenário de hoje isso é aceitável — a
segregação que importa (interno × externo) continua valendo. Quando dois
agentes de clientes precisarem de bases diferentes, a forma natural é uma
tabela `agent_knowledge_collections` espelhando
`campaign_knowledge_collections`. Nenhuma tabela foi criada nesta fase: o
requisito ainda não existe.

### O que a FASE F deliberadamente NÃO faz

- **Não cria Agent Router.** Continua existindo um padrão por audience e é ele
  quem responde. Escolher entre os N elegíveis por turno é a FASE G.
- **Não constrói a Central de Agents.** A tela nova é etapa posterior; a única
  mudança de UI até aqui foi a correção da FASE E (campanha amarrada ao agente
  padrão).
- **Não faz handoff automático.**
- **Não foi aplicada em produção.**

### Buraco conhecido — FECHADO na ETAPA 11B (ver adiante)

A policy `assistant_profiles_update` permite a um gestor atualizar **qualquer**
coluna, incluindo `is_default`. A RPC é o caminho **sancionado** de troca de
padrão, não o único tecnicamente possível: um cliente que fale direto com o
PostgREST ainda consegue fazer os dois updates soltos. Fechar isso exige
restrição por coluna ou gatilho que recuse alteração de `is_default` fora da
função — mudança de comportamento com risco próprio, que não cabe numa fase
que já está introduzindo escrita nova. Fica registrado para a FASE G.

### Provas

> Domínio: `test/agent-management.test.mjs`, 13 itens — agente nasce comum, o
> slug vem da regra canônica (não de uma terceira implementação), colisão vira
> erro de domínio, `organizationId`/`audience`/`isDefault` recusados no patch,
> RLS vira `FORBIDDEN`, erro desconhecido não é engolido, e persona não carrega
> permissão.
>
> Integração: `scripts/sql/prova-gestao-de-agentes.sql` em PostgreSQL 17.9
> descartável, **PASS em A–M**, com o elenco do enunciado (Emília/Closer/Agenda
> e Operações/QA): o resolvedor fala por Emília; a troca para Closer é um ato e
> o resolvedor acompanha; o padrão interno não é tocado; **Closer inativo com
> Agenda ativa faz o resolvedor RECUSAR, sem usar a Agenda**; desativar não
> promove; gestor de outra organização é recusado e o padrão daqui não muda; a
> troca é all-or-nothing; e a relação Agent ↔ Skills continua N:N de verdade.

### Hardening da fronteira de escrita (ETAPA 11B)

Migration `20260905160000_protege_campos_estruturais_dos_agentes.sql`,
**aplicada em produção em 05/09/2026** junto com a RPC. Ela fecha o buraco que a própria
FASE F havia registrado como conhecido, e o fecha mais fundo do que o registro
previa.

#### O problema, medido antes de corrigir

`assistant_profiles` tem RLS por organização, e ela funciona. Mas **RLS filtra
linhas, não colunas**: dentro das linhas que um gestor legitimamente
administra, ele podia escrever em qualquer coluna, porque `authenticated` tem
`INSERT`/`UPDATE` de tabela inteira (`authenticated=arwdDxtm`, conferido
read-only em produção — as migrations concedem `select, insert, update`, e o
Supabase concede `ALL` por cima).

As regras do domínio JS moram no navegador. Quem chama o PostgREST direto não
passa por elas. `scripts/sql/prova-fronteira-de-escrita.sql` mediu isso
rodando como `authenticated` — que é exatamente como o PostgREST executa — e
achou **quatro caminhos com efeito real**:

| Caminho | O que acontecia | Consequência |
|---|---|---|
| `update … set is_default = false` | 1 linha | A organização fica **sem padrão**, e sem padrão o resolvedor recusa tudo (FASE D). Um público inteiro para de ser atendido sem nada ter "quebrado". |
| `update … set audience = 'internal'` | 1 linha | Um agente de clientes, com contexto e campanhas amarrados, passa a ler conhecimento **interno**. |
| `update … set id = …` | 1 linha | A identidade referenciada por conversas, campanhas e skills muda por baixo. |
| `insert … is_default = true` | 1 linha | Um agente **nasce padrão** e passa a atender sem ninguém tê-lo promovido. |

Sete outros caminhos testados **já estavam fechados**, e ficam registrados para
não serem "corrigidos" de novo por engano: criar e editar agente de outra
organização (RLS), mover agente para outra organização (o `WITH CHECK` da
policy), amarrar skill a agente de outra organização (a **FK composta**
`(profile_id, organization_id) → assistant_profiles(id, organization_id)`, que
é estrutura e não policy), declarar organização alheia no vínculo (RLS), e
`DELETE` (não existe policy de DELETE, então RLS não casa linha nenhuma).

#### Três cuidados metodológicos que a prova precisou aprender

A primeira versão desta prova estava errada de três formas, e cada uma delas
teria produzido um relatório de segurança falso. Ficam escritas porque são
fáceis de repetir:

1. **"Executou" não é "conseguiu".** `update … where organization_id = <org
   alheia>` não levanta erro: a RLS não casa linha nenhuma e o comando termina
   com sucesso tendo mudado nada. A primeira versão contou isso como bypass —
   alarme falso. Agora cada tentativa mede `row_count` e o veredito é sobre
   **efeito**.
2. **Testes contaminavam uns aos outros.** Trocar o `id` do agente num item
   fez um item posterior falhar por FK, e a falha *parecia* proteção. Agora
   cada tentativa roda isolada e é sempre desfeita.
3. **O baseline de GRANTs tem de ser o de produção.** O harness reproduz só o
   que as migrations concedem. Pior: quando a replicação de GRANTs morava
   dentro da prova, a rodada `depois` reabria — dentro da própria transação —
   o que a migration acabara de fechar, e o veredito media o teste em vez do
   produto. Por isso o baseline virou arquivo à parte
   (`scripts/sql/grants-de-producao-dos-agentes.sql`), aplicado uma vez.

#### A escolha: privilégio de coluna, não gatilho

Um gatilho `before update` comparando `old`/`new` também funcionaria. Privilégio
de coluna ganhou por três razões: é declarativo e auditável por catálogo (dá
para perguntar ao banco quem escreve onde, sem ler corpo de função); o
PostgREST devolve `permission denied for column` sem precisar de tradução e
antes de qualquer efeito; e gatilho é código de segurança rodando em todo
UPDATE — mais uma coisa para manter correta, inclusive quando alguém precisar
de um update legítimo e for tentado a abrir exceção nele.

Resultado no catálogo, depois da migration:

```
INSERT: active, audience, brand_config, created_by, display_name,
        organization_id, process_config, role, slug, soul_markdown,
        template_id, tone, updated_by          (sem id, sem is_default)
UPDATE: active, brand_config, display_name, process_config, role, slug,
        soul_markdown, template_id, tone, updated_by
                                               (sem id, organization_id,
                                                audience, is_default)
tabela: REFERENCES, SELECT, TRIGGER            (sem INSERT/UPDATE/DELETE/TRUNCATE)
```

`audience` e `organization_id` são **inseríveis mas não atualizáveis** — é
assim que "definido na criação, imutável depois" deixa de ser promessa do
JavaScript e vira regra do banco. E `is_default` fora do INSERT é o que faz
"agente nasce comum" ser garantia do **banco**: a coluna tem `default false`.

`TRUNCATE` saiu explicitamente porque é o único caminho que **não passa por
RLS** — ele apagaria a tabela inteira apesar de todas as policies. Na prova
`antes`, ele só não teve efeito porque o `cascade` esbarrou noutra tabela; foi
sorte de topologia, não proteção.

#### A RPC continua funcionando, e vira o único caminho

`nucleo_agent_set_default` é `security definer` e pertence ao owner, então não
passa pelo privilégio de `authenticated`. Depois desta migration ela é o
**único** caminho de escrita em `is_default`. Auditada: `security definer` ✓,
`search_path=""` explícito ✓, `can_manage_org` dentro da função ✓, deriva a
organização do próprio agente em vez de confiar no cliente ✓, `EXECUTE PUBLIC`
removido e concedido só a `authenticated` ✓.

A migration se **recusa a rodar** se essa RPC não existir ou não for
`security definer` — fechar `is_default` sem ela deixaria o produto sem nenhum
caminho para trocar o padrão, que é hardening virando indisponibilidade.

#### O que continua aberto, de propósito

`active` continua editável, **inclusive no agente padrão**. Desativar o padrão
é decisão legítima de quem administra; o runtime recusa (FASE D) e nada é
promovido no lugar. Confundir `active` com `is_default` aqui reintroduziria,
em nome da segurança, a ambiguidade que a FASE C separou.

#### Provas

> Estáticas: `test/agent-write-boundary.test.mjs`, 9 itens.
>
> Comportamental: `scripts/sql/prova-fronteira-de-escrita.sql` rodando como
> `authenticated` em PostgreSQL 17.9 descartável, **antes e depois** da
> migration, com o baseline de GRANTs de produção. Antes: 4 caminhos
> estruturais com efeito real, 6 escritas legítimas funcionando. Depois:
> **0 de 11 caminhos estruturais com efeito**, e as mesmas **6 escritas
> legítimas continuam funcionando**. As provas das FASES E e F foram
> re-executadas depois do hardening e seguem verdes — a troca de padrão pela
> RPC, a recusa com padrão inativo e o N:N de skills não regrediram.

## Central de Inteligência — Agents (UI), não aplicada

Primeira entrega de tela realmente multi-agent, escrita em 05/09/2026. **Nada
foi implantado**: o código está versionado e o build local passa, mas não houve
deploy.

| Peça | Arquivo |
|---|---|
| Tela | `apps/emyleads/src/page/telas/Agents.jsx` |
| Lógica pura | `apps/emyleads/src/domain/agents.js` |
| Ligação | aba `agents` em `Inteligencia.jsx`, provider em `web/operations.js` |

### Onde ela entra

A Central de Inteligência já existia com seis abas. **Agents** entra como
primeira e como aba inicial. As demais ficam intactas — e isso é decisão, não
omissão: rollout, marca e política de sessão continuam em **Assistentes**,
não têm operação equivalente na FASE F, e migrá-las agora quebraria o piloto de
atendimento. A tela de Agents diz onde elas estão, em vez de deixar o usuário
procurar.

### O que a tela garante, e o que trava isso

| Invariável | Como aparece | Teste |
|---|---|---|
| `audience` imutável | campo desabilitado no detalhe, com o motivo; nunca entra no patch | `G` |
| agente nasce comum | a criação não oferece "tornar padrão" e diz isso em texto | `D` |
| troca de padrão é atômica | uma única chamada a `agents.tornarPadrao` | `J` |
| desligar padrão não promove ninguém | confirmação explica que a audiência fica sem atendimento | `I` |
| sem estado otimista | a lista vem sempre de `recarregar`; erro deixa a tela como estava | `N` |
| nada de `.find(audience)` | trabalha com a coleção inteira, agrupada | teste dedicado |

O padrão vem primeiro dentro de cada audiência. Não é estética: é o único
agente daquela audiência que responde hoje, e enterrá-lo numa lista alfabética
esconderia a informação mais importante da tela.

### Um defeito que o teste encontrou

O rascunho do detalhe era semeado dentro de um `useEffect`, o que fazia o painel
renderizar vazio no primeiro passe — uma piscada na tela real, e nada em render
estático. Passou a nascer preenchido no próprio estado. Registrado porque a
suíte do app não clica em nada, e ainda assim pegou.

### O que NÃO foi feito

Agent Router (continua sendo a fase seguinte), handoff automático, remoção de
legado, métricas, editor visual de Soul, e qualquer deploy.

## ETAPA 12B.1 — a Central fala a língua de quem contrata

Redesenho de UX sobre a mesma FASE G, escrito em 05/09/2026, **não aplicado em
produção**. Nada de banco, RPC, RLS, grant ou contrato da FASE F mudou — só
como a tela nomeia e organiza o que já existia.

### Nomenclatura — termo interno → termo mostrado

| Interno (banco/domínio) | Mostrado ao usuário | Por quê |
|---|---|---|
| `is_default` | **Principal** | "Padrão" soa a configuração de sistema; "Principal" soa a papel de alguém na empresa — é ele quem responde primeiro. |
| `audience = 'customer'` | **Clientes** (e leads) | Direto, sem jargão. |
| `audience = 'internal'` | **Equipe** | Idem. |
| `soul_markdown` | **Personalidade e instruções** | O termo "Soul" não aparece em lugar nenhum do fluxo. |
| Skills (catálogo, criar/publicar) | **Habilidades** | Nome de produto para o que hoje é "Skills". |
| Skills vinculadas a UM agente | **O que sabe fazer** | Nome diferente do catálogo de propósito — são perguntas diferentes: "o que existe" vs "o que ESTE agente usa". |
| `slug` | **Identificador técnico** (em Configurações avançadas) | Fica escondido, não desaparece — quem precisa, encontra. |
| Aba "Assistentes" (rollout, marca, sessão) | **Liberação e marca** | Nome descreve o que a aba de fato configura; continua existindo porque a FASE F não tem operação equivalente ainda. |
| Aba "Skills" (autoria) | **Habilidades** | Mesmo componente, rótulo renomeado. |

### Jornada de criação — cinco telas, uma decisão cada

1. **Intenção** — "O que você quer que esse agente faça?" Presets: Atendimento,
   Vendas, Qualificação, Agenda, Suporte, Cobrança, Equipe interna, **Criar do
   zero**. Cada preset é só UX — sugere `audience`, `role`, um tom e um
   `soulMarkdown` de partida, e pré-marca as habilidades do catálogo real que
   batem com o preset (nunca sugere uma que a organização não publicou).
   Nenhum preset vira entidade nova no backend.
2. **Público** — "Com quem esse agente vai conversar?" Clientes e leads /
   Minha equipe. Sempre perguntado, mesmo quando o preset já sugeriu — o
   usuário confirma ou troca.
3. **Identidade** — nome, função, "como ele deve conversar?" (chips: Profissional,
   Consultivo, Acolhedor, Objetivo, Persuasivo, ou texto livre). O
   identificador técnico mora dentro de "Configurações avançadas", derivado
   do nome, editável só se alguém abrir.
4. **Personalidade e instruções** — o texto do preset, sempre editável.
5. **Habilidades** — "O que esse agente sabe fazer?", checklist pré-marcado.
   Botão final: **Concluir** (não "Criar agente" — esse nome já é do CTA que
   abre o assistente, evitando dois botões homônimos na mesma tela).

Ao concluir, a tela chama `agents.criar` com os campos reais (sem
`skillIds`), e só depois, com o **id do agente recém-criado**, chama
`agents.definirSkill` para cada habilidade marcada — melhor esforço
(`Promise.allSettled`): se uma vinculação falhar, o agente já existe e pode
ser ajustado depois em "O que sabe fazer", em vez de travar todo o assistente.

### Home de Agents

"**Seus agentes**" — "Crie agentes especializados para atender seus clientes
e ajudar sua equipe." CTA "Criar agente". Lista agrupada por Clientes/Equipe,
principal primeiro, cada cartão com avatar, nome, selos (Principal/Ativo ou
Inativo) e função. Nenhuma referência a "um assistente de clientes + um
assistente da equipe" — a lista mostra a coleção real, do tamanho que ela for.

### Detalhe do Agent

Cabeçalho com avatar maior, nome, selos, "Função · Atende: Clientes". Ações
"Tornar principal" (ou o selo "Agente principal desta audiência") e
Ativar/Desativar. Três abas: **Geral** (nome, função, tom, "quem ele atende"
somente leitura, Configurações avançadas fechada), **Personalidade**, **O que
sabe fazer**.

### Conhecimento × Habilidades

Um aviso de uma linha acima de cada aba, sem mexer no `Conhecimento.jsx`
legado: Conhecimento é o que os agentes podem **consultar**; Habilidades é o
que eles sabem **fazer**.

### Avatar — perfil, não formulário

Cada agente ganha um avatar de iniciais coloridas (`Iniciais` + `corDerivada`,
o mesmo componente e o mesmo algoritmo já usados para pessoas — `corDerivada`
foi exportada de `ui/perfil.js` para isso, sem duplicar o hash). Upload de
foto real fica registrado como **oportunidade futura**: exigiria bucket de
armazenamento e coluna nova em `assistant_profiles`, fora do escopo de um
redesenho de UX.

### O que ficou escondido, não removido

`slug`, os `id`s técnicos e a palavra "audience" saem do fluxo principal e vão
para "Configurações avançadas" ou desaparecem da tela — mas continuam
acessíveis a quem precisa. Nada de legado foi apagado: `Assistente.jsx`
(`/app/assistente`) e `SimulatorLegacy` seguem intocados; Campanhas, Rollout e
a autoria de Habilidades continuam funcionando como antes.

### Provas

> Domínio: `domain/agents.test.js`, 33 itens — inclui os presets (nenhum marca
> `isDefault`, "Criar do zero" não sugere nada, skills sugeridas restritas ao
> catálogo real) e o avatar (cor estável, mesmo algoritmo de pessoas).
>
> Estático: `Agents.test.jsx`, 30 itens — nenhuma palavra técnica
> (`audience`, `is_default`, `assistant_profile`) no que a tela renderiza.
>
> Interativo: `Agents.interactive.test.jsx`, 15 itens em jsdom com eventos
> reais — percorre as 5 telas do assistente com um preset real, confirma o
> payload de criação e que as habilidades são vinculadas ao id do agente
> recém-criado (não a um id antigo), e mantém as invariáveis da ETAPA 12B
> (uma chamada para trocar o principal, aviso antes de desativar, N:N de
> habilidades, mensagens amigáveis de erro, navegação mobile completa).

## FASE 13 (G) — Agent Router, primeira fatia: **aplicada em produção**

`supabase/migrations/20260905220000_fase_13_agent_router.sql`, escrita em
05/09/2026 e **aplicada em 06/09/2026** pelo SQL Editor, depois da prova A–L
passar em Postgres descartável. `private.intelligence_payload` saiu de
`7d026211…` para `417dda36…`; as outras seis funções observadas ficaram com
hash idêntico.

O hash aplicado difere do `75e64817…` que a prova previu **apenas por CRLF**:
o corpo em produção tem 235 CRs (um por linha, do editor no Windows), e
normalizado ele é byte a byte idêntico ao provado — `md5` do corpo normalizado
é `f5a6b72b2a01f96aab60e5d6b4e50319` dos dois lados. Quem conferir por hash
depois precisa normalizar antes de concluir qualquer coisa; a mesma coisa já
valia para `nucleo_intelligence_context_resolve` e `intelligence_context_preview`.

Nenhum dado se moveu: 3 perfis, 2 padrões, 3 ativos, 5 contextos ativos,
`intelligence_audit_log` ainda em 54, `updated_at` dos perfis ainda em 05/09
20:14 UTC. E ninguém trocou de agente no ato — as 5 conversas ativas já
estavam pinadas no próprio agente padrão do público delas (1 no Assistente
Major, 4 no Assistente interno), e o SDR tinha 0 conversas.

### A regra que a fatia instala

```
conversa em atendimento humano      -> recusa (como já era)
contexto ativo                      -> o agente PINADO na conversa
conversa nova + campanha customer   -> o agente DA CAMPANHA
nada disso                          -> o agente is_default (como já era)
```

Uma função redefinida, e só uma: `private.intelligence_payload`, por onde
passam v1, v2, v3 e o preview. É o que garante **uma** semântica de roteamento
e não uma por chamador.

### O achado que originou a fatia

A afinidade tinha campo e não tinha efeito.
`conversation_intelligence_contexts.assistant_profile_id` existe desde a FASE H
e é `not null`, mas o corpo da FASE D o sobrescrevia **a cada turno**:

```sql
set assistant_profile_id = selected_profile.id   -- e selected_profile era sempre o padrão
```

Ou seja: a chave da afinidade (`conversation_key_hash`) existia, a coluna
existia, e a conversa era devolvida ao padrão em todo turno. Aqui a seleção
passa a **ler** esse campo antes de decidir; a escrita continua idêntica (no
ramo pinado ela reescreve o mesmo id, que é um no-op). Nenhuma coluna nova,
nenhum backfill.

Segundo achado: `organization_campaigns.assistant_profile_id` (`not null`,
com FK composta) já vinculava campanha a agente desde a FASE H, e **esse
vínculo não participava da escolha**. A campanha só escolhia skill *dentro*
do agente padrão — o que permitia a oferta de um agente sair pela voz de
outro.

### O que a fatia deliberadamente não faz

- não cria coluna, tabela, índice ou tipo — é só `CREATE OR REPLACE`;
- não toca `resolve_v2` nem `resolve_v3`. O v3 não escolhe agente: ele lê
  `context_row.assistant_profile_id`, que é o mesmo campo que esta fatia passa
  a respeitar;
- não muda `schemaVersion` (`fase-h-1` aqui dentro, `fase-h-2`/`fase-h-3` na
  borda) nem qualquer chave de `runtimeContext.assistant`;
- não cria `targetAgentId`, `targetMode = 'agent'`, campo novo de payload ou
  ferramenta nova. **O worker (`whatsapp-mcp-hardened`) não muda uma linha** —
  ele já transporta tudo que o banco precisa;
- não roteia agente por keyword. Keywords continuam escolhendo campanha e
  skill;
- não renomeia `assistente` para `agente` em lugar nenhum;
- não transporta `soul_markdown` — isso é a fatia seguinte (13C).

### Recusar continua valendo mais que responder

Os três ramos recusam com a **mesma string pública de sempre**
(`assistant profile is inactive or unavailable`), e nenhum cai no seguinte:
pinado inativo recusa, agente de campanha inativo recusa, padrão inativo
recusa. É a regra da FASE D estendida aos ramos novos. Um cliente que estava
falando com um agente e volta depois de ele ser desligado ouve o silêncio de
sempre — ele não passa a ser atendido, sem aviso, por outra personalidade, com
outras skills e outro conhecimento.

### Duas consequências que precisam estar escritas

- **Trocar o agente padrão não move conversas já abertas.** Elas continuam com
  quem estavam; é a definição de afinidade. Quem quiser o contrário encerra o
  contexto, em vez de esperar que o roteador mude de ideia no meio da conversa.
- **Conversa nova que casa com campanha de agente inativo passa a recusar**,
  onde antes era atendida pelo padrão com a campanha de outro agente colada no
  contexto. Em produção isso não alcança ninguém hoje: a única campanha viva
  (`Piloto Atendimento Major`) aponta para o próprio padrão de clientes.

### Desempate determinista na campanha

`campaign.id` entrou como **última** chave do `order by` da descoberta de
campanha, depois de `campaign.created_at`. Não muda precedência — as chaves
anteriores decidem antes e continuam idênticas —, só troca "empate resolvido
pelo plano de execução" por "empate resolvido sempre igual" quando duas
campanhas nascem no mesmo instante.

### `limit 1` e escopo

Nenhuma das três seleções de agente usa `limit 1`. As duas por id entram por
`id + organization_id + audience`; a do padrão depende explicitamente de
`is_default`, protegida pelo índice parcial `assistant_profiles_one_default_idx`
da FASE C. Os `limit 1` que restam no corpo escolhem contexto, campanha e
skill — nunca agente.

`audience` entra nas buscas por id porque a FK composta garante **organização**,
não público: um contexto ou campanha apontando para agente de outro público é
dado corrompido, e vira recusa, não troca silenciosa.

### Provas

> Estático: `test/agent-router-migration.test.mjs`, 15 itens — precedência
> declarada na ordem certa e encadeada por `elsif`; contexto lido antes da
> seleção; `handed_off` antes de tudo; nenhuma seleção de agente com `limit 1`;
> exatamente 3 consultas a `assistant_profiles` e 6 recusas com a string de
> hoje; nenhuma mensagem pública nova; a descoberta de campanha idêntica à da
> FASE D a menos do desempate; **retorno e persistência byte a byte** iguais aos
> da FASE D; nenhum vocabulário novo de roteamento; nenhum DDL.
>
> Comportamental: `scripts/sql/prova-agent-router.sql` (itens A–L) —
> **executada em 06/09/2026, PASS em todos**, PostgreSQL 17.9 descartável na
> VPS, com as 56 migrations aplicadas do zero, zero fixtures depois do
> `ROLLBACK` e produção intocada. Banco de controle sem a FASE 13 no mesmo
> cluster confirma que **só `intelligence_payload` mudou** (`7d026211…` →
> `75e64817…`); v1, v2, v3, `customer_assistant_access`, o preview e
> `provision_intelligence` saíram com hash idêntico, e assinatura,
> `SECURITY DEFINER`, `search_path` e ACL também. Detalhes em
> `scripts/sql/README-prova-agent-router.md`.

A própria migration também se confere: o pré-voo aborta se faltar coluna,
índice, FK ou a FASE D, e **recusa rodar** sobre um corpo que já roteie; as
asserções finais leem o `prosrc` aplicado (não a mensagem de sucesso) e
conferem inclusive que ACL, dono, `SECURITY DEFINER` e `search_path` não
mudaram no replace.

### Rollout — concluído

1. ~~rodar a prova A–L num PostgreSQL descartável~~ — 06/09/2026, A–L PASS;
2. ~~aplicar pelo SQL Editor~~ — 06/09/2026, transação única, sem `db push`;
3. ~~conferir por introspecção do catálogo~~ — feito: só `intelligence_payload`
   mudou, corpo idêntico ao provado depois de normalizar CRLF, dados intocados;
4. ~~registrar em `docs/STATUS.md`~~ — feito.

O que **não** foi observado: tráfego real. Não houve turno de conversa depois
da aplicação, então o roteador ainda não rodou sob carga — como nas FASES D, E
e F. O primeiro sinal a procurar é uma conversa nova casando com campanha de
agente não-padrão.

## FASE 13C — o Soul do agente no prompt: **escrita e provada, não aplicada**

`supabase/migrations/20260906010000_fase_13c_soul_do_agente_no_prompt.sql`,
escrita em 06/09/2026 e provada no mesmo dia (A–J, PASS em todos). Aguarda
aplicação manual pelo SQL Editor.

A FASE B criou `assistant_profiles.soul_markdown` e a tela já escreve nele, mas
o texto nunca saiu da tabela: nenhum resolvedor o lia. A persona existia no
cadastro e não existia na conversa. Esta fatia transporta o Soul do **mesmo
agente que o Router da 13B escolheu** até o payload, e nada além disso.

### Três decisões, que são o conteúdo da fase

1. **O Soul sai de `selected_profile`, e de nenhum outro lugar.** É a mesma
   linha que os três ramos da 13B (afinidade / campanha / padrão) fixaram. Não
   existe consulta separada a `assistant_profiles` para buscar persona — seria
   por ali que a persona de um agente vazaria para a conversa de outro. Agente
   sem soul manda `null`; **nunca** o soul do padrão.
2. **Soul é persona, nunca permissão.** Entra no payload como texto ao lado de
   `tom` e `marca`, e não toca `skillsPermitidos`, `colecoesPermitidas`,
   `politicas` nem nada que autorize. No prompt ele fica **abaixo das políticas
   e acima da skill**: o que está acima decide o que pode, a persona decide como
   soa, o que está abaixo decide o que fazer no turno. Isso é ordem de prompt,
   não precedência de segurança.
3. **O hash viaja junto.** `soulHash` (sha256 hex) existe para o runtime
   registrar **qual** persona entrou no turno sem escrever o conteúdo dela em
   log nenhum. Persona é texto livre escrito por gente da organização.

### O que a fatia deliberadamente não faz

- não muda `schemaVersion` — o objeto `assistente` ganha duas chaves, e
  `resolve_v2` e `resolve_v3` copiam o objeto **inteiro**, então as chaves
  chegam ao `runtimeContext` sem que nenhuma das duas seja tocada;
- não muda `allowedTools`, não cria ferramenta, não mexe em permissão, policy,
  grant ou RLS;
- não altera a precedência do Router da 13B — seleção de agente, `campanha`,
  `skillAtivo`, `skillsPermitidos`, `colecoesPermitidas`, `politicas` e
  persistência continuam byte a byte iguais;
- não usa `source_data`, não cria `targetAgentId` nem `targetMode = 'agent'`;
- não renomeia `assistente` para `agente`;
- não cria tela — criação, edição e leitura de `soul_markdown` já existem;
- não inicia handoff entre agentes (FASE 14).

### O teto de 8000, e por que ele existe em três lugares

`soul_markdown` nasceu `text` sem limite, enquanto `tone` tem 500 no banco e 500
espelhado em JavaScript. Persona sem teto entra em todo prompt de todo turno
daquele agente: custo, risco de estourar contexto e, no limite, empurrar a skill
para fora da janela. O teto passa a ser 8000 — entre `tone` (500) e as
instruções de skill (20000, teto que o runtime já aplica). A constraint
`assistant_profiles_soul_markdown_tamanho` impede gravar; o payload descarta
acima do teto **sem derrubar o turno** (persona não autoriza nada: recusar o
atendimento por causa dela trocaria um problema cosmético por um cliente sem
resposta); e o `MAX_SOUL` do runtime protege contra linhas antigas, gravadas
antes da constraint.

### Aqui o runtime muda — diferente da 13B

Em `whatsapp-mcp-hardened` (branch `hardening`): `intelligence.py` ganha o helper
`_soul` e o bloco `<agent_soul_trusted>`; `worker.py` registra `soul_hash[:12]` e
`soul_rejected`, nunca o conteúdo. Formato inválido **levanta** (violação de
contrato, como já acontece com skill e coleções); tamanho ou hash que não confere
**descarta** a persona e registra o motivo.

A ordem de rollout é indiferente: o runtime novo aceita payload sem `soul`, e o
antigo ignora chaves que não conhece. Não há janela quebrada entre aplicar a
migration e publicar o runtime.

### Provas

> Estático: `test/agent-soul-migration.test.mjs` — 12 itens, e o central é o B:
> o corpo tem de ser o corpo aplicado da 13B mais exatamente três acréscimos
> conhecidos; qualquer outra diferença reprova, porque seria a 13C mudando o
> Router enquanto ninguém olhava. Com os da 13B, **27 verdes**.
>
> Prompt: `whatsapp-assistant/test_intelligence.py` — **364 verdes**, incluindo
> `test_persona_de_um_agente_nao_aparece_na_conversa_de_outro`.
>
> Comportamental: `scripts/sql/prova-soul-do-agente.sql` (A–J) — **executada em
> 06/09/2026, PASS em todos**, PostgreSQL 17.9 descartável na VPS, com as 57
> migrations aplicadas do zero, zero fixtures depois do `ROLLBACK` e produção
> intocada. Banco de controle sem a 13C no mesmo cluster confirma que **só
> `intelligence_payload` mudou** (`75e64817…` → `fa473433…`). Detalhes em
> `scripts/sql/README-prova-soul-do-agente.md`.

A migration também se confere: o pré-voo aborta se faltar a 13B, e as asserções
finais leem o `prosrc` aplicado — inclusive que continuam existindo **exatamente
três** consultas a `assistant_profiles` (uma quarta seria busca de persona por
fora do agente escolhido), as seis recusas da 13B e o `SECURITY DEFINER` com
`search_path` vazio.

### Rollout — pendente

1. ~~rodar a prova A–J num PostgreSQL descartável~~ — 06/09/2026, A–J PASS;
2. aplicar pelo SQL Editor, em transação única, sem `db push`;
3. conferir por introspecção: `md5(replace(prosrc, chr(13), ''))` tem de dar
   `4ed9516507bcf8322f14e313fa08a94e` (o `pg_get_functiondef` provado é
   `fa473433b5a5f6e3b440383fcffce4e0`, mas divergirá por CRLF);
4. publicar o runtime na VPS;
5. registrar o resultado em `docs/STATUS.md`.

Enquanto `soul_markdown` estiver NULL em 100% dos perfis, a fatia não produz
efeito observável: ela só aparece quando alguém escrever uma persona pelo portal.

## FASE 14A — Contrato de handoff entre agentes

Memorando de 06/09/2026, conferido contra `nucleo_customer_handoff_request`
(20260826150000, linhas 503–600), a sessão H3 e os resolvedores v2/v3.

- **Entrada MCP:** `agente_destino_slug`, `motivo`, `resumo` opcional (até 1000
  caracteres). Motivos fechados: `commercial_intent`, `specialist_required`,
  `scope_mismatch`. Organização vem de `private.robot_organization()`;
  hash da conversa e telefone vêm do runtime, nunca do modelo. Slug é identidade
  técnica, única na organização; a RPC resolve e valida antes de usar o UUID.
  Conhecer um slug não concede acesso a outro público ou organização.
- **Troca:** fixa o destino, zera `active_skill_id`, incrementa o contador e fecha
  a sessão de skill ativa como `handed_off`, incrementando sua revisão. O contexto
  permanece `active`. No próximo turno, v3 descarta a sessão fechada e resolve
  a skill pelos vínculos do destino. A linha de sessão é reutilizada pelo upsert
  existente; `handed_off` não é um histórico permanente (a auditoria é).
- **Sessão do modelo:** após confirmação técnica do MCP, o worker descarta
  a sessão local para não retomar a persona anterior mesmo se ambos usarem a mesma
  skill/hash. Não aciona o árbitro humano nem interrompe turnos seguintes.
- **Resumo:** validado, mas não persistido, devolvido ou auditado; transportar
  contexto livre ao destino pertence à FASE 15. Não incluir dados desnecessários.
- **Teto:** três transferências bem-sucedidas por contexto de conversa, inclusive
  A→B→A; a quarta recusa. Contador `agent_handoff_count integer not null default 0`,
  atualizado sob `FOR UPDATE`. Falhas não contam; poda da auditoria não altera o
  teto. Um contexto novo começa em zero; a RPC não reabre contextos fechados.
- **Auditoria:** `intelligence_audit_log`, `entity_type=conversation`,
  `action=agent_handoff`, slugs de origem/destino, motivo e número do salto.
  O MCP registra os mesmos campos somente após sucesso; o worker produz
  `conversation.agent_handoff`. Sem resumo, telefone, argumentos, persona ou
  conteúdo do cliente, inclusive nos detalhes de erro desta ferramenta.

Recusas SQL públicas, pela ordem abaixo (todas levantam exceção e não escrevem):

| Condição | String pública |
|---|---|
| Credencial ausente/inativa | `active robot credential required` |
| Contexto ausente, fechado, de outro público/canal/organização | `customer intelligence context required` |
| Já entregue a pessoa | `conversation already handed off to human` |
| Slug inexistente ou de outra organização | `target agent unavailable` |
| Público diferente | `target agent audience mismatch` |
| Destino inativo | `target agent inactive` |
| Destino igual ao fixo atual | `target agent is current agent` |
| Três saltos já usados | `agent handoff limit reached; use human handoff` |
| Motivo nulo ou fora da lista | `invalid agent handoff reason` |
| Telefone normalizado fora de 10–15 dígitos | `valid customer phone required` |
| Resumo maior que 1000 caracteres | `agent handoff summary too long` |

### Dependências encontradas na leitura da 14C

A capacidade é independente de `conversation.handoff`. Além dos quatro pontos
previstos, o catálogo exige `src/tools.mjs` e o enum de `skill.schema.json`.
**v2 também precisa da string:** v3 chama v2 antes de reconstruir a skill por
estágio; v2 valida o `allowedTools` global. Alterar só v3 quebraria a Recepção
publicada. A migration 14C confere o hash normalizado anterior de cada função e
redefine as duas com apenas a nova string; testes comparam os corpos integralmente.
`private.intelligence_payload`, schemaVersion e chaves do payload permanecem iguais.

Com vínculos diferentes, `skillsPermitidos` muda legitimamente para os do destino.
A prova cobre esse isolamento e, separadamente, compara o payload inteiro com
vínculos equivalentes: só agente e revisão da sessão mudam. Não se deve exigir
que a lista de skills do agente anterior sobreviva ao handoff.

Recepção declara a capacidade nos estágios acolher, entender e encaminhar;
Vendas nos estágios descobrir, consultar e avançar. A regra existente já ativa
Vendas para “quero fechar plano”, portanto Recepção sozinha não cobre o caso.
As instruções propõem `sdr` como destino comercial, condicionado à conferência
do slug real antes da publicação. O próprio SDR continua atendendo sem transferir
para si. Pedido de pessoa, tema sensível e limite atingido seguem para humano.
