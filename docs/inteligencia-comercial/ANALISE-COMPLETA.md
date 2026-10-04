# Análise Completa — como foi implementada

Desenho aprovado em 03/10/2026 (canvas do relatório, boards Completa, Escolha
e Veredito) e construção pedida pelo dono no mesmo dia. Em cima da Avaliação
do vendedor v2 (`AVALIACAO-DO-VENDEDOR-V2.md`).

## Os três tipos

| Tipo | Créditos | O que responde |
|---|---|---|
| Atendimento | 1 | A gente atendeu bem? A nota do vendedor (os 9 pontos da v2). |
| Lead | 1 | Esse lead vale a pena? A nota do lead. |
| Completa | 2 | As duas notas e o veredito do cruzamento, com uma lista só do que fazer. |

"Comercial" saiu do menu; análises comerciais antigas continuam abrindo. O
crédito passou a ser contado por análise (`conversation_analyses.credits`).

## A nota do lead

| Ponto | Peso | De onde vem | Fatores |
|---|---|---|---|
| Necessidade (`need`) | 20 | Jev `disse_necessidade` (base) | sim 1,0 · não 0,2 |
| Intenção (`intent`) | 20 | Jev `intencao` (base) | comprar agora 1,0 · pesquisando 0,6 · curiosidade 0,2 · fora do perfil 0 |
| Urgência (`urgency`) | 15 | Jev `prazo` (base) | agora 1,0 · este mês 0,6 · sem prazo 0,2 |
| Quem decide (`decision`) | 15 | Jev `decisor` (base) | o próprio 1,0 · outra pessoa 0,6 |
| Engajamento (`engagement`) | 15 | Jev `temperatura` (base) | quente 1,0 · morno 0,6 · frio 0,2 |
| Objeção (`objection`) | 10 | Jev `lead_objection` (nova) | nenhuma 1,0 · contornável 0,6 · forte 0,2 · impeditiva 0 |
| Encaixe no perfil (`fit`) | 5 | Jev `lead_fit` (nova, com o cliente ideal do playbook) | dentro 1,0 · parcial 0,6 · fora 0 |

Resposta sem dado ("não falou", "não dá para saber") sai da conta. Faixas
iguais às do vendedor: bom 75+, atenção 50–74, ruim abaixo de 50.

## O veredito do cruzamento

Decidido no banco (`private.veredito_do_cruzamento`), só na Completa e só com
as duas notas conclusivas (50% ou mais avaliado). Corte de 75 em cada nota:

| | Atendimento abaixo de 75 | Atendimento 75+ |
|---|---|---|
| **Lead 75+** | Oportunidade em risco | Avançar |
| **Lead abaixo de 75** | Revisar o processo | Nutrir ou soltar |

O Claude recebe o veredito pronto e só o explica (`matrix_explanation`).

## Régua

`atendimento.v3` = a v2 (atendimento idêntico) + a família `lead`. Nasce como
modelo; vira o padrão com `select private.trocar_regua_padrao('atendimento.v3');`.
O runtime faz as perguntas do lead só com a v3 (as perguntas cabem no teto
de 40, com os 8 critérios próprios e o jeito do agente).

## Publicação (ordem)

1. Migration `20261010100000` (SQL Editor). Prova:
   `scripts/sql/prova-analise-completa.mjs` (30 verificações, com rollback).
   Rollback: `scripts/sql/rollback-20261010100000-analise-completa.sql`. A
   migration é gerada por `scripts/sql/gerar-20261010100000.mjs` a partir do
   molde: o pedido de análise é recortado da 20261004100000 e só as linhas da
   Completa mudam.
2. Runtime: `patches/runtime-analise-completa-DEPLOY.md`.
3. Troca do padrão para a v3.
4. Merge do portal (menu com os três tipos e o relatório). Por último, para
   ninguém pedir uma Completa antes de a régua ter a nota do lead.
