# Analisar conversa (fase 5 do Coordenador Jev)

O dono ou um admin abre a ficha de uma conversa direta e pede uma análise
**comercial** ou **de atendimento**. Quem analisa é o **Agente Analista**: o
Claude, na VPS, numa **segunda conta** da Major, separada da conta que
atende os clientes. O Jev continua fazendo a leitura automática de toda
conversa (fase 1), e essa leitura entra na análise como contexto.

## Como funciona

```
ficha (portal) ── conversation_analysis_request ──► banco: confere crédito,
                                                    monta a carga, põe na fila
VPS: executor de comandos ── conversation_analyze ─► fila do Agente Analista
Agente Analista ── Claude (2ª conta, sem ferramentas) ── nucleo_analysis_record ─► banco
ficha ── conversation_analysis_status (a cada 4 s) ──► resultado
```

- **Carga:** as últimas 80 mensagens (até 1.500 caracteres cada), a leitura do
  Jev em vigor, o playbook publicado, o nome e o tom do agente, as etapas do
  funil, as etiquetas e se o contato está no CRM.
- **Resultado:** resumo, indicadores, "por quê" com a mensagem que comprova,
  o que faltou, o próximo passo e até 4 sugestões (etapa, etiqueta, tarefa,
  compromisso). A VPS confere o formato e corta o que não existe na empresa.
- **Sugestões:** cada uma tem um botão "Aplicar", que usa as mesmas operações
  das outras telas (`negocios.atualizar`, etiquetas, `tarefas.criar`,
  `agenda.criar`). Nada é aplicado sozinho.
- **Salvar na ficha:** a análise salva aparece para toda a equipe e não
  expira. O rascunho (não salvo) é só do dono e dos admins e perde o conteúdo
  em 7 dias.

## Créditos

| Plano | Análises por ciclo |
|---|---|
| Base | 30 |
| Atendimento | 100 |
| Completo / Full | 200 |

- O ciclo renova no **dia da assinatura** (`organization_subscriptions.started_at`),
  à meia-noite de Brasília. Assinatura no dia 31 renova no último dia dos
  meses mais curtos.
- O painel da plataforma ajusta o limite por empresa (`analysis_credits`);
  limite nulo é ilimitado.
- **Falha não consome crédito**: conta não logada, fila cheia, limite do
  Claude, resposta torta ou pedido parado por mais de 15 minutos.
- Dois cliques no mesmo minuto devolvem o mesmo pedido.

## Onde está

| Parte | Arquivo |
|---|---|
| Banco | `supabase/migrations/20261002100000_analisar_conversa.sql` |
| Prova no PGlite | `scripts/sql/prova-analisar-conversa.mjs` (35 verificações) |
| Runtime | `patches/runtime-analisar-conversa.patch` e o `-DEPLOY.md` |
| Regras da tela | `apps/emyleads/src/domain/analiseDaConversa.js` |
| Tela | `apps/emyleads/src/page/telas/conversas/AnaliseDaConversa.jsx` |
| Operações | `conversas.creditosDeAnalise`, `pedirAnalise`, `analise`, `salvarAnalise`, `analises` em `web/conversasProvider.js` |

## Para ligar

1. Aplicar a migration pelo SQL Editor.
2. Logar a segunda conta do Claude em `~/.config/claude/analise` na VPS.
3. Publicar a release `analisar-conversa` com `NUCLEO_ANALYSIS=1` e
   `NUCLEO_ANALYSIS_CLAUDE_CONFIG_DIR` no ambiente da Major (ver o DEPLOY).
4. Merge do PR (o portal só mostra o botão quando a migration existe).

Sem a etapa 2, o botão funciona, mas toda análise falha com "A conta de
análise ainda não foi conectada na VPS" e o crédito volta. A análise **nunca**
usa a conta do atendimento.
