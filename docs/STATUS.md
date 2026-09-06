# Estado atual

## FASE 14 — banco e skills publicados; runtime e prova real pendentes (06/09/2026)

Branches isoladas `feature/fase-14-handoff` no portal e no runtime. A base do
portal é `60c90ab`, igual a `origin/main` consultada nesta execução. A base do
runtime é `da11193`: checkout local, `hardening` da VPS e referência remota
consultada por SSH conferem. O remoto HTTPS do runtime recusou acesso; a leitura
da referência por SSH na VPS funcionou. Nenhum commit anterior foi descartado.

Commits de implementação: portal **`9b2ef42`** (branch publicada no origin) e
runtime **`0ae2b38`** (commit local e bundle preservado). A publicação da branch
do runtime via Git bare temporário foi **recusada pela revisão automática**:
classificou `git@github.com:juiiorsantana/whatsapp-mcp-hardened.git` como destino
não verificado por causa da falha anterior no HTTPS, apesar do `ls-remote` SSH
ter retornado `da11193` para hardening. Não houve tentativa de contornar a recusa.
Bundle local: `artifacts/fase-14/runtime.bundle`. A main e hardening seguem
sem a fase até concluir os aceites de produção.

- **14A:** [memorando do contrato](./intelligence/MULTI-AGENT-MIGRATION.md#fase-14a--contrato-de-handoff-entre-agentes).
  Slug validado na organização, motivos fechados, teto persistido de **3** saltos,
  sessão de skill fechada, skill ativa zerada e sessão do modelo descartada.
  Resumo opcional não é persistido/devolvido/auditado; contexto livre é FASE 15.
- **14B:** RPC `nucleo_customer_agent_handoff` e coluna `agent_handoff_count`.
  Prova em **PostgreSQL 17.9 descartável**, 57 migrations anteriores + 2 novas,
  **A–H e G2 PASS**, ROLLBACK sem resíduos e cluster removido.
- **14C:** capacidade própria no banco, catálogo, schema, runtime e MCP;
  evento `conversation.agent_handoff` só após sucesso técnico, sem resumo e sem
  acionar o árbitro humano. Recepção e Vendas declaram a capacidade por estágio.
  Vendas é necessária porque “quero fechar plano” já ativa essa skill.
- **Ajuste necessário ao plano:** v3 chama v2 antes da sua validação, portanto
  **as duas allowlists** recebem a string. Comparação integral dos corpos prova
  que nenhuma outra linha operacional foi alterada. Dos 143 corpos anteriores,
  só esses dois mudaram; o posterior tem 144 funções pela RPC nova.
  `intelligence_payload` permanece com hash normalizado
  `4ed9516507bcf8322f14e313fa08a94e`, idêntico à 13C.
- **Verificações executadas:** 237 testes Node; 578 testes do app, **49 arquivos**
  (incluindo jsdom); **374 testes do assistente**, incluindo a prova de dois turnos;
  50 testes MCP. Build Vite e compilação Python passaram.
  [Receita, evidências e hashes](../scripts/sql/README-prova-handoff-entre-agentes.md).
  [Consulta read-only de aceite](../scripts/sql/validar-fase-14.sql) executada no
  controle e no banco com a fase: quatro hashes aceitos no pós-check.

**Produção observada:** 14B aceita com hash
`c5a77221e64b6be22720cc1800faf683`; 14C aceita com v2
`cf6d7160329a589602d730412215c801` e v3
`f74eee42963ae1c1a0f033ce3905811b`; `intelligence_payload` permaneceu
`4ed9516507bcf8322f14e313fa08a94e`. Recepção foi publicada como v2,
hash `e5648acb6408...`, e Vendas como v4, hash `422df18a36b7...`.
Nova simulação confirmou ambas sem alteração.

**Não observado/não publicado:** runtime em serviço e transferência WhatsApp real.

**Pré-check de produção devolvido pelo usuário:** hashes de payload/v2/v3
conferem com os baselines provados; RPC e coluna da 14 ainda ausentes. Slug
`sdr` confirmado, ativo/customer na mesma organização do Assistente Major.
Recepção v1 e Vendas v3 continuam publicadas sem a capacidade nova. O SDR tem
**zero bindings de fallback**, contra um no Major: antes do handoff é necessário
preparar seu fallback para o turno seguinte. O resultado também mostra EXECUTE
para anon em v2/v3, diferente do cluster mínimo; a 14C preserva esses privilégios
existentes e continua exigindo credencial de robô. A RPC nova revoga anon/public.

[preparar-sdr-fase-14.sql](../scripts/sql/preparar-sdr-fase-14.sql) vincula apenas
Recepção e Vendas publicadas ao SDR confirmado, preservando prioridades/configuração
de bindings existentes. Script exato executado duas vezes em PostgreSQL 17.9
descartável: idempotência, resolução de Recepção e de Vendas pelo SDR e rollback
sem resíduos passaram. **Aplicação manual confirmada pelo resultado devolvido
pelo usuário:** Recepção habilitada, prioridade 1000, v1, fallback=true; Vendas
habilitada, prioridade **100 preservada do vínculo existente**, v3, fallback=false.
O SDR está preparado para resolver ambas. As migrations 14B e 14C foram
aplicadas e aceitas, e as duas skills foram publicadas.

O acesso do navegador ao SQL Editor foi **recusado pela revisão automática**,
que classificou a liberação de acesso a supabase.com como possível exposição da
sessão autenticada. Nenhum canal alternativo de aplicação foi usado.
Na VPS, `systemctl list-units --all 'whatsapp*'` e `list-unit-files 'whatsapp*'`
retornaram **zero unidades**; consultas aos nomes registrados anteriormente
indicaram `inactive`/`NRestarts=0`. Isso contradiz o estado observado na 13C e
precisa ser esclarecido antes de deploy. Nenhum serviço foi reiniciado.

**A fase permanece aberta.** Publicação do runtime, conferência
ActiveState/NRestarts, transferência real e integração da branch à main
continuam pendentes.

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

- `20260904190000_agente_padrao_explicito.sql` aplicada em 04/09/2026 (FASE C
  de `docs/intelligence/MULTI-AGENT-MIGRATION.md`) e conferida por consulta ao
  catálogo, não pela mensagem de sucesso: `assistant_profiles` ganhou
  `is_default boolean not null default false`. O `default false` é deliberado —
  agente novo nasce comum, e só vira padrão por promoção explícita; quem
  provisiona organização nova é `private.provision_intelligence`, redefinida
  aqui para inserir os dois perfis iniciais com `is_default = true`.
  Introspecção antes e depois: das cinco funções observadas, só a dela mudou
  (`md5(pg_get_functiondef)` `d7291b84…` → `d9449193…`), e a mudança são as
  duas colunas `is_default` nos inserts. Nenhuma organização de teste foi
  criada em produção para verificar isso.

  O backfill marcou `is_default = true` nos 2 perfis existentes — 2 de 2, zero
  perfis sem padrão. Ele só é correto porque todo perfil de hoje é o único da
  sua audience, e a migration **verifica essa premissa antes** em vez de supor:
  se houvesse mais de um perfil por `(organization_id, audience)`, ela levanta
  exceção em vez de marcar todo mundo como padrão em silêncio.

  Entraram duas garantias de unicidade. O índice **parcial**
  `assistant_profiles_one_default_idx` sobre `(organization_id, audience)`
  `where is_default` — parcial porque é o `where` que deixa N agentes
  não-padrão conviverem, e é ele que continuará valendo quando a FASE E
  remover a unique antiga. E `assistant_profiles_organization_slug_key` sobre
  `(organization_id, slug)`, que a FASE B tinha medido ser seguro impor: zero
  colisões, confirmado de novo no pré-check. Nada foi afrouxado —
  `unique (organization_id, audience)` **continua de pé** (é o que ainda impede
  dois agentes da mesma audience), e as 5 checks, 4 FKs e a PK da tabela
  seguem intactas.

  Nenhum resolvedor foi tocado, e isso é o ponto da fase: `is_default` existe
  no banco mas ninguém decide por ele ainda. `private.intelligence_payload`,
  `nucleo_intelligence_context_resolve_v2`, `resolve_v3` e
  `nucleo_customer_assistant_access` têm hash idêntico ao de antes da
  migration. Uma pegadinha para quem for conferir com `grep`:
  `intelligence_payload` casa com `is_default`, mas é `campaign.is_default` de
  `organization_campaigns`, coluna antiga e sem relação — o roteamento por
  agente padrão é a FASE D, inteira.

  Como na FASE B, o backfill é um `UPDATE` e os gatilhos da tabela dispararam:
  `updated_at` subiu nos 2 perfis e `intelligence_audit_log` ganhou 2 linhas
  `profile`/`update` sem ator (51 → 53). Esperado; não é edição feita por
  ninguém pela tela. Nenhum serviço de runtime foi reiniciado — migration de
  banco não exige isso nesta fase.

  Não registrada em `supabase_migrations.schema_migrations` — segue o mesmo
  estado das demais desde `20260821120000`.

- `20260904230000_resolvers_usam_agente_padrao.sql` aplicada em 04/09/2026
  (FASE D de `docs/intelligence/MULTI-AGENT-MIGRATION.md`) e conferida por
  introspecção do catálogo antes e depois, não pela mensagem de sucesso. Os
  resolvedores param de pegar "algum" perfil da audience e passam a pedir o
  **agente padrão**: `organização + audience + is_default = true`.

  Três funções mudaram, e só três. `md5(pg_get_functiondef)` antes → depois:
  `private.intelligence_payload` `a50d3dae…` → `7d026211…`;
  `public.nucleo_customer_assistant_access` `b78b130b…` → `7ac0a815…`;
  `public.nucleo_intelligence_context_resolve_v2` `59560191…` → `a1110719…`.
  Hash **idêntico**, como esperado, em `nucleo_intelligence_context_resolve_v3`
  (`e4aa5c0a…`), em `nucleo_intelligence_context_resolve` v1 (`afbe50a5…`) e em
  `private.provision_intelligence` (`d9449193…`, o mesmo que a FASE C deixou).
  O v3 não precisa mudar porque não escolhe agente: ele lê o
  `assistant_profile_id` que `intelligence_payload` grava a cada turno — uma
  semântica de padrão, não duas.

  O que muda de verdade é a **ordem**, e é o coração da fase. A seleção do
  agente deixou de filtrar `active` junto: ela pergunta só quem é o padrão, e o
  `active` virou checagem seguinte que **recusa**. Com um agente só isso é
  indistinguível; com dois, é a diferença entre "o padrão está parado, recuse"
  e "o padrão está parado, então fale pelo outro". Um agente não herda a
  conversa de outro por acidente de disponibilidade. Confirmado por
  introspecção do corpo aplicado: a seleção não casa mais
  `audience = target_audience and profile.active`, e o
  `if not selected_profile.active then raise exception` está lá.

  Falha fechado nos dois caminhos, com as strings públicas inalteradas:
  `intelligence_payload` levanta `assistant profile is inactive or unavailable`
  tanto para "não existe padrão" quanto para "o padrão está inativo", e
  `nucleo_customer_assistant_access` devolve `profile_inactive` nos mesmos dois
  casos. Nada virou erro genérico para simplificar SQL.

  Saiu o `limit 1` de onde escolhia agente. O índice parcial da FASE C
  (`assistant_profiles_one_default_idx`) já garante no máximo um padrão por
  `(organization_id, audience)`, então ele não protegia nada — escondia a
  ausência de critério. Sem ele, dois padrões fariam o `select into` falhar
  alto em vez de sortear. Os outros `limit 1` do arquivo continuam onde estão:
  escolhem skill e campanha, não agente.

  **Multi-agent continua não liberado.** `unique (organization_id, audience)`
  segue de pé, o índice parcial de padrão segue de pé,
  `assistant_profiles_organization_slug_key` segue de pé, e os 2 perfis
  continuam 2/2 padrão e 2/2 ativos. Nenhuma linha de `assistant_profiles` foi
  tocada: esta migration é só `CREATE OR REPLACE FUNCTION` (três) mais um bloco
  `DO` de asserção que lê o catálogo. Por isso, ao contrário das FASES B e C,
  ela **não** disparou gatilho nem escreveu em `intelligence_audit_log`.

  Os cenários de dois agentes — remover a unique antiga, criar agente
  adicional, desativar o padrão — foram provados em Postgres 17.6 descartável
  (`e3de9e2`) e **não** foram executados em produção, de propósito. Nenhum
  serviço de runtime foi reiniciado (`whatsapp-assistant`, `whatsapp-bridge`,
  VPS): função SQL é carregada pelo banco. `NUCLEO_INTELLIGENCE_ROUTING_MODE`
  não foi alterada.

  Ressalva honesta sobre a verificação: o health check **funcional** não foi
  executado. O único caminho de preview do produto,
  `public.intelligence_context_preview`, não é read-only — ela insere em
  `intelligence_simulations` e exige `auth.uid()` —, e o protocolo desta etapa
  proíbe rodar RPC com efeito colateral só para conferir. E não houve tráfego
  real entre a aplicação (23:11 UTC) e a conferência: o último turno de
  conversa ativa é de 22:43 UTC. Portanto **nada foi observado em produção sob
  carga**; o que sustenta esta fase é a introspecção acima mais a prova
  comportamental no banco descartável. As 5 conversas ativas seguem todas com
  `assistant_profile_id` preenchido (zero nulos).

  Não registrada em `supabase_migrations.schema_migrations` — segue o mesmo
  estado das demais desde `20260821120000`.

  Próxima fase: **E** (remover `unique (organization_id, audience)`), que ainda
  não começou.

- `20260905000000_a_audience_deixa_de_limitar_a_um_agente.sql` aplicada em
  05/09/2026 (FASE E de `docs/intelligence/MULTI-AGENT-MIGRATION.md`, 00:15
  UTC) e conferida por introspecção do catálogo antes e depois. **O banco passa
  a aceitar N agentes por audience**: `unique (organization_id, audience)` foi
  removida.

  O que passa a segurar a integridade no lugar dela: o índice parcial
  `assistant_profiles_one_default_idx` sobre `(organization_id, audience)`
  `where is_default`, que garante **no máximo um padrão** por audience — é o
  `where` que deixa N agentes comuns conviverem. Conferido presente depois do
  DROP, junto com `assistant_profiles_organization_slug_key` (a identidade
  estável de um agente dentro da organização, que com N agentes deixa de ser
  conveniência), a PK e `assistant_profiles_id_organization_id_key`. As 5
  checks, as 4 FKs, os 3 gatilhos e as 3 policies seguem intactos, e nenhuma
  policy passou a citar `audience` — RLS continua por organização.

  Só uma função mudou: `private.provision_intelligence`
  (`d9449193…` → `2ce57ef0…`). Era o bloqueador registrado desde a FASE C: seus
  dois `on conflict (organization_id, audience)` apontavam para o índice que o
  DROP removeu, e sem a reescrita **criar organização passaria a falhar**.
  Agora eles inferem o índice parcial (`where is_default`), o que continua
  atômico. Os cinco resolvedores têm hash **idêntico** ao de antes —
  `intelligence_payload` (`7d026211…`), `nucleo_customer_assistant_access`
  (`7ac0a815…`), `resolve` v1 (`afbe50a5…`), `resolve_v2` (`a1110719…`) e
  `resolve_v3` (`e4aa5c0a…`). Quem responde continua sendo o **agente padrão**
  que a FASE D instalou; **não existe Agent Router** (isso é a FASE G).

  Junto veio um bug que ninguém tinha registrado: os dois `select id into …
  where audience = …` da mesma função não filtravam o padrão. `select into` sem
  `strict` pega a primeira linha e descarta o resto sem erro — com N agentes,
  amarraria as skills iniciais a um agente sorteado. Passa a exigir
  `is_default`.

  Revisão semântica feita antes de aplicar (ETAPA 10B): a versão viva nunca foi
  `do update` — reencontrar um perfil sempre significou reutilizar, sem
  sobrescrever campo nenhum, e assim continua. Isso importa concretamente aqui:
  o perfil de clientes desta organização chama-se **"Assistente Major"**, não
  "Assistente da empresa"; um `do update` teria revertido o nome escolhido pela
  equipe. A única divergência de comportamento é audience povoada **sem**
  padrão, estado inalcançável pelo único chamador (o gatilho é `AFTER INSERT`
  em `organizations`, logo roda com a organização vazia).

  Dados existentes **inalterados**, e isso é o ponto: a fase muda a capacidade
  do modelo, não os dados. Continuam 2 perfis, os mesmos `id`
  (`de7c940c…` / `d5d26c0a…`), os mesmos slugs (`assistente-major` /
  `assistente-interno`), as mesmas audiences, 2/2 ativos e 2/2 padrão. Nenhum
  perfil novo foi criado. Ao contrário das FASES B e C, esta migration não
  tocou nenhuma linha: `intelligence_audit_log` continua em 53 e o
  `updated_at` dos perfis continua em 04/09 21:29 UTC.

  **Nenhum segundo agente foi criado em produção**, de propósito. O modelo
  aceita, a UI e a API ainda não: não existe rota de `insert` de
  `assistant_profiles` no portal nem no servidor. Criar agente é a próxima
  fase. A tela de Campanhas já foi corrigida para amarrar a campanha ao agente
  **padrão** de clientes (antes era `find(audience === "customer")`, que
  viraria sorteio), mas a Central de Inteligência continua sendo a tela antiga,
  de dois assistentes.

  Nenhum serviço reiniciado. Os dois processos do runtime seguem de pé como
  unidades de usuário do `nucleo`
  (`whatsapp-assistant@8ee1e6d0…` e `whatsapp-bridge@8ee1e6d0…`), com o
  assistente no ar há ~11h48 e o bridge há ~1d11h no momento da conferência —
  ambos anteriores a esta migration. `NUCLEO_INTELLIGENCE_ROUTING_MODE` não foi
  alterada.

  Sobre observação em produção: **continua sem tráfego**. Zero turnos desde a
  aplicação da FASE D; o último turno de conversa ativa é de 04/09 22:43 UTC,
  anterior à própria FASE D. Os logs do runtime não têm nenhuma ocorrência de
  `assistant profile is inactive or unavailable`, `profile_inactive`,
  `resolve_v2`, `resolve_v3` ou erro de RPC/SQL. Portanto o caminho de
  resolução **não foi exercitado sob carga** nem pela FASE D nem pela E — o que
  sustenta as duas é a introspecção mais a prova comportamental em Postgres
  descartável.

  Não registrada em `supabase_migrations.schema_migrations` — segue o mesmo
  estado das demais desde `20260821120000`.

  Próxima fase: **F** (API/UI multi-agent: criar agente, listar por audience,
  escolher agente em campanha e no Simulador, e rever a semântica de
  `salvarSkill`).

- `20260905120000_trocar_o_agente_padrao_e_um_ato_so.sql` e
  `20260905160000_protege_campos_estruturais_dos_agentes.sql` aplicadas em
  05/09/2026 (FASE F — fundação de banco/API da gestão de agentes), nesta
  ordem, e conferidas por introspecção do catálogo. A segunda **se recusa a
  rodar** sem a primeira, de propósito.

  **O que o banco passa a oferecer.** `public.nucleo_agent_set_default(uuid)`:
  troca do agente padrão em UM ato. Ela existe porque trocar o padrão exige
  rebaixar um e promover outro, e em duas chamadas do navegador há uma janela
  real entre as duas — se a segunda não acontecer, a organização fica **sem
  padrão**, e sem padrão o resolvedor recusa tudo (FASE D). Um público inteiro
  pararia de ser atendido por causa de uma promoção que ninguém terminou.
  Conferida em produção: `security definer`, `search_path=""` explícito,
  `can_manage_org` dentro da função, organização e audience derivadas do
  próprio agente (não do cliente), `for update`, e sem tocar `active`, sem
  criar e sem apagar agente.

  **O que o banco passa a proteger.** RLS filtra linhas, não colunas: até aqui
  `authenticated` tinha `INSERT`/`UPDATE` de tabela inteira, então dentro das
  linhas que legitimamente administrava um gestor escrevia em **qualquer**
  coluna. Medido antes de corrigir, rodando como `authenticated` — que é como o
  PostgREST executa —, quatro caminhos tinham efeito real: rebaixar o padrão
  (deixando a organização sem nenhum), trocar a `audience` (um agente de
  clientes passando a ler conhecimento interno), trocar o `id` (mudando por
  baixo a identidade que conversas e campanhas referenciam) e criar agente já
  nascendo padrão.

  A correção é privilégio de **coluna**. Estado final conferido em produção:

  ```
  assistant_profiles  INSERT: active, audience, brand_config, created_by,
                              display_name, organization_id, process_config,
                              role, slug, soul_markdown, template_id, tone,
                              updated_by            (sem id, sem is_default)
                      UPDATE: active, brand_config, display_name,
                              process_config, role, slug, soul_markdown,
                              template_id, tone, updated_by
                                                    (sem id, organization_id,
                                                     audience, is_default)
  tabela (authenticated): REFERENCES, SELECT, TRIGGER
  ```

  `audience` e `organization_id` continuam **inseríveis mas não atualizáveis**
  — é assim que "definido na criação, imutável depois" deixa de ser promessa do
  JavaScript e vira regra do banco. `is_default` fora do INSERT, somado ao
  `default false` da coluna, faz "agente nasce comum" ser garantia do banco.
  **`is_default` agora só muda pela RPC**, que é `security definer` e não passa
  pelo privilégio de `authenticated`.

  `TRUNCATE` saiu explicitamente: é o único caminho que **não passa por RLS** e
  apagaria a tabela apesar de todas as policies.

  **`active` continua editável, inclusive no agente padrão**, e isso é
  deliberado. Desativar o padrão é decisão legítima de quem administra; o
  runtime recusa (FASE D) e nada é promovido no lugar. Confundir `active` com
  `is_default` aqui reintroduziria, em nome da segurança, a ambiguidade que a
  FASE C separou.

  Em `assistant_profile_skills`, o `UPDATE` ficou restrito a `enabled`,
  `priority`, `configuration` e `updated_by`: um vínculo não muda mais de dono.
  Cross-org continua impossível pela **FK composta**
  `(profile_id, organization_id) → assistant_profiles(id, organization_id)`,
  que é estrutura e não policy, e segue presente.

  `service_role` **não** foi tocada — mantém privilégio pleno, porque é a role
  dos caminhos servidor.

  **Nada de runtime mudou.** Os seis resolvedores têm hash idêntico ao estado
  pós-FASE-E; `provision_intelligence` idem. RLS ligada nas duas tabelas, as 3
  policies de cada uma intactas e com os mesmos nomes. Nenhum serviço
  reiniciado (bridge e assistente com uptime contínuo), `routing_mode`
  inalterada.

  **Dados intocados**, que é o ponto: 2 perfis, mesmos `id`, mesmos slugs,
  mesma audience, 2/2 ativos, 2/2 padrão, `updated_at` ainda em 04/09 21:29
  UTC e `intelligence_audit_log` ainda em 53. Nenhum agente adicional foi
  criado — o banco aceita, a UI ainda não existe.

  **O código JS da FASE F está versionado, não ativo.** `agentsProvider.js` não
  é importado por nenhum caminho do produto e o build de produção não o
  referencia; só o teste importa `agent-management.mjs`. Nenhum deploy de
  frontend foi feito, e nenhum é necessário: esses módulos serão consumidos
  pela Central de Inteligência na próxima fase.

  Sem tráfego para observar: zero turnos desde a FASE D, último turno em 04/09
  22:43 UTC. Como nas FASES D e E, o que sustenta esta aplicação é introspecção
  do catálogo mais a prova comportamental em Postgres descartável.

  Não registradas em `supabase_migrations.schema_migrations` — mesmo estado das
  demais desde `20260821120000`.

  Próxima fase: **Central de Inteligência / UI de Agents**, que passa a
  consumir esta camada. **Agent Router continua não existindo** (FASE G).

- `20260905200000_a_rpc_de_agente_padrao_nao_atende_anonimo.sql` aplicada em
  05/09/2026 — hardening **pontual** de menor privilégio, só da RPC que a FASE F
  criou. Não muda comportamento: `md5(pg_get_functiondef)` da função é
  `a8901310…` antes e depois, idêntico.

  O que corrigiu: `public.nucleo_agent_set_default(uuid)` tinha `EXECUTE` para
  `anon`. A migration da FASE F fez `revoke all ... from public`, e isso
  funcionou (`has_function_privilege('public', …)` já era `false`), mas o
  projeto tem `ALTER DEFAULT PRIVILEGES` concedendo EXECUTE **nominalmente** a
  `anon`/`authenticated`/`service_role` em toda função criada no schema
  `public` — e revogar de `PUBLIC` não alcança concessão nominal a papel.

  Por que a prova anterior não pegou, registrado como limite conhecido: o
  Postgres descartável do harness não tem esses default privileges, então lá o
  ACL saiu limpo e a prova passou sem ver o problema. Quem pegou foi a
  conferência do catálogo em produção. **O harness prova semântica de SQL, não
  configuração de projeto.**

  Isto não era explorável, e a migration não existe por pânico: a função é
  `security definer` e chama `private.can_manage_org` logo depois de achar o
  agente, o que depende de `auth.uid()`. Chamada anônima não tem `auth.uid()`,
  então `can_manage_org` é falso e ela levanta `organization management
  required` antes de escrever qualquer coisa. O que se corrigiu foi superfície:
  `anon` não deveria nem conseguir invocar uma operação de gestão.

  `service_role` foi **preservada, por decisão**. É o papel dos caminhos
  servidor, a chave nunca chega ao navegador, e todas as RPCs do projeto a
  concedem — tirar só desta faria dela a única exceção, que é o tipo de detalhe
  que surpreende alguém meses depois. E não amplia nada: sem JWT de usuário,
  `can_manage_org` falha fechado para ela também.

  ACL antes → depois:
  `postgres | anon | authenticated | service_role` → `postgres | authenticated | service_role`.
  Conferido pelo privilégio **efetivo**, não pelo texto: `anon` `false`,
  `PUBLIC` `false`, `authenticated` `true`, `service_role` `true`.

  Nada mais mudou: a fronteira de escrita da ETAPA 11B intacta (privilégio de
  tabela de `authenticated` ainda `REFERENCES, SELECT, TRIGGER`, zero colunas
  estruturais graváveis), os seis resolvedores com hash idêntico, 2 perfis,
  2/2 padrão, `intelligence_audit_log` ainda em 53, nenhum serviço reiniciado.

  Não registrada em `supabase_migrations.schema_migrations` — mesmo estado das
  demais desde `20260821120000`.

- `20260905220000_fase_13_agent_router.sql` **aplicada em produção** em
  06/09/2026 (FASE 13 / G de `docs/intelligence/MULTI-AGENT-MIGRATION.md`,
  primeira fatia do Agent Router), pelo SQL Editor, e conferida por consulta ao
  catálogo — não pela mensagem de sucesso.

  **A seleção do agente deixou de ser sempre `is_default`.**
  `private.intelligence_payload` saiu de `7d026211…` para `417dda36…`, e as
  outras seis funções observadas ficaram com hash **idêntico**:
  `provision_intelligence` (`2ce57ef0…`), `resolve` v1 (`afbe50a5…`),
  `resolve_v2` (`a1110719…`), `resolve_v3` (`e4aa5c0a…`),
  `nucleo_customer_assistant_access` (`7ac0a815…`) e
  `intelligence_context_preview` (`7ab1366f…`). As sete seguem
  `security definer` com `search_path=""`.

  **Sobre o hash não ser o `75e64817…` que a prova previu.** Não é divergência
  de código: o corpo aplicado tem **235 CRs** — um por linha —, porque o SQL
  foi colado no SQL Editor a partir do Windows. Normalizando CRLF, o corpo em
  produção é **byte a byte idêntico** ao provado: `md5` do corpo normalizado é
  `f5a6b72b2a01f96aab60e5d6b4e50319` dos dois lados. É o mesmo fenômeno que já
  explicava, nesta base, `nucleo_intelligence_context_resolve` (32 CRs) e
  `intelligence_context_preview` (21 CRs) diferirem do repositório sem
  diferirem em comportamento. **Quem for conferir por hash depois precisa
  normalizar antes de concluir qualquer coisa.**

  **Nenhum dado se moveu**, conferido antes e depois: 3 perfis (Assistente
  Major, SDR, Assistente interno), 2 padrões, 3 ativos, 5 contextos ativos, 0
  contexto sem perfil, 1 campanha em `test`/`active`, `updated_at` máximo dos
  perfis ainda em 05/09 20:14:08 UTC e `intelligence_audit_log` ainda em **54**
  — a migration é só `CREATE OR REPLACE` mais blocos `DO` de asserção, então
  ela não dispara gatilho nem escreve auditoria, ao contrário das FASES B e C.

  **Ninguém mudou de agente no ato.** Conferido imediatamente antes de aplicar:
  as 5 conversas ativas estavam pinadas exatamente no agente que já era o
  padrão do público delas — 1 no Assistente Major (clientes) e 4 no Assistente
  interno (equipe) —, e o SDR tinha 0 conversas. Ou seja, o ramo da afinidade
  resolve hoje o mesmo agente que o ramo do padrão resolvia. O efeito prático
  aparece a partir da próxima conversa que for pinada em um agente não-padrão
  ou casar com campanha de outro agente.

  Nenhum serviço foi reiniciado — migration de banco não exige, e o bridge e o
  assistente da VPS seguem de pé.

  O que ela instala, quando aplicada: a seleção do agente deixa de ser sempre
  `is_default` e passa a obedecer **afinidade → campanha → padrão**. Conversa
  em `handed_off` continua recusando antes de tudo; contexto ativo usa o agente
  pinado em `conversation_intelligence_contexts.assistant_profile_id`; conversa
  nova que casa com campanha de clientes usa
  `organization_campaigns.assistant_profile_id`; o resto continua no padrão.

  O achado que a originou: a afinidade tinha campo e **não tinha efeito**. A
  coluna existe e é `not null` desde a FASE H, mas o corpo da FASE D fazia
  `set assistant_profile_id = selected_profile.id` a cada turno, com
  `selected_profile` sendo sempre o padrão — a conversa era devolvida ao padrão
  em todo turno. Aqui a seleção passa a **ler** esse campo; a escrita continua
  idêntica (no ramo pinado é um no-op). Nenhuma coluna nova, nenhum backfill.

  É só `CREATE OR REPLACE` de **uma** função (`private.intelligence_payload`,
  por onde passam v1, v2, v3 e o preview). Não cria coluna, tabela, índice ou
  tipo; não toca `resolve_v2`/`resolve_v3`; não muda `schemaVersion`
  (`fase-h-1` aqui, `fase-h-2`/`fase-h-3` na borda) nem as chaves de
  `runtimeContext.assistant`; não cria `targetAgentId`, `targetMode = 'agent'`,
  campo de payload ou ferramenta nova; não roteia por keyword; e **não muda uma
  linha do runtime** — `whatsapp-mcp-hardened` já transporta tudo que o banco
  precisa (`conversation_key_hash`, `requester_phone`, `incoming_text`,
  `source_data`).

  As seis recusas usam a string pública de sempre,
  `assistant profile is inactive or unavailable`, e **nenhum ramo cai no
  seguinte**: pinado inativo recusa, agente de campanha inativo recusa, padrão
  inativo recusa. É a regra da FASE D estendida aos ramos novos.

  Duas mudanças de comportamento observável, deliberadas: trocar o agente
  padrão **não move conversas já abertas**; e conversa nova que casa com
  campanha de agente inativo passa a **recusar**, onde antes era atendida pelo
  padrão com a campanha de outro agente colada no contexto. Hoje isso não
  alcança ninguém em produção — a única campanha viva
  (`Piloto Atendimento Major`) aponta para o próprio padrão de clientes.

  Nenhuma seleção de agente usa `limit 1`: as duas por id entram por
  `id + organization_id + audience`, e a do padrão depende de `is_default`,
  protegida pelo índice parcial da FASE C. `campaign.id` entrou como **última**
  chave do `order by` da descoberta de campanha (desempate determinista; não
  muda precedência).

  A migration se confere sozinha: o pré-voo aborta se faltar coluna, índice, FK
  ou a FASE D, e recusa rodar sobre um corpo que já roteie; as asserções finais
  leem o `prosrc` aplicado — não a mensagem de sucesso — e conferem que ACL,
  dono, `SECURITY DEFINER` e `search_path` não mudaram no replace.

  Provas: `test/agent-router-migration.test.mjs` (15 itens, verdes) para o lado
  estático; `scripts/sql/prova-agent-router.sql` (itens A–L) para o
  comportamental, com a receita e o resultado em
  `scripts/sql/README-prova-agent-router.md`.

  **A prova comportamental foi executada antes de aplicar**, em 06/09/2026, PostgreSQL 17.9
  userspace descartável na VPS (socket unix, sem porta TCP), e **produção não
  foi tocada**: as 56 migrations do repositório aplicaram limpas do zero, os
  itens **A–L passaram todos**, e a transação não deixou fixture nenhuma
  (conferido por contagem independente depois do `ROLLBACK`). Um segundo banco
  no mesmo cluster, com a cadeia **menos** a FASE 13, serviu de controle: só
  `private.intelligence_payload` mudou (`7d026211…` → `75e64817…`), e as outras
  seis funções saíram com hash idêntico — `provision_intelligence`
  (`2ce57ef0…`), `resolve` v1 (`486f653b…`), `resolve_v2` (`a1110719…`),
  `resolve_v3` (`e4aa5c0a…`), `nucleo_customer_assistant_access` (`7ac0a815…`)
  e `intelligence_context_preview` (`ea6b4c1c…`). Os hashes do controle batem
  com os que esta seção já registrava para produção, então a comparação vale.
  Assinatura, `SECURITY DEFINER`, `search_path` e ACL saíram idênticos nos dois
  bancos. O cluster foi destruído no fim; bridge e assistente da VPS seguiram
  `active`, `NRestarts=0`, sem reinício.

  Não registrada em `supabase_migrations.schema_migrations` — mesmo estado das
  demais desde `20260821120000`.

  **O que ainda não foi observado:** produção segue sem tráfego no caminho de
  resolução. O último turno de conversa de cliente é de 31/08 e o interno de
  05/09 18:14, ambos anteriores a esta aplicação — então, como nas FASES D, E e
  F, o roteador **não foi exercitado sob carga real**. O que sustenta a fase é
  a prova comportamental A–L mais a conferência do catálogo acima.

  **Próximo passo natural:** a FASE 13C (levar o `soul_markdown` do agente
  escolhido ao prompt). `soul_markdown` está NULL em 100% dos perfis hoje.

- `20260906010000_fase_13c_soul_do_agente_no_prompt.sql` **aplicada em produção**
  em 06/09/2026 (FASE 13C — o agente passa a falar com a própria persona), pelo
  SQL Editor, e conferida por consulta ao catálogo — não pela mensagem de
  sucesso.

  **O que a conferência mostrou** (leitura de 06/09/2026 17:07 UTC, com
  `scripts/sql/validar-fase-13c.sql`): o corpo normalizado de
  `private.intelligence_payload` é `4ed9516507bcf8322f14e313fa08a94e`,
  **idêntico ao provado**; a definição saiu `f31bb996…` em vez do `fa473433…`
  do cluster de prova, de novo **só por CRLF** — mesmo fenômeno da 13B. As
  outras seis funções ficaram com `md5(pg_get_functiondef(...))` **idêntico ao
  registrado após a 13B**: `provision_intelligence` (`2ce57ef0…`),
  `intelligence_context_preview` (`7ab1366f…`),
  `nucleo_customer_assistant_access` (`7ac0a815…`), `resolve` v1 (`afbe50a5…`),
  `resolve_v2` (`a1110719…`) e `resolve_v3` (`e4aa5c0a…`). Assinatura, dono,
  ACL, `SECURITY DEFINER` e `search_path=""` preservados. A constraint
  `assistant_profiles_soul_markdown_tamanho` existe, é `CHECK`, está
  **validada**, e diz `soul_markdown IS NULL OR length(soul_markdown) <= 8000`.

  **Nenhum dado se moveu:** 3 perfis, 2 padrões, 3 ativos, 5 contextos ativos,
  `intelligence_audit_log` ainda em **54** e `updated_at` máximo dos perfis
  ainda em 05/09 20:14:08 UTC — os mesmos números da aplicação da 13B. A
  migration é `CREATE OR REPLACE` mais um `alter table ... add constraint` e
  blocos `DO` de asserção: não dispara gatilho nem escreve auditoria.

  **Correção de um fato que esta página vinha repetindo:** `soul_markdown`
  **não** está NULL em 100% dos perfis. A leitura acima mostra `com_soul = 1`:
  o **SDR** (`85ef7c76-e439-4a4d-9ff2-8b3109a650de`, criado na FASE 12D) tem
  persona de **366 caracteres em 1 linha**, sha256
  `477f8f59…`, gravada em 05/09 20:14:08 — anterior a esta aplicação, no mesmo
  horário da criação do agente. Bem dentro do teto (`soul_acima_de_8000 = 0`).

  Consequência, com a precisão que o Router impõe: o SDR é `is_default = false`,
  então ele só atende quando a 13B o seleciona — conversa **pinada** nele
  (tinha zero) ou conversa nova casando com **campanha** que aponte para ele.
  Publicado o runtime, a persona do SDR entra no prompt **no primeiro turno em
  que o SDR for o agente escolhido**, e não antes. Para os dois agentes padrão,
  que seguem sem persona, nada muda — e `null` nunca vira a persona de outro.

  **Runtime publicado na VPS em 06/09/2026 17:23 UTC**, fechando a fatia.
  `whatsapp-mcp-hardened` passou de `a6f769f` para `da11193`; só o
  `whatsapp-assistant` foi reiniciado (o Bridge não precisa, e não foi tocado —
  segue `active` desde 03/09 com `NRestarts=0`). Depois do restart: `active`,
  `running`, `NRestarts=0`, `service.started` normal, `py_compile` e os 15
  testes de `test_intelligence.py` verdes no próprio Python do serviço (3.11.16).

  **Divergência encontrada no caminho, e por que ela quase virou regressão.** A
  branch `hardening` tinha divergido: o checkout local parou em
  `ee8afa6 + 4b969e3` enquanto o remoto e a VPS seguiram por
  `ee8afa6 + ba35858 + c24fd3a + a6f769f` (três commits de 04/09, entre eles um
  `fix` de caminho operacional). A branch da 13C tinha nascido do lado que ficou
  para trás; publicá-la como estava teria **apagado esses três commits de
  produção**. Foi rebaseada sobre `a6f769f` antes do deploy — sem conflito, e o
  git confirmou que o conteúdo de `4b969e3` já estava aplicado na linha da VPS.
  Suíte do `whatsapp-assistant` depois do rebase: **370 verdes**.

  **A deriva de marcador foi corrigida junto**, para não deixar a armadilha
  armada: `hardening` foi avançada para `da11193` por fast-forward real
  (`a6f769f..da11193`, sem force) no GitHub, e a VPS deixou de rodar em HEAD
  destacado — agora ela **segue a branch** `hardening`. A troca foi feita movendo
  o rótulo antes de anexar o HEAD, então o working tree nunca voltou ao código
  antigo: zero arquivo alterado no disco, nenhum serviço reiniciado por causa
  disso, e os dois seguem `active` com `NRestarts=0`. Local, remoto e VPS agora
  apontam para o mesmo commit, e "publicar a `hardening`" voltou a significar
  publicar o que está em produção.

  **Achado não relacionado, registrado por honestidade:** o log do assistente
  acumula `runtime.commands_unavailable` / `control_plane_unavailable`
  ("Supabase recusou reserva de comandos do runtime") a cada ~20 minutos —
  **202 ocorrências desde 03/09**, muito antes desta publicação. Não é efeito da
  13C e não foi investigado aqui.

  Não registrada em `supabase_migrations.schema_migrations` — mesmo estado das
  demais desde `20260821120000`.

  **O que ela faz.** Leva o `soul_markdown` do **mesmo agente que o Router da
  13B escolheu** até o payload, como duas chaves novas dentro do objeto
  `assistente`: `soul` (o texto) e `soulHash` (sha256 hex). O Soul sai de
  `selected_profile` e de nenhuma consulta própria a `assistant_profiles` — uma
  quarta busca de perfil seria exatamente o caminho por onde a persona de um
  agente vazaria para a conversa de outro. **Agente sem persona manda `null`,
  nunca a do padrão**: herdar persona por ausência é o mesmo erro que a FASE D
  proibiu para disponibilidade.

  É só `CREATE OR REPLACE` de **uma** função (`private.intelligence_payload`),
  mais a constraint `assistant_profiles_soul_markdown_tamanho`. Não muda
  `schemaVersion` (`fase-h-1`); `resolve_v2` e `resolve_v3` copiam o objeto
  `assistente` inteiro, então as duas chaves chegam ao `runtimeContext` sem que
  nenhuma das duas funções seja tocada. Não toca `allowedTools`, política,
  policy, grant ou RLS — Soul é persona, nunca permissão; quem autoriza
  continua sendo `allowedTools` da skill mais RLS. Não usa `source_data`, não
  cria `targetAgentId`, não renomeia `assistente` para `agente` e não altera a
  precedência do Router.

  **O teto de 8000 caracteres, em três lugares.** `soul_markdown` nasceu `text`
  sem limite nenhum na FASE B, enquanto `tone` tem 500 no banco e 500 espelhado
  em JavaScript. Persona sem teto entra em **todo** prompt de **todo** turno
  daquele agente: custo, risco de estourar contexto e, no limite, empurrar a
  skill para fora da janela. Agora: a constraint impede gravar acima de 8000; o
  payload descarta acima de 8000 (sem derrubar o turno — persona não autoriza
  nada, então recusar o atendimento por causa dela trocaria um problema
  cosmético por um cliente sem resposta); e o runtime aplica o mesmo `MAX_SOUL`
  contra linhas antigas, anteriores à constraint.

  **Diferente da 13B, esta fatia muda o runtime.** Em `whatsapp-mcp-hardened`
  (branch `hardening`): `intelligence.py` ganha o helper `_soul` e monta o bloco
  `<agent_soul_trusted>` **abaixo das políticas e acima da skill** — o que está
  acima decide o que pode, a persona decide como soa, o que está abaixo decide o
  que fazer no turno; e `worker.py` registra `soul_hash[:12]` e `soul_rejected`,
  **nunca o conteúdo** — persona é texto livre escrito por gente da organização
  e não pertence a arquivo de log.

  **Provas.** Estático: `test/agent-soul-migration.test.mjs` (12 itens, e o
  central é o B — o corpo tem de ser o da 13B mais exatamente três acréscimos
  conhecidos), somando **27 verdes** com os da 13B. Prompt:
  `whatsapp-assistant/test_intelligence.py`, **364 verdes**, incluindo
  `test_persona_de_um_agente_nao_aparece_na_conversa_de_outro`. Comportamental:
  `scripts/sql/prova-soul-do-agente.sql` (A–J) — **executada em 06/09/2026,
  PASS em todos**, PostgreSQL 17.9 descartável na VPS, 57 migrations aplicadas
  do zero, zero fixtures depois do `ROLLBACK` e produção intocada. Banco de
  controle sem a 13C no mesmo cluster confirma que **só
  `intelligence_payload` mudou** (`75e64817…` → `fa473433…`); as outras seis
  saíram com hash idêntico. O `75e64817…` do controle é o mesmo hash que a prova
  da 13B registrou para o corpo hoje vivo em produção — é o que faz a comparação
  valer. Detalhes em `scripts/sql/README-prova-soul-do-agente.md`.

  **Ao aplicar, conferir por:** `md5(replace(prosrc, chr(13), ''))` =
  `4ed9516507bcf8322f14e313fa08a94e`. O `md5(pg_get_functiondef(...))` provado é
  `fa473433b5a5f6e3b440383fcffce4e0`, mas ele **vai divergir em produção** por
  CRLF, como já divergiu na 13B — normalizar antes de concluir qualquer coisa.

  **Ordem de rollout é indiferente**, e isso é deliberado: o runtime novo aceita
  payload sem `soul` (as chaves são opcionais) e o runtime antigo ignora chaves
  que não conhece. Não existe janela quebrada entre aplicar a migration e
  publicar o runtime.

  **O que não vai aparecer de imediato:** `soul_markdown` está NULL em 100% dos
  perfis. Depois de aplicada, a fatia só produz efeito observável quando alguém
  escrever uma persona pelo portal — a tela de criação e edição já grava nessa
  coluna desde a FASE B.

## Dívidas de menor privilégio (FASES E e F)

Duas coisas encontradas durante a FASE E que **não** são dela e não foram
corrigidas junto, para não misturar escopo numa migration de produção:

- **Exposição do schema `private`.** `private.provision_intelligence` é
  `security definer`, recebe `organization_id` arbitrário e tem `EXECUTE` para
  `PUBLIC` (o padrão do Postgres); o schema `private` tem `USAGE` para
  `authenticated`. Hoje ela não é alcançável pela API porque o PostgREST não
  expõe `private` — mas isso depende de configuração, não de permissão. A
  verificar em etapa própria de segurança: `PGRST_DB_SCHEMAS`, quais schemas
  estão expostos, e os `EXECUTE` das funções `private` em geral. É
  **pré-existente**, anterior a toda a linha multi-agent, e não foi introduzido
  nem agravado pela FASE E.
- **`EXECUTE` para `anon` nas RPCs do schema `public`.** *(A RPC da FASE F saiu desta lista em 05/09/2026, pela migration `20260905200000`; as demais continuam.)* Achado ao
  conferir a RPC nova em produção: `nucleo_agent_set_default` saiu com
  `anon=X`, apesar de a migration fazer `revoke all ... from public`. A causa
  é `ALTER DEFAULT PRIVILEGES` do Supabase, que concede EXECUTE a
  `anon`/`authenticated`/`service_role` a toda função criada em `public` — e
  o Postgres descartável não reproduz isso, então a prova no harness não
  pegou. **Não é regressão nem é específico da FASE F**: as seis RPCs
  conferidas (`nucleo_customer_assistant_access`,
  `customer_assistant_rollout_update`, `intelligence_context_preview`,
  `resolve_v2`, `nucleo_knowledge_save`) têm exatamente o mesmo ACL. Também
  não é explorável na RPC nova: ela é `security definer` e `can_manage_org`
  falha fechado para quem não tem `auth.uid()`. Fica como trilha de menor
  privilégio, junto com o item acima.

- **`runtime.commands_unavailable`.** O assistente registra, de forma
  recorrente, `error_code: control_plane_unavailable` — "Supabase recusou
  reserva de comandos do runtime". Pré-existente e alheio à resolução de
  agente: 44 ocorrências em 04/09 **antes** da FASE D, e 4 depois. Não é
  regressão das FASES D/E, mas ninguém abriu para investigar.

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
# FASE 14 — aceite manual do corpo SQL (2026-09-06)

O SQL Editor confirmou a coluna, as permissões e o corpo canônico da RPC 14B:
`c5a77221e64b6be22720cc1800faf683`. A correção removeu as quebras que a
cópia anterior havia introduzido dentro de três mensagens literais. A reprodução
do problema e a restauração passaram em Postgres 17.9 descartável, seguidas de
toda a prova comportamental A–H/G2 e dos vínculos SDR. A 14B está aceita em
produção. A 14C, a publicação das skills, o runtime e a transferência real
continuam pendentes.
