# Avaliação do vendedor v2 — como foi implementada

Plano aprovado pelo dono em 03/10/2026 (Claude Doc "Plano — Avaliação do
vendedor v2"; desenho no canvas do relatório, boards `VendedorV2` e
`PerfilVendedor`). Substitui o Atendimento Score v1
(`ANALYSIS-SCHEMA-V1.md`) como a nota única do atendimento e vira o padrão de
todos os clientes.

Este PR cobre as etapas 1 a 3 do plano (régua, Jev e Analista, relatório).
Calibração, perfil do vendedor e padrões × conversão vêm depois.

## Decisões do dono (03/10/2026)

| Decisão | Onde ficou |
|---|---|
| Uma nota só: a v2 substitui o Atendimento Score | linha `atendimento.v2` em `analysis_schemas`; o relatório escolhe o formato pela régua da análise |
| Tom cru, sem ofensa; elogia quando foi bem | `analista.SISTEMA_V2` e as regras do `FORMATO_V2` |
| Vendedor sem autor nas mensagens = "Equipe · pelo celular" | `private.fatos_do_vendedor` (`seller`) |
| Perfil do vendedor com 10 conversas analisadas na conta | etapa 5 (não está neste PR) |
| Régua de velocidade: seg a sáb, 8h às 20h, Brasília; 15 / 60 / 240 min | `private.minutos_uteis` e `fatos_do_vendedor` (`speed`) |
| IA também é avaliada, como vendedor "IA" | `seller.kind = 'ia'` |
| A v2 vira o padrão de todos | `private.trocar_regua_padrao('atendimento.v2')`, depois do runtime |

## Os 9 pontos

| Ponto | Peso | Fonte | De onde vem o estado |
|---|---|---|---|
| Avanço com data (`advance`) | 16 | SPIN Selling (Rackham) | Jev `vnd_advance` |
| Diagnóstico (`diagnosis`) | 14 | SPIN Selling, Gap Selling | Jev `vnd_diagnosis`, com o playbook |
| Trata objeção (`objection`) | 12 | Never Split the Difference (Voss) | Jev `vnd_objection`, com o playbook |
| Ensina e conduz (`leads`) | 12 | The Challenger Sale | Jev `vnd_leads` |
| Pede o fechamento (`close`) | 12 | Secrets of Closing the Sale (Ziglar) | Jev `vnd_close` |
| Follow-up (`follow_up`) | 10 | Fanatical Prospecting (Blount) | Jev `vnd_follow_up`, com a data |
| Velocidade (`speed`) | 8 | Harvard Business Review, 2011 | fatos (`speed.state`), sem Jev |
| Escuta e empatia (`empathy`) | 8 | Never Split the Difference (Voss) | Jev `vnd_empathy` |
| Cumpre o que promete (`promises`) | 8 | Influence (Cialdini) | Jev `vnd_promises`, com a data |

Estados e fatores de sempre (bom 1,0; atenção 0,6; ruim 0,2; crítico 0).
"Não avaliado" sai da conta. Avanço: fechou, compromisso com data, proposta
com data e desqualificado com motivo valem 1,0; compromisso sem data 0,6;
continuação 0. Promessa: cumpriu 1,0; com atraso 0,6; vencida sem entrega 0,2.

Faixas (no banco): Vendeu bem 75+, Atende mas não fecha 50–74, Atrapalhou a
venda abaixo de 50. Abaixo de 50% de peso avaliado, a nota é não conclusiva e
a tela não mostra faixa.

## Como funciona

```
pedido (banco): fatos v3 (+ vendedor e velocidade) + nota pela régua da empresa
  + playbook efetivo com `regua`
  ↓
VPS: com regua = atendimento.v2, o Jev recebe as vnd_* no lugar das att_*
  → nucleo_analysis_classify recalcula a nota no banco
  ↓
Claude (SISTEMA_V2): analysis_report.v2 — veredito, did_well, cost_the_sale,
  why_this_score com a crítica e o `better` de cada ponto avaliado
  ↓
banco: relatório analysis.v2 (vendedor_score com faixa e cobertura, seller,
  speed, diagnóstico) · portal: RelatorioDoVendedor
```

A leitura automática do Jev usa o mesmo caminho: `regua` chega no playbook da
fila (`playbook_para_o_jev`).

## Publicação (ordem)

1. Migration `20261008100000` (SQL Editor). Não muda a régua de ninguém.
   Prova: `scripts/sql/prova-avaliacao-do-vendedor-v2.mjs` (62 verificações,
   com rollback e reaplicação). Rollback:
   `scripts/sql/rollback-20261008100000-avaliacao-do-vendedor-v2.sql`.
2. Merge deste PR (o portal lê v1 e v2).
3. Runtime: `patches/runtime-avaliacao-do-vendedor-v2-DEPLOY.md`.
4. Troca do padrão: `select private.trocar_regua_padrao('atendimento.v2');`

Voltar uma empresa só para a v1, sem voltar todo mundo:
`platform_analysis_schema_set(<empresa>, 'atendimento.v1', '<nota>')` (painel,
administrador) ou `private.ligar_regua(<empresa>, 'atendimento.v1')` (SQL).

## Limites conhecidos

- A análise só vê o WhatsApp: ligação ou reunião fora dele não aparece. O
  ponto sai "não avaliado", nunca "ruim".
- A velocidade mede a primeira resposta da janela dos fatos (as últimas 2000
  mensagens). Conversa antiga retomada é medida pelo começo da janela.
- O painel antigo (`page-classico`) não tem a tela da v2: análise v2 aberta
  nele cai na tela de formato antigo. O painel novo é o padrão desde 03/10.
- As descrições dos estados precisam de calibração com conversas reais
  (etapa 4 do plano).
