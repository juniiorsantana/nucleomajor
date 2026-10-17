# Plano — construtor de fluxos funcional

Escrito em 23/09/2026, reescrito no mesmo dia depois de o dono fixar o rumo
comercial. Parte de onde a FASE 3 parou e substitui a ordem de entrega das
fases 4 a 9 de `auditoria-e-fases-construtor-fluxos.md`. As decisões técnicas
daquele documento (escada de interpretação, ciclos proibidos, dois prazos)
continuam valendo.

## O rumo, fixado pelo dono em 23/09

1. **O construtor de fluxos e as respostas automáticas entram no plano Base
   (R$ 97).** A IA no atendimento continua a partir do Atendimento com IA
   (R$ 197). Um plano sem IA precisa de um chatbot que se vira sozinho.
2. **Primeiro tudo funciona no WhatsApp por QR Code**, que é o que roda hoje.
   A API oficial (templates, botões) vem depois, e o fluxo terá de saber que
   fora das 24 horas só sai template aprovado.
3. **Cada bloco e cada regra dependem do plano.** Conforme o construtor
   crescer, cada recurso declara de que função precisa; quem não tem, não vê.

Isso reordenou o plano: o que era "liberar para os clientes" no fim virou
pré-requisito, porque **hoje um cliente do Base não roda fluxo nenhum**.

## Andamento em 23/09/2026

Conferido por leitura do banco de produção, da VPS e do código.

| Etapa | Estado |
|---|---|
| 1 — Juntar o que já existe | **feita** |
| 2 — Editor v3 | **feita** |
| 3 — Ligar na Major e ver funcionar | **em andamento** — flag ligada, faltam as jornadas |
| 4 — Blocos baratos do protótipo | **parcial** — dia, horário e etiqueta feitos |
| 5 — O plano Base roda fluxo | **feita e publicada** (falta o teste ao vivo da Adriani) |
| 6 — O fluxo pergunta | **feita e publicada** |
| 7 — Início limpo e gatilhos | **feita e publicada** |
| 8 — O relógio (Aguardar) | **feita e publicada** (24/09) |
| 9 a 11 | não iniciadas |

- **Etapa 1 — feita.** Portal: a FASE 3 foi juntada à `main` (`a584342`).
  Servidor: o executor foi refeito sobre `15508c5` (branch
  `feat/fluxos-no-runtime`, `87a9946`), com 863 + 56 testes passando na própria
  VPS.
- **Etapa 2 — feita e publicada (`20b6086`).** O editor v3 fica atrás da função
  `fluxos_ramificados`. O editor confere antes de salvar o mesmo que o banco
  confere quando a conversa começa: 37 casos, 0 divergências. A migration
  `20260925100000` **está aplicada** e a função está ligada para a Major e para
  a Adriani Ademicon.
- **Etapa 3 — em andamento.** `NUCLEO_FLOW_RUNTIME=1` está ligada na conexão da
  Major desde 23/09. A release ativa é `fluxos-conclusao` (symlink 18:19). Ela
  corrigiu um defeito que teria estragado a etapa: a ferramenta de concluir
  etapa não chegava à IA em turno de cliente sem agente, e **toda etapa de IA
  venceria como falha em 24 horas**. Já rodaram 4 execuções reais, todas
  concluídas, todas de um número de teste. **Faltam as seis jornadas e as 48h
  de observação.**
- **Etapa 4 — parcial (`ed7d5b0` portal, `e060e4a` servidor).** Dias da semana,
  horário e os atalhos "Tem etiqueta", "Dias da semana" e "Horário", com a
  migration `20260925110000` aplicada. Falta "Status esperando" e o fuso da
  organização.
