# Auditoria estendida e plano de fases do construtor de fluxos

Status: aberta em 07/09/2026. Nenhuma mudança de runtime ou produção.

Este documento **substitui a lista de fases proposta na FASE 1**, que foi
escrita antes dos sete blocos novos. O contrato de grafo daquela fase continua
válido; o que muda é o escopo que ele precisa cobrir e, com isso, a ordem em
que vale entregar.

## O que mudou desde a FASE 1

Sete funções novas entraram no desenho do construtor, nenhuma com backend:

| Bloco | Classe |
| --- | --- |
| Dias da semana | condição |
| Horário | condição |
| Tem etiqueta | condição |
| Aguardar intervalo | espera |
| Pedir para escolher | pergunta |
| Pedir para digitar | pergunta |
| Status esperando | efeito |

Junto veio a retirada dos rótulos flutuantes `entrada` e `saída` das portas: uma
saída passa a se identificar pelo próprio nome dentro do cartão.

## Achado principal

Hoje o fluxo não é um objeto vivo. `planoDosPassos` (`domain/chatbotRuntime.js`)
recebe bot e contato e devolve **um plano**, parando na primeira mensagem. Não
existe registro de "onde esta conversa está no fluxo" — existe "o que este fluxo
faria agora, do zero".

Quatro dos sete blocos novos quebram isso. E a FASE 1 já descreveu a solução,
aplicada a um caso só:

> "A execução persiste o cursor antes da transferência e fica suspensa. Um
> evento idempotente de conclusão escolhe a porta, retoma a mesma versão do
> fluxo e recusa retomada duplicada ou de uma versão incompatível."

Isso não é uma regra da transferência para IA. É a definição de execução
suspensa. Generalizar essa frase de caso especial para primitivo é a maior parte
do backend dos blocos novos. O que muda entre eles é apenas **quem acorda a
execução**.

## Classificação dos blocos pelo custo real

Os blocos foram agrupados pelo que exigem da infraestrutura, não pelo tema:

| Grupo | Blocos | Exige | Custo |
| --- | --- | --- | --- |
| A — efeito e segue | enviar mensagem, editar etiquetas, status esperando | nada novo | quase zero |
| B — decide e segue | dias da semana, horário, tem etiqueta | predicado + fuso | baixo |
| C — para, e o contato acorda | pedir para escolher, pedir para digitar | execução durável + interpretação | alto |
| D — para, e o relógio acorda | aguardar intervalo | tudo do C + fila de vencimento | o mais alto |

Duas leituras que decidem a ordem das fases:

- **"Status esperando" não é uma espera.** Apesar do nome, marca a conversa e
  segue na mesma hora. É irmão de "editar etiquetas". Tratá-lo como espera faz
  pagar caro por um bloco barato.
- **"Aguardar intervalo" está sozinho no grupo D** e é o único que exige um
  processo novo. Nos outros seis alguém sempre bate na porta: a mensagem do
  contato chega e o sistema reage. Na espera por relógio não chega nada.

## O que já existe e será reaproveitado

| Peça | Onde | Serve para |
| --- | --- | --- |
| Saídas nomeadas no formato | `canvas.versao = 2`, campo `saida` | ramificação sem mudar a serialização |
| Aridade por instância | `saidasDoPasso(passo)` em `domain/chatbots.js` | "Pedir para escolher" tem N saídas por instância, e a assinatura já recebe o passo, não o tipo |
| Condição `tem_etiqueta` | `TIPOS_CONDICAO` em `domain/regras.js` | o bloco novo é o mesmo predicado embrulhado num nó; não se constrói o segundo |
| Normalização de texto | `normalizarIntencao` em `domain/intelligenceRouter.js` | NFD, sem acento, minúsculas pt-BR — degraus 2 e 3 da escada |
| Pontuação por palavra-chave | `pontuarSkill` em `domain/intelligenceRouter.js` | degrau 4, com `negativeKeywords` para desempate |
| Idempotência e trava de versão | `nucleo_chatbot_execution_claim` | advisory lock, `expected_version`, `already_processed` |
| Assinatura de contexto | `assinaturaContexto` | recusa plano que envelheceu entre preparo e envio |
| Eventos do contato | `public.contact_events` | gancho de follow-up sem tabela nova |
| Destinos de IA | `ALVOS_IA`, `alvoIa`/`skillId`/`campanhaId` | o desvio "transfere para um agente" já está modelado |

## Decisões fechadas nesta etapa

### A escada de interpretação da resposta

Uma pergunta "1 — Agendar consulta" pode ser respondida como `1`, como
`agendar consulta` ou como `consultar`. A interpretação é uma escada, do barato
e determinístico para o caro e incerto, e **para no primeiro degrau que resolve
sem ambiguidade**:

1. **Ordinal** — `1`, `1)`, `opção 1`.
2. **Rótulo exato normalizado** — `normalizarIntencao` no rótulo e na resposta.
3. **Contido, se único** — `consultar` dentro de `agendar consulta`. Só vale se
   casar com exatamente UMA opção; casando com duas, o degrau falha e a escada
   continua. Sem essa regra, opções parecidas viram sorteio.
