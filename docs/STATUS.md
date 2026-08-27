# Estado atual

Última revisão documental: **27/08/2026**.

## Produção confirmada

- Portal público em `nucleomajor.com`.
- Aplicação web em `/app`, com Auth e organizações do Supabase.
- CRM, tarefas, Agenda Major, equipe, conexões e Central de Inteligência.
- Supabase como fonte operacional de verdade e RLS multiempresa.
- Runtime contínuo na VPS; WSL não deve executar Bridge ou assistente.
- WhatsApp principal da Major no número final `8362`.
- Júnior e Lucas verificados como operadores pessoais.
- Consulta e criação confirmada de eventos por operadores.
- Skills oficiais publicadas e roteamento contextual H.3 disponível.

## Ferramenta interna de tarefas

- Migration `20260827130000_ferramenta_tarefas_operador.sql`: pronta no repositório; confirmar aplicação no ambiente alvo.
- Skill oficial `Tarefas`: versionada nos arquivos do catálogo.
- MCP e runtime: consultar, preparar e confirmar criação implementados localmente.
- Publicação da skill e implantação do runtime na VPS: pendentes.

## Fase H — piloto externo

- Migration `20260826150000_fase_h_piloto_externo.sql`: **aplicada**.
- Portal com modos Desligado, Piloto e Ativo: commit `065cde6`, enviado à `main`.
- Fila humana em Chatbots → Atendimentos: incluída no mesmo commit.
- Runtime com gate de piloto e comandos de handoff: commit local `2c04e75`.
- Implantação do commit `2c04e75` na VPS: **pendente**.
- Piloto externo: deve permanecer **Desligado** até a implantação do runtime.

## Fase H.4 — agenda externa com aprovação

- Skills separadas: `agenda` é interna e `solicitacao-agenda` é externa.
- Confirmação do cliente cria apenas um bloqueio provisório `tentative`.
- Donos e administradores verificados recebem comandos determinísticos de aprovação.
- A primeira decisão válida converte o mesmo evento ou cancela a reserva.
- Portal Agenda possui a área **Solicitações** para aprovar, recusar e consultar histórico.
- Trabalhador da VPS entrega avisos com idempotência e sem usar o modelo para redigir.
- Painel de Conexões separa agenda interna, aprovação externa, trabalhador e skill ativa.
- Implementação local e testes: concluídos.
- Migrations `20260827190000_fase_h4_agenda_externa_aprovacao.sql` e
  `20260827193000_fase_h4_prontidao_runtime.sql`: pendentes de aplicação.
- Publicação das skills e implantação do runtime/portal: pendentes.

## Limitações conhecidas

- A integração não oficial com WhatsApp possui risco de bloqueio e pode exigir
  manutenção quando o WhatsApp Web muda.
- A API Oficial do WhatsApp ainda não substitui o Bridge atual.
- Google Calendar está adiado.
- O runtime ainda não possui repositório remoto próprio.
- Testes SQL comportamentais completos exigem um Supabase/Postgres de teste;
  localmente são executados testes estáticos das migrations.

## Próximo aceite

1. aplicar as migrations de tarefas e H.4 na ordem dos arquivos;
2. publicar o catálogo de sete skills;
3. implantar portal e runtime sem reiniciar o Bridge;
4. selecionar um contato controlado no modo Piloto;
5. validar conhecimento externo, CRM, bloqueio, aprovação e aviso ao cliente;
6. validar recusa, expiração, falha de entrega e handoff;
7. executar dez jornadas durante 48 horas;
8. somente então avaliar o modo Ativo.
