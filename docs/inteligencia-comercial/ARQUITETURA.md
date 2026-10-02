# Camada de inteligência comercial: a arquitetura

Objetivo: sair de uma IA que **lê** conversas para um sistema que **mede,
compara e recomenda**. Este documento descreve a infraestrutura preparada em
02/10/2026 (migration `20261003100000`, patch `runtime-camada-de-inteligencia`).
Os critérios, pesos e o JSON final (o **Analysis Schema v1**) são a próxima
etapa, definida com o dono.

## O fluxo

```
BANCO    private.fatos_da_conversa      fatos objetivos, sem IA
            │
JEV      conversation_insight_runs       classificação estruturada
         + conversation_insight_answers   (pergunta → resposta → probabilidade)
            │
REGRAS   analysis_schemas (versionado)   dimensões, critérios, pesos, regras
         private.pontuar                  notas 0-100 calculadas pelo nosso código
            │
CLAUDE   o botão "Analisar conversa"     recebe fatos + classificação + notas
                                          + playbook, escreve diagnóstico e
                                          evidência com message_id
            │
FRONT    (próxima etapa)                 nota, gargalo, próxima ação, mensagem
```

Quando cada camada roda:

| Momento | Fatos | Classificação | Notas | Texto |
|---|---|---|---|---|
| Leitura automática (coordenador, toda conversa parada) | gatilho no insert da leitura | Jev | gatilho, pelo esquema em vigor | — |
| Botão "Analisar conversa" | no pedido | a leitura em vigor, congelada | no pedido | Claude |

## O que já existia e foi reaproveitado

- **Classificação estruturada:** as perguntas do Jev (`jev_framework.py`) em
  grupos `lead`, `atendimento`, `sinais`, `desfecho` e `playbook`, com
  resposta fechada e probabilidade. O resumo fica em
  `conversation_insight_runs.summary` (`{chave: {a, p}}`) e cada resposta em
  `conversation_insight_answers`, com a distribuição inteira.
- **Critérios por empresa:** os `criterios` do playbook já viram perguntas
  `pb_<chave>` do Jev.
- **Autoria das mensagens:** `author_kind` (contato, ia, humano, bot) e
  `author_id` (o agente ou a pessoa da equipe).
- **Versões:** `framework_version`, `playbook_version` e o agente de cada
  leitura.
- **CRM:** `lead_at`, negócios com `status` e `closed_at`, histórico de
  etapas, tarefas e agenda com contato.

## O que foi acrescentado

### Fatos (`private.fatos_da_conversa`, versão 1)

| Chave | O que é |
|---|---|
| `messages.{total,contact,ai,team,bot,contactAudio}` | quantas mensagens, de quem |
| `firstMessageAt`, `lastMessageAt`, `startedBy` | começo, fim, quem começou |
| `lastSpeaker`, `hoursSinceLastMessage` | quem falou por último, há quanto tempo |
| `waitingReply`, `hoursWaiting` | o contato espera resposta, há quantas horas |
| `firstResponseSeconds` | primeira resposta da empresa |
| `responses.{count,medianSeconds,maxSeconds}` | tempos de resposta por turno |
| `followUps` | retomadas da empresa depois de 24 h sem resposta |
| `handoff.{aiToTeam,teamToAi,firstTeamAt}` | passagens IA ↔ equipe |
| `owner`, `attendantId`, `teamAuthors` | dono, atendente, quem da equipe escreveu |
| `contactId`, `isLead` | contato do CRM, se é lead |
| `deal.{id,status,stage,stagePosition,value,createdAt,closedAt}` | o negócio |
| `tasks.{open,overdue}`, `meetings.{scheduled,past,next}` | tarefas e agenda |

Regras da v1: turno do contato começa na 1ª mensagem dele e termina na 1ª
resposta da IA ou da equipe (mensagem de bot não é resposta); tempos corridos,
sem horário comercial; no máximo as 2.000 mensagens mais recentes. Mudar uma
regra é subir `version`.

### Esquema versionado (`analysis_schemas`)

Padrão da plataforma (`organization_id` nulo) ou da empresa, que vale no
lugar do padrão. Um publicado por vez; versão publicada não se edita. Nasce
**vazio**: sem esquema publicado, as notas ficam nulas e nada mais muda.