4. **Sinônimos declarados na opção** — cada opção ganha uma lista de expressões
   (`marcar`, `horário`, `consulta`) e uma de negativas. É o degrau que remove a
   maior parte das chamadas de IA, é controlado pelo usuário e reaproveita a
   forma de `pontuarSkill`.
5. **IA** — só quando os quatro anteriores não decidiram.

Degraus 1 a 4 são puros e testáveis sem rede. O degrau 5 é o único que custa
dinheiro e tempo, e é o único que pode errar.

### Quando nada casa

Um bloco de pergunta expõe, além das saídas de opção, uma saída **`não
resolvido`**. O que acontece antes de sair por ela é configurável:

- número de **tentativas** antes de desistir (configurável, não fixo em uma);
- o que a tentativa faz: reenviar a pergunta, ou pedir para digitar;
- se a IA entra no degrau 5, e com qual agente.

Cada fluxo define um **padrão** para esses três — mas o padrão do fluxo
**materializa uma porta visível no cartão**, nunca um comportamento invisível. A
FASE 1 tirou `retornoPassoId` e `falhaPassoId` da sombra justamente por isso: o
canvas é a única fonte de verdade sobre para onde a conversa vai. Uma opção de
fluxo que transferisse sem aresta desenhada recriaria o problema que a FASE 1
resolveu.

### Ciclos continuam proibidos

"Não entendi, tenta de novo" parece um laço, mas não precisa ser uma aresta. A
repetição é **estado interno do nó** (`tentativas`), com o nó atravessando
`perguntou → aguardando → interpretou → (saiu por porta | tentativa+1 | saiu por
não resolvido)`. O grafo continua acíclico e o validador da FASE 1 continua
valendo.

Isso não fecha a porta para ciclos no futuro. Fecha para esta entrega, porque o
caso que motivou a discussão se resolve sem eles.

### As duas promessas do desenho são complementares

O protótipo afirma duas coisas em texto visível, e ambas passam a valer:

- escrita do contato durante uma espera de relógio **cancela a espera** e o fluxo
  segue na hora — esperar não é silenciar;
- resposta que não couber no formato **convida a tentar de novo**, agora um
  número configurável de vezes.

### Dois prazos, não um

| Prazo | Escopo | Vence quando | Efeito |
| --- | --- | --- | --- |
| Resposta | nó de pergunta | contato não responde | sai pela porta `não resolvido` |
| Execução | fluxo | conversa abandonada | execução fecha como `expirada` |

O prazo de execução é curto em horas ou longo em dias, e é onde o follow-up se
conecta: ao expirar, a execução grava um evento em `contact_events`. O follow-up
em si fica fora deste plano — o que este plano garante é que o gancho existe e é
idempotente.

### RAG: onde entra e onde não entra

Casar uma resposta com três a cinco opções não é recuperação num corpus, é
classificação num conjunto fechado e pequeno. RAG ali seria caro, lento e menos
previsível que os degraus 1 a 4.

O lugar de RAG é o outro: quando o contato pergunta algo **fora do menu**, o
degrau 5 pode responder a partir das Coleções de Conhecimento em vez de só
escolher uma opção ou transferir. Isso está fora do escopo destas fases e vale
um documento próprio, mas a saída `não resolvido` é o ponto de entrada dele.

## Estruturas novas

### Execução durável

`chatbot_executions` modela outra coisa: é chaveada por `external_message_id`, um
livro-caixa de "já tratei esta mensagem", uma linha por mensagem. Ela funciona e
permanece.

O que falta é a instância viva, uma linha por conversa que atravessa muitas
mensagens:

- identidade: organização, fluxo, **versão do fluxo**, contato, conversa;
- posição: nó atual e porta por onde chegou;
- estado: `rodando`, `suspensa`, `concluida`, `expirada`, `falhou`, `cancelada`;
- motivo da suspensão: `aguardando_resposta`, `aguardando_relogio`,
  `aguardando_ia`;
- `variaveis`, `tentativas`, `retomar_em`, `expira_em`;
- chave de idempotência por efeito, na forma `(execução, nó, tentativa)`.

### Relógio da organização

`avaliarCondicao` recebe `agora` como milissegundos. "É terça?" e "são 8h?" não
têm resposta sem fuso. E há um risco concreto: o mesmo fluxo pode rodar na
extensão (fuso do navegador) ou na VPS (UTC) — ADR-0002 e ADR-0003. Se os dois
discordarem, o fluxo se comporta diferente conforme onde roda.

O fuso é dado da organização e viaja no contexto. Nunca é lido do ambiente.

### Variáveis do fluxo

`{nome}` e `{empresa}` saem do contato. Com "pedir para digitar", variável passa
a ser estado da execução. A interpolação ganha escopos — contato, execução,
sistema — e uma regra de segurança: **o que o contato digitou é texto não
confiável**, entra em corpo de mensagem e em lugar nenhum mais. A regra da FASE 1
("texto livre e dados do contato não entram no log de decisão") passa a valer
para variáveis.

### Fila de vencimento