- **Etapas 5, 6 e 7 — feitas e publicadas em 23/09.**
  - Banco: migrations `20260926100000` (porteiro com `chatbotOnly`),
    `20260926110000` (contato novo entra no chatbot), `20260926120000`
    (perguntar, coletar, respostas, gatilhos e fila `flow_trigger`) e
    `20260926130000` (plano base com `chatbots`), **aplicadas** pelo SQL
    Editor e conferidas no catálogo. Prova em PGlite com todas as migrations:
    `scripts/sql/prova-plano-base-roda-fluxo.mjs`, 76 PASS.
  - Editor = banco: `scripts/sql/conferencia-do-editor-pglite.mjs`, **91
    casos, 0 divergências** (39 novos de pergunta, coleta e gatilho).
  - VPS: release `fluxos-plano-base` (Etapa 5) e depois `fluxos-pergunta`
    (Etapas 6 e 7), symlink trocado às 22:00 de 23/09, reiniciados só os
    assistentes da Major e da Adriani. 918 testes na própria VPS, OK.
    Rollback: apontar o symlink para `fluxos-plano-base`.
  - Portal: `08d0163` na `main`, no ar (editor com os blocos novos e o
    cartão de início; "Iniciar fluxo" na ficha da conversa). 855 testes do
    app e os do servidor passando.
  - Conexão da Adriani configurada (bridge, `notify_url` na 8101, chatbot e
    fluxo ligados). **Falta o teste ao vivo:** ela ainda não tem fluxo criado.
  - A migration do lead do site (`20260915000000`), aplicada desde 14/09,
    entrou na `main` em `00ffdf9` sem mudança. Com ela na cadeia, as provas
    seguem passando (lead do site 61, plano Base 76, editor = banco 91 casos,
    servidor 308).
- **Conferido no banco às 22:40 de 23/09:** existe **um único fluxo** no
  sistema, o "Teste do construtor (só etiqueta TESTE-FLUXO)" da Major. Ele é
  anterior às Etapas 6 e 7 (gatilho mensagem, sem blocos de pergunta) e rodou 4
  vezes, todas concluídas, do número de teste. **Nenhum fluxo usa ainda
  perguntar, coletar, palavra ou disparo manual.** Ele não tem relação com os
  leads do site: o popup da landing usa a campanha "Planos do Site" (1 lead, o
  teste da Aline, primeira mensagem enviada), não um fluxo.
- **Próximo passo:** o dono monta um fluxo de teste na Major (condição "Tem
  etiqueta TESTE-FLUXO", gatilho por palavra, menu com três opções, pedir para
  digitar, transferência) e manda as mensagens do celular de teste; o
  acompanhamento é pela VPS e pelo banco. Depois, o mesmo na Adriani.
- **Etapa 8 — feita e publicada em 24/09.** Migration `20260926160000`
  aplicada (prova PGlite 42 PASS; editor = banco 107 casos, 0 divergências);
  VPS na release `fluxos-aguardar` (929 testes na VPS; rollback
  `fluxos-pergunta`); portal `7bf8d83` + `4d77ec5`. Ver a seção da Etapa 8.
- Decisões 1 a 5: aceitas as recomendações.

## O que hoje impede o plano Base de usar fluxo

Levantado em 23/09 por leitura. É o que a Etapa 5 resolveu — os cinco itens
abaixo estão resolvidos desde 23/09.

1. **O porteiro recusa quem não tem IA.** Toda mensagem de cliente passa por
   `public.nucleo_customer_assistant_access` antes de chegar ao assistente, e a
   casca pública (`20260920110000`) devolve `allowed: false,
   reason: plan_without_assistant` para quem não tem `ai_customer`. O chatbot
   está atrás desse portão.
2. **O fluxo exige contato já cadastrado.** `nucleo_flow_start` procura o
   contato pelo telefone e levanta `flow contact unavailable` se não achar.
   **Lead de anúncio, que chega desconhecido, não dispara fluxo.**
3. **A tela de Chatbots é liberada pela IA.** `Gestao.jsx` usa
   `planoLibera(recursos, "inteligencia")`.
4. **O que vai para a IA não tem para onde ir.** Numa conexão sem Claude, o
   cliente final receberia "atendimento temporariamente indisponível".
