# Estado atual

Última revisão documental: **29/08/2026**.

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

Skills conferidas no Supabase em 29/08/2026:

- `agenda` v5 · `b12fd526d039`;
- `pre-qualificacao` v3 · `ce02e9fb83a6`;
- `recepcao` v1 · `205e418dca0c`;
- `solicitacao-agenda` v1 · `716f673fbc9d`;
- `suporte` v3 · `7d87526e2f78`;
- `tarefas` v3 · `982acb24fd28`;
- `vendas` v3 · `9ee6e4a1ac4a`.

`agenda` e `tarefas` subiram de versão em 29/08/2026 para receber
`knowledge.search`. Sem ela, as duas únicas skills internas não podiam
consultar a base de conhecimento, e um operador verificado que perguntasse
sobre a empresa pelo WhatsApp recebia que o assistente não consegue acessar o
conhecimento. O lado interno continua sem skill de fallback.

## Versões implantadas

- Portal em produção antes da H.5: `048ee48` na branch `main`.
- Portal H.5 publicado na branch `main`; commit operacional `618b623` e
  registro de implantação `e64000f`. O endereço público respondeu `HTTP 200`
  após o disparo automático da Hostinger.
- Runtime da VPS: `92d3217` na branch `hardening`, mais a entrada de cliente no
  Bridge (`customer_inbound` e janela de resposta), implantada em 30/08/2026.
  O registro anterior dizia `461ca8a`; a VPS já estava um commit à frente.
  `327a77b` continua **não** implantado.
- Bridge e assistente permaneceram ativos depois da implantação; a sessão do
  WhatsApp não foi recriada.
- O runtime aceita o formato atual de refresh token do Supabase e protege a
  renovação concorrente da credencial técnica.
- Logs novos do Bridge não registram conteúdo, nome ou telefone completo das
  conversas.
- Correção do caminho do conhecimento publicada na `main` em 29/08/2026:
  `8cf75d9`. Inclui a migration corretiva e a exibição da falha de gravação
  dentro do assistente.

## Banco aplicado

- Ferramenta interna de tarefas aplicada.
- Piloto externo H aplicado.
- Agenda externa com aprovação H.4 aplicada.
- Prontidão do runtime H.4 aplicada.
- Consulta segura de disponibilidade externa aplicada.
- Proteção de eventos pessoais aplicada.
- Migration H.5 de prontidão do modelo aplicada em 28/08/2026.
- Prévia de busca do conhecimento e publicação atômica aplicadas: a RPC
  `nucleo_knowledge_save` responde em produção.
- `20260829150000_corrigir_regex_do_caminho_do_conhecimento.sql` aplicada em
  29/08/2026 e conferida por `pg_get_constraintdef`.
- `20260829120000_perfil_pessoal.sql` aplicada em 29/08/2026.
- `20260829170000_conhecimento_externo_visivel_para_equipe.sql` aplicada em
  29/08/2026 e conferida por `pg_proc.prosrc`: os dois leitores internos
  ampliados, o ramo do cliente intacto.
- `20260829190000_topicos_realtime_do_piloto.sql` aplicada em 30/08/2026 e
  conferida por `pg_get_constraintdef`: uma única constraint de check na tabela,
  `portal_realtime_events_topico`, com os quatro tópicos que os gatilhos
  realmente emitem.
- `20260830060000_ferramentas_de_solicitacao_de_agenda.sql` aplicada em
  30/08/2026: a validação de skill da `_v2` passou a aceitar
  `calendar.request.prepare` e `calendar.request.submit`.
- `20260830070000_operador_opcional_no_contexto.sql` aplicada em 30/08/2026:
  `nucleo_operator_context` devolve vazio para não-operador em vez de levantar.
  Conferida pelo atendimento externo respondendo de ponta a ponta.

As migrations continuam versionadas no repositório para permitir a criação de
ambientes novos e recuperação de desastre.

O histórico remoto **não** está íntegro: `supabase migration list --linked`
registra somente até `20260819180000`, porque o restante foi aplicado pelo SQL
Editor. Não execute `supabase db push`. O procedimento e a reconciliação estão
em [`DEPLOYMENT.md`](DEPLOYMENT.md).

### Correção do caminho do conhecimento

`20260823010000` declarou os dois checks de `knowledge_documents.path` com duas
barras invertidas. Com `standard_conforming_strings = on`, o motor de regex lê
`\\` como uma barra invertida literal, e não como um ponto escapado:

