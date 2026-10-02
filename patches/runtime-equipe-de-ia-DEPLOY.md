# Deploy: Equipe de IA no runtime (playbook, jeito do agente e avaliação de teste)

> **Estado em 01/10/2026, ao fechar o roteiro:**
> - Base: a release ativa **`coordenador-jev`**. Os 4 arquivos que o patch
>   toca batem por sha256 com a cópia local usada para gerar o patch.
> - Patch `runtime-equipe-de-ia.patch`: 6 arquivos, 391 linhas a mais e 19 a
>   menos, sha256 `2a86311192b5fafff1649006acc68c6493e0cf017b52ca33a9f8b2f9cbf415e1`.
>   Já está em `/tmp/runtime-equipe-de-ia.patch` na VPS e o
>   `git apply --check -p1` na release ativa passou.
> - Base + patch, nesta máquina: **979 testes do assistente OK** (12 novos).
> - Depende da migration `20261001100000_equipe_de_ia_playbook_e_jev.sql`.
>   Sem ela, a fila do coordenador continua funcionando como antes (sem
>   agente e sem playbook) e o comando `insights_evaluate` nem chega à VPS.

## O que muda

- **Leitura das conversas:** as perguntas do Jev passam a ser a base da Major
  + o playbook publicado da empresa (objeções, próximos passos, critérios
  próprios) + "seguiu o jeito do agente?" com o `tone` do agente da conversa.
  Cada leitura grava o agente, quantas mensagens foram da IA, da equipe e do
  contato, e a versão do playbook.
- **Avaliação de teste:** o comando `insights_evaluate` (aba Testar do agente
  no portal) roda no executor de comandos: pergunta ao Jev e devolve o
  resultado compacto. Nada sai no WhatsApp; o texto não vai para log.
- **Um cliente do Jev só**, criado no `main.py` e usado pelo coordenador e
  pelo executor de comandos. Sem `NUCLEO_INSIGHTS=1`, o comando falha com
  `insights_disabled`.

Nenhuma variável nova de ambiente. O Bridge não muda.

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../coordenador-jev
cd "$ATIVA"
sha256sum whatsapp-assistant/{coordenador,jev_framework,main,runtime_commands}.py
```

```
6c600dd2ee3499542c218932649c0dea5c2d50e304956f7368fd46795ef04bfe  whatsapp-assistant/coordenador.py
98fab218f559daaf9e3dade5833f617a3f9bb0fabfe6dfff1d9df15bb05434c0  whatsapp-assistant/jev_framework.py
28179a4fd3fa6138f3f4bddb6309113ffcc4b0704d44d9b4f621dd1684b63951  whatsapp-assistant/main.py
1bc8bf3789eddd7ba8172700f03fb820f9bdfbeb8e36c3ffd5bc8acd6107672e  whatsapp-assistant/runtime_commands.py
```

## 2. Release nova, testes, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/equipe-de-ia
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-equipe-de-ia.patch
git apply        -p1 /tmp/runtime-equipe-de-ia.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_coordenador test_runtime_commands 2>&1 | tail -3
ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$UUID
```

## 3. Conferir

```bash
journalctl --user -u whatsapp-assistant@$UUID --since "10 min ago" -o cat \
  | grep -E '"event": "(service.started|insights\.|runtime.command_(completed|failed))' | tail -10
```

E no banco, as leituras novas com agente:

```sql
select assistant_profile_id is not null as com_agente, ai_messages, team_messages, playbook_version, created_at
from public.conversation_insight_runs
where organization_id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
order by created_at desc limit 5;
```

## 4. Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/coordenador-jev ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
```

## 5. Registro do que já rodou

- 01/10/2026: patch em `/tmp` da VPS, hash conferido, base conferida pelos 4
  hashes, `git apply --check` OK na release `coordenador-jev`.
