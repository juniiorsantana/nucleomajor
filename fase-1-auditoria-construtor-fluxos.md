# FASE 1 — Auditoria e contrato do construtor de fluxos

Status: concluída em 07/09/2026; nenhuma mudança de runtime ou produção.

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

## Questões resolvidas pelo contrato

- Se a ramificação será um bloco explícito de condição no canvas ou se o nó de
  condições inicial também terá portas nomeadas.
- Se a condição será somente `E/OU` entre regras simples ou uma árvore de
  grupos aninhados.
- Se cada caminho alternativo termina, converge em outro bloco ou pode voltar
  a um bloco anterior.
- Como o runtime escolhe uma saída quando nenhuma condição corresponde.
- Se sucesso e falha de uma transferência para IA passam a ser conexões
  visuais, substituindo os IDs `retornoPassoId` e `falhaPassoId`.

## Contrato proposto

### Duas classes de condição

As condições atuais na raiz continuam escolhendo **se o chatbot começa**. Elas
formam o filtro de entrada e não são um nó do caminho. Um novo passo de condição
decide **por onde uma execução já iniciada continua**.

As duas classes usam a mesma expressão, formada por grupos com operador E ou OU
e regras simples como filhos. Uma lista antiga de condições equivale a um grupo
E contendo essa lista. Grupos vazios são inválidos. A primeira entrega aceita
grupos aninhados, com limites de profundidade e quantidade validados no domínio.

### Portas por tipo

| Tipo | Saídas obrigatórias | Regra |
| --- | --- | --- |
| entrada | padrão | aponta para o filtro inicial |
| filtro inicial | padrão | inicia o caminho quando a expressão atende |
| mensagem | padrão | continua depois do envio confirmado |
| etiquetas | padrão | continua depois da gravação confirmada |
| condição | sim, não | escolhe exatamente uma saída |
| transferir para humano | nenhuma | encerra a automação |
| transferir para IA | sucesso, falha | suspende e retoma por resultado |
| encerrar | nenhuma | termina explicitamente o caminho |

O estado indefinido fica fora da primeira entrega. As condições atuais já
produzem booleano; introduzir três estados agora criaria uma semântica que
nenhuma fonte de dados consegue distinguir de falso.

### Topologia

- O canvas v3 é a única fonte de verdade para ordem e ramificações.
- O grafo é acíclico na primeira entrega.
- Caminhos podem divergir e convergir.
- Cada porta obrigatória possui exatamente um destino.
- Cada nó, exceto a entrada, recebe ao menos uma conexão.
- Todos os nós precisam ser alcançáveis a partir da entrada.
- Um nó pode receber mais de uma conexão para permitir convergência.
- Um caminho só termina em encerrar ou transferência humana.

Permitir convergência exige remover a regra atual de uma única entrada por
bloco. A restrição continua sendo por porta de saída, não por destino.

### Transferência para IA

Os campos atuais de retorno e falha deixam de ser a representação canônica.
As portas sucesso e falha passam a apontar para os próximos nós. A execução
persiste o cursor antes da transferência e fica suspensa. Um evento idempotente
de conclusão escolhe a porta, retoma a mesma versão do fluxo e recusa retomada
duplicada ou de uma versão incompatível.

Durante a migração, registros v2 ainda podem ser lidos. Seus IDs antigos são
convertidos em arestas na leitura, e o primeiro salvamento válido grava v3.
Como o runtime atual apenas transporta esses IDs e não os consome, a publicação
de v3 depende da implementação da retomada.

### Execução e segurança

- A avaliação de condições é pura e recebe um snapshot explícito do contato.
- Cada decisão registra somente nó, saída escolhida, versão e IDs técnicos.
- Texto livre e dados do contato não entram no log de decisão.
- A assinatura de contexto inclui a expressão e todas as conexões.
- A execução guarda versão do fluxo e cursor antes de cada efeito.
- Repetir o mesmo evento não envia mensagem nem aplica etiqueta novamente.
- Alterar um fluxo não muda uma execução já suspensa silenciosamente.

## Exemplos de aceite

1. Linear: entrada → filtro → mensagem → encerrar.
2. Bifurcado: condição lead quente; sim → proposta, não → nutrição.
3. Convergente: dois caminhos chegam à mesma mensagem final.
4. Assíncrono: IA; sucesso → conclusão, falha → transferência humana.
5. Inválido: porta ausente, nó inalcançável, ciclo, saída desconhecida ou
   caminho sem terminal.

## Decisões fechadas

- Ramificação usa um bloco explícito de condição.
- Expressões suportam E e OU aninhados.
- Caminhos podem convergir e não podem formar ciclos.
- A saída não cobre a condição falsa; não há estado indefinido inicialmente.
- Sucesso e falha da IA são conexões visuais e exigem retomada persistida.
- Canvas v3 só será publicado quando domínio, runtime e editor compreenderem o
  mesmo contrato.

## Evidência revisada

- O grafo atual aceita apenas a saída padrão, caminho único e uma entrada.
- O motor atual avalia a lista de condições com every.
- O executor para na primeira mensagem e só transporta IDs de retorno e falha.
- O gateway valida e armazena esses IDs.
- Nenhum consumidor no runtime retoma o fluxo por esses IDs.

## Critério de encerramento da FASE 1

- [x] O contrato descreve todas as portas e estados permitidos.
- [x] Há exemplos de fluxo linear, bifurcado, convergente, terminal e inválido.
- [x] O mesmo contrato pode ser validado sem React e consumido pelos dois
  provedores.
- [x] Nenhuma alteração de produção ou migração é feita nesta fase.
