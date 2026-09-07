# FASE 1 — Auditoria e contrato do construtor de fluxos

## Objetivo

Definir um modelo de fluxo capaz de representar ramificações, condições e
caminhos alternativos antes de alterar o editor, o runtime ou os dados
publicados.

## Achados da auditoria inicial

- O canvas já possui uma versão própria (`canvas.versao = 2`) e guarda nós,
  posições e conexões.
- O modelo de conexão já tem o campo `saida`, mas todos os blocos atuais só
  expõem `padrao`. A estrutura está preparada para saídas nomeadas, enquanto o
  comportamento ainda é linear.
- `validarGrafo` exige um único caminho que passe por todos os blocos. Ele
  recusa dois destinos para a mesma saída, blocos desconectados e ciclos.
- As condições do chatbot ficam fora do grafo e são avaliadas como uma lista
  em que todas precisam ser verdadeiras. Não existe grupo `OU` nem condição
  com saídas `sim` e `não`.
- O bloco de transferência para IA guarda `retornoPassoId` e `falhaPassoId`,
  mas esses caminhos não aparecem como conexões no canvas. O editor e o
  executor podem representar a mesma jornada de formas diferentes.
- O executor já lê a topologia do canvas, enquanto `passos` continua sendo a
  fonte do conteúdo dos blocos. Essa separação precisa permanecer explícita:
  ordem visual não pode voltar a ser uma segunda fonte de verdade.
- Os provedores local e remoto têm operações equivalentes de criação,
  atualização, duplicação, validação e execução. Qualquer novo formato precisa
  ser aceito pelos dois antes de publicação.

## Direção proposta

1. A FASE 1 fecha o contrato do grafo: tipos de nó, portas, regras de entrada,
   saídas nomeadas, terminais e caminhos alternativos.
2. A FASE 2 implementa o domínio e o validador sem depender da interface.
3. A FASE 3 atualiza o runtime local e remoto para percorrer ramificações com
   uma mesma regra.
4. A FASE 4 adapta o construtor visual, com conexão, edição e mensagens de
   erro baseadas no contrato.
5. A FASE 5 migra e testa fluxos existentes, incluindo rollback de registros
   incompatíveis.
6. A FASE 6 prova jornadas reais e publica a mudança.

## Decisões ainda necessárias

- Se a ramificação será um bloco explícito de condição no canvas ou se o nó de
  condições inicial também terá portas nomeadas.
- Se a condição será somente `E/OU` entre regras simples ou uma árvore de
  grupos aninhados.
- Se cada caminho alternativo termina, converge em outro bloco ou pode voltar
  a um bloco anterior.
- Como o runtime escolhe uma saída quando nenhuma condição corresponde.
- Se sucesso e falha de uma transferência para IA passam a ser conexões
  visuais, substituindo os IDs `retornoPassoId` e `falhaPassoId`.

## Critério de encerramento da FASE 1

- O contrato descreve todas as portas e estados permitidos.
- Há exemplos de fluxo linear, bifurcado, convergente, terminal e inválido.
- O mesmo contrato pode ser validado sem React e consumido pelos dois
  provedores.
- Nenhuma alteração de produção ou migração é feita nesta fase.
