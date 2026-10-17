# Painel da plataforma (painel.nucleomajor.com) + funções e limites por empresa

> **Status (23/09/2026):** planejado, **não executado**. A execução espera o pedido do dono.

## Contexto

Hoje o controle das empresas clientes está espalhado:

- um cartão **"Administração do Núcleo Major"** dentro de Configurações, no app, com a liberação manual, as vendas do Asaas e os pedidos de conexão;
- o resto é **SQL feito à mão**. Os 90 dias da Adriane, por exemplo, foram aplicados assim em 23/09/2026.

O que cada empresa pode usar vem **só do plano** (`saas_plans.features` e `saas_plans.limits`). Não existe exceção por empresa. Para liberar o chatbot para um cliente, seria preciso trocar o plano inteiro dele.

**O dono quer:**

- um painel em **painel.nucleomajor.com**;
- nele, ver as empresas, o plano, a data de fim e o uso;
- estender, encerrar ou trocar o plano;
- **ligar e desligar cada função por empresa**, inclusive funções novas criadas sob medida para alguns clientes;
- ajustar o **limite de números de WhatsApp**, que começa em 1.

**Decisões do dono (23/09/2026):**

1. O painel é só para **`cmo@majorhub.com.br`**.
2. **Todos** os interruptores podem ser ajustados por empresa, e o limite de WhatsApp também.
3. Função nova nasce **desligada para todos**. O dono liga para quem quiser.
4. As funções de IA também podem ser ligadas por empresa, mas com confirmação e aviso: custam (a conta do Claude é da Major) e exigem o WhatsApp próprio do cliente e a configuração na VPS.

**O que os levantamentos mostraram:**

- **Admin da plataforma já existe:** a tabela `public.platform_admins` e a função `private.is_platform_admin()` (migration `20260823090000`).
- **Os interruptores atuais**, em `saas_plans.features`:

  | Chave | O que é |
  |---|---|
  | `crm` | contatos, funil, tarefas |
  | `agenda` | agenda |
  | `team_management` | equipe |
  | `whatsapp_web` | conversas no portal |
  | `chatbots` | chatbots |
  | `knowledge` | base de conhecimento |
  | `ai_customer` | IA atendendo clientes |
  | `ai_team` | assistente da equipe |
  | `whatsapp_official` | API oficial, futuro |
  | `assistant` | compatibilidade: "tem alguma IA" |

- **Limites atuais**, em `saas_plans.limits`: `connections = 1` e `members`/`contacts` sem limite. O pedido de conexão já respeita `limits.connections` (`20260921100000`, por volta da linha 149).
- **No banco**, `private.org_has_feature` é consultada para `ai_customer`, `ai_team` e `whatsapp_web`.
- **No portal**, só **Inteligência e Chatbots** têm trava de tela (`Gestao.jsx`, `RECURSO_DA_TELA`), mais o assistente da equipe em `Equipe.jsx`. Contatos, Funil, Tarefas, Agenda, Equipe, Conversas e Conexões **não têm trava**.
- **Risco atual:** em `apps/emyleads/src/page/plano.js`, `planoLibera` devolve **`true` para função desconhecida** (`default: return true`). Uma função nova apareceria para todos.

---

## Etapa 1 — Funções e limites por empresa (banco + portal)

**Resultado:** o dono consegue, mesmo antes do painel e por uma função do banco, ligar o chatbot só para uma empresa ou dar a ela 2 números de WhatsApp. O portal, o servidor e a VPS respeitam isso sozinhos.

### 1.1 Catálogo de funções

Migration nova: `20260924100000_funcoes_e_limites_por_empresa.sql`.

- Tabela `public.platform_features`:
  - colunas `key` (pk), `name`, `description`, `category` (`gestao` | `atendimento` | `ia` | `limite`), `is_ai boolean`, `kind` (`feature` | `limit`) e `created_at`;
  - semeada com as 9 chaves acima (sem `assistant`, que continua só por compatibilidade) e o limite `connections`;
  - nomes em português, que o painel mostra.
- Leitura só para admin da plataforma. Ninguém escreve direto.