Uma varredura de `retomar_em` e `expira_em` vencidos, reivindicando com o mesmo
padrão claim/complete já em produção — só que disparada por tempo em vez de
mensagem. Serve às duas coisas do relógio: a espera e a expiração.

## As fases

### FASE 2 — Contrato v3 estendido

Fecha em documento os sete tipos, suas portas, a escada, os estados de suspensão
e os dois prazos. Sem código.

- [ ] Cada tipo novo declara portas obrigatórias e regra de escolha.
- [ ] A escada tem os cinco degraus especificados, com a regra de unicidade do
      degrau 3.
- [ ] Os estados de execução e as transições entre eles estão enumerados.
- [ ] Nenhuma alteração de produção.

### FASE 3 — Domínio e validador

JavaScript puro, sem React, sem banco, sem WhatsApp — como `regras.js` e
`chatbotRuntime.js` já são hoje.

- [ ] `SAIDAS_DO_PASSO` cobre os sete tipos, incluindo aridade por instância.
- [ ] `dia_da_semana` e `janela_de_horario` entram em `avaliarCondicao`,
      recebendo fuso pelo contexto.
- [ ] Degraus 1 a 4 da escada implementados e testados como função pura.
- [ ] Validador v3: convergência permitida, ciclo recusado, porta obrigatória
      sem destino recusada.
- [ ] Cobertura dos cinco exemplos de aceite da FASE 1.

### FASE 4 — Grupos A e B em produção

Primeiro valor entregue. Quatro blocos novos, sem execução durável.

- [ ] Canvas v3 publicado, lendo v2 e gravando v3 no primeiro salvamento.
- [ ] Fuso da organização em uso pelos dois runtimes, com o mesmo resultado.
- [ ] Ramificação real percorrida pelo runtime local e pelo remoto.
- [ ] Status esperando, dias da semana, horário e tem etiqueta funcionando.
- [ ] Fluxo lineares existentes seguem com o mesmo comportamento.

### FASE 5 — Execução durável

**Nenhum bloco novo.** A fase troca o plano pela máquina e se prova contra um
comportamento já especificado e nunca construído: o retorno e a falha da
transferência para IA, que a FASE 1 desenhou como portas `sucesso` e `falha`.

- [ ] Tabela de execução com cursor, versão, variáveis e estado.
- [ ] Retomada idempotente; retomada duplicada recusada.
- [ ] Retomada de versão incompatível recusada, e a execução encalhada é
      visível em algum lugar — não morre em silêncio.
- [ ] `retornoPassoId` e `falhaPassoId` deixam de ser canônicos.
- [ ] Nenhuma mudança observável para quem usa fluxos sem IA.

### FASE 6 — Pedir para escolher e pedir para digitar, sem IA

Marco funcional: a partir daqui o construtor faz o que um construtor de fluxo
precisa fazer.

- [ ] Suspensão por `aguardando_resposta` e retomada pela mensagem seguinte.
- [ ] Escada nos degraus 1 a 4; sem degrau 5 nesta fase.
- [ ] Variáveis gravadas, interpoladas e escapadas.
- [ ] Tentativas e prazo de resposta configuráveis, com saída `não resolvido`.
- [ ] Uma segunda mensagem durante a espera não cria execução paralela.

### FASE 7 — O degrau da IA e o desvio para o agente

- [ ] Degrau 5 roteando pelo `intelligenceRouter` existente, não por integração
      nova.
- [ ] Padrão por fluxo materializado como porta visível, nunca invisível.
- [ ] Falha ou indisponibilidade da IA cai em `não resolvido`, não trava.
- [ ] Custo por execução observável.

### FASE 8 — O relógio

- [ ] Fila de vencimento com claim/complete e sem duplo disparo.
- [ ] Aguardar intervalo funcionando com a aba fechada.
- [ ] Escrita do contato cancela a espera pendente.
- [ ] Prazo de execução fecha a execução como `expirada`.
- [ ] Evento de expiração gravado em `contact_events`, idempotente.

### FASE 9 — Migração, prova e encerramento

- [ ] Fluxos v2 existentes convertidos, com rollback registrado.
- [ ] Jornadas reais provadas ponta a ponta nos dois runtimes.
- [ ] `STATUS.md` atualizado e mudança publicada.

## Marcos

| Marco | Onde | O que o usuário ganha |
| --- | --- | --- |
| Primeiro valor | fim da FASE 4 | o fluxo ramifica de verdade |
| Primeiro funcional | fim da FASE 6 | o fluxo conversa: pergunta, entende e segue |
| Completo | fim da FASE 9 | espera, expira e entrega o gancho de follow-up |

## Questões ainda abertas

1. Uma conversa pode ter duas execuções do mesmo fluxo ao mesmo tempo, ou a
   segunda cancela a primeira?
2. Qual o prazo padrão de execução, e ele é do fluxo ou da organização?
3. A execução encalhada por edição do fluxo aparece onde — uma fila de revisão,
   um aviso no editor, ou um relatório?
4. O degrau 5 responde do Conhecimento além de escolher opção, ou isso fica
   inteiramente para o documento de RAG?
5. Quem paga e quem vê o custo da IA por execução de fluxo?
