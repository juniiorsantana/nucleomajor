# Portal Núcleo Major

Aplicação Node.js que serve a página pública de convite e a API de convites no
mesmo domínio:

- `https://nucleomajor.com/` — acesso do portal;
- `https://nucleomajor.com/convite` — cadastro/aceite de convite;
- `https://nucleomajor.com/api` — operações autenticadas para a extensão.

## Configuração local

```bash
npm install
copy .env.example .env
npm test
npm run check
npm start
```

Preencha o `.env` com a URL/chave publicável do Supabase e as credenciais SMTP
da Hostinger. A chave `service_role` nunca é necessária neste servidor.

Depois de aplicar `20260822090000_portal_convites_email.sql`, a extensão passa a
usar os endpoints autenticados `/api/invitations`, `/resend` e `/cancel`. O
token bruto só existe durante a requisição que cria ou reenvia o convite, para
ser entregue ao SMTP; ele não é devolvido ao navegador nem escrito em log.

## Hostinger

Configure o domínio `nucleomajor.com` para este aplicativo Node.js,
ative HTTPS e cadastre as variáveis do `.env` no painel. A caixa
`convites@majorhub.com.br` deve existir e usar o SMTP da Hostinger.

No painel Node.js da Hostinger, use `portal` como diretório da aplicação,
`npm install` como instalação e `npm start` como comando de inicialização. Se o
painel pedir um arquivo de entrada, use `src/start.mjs`. Se pedir uma porta,
use a variável `PORT` fornecida pela Hostinger; o servidor escuta nessa porta e
o proxy da Hostinger publica o HTTPS.

Variáveis mínimas de produção:

```text
PUBLIC_ORIGIN=https://nucleomajor.com
SUPABASE_URL=https://<projeto>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<chave-publicável>
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=convites@majorhub.com.br
SMTP_PASSWORD=<senha-da-caixa>
SMTP_FROM_NAME=Assistente Major
SMTP_FROM_EMAIL=convites@majorhub.com.br
CORS_ALLOWED_ORIGINS=https://nucleomajor.com,<origem-da-extensão-chrome>
```

No Supabase Auth, permita `https://nucleomajor.com` e o redirect
`https://nucleomajor.com/convite`. Mantenha a confirmação de e-mail
ativada e confirme o SMTP de Auth para o fluxo de criação de conta.

O serviço aceita origens adicionais por `CORS_ALLOWED_ORIGINS`; inclua o ID da
extensão Chrome publicada para que a tela Equipe possa chamar `/api`.
