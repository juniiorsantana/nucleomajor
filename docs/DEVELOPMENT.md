# Desenvolvimento local

## Repositórios

```text
nucleomajor/                         portal, API, extensão, migrations e skills
07 - Projetos Internos/
  whatsapp-mcp-hardened/             runtime WhatsApp/VPS
```

Não edite a cópia em produção na VPS como fonte principal. Corrija no
repositório, teste e publique um pacote revisado.

## Portal

Pré-requisitos: Node.js 22 e npm.

```powershell
cd nucleomajor
npm install
Copy-Item .env.example .env
npm run dev:web
```

O Vite abre em `http://localhost:4173/app`. Para testar o servidor completo:

```powershell
npm run build:web
npm start
```

## Variáveis

Use `.env` no servidor e `apps/emyleads/.env.local` na extensão. Valores reais
nunca são commitados. A publishable key do Supabase é pública por definição;
`service_role`, SMTP e tokens não são.

## Banco

Migrations ficam em `supabase/migrations` e são ordenadas pelo timestamp. Não
altere uma migration aplicada. Crie outra migration idempotente para corrigir.

Nesta máquina não há Postgres/Docker local. Rode testes estáticos localmente e
execute SQL comportamental em projeto de teste ou no aceite controlado.

## Skills

```powershell
npm run intelligence:validate
npm run intelligence:publish
```

Somente depois de revisar o dry-run use `--apply`. Remova a variável de
`service_role` do terminal ao terminar.

## Extensão

Siga o [SPEC da extensão](specs/SPEC-EXTENSION.md). O build exige as duas
variáveis públicas do Supabase em `apps/emyleads/.env.local`.

## Bancada visual

`apps/emyleads/dev-gestao.html` usa dublês e permite abrir telas sem alterar o
banco. Parâmetro útil: `?tela=conhecimento` ou `?tela=chatbots`.

## Padrões

- JavaScript/React: módulos ESM, funções pequenas e providers por plataforma.
- SQL: menor privilégio, RLS e `search_path` vazio em funções privilegiadas.
- Python: testes `unittest`, logs estruturados e falha fechada.
- Go: timeouts explícitos, APIs locais autenticadas e estado por conexão.
- Português do Brasil na interface; nomes técnicos podem permanecer em inglês.
