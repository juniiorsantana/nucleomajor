# Painel da plataforma e funções por empresa

Este roteiro leva duas entregas até produção, **nesta ordem**:

1. **Etapa 1, funções e limites por empresa.** Cada empresa pode ter uma
   função ligada ou desligada por cima do plano, com prazo opcional. O portal
   passa a travar todas as telas pelas chaves do plano.
2. **Etapa 2, o painel em `painel.nucleomajor.com`.** O dono vê as empresas,
   estende, encerra, troca o plano e liga ou desliga funções, sem SQL à mão e
   com histórico de cada ação.

Branch: `feat/painel-da-plataforma`. O plano completo e as decisões estão em
`plano-painel-da-plataforma.md`, na pasta acima do repositório.

## O que muda

- **Banco, etapa 1** (`20260924100000_funcoes_e_limites_por_empresa.sql`):
  - o catálogo `platform_features`, com 9 funções e o limite `connections`;
  - os ajustes por empresa `organization_entitlements`. O ajuste vence o plano
    enquanto não vence o prazo;
  - o histórico `platform_audit_log`, que só aceita inserção;
  - `organization_access_state`, `org_has_feature` e o pedido de WhatsApp
    passam a ler o plano **combinado** com os ajustes.

  **Sem nenhum ajuste, toda empresa fica idêntica ao plano.** A própria
  migration confere isso antes de terminar.
- **Banco, etapa 2** (`20260924110000_painel_da_plataforma.sql`): as leituras
  e as ações do painel. Nenhuma função existente é reescrita.
- **Portal (app dos clientes):**
  - cada tela obedece à sua chave: Contatos, Funil e Tarefas (`crm`), Agenda,
    Equipe (`team_management`), Conversas e Conexões (`whatsapp_web`),
    Chatbots e Inteligência;
  - **função desconhecida vem desligada**. As chaves de sempre só somem com
    `false` explícito;
  - com o limite de WhatsApp em 0, o pedido de conexão mostra o motivo em vez
    do formulário;
  - o cartão "Administração do Núcleo Major" **sai** de Configurações. Fica só
    um botão "Abrir o painel", visível só para a administração.
- **Servidor** (`src/server.mjs`):
  - com `Host` = `painel.nucleomajor.com`, serve `public/painel/`;
  - nesse host, `/app/*` volta para `https://nucleomajor.com/app`;
  - no domínio principal, `/painel` leva ao subdomínio;
  - a API é a mesma nos dois hosts.
- **Build:** `npm run build` gera `public/app/` **e** `public/painel/`. O
  `prestart` da Hostinger já roda esse build.

### Um WhatsApp por empresa

O limite de números de WhatsApp **só aceita 0 ou 1**. O banco garante um
número ativo por empresa (`whatsapp_connections_one_live_per_org`), e a
agenda, a verificação de número e o pedido de conexão contam com isso. Dar 2
números a um cliente é uma entrega separada, que ainda não foi feita.

## Provas feitas antes de aplicar

- `scripts/sql/prova-funcoes-por-empresa.mjs`: **60 verificações, PASS**
  (etapa 1).
- `scripts/sql/prova-painel-da-plataforma.mjs`: **84 verificações, PASS**
  (etapa 2).

  As duas aplicam o harness e **todas** as migrations reais no PGlite 0.5.8.
  Para rodar, siga o cabeçalho de cada arquivo.
- `npm run test:server`: 275 testes. `npm run test:app`: 775 testes em 68
  arquivos. Todos verdes, e `npm run build` também.
- **Bancada visual** sem banco: `npm run dev:painel --workspace
  @nucleomajor/emyleads` e abrir `http://localhost:4174/dev-painel.html`. Use
  `?restrito=1` para ver o "Acesso restrito" e `?sair=1` para ver o login.

## Passo a passo

**O banco vai antes do portal.** O portal novo esconde função desconhecida:
publicado antes da migration, ele leria o plano sem os ajustes, mas continuaria
funcionando. O contrário também é seguro. Ainda assim, siga a ordem abaixo.

### 1. Supabase (SQL Editor): etapa 1

Abra o **arquivo** e copie o conteúdo inteiro. Não cole a partir do chat.