5. **A conexão da Adriani não está pronta.** Bridge com `enabled: false` e
   `customer_inbound: false`; `notify_url` apontando para o assistente **da
   Major** (8090) em vez do dela (8101); `EMYLEADS_CHATBOT_RUNTIME=0`; sem
   `NUCLEO_FLOW_RUNTIME`.

## Regras que atravessam todas as etapas

**Um bloco novo só existe quando quatro lugares concordam:** o domínio do
portal (`chatbots.js`), o editor, o banco (`private.flow_validate` e
`private.flow_step`) e o executor Python. Por isso toda etapa que acrescenta
bloco traz uma migration, uma release da VPS e uma publicação do portal, nessa
ordem — o banco precisa aceitar o bloco antes de o editor deixar salvá-lo.

**Sem IA, nada chama o Claude — e o cliente final nunca vê erro.** Onde o fluxo
pediria IA, a conversa vai para a equipe, em silêncio, como se o fluxo tivesse
terminado. Um plano sem IA nunca produz uma mensagem de desculpa.

---

## Etapa 3 — Ligar no WhatsApp da Major e ver funcionar de verdade

**Em andamento.** A flag já está ligada; falta provar.

- [x] Ligar `NUCLEO_FLOW_RUNTIME=1` só na unit da conexão da Major.
- [ ] Jornadas reais, com números de teste:
  - [ ] fluxo linear antigo continua igual;
  - [ ] condição por etiqueta vai para o ramo certo;
  - [ ] IA conclui com sucesso e o fluxo continua;
  - [ ] IA falha, ou não responde em 24h, e o fluxo segue pela falha;
  - [ ] pessoa da equipe assume no meio e o fluxo não volta;
  - [ ] fluxo editado com uma conversa em espera não quebra a conversa.
- [ ] Observar 48h: `chatbot_flow_executions` enchendo, sem `flow.poll_failed`
      nem `flow.start_failed` no journal.

**Pronto quando:** as seis jornadas passam. Aqui a FASE 3 fecha oficialmente.
**Primeiro marco: o fluxo ramifica de verdade.**

## Etapa 4 — O resto dos blocos baratos

- [x] **Tem etiqueta**, **Dias da semana** e **Horário**.
- [ ] **Status esperando**: marca a conversa e segue na hora. Depende de existir
      um estado da conversa (Esperando, Em atendimento, Resolvida) nas
      Conversas — é decisão de produto, ainda não tomada.
- [ ] Fuso da organização guardado no banco e usado pelo portal e pela VPS.
      Nunca o fuso do navegador nem o do servidor. Hoje o fuso mora na regra,
      escolhido a cada uso.

## Etapa 5 — O plano Base roda fluxo, sem IA nenhuma

**O que você ganha:** o construtor deixa de ser um recurso de quem paga IA, e
o Base passa a ter valor próprio. É o que destrava a Adriani.

- [x] **Migration:** a casca de `nucleo_customer_assistant_access`, quando a
      empresa **não** tem `ai_customer` mas **tem** `chatbots`, devolve
      `allowed: false` com um campo novo `chatbotOnly: true` e
      `reason: chatbot_only`.
      **Por que `allowed` continua `false`:** o runtime antigo, que não conhece
      o campo, segue recusando — o estado intermediário é o de hoje e a ordem
      de aplicação deixa de importar. Só o runtime novo lê `chatbotOnly`.
- [x] **Runtime:** ao ver `chatbotOnly`, o inbound segue para o executor de
      chatbot e **nunca** para o Claude:
      - sem fluxo que se aplique → conversa fica com a equipe, sem mensagem;
      - bloco "Transferir → IA" → sai pela saída **Falha**, com motivo no log;
      - a transferência para pessoa continua igual.
- [x] **Portal:** a tela Chatbots abre com a função `chatbots`. O texto
      "Disponível nos planos com IA" fica só para Conhecimento e Inteligência.
