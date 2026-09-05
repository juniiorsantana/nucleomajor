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
| **F** | API/UI: criar agente, listar por audience, escolher agente em campanha e no Simulador, revisar a semântica de `salvarSkill` | 🟡 **Backend pronto**, não aplicado — `20260905120000_trocar_o_agente_padrao_e_um_ato_so.sql`. UI ainda não |
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

## FASE F — backend preparado, não aplicado

Migration `20260905120000_trocar_o_agente_padrao_e_um_ato_so.sql`, escrita em
05/09/2026, **não aplicada em produção**. A FASE E liberou o modelo; esta fase
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

Migration `20260905160000_protege_campos_estruturais_dos_agentes.sql`, escrita
em 05/09/2026, **não aplicada em produção**. Ela fecha o buraco que a própria
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
