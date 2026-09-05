# Handoff — EmyLeads / Central de Inteligência multi-agent

Atualizado em 05/09/2026 após a consolidação da 12C.1.8. Branch atual:
`consolidacao/fase-12-sobre-main`, worktree em
`.worktrees/nucleomajor-fase-12-consolidacao`, HEAD `63192d7`. **Rode
`git status` e `git log -3` antes de qualquer coisa** — não assuma que este
hash continua sendo o HEAD.

## O que mudou desde a versão anterior deste handoff

Havia dois branches divergentes resolvendo o mesmo problema de forma
independente: `identidade-e-padrao-do-agente` (local, preservado em
`backup/identidade-e-padrao-do-agente-1516c74`) e `origin/main` — que já
tinha as FASES C–F aplicadas em produção e sua própria Central de Agents.
**`origin/main` venceu como base**; deste branch só foi trazido, de forma
seletiva:

- título "Seus agentes" → **"Sua equipe de IA"** e subtítulo → "Cada agente
  atende um público certo e possui responsabilidades específicas" (só texto,
  em `Agents.jsx`, testes atualizados junto);
- o redesenho completo do **Conhecimento** (`Conhecimento.jsx`,
  `ListaConhecimento.jsx`, `EditorDocumento.jsx`, remoção de
  `ResumoConhecimento.jsx`);
- `docs/design/central-premium/` como referência visual.

**Não foi portado** `telas/inteligencia/Agentes.jsx` do branch antigo — ele
usava `.find()` por audience e voltaria a mostrar 1 agente por público,
incompatível com a FASE E (N agentes por audience). A tela de Agents, o
wizard de criação, os providers e o domínio são os de `origin/main`,
intocados.

Verificado após a consolidação: 48 arquivos / 571 testes vitest verdes
(`npm run test:app`), `build:web` verde.

## 1. O que é o EmyLeads

Portal multiempresa (CRM + Agenda + WhatsApp) da Núcleo Major. Objetivo da
arquitetura multi-agent: uma organização hoje pode ter **N agentes** por
público (cliente / equipe interna), cada um com identidade, personalidade,
skills, canais e permissões próprias — isso já está implementado (FASE E).

## 2. Arquitetura (poucas linhas)

```
Supabase/Postgres (assistant_profiles, RPCs nucleo_*)
        → Intelligence Resolver (SQL: intelligence_payload, resolve_v3)
        → runtime Python na VPS (repo PRIVADO separado, branch `hardening`
          — não está neste repositório)
        → MCP / Tools (Tool Registry valida o que cada skill pode chamar)
        → WhatsApp (bridge Go não oficial, whatsmeow)
```

O portal web (este repo) fala com o Supabase diretamente; não fala com a VPS.

## 3/4. Pastas principais e onde fica cada coisa

| Área | Caminho |
|---|---|
| Domínio do Agent (`AgentDefinition`, adapter) | `packages/intelligence/src/agent.mjs` |
| Domínio de agentes do frontend (presets, avatar) | `apps/emyleads/src/domain/agents.js` |
| Skills (catálogo versionado) | `packages/intelligence/skills/{agenda,pre-qualificacao,recepcao,solicitacao-agenda,suporte,tarefas,vendas}/` |
| Tool Registry | `packages/intelligence/src/tools.mjs` (fonte canônica) + `packages/intelligence/src/catalog.mjs` + `packages/intelligence/skills/skill.schema.json` |
| Resolvers (SQL) | `supabase/migrations/20260904230000_resolvers_usam_agente_padrao.sql` (FASE D), `20260905000000_a_audience_deixa_de_limitar_a_um_agente.sql` (FASE E) |
| Resolvers (Node) | `src/intelligenceContext.mjs`, `src/intelligenceResolver.mjs`, `packages/intelligence/src/resolver-port.mjs` |
| Contratos de request/resolution | `packages/intelligence/src/contracts/` |
| Frontend — Central de Inteligência | `apps/emyleads/src/page/telas/Inteligencia.jsx` (abas: agents/knowledge/assistants/skills/campaigns/simulator/history) |
| Frontend — **Agents** (a tela real, com wizard) | `apps/emyleads/src/page/telas/Agents.jsx` + `Agents.test.jsx` + `Agents.interactive.test.jsx` |
| Frontend — Conhecimento (redesenhado na 12C.1.8) | `apps/emyleads/src/page/telas/Conhecimento.jsx`, `apps/emyleads/src/page/telas/conhecimento/{ListaConhecimento,EditorDocumento}.jsx` |
| Providers/operations | `apps/emyleads/src/web/intelligenceProvider.js`, `apps/emyleads/src/web/operations.js` |
| Migrations | `supabase/migrations/` — **nunca** `supabase db push` (histórico remoto incompleto, ver `docs/DEPLOYMENT.md`) |
| Testes JS/domínio | `test/agent-*.test.mjs`, `test/intelligence-*.test.mjs`, `test/tool-registry.test.mjs`, `apps/emyleads/src/**/*.test.{js,jsx}` |
| Testes de migration (Python, contra Postgres real) | `supabase/test_*.py` |
| Docs de referência | `docs/intelligence/MULTI-AGENT-MIGRATION.md` (histórico completo A–F), `docs/intelligence/TOOL-REGISTRY.md`, `docs/STATUS.md` |

