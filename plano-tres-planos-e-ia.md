# Três planos no Asaas (mensal e anual) + IA mínima para o primeiro cliente

> **Status (22/09/2026):** Partes A e B **escritas e commitadas**, nada aplicado nem publicado.
>
> - **Parte A** (banco, servidor e portal) — branch `feat/checkout-asaas`, commit `a596181`. Provas em PGlite: checkout 86, trava de IA 42, pedido de conexão 23, habilidades de empresa nova 10 — todas PASS; `npm test` verde.
> - **Parte B** (runtime da VPS) — branch `feat/provisionar-conexao-de-cliente`, commit `15508c5`. Suítes: assistente 303, MCP 54, scripts da VPS 22 — todas OK.
> - **Parte C** (links no Asaas, ensaio e primeiro cliente) — não começou; é do dono.
>
> **Migrations APLICADAS em produção em 22/09/2026**, as quatro, na ordem, pelo SQL Editor (colei e executei pelo navegador com autorização do dono para aquela sessão). Cada uma conferida por consulta ao catálogo:
>
> - `20260920100000`: 4 planos com as chaves certas, 4 tabelas `billing_*` com RLS, `anon` só chama o webhook, a Major continua liberada, webhook ainda desligado (0 `billing_intakes`).
> - `20260920110000`: as 4 funções vivas em `private` sem execução direta; as 4 cascas em `public` conferem o plano, `authenticated` executa, `anon` não.
> - `20260921100000`: `nucleo_connection_request` e `platform_connection_requests_list` só para `authenticated`; a conexão da Major segue `connected`.
> - `20260921110000`: gatilho novo ativo; as 7 habilidades que ele vincula existem publicadas; a Major (única empresa) com 12 vínculos, não tocados.
> - Todas as funções novas gravadas sem CR.
>
> **Atendimento da Major conferido pelo dono em 22/09:** a IA segue respondendo os clientes depois das migrations.
>
> **Falta:** BLOCO 1 e 2 de `ligar-checkout-asaas.sql` (dependem da Parte C); publicar o portal; implantar o runtime.
>
> **Sobra antiga encontrada:** `public.create_organization(text)`, a versão de antes do checkout, ainda existe e o `anon` pode executá-la. Não é brecha ativa — ela recusa quem não está logado (`authentication required`) e `authenticated` não tem permissão —, mas vale uma migration de limpeza (`revoke ... from anon` ou `drop`).

## Contexto

As Levas 1–3 do checkout já estão commitadas, mas **nada foi aplicado nem publicado**:

- **portal:** branch `feat/checkout-asaas` — `ad03323`, `c0956ec`, `7fb89f8`;
- **runtime:** branch `feat/provisionar-conexao-de-cliente` — `5af5919`.

Hoje existe um plano vendável, o Base (sem IA), e um único interruptor de IA (`assistant`). O dono quer:

- **três planos:** Base · Atendimento com IA · Completo;
- **forma de pagamento:** todos pelo Link de Pagamento do Asaas; o cliente escolhe entre cartão (cobrança automática) e Pix/boleto;
- **ciclo:** mensal e anual;
- **primeiro cliente:** entra com IA e usando a **conta do Claude da Major**, com o limite compartilhado aceito.

As migrations das Levas 1–3 ainda não foram aplicadas, então são corrigidas no próprio arquivo, em commits novos na branch.

**O que os levantamentos mostraram:**

1. **Empresa nova nasce sem as habilidades certas.**
   - O agente de clientes não tem `recepcao` nem `solicitacao-agenda`, e ainda leva `agenda`.
   - O interno não tem `tarefas`.
   - Hoje isso só se corrige se o dono passar pelo Piloto.
   - Com o roteador `_v3`, a falta de `recepcao` faz o cliente final receber "atendimento temporariamente indisponível".
