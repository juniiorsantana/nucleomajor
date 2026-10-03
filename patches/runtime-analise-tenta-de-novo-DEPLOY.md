# Deploy: a análise tenta de novo e diz o motivo da falha

> **Estado em 03/10/2026:** publicado na VPS (ver o registro no fim).
> - Base: a release ativa **`transcricao-de-audios`**. Os 4 arquivos que o
>   patch altera batem por sha256 com a cópia baixada da VPS nesse dia.
> - Patch `runtime-analise-tenta-de-novo.patch`: 4 arquivos, 160 linhas a mais
>   e 4 a menos, sha256
>   `f107f11eb0c104b1fa1b29807598154090f2dbb3a7089d39a18eb441fd33cead`.
> - Sem migration, sem variável nova. Só reinicia as duas conexões.

## Por quê

Em 02/10/2026, às 23:19:11, a primeira análise da Adriani transcreveu os 11
áudios, passou pelo Jev (nota 84) e caiu no Claude em 0,2 s com
`model_unavailable`. A conta de análise respondia normalmente 47 s depois, e
o arquivo de login dela foi renovado nesse momento: o acesso (8 h) tinha
vencido no minuto da análise. Na mesma investigação, a conta do atendimento
devolvia "You've hit your session limit · resets 12:10am", que o runtime
também chamava de `model_unavailable`.

## O que muda

- **Analista:** quando a chamada ao Claude cai em menos de 10 s com
  `model_unavailable` ou `model_auth_unavailable`, espera 20 s e tenta de novo,
  uma vez (log `analysis.retry`). Limite de uso e de taxa não repetem.
- **Runner:** "session limit" e "weekly limit" passam a ser
  `model_quota_exhausted` (vale também para o atendente, que então mostra o
  aviso de limite ao operador e marca a conexão como `quota_exhausted`).
- **Runner + analista:** a mensagem de erro que a CLI põe no JSON (`result`
  com `is_error`), cortada em 160 caracteres, vai como `cli_error` em
  `analysis.retry` e `analysis.failed`. É o texto da API, nunca o da conversa.

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../transcricao-de-audios
cd "$ATIVA"
sha256sum whatsapp-assistant/{analista,runner,test_analista,test_runner}.py /tmp/runtime-analise-tenta-de-novo.patch
```

```
df8ea6445bdd9bbf5c4f7bc81ef35aedae3ac534c9df7f72412e6d072ae7f79e  whatsapp-assistant/analista.py
b332a2bc3e474286b49ddb5c3d34210d63997febc040dbd629be0d89841944ba  whatsapp-assistant/runner.py
21b0c6ea47ab73dd1b4e54b37c315d7b6992fc17c889a291c8dfff7a9a1d0ad2  whatsapp-assistant/test_analista.py
273dff1c9b53a41a888ce4b0b70f5a19edd46be9f0a02ad445fb04a69d3164d9  whatsapp-assistant/test_runner.py
f107f11eb0c104b1fa1b29807598154090f2dbb3a7089d39a18eb441fd33cead  /tmp/runtime-analise-tenta-de-novo.patch
```

## 2. Release nova, testes, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/analise-tenta-de-novo
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-analise-tenta-de-novo.patch
git apply        -p1 /tmp/runtime-analise-tenta-de-novo.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_runner test_analista test_transcritor test_worker 2>&1 | tail -3

ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
  sleep 8
  systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$U
done
```

## 3. Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/transcricao-de-audios ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
done
```

## 4. Registro do que já rodou

- 03/10/2026: base baixada da VPS (`transcricao-de-audios`), patch e testes
  nesta máquina (1059 OK, com a janela da data ampliada).
- 03/10/2026, 09:40: base conferida pelos 4 hashes e o do patch; release
  `analise-tenta-de-novo` criada, `git apply` limpo, 369 testes (runner,
  analista, transcritor, worker) OK na VPS; symlink virado; Major e Adriani
  reiniciadas: `active`, `NRestarts=0`, sem erro. Rollback:
  `transcricao-de-audios`. A conta do atendimento, que estava em "session
  limit" na noite anterior, respondia de novo às 09:42.
