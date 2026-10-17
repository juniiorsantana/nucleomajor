# Deploy — Fase 1 da correção do atendimento (13/09/2026)

> **Estado em 13/09/2026 16:00 (Brasília):**
> - **A (runtime) IMPLANTADA às 15:58:25.** Release `fase1-atendimento` construída
>   por `cp -a` + `git apply` (hashes conferidos contra `860f7ac`), suíte na VPS
>   com o Python do serviço `Ran 728 tests OK`, backup em
>   `~/.local/state/nucleo-major/deploy-backups/fase1-atendimento-20260913-1542/`,
>   symlink trocado, só o assistente reiniciado (`NRestarts=0`, cwd na release
>   nova, `service.started` com `human_takeover_lookback_hours: 12`, coluna
>   `devolvida_em` migrada, Bridge intacto). Rollback: `lembrete-de-espera`.
> - **B (portal) IMPLANTADO.** Migration `20260913150000` aplicada pelo dono no
>   SQL Editor ("sucesso"; o bloco 4/4 confere o catálogo e teria abortado).
>   `ff1d250` enviado para `main` às 16:02 (fast-forward de `8491c5e`), CI verde,
>   e a Hostinger publicou sozinha: `operations-Dl8hMMaW.js` em nucleomajor.com
>   já chama `nucleo_contact_ai_opt_out_set` e `_status`. O push para `main`
>   dispara a publicação.
> - Validação ao vivo (seção 5) pendente: o agente de clientes segue desligado.

Diagnóstico e decisões: `docs/atendimento/PLANO-CORRECAO-ATENDIMENTO.md`.

São **duas entregas independentes**, e a ordem entre elas não importa:

| Entrega | Onde | O que resolve |
|---|---|---|
| A. Runtime (`fix/fase1-atendimento` @ `860f7ac`) | VPS | frase de espera, aviso técnico ao contato, IA falando por cima da equipe, rajada, lembrete indevido |
| B. Portal (`fix/nao-atender-ia-grava-no-banco` @ `ff1d250`) | Supabase + Hostinger | o interruptor "Não atender IA" que nunca gravou |

Dentro da B a ordem **importa**: migration primeiro, portal depois. O portal
novo pergunta ao banco por funções que só existem depois da migration.

---

## A. Runtime

### Base esperada

Release ativa `lembrete-de-espera` = `agente/atendimento-de-leads` @ `0b4ddb7`
(14 arquivos tocados conferidos por hash em 13/09/2026).

```bash
cd /home/nucleo/releases/whatsapp-mcp-hardened/lembrete-de-espera/whatsapp-assistant
sha256sum arbitro.py config.py main.py presenca_humana.py runtime_commands.py server.py worker.py
```

```
cdb41e9183562d806cc081727d5eac4eaff3c5cdc6acc86485a40f407847bd5b  arbitro.py
1be678f251bedd7a9297a16932f7a3da315eaebe768cc8cd5939316e79967239  config.py
8a164bd4302b7e8cbebb24377cc0c51686cb093508a1828309ceef10229785a3  main.py
ddbaa6022470556749bcb2c8c5c6de4f336db48bbc78c167c0ceb53becae141c  presenca_humana.py
d549c8f987d9a3aeb8e405cab1d23a789a9b638a781f239978bfb7cf701d8522  runtime_commands.py
9f90ca85a5780675deaccabfdea5cbe1cb233a29bf04c0e6d3f43b3dd5c28e5b  server.py
77742902d128569a8fd42b0832f04256b41c7f3fbcdf54860c0036e763413024  worker.py
```

Patch: `runtime-fase1-atendimento-lembrete-de-espera.patch`, sha256
`1889852230a4436309ad521ba8e2eaa1342497bfa0c8f54ee9cf88ea83fd43aa`.

### Já executado (13/09/2026)

- patch copiado para `/tmp/runtime-fase1-atendimento-lembrete-de-espera.patch`
  (sha256 conferido do lado da VPS);
- `git apply --check -p1` na release ativa: os 14 arquivos aplicam limpo;
- suíte local sobre a mesma base: `Ran 728 tests`, `OK` (eram 598).