- [x] **Lead desconhecido vira contato:** `nucleo_flow_start` deixa de levantar
      quando não acha o contato; cria com o telefone e origem `WhatsApp`, e
      segue. Só no início do fluxo, para não encher o CRM com quem mandou "oi"
      por engano. O gatilho "primeira conversa" passa a valer para ele.
- [x] **A conexão da Adriani:** `notify_url` para a porta **8101** (hoje aponta
      para a Major — este é o mais importante), `enabled` e `customer_inbound`
      ligados, `EMYLEADS_CHATBOT_RUNTIME=1` e `NUCLEO_FLOW_RUNTIME=1`, e
      reiniciar só as units dela. O WhatsApp dela cai por segundos.

**Estado:** tudo feito e publicado; **falta a prova ao vivo abaixo**, que
depende de a Adriani ter um fluxo ativo.

**Pronto quando:** um número que não existe no CRM manda mensagem para o
WhatsApp da Adriani, recebe a resposta do fluxo de boas-vindas, aparece em
Contatos, e o journal não mostra nenhuma chamada ao Claude — com a Major
atendendo normalmente ao lado.

## Etapa 6 — O fluxo pergunta e entende a resposta

**O que você ganha:** o chatbot conversa. "Digite 1 para agendar, 2 para
preços" passa a funcionar, e também "quero agendar" ou "marcar". **É esta
etapa que faz o Base valer o preço.**

- [x] **Pedir para escolher**: uma saída por opção, mais a saída
      `não resolvido`.
- [x] **Pedir para digitar**: guarda a resposta numa variável que pode ser
      usada nas mensagens seguintes.
- [x] A conversa pausa esperando o contato e retoma na mensagem seguinte.
- [x] Para entender a resposta, sem IA, testar nesta ordem:
  1. número;
  2. texto igual à opção;
  3. palavra contida numa única opção;
  4. sinônimos cadastrados na opção.
- [x] Número de tentativas e prazo de resposta configuráveis.
- [x] Uma segunda mensagem durante a espera não abre uma segunda execução.
- [x] O que o contato digitou só entra no texto das mensagens, nunca em log
      nem em regra.

**Pronto quando:** um menu de três opções resolve respostas por número, por
palavra e por sinônimo, e manda o "não entendi" pela saída certa.
**Estado:** provado nos testes do runtime (`test_flow_questions.py`) e na
prova do banco; falta ver num WhatsApp de verdade.
**Segundo marco: o fluxo conversa.**

## Etapa 7 — O início limpo e os gatilhos

**O que você ganha:** o fluxo começa onde você quer, e não só quando um
contato conhecido escreve. Pedido do dono depois de usar o construtor.

- [x] **Um bloco de início só.** Hoje o canvas nasce com dois nós fixos, não
      apagáveis: "Disparo" e "Filtro". Viram um, com as condições de entrada
      dentro e um resumo no próprio card. Fluxo novo abre com ele e mais nada.
- [x] **O card de disparo para de mentir.** Ele diz "Contato conhecido escreve
      no WhatsApp", texto fixo na tela; passa a mostrar o gatilho de verdade.
- [x] Gatilhos novos, em ordem de valor:
  - [x] **palavra na mensagem** — é o que separa anúncio sem IA, porque o
        "Clique para o WhatsApp" do Meta já manda o texto pronto;
  - [x] **manual**, acionado por alguém da equipe dentro da conversa;
  - [x] **por campanha**, no molde do que a campanha "Planos do Site" faz hoje
        à mão;
  - [x] **por etiqueta aplicada**;
  - [x] **por mudança de etapa do funil**.

**Como ficou:** os gatilhos que não dependem de mensagem (manual, etiqueta,
etapa, campanha) só existem no formato com caminhos. O banco enfileira um
comando `flow_trigger` para a VPS; os automáticos pulam quem tem "Não atender
IA" ou está com alguém da equipe, o manual passa. O disparo manual é um
contato por vez, na ficha da conversa — não é disparo em massa.

