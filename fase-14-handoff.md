# FASE 14 — Handoff entre agentes

- [x] 14A: contrato conferido contra RPC humana, sessões e allowlists.
- [x] 14B: RPC, coluna, testes estáticos e prova SQL com rollback.
- [x] 14C: capacidade nas duas allowlists SQL, catálogo, MCP e worker; testes.
- [x] Executar cadeia em Postgres 17.9 descartável e comparar banco de controle.
- [x] Commit nos dois repositórios e conferir ancestralidade local/remota/VPS.
- [ ] Aplicar pelo SQL Editor e conferir hashes normalizados; publicar skill/runtime.
- [ ] Observar WhatsApp real, registrar STATUS e integrar main.

Concluída somente com banco, payload, runtime e skill em produção e handoff real.

Slug `sdr` e vínculos Recepção/Vendas confirmados pelo resultado do usuário:
Recepção prioridade 1000/fallback=true; Vendas prioridade 100 preservada.
Faltam as migrations pelo SQL Editor manual e identificar unidades reais na VPS
(consulta atual retornou zero). Apenas a configuração dos vínculos foi aplicada.

Portal `9b2ef42` publicado em branch própria; runtime `0ae2b38` commitado, com
bundle local. A revisão automática recusou o push do runtime para o remoto SSH;
é necessária liberação explícita antes de repetir essa publicação.
