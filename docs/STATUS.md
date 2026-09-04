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
- Espelho de conversas (`84781dc` na `hardening`) implantado em 02/09/2026, de
  forma cirúrgica: só `conversation_sync.py`, seu teste, `config.py`,
  `main.py`, `operator_verification.py` e a documentação de ambiente. A
  extração do pacote inteiro **não** foi feita de propósito — `worker.py` e
  `whatsapp-mcp-server/nucleo.py` carregam, em produção, alterações que não
  estão em nenhum commit (avisos de falha reescritos; `_safe_error_detail` na
  auditoria de ferramentas), e o pacote as teria apagado. Backup em
  `~/backups/pre-conversation-sync-20260902-212401`. Por isso `327a77b`
  continua não implantado.
- As duas alterações que só existiam na VPS foram recuperadas para o
  repositório em 02/09/2026 (`2808f6e` na `hardening`), com teste para a parte
  da auditoria, que tinha chegado sem nenhum. O `worker.py` entrou por merge de
  três vias para não reverter `327a77b`. Consequência: o repositório agora está
  **à frente** de produção nesse arquivo, e o próximo deploy dele leva junto o
  bloco de expediente do `327a77b` — o que é o desejado, mas não é silencioso.
- Leva 2 das Conversas (`a48e1e2` e `56d5f5d` na `hardening`) implantada em
  03/09/2026, de novo de forma cirúrgica: só `chat_identity.py` (novo),
  `conversation_sync.py`, `runtime_commands.py`, `main.py` e os dois testes.
  Antes de copiar, os cinco arquivos existentes em produção foram conferidos
  por hash contra os commits candidatos e batiam todos com `2808f6e` — nenhuma
  edição manual de produção nos arquivos tocados. Backup em
  `~/backups/pre-conversas-leva2-20260903-083108`. `worker.py` e
  `whatsapp-mcp-server/nucleo.py` **não** foram tocados. Suíte na VPS com o
  Python do serviço: 353 testes, verde. O Bridge não foi reiniciado — segue de
  pé desde 30/08/2026.
- Suíte do assistente na VPS: 332 testes, tudo verde, com o Python do serviço.
  `check-runtime.sh` limpo, `NRestarts=0`, portas ainda só em loopback (8080 e
  8090). O Bridge não foi reiniciado.
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
- `20260902120000_conversas_espelhadas_do_bridge.sql` aplicada em 02/09/2026 e
  conferida por consulta ao catálogo: RLS ligada nas duas tabelas, uma única
  policy de `select` em cada e `authenticated` sem nenhum grant de escrita — quem
  grava é a RPC `nucleo_conversation_sync`, `security definer` com
  `search_path=""`. O check `portal_realtime_events_topico` continua sendo a
  única constraint de check da tabela, agora com os cinco tópicos, e o gatilho
  `whatsapp_conversations_portal_realtime` ficou só em `whatsapp_conversations`,
  a tabela da lista.

- `20260902200000_conversas_escrita_grupos_e_nomes.sql` aplicada em 03/09/2026 e
  conferida por consulta ao catálogo: o check estrito de `contact_phone` caiu
  nas duas tabelas e sobrou **um** por tabela, com o regex novo
  (`^[0-9][0-9-]{5,39}$`); `connection_runtime_commands_command_type_check`
  passou a listar os cinco tipos; `chat_kind`, `attendant_id` e
  `attendant_name` existem; e `nucleo_conversation_command_enqueue` e
  `nucleo_conversation_command_status` existem, `security definer` com
  `search_path=""`. Nenhuma tabela nova e nenhuma policy de escrita — quem
  escreve continua sendo RPC.

- `20260903190000_agenda_e_tarefas_da_equipe.sql` aplicada em 03/09/2026 e
  conferida por consulta ao catálogo. Antes de aplicar, o corpo em produção
  de `calendar_context` e `calendar_events_list` foi comparado com o do
  repositório: as duas apareceram maiores em produção — 2684 contra 2617 e
  3249 contra 3164 —, e a diferença era **só CRLF**, uma quebra a mais por
  linha, do arquivo que subiu pelo SQL Editor a partir do Windows.
  Normalizando, o texto é idêntico: nada foi editado direto em produção e o
  `create or replace` não apagou medida nenhuma.

  Depois de aplicar: `task_assignees` existe com RLS ligada e uma policy
  (`task_assignees_all`, `for all`); o backfill gravou 3 linhas e **nenhuma**
  tarefa viva ficou sem responsável; `calendar_events_insert` não menciona
  mais `can_manage_org` e segue exigindo `created_by = auth.uid()`;
  `calendar_events_update` e `_delete` passaram a aceitar
  `created_by = auth.uid() or can_manage_org`, e `personal` continua pareado
  apenas com `owner_id = auth.uid()` — cargo gerencial segue sem tocar em
  evento pessoal alheio. `calendar_events_list` devolve `assignee_ids uuid[]`
  por `left join lateral`, e as três tarefas existentes voltam com exatamente
  um responsável cada. `calendar_context` devolve `color`. As duas seguem
  `security definer` com `search_path=""`.

  `calendar_events_list` foi recriada (o tipo de retorno mudou) e nasceu com
  `anon=EXECUTE`, como `calendar_context`, `calendar_preferences_update` e
  `nucleo_conversation_sync` — é o padrão do projeto descrito logo abaixo, e
  não algo que esta migration concedeu. A guarda continua no corpo:
  `private.is_org_member` levanta antes de qualquer trabalho.

  A migration **não** foi registrada em `supabase_migrations.schema_migrations`:
  o histórico remoto já estava incompleto desde `20260819180000`, e reconciliar
  uma linha de mais de trinta faria `db push` parecer viável quando não é.