## Etapa 8 — O relógio, para o follow-up existir

**O que você ganha:** "aguardar 2 horas e mandar lembrete", mesmo com o portal
fechado. O disparo manual da Etapa 7 só faz sentido com isto. Exemplo do dono:
a negociação parou, alguém aciona o fluxo, e ele cobra em 24 horas, depois em
2 horas, até terminar.

- [x] **Bloco "Aguardar".** O motor **já sabe suspender e retomar**:
      `chatbot_flow_executions` tem `suspension_expires_at`, hoje fixo em 24
      horas e usado só para esperar a IA. O bloco reaproveita isso com prazo
      escolhido e desfecho "tempo cumprido" em vez de falha.
- [x] **Um relógio na VPS** que varre prazos vencidos e reivindica cada
      execução uma única vez.
- [x] **A resposta do contato cancela a espera.** Sem isto, a pessoa responde e
      recebe a cobrança das duas horas mesmo assim — é o que mais incomoda.
- [x] **Teto de tentativas e saída de desistência.** No QR Code não existe
      template nem janela obrigatória; o risco de insistir é a reputação do
      número, e o freio tem de estar no fluxo.
- [x] Execução abandonada fecha como `expirada` e grava um evento em
      `contact_events`.

**Como ficou:** bloco `aguardar` com `duracao` + `unidade` (minutos 1–1440,
horas 1–720, dias 1–30) e saídas `respondeu`/`sem_resposta`. O relógio é o
laço que a VPS já tem (`nucleo_flow_pending` a cada segundo): espera vencida
vira `sem_resposta`, e o banco recusa `sem_resposta` antes do prazo. Qualquer
mensagem do contato durante a espera (inclusive áudio) vira `respondeu` e não
abre outro fluxo. Teto de 10 esperas por fluxo, sem ciclo. Cobrança com mais
de 6 h de atraso (VPS fora do ar) não sai: fecha como `cancelled`/`wait_missed`
e grava `flow.expired` em `contact_events`. Equipe assumindo ou encerrando a
conversa cancela a espera. **Falta:** ver um follow-up real acontecer.

## Etapa 9 — A IA ajuda quando o menu não entende

**O que você ganha:** o degrau entre o Base e o Atendimento com IA fica
visível: o mesmo fluxo entende mais quando a empresa paga IA.

- [ ] Quando os quatro passos da Etapa 6 não decidem, a IA escolhe a opção pelo
      `intelligenceRouter` que já existe.
- [ ] Se a IA falhar, não estiver disponível **ou a empresa não tiver o
      plano**, a conversa sai por `não resolvido` e não trava.
- [ ] Custo da IA contado por execução e visível. Casa com os créditos de IA
      anunciados na landing (1.000 no Atendimento, 2.000 no Completo), que hoje
      não têm contador.

## Etapa 10 — Cada bloco e cada regra dependem do plano

Hoje a liberação é grossa: `fluxos_ramificados` liga o formato inteiro.

- [ ] Cada tipo de bloco e cada tipo de regra declara a função de que precisa,
      numa lista só, lida pelo editor e pelo banco. `transferir → ia` exige
      `ai_customer`; os demais, nada além de `chatbots`.
- [ ] A trava vale em três lugares: **editor** (bloco com cadeado e o motivo),
      **ao salvar** (o banco recusa o fluxo que usa bloco não liberado) e **ao
      rodar** (empresa que perdeu a função sai pela Falha, sem quebrar a
      conversa).
- [ ] Função nova nasce desligada para todos, como já manda o catálogo
      (`20260924100000`).

## Etapa 11 — Liberar para os clientes

- [ ] Editor v3 para todas as organizações.
- [ ] Converter os fluxos v2 existentes, com rollback registrado.
- [ ] Ligar a flag nas conexões dos clientes, uma de cada vez.
- [ ] `STATUS.md` e `CHANGELOG.md` atualizados.
**Marco final: o construtor completo.**

