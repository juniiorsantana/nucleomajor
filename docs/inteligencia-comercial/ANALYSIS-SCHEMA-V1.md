# Analysis Schema v1 — como foi implementado

Especificação: `ANALYSIS_SCHEMA_V1_NUCLEO_MAJOR.md` (02/10/2026, do dono).
Arquitetura de base: `ARQUITETURA.md` nesta pasta (camada de inteligência).

## Onde cada parte da especificação foi parar

| Especificação | Implementação |
|---|---|
| `atendimento.v1` (8 critérios, pesos 10/15/15/10/10/15/15/10) | linha publicada em `analysis_schemas` (padrão da plataforma), migration `20261004100000` |
| Estados e fatores (bom 1,0 · atencao 0,6 · ruim 0,2 · critico 0,0 · nao_avaliado fora) | `factors` por critério no esquema; o motor `private.pontuar` soma peso × fator e divide pelos pesos avaliados |
| Lead Score nulo | não há família `lead` no esquema; `lead_score` fica nulo e o portal não o mostra |
| Perguntas do Jev (`att_*`) | `jev_framework.py`, versão `major-v2`, respostas nas mesmas tabelas de sempre (`conversation_insight_runs/answers`) |
| Confiança | o corte que o portal já usa (`CONFIANCA_MINIMA = 0,6`) vira `minConfidence` no esquema: abaixo dele, o critério fica fora da conta |
| Fatos (responsividade, handoff, estilo) | `private.fatos_da_conversa` versão 2: `humanClock`, `communication`, `responseRules` |
| Playbook Base Major | `private.playbook_base_major()` (as 12 regras, sem política de preço) e `private.playbook_efetivo()`: o da empresa prevalece |
| Nota calculada pelo código | no banco: no gatilho da leitura do Jev e em `nucleo_analysis_classify` (análise do botão). O Claude nunca dá nota |
| Contrato do Analista (`analysis_report.v1`) | `analista.py`: resposta conferida campo a campo, evidência por `message_id` |
| Relatório agregado (`analysis.v1`) | `private.relatorio_da_analise`, devolvido em `report` pela consulta de andamento |
| Front (seção 11) | `RelatorioDaAnalise.jsx`: nota, resumo, gargalo, porquê, o que fazer agora, ações, mensagem sugerida, alertas e critérios |
| Histórico e versões | nada é recalculado; cada leitura e análise guarda versão de fatos, esquema e playbook; a análise congela a classificação usada |
| Observabilidade | a de antes, mais `analysis.classified` e `analysis.classify_failed` (sem conteúdo) |

## Como a nota é feita (exemplo)

```
descoberta bom (15 × 1,0) + coerência atencao (15 × 0,6) + próximo passo
ficou_em_aberto (15 × 0,0) + follow-up overdue (10 × 0,2)
= 26 pontos sobre 55 de peso avaliado → 47/100 até aqui
(responsividade, adaptação, qualificação e playbook: não avaliados, fora)
```

## Fluxo da análise pelo botão

```
pedido (banco): fatos v2 + leitura do Jev em vigor + nota + playbook efetivo
  ↓
VPS: o Jev responde as perguntas na hora → nucleo_analysis_classify
  → o banco recalcula a nota com os fatos congelados e devolve
  ↓
Claude: recebe a nota pronta e devolve só o diagnóstico (analysis_report.v1)
  ↓
portal: relatório analysis.v1 (nota + diagnóstico + alertas de regra)
```

A classificação na hora não estava escrita na especificação. Foi
acrescentada porque, sem ela, o botão usaria a última leitura automática, que
pode ser de antes das perguntas da v1 (e aí a nota sairia nula). O custo é uma
chamada do Jev por análise (cerca de US$ 0,0002). Se o Jev falhar, a análise
segue com a leitura e a nota do pedido.

## Adaptações e decisões

Confirmadas pelo dono em 02/10/2026: 1 (responsividade não avaliada na v1), 5 (follow-up vencido = ruim) e a classificação do Jev na hora da análise.

1. **Responsividade sempre `nao_avaliado` na v1.** O relógio humano é medido
   (do pedido de handoff até a primeira resposta de uma pessoa; IA e bot não
   contam), mas a especificação não traz a régua de tempo nem como converter
   tempo em estado. Os campos da régua (`first_human_response_minutes`,
   `active_conversation_response_minutes`, `business_hours`, `timezone`)
   existem, vazios, no Playbook Base Major. Falta definir as faixas para uma
   v2. Por isso toda nota da v1 sai "até aqui" (no máximo 90 de 100 de peso).
