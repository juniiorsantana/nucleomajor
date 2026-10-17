# Integração do runtime com fluxos duráveis

## Objetivo

Preparar, sem deploy, o patch do runtime `0ae2b38` para consumir as RPCs
`nucleo_flow_*`, preservando o executor legado para canvas v1/v2.

## Tarefas

- [x] Confirmar HEAD, árvore limpa, units e serviços na VPS.
- [x] Copiar o código-fonte relevante para uma área temporária local.
- [x] Adicionar os oito métodos `nucleo_flow_*` ao cliente Supabase.
- [x] Executar canvas v3 por `start → claim → ack`, com recuperação por polling.
- [x] Finalizar suspensões após sucesso/falha da IA.
- [x] Cobrir compatibilidade legada, idempotência e retomada com testes.
- [x] Gerar patch aplicável sobre `0ae2b38` e instruções de deploy manual.

## Pronto quando

- [x] A suíte Python do assistente passa sem acessar produção (99 testes).
- [x] Nenhum arquivo da VPS foi alterado e nenhum serviço foi reiniciado.
- [x] O patch contém somente os sete arquivos necessários à integração.
