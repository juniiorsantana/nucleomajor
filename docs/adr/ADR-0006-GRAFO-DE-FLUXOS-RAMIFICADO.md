# ADR-0006 — Grafo de fluxos ramificado

Estado: aceito em 07/09/2026; implementação pendente.

## Contexto

O construtor já persiste uma topologia, mas o domínio aceita somente uma cadeia
linear. Condições servem apenas para selecionar o chatbot, e caminhos de
sucesso ou falha da transferência para IA são IDs fora do grafo sem consumidor
de retomada. A interface não pode oferecer ramificação antes de editor,
executor e persistência compartilharem a mesma semântica.

## Decisão

Adotar um canvas v3 acíclico, com saídas nomeadas por tipo de bloco. Um bloco de
condição usa expressão booleana com grupos E/OU e portas sim/não. Caminhos podem
convergir. Transferência humana é terminal; transferência para IA suspende a
execução e usa portas sucesso/falha para retomada persistida e idempotente. Um
bloco encerrar torna o término normal explícito.

Fluxos v1/v2 continuam legíveis. A leitura adapta listas de condições para um
grupo E e transforma os IDs antigos de retorno/falha em arestas. A escrita nova
só usa v3 depois que domínio, runtime e editor o suportarem.

## Alternativas consideradas

### Condições somente no início

É simples, mas não resolve decisões depois de mensagens, etiquetas ou IA.

### Guardar ramificações em campos dos passos

Reduz a mudança visual, mas recria duas fontes de verdade: conexões no canvas e
destinos escondidos nos blocos.

### Permitir ciclos desde o início

Viabiliza repetição, mas exige limites de iteração, recuperação e observação
antes de existir uma necessidade comprovada. A primeira versão usa um grafo
acíclico.

### Estado indefinido

Pode distinguir ausência de dado de condição falsa, mas os avaliadores atuais
não oferecem essa distinção. Fica adiado até haver caso real e contrato de dados.

## Consequências

- A validação deixa de exigir caminho único e passa a validar alcance, portas,
  terminais e ausência de ciclos.
- Nós passam a aceitar múltiplas entradas para convergência.
- O executor precisa escolher uma saída por decisão e persistir um cursor.
- Transferência para IA ganha um protocolo real de suspensão e retomada.
- Canvas v3 não pode ser habilitado apenas na interface.
- Fluxos existentes continuam funcionando durante a migração.

## Critério para concluir a implementação

Concluir quando os exemplos linear, bifurcado, convergente e assíncrono
tiverem resultados definidos, e domínio, runtime, persistência e editor
concordarem sobre cada porta.