- o check de extensão passou a exigir `\` antes de `.md` e **nenhum documento
  jamais pôde ser gravado** — `select count(*)` devolveu 0 em 29/08/2026;
- o check de travessia procurava `\` onde procurava `.` e `..`, nunca casava, e
  a negação era sempre verdadeira: a guarda contra `../` existia no arquivo e
  não existia no banco.

O primeiro encobria o segundo. Os dois foram corrigidos na mesma transação e
voltaram com nome próprio, `knowledge_documents_path_extensao` e
`knowledge_documents_path_travessia`.

### Conteúdo publicado para clientes vale também para a equipe

Havia assimetria entre os dois leitores internos: o assistente do portal lia
interno e externo publicado, e o operador no WhatsApp lia só interno. A tabela
de preços publicada para clientes aparecia para quem perguntasse pelo portal e
sumia para quem atendesse pelo celular.

Desde 29/08/2026, `external` significa "também visível para clientes", e não
"deixou de ser da equipe". O ramo do cliente não mudou: continua exigindo
`audience = 'external'`, coleção externa ativa e, quando a coleção é de
campanha, vínculo com a campanha do contexto.

Consequência prática: **não duplique documento por audiência**. Um documento
externo publicado já é lido pelos dois públicos. As duas cópias de "Sobre a
empresa" que existem hoje são anteriores a esta migration.

### Tópicos do canal de tempo real do portal

`20260823030000` criou `portal_realtime_events.topic` com a lista fechada
`('connections', 'operators')`. `20260826150000` (piloto externo H) pendurou
mais dois gatilhos na mesma função `private.portal_realtime_notify`, passando
`'intelligence'` e `'handoffs'`, e não ampliou a lista.

Nada no banco liga o argumento do gatilho ao check da coluna. E como os
gatilhos são `after insert or update or delete`, o insert do aviso acontece
dentro da transação de quem escreveu na tabela de origem: a violação **derruba
a escrita original**, não só o aviso. Selecionar um contato no modo piloto
falhava com `violates check constraint "portal_realtime_events_topic_check"` —
e a linha citada no erro nunca foi a que o portal tentou gravar. Abrir e fechar
atendimento humano (`customer_handoff_requests`) estava quebrado pelo mesmo
motivo, sem que ninguém tivesse chegado nesse fluxo.

Desde 30/08/2026 o check aceita os quatro tópicos e tem nome próprio,
`portal_realtime_events_topico`. Constraint anônima é o que torna a mensagem de
erro ilegível: `_topic_check` é numeração por ordem de declaração, não nome.

**Ao criar um gatilho novo de `portal_realtime_notify`, amplie o check na mesma
migration.** `supabase/test_portal_realtime_topics_migration.py` cruza os dois
lados e falha se divergirem.

### Atendimento a cliente: três defeitos empilhados

Em 30/08/2026 o piloto externo respondeu pela primeira vez. Até ali ele nunca
tinha funcionado — nem uma vez, desde que a fase H existe. Eram três defeitos
em série, e cada um escondia o seguinte:

1. **`shouldNotify`, no Bridge**, recusava toda mensagem de quem não fosse dono
   ou operador. A seleção de contatos do painel nunca teve efeito: a mensagem
   era gravada e a conversa encerrava ali, sem erro e sem log. Corrigido com
   `assistant.customer_inbound` e a janela de resposta por conversa — ver a
   seção 9 do `HARDENING.md` no runtime.
2. **A lista de ferramentas de `nucleo_intelligence_context_resolve_v2`** não
   incluía `calendar.request.*`, que a H.4 deu à skill `solicitacao-agenda`.
3. **`nucleo_operator_context` levantava exceção** para quem não fosse
   operador, onde os resolvedores de contexto esperavam zero linhas. Este é o
   mais antigo e o que de fato quebrava todo turno de cliente.

Duas lições que ficaram no repositório como teste, não como texto:
`test/skill-tools-whitelist.test.mjs` cruza a lista de ferramentas do SQL com o
catálogo canônico, e `test/operator-context-optional.test.mjs` exige que todo
chamador de `nucleo_operator_context` tenha a própria guarda `if not found`.

**Pendência conhecida:** `operator_verification.py:406`, no runtime, descarta o
corpo da resposta quando o Supabase devolve 4xx e registra apenas
`"Supabase recusou <rótulo>"`. O texto real do Postgres —
`sender is not a verified operator for this connection` — esteve disponível
desde o começo e nunca chegou a nenhum log. Foi o que fez o diagnóstico custar
três rodadas de tentativa e erro.

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
