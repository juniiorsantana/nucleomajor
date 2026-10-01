# Coordenador Jev: plano e andamento

O coordenador é um trabalhador do runtime da VPS que lê as conversas do
WhatsApp com o **Jev** e guarda o que entendeu. O Jev (`typesafe/jev-1.13`,
TypeSafe, chamado pelo OpenRouter) é um modelo de **decisão**: não escreve
texto, responde perguntas fechadas (sim/não, escolha, escala) com a chance de
estar certo.

Desenhos para conversa com o dono (artefatos privados no claude.ai):
- a arquitetura do coordenador: <https://claude.ai/artifact/UKApWLwwwg83egBr4xQtbu>
- a tela "Analisar conversa" e o framework: <https://claude.ai/artifact/81Wxh8fxtrmsTGdFowg2Lm>

## Decisões (01/10/2026)

- **O Jev coordena; o Claude escreve.** Tudo o que é decidir (classificar a
  conversa, sinais) vai para o Jev. O que precisa de texto (a análise completa
  do botão) vai para um agente Claude, numa etapa futura.
- **Avalia o lead E o atendimento**, separando IA e equipe. Conversas
  atendidas pela IA entram.
- **Framework = base da Major + playbook da empresa.** O playbook (etapa
  futura) troca opções e acrescenta critérios, e alimenta também a habilidade
  do agente que atende.
- **A primeira versão só registra e mostra.** Nenhuma ação sozinha
  (etiqueta, tarefa, aviso) até medirmos os acertos com leituras reais.
- **Ligado só para a Major no começo.** As conversas saem para o OpenRouter e
  a TypeSafe. Outra empresa só depois de conferir a política de dados do Jev,
  atualizar `/privacidade` e avisar o cliente.
- **Fora do caminho da resposta.** O coordenador roda numa thread própria; se
  o Jev cair, o atendimento não percebe.
- **O botão "Analisar conversa" continua pago** (créditos 30/100/200) e fica
  para a etapa 5.
- **Grupos ficam para depois** (decisão do dono, 01/10): o espelho não guarda
  quem falou dentro do grupo, e tarefa hoje exige contato do CRM.

## O teste que embasou (01/10/2026)

30 conversas reais da própria Major, anonimizadas no SQL, 19 perguntas.
Funcionou em todas: ~4 mil tokens e ~US$ 0,00017 por conversa, 0,5 a 0,9 s,
total de US$ 0,0046. Pela confiança das respostas (sem conferência humana):

- confiantes: pedido de pessoa (94%), sensibilidade a preço (91%),
  insatisfação (86%), perguntou antes do preço (86%);
- insegura: temperatura em 5 níveis (47%) → virou 3 níveis no `major-v1`;
- suspeitas: "respondeu tudo" ("não" em 26/30) → virou "ficou pergunta
  IMPORTANTE sem resposta"; "promessa pendente" ("sim" em 16/30) → virou
  promessa CONCRETA não cumprida.

## Etapas

| # | Etapa | Estado |
|---|---|---|
| 1 | Plano escrito (este arquivo) | feito |
| 2 | Banco: migration `20260930100000`, prova em PGlite | aplicada e conferida em 01/10; ligada só para a Major |
| 3 | Runtime: `coordenador.py` + `jev_framework.py`, patch e roteiro | no ar desde 01/10 (release `coordenador-jev`); **espera a chave de produção** |
| 4 | Portal: "Leitura automática" na ficha da conversa | no ar (PR #14, `e5a04f6`) |
| 5 | Botão "Analisar conversa" com o Agente Analista (Claude) e créditos | não começou |
| 6 | Sinais com ações (suporte, aviso, etiqueta), com os cortes medidos | não começou |
| 7 | Números gerais (qualidade dos leads e do atendimento, IA × equipe) | não começou |
| 8 | Playbook por empresa | não começou |
| 9 | Jev no caminho da resposta (filtro antes do Claude, escolha de agente, handoff, fluxos) | não começou |

## Como está montado

```
Supabase                               VPS (runtime)                    OpenRouter
whatsapp_conversations ── a cada 5 min ─► coordenador.py
whatsapp_messages        nucleo_insights_      │ conversa em texto
                         pending()             │ + jev_framework.PERGUNTAS ──► Jev
conversation_insight_  ◄─ nucleo_insights_ ────┘ ◄── respostas + chance ─────
runs / _answers           record()
        │
        ▼
portal: ficha lateral da conversa ("Leitura automática")
```

- **Quando uma conversa é lida:** conversa direta, com mensagem do contato,
  última mensagem nos últimos 7 dias e parada há 60 minutos
  (`NUCLEO_INSIGHTS_QUIET_MINUTES`), sem leitura que cubra a última mensagem e
  sem falha na última hora.
- **Duas travas:** `NUCLEO_INSIGHTS=1` no env da conexão e a função
  `conversation_insights` ligada para a empresa no painel.
- **Falhas:** chave, crédito, limite ou Jev fora do ar param o ciclo sem
  gravar nada (`insights.paused` no journal, espera dobra até 1 h). Pedido
  recusado ou resposta torta grava `failed` só naquela conversa.
- **O que fica guardado:** respostas, chance, distribuição, modelo, versão do
  framework, tokens, custo e tempo. Nunca o texto da conversa. Poda em 180 dias.
- **Portal:** busca a leitura em vigor a cada 5 minutos, sem realtime.
  Resposta com chance abaixo de 60% aparece como "Incerto" e não vira selo.

## Arquivos

| Onde | O quê |
|---|---|
| `supabase/migrations/20260930100000_o_coordenador_le_as_conversas.sql` | catálogo, tabelas, RLS, as duas RPCs |
| `scripts/sql/prova-coordenador-jev.mjs` | prova em PGlite: 43 PASS |
| `scripts/sql/validar-coordenador-jev.sql` | conferência só leitura depois de aplicar |
| `docs/coordenador-jev/APLICAR.md` | roteiro de aplicação da migration |
| `patches/runtime-coordenador-jev.patch` | o runtime, sobre a release `claudio-dormindo` |
| `patches/runtime-coordenador-jev-DEPLOY.md` | roteiro de deploy na VPS |
| `apps/emyleads/src/domain/leituraDaConversa.js` | tradução das respostas para a tela |
| `apps/emyleads/src/page/telas/conversas/ficha.jsx` | o bloco "Leitura automática" |

## Registro

- **01/10/2026:** teste com 30 conversas; decisões acima; migration escrita e
  provada (43 PASS); runtime com 967 testes OK (29 novos); patch na `/tmp` da
  VPS com `git apply --check` OK; portal com 918 testes do app e 332 do
  servidor OK, build OK.
- **01/10/2026, mais tarde:** migration aplicada pelo SQL Editor (autorizada
  pelo dono nesta sessão) e conferida: 13 verificações `true`. Função ligada
  só para a Major no painel; `org_has_feature` confirma Major `true`, Adriani
  `false`.
- **Falta, nesta ordem:** (3) criar a chave de produção no OpenRouter;
  (4) deploy do runtime (`runtime-coordenador-jev-DEPLOY.md`); (5) merge do PR
  do portal; (6) depois de uma semana, conferir uma amostra das leituras e
  decidir os cortes da etapa 6.