## Depois: a API oficial

Fora deste plano, registrado para não se perder. `cloud_api.py` no runtime tem
só a primeira etapa escrita (assinatura do webhook, tradução da mensagem,
janela de 24h), sem falar com a Meta. Quando entrar, os blocos de mensagem
passam a ter dois formatos, e o fluxo precisa saber que fora das 24 horas só
sai template aprovado.

## Ordem sugerida

**5 primeiro**, porque é o que muda o produto e destrava um cliente que já
paga. **3 fecha junto**, porque as jornadas já podem rodar. Depois **6**, que é
o que faz o Base valer o preço, com a **7** em paralelo por ser só portal.
Então **8**, e por fim **9**, **10** e **11**.

## Decisões já tomadas

1. **Duas execuções do mesmo fluxo na mesma conversa?** Não. O banco já só
   permite uma viva por conversa; gatilho novo com execução viva é ignorado.
2. **Prazo padrão da execução:** 24h por padrão da organização, ajustável por
   fluxo.
3. **Execução travada porque o fluxo foi editado:** aviso no próprio editor
   ("3 conversas presas na versão anterior"), sem tela nova.
4. **A IA responde dúvidas a partir do Conhecimento dentro do fluxo?** Não por
   enquanto. Fica para o documento de RAG, e a saída `não resolvido` é por onde
   isso vai entrar.
5. **Custo da IA por fluxo:** contar desde a Etapa 9, junto dos créditos de IA
   de `plano-tres-planos-e-ia.md` e da landing.

## Riscos

- **Mexer no porteiro (Etapa 5) é o trabalho mais delicado que resta.** Ele
  decide quem responde o cliente: IA, fluxo ou pessoa. Um erro ali faz a IA
  responder quando não deveria, ou cala o atendimento da Major. Por isso o
  campo novo nasce com `allowed: false`, que é o comportamento de hoje.
- **A VPS tem código fora do git.** Antes de publicar, comparar arquivo a
  arquivo a release ativa com o commit de origem.
- **Fluxos v2 em uso hoje** continuam no executor antigo até a Etapa 11.
  Nenhuma etapa antes disso muda o que eles fazem.
- **A Adriani já está com `fluxos_ramificados` e `chatbots` ligados**, mas sem
  executor na conexão. Ela pode montar um fluxo que não roda. Enquanto a Etapa
  5 não sair, vale avisá-la ou desligar a função no painel.

## Registro de andamento

| Data | Item | Estado | Evidência / observação |
|---|---|---|---|
| 23/09/2026 | Etapas 1, 2 e parte da 4 | publicadas | `a584342`, `20b6086`, `ed7d5b0`; migrations `20260925100000` e `20260925110000` aplicadas e conferidas |
| 23/09/2026 | Etapa 3 | em andamento | flag ligada na Major, release `fluxos-conclusao`, 4 execuções de teste concluídas |
| 23/09/2026 | Plano reescrito | — | Rumo comercial do dono: construtor no Base, QR primeiro, recursos por plano |
| 23/09/2026 | Etapa 5 | feita | 3 migrations aplicadas, release `fluxos-plano-base`, conexão da Adriani configurada |
| 23/09/2026 | Etapas 6 e 7 | feitas | migration `20260926120000` aplicada, release `fluxos-pergunta`, portal `08d0163`, 91 casos editor = banco |
| 23/09/2026 | Migration do lead do site | na `main` | `00ffdf9`; nada reaplicado no banco |
| 23/09/2026 | Teste ao vivo das Etapas 6 e 7 | pendente | nenhum fluxo usa os blocos novos ainda; o dono vai montar o de teste |
| 24/09/2026 | Etapa 8 | feita | migration `20260926160000` aplicada, release `fluxos-aguardar`, portal `7bf8d83`; 42 PASS na prova, 107 casos editor = banco |