### 1.2 Ajustes por empresa

- Tabela `public.organization_entitlements`:
  - colunas `organization_id`, `key` (referencia `platform_features`), `enabled boolean` (para `kind = feature`), `limit_value integer` (para `kind = limit`; `null` = sem limite), `expires_at timestamptz null`, `note text`, `set_by uuid` e `set_at`;
  - chave primária `(organization_id, key)`;
  - RLS ligado, sem política de escrita: só funções `SECURITY DEFINER` mexem nela.
- Ajuste com `expires_at` no passado é **ignorado**, e a empresa volta ao que o plano diz. Assim "ligado por 15 dias" funciona sem rotina nenhuma.

### 1.3 A regra: ajuste vence plano

- `private.org_features(org) returns jsonb`: `plan.features` sobrescrito pelos ajustes válidos.
- `private.org_limits(org) returns jsonb`: o mesmo, para `plan.limits`.
- `private.org_has_feature(org, key)` passa a ler de `org_features`, **mantendo o nome e a assinatura**, porque as cascas da trava de IA (`20260920110000`) chamam essa função. A regra "chave específica vence `assistant`" continua.
- `public.organization_access_state` devolve `features` e `limits` **já combinados**. Assim o portal e o servidor passam a respeitar os ajustes sem mudar a forma de ler.
- `public.nucleo_connection_request` passa a ler o limite de `org_limits`.
- **A Major (plano `full`) não muda.** Sem ajustes, o resultado é idêntico ao de hoje, e uma guarda no fim da migration confere isso.

### 1.4 Função do banco para ajustar (antes do painel)

- `public.platform_entitlement_set(target_org, key, enabled, limit_value, expires_at, note)`:
  - exige `is_platform_admin()`;
  - valida a chave no catálogo e o tipo (feature ou limite);
  - grava o ajuste e o **histórico** (item 2.1).
- `public.platform_entitlement_clear(target_org, key)`: volta ao plano.
- Ligar uma chave com `is_ai = true` exige o parâmetro `confirm_ai => true`. Sem ele, a função recusa com a mensagem *"ligar IA exige WhatsApp próprio e configuração na VPS"*.

### 1.5 Portal: travas em todas as telas e "desconhecida = desligada"

- `plano.js`:
  - `planoLibera` devolve **`false` para chave desconhecida**;
  - ganha os casos `crm`, `agenda`, `team_management` e `whatsapp_web`.
- `Gestao.jsx`, `RECURSO_DA_TELA`:

  | Telas | Chave |
  |---|---|
  | contatos, funil, tarefas | `crm` |
  | agenda | `agenda` |
  | equipe | `team_management` |
  | conversas, conexões | `whatsapp_web` |
  | conhecimento | `inteligencia` (como hoje) |
  | chatbots | `chatbots` (como hoje) |

- O aviso da tela bloqueada muda de *"Disponível nos planos com IA"* para um texto genérico: *"Esta função não está liberada para a sua empresa. Fale com a Major."*
- Se a leitura do estado falhar, o portal continua **sem trancar ninguém**. É o comportamento de hoje (`AuthGate.jsx`, o `catch` que devolve `estado: "ok"`), e a trava de verdade mora no banco.
- **Conexões:** o botão "Pedir WhatsApp" mostra *"Sua empresa já usa N de N números"* quando o limite foi atingido.

### 1.6 Servidor

- `requireAssistantPlan` (`src/server.mjs`) lê as features combinadas (`organization_access_state`), não mais `saas_plans` direto.

### 1.7 Provas e testes

- Prova em PGlite, `scripts/sql/prova-funcoes-por-empresa.mjs`, com todas as migrations reais:
  - ajuste liga o chatbot para uma empresa Base e só para ela;
  - ajuste vencido volta ao plano;
  - limite 2 deixa pedir o 2º WhatsApp, e o 3º é recusado;
  - ligar IA sem `confirm_ai` é recusado;
  - quem não é admin é recusado;
  - a Major fica idêntica antes e depois;
  - a trava de IA das cascas respeita o ajuste.