2. **Turno de cliente sem agente recebe as ferramentas `mcp__whatsapp__*` e o WebSearch** (`runner.py:289-292`).
   - No rollout, o `agent_id` sempre chega vazio. Isso vale hoje para a Major também.
   - Corrigir o MCP do WhatsApp sem fechar isso antes deixaria um lead ler as outras conversas.
3. **O MCP do WhatsApp aponta para caminhos fixos:** `whatsapp.py:10-15` fixa um `messages.db` no repositório e a porta 8080.
4. **Conexão nova nasce com o freio da IA puxado:** `ia_ativa=0` no `arbitro.db`.
5. **O `notify_url` padrão do Bridge aponta para a 8090 da Major.** Sem config explícita, o Bridge do cliente mandaria para lá.
6. **Defeito no script da Leva 3:** ele não gera `WHATSAPP_HUMAN_SEND_TOKEN`, então **o cliente não conseguiria enviar pelo portal**.
7. **Textos "Major" que chegam a terceiros:**
   - ao cliente final: `worker.py:160`;
   - à equipe do cliente: `worker.py:167`, `177`, `185`, `2529`, `1197`; `main.go:380`; `agenda_notifications.py:258`;
   - no histórico do prompt: `worker.py:2294`, `2298`.
8. **Atendimento sem turno de dono:** basta `owner` igual ao número da própria conexão. As mensagens dele chegam como `IsFromMe` e são descartadas (`notify.go:115-117`).

---

## Parte A — banco, servidor e portal (branch `feat/checkout-asaas`)

### A1. Planos, com nomes padrão renomeáveis por `UPDATE saas_plans set name`
Arquivo: `20260920100000_o_pagamento_libera_a_empresa.sql`.

| código | nome | `ai_customer` | `ai_team` | `assistant`* | `knowledge` | `chatbots` |
|---|---|---|---|---|---|---|
| `base` | Base | false | false | false | false | false |
| `atendimento` | Atendimento com IA | true | false | true | true | true |
| `completo` | Completo | true | true | true | true | true |
| `full` (Major) | Full | true | true | true | true | true |

\* `assistant` passa a significar "tem alguma IA" (compatibilidade). O plano `full` recebe as duas chaves novas por `features || jsonb`.

- `crm`, `agenda`, `team_management` e `whatsapp_web` ficam `true` nos três planos.
- `limits.connections = 1` nos três.
- A guarda de "empresa que já existia não pode ficar bloqueada" continua valendo.

### A2. Ciclo mensal/anual (mesma migration)
- `billing_payment_links.billing_cycle`: `MONTHLY` | `QUARTERLY` | `SEMIANNUALLY` | `YEARLY`, padrão `MONTHLY`. O valor é copiado para `billing_subscriptions.billing_cycle` na criação.
- O período pago passa a ser calculado pelo ciclo (`vencimento + 1, 3, 6 ou 12 meses`), tanto na primeira compra quanto nas renovações.
- Consequências:
  - cancelar um plano anual vale até o fim dos 12 meses;
  - atraso segue a regra do aviso por 7 dias.
- `scripts/sql/ligar-checkout-asaas.sql`, BLOCO 2: **seis linhas** (3 planos × mensal/anual), cada uma com o seu `COLE_AQUI…`.
- `conferir-checkout-asaas.sql`: lista quais planos e ciclos têm link. Basta um.

### A3. Trava de IA em dois interruptores
Arquivo: `20260920110000_plano_sem_ia_nao_chama_o_claude.sql`.

A técnica de mover a função viva para `private` e deixar uma casca pública continua. Mudam as condições:

- **`nucleo_customer_assistant_access` e `customer_assistant_rollout_update`** (pilot/active) exigem `ai_customer`.
- **`resolve_v2`/`_v3`:** a casca consulta `public.nucleo_operator_context(requester_phone)` na organização do robô, o mesmo critério que o `_v2` usa para decidir se o turno é interno.
  - operador → exige `ai_team`;
  - demais → exige `ai_customer`;
  - sem nenhum dos dois, recusa como hoje.
