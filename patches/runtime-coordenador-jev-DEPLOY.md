# Deploy: o coordenador lê as conversas com o Jev

> **Estado em 01/10/2026, ao fechar o roteiro:**
> - Base: a release **ativa** `claudio-dormindo`, copiada da VPS por `tar`
>   (só leitura) e usada como está. Nada de branch local: o checkout do runtime
>   nesta máquina está atrás da produção.
> - Patch `runtime-coordenador-jev.patch`: 6 arquivos, **só acréscimos**
>   (1126 linhas, nenhuma removida), sha256
>   `1a7e73c1a7289a5871d4546a70bba6d900fca8b9dc281bbb4c450a1d824883bc`.
>   Já está em `/tmp/runtime-coordenador-jev.patch` na VPS, com o mesmo hash,
>   e o `git apply --check -p1` na release ativa **passou**.
> - Base + patch, nesta máquina (Python 3.11): **967 testes do assistente OK**,
>   29 deles novos (`test_coordenador.py`).
> - Depende da migration `20260930100000_o_coordenador_le_as_conversas.sql`
>   aplicada no banco (sem ela, o coordenador só registra erro no journal e
>   espera; o atendimento não é afetado).

O plano: `docs/coordenador-jev/PLANO.md`.

## O que muda para quem usa

| Quem | O que muda |
|---|---|
| **Cliente final** | Nada. O coordenador roda numa thread própria, fora do caminho da resposta. Se o Jev cair, o atendimento não percebe. |
| **Equipe da Major** | Depois de uma conversa ficar 1 hora parada, a ficha lateral dela no portal passa a mostrar a **leitura automática**: temperatura do lead, intenção, objeção, se ficou pergunta sem resposta, promessa pendente, insatisfação e pedido de atendente. |
| **Custo** | Cerca de US$ 0,0002 por conversa lida, cobrado na chave do OpenRouter. |

## As travas

O coordenador só lê quando as **duas** estão ligadas:

1. `NUCLEO_INSIGHTS=1` no `.env` **desta conexão** (abaixo). A Adriani não
   recebe a variável e fica de fora.
2. A função **"Leitura automatica das conversas"** ligada para a empresa no
   painel da plataforma. Com ela desligada, o banco responde `enabled = false`
   e o coordenador só espera, com uma linha `insights.disabled` por hora no
   journal.

Para desligar na hora, sem deploy: desligue a função no painel. Para tirar o
código: `NUCLEO_INSIGHTS=0` e restart.

---

## 0. Antes de tudo (fora da VPS)

- [ ] Migration `20260930100000` aplicada e conferida (`docs/coordenador-jev/APLICAR.md`).
- [ ] **Chave de produção** criada no OpenRouter, separada da de teste:
      nome `nucleo-coordenador-producao`, limite mensal (sugestão: US$ 5 por
      mês), se possível restrita ao modelo `typesafe/jev-1.13`.
- [ ] Função "Leitura automatica das conversas" **ligada para a Major** no
      painel da plataforma (`painel.nucleomajor.com`). Ela pede a confirmação
      de IA.

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../claudio-dormindo
cd "$ATIVA"
sha256sum whatsapp-assistant/{config,main,operator_verification}.py
```

```
e494ff6ac5eb13156cf3657c3642f65f7e067f85b491658f86c13763f276a1fd  whatsapp-assistant/config.py
bd312ece3776b5f2dd6220bee353f2367ecd19f3017b0189159e071b2499683c  whatsapp-assistant/main.py
03b62d58bef0a6a0d96f03311b966e439a3450ce3ef12e5fb5c9f6bbf1c42903  whatsapp-assistant/operator_verification.py
```

Se algum divergir, **pare**: alguém publicou outra release depois deste roteiro.

## 2. Construir a release nova

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/coordenador-jev
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
sha256sum /tmp/runtime-coordenador-jev.patch
# 1a7e73c1a7289a5871d4546a70bba6d900fca8b9dc281bbb4c450a1d824883bc
git apply --check -p1 /tmp/runtime-coordenador-jev.patch
git apply        -p1 /tmp/runtime-coordenador-jev.patch
```

O Bridge não muda e não reinicia.

## 3. Testar na release nova

