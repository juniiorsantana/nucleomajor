# SPEC — Extensão Chrome EmyLeads

Status: conector opcional, Manifest V3, versão atual `0.1.1`.

## Papel no produto

A extensão não é o painel principal e não mantém o assistente de produção
funcionando. Ela oferece:

- painel do CRM dentro do WhatsApp Web;
- página de gestão em uma aba da extensão;
- canal humano assistido no navegador;
- migração de dados legados do IndexedDB;
- conector opcional para instalações locais do WhatsApp Web.

O portal em `/app` funciona sem extensão. O runtime do número `8362` fica na VPS.

## Estrutura

```text
apps/emyleads/public/manifest.json  manifesto MV3
apps/emyleads/src/background/       service worker
apps/emyleads/src/content/          painel injetado no WhatsApp Web
apps/emyleads/src/data/             providers Chrome/local/sincronização
apps/emyleads/src/page/             telas compartilhadas
apps/emyleads/dist/                 pacote gerado; não editar manualmente
```

## Build em três etapas

`npm run build:extension` executa:

1. `vite.config.js`: `gestao.html` e assets React;
2. `vite.sw.config.js`: `service-worker.js` IIFE autocontido;
3. `vite.content.config.js`: `content.js`, CSS no Shadow DOM e cópia de `wa-js.js`.

O primeiro build limpa `dist`; os dois seguintes acrescentam arquivos. Não
execute apenas uma etapa para publicar uma extensão completa.

## Manifest e permissões

- `storage` e `unlimitedStorage`;
- Supabase hospedado;
- `https://nucleomajor.com/*`;
- gateway local em `http://127.0.0.1:8090/*`;
- content scripts somente em `https://web.whatsapp.com/*`.

`wa-js.js` roda no mundo principal. `content.js` roda isolado e monta o painel.
O service worker recebe operações com `chrome.runtime.onMessage` e não contém UI.

## Dados

- A publishable key do Supabase pode estar no bundle.
- A sessão Auth fica em `chrome.storage.local`.
- Credenciais de gateway são escopadas por organização, conexão e instalação.
- Chatbots ativos podem ser armazenados localmente para tolerar falhas de rede.
- Nenhuma secret key, SMTP, token do Bridge ou sessão do WhatsApp entra no build.

## Desenvolvimento

Crie `apps/emyleads/.env.local`:

```text
VITE_SUPABASE_URL=https://PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_NUCLEO_PORTAL_URL=https://nucleomajor.com
```

Depois:

```bash
npm install
npm run build:extension
```

No Chrome, abra `chrome://extensions`, ative o modo desenvolvedor e carregue
`apps/emyleads/dist`. Depois de cada build, use **Recarregar** e confirme o
carimbo no console do service worker.

## Atualização do WA-JS

Quando mudanças do WhatsApp quebrarem stores internas:

```bash
npm run update-wa-js --workspace @nucleomajor/emyleads
npm run build:extension
npm run test:app
```

Não atualize a biblioteca diretamente em `dist`.

## Publicação

Antes de gerar pacote para Chrome Web Store:

1. atualizar a versão do manifest;
2. executar build e testes;
3. remover arquivos de ambiente;
4. conferir que `dist` contém manifest, service worker, content, `wa-js` e ícones;
5. testar login, CRM, conexão, recarga do MV3 e logout;
6. adicionar o ID publicado em `CORS_ALLOWED_ORIGINS` no portal;
7. registrar a versão no `CHANGELOG.md`.

## Critérios de aceite

- zero referência a secret keys no pacote;
- service worker volta corretamente após dormir;
- painel não vaza CSS para o WhatsApp Web;
- recarregar a extensão não duplica o painel;
- portal e extensão devolvem contratos equivalentes;
- falha do gateway local não é apresentada como queda da sessão na VPS.
