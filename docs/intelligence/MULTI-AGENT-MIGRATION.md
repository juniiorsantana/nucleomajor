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
| **D** | Trocar os resolvers legados (itens 1-4 e 7 da tabela acima) para buscar o agente **padrão** em vez de assumir unicidade. Nenhum comportamento muda enquanto houver um agente só — é justamente por isso que essa fase é segura | ✅ **Validada comportamentalmente**, não aplicada em produção — `20260904230000_resolvers_usam_agente_padrao.sql` |
| **E** | Remover `unique (organization_id, audience)`. Só depois de D, e com o `pre-condição` da FASE C ativa | Pendente |
| **F** | API/UI: criar agente, listar por audience, escolher agente em campanha e no Simulador, revisar a semântica de `salvarSkill` | Pendente |
| **G** | Agent Router: escolher entre os N elegíveis por turno (hoje inexistente — o mais próximo é a unicidade de banco). Aqui `IntelligenceResolution.assistant` vira `agent` | Pendente |

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

## FASE D — código preparado

`20260904230000_resolvers_usam_agente_padrao.sql`, escrita em 04/09/2026 a
partir da definição **viva** em produção das três funções (`pg_get_functiondef`
na hora), **não aplicada**.

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
