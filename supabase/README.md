# Backend Supabase do EmyLeads

As migrations deste diretório são a fonte de verdade do backend. Elas devem ser
aplicadas em ordem pelo Supabase CLI (`supabase db push`) ou pelo SQL Editor do
projeto antes de ativar Auth ou sincronização na extensão.

## Estado inicial

- SaaS multiempresa: um usuário pode participar de várias organizações.
- Papéis: `owner`, `admin` e `member`.
- RLS em todas as tabelas de negócio.
- Fotos privadas no bucket `contact-avatars`.
- `legacy_id` preserva os IDs atuais do IndexedDB durante a migração.
- `version`, `updated_at` e `deleted_at` sustentam sincronização e tombstones.

## Estado na Fase 3

O Supabase sincroniza o CRM e os efeitos dos chatbots, não a definição visual
dos fluxos. Permanecem remotos: contatos, negócios, tarefas, notas, eventos,
estágios, tags, vínculos de tags, organizações e fotos. Permanecem locais ao
workspace: chatbots, condições, passos, posições e conexões do canvas.

Quando um chatbot altera etiquetas ou executa, o contato atualizado e o evento
`chatbot.executado` entram no outbox normal. O wrapper do provider restaura o
workspace salvo antes de toda operação, pois o service worker MV3 pode perder o
estado em memória ao dormir.

O cliente da extensão usa exclusivamente a publishable key. Secret keys e
`service_role` nunca pertencem ao código ou aos arquivos de ambiente da extensão.

## Portal Núcleo Major e convites por e-mail

A migration `20260822090000_portal_convites_email.sql` prepara o portal em
`https://nucleomajor.com`. Ela adiciona cancelamento, expiração renovável
e estado de entrega SMTP aos convites; a listagem passa por RPC e nunca retorna
`token_hash`. Convites para membros já existentes são recusados e o aceite não
usa `ON CONFLICT` para trocar o cargo de uma associação existente.

O frontend chama somente `/api/invitations` no portal. O Node autentica a sessão
do administrador com o Supabase, gera o link e o código reserva, envia ambos
por `convites@majorhub.com.br` usando o SMTP da Hostinger e registra sucesso ou
falha da entrega. O token bruto não é salvo em log nem entregue à extensão.

Após aplicar a migration, configure no `.env` do portal `PUBLIC_ORIGIN`, as duas
variáveis públicas do Supabase e as credenciais SMTP. No Auth do Supabase,
adicione `https://nucleomajor.com` como URL do site e
`https://nucleomajor.com/convite` como redirect permitido. A origem da
extensão Chrome também precisa entrar em `CORS_ALLOWED_ORIGINS` no portal.

Validação disponível:

- `portal/test/*.test.mjs`: link, escape do e-mail, página, configuração e
  rotas de reenvio/cancelamento;
- `test_portal_invites_migration.py`: invariantes estáticos da migration;
- `tests/portal_convites_email.test.sql`: roteiro pgTAP para o aceite hospedado.

O teste SQL exige um Postgres/Supabase de teste; a máquina de desenvolvimento
continua sem Docker/Postgres, então ele não é executado localmente.

## Fase D — Agenda Major

`20260821210000_fase_d_agenda_integrada.sql` acrescenta categorias, preferências
por profissional, metadados completos dos eventos, verificação de telefone e a
fila de lembretes. A migration também limita cada organização a uma conexão de
WhatsApp não revogada.

Privacidade: a policy da tabela base não dá ao `owner` ou `admin` acesso aos
eventos pessoais de colegas. A disponibilidade coletiva passa pelo RPC
`calendar_events_list`, que substitui título por `Indisponível` e remove
descrição, tipo, contato, IDs do Google, categoria, local, tags e lembretes.

O trabalhador de notificações possui usuário Auth separado e só executa cinco
RPCs estreitos de reivindicação/conclusão. Sua sessão renovável fica fora do
banco em arquivo `0600`; `service_role` aparece apenas no processo manual de
provisionamento.

