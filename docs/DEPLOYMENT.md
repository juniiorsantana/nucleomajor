# Implantação

## Ambientes

| Parte | Produção | Origem do código |
| --- | --- | --- |
| Portal/API | Hostinger Node.js | `nucleomajor`, branch `main` |
| Banco | Supabase hospedado | `supabase/migrations` |
| Runtime | VPS Ubuntu | `whatsapp-mcp-hardened` |
| Extensão | Chrome / futura Web Store | `apps/emyleads/dist` |

## Ordem segura

Quando uma versão muda banco, portal e runtime:

1. aplicar migration compatível com versões antigas;
2. validar o banco;
3. publicar portal;
4. publicar runtime;
5. ativar configuração ou rollout;
6. executar smoke test;
7. atualizar `STATUS.md`.

## Portal na Hostinger

```text
Branch: main
Node: 22.x
Build: npm run build:web
Entrada: src/start.mjs
Saída: vazia
```

O push para `main` aciona a implantação configurada. Verifique `/`, `/convite`,
`/app` e uma rota profunda. A ausência de erro no build não comprova que as
variáveis de produção estão corretas.

## Supabase

- preferir Supabase CLI com histórico íntegro;
- SQL Editor é aceito no fluxo atual, mas registrar a migration aplicada;
- nunca aplicar `service_role` no portal;
- validar função e policy, não apenas a mensagem “Success”.

### O histórico remoto não está íntegro

Em 29/08/2026, `supabase migration list --linked` mostra registro remoto
somente até `20260819180000`. Tudo a partir de `20260821120000` foi aplicado
pelo SQL Editor e não consta em `supabase_migrations.schema_migrations`.

Portanto **não execute `supabase db push`**. Ele tentaria reaplicar mais de
trinta migrations já aplicadas, e `20260823010000_nucleo_conhecimento.sql`
começa com `create table public.knowledge_documents` sem `if not exists`.

Enquanto o histórico não for reconciliado:

1. aplicar a migration pelo SQL Editor, uma por vez;
2. conferir o efeito com uma consulta, não com a mensagem de sucesso;
3. registrar em `STATUS.md`, seção “Banco aplicado”;
4. opcionalmente marcar como aplicada com
   `supabase migration repair --status applied <versão>`, que só escreve na
   tabela de histórico e não executa SQL da migration.

Reconciliar o histórico com `migration repair` para todas as pendentes é o que
devolve o `db push` ao fluxo. Até lá, o CLI serve para inspecionar, não para
aplicar.

## Runtime da VPS

O runtime não possui remoto próprio. O procedimento atual gera um pacote com
`scripts/vps/package-runtime.ps1`, excluindo `.git`, `.env`, bancos, sessão e
caches. A VPS recebe apenas código e preserva:

- `~/.config/whatsapp-*`;
- `~/.config/claude`;
- `~/.local/state/whatsapp-*`;
- `~/.local/share/nucleo-major`.

Mudança apenas no assistente reinicia somente
`whatsapp-assistant@<connection-id>`. Não reinicie o Bridge sem necessidade.

## Extensão

```bash
npm run build:extension
```

O artefato é `apps/emyleads/dist`. Teste como extensão descompactada antes de
gerar o ZIP de publicação. Atualize versão, changelog e CORS do ID publicado.

## Rollback

- Portal: reimplantar commit anterior compatível com o schema atual.
- Runtime: restaurar pacote anterior e reiniciar apenas o serviço alterado.
- Skill: publicar/ativar versão anterior no Supabase.
- Migration: nunca editar ou apagar a aplicada; criar migration corretiva.

Rollback não deve restaurar uma sessão antiga do WhatsApp sobre uma sessão
válida nem reutilizar credencial revogada.
