# ADR-0007 — Remover uma organização de WhatsApp sem perder a empresa

Estado: **decisão de produto aprovada, implementação pendente**
(11/10/2026). Nada disto está implementado.

## Contexto

O dono pediu uma área de "organização" que reúna tudo de um WhatsApp, com uma
ação para apagá-la. A regra dele: apagar desconecta o WhatsApp e apaga as
conversas, mas não apaga leads, negócios, compromissos, tarefas, fluxos,
chatbots nem a inteligência.

No banco, o que o dono chama de "organização" é a **conexão**
(`whatsapp_connections`). A `public.organizations` é a **empresa**: dela
dependem 57 FKs em `on delete cascade`, inclusive contatos, negócios e
tarefas. Apagar a empresa apagaria tudo.

O levantamento procurou botão ou RPC para excluir a empresa ou a conexão.
Foram examinados a `main` em `a6fb291`, as branches remotas do portal e o
runtime `feat/troca-voluntaria` em `674e138`. Não foi encontrado nenhum.

## Vocabulário

| Na tela | No código e no banco | O que reúne |
|---|---|---|
| **Empresa** | `organizations` | leads, negócios, etapas, tarefas, agenda, fluxos, chatbots, agentes, equipe, plano |
| **Organização de WhatsApp** ("um WhatsApp da sua empresa") | `whatsapp_connections` | um número, suas conversas, operadores e configurações |

A empresa pode ter mais de uma organização de WhatsApp; "Adicionar WhatsApp"
cria uma nova (decisão do dono de 10/10/2026). Remover uma organização de
WhatsApp **nunca** apaga a linha de `organizations`.

## Contrato aprovado: duas fases

### Fase 1 — Desativar (reversível, pelo prazo de arrependimento)

Nada é apagado. Conversas, mensagens, análises e vínculos ficam guardados.

- **Acesso e execução bloqueados.** O WhatsApp não conecta, não recebe, não
  envia. Fluxos, IA, lembretes e avisos daquela organização não rodam. O
  histórico fica indisponível nas telas.
- **Na VPS.** O aparelho é desligado no WhatsApp: é o `Release` com Logout da
  troca voluntária. O Bridge e o assistente param. Os dados continuam no
  disco.
- **Auditoria.** A desativação fica registrada: quem, quando e o quê.
- **Restaurar dentro do prazo.**
  - O acesso ao histórico volta, e dá para reconectar.
  - Reconectar **exige QR Code de novo**: o Logout invalidou a sessão, e ela
    não é recuperada.
  - Mensagens, ações e lembretes que venceram durante o prazo **não são
    reenviados sozinhos**.
  - O período desativado pode deixar lacunas no histórico, porque o que
    chegou ao WhatsApp nesse tempo não passou pelo portal.

### Fase 2 — Excluir definitivamente (depois do prazo)

**Apaga**
- as conversas e mensagens daquele WhatsApp: `whatsapp_conversations`,
  `whatsapp_messages` e o espelho `messages.db` na VPS;
- sessão, identidade, credenciais, operadores e comandos:
  `whatsapp_device_sessions`, `whatsapp_connection_identities`,
  `connection_installations`, `connection_robot_credentials`,
  `connection_notification_credentials`, `whatsapp_connection_operators`,
  `whatsapp_operator_verifications`, `connection_runtime_commands`;
  `connection_runtime_status` e `whatsapp_connection_change_requests` não têm
  FK e precisam de limpeza explícita;
- o atendimento que ficou parado: `assistant_pending_actions`,
  `customer_pending_actions`, `customer_handoff_requests`,
  `chatbot_flow_sessions`, `customer_booking_notifications`;
- na VPS: as duas units desabilitadas e os dados exclusivos dela (store,
  vault, state, login do Claude e os dois `.env`);
- `conversation_intelligence_contexts`: é a memória do atendimento em curso
  (intenção, estado da conversa), e não um relatório.

**Desvincula, sem apagar**
- compromissos, lembretes, verificações e o histórico de execução dos fluxos
  (decisão D);
- as análises das conversas (decisão C): `conversation_analyses`,
  `conversation_insight_runs` e `conversation_insight_answers`.

**Fica**
- contatos e leads (inclusive os que só vieram por aquele WhatsApp), negócios,
  etapas, tarefas e compromissos da agenda;
- definições e versões de fluxos e chatbots (`chatbot_definitions` e
  `chatbot_versions` só têm `organization_id`), agentes, skills e configuração
  de inteligência;
- a auditoria das duas fases, guardada fora das tabelas que somem.

## Decisões do dono (11/10/2026)

**C — Análises das conversas: guardar.** Nas palavras do dono: "Deve guardar
as análises, precisamos encontrar uma maneira de ver depois." A análise passa
a ser um registro da empresa, que continua acessível depois de a conversa e a
conexão serem apagadas.

- **O que fica:** `conversation_analyses`, `conversation_insight_runs` e
  `conversation_insight_answers`, com o que for preciso para abrir o
  relatório.