## 5. Já implementado (e aplicado em produção)

- `AgentDefinition`, `slug`/`role`/`soul_markdown`/`is_default` em
  `assistant_profiles` (FASES B–C).
- Resolvedores legados usando o agente padrão em vez de `limit 1` sem ordem
  (FASE D).
- `unique (organization_id, audience)` removida — **N agentes reais por
  público** (FASE E).
- Gestão de agentes: criar, trocar padrão como ato único e atômico, proteger
  campos estruturais (FASE F).
- Central de Inteligência com a tela **Agents**: wizard de criação em 5
  telas, avatar por iniciais, "Sua equipe de IA", agrupado por público,
  padrão sempre primeiro.
- Conhecimento redesenhado: colunas de metadado colapsadas, sem
  cartões-filtro duplicados, aside em "Mais opções".

## 6. Estado de produção

- Assistente **Major** = agente padrão (`is_default`) do público **cliente**.
- **Núcleo Major** / assistente interno = agente padrão do público **equipe**.
- Schema já suporta N agentes por público (FASE E aplicada), mas **ainda não
  existe Agent Router** — o runtime continua resolvendo pelo Default Agent.
  Criar um segundo agente hoje não muda quem responde no WhatsApp.

## 7. Regras que NÃO podem ser quebradas

- **Soul ≠ Skills ≠ Tools ≠ Permissions ≠ Knowledge** — camadas diferentes,
  não misture.
- Nunca promover um agente a `is_default` automaticamente — só ato explícito.
- Desligar o padrão **não** pode selecionar outro agente em silêncio; o
  resolvedor deve recusar, nunca escolher por conta própria.
- Não afrouxar RLS/grants como atalho.
- Frontend não mexe em API/RPC/schema, e vice-versa.
- Não mexer no legado (`Assistente.jsx`, `SimulatorLegacy`, aba "Liberação e
  marca") sem auditoria prévia.

## 8. Onde o Codex pode ajudar

Implementação isolada e delimitada, testes, QA, investigação/reprodução de
bug, frontend, refactors com escopo fechado, observabilidade, fixtures,
revisão de diff. Evitar decisão de arquitetura/produto sem confirmar antes.

## 9. Próximas fases

1. **12D** — criar 1 Agent adicional **não-default**, de teste, e validar
   ponta a ponta (o schema já suporta; falta provar na prática).
2. **13** — Agent Router.
3. **14** — Handoff entre agentes.
4. **15** — Contexto multi-agent.
5. **16** — Tools + Permission Engine.
6. **17** — Knowledge por Agent.
7. **18** — Observabilidade.

## 10. Disciplina de Git

- Sempre `git branch --show-current`, `git status`, `git log -3` e comparar
  com `origin/main` antes de tocar em código.
- Este trabalho está num **worktree**, não no checkout principal do
  repositório — `git worktree list` mostra todos.
- `identidade-e-padrao-do-agente` está **superado** por este branch; seu
  ponto final continua preservado em
  `backup/identidade-e-padrao-do-agente-1516c74` até ser arquivado.
- `consolidacao/fase-12-sobre-main` ainda **não foi enviado a `origin`** nem
  mesclado em `main` — confirme com o usuário antes de fazer push ou abrir PR.
- Nunca `force push` em `main`. Nunca `supabase db push`.
