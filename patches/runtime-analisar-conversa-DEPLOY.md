# Deploy: Agente Analista no runtime (botão "Analisar conversa")

> **Estado em 02/10/2026, ao fechar o roteiro:**
> - Base: a release ativa **`equipe-de-ia`**. Os 5 arquivos que o patch
>   toca batem por sha256 com a cópia local usada para gerar o patch.
> - Patch `runtime-analisar-conversa.patch`: 7 arquivos, 637 linhas a mais e
>   nenhuma a menos, sha256 `256feaf36a7278b5e52f99277a3f73f9b97f34f95ce5686624d62bbcec924587`.
> - Base + patch, nesta máquina: **993 testes do assistente OK** (14 novos).
> - Depende da migration `20261002100000_analisar_conversa.sql`. Sem ela o
>   comando `conversation_analyze` nem chega à VPS.
> - **A segunda conta do Claude ainda não está logada** em
>   `~/.config/claude/analise` (conferido em 02/10). Sem ela, cada análise
>   falha com `analysis_account_missing` e o crédito volta.

## O que muda

- **Agente Analista (`analista.py`):** uma fila própria (até 50 pedidos) e uma
  thread que roda uma análise por vez. O comando `conversation_analyze` só
  entrega a carga à fila e conclui na hora, para não segurar o envio de
  mensagens pelo portal.
- A análise roda o Claude **sem ferramentas, sem o vault e sem sessão**, com a
  conta de `NUCLEO_ANALYSIS_CLAUDE_CONFIG_DIR`. **Nunca cai na conta do
  atendimento**: sem essa pasta logada, a análise falha com motivo.
- A resposta é conferida antes de gravar: JSON no formato combinado, tetos de
  tamanho, etapa só se existir no funil da empresa, tarefa e compromisso só
  se o contato estiver no CRM. Resposta torta vira `analysis_invalid_response`.
- O resultado vai pela RPC `nucleo_analysis_record` (até 32 KB), não pelo
  resultado do comando (2 KB). Falha não consome crédito (o banco não conta
  análise `failed`).
- Log: só `analysis.done` / `analysis.failed` com id, tipo, código e tempo.
  O texto da conversa e o da análise não vão para log.

Variáveis novas (só na conexão da Major):

| Variável | Valor |
|---|---|
| `NUCLEO_ANALYSIS` | `1` liga o analista; ausente ou `0`, o pedido falha com `analysis_disabled` |
| `NUCLEO_ANALYSIS_CLAUDE_CONFIG_DIR` | `/home/nucleo/.config/claude/analise` |
| `NUCLEO_ANALYSIS_MODEL` | opcional, padrão `sonnet` |

O Bridge não muda.

## 0. Logar a segunda conta (o dono, uma vez)

Na VPS, como `nucleo`, com a **segunda conta** da Major (não a agenciameia5):

```bash
mkdir -p ~/.config/claude/analise && chmod 700 ~/.config/claude/analise
CLAUDE_CONFIG_DIR=~/.config/claude/analise claude
# dentro do Claude: /login, escolher a conta de assinatura, seguir o link; depois /exit
test -f ~/.config/claude/analise/.credentials.json && echo logada
```

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../equipe-de-ia
cd "$ATIVA"
sha256sum whatsapp-assistant/{config,main,operator_verification,runtime_commands,test_runtime_commands}.py
sha256sum /tmp/runtime-analisar-conversa.patch
```

```
17c5884b3dd63e1e63d1c5fcec1ad6ec75ba785e7f0d356294a7dd3050d9c9e5  whatsapp-assistant/config.py
552e83de27f4a476554c327156379349ba571da57aaa7a25facbf185239074d1  whatsapp-assistant/main.py
3e909365d82830798ffa86d2a069ed8fc102a30b50cd88556c57b32c5b594290  whatsapp-assistant/operator_verification.py
9e45afce733e1c7e6d17fe92951ce433b2230b6ceefbeb309413fc2129c992df  whatsapp-assistant/runtime_commands.py
625e33d0e259653cc4f62aaabd854831970c61d7b04dee2f54f552d24d58cac0  whatsapp-assistant/test_runtime_commands.py
256feaf36a7278b5e52f99277a3f73f9b97f34f95ce5686624d62bbcec924587  /tmp/runtime-analisar-conversa.patch
```

## 2. Release nova, testes, ambiente, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/analisar-conversa
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-analisar-conversa.patch
git apply        -p1 /tmp/runtime-analisar-conversa.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_analista test_runtime_commands test_config 2>&1 | tail -3

ENV=~/.config/whatsapp-assistant/$UUID.env
cp "$ENV" "$ENV.antes-analise"
grep -q '^NUCLEO_ANALYSIS=' "$ENV" || printf '%s\n' \
  'NUCLEO_ANALYSIS=1' \
  'NUCLEO_ANALYSIS_CLAUDE_CONFIG_DIR=/home/nucleo/.config/claude/analise' >> "$ENV"

ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$UUID
```

## 3. Conferir

Pedir uma análise pelo portal (dono ou admin, numa conversa direta) e olhar:

```bash
journalctl --user -u whatsapp-assistant@$UUID --since "10 min ago" -o cat \
  | grep -E '"event": "(service.started|analysis\.|runtime.command_(completed|failed))' | tail -10
```

```sql
select kind, status, error_code, latency_ms, model, requested_at, completed_at
from public.conversation_analyses
where organization_id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
order by requested_at desc limit 5;
```

## 4. Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/equipe-de-ia ~/whatsapp-mcp-hardened
cp ~/.config/whatsapp-assistant/$UUID.env.antes-analise ~/.config/whatsapp-assistant/$UUID.env
systemctl --user restart whatsapp-assistant@$UUID
```

Com a release antiga, o pedido de análise fica pendente e expira em 15
minutos (o banco marca `failed` / `expired` e o crédito volta).

## 5. Registro do que já rodou

- 02/10/2026: base conferida na VPS pelos 5 hashes (release `equipe-de-ia`);
  conta de análise ainda não logada.
- 02/10/2026 03:19 UTC: patch em `/tmp` (hash conferido), `git apply --check`
  OK na `equipe-de-ia`; release `analisar-conversa` criada, 85 testes do
  analista, dos comandos e da config OK na VPS; `.env` da Major com backup em
  `.env.antes-analise` e as duas variáveis novas; symlink virado; só o
  assistente da Major reiniciado (`active`, `NRestarts=0`, `service.started`
  normal). Rollback: `equipe-de-ia` + o backup do `.env`.
- Migration `20261002100000`: ensaio pelo SQL Editor passou inteiro (guardas,
  criação e conferência, e o `raise` final desfez). A aplicação real **não foi
  feita**: fica para o dono rodar no SQL Editor.
- A conta de análise continua **sem login**: até lá, cada análise falha com
  `analysis_account_missing` e o crédito volta.