```bash
cd "$NOVA/whatsapp-assistant"
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_coordenador 2>&1 | tail -3
~/.venvs/whatsapp-assistant/bin/python -B -m unittest discover -s . -p 'test_*.py' 2>&1 | tail -3
```

Esperado: `OK` nos dois (29 e 967 testes).

## 4. A chave (você digita; ela não passa pelo chat nem pelo git)

```bash
mkdir -p ~/.config/nucleo-major
install -m 600 /dev/null ~/.config/nucleo-major/openrouter-insights.key
nano ~/.config/nucleo-major/openrouter-insights.key
# cole a chave de produção (sk-or-v1-...), uma linha só, salve e saia
stat -c '%a %s' ~/.config/nucleo-major/openrouter-insights.key   # 600 e uns 70 bytes
```

## 5. Ligar no env da Major

```bash
ENVF=~/.config/whatsapp-assistant/$UUID.env
cp -a "$ENVF" "$ENVF.antes-coordenador"
cat >> "$ENVF" <<'EOF'
# O coordenador (01/10/2026): leitura automática das conversas com o Jev.
NUCLEO_INSIGHTS=1
NUCLEO_INSIGHTS_KEY_PATH=/home/nucleo/.config/nucleo-major/openrouter-insights.key
EOF
```

Opcionais, com o padrão entre parênteses: `NUCLEO_INSIGHTS_POLL_SECONDS` (300),
`NUCLEO_INSIGHTS_QUIET_MINUTES` (60, quanto tempo a conversa fica parada
antes de ser lida) e `NUCLEO_INSIGHTS_BATCH` (5 conversas por ciclo).

## 6. Virar a release e reiniciar só o assistente da Major

```bash
ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
readlink -f ~/whatsapp-mcp-hardened          # .../coordenador-jev
systemctl --user restart whatsapp-assistant@$UUID
systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$UUID
```

A Adriani (`a502a475…`) continua com o código antigo na memória até o próximo
restart dela, e mesmo depois dele nada muda: o env dela não tem
`NUCLEO_INSIGHTS`.

## 7. Conferir

```bash
journalctl --user -u whatsapp-assistant@$UUID --since "5 min ago" -o cat \
  | grep -E '"event": "(service.started|insights\.)' | tail -20
```

- `service.started` com `"insights_enabled": true`;
- em até 5 minutos, `insights.read` (uma por conversa lida) ou
  `insights.disabled` (a função está desligada no painel);
- `insights.paused` com `jev_key_*` = problema no arquivo da chave;
  `jev_http_401`/`402` = chave inválida ou sem crédito.

No banco (SQL Editor, só leitura):

```sql
select status, count(*), round(avg(latency_ms)) as ms_medio, sum(cost_usd) as custo_usd, max(created_at) as ultima
from public.conversation_insight_runs
where organization_id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
group by status;
```

E no portal: abra uma conversa que ficou parada mais de uma hora; a ficha
lateral mostra "Leitura automática".

## 8. Voltar atrás

Sem deploy: desligue a função no painel (o coordenador para no próximo ciclo).

Com deploy:

```bash
cp -a "$ENVF.antes-coordenador" "$ENVF"
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/claudio-dormindo ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
```

As leituras já gravadas ficam no banco; não atrapalham nada.

## 9. Registro do que já rodou

- 01/10/2026: patch em `/tmp` da VPS, hash conferido, `git apply --check` na
  release ativa `claudio-dormindo` OK.
- 01/10/2026, 23:49 UTC (autorizado pelo dono nesta sessão): base conferida
  pelos 3 hashes; release `coordenador-jev` criada com o patch; na VPS, 29
  testes do coordenador OK e a suíte inteira com 966/967 (a falha,
  `test_worker...test_timeout_do_claude_nao_envia_e_worker_sobrevive`, passa
  sozinha nas duas releases e `worker.py`/`test_worker.py` são idênticos: é
  sensível a tempo, não do patch); env da Major com backup
  `.antes-coordenador` e as duas linhas; symlink virado; só o assistente da
  Major reiniciado (`active`, `NRestarts=0`); Bridge intocado.
- Journal: `insights.paused` com `jev_key_unreadable`, o esperado sem a chave.
  Rollback: `claudio-dormindo`.
- **Falta só o passo 4 (a chave), que é do dono.** Depois de gravar o arquivo,
  reinicie o assistente da Major para não esperar o recuo (até 1 h).
