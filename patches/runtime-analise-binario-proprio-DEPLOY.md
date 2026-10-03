# Deploy: a análise com o próprio binário do Claude

> **Estado em 03/10/2026:** publicado na VPS (ver o registro no fim).
> - Base: a release ativa **`analise-tenta-de-novo`**. Os 6 arquivos que o
>   patch altera batem por sha256 com a cópia baixada da VPS nesse dia.
> - Patch `runtime-analise-binario-proprio.patch`: 6 arquivos, 96 linhas a mais
>   e 10 a menos, sha256
>   `0110a61b854aa86b0c80be9fd38266e708d0c42022c8a7ff86ce88f816778869`.
> - Sem migration. Uma variável nova, só na conexão da Adriani.

## Por quê

As duas análises da Adriani (02/10 23:19 e 03/10 10:16) caíram no Claude em
milissegundos com `model_unavailable`, a segunda mesmo depois da nova
tentativa. A conta de análise respondia normalmente de fora. A causa: o `.env`
da Adriani tem `ASSISTANT_CLAUDE_BIN=/bin/false`, a trava que impede o
atendente de chamar a IA no plano Base, e o analista usava esse mesmo binário.
`/bin/false` sai com 1 na hora, sem stderr nem JSON.

## O que muda

- **`NUCLEO_ANALYSIS_CLAUDE_BIN`:** o binário do Claude da análise. Vazio, é o
  mesmo do atendente (a Major continua igual). A trava do atendente da
  Adriani não muda.
- **Diagnóstico da falha:** quando o processo do Claude sai com erro, o log
  `analysis.retry` / `analysis.failed` passa a ter `cli_exit`, `cli_ms`,
  `cli_stdout_bytes`, `cli_stderr_bytes` e `cli_stderr` (primeira linha, sem
  números longos, e omitida se tiver trecho da conversa). Com isso, este caso
  teria aparecido como `cli_exit=1, cli_ms≈2, cli_stderr_bytes=0` na primeira
  falha.
- **`attempt`** em `analysis.failed` passa a dizer 2 quando a falha veio da
  segunda tentativa.

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../analise-tenta-de-novo
cd "$ATIVA"
sha256sum whatsapp-assistant/{analista,config,main,runner,test_analista,test_runner}.py /tmp/runtime-analise-binario-proprio.patch
```

```
ffbf54ba50a2c8654e19ea14c2bc8d81355237271e37f40e6a0969fc658482c3  whatsapp-assistant/analista.py
d29585025bacf1094684ef88258236225bf3d5a4a9434514d5110ed581d1d474  whatsapp-assistant/config.py
927fa3d3250ab2382943e4907d6d321508add7de141fc7c51fa23f2854ba440a  whatsapp-assistant/main.py
38d1b16c230a2d5119c5f89b8f78936605ac0e1798cfd4c5771b69f4ba02f845  whatsapp-assistant/runner.py
596e089772305921059f5e00aeb476fff28c6b8c44b4a35a2f92585ac1924254  whatsapp-assistant/test_analista.py
8212cad0b72fe5e0d7c99b08d4b25d7f2c837549f0f11a74eaa4c5cfa301895f  whatsapp-assistant/test_runner.py
0110a61b854aa86b0c80be9fd38266e708d0c42022c8a7ff86ce88f816778869  /tmp/runtime-analise-binario-proprio.patch
```

## 2. Release nova, testes, ambiente, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/analise-binario-proprio
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-analise-binario-proprio.patch
git apply        -p1 /tmp/runtime-analise-binario-proprio.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_runner test_analista test_transcritor test_config test_worker 2>&1 | tail -3

ENV=~/.config/whatsapp-assistant/a502a475-f677-4a39-8f4e-da85fd92325d.env
cp -a "$ENV" "$ENV.antes-binario-da-analise"
grep -q '^NUCLEO_ANALYSIS_CLAUDE_BIN=' "$ENV" || echo 'NUCLEO_ANALYSIS_CLAUDE_BIN=/home/nucleo/.local/bin/claude' >> "$ENV"
grep '^ASSISTANT_CLAUDE_BIN=' "$ENV"   # continua /bin/false

ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
  sleep 8
  systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$U
done
```

## 3. Conferir

Pedir a análise de novo numa conversa da Adriani e olhar:

```bash
journalctl --user -u whatsapp-assistant@a502a475-f677-4a39-8f4e-da85fd92325d --since "10 min ago" -o cat \
  | grep -E '"event": "analysis\.'
```

Esperado: `analysis.transcribed`, `analysis.classified`, `analysis.done`.

## 4. Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/analise-tenta-de-novo ~/whatsapp-mcp-hardened
cp ~/.config/whatsapp-assistant/a502a475-f677-4a39-8f4e-da85fd92325d.env.antes-binario-da-analise \
   ~/.config/whatsapp-assistant/a502a475-f677-4a39-8f4e-da85fd92325d.env
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
done
```

## 5. Registro do que já rodou

- 03/10/2026: base baixada da VPS (`analise-tenta-de-novo`), patch e testes
  nesta máquina (1062 OK, com a janela da data ampliada).
- 03/10/2026, manhã: base conferida pelos 6 hashes e o do patch; release
  `analise-binario-proprio` criada, `git apply` limpo, 382 testes (runner,
  analista, transcritor, config, worker) OK na VPS; `.env` da Adriani com
  backup em `.env.antes-binario-da-analise` e
  `NUCLEO_ANALYSIS_CLAUDE_BIN=/home/nucleo/.local/bin/claude`
  (`ASSISTANT_CLAUDE_BIN` continua `/bin/false`); symlink virado; Major e
  Adriani reiniciadas: `active`, `NRestarts=0`, sem erro. Rollback:
  `analise-tenta-de-novo` + o backup do `.env`.