- `20260903210000_aviso_de_atribuicao_de_tarefa.sql` **escrita e ainda não
  aplicada** em 03/09/2026. Colocar alguém numa tarefa passa a avisar essa
  pessoa, e ela assume ou recusa.

  O que ela conserta antes de acrescentar qualquer coisa: o índice único de
  `calendar_reminders` era `(task_id, channel, remind_at)`, **sem o dono**, e
  `private.task_reschedule_reminders` só enfileirava para
  `coalesce(owner_id, created_by)`. Ou seja: depois de `20260903190000`, uma
  tarefa de três responsáveis lembrava **um**, e os outros dois nem
  caberiam na tabela. O índice passa a incluir `owner_id` e `kind`.

  O que ela acrescenta: `task_assignees` ganha `notified_at`, `accepted_at`,
  `declined_at` e `decline_reason`; `calendar_reminders` ganha `kind`
  (`reminder` ou `assignment`), porque um aviso de atribuição não tem
  horário para anunciar; gatilhos em `task_assignees` avisam quem entrou —
  nunca quem escreveu, e nunca duas vezes a mesma pessoa; e
  `public.task_assignment_respond` deixa **só** quem foi colocado responder
  por si (`auth.uid()`), sem apagar o vínculo ao recusar.

  Tudo que já existia entra como assumido. Ninguém foi perguntado, e marcar
  as tarefas de ontem como pendentes ensinaria a equipe a ignorar a pílula
  antes de ela significar alguma coisa.

  Comportamento verificado em produção em 03/09/2026 com escrita real
  revertida (bloco `do` que termina em `raise exception`, o que desfaz tudo e
  devolve o relatório na mensagem de erro; conferido depois: 3 vínculos, 3
  assumidos, 28 lembretes, **0** avisos de atribuição — nada sobrou). Os cinco
  invariantes bateram: colocar outra pessoa gera 1 aviso com `notified_at`
  preenchido e `accepted_at` vazio; colocar a si mesmo gera 0 e já consta como
  assumido; sair cancela o aviso ainda não entregue; voltar reavisa; e **quem
  já viu não é reavisado** quando a lista é regravada.

  Esse último merece atenção de quem for mexer. A guarda dentro do gatilho só
  protege quem insere sem apagar antes — apagar cancela o aviso, e a
  reinserção passaria direto por ela. Quem fecha o furo é o provider, que
  grava a diferença. E o corte cai no lugar certo porque o cancelamento só
  alcança `pending`, `processing` e `failed`: um aviso já `sent` sobrevive e
  bloqueia a repetição. Incluir `sent` no cancelamento faria a equipe receber
  a mesma mensagem a cada ida e volta.

  Cuidado com `now()` ao escrever teste: é o horário da TRANSAÇÃO, não do
  comando, então todo aviso criado no mesmo bloco nasce com o mesmo
  `remind_at` e o índice único os trata como o mesmo aviso.

  **A ordem importa no canal de WhatsApp.**
  `notification_worker_claim_reminders` passou a devolver `kind` no fim do
  retorno, mas quem redige a mensagem é o `whatsapp-assistant` na VPS, que
  ainda não olha esse campo. Hoje isso não causa dano porque **zero membros
  verificaram telefone** (`calendar_member_preferences`: 3 com `in_app`, 0
  com `whatsapp`), então nenhuma linha de canal `whatsapp` chega a existir.
  Verificar telefone antes de o worker aprender `kind` é o que faria a
  primeira mensagem sair redigida como lembrete — e, em tarefa sem
  vencimento, anunciando como prazo o instante do enfileiramento.

As migrations continuam versionadas no repositório para permitir a criação de
ambientes novos e recuperação de desastre.

### Observação sobre `anon` nas RPCs