`20260821230000_fase_d_agendamento_whatsapp.sql` acrescenta uma única escrita
ao robô da Fase C: criar um compromisso confirmado na agenda do profissional
atribuído à conversa. A RPC deriva organização/conexão da credencial, associa o
contato pelo telefone do remetente, recusa outro tenant e horário ocupado, e é
idempotente por turno e por conteúdo. O robô segue sem `INSERT` direto; grupos
nem recebem a ferramenta na allowlist do runner.

Validação disponível:

- `test_phase_d_migration.py`: invariantes estáticos de isolamento e menor
  privilégio, executável sem Docker;
- `tests/fase_d_agenda.test.sql`: RLS com duas organizações, cargos, máscara de
  privados, categorias, sobreposição e telefone protegido. Exige um Postgres
  de teste e ainda precisa ser executado no aceite hospedado/local.
- `test_phase_d_whatsapp_booking_migration.py`: invariantes estáticos da escrita
  estreita, executável sem Docker;
- `tests/fase_d_agendamento_whatsapp.test.sql`: confirmação, tenant, contato,
  conflito, idempotência e bloqueio do `INSERT` direto. Precisa ser executado
  no aceite do banco.

## Fase E — Núcleo de Conhecimento

`20260823010000_nucleo_conhecimento.sql` cria documentos Markdown virtuais no
Supabase com três escopos: organização, equipe e pessoal. O caminho do arquivo
organiza pastas sem depender do disco da máquina; cada alteração gera uma
versão imutável.

Documentos pessoais só podem ser lidos e alterados pelo próprio profissional.
Documentos compartilhados só podem ser escritos por dono ou administrador. A
credencial do assistente não recebe acesso direto às tabelas: as RPCs de busca
e leitura primeiro identificam o operador pelo telefone verificado e limitam a
resposta à organização e aos escopos permitidos.

Agenda, tarefas, contatos e negócios continuam sendo entidades operacionais
próprias. Um pedido de reunião nunca deve ser convertido em Markdown ou tarefa
como fallback. O teste estático `test_nucleo_knowledge_migration.py` protege
essas fronteiras antes do aceite hospedado.

## Convite vinculado ao e-mail (hotfix de 19/08/2026)

`20260819180000_convite_vinculado_ao_email.sql` conserta um furo anterior ao
trabalho de máquina do Estágio 3, e que afeta pessoas: `accept_organization_invite`
conferia só que existia sessão, então **o código do convite era um portador
puro** — encaminhado por engano ou lido de uma caixa de entrada, admitia
qualquer pessoa autenticada, com o papel que o convite carregava.

Agora exige que o e-mail de quem aceita seja o do convite, **e que esse e-mail
esteja confirmado**. A segunda guarda sustenta a primeira: sem ela, bastaria
cadastrar-se com o e-mail alheio.

> **Exige `enable_confirmations = true` no projeto.** Com a confirmação
> desligada, `email_confirmed_at` é nulo para todo mundo e **ninguém aceita
> convite** — o fluxo falha fechado, de propósito. O `config.toml` deste repo
> já está alinhado com essa decisão; ainda é necessário ligar confirmação e
> SMTP no projeto hospedado.

Testes em `tests/convite_vinculado_ao_email.test.sql`, incluindo o caso que
motivou o hotfix: uma terceira pessoa, com um código perfeitamente válido, é
recusada.

**Aplicada no projeto hospedado em 21/08/2026**, via `supabase db push`
(`migration list` confirma `20260819180000` em Local e Remote). Verificado
depois lendo o corpo da função de volta do banco
(`information_schema.routines`), não só o "Finished" da CLI — as duas guardas
(e-mail confirmado, e-mail batendo com o convite) estão na função que roda ao
vivo.

**Ainda não confirmado:** se `enable_confirmations` está ligado no projeto
hospedado (o `config.toml` deste repo está, mas isso não se propaga sozinho —
exige `supabase config push`, que não foi executado). Sem SMTP configurado,
ligar a confirmação sem mais nada trava a aceitação de convite para todo
mundo; conferir os dois — confirmação e SMTP — antes do primeiro convite real.