O contrato que o motor entende está no comentário da migration (seção 3).
Resumo:

```json
{"scores": {
  "lead":        {"dimensions": [{"key": "interesse", "weight": 2, "criteria": [...]}]},
  "atendimento": {"dimensions": [{"key": "agilidade", "criteria": [
     {"key": "primeira_resposta_rapida", "weight": 1,
      "when": {"source": "fact", "path": "firstResponseSeconds", "op": "lte", "value": 600}},
     {"key": "propos_passo",
      "when": {"source": "classification", "path": "propos_proximo_passo", "op": "eq", "value": "sim", "minConfidence": 0.7}}
  ]}]},
  "playbook": {"dimensions": [{"key": "criterios_da_empresa", "fromPlaybook": true}]}
}}
```

- Operadores: `eq`, `neq`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`, `true`,
  `false`, `exists`.
- Sem dado (ou confiança abaixo de `minConfidence`): o critério sai da conta,
  ou conta como erro com `"unknownAs": "missed"`.
- Nota da dimensão = pesos atendidos ÷ pesos avaliados × 100. Nota da família
  = média das dimensões pelo peso.
- `fromPlaybook: true` inclui sozinho todos os critérios `pb_*` da empresa.
- As famílias `lead` e `atendimento` também vão para `lead_score` e
  `service_score`, para somar e comparar.

### Onde fica gravado

| Tabela | Colunas novas |
|---|---|
| `conversation_insight_runs` | `facts`, `facts_version`, `scores`, `schema_version`, `lead_score`, `service_score` |
| `conversation_analyses` | as mesmas, mais `classification` (a leitura usada, congelada), `reading_id`, `playbook_version` |
| `conversation_intelligence` (visão) | uma linha por conversa, com fatos e notas em colunas tipadas, para relatório por agente, atendente e período |

As leituras em vigor ganharam fatos na própria migration. Análises não são
mais apagadas aos 120 dias: o rascunho vencido perde o texto, mas fatos e
notas ficam.

### Evidência por `message_id`

O pedido leva o `id` de cada mensagem. O analista numera as mensagens no
prompt, o Claude cita os números e o runtime troca pelo `message_id` real
(`porque[].messageIds`, até 3, só de mensagens que ele recebeu). O resultado
ganha `formatVersion: 2`.

## Segurança e compatibilidade

- Nenhuma RPC mudou de assinatura. A leitura do Jev ganha fatos por gatilho;
  `nucleo_insights_record` não foi tocada.
- Erro na camada de medida nunca impede a leitura nem o botão: o gatilho e o
  pedido engolem a falha e seguem sem fatos.
- Fatos e motor são `private` (sem acesso de fora). Esquemas: leitura para
  membros (padrão + o da própria empresa), escrita só por SQL por enquanto.
  A visão é `security_invoker`: vale a RLS das leituras.
- Prova: `scripts/sql/prova-camada-de-inteligencia.mjs`, 38 verificações.

## O que fica para a próxima etapa (com o dono)

1. **Analysis Schema v1:** as famílias (Lead Score, Atendimento Score), as
   dimensões, os critérios com fonte e regra, os pesos e o que fazer sem dado.
   Publicar = um `insert` em `analysis_schemas` (depois, uma tela no painel).
2. **O JSON do Claude:** o que aconteceu, principal gargalo, oportunidade,
   próxima melhor ação e mensagem recomendada. O prompt já recebe fatos e
   notas; falta trocar o formato de saída (`formatVersion: 3`).
3. **Fatos que podem entrar:** horário comercial nos tempos, tempo até o
   primeiro agendamento, mudanças de etapa durante a conversa (já existem em
   `deal_stage_history`).
4. **Tela:** nota, gargalo e próxima ação no topo da análise; evidência que
   rola até a mensagem; números por agente e atendente sobre
   `conversation_intelligence`.
5. **Retenção:** as leituras do Jev ainda são podadas aos 180 dias
   (`nucleo_insights_record`). Para comparar períodos longos, decidir se as
   notas viram um resumo diário antes da poda.