- **Vínculo durável:**
  - `organization_id` continua obrigatório, e a conexão pode ser desvinculada
    sem tocar na empresa;
  - as FKs compostas `(connection_id, organization_id)` precisam ser revistas:
    trocar `cascade` por `set null` arriscaria anular a empresa;
  - o nome e o final do número da organização removida ficam guardados antes
    de ela ser apagada;
  - os runs, que hoje só têm `contact_phone`, ganham vínculo com o contato.
- **Vínculo com o contato desde já:**
  - o contato é preenchido pelo telefone só quando há uma correspondência
    única e normalizada dentro da empresa. Caso ambíguo fica sem vínculo;
  - isso vale para as análises novas, e as antigas são levantadas antes.
    A remoção não pode ser o único momento em que se tenta achar o contato.
- **Evidências:**
  - no expurgo saem os números das mensagens citadas (`evidence`) e a linha
    do tempo;
  - a linha do tempo não é guardada: `private.linha_do_tempo_da_analise` a
    monta na leitura a partir de `whatsapp_messages`, com um trecho de cada
    mensagem;
  - o relatório mostra "As mensagens usadas como evidência foram removidas",
    e "ver mensagem" fica desligado.
- **Mensagem sugerida:** será preservada; dá para ler e copiar. Ela não sai
  pela conexão removida; enviar depois exige escolher um WhatsApp ativo e
  revisar a mensagem.
- **Onde ver:**
  - na ficha do contato, em "Análises", lidas pelo contato e não pela
    conversa;
  - na área de análises da empresa, numa lista geral com o filtro "WhatsApp
    removido", que inclui as análises sem contato;
  - as permissões continuam as de hoje: a equipe vê as salvas, e o dono e os
    administradores veem também os rascunhos. A entrada nova não amplia o
    acesso.

Hoje, a conversa (`web/conversasProvider.js`, "conversas.analises") e a ficha
do lead (`feat/analises-na-ficha`, `a3337a3`, na `main` pelo PR #44,
`9786a64`) leem as análises pela conexão e pelo telefone. Com a conexão
removida, elas sumiriam das duas telas.

**D — Agenda e histórico dos fluxos: aprovado como recomendado.** Na
exclusão definitiva:
- preservar compromissos e o histórico de execução dos fluxos, sem o vínculo
  com a conexão removida, guardando só o nome e o final do número;
- o histórico de execução não pode guardar texto das conversas apagadas. As
  entradas, saídas e logs com conteúdo de conversa precisam ser identificados
  e limpos, e ficam só os metadados da execução;
- lembretes e avisos que sairiam por aquele WhatsApp são cancelados com o
  motivo marcado. Nada passa sozinho para outro número;
- as verificações de telefone ligadas à conexão são invalidadas.

O que o banco permite hoje:

| Tabela | Coluna | Regra da FK | Migration |
|---|---|---|---|
| `calendar_agent_bookings` | `connection_id not null` | `restrict` | `20260821230000_fase_d_agendamento_whatsapp.sql` |
| `calendar_operator_bookings` | `connection_id not null` | `restrict` | `20260822010000_operadores_whatsapp_pessoais.sql` |
| `chatbot_flow_executions` | `connection_id not null` | sem regra | `20260907010000_fluxos_execucao_persistida.sql` |
| `calendar_reminders` | `claimed_by_connection`, aceita nulo | sem regra | `20260821210000_fase_d_agenda_integrada.sql` |
| `calendar_phone_verifications` | `claimed_by_connection`, aceita nulo | sem regra | `20260821210000_fase_d_agenda_integrada.sql` |

As três primeiras exigem mudar a estrutura para preservar o registro sem a
conexão. As duas últimas podem ser desvinculadas como estão. Qualquer uma
delas, com linha ligada à conexão, faz um `DELETE` direto falhar. Por isso a
remoção **não** pode ser um `DELETE` direto na conexão.

**Prazo de arrependimento: 7 dias, aprovado.** São 7 dias de desativação
antes da exclusão definitiva. Restaurar nesse prazo pede QR Code de novo e
**não reenvia o que venceu**.

**Quem pode: só o proprietário da empresa (`owner`), aprovado.** Isso vale
para remover e para restaurar.

## Texto guardado nas análises (decidido)

As análises podem guardar frases copiadas da conversa: o analista explica
"citando o que foi dito" (`whatsapp-assistant/analista.py`, em
`why_this_score` e `lead_why`). A mensagem sugerida é escrita para aquele
cliente. Não dá para limpar essas frases automaticamente: isso poderia mudar
as conclusões, e não garante tirar todo o texto original.

> As análises podem conter frases copiadas da conversa dentro das
> explicações. Podemos guardar o relatório como foi produzido, incluindo
> essas frases e a mensagem sugerida, mesmo depois de apagar as mensagens e a
> conversa? Recomendação: sim. Os links para as mensagens e a linha do tempo
> saem.

**Resposta do dono: sim, guardar como foi feito.** O relatório fica completo,
com as frases citadas e a mensagem sugerida. Saem só os números das mensagens
(`evidence`) e a linha do tempo.

## O fluxo na tela, em três momentos