Todas as funções `nucleo_*` aparecem no catálogo com `anon=X` — herança do
privilégio padrão que o Supabase aplica a função nova em `public`, e não algo
que uma migration específica tenha concedido: `revoke ... from public` não
remove uma concessão explícita a `anon`. Não é brecha em nenhuma delas, porque
a guarda está no corpo (`auth.uid() is null` levanta antes de qualquer
trabalho), mas é um padrão do projeto inteiro, e não uma decisão por função.
Revogar `anon` em bloco é decisão pendente, e vale para as ~30 funções, não só
para as duas da Leva 2.

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

- `20260904160000_identidade_do_agente_em_assistant_profiles.sql` aplicada em
  04/09/2026 (FASE B de `docs/intelligence/MULTI-AGENT-MIGRATION.md`) e
  conferida por consulta ao catálogo, não pela mensagem de sucesso:
  `assistant_profiles` ganhou `slug` (`not null`), `role` e `soul_markdown`
  (ambas nullable); `unique (organization_id, audience)` continua existindo e
  `is_default` continua não existindo — as duas coisas checadas por
  `pg_constraint`/`pg_attribute`. Os 2 perfis existentes receberam slug pelo
  backfill, nenhum ficou nulo, e `slug = private.agent_slug(display_name,
  audience)` vale para 100% das linhas. `role` e `soul_markdown` seguem NULL em
  todos: nada foi preenchido artificialmente. Zero colisões
  `(organization_id, slug)` — é o dado que a FASE C precisava para decidir se
  pode impor `unique (organization_id, slug)`; pode.

  Duas coisas que a aplicação ensinou. A primeira: o bloco de garantias da
  migration comparava `array_agg(attname)` (`name[]`) com um array de
  literais (`text[]`), o que o Postgres recusa — descoberto ao rodar a mesma
  lógica no pré-check, antes de aplicar, e corrigido com cast explícito. A
  segunda: a equivalência entre a regra de slug em JavaScript
  (`slugFromAgentName`) e em SQL (`private.agent_slug`) foi provada **no banco
  de destino, em read-only**, antes de qualquer DDL — 11 de 11 casos do corpus
  canônico, incluindo acento, cedilha, til e os dois de fallback.

  `private.provision_intelligence` insere perfil sem informar slug, então o
  gatilho `assistant_profiles_fill_slug` (BEFORE INSERT FOR EACH ROW,
  conferido por `pg_get_triggerdef`) é o que torna `slug not null` seguro para
  organização nova. Isso foi verificado por introspecção; nenhuma organização
  de teste foi criada em produção.

  O backfill é um `UPDATE`, então os dois gatilhos que já existiam na tabela
  dispararam: `updated_at` subiu nos 2 perfis e `intelligence_audit_log`
  ganhou 2 linhas `profile`/`update`. Esperado e inofensivo, mas fica
  registrado para quem for ler a auditoria depois e estranhar duas edições de
  perfil em 04/09 que ninguém fez pela tela.

  Não registrada em `supabase_migrations.schema_migrations` — segue o mesmo
  estado das demais desde `20260821120000`.

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

## Conversas: o que a Leva 2 mudou, com números

Implantada em 03/09/2026. Três medições feitas contra o SQLite do Bridge em
produção, sobre 169 conversas, explicam por que cada parte existe:

- **94 eram grupos**, e nenhuma chegava ao portal — a Leva 1 os recusava pelo
  check do identificador. Uma caixa de entrada que esconde 56% do que chega não
  é uma caixa de entrada. Entra o grupo e entra o nome dele; não entra quem
  falou dentro dele, que exigiria guardar identidade de terceiro.
- **69 chegavam por `<número>@lid`.** LID é identificador interno do WhatsApp,
  não telefone: o espelho subia um número que não é de ninguém, que nunca
  casava com contato do CRM e que a tela ainda formatava como telefone. Agora
  `whatsmeow_lid_map` (6341 pares) traduz.
- **65 das 75 individuais tinham `chats.name` igual ao próprio número.** O
  Bridge grava o nome uma vez e `GetChatName` retorna cedo para sempre, então o
  número carimbado antes de a agenda do WhatsApp sincronizar nunca mais era
  revisitado. `whatsmeow_contacts` (1966 contatos, 1340 com `push_name`)
  responde. Depois do deploy: **1** conversa individual ainda mostra número.

Escrever passou pela fila que já existia (`connection_runtime_commands`), com
dois tipos novos. Nenhuma porta nova na VPS, e `ASSISTANT_HOST` segue em
127.0.0.1.

### O ciclo do espelho levava 134 segundos

Descoberto ao medir o deploy, e anterior a ele. `SQL_CONVERSAS` perguntava
quatro coisas por conversa, cada uma varrendo `messages` inteira — a tabela do
Bridge não tem índice por `chat_jid` nem por `timestamp`. Com 75 conversas já
custava perto de um minuto por ciclo, num ciclo de 15 segundos, e ninguém tinha
medido; o grupo dobrou a lista e tornou o custo visível. Nada falhava: só
demorava, e o trabalhador só registra falha. Reescrita em passadas, caiu para
**0,2s** com resultado idêntico.