- **A Major segue idêntica:** o `full` tem as duas chaves. A prova de antes e depois continua valendo.

### A4. Empresa nova nasce com as habilidades certas
Migration nova: `20260921110000_empresa_nova_nasce_com_as_habilidades.sql`.

- Cria a função `private.provision_intelligence_vinculos(org)` e um gatilho `organizations_provision_intelligence_vinculos`, AFTER INSERT em `organizations`. O nome ordena depois do gatilho atual, então roda depois dele. A função atual (hash `2ce57ef0…`) não é tocada.
- Vínculos, com as mesmas prioridades da sincronização e do Piloto:
  - **interno padrão:** `agenda` 10 e `tarefas` 20;
  - **clientes padrão:** `recepcao` 10, `pre-qualificacao` 20, `vendas` 30, `suporte` 40 e `solicitacao-agenda` 50, removendo `agenda`.
- Skill não publicada é pulada.
- Não roda para as empresas existentes: a Major não é tocada.
- Não chama `intelligence_scheduling_bindings_sync`, que exige um membro que ainda não existe no momento do gatilho.

### A5. Servidor
- `requireAssistantPlan` (`/api/assistant`) passa a exigir `ai_team`.
- O aviso de pedido de conexão e o comando da VPS levam o código do plano: `--plano base|atendimento|completo`.

### A6. Portal
- `Gestao.jsx`, `telaLiberada`:
  - Inteligência aparece com `ai_customer` ou `ai_team`, com fallback para `assistant`;
  - Chatbots aparece com `chatbots`;
  - o texto "Disponível nos planos com IA" nomeia os planos.
- `Equipe.jsx`: a verificação de operador pelo WhatsApp só aparece com `ai_team`. Sem ela, a tela diz "o assistente da equipe faz parte do plano Completo".
- `Configuracoes.jsx`, liberação manual: seletor de plano, lido de `saas_plans` (a policy já permite select). A lista de vendas mostra o nome do plano e o ciclo.
- Os dois `authProvider` ganham a operação `plataforma.planos`.

### A7. Provas e testes
- `prova-checkout-asaas.mjs`:
  - os três planos;
  - link anual dá 12 meses;
  - renovação anual;
  - cancelamento anual vale até o fim do período.
- `prova-plano-sem-ia.mjs`:
  - `atendimento`: cliente passa, operador é recusado;
  - `completo`: os dois passam;
  - `base`: nenhum passa;
  - `full`: idêntico antes e depois.
  - O operador é criado com um registro ativo em `whatsapp_connection_operators`.
- Prova nova `prova-habilidades-de-empresa-nova.mjs`: a empresa nova tem 2 vínculos internos e 5 de clientes, sem `agenda`; uma empresa criada antes da migration fica intacta.
- `npm test`: ajustes em `billing.test.mjs`, `assistant-plan.test.mjs`, `Gestao.plano.test.js` e nos testes de Equipe e de Configurações.

---

## Parte B — runtime da VPS (branch `feat/provisionar-conexao-de-cliente`)

**B1. Turno de cliente nunca recebe as ferramentas de WhatsApp nem a busca na web**
- `runner.build_command` recebe `customer_turn`, e `external_skill_context = … or customer_turn`.
- `worker.py`, na chamada de `customer_intelligence_turn`, passa o sinal.
- Testes em `test_runner.py` e `test_worker.py`.
- **Muda a Major também:** fecha um vazamento que existe hoje.

**B2. MCP do WhatsApp por conexão**
- `whatsapp-mcp-server/whatsapp.py:10-15` passa a ler do ambiente, que já é herdado do assistente (`runner.py:403`):
  - `ASSISTANT_MESSAGES_DB`, `WHATSAPP_API_BASE_URL` (default 8080) e `WHATSAPP_OUTBOX_DIR`.
