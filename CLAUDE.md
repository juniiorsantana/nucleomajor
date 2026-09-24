# Núcleo Major / EmyLeads: ponto de partida comum

Este arquivo é o começo de qualquer sessão, de qualquer IA (Claude Code, Codex
ou outra) e de qualquer pessoa nova. Ele diz **o que é o projeto, as regras que
não se quebram, onde está cada coisa e em que pé está o trabalho**. O detalhe
fica nos documentos apontados aqui; em caso de conflito, `AGENTS.md` e o SPEC do
componente valem mais que este resumo.

**Atualizado em 24/09/2026.** O estado muda todo dia: antes de agir, rode
`git fetch`, `git status`, `git log -5 origin/main` e confira o que está em
produção. Não confie numa data escrita aqui mais do que no repositório.

---

## 1. O que é

Portal multiempresa da Núcleo Major (marca do produto: EmyLeads): CRM (leads,
funil, tarefas, agenda), conversas de WhatsApp, chatbots com construtor de
fluxos e agentes de IA que atendem clientes e a equipe.

```
navegador ── portal React (apps/emyleads) ── Supabase (Postgres + RLS + RPCs)
                                                   ▲
VPS ── runtime Python + Bridge Go (whatsmeow) ─────┘   ← repo PRIVADO separado
        (WhatsApp, executor de fluxos, agentes)          (whatsapp-mcp-hardened)
```

O portal fala **só com o Supabase**. Quem fala com o WhatsApp é a VPS.

| Endereço | O que é |
|---|---|
| `nucleomajor.com` | landing e página de planos |
| `nucleomajor.com/app` | portal (Hostinger, deploy automático no push para `main`) |
| `painel.nucleomajor.com` | painel da plataforma (a Major administra as empresas) |
| Supabase `lwoqcvuspsmfowiuipmv` | projeto "EmyLeads" |

## 2. Regras que não se quebram

Vêm de `AGENTS.md`, `docs/DEPLOYMENT.md` e de decisões do dono.

1. **Migrations de produção: só pelo SQL Editor do Supabase**, uma por vez.
   Nunca `supabase db push`, porque o histórico remoto está incompleto e o
   push reaplicaria dezenas de migrations. O CLI serve para **inspecionar**
   (`supabase db query --linked` com SELECT), não para aplicar.
   Antes de aplicar: ensaie a migration com `raise exception` no fim (o erro
   garante o rollback) e confira os pré-requisitos no catálogo. Depois,
   confira o **efeito** por consulta, nunca pela mensagem de sucesso, e
   registre em `docs/STATUS.md`, na seção "Banco aplicado".
2. **Nada de WSL.** Windows/PowerShell no local, SSH para a VPS
   (`-i ~/.ssh/nucleo_major_vps_ed25519`). Não rode cópias locais do runtime
   de WhatsApp para atender conversas reais.
3. **A VPS tem código fora do git.** Deploy é por release e symlink; antes de
   trocar uma release, confira o que está rodando (`/proc/<pid>/exe` contra o
   symlink). Divergência não autoriza sobrescrever.
4. **O working tree principal costuma ter trabalho alheio não commitado.**
   Nunca `git add -A` nem `commit -a`: adicione arquivo por arquivo e confira
   `git diff --cached --name-only`. Trabalhe numa **worktree** a partir de
   `origin/main` (`git worktree add -b <branch> .worktrees/<nome> origin/main`).
5. **Publicar é merge em `main`**, e merge em `main` é deploy do portal. Abra
   PR; faça merge só com o dono de acordo. Nunca `force push` em `main`.
6. **Migration nova ganha número depois da última da `main`.** Duas
   frentes trabalhando ao mesmo tempo já geraram número repetido
   (`20260926150000`); confira `ls supabase/migrations | tail` na `main`
   atualizada antes de nomear.
7. Não afrouxar RLS ou grants como atalho. Função `security definer` sempre
   com `set search_path = ''`.
8. Texto no banco é CRLF quando veio do SQL Editor no Windows: normalize
   (`tr -d '\r'`) antes de comparar corpo de função do repo com o de produção.

## 3. Vocabulário (use estas palavras com este sentido)

- **Contato:** qualquer pessoa no CRM (`contacts`). O chatbot, a IA e o
  interruptor "não atender IA" criam contatos sozinhos.
- **Lead:** contato que alguém **criou ou transformou em lead**
  (`contacts.lead_at` não nulo). O negócio novo, a IA quando qualifica
  (`qualified`) e o formulário do site também marcam lead.
- **Negócio:** oportunidade no Funil (`deals`). **Só existe para lead**; o
  banco promove o contato a lead quando nasce um negócio para ele.
- **Etapas padrão do Funil:** Lead → Em contato → Qualificação → Proposta →
  Negociação → Fechado.
- **Planos:** Base (R$ 97, chatbot e fluxos sem IA), Atendimento com IA e
  acima. Funções e limites vêm do plano, com ajustes por empresa pelo painel.
- **Fluxo v3:** fluxo do construtor com caminhos, perguntas, gatilhos e
  espera; roda no executor da VPS, que só é ligado por conexão
  (`NUCLEO_FLOW_RUNTIME=1`).

## 4. Onde está cada coisa

