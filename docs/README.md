# Documentação do Núcleo Major

Este diretório é a fonte canônica da documentação do produto. Um documento
deve descrever o comportamento atual; propostas futuras devem ser registradas
como ADR ou identificadas explicitamente como planejadas.

## Leitura por objetivo

### Entender o produto

- [Estado atual](STATUS.md)
- [SPEC do produto](specs/SPEC-PRODUCT.md)
- [Arquitetura](specs/SPEC-ARCHITECTURE.md)
- [Glossário](GLOSSARY.md)
- [Mapa de domínio e responsabilidades](DOMAIN-MAP.md)
- [Mapa de fluxos operacionais](FLOW-MAP.md)
- [Auditoria de terminologia e contratos](TERMINOLOGY-AUDIT.md)

### Trabalhar em um componente

- [Portal e API Node.js](specs/SPEC-PORTAL-API.md)
- [Extensão Chrome](specs/SPEC-EXTENSION.md)
- [Supabase e segurança de dados](specs/SPEC-DATA-SECURITY.md)
- [Central de Inteligência](specs/SPEC-INTELLIGENCE.md)
- [Piloto externo](specs/SPEC-EXTERNAL-PILOT.md)
- Runtime WhatsApp/VPS: `07 - Projetos Internos/whatsapp-mcp-hardened/docs/SPEC-RUNTIME.md`

### Desenvolver e operar

- [Ambiente de desenvolvimento](DEVELOPMENT.md)
- [Estratégia de testes](TESTING.md)
- [Implantação](DEPLOYMENT.md)
- [Runbook operacional](RUNBOOK.md)
- [Contribuição](../CONTRIBUTING.md)
- [Segurança](../SECURITY.md)

### Decisões

- [Índice de ADRs](adr/README.md)
- [ADR-0001 — Supabase como fonte de verdade](adr/ADR-0001-SUPABASE-SOURCE-OF-TRUTH.md)
- [ADR-0002 — Runtime único na VPS](adr/ADR-0002-VPS-RUNTIME.md)
- [ADR-0003 — Extensão opcional](adr/ADR-0003-OPTIONAL-EXTENSION.md)
- [ADR-0004 — Liberação externa controlada](adr/ADR-0004-CUSTOMER-ROLLOUT.md)
- [ADR-0005 — Conexão como unidade operacional](adr/ADR-0005-WHATSAPP-CONNECTIONS.md)

## Regras de manutenção

1. Mudança de comportamento exige atualização do SPEC correspondente.
2. Mudança de implantação exige atualização de `DEPLOYMENT.md` e do runbook.
3. Decisão arquitetural duradoura exige ADR.
4. Segredos, telefones completos e dados de clientes nunca entram em exemplos.
5. `STATUS.md` registra o que está realmente implantado, não apenas commitado.
6. Links devem ser relativos para continuarem válidos em branches e forks.