1. Aplique `supabase/migrations/20260924100000_funcoes_e_limites_por_empresa.sql`.
   A execução precisa terminar sem erro. Se uma guarda recusar, pare e me
   mande a mensagem.
2. Confira:

   ```sql
   select
     (select count(*) from public.platform_features) = 10 as catalogo_ok,
     (select count(*) from public.organization_entitlements) = 0 as sem_ajustes,
     not exists (
       select 1
       from public.organization_subscriptions s
       join public.saas_plans p on p.code = s.plan_code
       where private.org_features(s.organization_id) <> p.features
          or private.org_limits(s.organization_id) <> p.limits
     ) as todas_iguais_ao_plano;
   ```

   As três colunas precisam voltar `true`.

### 2. Supabase (SQL Editor): etapa 2

1. Aplique `supabase/migrations/20260924110000_painel_da_plataforma.sql`.
2. Confira:

   ```sql
   select
     (select count(*) from private.platform_organization_rows(null))
       = (select count(*) from public.organizations) as lista_completa,
     exists (
       select 1 from public.platform_admins a
       join auth.users u on u.id = a.user_id
       where lower(u.email) = 'cmo@majorhub.com.br'
     ) as cmo_e_admin;
   ```

   As duas colunas precisam voltar `true`. Se `cmo_e_admin` voltar `false`,
   pare: o painel recusaria o próprio dono.

### 3. Publicar o portal e o servidor

Faça o merge de `feat/painel-da-plataforma` na `main`. A Hostinger publica
sozinha.

Confira no app, com a conta da Major: todas as telas aparecem e nenhuma mostra
"Função não liberada". Em Configurações, o cartão antigo virou o botão "Abrir
o painel".

### 4. O subdomínio (o dono)

1. **DNS:** crie o registro `painel` apontando para o mesmo destino de
   `nucleomajor.com`.
2. **Hostinger:** acrescente `painel.nucleomajor.com` como domínio do **mesmo**
   app Node, com SSL.
3. **Variável (opcional):** `PAINEL_ORIGIN=https://painel.nucleomajor.com`. É
   o padrão; só precisa existir se o endereço mudar.

### 5. Supabase Auth

Em URL Configuration, acrescente `https://painel.nucleomajor.com/**` às
**Redirect URLs**. O login do painel é por senha e não precisa disso para
funcionar, mas a recuperação de senha precisa.

### 6. Conferência ao vivo

1. Entre em `https://painel.nucleomajor.com` com `cmo@majorhub.com.br`.
   - A lista mostra todas as empresas.
   - Entrar com outra conta mostra "Acesso restrito".
2. A Major continua com tudo, sem nenhum aviso de "não liberado".
3. A Adriane (org `600d6eb8-4ffe-4523-a920-679105c2bc95`, Base):
   - aparece como "Pago até 21/12/2026 · sem renovação";
   - **não** vê Chatbots nem Inteligência no app;
   - no painel, **Ligar** Chatbots: a tela aparece no app dela depois de
     recarregar;
   - **Desligar** (ou "Voltar ao plano"): a tela some.
4. O limite de WhatsApp dela é 1. "Fechar o WhatsApp" o leva a 0 e, no app
   dela, o pedido de conexão mostra o motivo. Volte ao plano no fim.
5. O Histórico mostra essas ações, com `cmo@majorhub.com.br` como autor.

## Se algo der errado

- **Uma tela sumiu para um cliente.** Abra a empresa no painel e veja a coluna
  "Ajuste". "Voltar ao plano" desfaz o ajuste na hora.
- **Encerrei a empresa errada.** "+30 dias" (ou "Escolher a data…") reabre o
  acesso. As duas ações ficam no histórico.
- **Empresa do Asaas.** O painel muda o **acesso**, não a cobrança. Cancele ou
  altere a assinatura no Asaas também. O próximo pagamento confirmado volta a
  escrever o período.
- **O subdomínio não abre.** Enquanto o DNS e a Hostinger não estiverem
  prontos, nada muda para os clientes: o app segue em `nucleomajor.com/app`.
- **Desfazer o banco.** As duas migrations só acrescentam. Sem nenhum ajuste
  gravado, o resultado é idêntico ao de antes. Para neutralizar todos os
  ajustes de uma vez, sem apagar o histórico:

  ```sql
  update public.organization_entitlements set expires_at = now() - interval '1 second';
  ```