### As duas portas de envio do Bridge

Corrigido em 03/09/2026, no mesmo dia em que a Leva 2 subiu. Durante algumas
horas, responder pelo portal só alcançava os quatro números de
`allowed_recipients` e quem tivesse escrito nos últimos 15 minutos; o resto da
caixa de entrada devolvia 403.

Isso era uma confusão entre dois assuntos:

- **quem o AGENTE pode procurar sozinho.** É para isso que
  `allowed_recipients`, `allow_unlisted` e a janela de resposta existem, e
  continuam valendo integralmente em `/api/send` — nada mudou aí, e o modo
  piloto do assistente externo não foi tocado;
- **quem uma PESSOA pode responder.** Quem abriu a conversa, digitou e clicou
  em enviar já decidiu. Barrá-la não protege ninguém: ela responderia pelo
  celular um minuto depois, e a única consequência real era a caixa de entrada
  do portal não servir para atender.

Agora são duas portas. `POST /api/send/human`, com bearer próprio
(`WHATSAPP_HUMAN_SEND_TOKEN`), não consulta `allowed_recipients` e alcança
qualquer conversa e qualquer grupo. Mesmo desenho de `/api/notify`, que já
existia pela mesma razão. Sem o token configurado, a rota nem é registrada.

O que segura a porta nova: o bearer não é o que o agente usa (ele fala com o
Bridge pelo MCP, com o token genérico — conferido em produção: o token genérico
recebe **401** nessa rota); o bloqueio por identidade divergente continua
valendo; e, do lado do Supabase, a RPC só enfileira comando para conversa que
já existe no espelho e só para membro ativo da organização.

Essa última guarda é a estreita, e mora de propósito na camada barata de mudar.
Quando o portal ganhar "nova conversa", mudam a RPC e o portal — não o binário
do Bridge, cuja recompilação derruba o canal do WhatsApp.

O deploy do Bridge custou **menos de um segundo** de canal fora do ar:
reconectou pela sessão já pareada, sem QR. Binário anterior preservado em
`~/backups/bridge-pre-envio-manual-20260903-095014` e em
`whatsapp-bridge/whatsapp-bridge.anterior`.

**Atenção ao toolchain de Go.** O binário de produção foi compilado com
`go1.26.5`, de `/usr/local/go`, que é o que está no PATH do serviço — e não com
o `go1.25.14` de `~/.local/go`. `go.mod` pede `go 1.25.0`, então os dois
compilam, mas trocar a versão do binário de produção sem querer é o tipo de
diferença que só aparece depois. Compile com `/usr/local/go/bin/go` e confira
com `go version -m` antes de trocar.

### Limpeza única das linhas órfãs

Traduzir o LID mudou a chave natural de 69 conversas, e as linhas antigas
viraram cópias congeladas que nunca mais seriam atualizadas. Antes de apagá-las
a marca d'água do sincronizador foi recuada para 04/08/2026, para a história
voltar sob a chave certa — o que é inócuo, porque a RPC é idempotente pela
chave natural. Resultado: 15.112 mensagens republicadas, depois 69 conversas e
1404 mensagens órfãs removidas. Estado final: 165 conversas (71 diretas, 94
grupos), zero órfãs.

**O espelho não poda conversa que sumiu da origem.** A sincronia é `upsert` sem
`delete`, e o teto de 200 conversas por ciclo impede a regra óbvia ("apague o
que não veio neste lote") de ser segura. Hoje isso só importa quando a chave
natural muda, que foi o caso desta vez e foi resolvido à mão. Fica registrado
como pendência.

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
- O espelho de conversas não poda linha órfã; ver a seção de Conversas.
- A extensão não sincroniza `task_assignees`: uma tarefa criada por ela leva
  para o Supabase apenas `owner_label`, como já acontecia com `owner_id`. Uma
  tarefa com vários responsáveis criada no portal continua correta; criada na
  extensão, chega ao banco sem responsável nenhum e a agenda a atribui a quem
  a criou. A lista de colunas de `data/remoteProvider.js` é onde isso se
  resolve, e é trabalho de outra leva.
- A caixa de avisos do portal é **puxada, não empurrada**:
  `calendar_notifications_list` só marca o aviso como entregue quando a
  pessoa abre o painel da Agenda. Enquanto o WhatsApp não estiver ligado,
  quem não abrir o portal não fica sabendo de nada.
- O `whatsapp-assistant` da VPS precisa aprender `kind` para redigir aviso
  de atribuição diferente de lembrete. Só depois disso vale verificar os
  telefones da equipe na Agenda.
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