### 1. Construir a release nova

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/fase1-atendimento
cp -a /home/nucleo/releases/whatsapp-mcp-hardened/lembrete-de-espera "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-fase1-atendimento-lembrete-de-espera.patch
git apply        -p1 /tmp/runtime-fase1-atendimento-lembrete-de-espera.patch
```

### 2. Testar na VPS, com o Python do serviço

```bash
cd "$NOVA/whatsapp-assistant"
~/.venvs/whatsapp-assistant/bin/python -B -m unittest discover -s . -p 'test_*.py'
```

Esperado: `Ran 728 tests`, `OK`.

### 3. Backup do estado (a migração do árbitro acrescenta uma coluna)

```bash
DEST=~/.local/state/nucleo-major/deploy-backups/fase1-atendimento-$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"
ST=~/.local/state/whatsapp-assistant/8ee1e6d0-a9d0-4041-b6ea-878716a34a71
sqlite3 "$ST/arbitro.db" ".backup '$DEST/arbitro.db'"
sqlite3 "$ST/saidas.db"  ".backup '$DEST/saidas.db'"
```

### 4. Trocar e reiniciar (só o assistente; o Bridge não)

```bash
ln -sfn "$NOVA" /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
systemctl --user is-active 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
journalctl --user -u 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service' -n 50 --no-pager
```

No `service.started` deve aparecer `human_takeover_lookback_hours: 12` (e não
mais `human_pause_minutes`). Nenhuma variável de env precisa mudar: as duas
que saíram nunca estiveram definidas na unit.

### 5. Validar em produção (com o agente de clientes religado no portal)

Do celular de teste, como contato:

1. Mande uma pergunta e, enquanto aparece "digitando", outra mensagem → chega
   **uma** resposta, sem "Um instante"; no journal, `reply.discarded` com
   `reason: newer_message` para o primeiro turno. (Duas mensagens com menos de
   `coalesce_seconds` entre elas já viram um lote só antes do modelo.)
2. Mande uma pergunta e, **enquanto aparece "digitando"**, responda pelo
   celular da empresa → a resposta da IA **não chega**; no journal
   `conversation.team_took_over` e `reply.discarded` com `reason: human_active`.
3. Mande outra mensagem → `inbound.ignored` com `motivo: ignored_handoff`, e
   **nenhum** lembrete de espera chega no WhatsApp do dono.
4. No portal, devolva a conversa para a IA → a mensagem seguinte é respondida.

### Rollback

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/lembrete-de-espera /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
```

A coluna `devolvida_em` fica no `arbitro.db` e é ignorada pelo código antigo.
Conversas que a regra nova passou para a equipe continuam `humano` depois do
rollback (sem prazo); devolva pelo portal as que precisar.

### O que não é regressão

- **Conversas em que a equipe já tinha escrito nas últimas 12 h saem da IA na
  primeira mensagem nova do contato.** É a regra nova valendo para trás, dentro
  da janela. Devolva pelo portal as que forem de lead.
- **Pausas de 30 min gravadas antes do deploy** (`humano_ate`) vencem sozinhas.

---

## B. Portal — o interruptor "Não atender IA"

### 1. Migration pelo SQL Editor (manual)

Arquivo: `supabase/migrations/20260913150000_interruptor_nao_atender_ia_grava_no_banco.sql`
(branch `fix/nao-atender-ia-grava-no-banco`). Colar inteiro e rodar. Ela aborta
sozinha se o gate de 11/09 não estiver vivo, e termina conferindo pelo catálogo.

Prova feita antes (13/09/2026) em Postgres embutido:
`scripts/sql/prova-interruptor-nao-atender-ia.mjs` → **PASS 30**, inclusive o
item K: a consulta nova e o bloco real do gate dão a mesma resposta para cada
número testado.

### 2. Conferir pelo catálogo

Rodar `scripts/sql/validar-interruptor-nao-atender-ia.sql` e devolver o JSON.
Todos os campos `true`; `contatos_marcados` pode ser `0`.

### 3. Publicar o portal

Levar `fix/nao-atender-ia-grava-no-banco` para `main` e reimplantar na Hostinger
(não há webhook). Suíte na branch: app 671, servidor 232, build ok, docs ok.

### 4. Validar

Na tela Conversas, abra a ficha de um contato pessoal: o interruptor mostra
"Conferindo no servidor…" e depois o estado real. Desligue; recarregue a página;
continua desligado. Rode de novo `validar-interruptor-nao-atender-ia.sql`:
`contatos_marcados` subiu. Uma mensagem desse contato gera no journal da VPS
`customer_rollout.denied` com `reason: contact_opted_out`.
