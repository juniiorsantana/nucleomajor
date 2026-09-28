# FASE 14 — Handoff entre agentes

- [x] 14A: contrato conferido contra RPC humana, sessões e allowlists.
- [x] 14B: RPC, coluna, testes estáticos e prova SQL com rollback.
- [x] 14B em produção: corpo aceito pelo hash `c5a77221e64b6be22720cc1800faf683`.
- [x] 14C: capacidade nas duas allowlists SQL, catálogo, MCP e worker; testes.
- [x] Executar cadeia em Postgres 17.9 descartável e comparar banco de controle.
- [x] Commit nos dois repositórios e conferir ancestralidade local/remota/VPS.
- [x] Aplicar 14B/14C pelo SQL Editor, conferir hashes e publicar as duas skills.
- [x] Publicar e validar o runtime na VPS (`0ae2b38`, ativo, zero reinícios).
- [ ] Observar WhatsApp real (aguardando token do Claude na terça), registrar STATUS e integrar main.

Concluída somente com banco, payload, runtime e skill em produção e handoff real.

Slug `sdr` e vínculos Recepção/Vendas confirmados pelo resultado do usuário:
Recepção prioridade 1000/fallback=true; Vendas prioridade 100 preservada.
As migrations foram aceitas pelos hashes normalizados e Recepção v2/Vendas v4
foram publicadas. As unidades reais foram identificadas no `systemd --user`; o
assistente e o bridge estão `active/running`, `NRestarts=0`, sobre a base
`0ae2b38` para o assistente. Falta a transferência real e integração Git.

Portal `9b2ef42` publicado em branch própria; runtime `0ae2b38` commitado, com
bundle local. A revisão automática recusou o push do runtime para o remoto SSH;
é necessária liberação explícita antes de repetir essa publicação.