1. **Gerenciar.** O cartão em Conexões abre uma página "Organização de
   WhatsApp", com:
   - o nome (com o lápis), o número, o estado, os operadores e as
     configurações;
   - desconectar, trocar o número e remover como ações separadas, com remover
     no fim da página.
2. **Confirmar.** A tela mostra, em lista curta:
   - o nome e o final do número;
   - os 7 dias de desativação e o que acontece neles;
   - o que será apagado depois do prazo e o que fica;
   - "As análises serão preservadas e podem conter trechos das conversas."

   Para confirmar, o dono digita o nome da organização.
3. **Acompanhar.** Os estados são:
   - **"Desativando"**, até o banco bloquear e a VPS parar;
   - **"Desativada, pode restaurar até <data>"**;
   - **"Excluindo definitivamente"**;
   - **"Removida"**, só depois de o banco e a VPS confirmarem o expurgo.

   Uma falha em qualquer etapa aparece como falha que dá para repetir.

Nada pode reconectar, gravar mensagem nem rodar outro comando na organização
enquanto ela está desativada ou sendo removida.

**Nas telas que abrem conversa** a partir do contato (ficha, Leads, Funil,
Campanhas, Conversas e MCP do portal):
- durante o prazo, aparece "Este WhatsApp está desativado. O histórico está
  temporariamente indisponível.";
- depois do expurgo, aparece "O histórico deste WhatsApp foi removido.";
- a mensagem aparece só onde houver vínculo comprovado com a conexão
  removida. As conversas do mesmo contato por outros WhatsApps continuam
  acessíveis.

## Requisitos de implementação (depois da aprovação)

Nomes de estados, comandos e funções ficam para a implementação. Os requisitos
são estes:

1. **Dados.**
   - Antes de tudo, as análises ficam independentes da conversa (decisão
     C): vínculo durável com a empresa e o contato, a identificação
     histórica da conexão e as FKs revistas sem risco para
     `organization_id`.
   - Registrar a desativação e a data-limite de restauração.
   - O pedido de remoção é guardado pelo cargo (`owner`) e pela confirmação do
     nome.
   - O bloqueio vale em todas as gravações ligadas à conexão.
   - A restauração e o expurgo definitivo seguem a decisão D, com auditoria
     das duas fases.
   - Migration de produção só pelo SQL Editor, com ensaio que não deixa
     efeito, e conferência do efeito por consulta.
   - Migration nova numerada acima da última da `main` atualizada (hoje,
     `20261012100000`).
2. **VPS.**
   - A desativação e o expurgo param o Bridge e o assistente daquela conexão,
     e quem para não pode ser quem confirma. **Pendência técnica:** definir
     que processo executa e confirma a remoção depois que as units da
     conexão estiverem paradas. A fila de comandos de hoje é processada pelo
     assistente da própria conexão.
   - Hoje não existe script de desprovisionar: `provision-connection.sh` só
     cria. O novo precisa ser repetível e deixar registro.
3. **Interface.**
   - A página "Organização de WhatsApp", a confirmação, os estados e a
     restauração;
   - as mensagens de histórico indisponível e removido nas telas de conversa;
   - as análises abertas pela ficha do contato e pela lista com o filtro
     "WhatsApp removido", sem depender da conversa nem da conexão.
4. **Validação.**
   - Tudo é testado numa conexão descartável criada para isso. **A conexão da
     Major (`8ee1e6d0…`) fica fora de qualquer teste.**
   - Merge e deploy só com o dono de acordo.

## Evidências

- **Cascades da empresa e da conexão:**
  - `supabase/migrations/20260814140000_whatsapp_connections.sql`;
  - as migrations de cada tabela citada (busca por
    `references public.whatsapp_connections`);
  - os vínculos que bloqueiam o `DELETE` estão na tabela da decisão D.
- **Fluxos da empresa:** `chatbot_definitions` só tem `organization_id`.
- **VPS:**
  - `whatsapp-mcp-hardened/scripts/vps/provision-connection.sh`: pastas,
    `.env` e units;
  - desligar o aparelho: `whatsapp-bridge/troca.go` (`Release`).
- **Telas e consumidores de conversa:**
  - `apps/emyleads/src/web/conversasProvider.js`;
  - `apps/emyleads/src/page/telas/Conversas.jsx` e
    `apps/emyleads/src/page/telas/conversas/useConversas.js`;
  - `apps/emyleads/src/page/telas/leads/conversaDoLead.js` e
    `apps/emyleads/src/page/telas/leads/useConversasDosLeads.js`;
  - `apps/emyleads/src/page/telas/FichaContato.jsx`,
    `apps/emyleads/src/page/telas/Contatos.jsx`,
    `apps/emyleads/src/page/telas/Campanhas.jsx` e
    `apps/emyleads/src/page/Gestao.jsx`;
  - `src/mcpTools.mjs`.

## Respostas do dono (11/10/2026)

1. **C:** guardar as análises, e achar um jeito de vê-las depois.
2. **D:** sim, como recomendado.
3. **Prazo:** 7 dias.
4. **Quem pode:** só o proprietário da empresa.
5. **Texto nas análises:** guardar o relatório como foi feito.
