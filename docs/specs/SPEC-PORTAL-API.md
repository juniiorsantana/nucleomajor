# SPEC — Portal web e API Node.js

Status: implantado em `nucleomajor.com`.

## Estrutura

```text
apps/emyleads/src/web/   providers e entrada React do portal
apps/emyleads/src/page/  shell, telas e componentes
public/                  landing, convite e build gerado do portal
src/                     servidor Node, convite, e-mail e assistente web
test/                    testes do servidor
```

## Rotas web

O React usa `BrowserRouter` com `basename=/app`.

- `/app/assistente`
- `/app/contatos`
- `/app/funil`
- `/app/tarefas`
- `/app/agenda`
- `/app/conhecimento`
- `/app/chatbots`
- `/app/conexoes`
- `/app/equipe`
- `/app/configuracoes`

`/app/nucleo` é compatibilidade para `/app/conhecimento`. Rotas profundas são
servidas por `public/app/index.html` no Node.

## API atual

- `GET /api/config` e `/api/config.js`: configuração pública do navegador;
- `GET|POST /api/invitations`: listar e criar convites;
- `POST /api/invitations/:id/resend`: reenviar convite;
- `POST /api/invitations/:id/cancel`: cancelar convite;
- `GET /api/assistant/threads`: conversas do assistente web;
- `GET|POST /api/assistant/messages`: histórico e nova mensagem;
- `POST /api/assistant/tool-runs/:id/decision`: confirmar ou negar ação.

Toda rota autenticada valida a sessão. Organização, usuário e cargo são
derivados pelo servidor ou pelo Supabase, nunca pelo texto da requisição.

## Providers web

`apps/emyleads/src/web/operations.js` compõe providers de dados, autenticação,
agenda, conhecimento, assistente, inteligência e gateway. O portal não usa
`chrome.*` nem IndexedDB da extensão.

## Configuração pública e secreta

Pode chegar ao bundle:

- `SUPABASE_URL`;
- `SUPABASE_PUBLISHABLE_KEY`;
- `PUBLIC_ORIGIN`.

Permanece no servidor:

- SMTP;
- `ANTHROPIC_API_KEY`, quando o assistente web usar API;
- qualquer secret key ou `service_role` temporária;
- credenciais do WhatsApp.

## Hostinger

- Node.js 22;
- branch `main`;
- build `npm run build:web`;
- entrada `src/start.mjs`;
- diretório de saída vazio, pois o Node serve `public`.

## Critérios de mudança

- nova tela deve ter rota profunda e estado de permissão;
- nova operação web deve existir no provider, não em chamadas soltas na UI;
- respostas de API não podem expor stack, token ou detalhe de outro tenant;
- módulo pesado deve usar carregamento sob demanda;
- alteração de contrato exige teste de servidor ou provider.