- SQLite aberto só para leitura (`mode=ro`).
- Falha fechado quando `EMYLEADS_RUNTIME_CONNECTION_ID` existe e `ASSISTANT_MESSAGES_DB` não.
- Vai no mesmo commit que B1, ou depois dele.

**B3. Nome da empresa nos textos**
- `config.py` ganha `ASSISTANT_BRAND_NAME`, com default "Major", para a Major não mudar.
- Os textos de `worker.py` (lista 7 do Contexto) usam `{marca}`, com a frase reescrita para não depender de "da/do".
- `agenda_notifications.py:258` passa a usar a mesma variável.
- `whatsapp-bridge/main.go:380` lê `os.Getenv("ASSISTANT_BRAND_NAME")`, com o mesmo default. Isso exige build do Bridge na release nova; o Bridge da Major não é reiniciado.
- Os testes que comparam o texto da Major (`test_worker.py:2066`, `2171`, `1823`) continuam passando por causa do default.

**B4. `scripts/vps/provision-connection.sh` com os três planos**
- **Todos os planos:**
  - gera `WHATSAPP_HUMAN_SEND_TOKEN` nos dois `.env` (corrige o defeito 6);
  - `NUCLEO_TOOL_AUDIT_PATH=$STATE_DIR/tool-audit.jsonl` e `WHATSAPP_OUTBOX_DIR=$STORE_DIR/outbox`;
  - `ASSISTANT_BRAND_NAME`, com o nome da empresa lido do banco.
- **Conferência do plano:** o script lê `ai_customer` e `ai_team` do banco e exige que batam com `--plano`.
- **`atendimento` e `completo`:**
  - Exigem `--dono <celular pessoal do dono>`, usado em `ASSISTANT_OWNER` e `EMYLEADS_HANDOFF_NOTIFY_PHONES` (os avisos de transferência vão para ele).
  - Opcionais: `--equipe "Ana,Bruno"` (padrão "atendente") e `--fuso`, padrão `America/Sao_Paulo`.
  - `NUCLEO_INTELLIGENCE_ROUTING_MODE`: o mesmo da Major, lido do `.env` dela na VPS.
  - `ASSISTANT_CLAUDE_CONFIG_DIR=$HOME/.config/claude/<conexão>`, sem `/bin/false`.
  - **Login do Claude:** se a pasta não tiver login, o script para com a instrução `CLAUDE_CONFIG_DIR=… claude` → `/login` com a conta da Major. Rodar de novo continua de onde parou.
  - **Config do Bridge** (`$STORE_DIR/config.json`, 0600), gravada antes da primeira partida:
    - `enabled: true` e `customer_inbound: true`, janela de 900 s;
    - `notify_url` na porta do assistente;
    - `allow_unlisted` igual ao da Major, lido da config dela;
    - **no `atendimento`:** `owner` = número da própria conexão, `operators: []`;
    - **no `completo`:** `owner` = celular do dono e `operators` vindo de `--operadores`; `EMYLEADS_OPERATOR_TRIGGER=/ia`.
  - Liga `ia_ativa` no `arbitro.db` usando a própria classe `Arbitro`.
- **Mudar de plano:** `--atualizar` faz upsert das chaves do `.env` (padrão `upsert_env` do `provision-notification-worker.sh`), regrava a config do Bridge e reinicia as duas units.
- Script pequeno `scripts/vps/connection-operators.sh <conexão> add|remove <telefone>` para o Completo: altera `operators` e reinicia o Bridge daquela conexão.
- **Testes:** `test_provision_connection.py` ganha os três planos, a falta de login, o `--atualizar`, a config do Bridge e a presença do token de envio. A suíte do assistente e a do MCP rodam com `uv run python -m unittest discover`.

---

### O que a execução mudou no plano da Parte B