## Conexões de WhatsApp (multi-tenant)

A migration `20260814140000_whatsapp_connections.sql` acrescenta o domínio das
conexões: `whatsapp_connections`, `whatsapp_device_sessions`,
`connection_installations`, `connection_hosts` e `connection_events`. A unidade
operacional é a **conexão**, não o número e não o processo — ver
[ADR-001](../ADR-001-CONEXOES-MULTITENANT.md).

O que essa migration garante além do `organization_id`:

- FKs compostas `(id, organization_id)` em toda referência entre as tabelas
  novas, mais um gatilho que recusa vincular uma sessão ou instalação a uma
  conexão de outro tenant com erro legível;
- índice único que impede a **mesma identidade verificada** de estar ativa em
  duas organizações, sem impedir sessões `web` e `bridge` da mesma conexão —
  que é o caso atual e não é duplicidade;
- índice único de uma sessão `bridge` ativa por conexão;
- telefone gravado só como hash com sal (`connection_id`) e últimos quatro
  dígitos; JID completo nunca entra em claro;
- `connection_installations` legível apenas por administrador: a linha guarda o
  hash de uma credencial de acesso ao runtime;
- `transfer_whatsapp_connection`, o único caminho para mover uma identidade
  entre organizações — exige administração dos dois lados, revoga sessões e
  instalações da origem e grava eventos nas duas pontas.

**Aplicada em 14/08/2026** por `supabase db push`, junto de
`20260814170000_reconciliar_conexao_8362.sql`, que registra a conexão que já
estava rodando no WSL.

### O histórico estava vazio

As três primeiras migrations foram aplicadas à mão pelo SQL Editor, então a
tabela de histórico do Supabase não as conhecia — `migration list` mostrava a
coluna `Remote` em branco para todas. Um `db push` cru teria tentado recriar a
inicial e quebrado em *type already exists*.

O que foi feito, e por quê:

- `migration repair --status applied 20260812130000` — só a inicial. É a única
  não idempotente (`create type`, `create table` sem `if not exists`).
- As outras duas foram deixadas rodar de novo: uma usa
  `drop policy if exists`, a outra `create or replace function`. Rodar é seguro
  e garante que o banco bate com o arquivo — melhor que marcá-las como aplicadas
  no escuro.

Daqui em diante o histórico está íntegro e `db push` funciona direto.

### Verificação feita

- `migration list`: as cinco migrations com `Local` e `Remote` preenchidos.
- A reconciliação emitiu `NOTICE: conexao … reconciliada`, que só é alcançado
  depois de a guarda confirmar que a organização existe e de os três `insert`
  passarem por FKs, checks e gatilhos.
- Acesso anônimo às quatro tabelas novas via PostgREST: **HTTP 401, `42501`**.
  O papel `anon` não tem grant nenhum — a negação acontece antes mesmo da RLS.

### O que ainda falta testar

O teste de isolamento com **dois tenants autenticados** — usuário da
organização A não lista nem comanda conexão de B. Isso exige duas sessões reais
de usuário e não foi feito. Enquanto não for, "RLS ativa" é uma afirmação sobre
o schema, não sobre o comportamento.

## Aplicação inicial

A migration `20260812130000_initial_saas.sql` foi aplicada ao projeto
`lwoqcvuspsmfowiuipmv` pelo SQL Editor em 12/08/2026. A validação remota confirmou
as 11 tabelas, RLS ativo em todas elas, o bucket privado `contact-avatars` e as
cinco funções públicas de Auth/organização.

## Ambiente local de banco: ausente

`supabase start` e `supabase test db` exigem Docker, e **não há Docker nem
Postgres nesta máquina** — nem no Windows, nem no WSL. Isso não bloqueia a
Fase A, porque a validação pendente é no projeto hospedado.

Consequência prática: migrations e testes SQL deste diretório são escritos e
revisados, mas não podem ser executados localmente; qualquer afirmação de que
uma migration "passa" aqui seria apenas sobre leitura, não sobre execução.
