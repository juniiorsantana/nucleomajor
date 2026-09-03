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
- **Responder pelo portal esbarra na allowlist do Bridge**, e isso é a barreira
  funcionando, não defeito. `allow_unlisted` é `false`, e `allowed_recipients`
  tem quatro números — a equipe. Passam: esses quatro; qualquer cliente cuja
  conversa o Bridge liberou na entrada e que escreveu nos últimos 15 minutos
  (`customer_reply_window_seconds`); e o único grupo em `allowed_groups`. Fora
  disso o envio volta `recipient_not_allowed`, com o texto dizendo o porquê.
  Ampliar isso é decisão de `HARDENING.md`, exige mexer no Bridge em Go, e
  recompilá-lo derruba o canal do WhatsApp — precisa de janela combinada.
- O espelho de conversas não poda linha órfã; ver a seção de Conversas.
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
