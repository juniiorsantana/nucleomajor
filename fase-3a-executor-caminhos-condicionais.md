# FASE 3A — Executor de caminhos condicionais

Status: concluída em 07/09/2026; execução v3 implementada, ainda sem publicação
pelo editor.

## Entrega

- o executor percorre o grafo a partir de `Condições` e deixa de depender de um
  caminho linear previamente montado;
- um passo `condicao` avalia sua expressão com a ficha completa do contato e
  escolhe a porta `sim` ou `nao`;
- apenas o ramo escolhido produz efeitos;
- caminhos convergentes continuam uma única vez;
- `encerrar` e transferência humana encerram a execução;
- transferência para IA suspende no próprio bloco. As portas `sucesso` e
  `falha` serão escolhidas quando a FASE 3B persistir e consumir o resultado do
  gateway;
- chamadas legadas que entregam apenas o contato continuam aceitas pelo domínio.

## Integração

O provider local já carregava contato, negócios, tarefas, notas e eventos. Ele
agora entrega essa ficha ao executor no preparo, na sugestão, na reserva
automática e na confirmação. O provider remoto reutiliza essas operações e,
portanto, usa o mesmo plano de execução.

## Prova

Os testes novos demonstram os dois ramos e a convergência. A suíte completa foi
executada com:

```text
npm run test:app
```

Resultado observado: 50 arquivos e 592 testes aprovados.

## Próxima fatia

A FASE 3B define a persistência da suspensão no bloco de IA, a correlação com o
retorno do gateway, a retomada por `sucesso` ou `falha`, idempotência e expiração.
Sem esse contrato, o editor continuará impedido de publicar canvas v3.
