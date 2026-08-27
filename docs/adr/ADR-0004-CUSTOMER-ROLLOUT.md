# ADR-0004 — Rollout controlado do atendimento externo

Estado: aceito em 26/08/2026.

## Contexto

Ativar atendimento para todos antes de validar conhecimento, skills, CRM,
agenda e handoff poderia responder clientes reais de forma incorreta.

## Decisão

O perfil externo possui modos Desligado, Piloto e Ativo. O modo Piloto exige
contatos do CRM selecionados por administrador. A VPS consulta uma RPC estreita
antes de entregar a mensagem ao chatbot ou ao assistente.

## Consequências

- contato não selecionado é ignorado;
- operador verificado continua no fluxo interno;
- falha do gate bloqueia atendimento externo;
- chatbot faz transferência silenciosa para a Recepção;
- modo Ativo só é permitido depois do aceite de 48 horas.

## Alternativas rejeitadas

- allowlist em arquivo da VPS: não multiempresa e difícil de auditar;
- prompt instruindo “responda apenas testes”: sem garantia de segurança;
- ativação geral com monitoramento: impacto real antes da validação.