| Área | Caminho |
|---|---|
| Telas do portal | `apps/emyleads/src/page/telas/` (menu e rotas em `page/Gestao.jsx` e `web/main.jsx`) |
| Acesso ao banco pelo portal | `apps/emyleads/src/web/dataProvider.js` e demais `web/*Provider.js` |
| Regras de domínio | `apps/emyleads/src/domain/` (`lead.js`, `chatbots.js`, `fluxoNoServidor.js`...) |
| Relatórios (contas testáveis) | `apps/emyleads/src/page/telas/relatorios/metricas.js` |
| Painel da plataforma | `apps/emyleads/src/painel/` |
| Inteligência (agentes, skills, tools) | `packages/intelligence/` |
| Migrations | `supabase/migrations/` |
| Estado de produção e histórico | `docs/STATUS.md` |
| Deploy e operação | `docs/DEPLOYMENT.md`, `docs/RUNBOOK.md` |
| Roteiros de entrega | `docs/checkout/`, `docs/painel/`, `patches/*-DEPLOY.md` |
| Multi-agent (histórico até 05/09) | `docs/HANDOFF-CODEX.md`, `docs/intelligence/` |

Documentos de planejamento que ficam **fora do git**, só na máquina do dono,
na raiz: `plano-construtor-de-fluxos.md` (as 11 etapas dos fluxos, com
checklists), `plano-tres-planos-e-ia.md` e `plano-painel-da-plataforma.md`.
Outra IA sem acesso a essa máquina não os vê; o essencial está resumido na
seção 5.

## 5. Estado em 24/09/2026

### Banco de produção

Em dia com a `main`: todas as migrations de `20260920100000` a
`20260926160000` estão aplicadas e conferidas, mais `20260926170000` (lead),
que está no PR #2.

### Entregue e no ar (23 e 24/09)

- **Funções e limites por empresa** e **painel da plataforma**
  (`painel.nucleomajor.com`): trava em todas as telas por função.
- **Construtor de fluxos (etapas 1, 2, 5, 6, 7 e 8):** editor v3 com
  caminhos, condição por dia e horário, perguntas (escolher/digitar),
  gatilhos (palavra, manual, campanha), bloco **Aguardar**; o plano Base roda
  fluxo sem IA; o contato desconhecido vira contato ao entrar no fluxo.
  Release ativa da VPS: `fluxos-aguardar`.
- **Landing** vendendo o Núcleo Major, com planos e popup para o WhatsApp.
- **Funil em kanban de arrastar** e a tela Contatos renomeada para "Leads".
- **Realtime do portal:** avisos só quando a linha muda de verdade (sem o
  ruído de `updated_at` e `last_used_at`).
- **Portal volta a abrir** quando os dados ainda não carregaram.

### Pronto, esperando merge: PR #2 (`feat/leads-e-metricas`)

- **Lead como marca do contato** (migration `20260926170000`, já aplicada):
  `lead_at`, `closed_at`, `deal_stage_history`, triggers; etapas "Lead" e
  "Em contato".
- **Tela Relatórios:** período (mês, 15/30/60/90 dias, ano, de/até), cartões
  com comparação, funil da safra, leads por mês, mês a mês, por origem,
  motivos de perda, lista de leads e CSV.
- **Leads:** seletor "Leads | Todos os contatos"; "Marcar como lead" na
  conversa e na ficha; aviso ao criar negócio para quem não é lead;
  cartões do Funil por período.
- Depois do merge e do deploy (~10 min), falta **conferir no navegador com
  os dados reais**: foi testado por testes e build, e os Relatórios com
  dados sintéticos.

## 6. O que está aberto, em ordem

**Bloqueia cliente novo**
1. **SMTP próprio no Supabase (P0).** Hoje saem 2 e-mails de autenticação por
   hora no projeto inteiro. Ver `docs/checkout/MELHORIAS-ATIVACAO-E-EMAILS.md`.
2. **Tela travada depois de confirmar o e-mail (P1)** e **e-mails
   personalizados em português (P1)**, no mesmo documento.

**Fechar o que foi entregue**
3. Merge do PR #2 e a conferência com dados reais.
4. **Fluxos, etapa 3:** as seis jornadas reais no WhatsApp da Major e 48h de
   observação (`chatbot_flow_executions` sem `flow.poll_failed`).
5. **Fluxos, etapa 5:** o teste ao vivo na conexão da Adriani (plano Base),
   que ainda não tem fluxo criado.
6. **Push da branch do runtime** para o GitHub (repo privado): as releases da
   VPS estão à frente do remoto.

**Próximas construções**
7. **Fluxos, etapa 4:** "Status esperando" (depende de existir estado de
   conversa) e o fuso da organização guardado no banco. **Etapas 9 a 11**
   ainda não iniciadas (ver o plano, fora do git).
8. **Prazo nas liberações manuais de plano (P2).**
9. **Contato na primeira mensagem**, para contar pessoas novas nos
   Relatórios. Riscos: as conversas antigas que entram no pareamento e os
   números que chegam sob LID.
10. **Multi-agent:** agente não padrão de teste (12D), depois Agent Router (13).
    Ver `docs/HANDOFF-CODEX.md`, seção 9.

**Conhecidos, sem dono**
- Mensagens de um contato sob LID (44202585) caem em `ignored_no_trigger`.
- A conexão 8362 tem dono padrão `ia`: só conversa com dono `bot` entra no
  executor de fluxos.
- Revogar `anon` das ~30 funções expostas (`docs/STATUS.md`).

## 7. Como trabalhar

```bash
npm test                      # servidor (node --test) + app (vitest); roda build:web antes
npm run test:app              # só o app
npm run build:web             # gera public/app
```

- Teste junto do código: `*.test.js(x)` ao lado da tela ou do módulo.
- Commits em português, no estilo do histórico (`feat:`, `fix:`, `docs:`,
  `feat(db):`), com a frase dizendo o que muda para quem usa.
- Mudou algo em produção? Registre em `docs/STATUS.md` no mesmo PR.
- Ao terminar uma frente, atualize a seção 5 e a 6 deste arquivo.
