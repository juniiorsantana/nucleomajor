# Equipe de IA

A antiga "Central de Inteligência" virou **Equipe de IA** em 01/10/2026: o
agente no centro, o playbook comercial da empresa e o Jev olhando cada agente.
Contexto: `docs/coordenador-jev/PLANO.md` (o coordenador) e
`docs/playbook/PLANO.md` (o plano do playbook).

## O que mudou na tela

| Antes | Depois |
|---|---|
| Menu "Inteligência" | Menu **"Equipe de IA"** |
| Abas Agentes, Conhecimento, Habilidades, Histórico, Simulador, Liberação e marca | **Agentes · Playbook comercial · Biblioteca · Histórico** |
| "Agente principal" | **Porta de entrada** (o mesmo `is_default`, só o nome mudou) |
| Agente com Geral, Personalidade, O que sabe fazer | **Jeito · Playbook · Habilidades · Conhecimento · Quem atende · Testar · Desempenho** |
| Liberação e marca numa aba própria | Aba **Quem atende** da porta de entrada (mesmas operações de antes) |
| Simulador solto | Aba **Testar**, já no público do agente, com a **avaliação do Jev** |
| Conhecimento e Habilidades em abas separadas | **Biblioteca**, com as duas |

## Os quatro usos do Jev desta entrega

1. **Avaliação no Testar.** O dono escreve uma conversa de teste
   (`Cliente:` / `Empresa:`); o portal enfileira `insights_evaluate`, a VPS
   pergunta ao Jev e devolve. Mostra se seguiu o jeito do agente, o playbook e
   como foi o atendimento. Nada sai no WhatsApp, o texto não fica guardado.
2. **Desempenho do agente.** Últimos 30 dias de leituras em vigor: pergunta
   sem resposta, próximo passo, promessa pendente, jeito, insatisfação, pedido
   de pessoa, temperatura e quem atendeu (IA, equipe, os dois). Leituras sem
   agente (de antes desta entrega) contam para a porta de entrada de clientes.
3. **"Seguiu o jeito do agente?"** A linha `tone` do agente vira pergunta do
   Jev em toda leitura das conversas dele.
4. **Sinais para o playbook.** A tela do playbook mostra as objeções que mais
   aparecem nas leituras (com "Acrescentar" para as que faltam) e as conversas
   cuja objeção caiu em "outra".

## Peças

| Onde | O quê |
|---|---|
| `supabase/migrations/20261001100000_equipe_de_ia_playbook_e_jev.sql` | playbook (rascunho, versões, `playbook_save`), agente e autores nas leituras, `insights_evaluate` |
| `scripts/sql/prova-equipe-de-ia.mjs` | prova em PGlite: 32 PASS |
| `patches/runtime-equipe-de-ia.patch` + `-DEPLOY.md` | o runtime: perguntas montadas com playbook e jeito, autores, comando de avaliação |
| `apps/emyleads/src/domain/equipeDeIa.js` | regras da tela (modelos, validação igual à do banco, desempenho, sinais) |
| `apps/emyleads/src/page/telas/equipe/` | `PlaybookComercial.jsx` e as abas novas do agente |

## O que ainda não faz

- O playbook ainda **não entra nas respostas do agente**: hoje ele guia as
  leituras do Jev. Levar para o prompt do agente é a próxima etapa do plano do
  playbook.
- Nenhuma ação sozinha (etiqueta, tarefa, aviso) a partir dos sinais.
- O agente de uma conversa é achado pelo contexto do contato (8 últimos
  dígitos do telefone) ou, sem contexto, é a porta de entrada.