- `npm test`:
  - `plano.test`: desconhecida = false, as novas chaves;
  - `Gestao.plano.test`: cada tela com a sua chave;
  - teste do limite em Conexões;
  - `assistant-plan.test`: features combinadas.

---

## Etapa 2 — O painel em painel.nucleomajor.com

**Resultado:** o dono entra em painel.nucleomajor.com com `cmo@majorhub.com.br`, vê todas as empresas e faz tudo sem SQL, com histórico de cada ação.

### 2.1 Histórico (banco)

- Tabela `public.platform_audit_log`:
  - colunas `id`, `at`, `actor` (uuid), `actor_email`, `organization_id`, `action`, `before jsonb`, `after jsonb` e `note`;
  - só inserção por função `SECURITY DEFINER`, leitura só para admin, **nunca** `update`/`delete`.
- Toda função `platform_*` que altera algo grava uma linha.

### 2.2 Funções do painel (banco)

Migration: `20260924110000_painel_da_plataforma.sql`. Todas exigem `is_platform_admin()`.

| Função | O que faz |
|---|---|
| `platform_organizations_list()` | Nome, dono (e-mail), plano, situação (`ok`/`past_due`/`blocked`), status da assinatura, **fim do período**, origem (Asaas/manual), criada em, membros, contatos, números de WhatsApp em uso/limite, último sinal da VPS, último acesso do dono. |
| `platform_organization_detail(org)` | Tudo o que a lista mostra, mais funções (plano × ajuste × resultado), limites, vendas do Asaas ligadas e as últimas 50 linhas do histórico. |
| `platform_organization_set_period(org, ends_at, renew boolean)` | **Estender** a data de fim. Com `renew=false`, fica "pago até, sem renovação" (`status='canceled'`); com `renew=true`, `status='active'`. |
| `platform_organization_end_now(org, note)` | **Encerrar agora**: fim = `now()`, bloqueia na hora. Exige nota. |
| `platform_organization_set_plan(org, plan_code)` | **Trocar o plano.** Os ajustes da empresa continuam valendo. |
| `platform_entitlement_set` / `_clear` | Os da etapa 1, agora com histórico. |
| Já existentes | Liberação manual (`issue_onboarding_access`), vendas do Asaas (`billing_subscriptions_admin_list`, `billing_activation_rotate`), pedidos de conexão (`platform_connection_requests_list`). Mudam de lugar, do app para o painel. |

Empresa com assinatura do **Asaas**: estender ou encerrar pelo painel mexe só no acesso, não na cobrança. O painel avisa: *"a cobrança continua no Asaas; cancele lá também"*.

### 2.3 O front do painel

- Nova entrada do Vite, `apps/emyleads/painel.html` + `src/painel/`. Reaproveita os componentes do portal (botões, tabelas, `authProvider`) e compila para `public/painel/`.
- **Telas:**
  1. **Empresas:** tabela com busca e filtro por plano/situação, e alerta de "vence em até 7 dias".
  2. **Empresa:**
     - cabeçalho (plano, situação, fim do período);
     - ações (estender +30/+90/data, encerrar, trocar plano);
     - **interruptores** (cada linha: nome, o que o plano diz, ajuste, prazo do ajuste, resultado);
     - limite de WhatsApp;
     - uso;
     - histórico.
  3. **Liberar acesso:** a liberação manual que hoje está em Configurações.
  4. **Vendas do Asaas** e **Pedidos de WhatsApp:** os cartões de hoje.
- Confirmação antes de encerrar, trocar plano para baixo ou ligar IA.
- O cartão "Administração do Núcleo Major" **sai** de Configurações do app, que fica só com um link para o painel.

### 2.4 O subdomínio

- **Servidor (`src/server.mjs`):** quando o `Host` é `painel.nucleomajor.com`:
  - serve `public/painel/` em `/`;
  - as rotas `/api/*` continuam as mesmas;
  - qualquer caminho do app (`/app/*`) nesse host redireciona para `https://nucleomajor.com/app`.