2. **Início do relógio humano:** só o handoff registrado
   (`customer_handoff_requests`). Isso cobre o pedido do lead e a promessa da
   IA de transferir quando o runtime a cumpre. Não cobre a IA dizer "vou
   transferir" sem registrar, nem a marca `needs_human` de fluxo (que não tem
   hora confiável).
3. **Objeções dentro de playbook:** a nota do critério vem só de
   `att_playbook_adherence`, cuja pergunta inclui o tratamento de objeções.
   `att_objection_handling` é respondida e aparece no detalhe com peso 0, para
   não inventar uma regra de combinação das duas.
4. **Próximo passo:** o Jev dá o estado de negócio e o código converte —
   avançou, aguardando o lead e desqualificado com motivo = bom; ainda em
   descoberta = não avaliado; ficou em aberto = crítico.
5. **Follow-up vencido = `ruim` (0,2).** A especificação diz "negativo" sem
   dizer o grau; `crítico` ficou reservado para o que ela chama de falha forte
   (próximo passo no limbo). Combinado e não vencido, ou sem follow-up = não
   avaliado; feito = bom. **Confirmado pelo dono em 02/10.**
6. **Descrições dos níveis.** As perguntas trazem o que é `bom`, `atencao`,
   `ruim` e `critico` em cada critério, escritas a partir dos sinais positivos
   e negativos da especificação. Precisam de calibração com conversas reais.
7. **O Jev não devolve texto.** Do contrato lógico do Jev (seção 7), saem dele
   o estado e a confiança. Motivo e evidência de cada critério vêm do
   diagnóstico do Analista (`why_this_score`), juntados no relatório.
   `missing_information`, `pending_for_next_step`, `violated_rules`,
   `responsible` e `due_at` não são campos do Jev. O prazo das ações vem do
   Analista (`what_to_do_now`).
8. **Alertas de regra:** `conversation_left_open` e `overdue_follow_up` saem do
   próprio critério, sem severidade (a especificação não a define). Os demais
   vêm do Analista, só dos 6 códigos da v1. Alerta nunca desconta.
9. **Rótulo da nota:** `NN/100 até aqui` quando parcial, ou `NN/100`. Não há
   faixas de qualidade ("bom", "regular") porque a especificação não as define.
10. **Ações:** "Criar follow-up" e "Criar tarefa" criam uma tarefa do CRM (não
    existe entidade de follow-up). "Agendar" cria um compromisso de 30 min (a
    mesma duração das sugestões anteriores). Os botões só preparam: abrem um
    formulário preenchido para revisar. Data sem hora fica sem hora até a
    pessoa escolher. "Usar mensagem sugerida" põe o texto na caixa de envio.
11. **Evidências:** "Ver evidência" fecha o relatório e rola a conversa até a
    mensagem, com destaque. Se ela não estiver entre as carregadas, a tela
    avisa.
12. **Sugestões antigas** (mover etapa, etiqueta) saíram do contrato novo, que
    tem os tipos de ação da v1. Análises antigas continuam abrindo na tela de
    antes.
13. **Empresa sem playbook** agora é lida pelo Base Major, também na leitura
    automática do Jev. Antes, ela não tinha régua nenhuma.

## Testes (seção 17)

| Cenários | Onde |
|---|---|
| 1, 3, 4 (relógio humano, sem régua, sem SLA) | prova PGlite `prova-atendimento-score-v1.mjs` |
| 2 (IA diz que vai transferir) | coberto quando o runtime registra o handoff (adaptação 2) |
| 5 a 15, 18 (semânticos) | `test_atendimento_v1.py`: cada regra está no texto que o Jev lê. A calibração é com conversas reais |
| 16, 17 (playbook da empresa, sem regra de preço) | prova PGlite e `test_atendimento_v1.py` |
| 19 a 25 (próximo passo, follow-up) | prova PGlite (fatores e alertas) |
| 26 a 29 (denominador, alerta sem desconto, parcial, histórico) | prova PGlite |
| 30, 31 (evidências) | `test_analista.py` |

Números: prova PGlite com 60 verificações (inclui o rollback); runtime com 975
testes; portal com 976 testes mais o build.

## Publicação (ordem)

1. migration `20261004100000` (SQL Editor, com ensaio; rollback em
   `scripts/sql/rollback-20261004100000-atendimento-score-v1.sql`);
2. merge do PR (o portal lê os dois formatos);
3. runtime `atendimento-score-v1` na VPS
   (`patches/runtime-atendimento-score-v1-DEPLOY.md`).
