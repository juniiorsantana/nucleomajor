# FASE 2 — Domínio de fluxos ramificados

Status: concluída em 07/09/2026; contrato implementado no domínio, ainda sem
habilitar edição ou execução v3 em produção.

## Entrega

- `condicao` passa a ser um passo de primeira classe, com portas `sim` e `nao`;
- `encerrar` representa um término explícito e não possui saída;
- transferência humana permanece terminal;
- transferência para IA declara `sucesso` e `falha`, preparando a suspensão e
  retomada que será implementada no runtime;
- expressões condicionais aceitam grupos `e` e `ou` aninhados e continuam
  lendo a lista legada como um grupo `e`;
- o canvas v3 aceita bifurcação e convergência, exige todas as portas declaradas,
  rejeita ciclos e blocos inalcançáveis;
- canvas v1 e v2 continuam legíveis e preservam o término implícito do caminho;
- a validação do documento limita expressões a 8 níveis e 100 itens e também
  verifica as referências de etiquetas dentro de condições aninhadas.

## Limite da fatia

`VERSAO_CANVAS` continua em 2. A versão 3 está reconhecida pelo domínio por uma
constante separada, mas o editor ainda não cria nem publica esse formato. Isso
impede que um fluxo ramificado seja salvo antes de o runtime saber executá-lo.

## Prova

O desenvolvimento seguiu RED → GREEN. Os testes novos cobrem avaliação E/OU,
compatibilidade da lista legada, portas por tipo, bifurcação com convergência,
porta ausente, término explícito e validação completa do documento v3.

Comando executado:

```text
npm run test:app
```

Resultado observado: 50 arquivos e 590 testes aprovados.

## Próxima fatia

A FASE 3 implementa um único executor de grafo para os providers local e remoto:
ele avalia `condicao`, escolhe `sim` ou `nao`, percorre convergências e persiste a
suspensão/retomada da transferência para IA. O formato v3 só será liberado ao
editor depois dessa prova.
