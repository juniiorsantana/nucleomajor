# Estado atual

Última revisão documental: **28/08/2026**.

## Produção confirmada

- Portal público em `nucleomajor.com` e aplicação web em `/app`.
- Supabase como fonte operacional de verdade, com Auth, organizações e RLS
  multiempresa.
- CRM, tarefas, Agenda Major, equipe, conexões e Central de Inteligência no
  portal.
- Runtime contínuo exclusivamente na VPS; o WSL local permanece desativado.
- WhatsApp principal da Major no número final `8362`.
- Júnior e Lucas verificados como operadores pessoais.
- Bridge, assistente, WhatsApp e MCP ativos na VPS.
- Consulta e criação confirmada de eventos por operadores.
- Skills oficiais versionadas e roteamento contextual H.3 disponíveis.
- Repositório privado do runtime disponível no GitHub, branch `hardening`.

Skills conferidas no Supabase em 28/08/2026:

- `agenda` v4 · `bad26124f521`;
- `pre-qualificacao` v3 · `ce02e9fb83a6`;
- `recepcao` v1 · `205e418dca0c`;
- `solicitacao-agenda` v1 · `716f673fbc9d`;
- `suporte` v3 · `7d87526e2f78`;
- `tarefas` v2 · `36327474cacf`;
- `vendas` v3 · `9ee6e4a1ac4a`.

## Versões implantadas

- Portal em produção antes da H.5: `048ee48` na branch `main`.
- Portal H.5 publicado na branch `main`; commit operacional `618b623` e
  registro de implantação `e64000f`. O endereço público respondeu `HTTP 200`
  após o disparo automático da Hostinger.
- Runtime H.5 da VPS: `461ca8a` na branch `hardening`, implantado em 28/08/2026.
- Bridge e assistente permaneceram ativos depois da implantação; a sessão do
  WhatsApp não foi recriada.
- O runtime aceita o formato atual de refresh token do Supabase e protege a
  renovação concorrente da credencial técnica.
- Logs novos do Bridge não registram conteúdo, nome ou telefone completo das
  conversas.

## Banco aplicado

- Ferramenta interna de tarefas aplicada.
- Piloto externo H aplicado.
- Agenda externa com aprovação H.4 aplicada.
- Prontidão do runtime H.4 aplicada.
- Consulta segura de disponibilidade externa aplicada.
- Proteção de eventos pessoais aplicada.
- Migration H.5 de prontidão do modelo aplicada em 28/08/2026.

As migrations continuam versionadas no repositório para permitir a criação de
ambientes novos e recuperação de desastre.

## Tarefas internas

- Skill `Tarefas` e ferramentas MCP para consultar, preparar e confirmar a
  criação estão implementadas no runtime.
- A criação exige operador verificado, confirmação explícita e idempotência.
- Falha de tarefa não pode ser substituída por nota, evento ou arquivo Markdown.
- Falta concluir o aceite operacional pelo WhatsApp com Júnior e Lucas.

## Proteção de eventos pessoais

- Evento pessoal pode ser alterado ou excluído somente pelo profissional
  responsável.
- Dono e administrador continuam gerenciando eventos corporativos, mas não
  podem trocar categoria, horário, visibilidade ou promover o evento pessoal de
  outra pessoa para evento da empresa.
- Colegas visualizam somente a indisponibilidade e o responsável, sem categoria,
  contato, local, descrição, tags ou lembretes.
- Migration `20260828170000_restringir_eventos_pessoais.sql`: **aplicada no
  Supabase em 28/08/2026**.

## Piloto externo e agenda aprovada

- Modos do assistente externo: Desligado, Piloto e Ativo.
- Fila humana disponível em Chatbots → Atendimentos.
- Skills separadas: `agenda` é interna e `solicitacao-agenda` é externa.
- Cliente externo não possui ferramenta de criação direta de evento.
- Após confirmação do cliente, o sistema cria somente uma reserva provisória.
- Donos e administradores verificados podem aprovar ou recusar pelo WhatsApp ou
  pelo portal; a primeira decisão válida vence.
- O trabalhador de notificações possui credencial própria e restrita.
- O assistente iniciou com:
  - `agenda_notifications_enabled: true`;
  - `agenda_notifications_dry_run: true`.

### Decisão operacional registrada

Em **28/08/2026**, foi decidido manter as notificações da agenda externa em
**modo de simulação**. Portanto, os avisos reais de solicitação, aprovação,
recusa e confirmação pelo WhatsApp ainda não serão enviados. A ativação real
será feita posteriormente, alterando o modo de simulação e reiniciando somente
o assistente, sem mexer na sessão do WhatsApp.

## Limitações e pendências conhecidas

- O limite de uso do Claude pode impedir respostas geradas pelo modelo, mesmo
  quando Bridge, WhatsApp, MCP e agenda estão saudáveis.
- A H.5 separa esse estado no contrato e no portal; migration, portal e runtime
  estão implantados. Falta provocar um sucesso ou erro real do modelo e
  conferir a atualização desse estado no painel.
- O piloto externo ainda não deve ser aberto para clientes reais.
- Falta validar a ferramenta de tarefas de ponta a ponta na VPS.
- Falta validar conhecimento externo publicado em uma jornada real controlada.
- Falta ativar e testar as notificações reais da aprovação externa.
- A integração não oficial com WhatsApp pode exigir manutenção quando o
  WhatsApp Web mudar e possui risco operacional de bloqueio.
- A API Oficial do WhatsApp e o Google Calendar permanecem para etapas futuras.

## Próximo aceite recomendado

1. validar saudação, consulta de agenda, criação de evento e criação de tarefa
   pelos operadores Júnior e Lucas;
2. validar um documento interno e um externo sem vazamento entre públicos;
3. cadastrar um contato controlado para o modo Piloto;
4. testar Recepção, qualificação, CRM e transferência humana;
5. quando decidido, retirar notificações do modo de simulação;
6. testar reserva provisória, aprovação, recusa, expiração e aviso ao cliente;
7. executar dez jornadas controladas durante 48 horas;
8. somente então avaliar a mudança do piloto para o modo Ativo.

O registro das dez jornadas fica em `docs/MVP-ACCEPTANCE-H5.md`.
