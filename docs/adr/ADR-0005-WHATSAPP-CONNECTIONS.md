# ADR-0005 — Conexão como unidade operacional do WhatsApp

Estado: aceito em agosto de 2026.

## Contexto

Número, navegador e processo não representam sozinhos a integração. Uma
organização pode mudar de host, usar sessão humana e Bridge e futuramente usar
API Oficial sem perder identidade e histórico.

## Decisão

`whatsapp_connections` é a unidade operacional. Sessões, instalações, hosts,
credenciais e eventos apontam para `connection_id` e `organization_id`.

## Consequências

- uma identidade verificada não fica ativa em duas organizações;
- uma sessão Bridge ativa existe por conexão;
- credenciais são escopadas por conexão e instalação;
- transferência entre organizações revoga estado da origem;
- heartbeat e units usam o mesmo `connection_id`;
- a futura API Oficial deve implementar o mesmo contrato.

## Alternativas rejeitadas

- usar telefone como chave: expõe dado e não representa host/sessão;
- usar processo como chave: perde identidade a cada implantação;
- token global do gateway: permite atravessar conexões indevidamente.
