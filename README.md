# Núcleo Major

Monorepo do portal web, API Node.js e conector opcional do EmyLeads.

- `https://nucleomajor.com/` — página pública;
- `https://nucleomajor.com/convite` — criação de conta e aceite de convite;
- `https://nucleomajor.com/app` — painel web completo;
- `/api/invitations` — convites autenticados;
- `/api/assistant` — assistente pessoal autenticado.

## Estrutura

```text
apps/emyleads/       React compartilhado entre portal e extensão
public/              landing, convite e build web servido pelo Node
src/                 servidor Node, SMTP e runtime do assistente
supabase/migrations/ migrations do produto
```

O portal usa Supabase Auth e RLS. Somente a URL e a chave publicável chegam ao
navegador. SMTP, Anthropic e credenciais de WhatsApp permanecem no servidor ou
no conector.

## Desenvolvimento

```bash
npm install
copy .env.example .env
npm run build:web
npm test
npm start
```

O portal ficará em `http://localhost:3000/app`. Para desenvolver o React com
recarga rápida, use `npm run dev:web` e mantenha o servidor Node em paralelo.

Comandos úteis:

```bash
npm run build:web        # portal
npm run build:extension  # conector Chrome opcional
npm run test:server
npm run test:app
```

## Banco da Fase F

Antes de liberar `/app`, aplique no SQL Editor do Supabase:

```text
supabase/migrations/20260823030000_fase_f_web.sql
```

Ela cria chatbots centralizados e versionados, conversas do assistente,
execuções de ferramentas e a confirmação transacional/idempotente de eventos.
As migrations anteriores das Fases A–E continuam sendo pré-requisitos.

## Hostinger

Configuração recomendada para o aplicativo Node.js:

```text
Branch: main
Diretório raiz: ./
Node.js: 22.x
Gerenciador: npm
Comando de construção: npm run build:web
Diretório de saída: deixar vazio (o Node serve a pasta public)
Arquivo de entrada: src/start.mjs
```

O `npm start` também executa o build web antes de iniciar. O servidor respeita
a variável `PORT` fornecida pela Hostinger e serve corretamente rotas profundas
como `/app/agenda` e `/app/assistente`.

Variáveis de produção:

```text
PUBLIC_ORIGIN=https://nucleomajor.com
SUPABASE_URL=https://<projeto>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<chave-publicavel>
ANTHROPIC_API_KEY=<segredo>
ANTHROPIC_MODEL=claude-sonnet-4-5

SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=acesso@nucleomajor.com
SMTP_PASSWORD=<senha-da-caixa>
SMTP_FROM_NAME=Núcleo Major
SMTP_FROM_EMAIL=acesso@nucleomajor.com

CORS_ALLOWED_ORIGINS=https://nucleomajor.com,chrome-extension://<id-publicado>
```

Não configure `service_role` no frontend ou neste servidor. O backend usa a
sessão do próprio usuário e deixa o Supabase aplicar RLS.

No Supabase Auth, permita:

```text
Site URL: https://nucleomajor.com/app
Redirect URLs:
https://nucleomajor.com/app/**
https://nucleomajor.com/convite
```

## WhatsApp

O painel web não depende da extensão.

- API Oficial: o portal funciona normalmente; a ativação do canal depende das
  credenciais e do webhook da Meta.
- WhatsApp Web: a extensão compilada em `apps/emyleads/dist` funciona somente
  como conector e precisa permanecer ativa para receber e enviar mensagens.

As definições de chatbots ficam no Supabase. O conector sincroniza a versão
central e conserva uma cópia no IndexedDB para tolerar quedas temporárias de
rede. IndexedDB e APIs `chrome.*` não fazem parte do bundle do portal.