- **Sessão separada:** outro subdomínio tem outro `localStorage`. O login do painel não se mistura com o do app, o que evita o conflito visto na ativação da Adriane (`docs/checkout/MELHORIAS-ATIVACAO-E-EMAILS.md`, item 2 B).
- **Quem entra:** qualquer usuário logado que **não** está em `platform_admins` vê *"Acesso restrito"* e o botão Sair. A trava de verdade é o banco (2.2).
- **Configuração que é do dono**, na hora da publicação:
  1. **DNS:** registro `painel` apontando para a hospedagem (o mesmo destino de `nucleomajor.com`);
  2. **Hostinger:** acrescentar `painel.nucleomajor.com` como domínio do mesmo app Node, com SSL;
  3. **Supabase → URL Configuration:** acrescentar `https://painel.nucleomajor.com/**`. Isso eu posso fazer pelo navegador com autorização.
- `cmo@majorhub.com.br` precisa estar em `platform_admins`. Conferir na aplicação: é quem já usa o cartão de administração hoje.

### 2.5 Testes

- Prova em PGlite, `scripts/sql/prova-painel-da-plataforma.mjs`:
  - não-admin recusado em todas as funções;
  - estender, encerrar e trocar plano mudam o `org_access_state` como esperado;
  - cada ação grava o histórico com o antes e o depois;
  - `update`/`delete` no histórico é recusado.
- `npm test`:
  - telas do painel (lista, detalhe, interruptores, confirmação de IA, acesso restrito);
  - servidor (roteamento por `Host`, redirecionamento do `/app` no painel).
- `npm run build` gera `public/painel/`.

---

## Depois (fora das etapas 1 e 2)

- **Uso de IA por empresa:** tabela `intelligence_usage_daily` e uma chamada do runtime a cada `run.completed` (patch na VPS). O painel mostra os turnos dos últimos 30 dias e alerta perto do limite do Claude, que é compartilhado.
- **Verificação em duas etapas** para o admin (MFA TOTP do Supabase), com as funções `platform_*` exigindo `aal2`.
- **Aviso automático** para a equipe 7 dias antes do fim do período.
- **Prazo na liberação manual**: o campo "Acesso até" na própria liberação (`MELHORIAS-ATIVACAO-E-EMAILS.md`, item 4).

## Ordem de aplicação (cada passo com sua autorização)

1. **Banco:** as migrations da etapa 1 e depois da etapa 2, pelo SQL Editor, cada uma com a sua conferência.
2. **Portal e servidor:** merge na `main`, e a Hostinger publica. As travas da etapa 1 passam a valer no app e o painel já responde pelo roteamento, mas ainda sem domínio.
3. **Subdomínio:** o DNS e a Hostinger (o dono), e depois a Redirect URL no Supabase.
4. **Conferência:** entrar no painel com o cmo, ligar o chatbot numa empresa de teste, ver a tela aparecer no app dela, desligar e ver sumir, e conferir o histórico.

## Verificação

- Provas em PGlite com todas as migrations reais (etapas 1 e 2): tudo PASS.
- `npm test` e `npm run build` verdes.
- Ao vivo:
  1. a Major continua com tudo, sem nenhum aviso de "não liberado";
  2. a Adriane (Base) **não** vê Chatbots nem Inteligência; ligar o chatbot para ela pelo painel faz a tela aparecer no app dela; desligar faz sumir;
  3. o limite de WhatsApp dela é 1, e o 2º pedido é recusado com a mensagem certa;
  4. o histórico mostra as duas ações, com o cmo como autor.

## Riscos e cuidados

- **Travar telas que hoje estão abertas (etapa 1.5)** muda o que todo cliente vê. Todos os planos têm `crm`, `agenda`, `team_management` e `whatsapp_web` ligados, então ninguém perde nada. Mesmo assim, a prova confere a Major e a Adriane antes de publicar.
- **`planoLibera` com "desconhecida = false":** se o portal publicar antes da migration, uma chave nova que o banco ainda não mande ficaria desligada. Aplicar o banco **antes** do portal.
- **IA ligada por ajuste sem a VPS pronta** deixa o cliente mudo. Por isso existe o `confirm_ai` e o aviso no painel.