- **O modo de roteamento da Major é `active`** (lido na VPS, só leitura). Ou seja, o `_v3` é quem responde hoje — o que confirma por que a migration `20260921110000` é necessária: sem o vínculo `recepcao`, todo turno de cliente novo receberia "atendimento temporariamente indisponível".
- **O script não adivinha mais o modo.** Ele copia do `.env` do assistente da Major, identificado pela porta 8090 — e não do primeiro `.env` da pasta, porque todo cliente do plano Base tem `NUCLEO_INTELLIGENCE_ROUTING_MODE=off` gravado e o `off` de um cliente sem IA acabaria copiado para um cliente que comprou IA. Se não achar a chave, o script **para e pede `--roteamento`**, em vez de escolher por conta.
- **`whatsapp-bridge/store` não existe na release da VPS.** As ferramentas de leitura do WhatsApp da Major liam um banco que não está lá, ou seja, estavam quebradas; a correção do MCP por conexão (B2) passa a apontá-las para o banco real da conexão.
- **`scripts/vps/connection-operators.sh`** mexe em `assistant.operators` e `allowed_recipients` **juntos**: só em `operators`, o operador falaria e não seria respondido.

## Parte C — Asaas e primeiro cliente

1. **Seis Links de Pagamento no Asaas:**
   - planos Base, Atendimento com IA e Completo, cada um em mensal e anual;
   - cobrança recorrente;
   - forma de pagamento "o cliente escolhe": cartão ou boleto/Pix;
   - os valores são seus.
   Os IDs vão para o BLOCO 2.
2. **Roteiro do primeiro cliente com IA**, depois do ensaio no sandbox:
   1. ele paga pelo link do Atendimento ou do Completo;
   2. ativa a empresa;
   3. pede o WhatsApp;
   4. você roda o script com `--plano … --dono …` e faz o login do Claude;
   5. ele lê o QR;
   6. preenche o Conhecimento;
   7. testa no Simulador;
   8. liga a Liberação em **Ativo**, depois de testar com poucos contatos.

   Evite o Piloto: ele cria uma campanha chamada "Piloto Atendimento Major", que aparece para ele.

## Ordem de aplicação (cada passo com sua autorização)

1. **SQL Editor, na ordem:** `20260920100000`, `20260920110000`, `20260921100000`, `20260921110000`, cada um com a sua conferência.
2. **Portal:** merge da branch na `main`. A Hostinger publica sozinha.
3. **Leituras na VPS antes do runtime:** modo de roteamento da Major, `config.json` da Major, pasta `whatsapp-bridge/store`, tabela do árbitro.
4. **Runtime:** patch → release nova com o build do Bridge → suíte na VPS → symlink → reiniciar **só o assistente** da Major. Conferir que o atendimento da Major segue igual e que, nos turnos de operador, as ferramentas de WhatsApp agora leem o banco dela.
5. **Asaas:** os links no sandbox.
6. **Ensaio:** Base e depois Atendimento com um número de teste. Só então os links de produção.

## Verificação
- Provas em PGlite, com todas as migrations reais: checkout, trava de IA em dois interruptores, pedido de conexão e habilidades de empresa nova. Tudo PASS.
- `npm test`: servidor e app verdes.
- Runtime: suíte do assistente, do MCP, `go test` do Bridge (se houver gcc; senão, na VPS) e `test_provision_connection.py`.
- Ensaio no sandbox:
  1. compra;
  2. ativação;
  3. pedido de WhatsApp;
  4. script;
  5. QR;
  6. envio pelo portal funcionando;
  7. mensagem de outro número respondida pela IA, com o nome da empresa;
  8. transferência avisando o celular do dono;
  9. a Major atendendo normalmente.

## Limites conhecidos (ficam para depois)
- O limite de uso do Claude é o mesmo da Major: um cliente com muito volume pode esgotar a IA da Major.
- A campanha do Piloto se chama "Piloto Atendimento Major".
- Não há Pix Automático; ele é um produto separado do Link de Pagamento.
- O número de cada conexão é conferido só pelos 4 últimos dígitos.
- Ainda não há trava automática contra o mesmo número em duas empresas.
