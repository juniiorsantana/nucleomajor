# Deploy — três planos no runtime e o cliente final sem as ferramentas da Major

> **Estado em 22/09/2026, ao fechar o roteiro:**
> - Runtime em `feat/provisionar-conexao-de-cliente` @ `15508c5`, sobre a base
>   `feat/midia-no-portal` @ `19dea15`.
> - **A base é a produção de verdade:** os 121 arquivos `.py`/`.go`/`.sh`/`.md`
>   da release ativa `midia-no-portal` batem, por hash, com `19dea15`. Só não
>   existem lá os 5 arquivos novos do patch.
> - Patch `runtime-tres-planos.patch` = `git diff --binary 19dea15 15508c5`,
>   sha256 `3ff9fb9da5f2c12d71923fa54001891182756b8ac6bcbaf7e53fd81ce582891d`.
>   Já está em `/tmp/runtime-tres-planos.patch` na VPS, com o mesmo hash, e o
>   `git apply --check` na release ativa passou.
> - Base + patch, nesta máquina: **831 testes do assistente OK, 54 do MCP OK**,
>   `go vet` do Bridge OK.
> - As 4 migrations do checkout já estão aplicadas no banco (22/09/2026). Este
>   deploy não depende de nenhuma outra.
> - O que já rodou fica na seção 6.

O plano: `nucleomajor/plano-tres-planos-e-ia.md`, Parte B.

## O que muda para quem usa

| Quem | O que muda |
|---|---|
| **Cliente final da Major** | A IA que responde **deixa de ter** as ferramentas de ler conversas do WhatsApp e a busca na web. Antes, num turno sem agente vinculado, ela tinha as duas — um lead podia pedir o que outra pessoa escreveu e a ferramenta estava ali. Resposta pela base de conhecimento e pelas habilidades segue igual. |
| **Equipe da Major** (turno de operador) | As ferramentas de leitura do WhatsApp **voltam a funcionar**: liam `whatsapp-bridge/store/messages.db` da release, que não existe na VPS. Passam a ler o banco da conexão (`ASSISTANT_MESSAGES_DB`), só para leitura. |
| **Textos da Major** | Nenhum. O nome nos textos vem de `ASSISTANT_BRAND_NAME`, com padrão "Major". |
| **Cliente novo** | Pode ser provisionado nos três planos (`scripts/vps/provision-connection.sh`, ver o `README.md` de `scripts/vps`, seção 8). |

**Um efeito para acompanhar:** se algum atendimento da Major dependia de a IA
pesquisar na web para responder cliente, ele deixa de funcionar. Não era para
ser assim, e as habilidades de clientes não pedem isso. Mas vale olhar as
primeiras conversas.

## Ordem

Uma peça só: **o assistente reinicia, o Bridge não**. O Bridge muda apenas o
nome no texto da verificação de operador, e com o padrão "Major" o texto é o
mesmo. O binário novo é compilado na release para os clientes novos, mas o
processo do Bridge da Major continua rodando do binário atual, e o canal não cai.

O aviso de agenda (`agenda_notifications.py`) roda dentro do assistente: o
mesmo restart cobre.

---

## 1. Antes: conferir a base e o ambiente

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                          # esperado: .../midia-no-portal
cd "$ATIVA"
sha256sum whatsapp-assistant/{agenda_notifications,config,main,runner,worker}.py \
          whatsapp-bridge/main.go whatsapp-mcp-server/whatsapp.py
```

```
f16dd9119c300bc2d69d9d9571b7e7e14026f60b73ae114e3847613bcac12280  whatsapp-assistant/agenda_notifications.py
091602c4ec3b0cfce724f6522da6132ad9ca2fbdb439651ad64a3047c51b9502  whatsapp-assistant/config.py
8301577e835dbc40fc3a76dd98b492ebeae38eac971da6b6009a2690eeff561b  whatsapp-assistant/main.py
f0dff93bad84a403f339b5e75f496bbc22ed777db3acd140860f7f9204d915b4  whatsapp-assistant/runner.py
4ed516867a574c950906604c9e235151e648e4a7af49dcdd2474bf00c5015c5f  whatsapp-assistant/worker.py
a526c419206097667f3120f982d168f5b7613a01c4b574d03650022a0e2686b4  whatsapp-bridge/main.go
ae7b0b21d915e0c787771bc8e9ca5a9d28465531d1f5a3ab87b66dee61c92b8f  whatsapp-mcp-server/whatsapp.py
```

Se algum divergir, **pare**: a VPS já divergiu do git uma vez.

**O ambiente da Major precisa ter o caminho do banco.** O MCP do WhatsApp agora
**falha fechado** quando a conexão tem ID e não tem banco declarado: sem isso,
as ferramentas de WhatsApp dos turnos de operador param em vez de ler o banco
errado. O `restore-vps-state.sh`, que montou a Major, grava as duas chaves
juntas, e o próprio assistente depende desse caminho. Então é quase certo que
estão lá. Confira só os nomes e o caminho, sem imprimir segredo:

```bash
PID=$(systemctl --user show -p MainPID --value whatsapp-assistant@$UUID)
tr '\0' '\n' < /proc/$PID/environ \
  | grep -E '^(ASSISTANT_MESSAGES_DB|EMYLEADS_RUNTIME_CONNECTION_ID)=' \
  | sed -E 's/^(EMYLEADS_RUNTIME_CONNECTION_ID)=.*/\1=<definido>/'
```

Esperado: `ASSISTANT_MESSAGES_DB=/home/nucleo/.local/share/nucleo-major/whatsapp/<uuid>/messages.db`
e `EMYLEADS_RUNTIME_CONNECTION_ID=<definido>`. Se vier só o segundo, acrescente
o primeiro ao `.env` do assistente **antes** do restart.

## 2. Construir a release nova

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/tres-planos
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
sha256sum /tmp/runtime-tres-planos.patch
# 3ff9fb9da5f2c12d71923fa54001891182756b8ac6bcbaf7e53fd81ce582891d
git apply --check -p1 /tmp/runtime-tres-planos.patch
git apply        -p1 /tmp/runtime-tres-planos.patch
chmod +x scripts/vps/provision-connection.sh scripts/vps/connection-operators.sh
```

## 3. Testar na release nova

Bridge (Go de `/usr/local/go`, não `~/.local/go`):

```bash
cd "$NOVA/whatsapp-bridge"
/usr/local/go/bin/go vet ./...
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/whatsapp-bridge-tres-planos .
cp /tmp/whatsapp-bridge-tres-planos "$NOVA/whatsapp-bridge/whatsapp-bridge"
# O da release anterior continua válido: é o alvo de rollback.
ls -la "$ATIVA/whatsapp-bridge/whatsapp-bridge"
```

Assistente e MCP, com o Python de cada serviço:

```bash
cd "$NOVA/whatsapp-assistant"
~/.venvs/whatsapp-assistant/bin/python -B -m unittest discover -s . -p 'test_*.py' 2>&1 | tail -3
# Esperado: Ran 831 tests … OK

cd "$NOVA/whatsapp-mcp-server"
~/.venvs/whatsapp-mcp-server/bin/python -B -m unittest discover -s . -p 'test_*.py' 2>&1 | tail -3
# Esperado: Ran 54 tests … OK

cd "$NOVA"
python3 -m unittest scripts/vps/test_provision_connection.py scripts/vps/test_connection_operators.py 2>&1 | tail -3
# Esperado: Ran 22 tests … OK
```

## 4. Repontar e reiniciar só o assistente

```bash
ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
sleep 5
journalctl --user -u whatsapp-assistant@$UUID -n 30 | grep -o '"event": "service.started".*' | head -1
PID=$(systemctl --user show -p MainPID --value whatsapp-assistant@$UUID)
readlink /proc/$PID/cwd                       # dentro de $NOVA
```

O Bridge **não** é reiniciado. `readlink /proc/<pid do bridge>/exe` continua
apontando para o binário de `midia-no-portal`, e está certo assim.

## 5. Validação ao vivo

1. **Cliente é atendido como antes.** De um número de cliente, mande uma
   pergunta comum para o WhatsApp da Major. A resposta vem, no tom de sempre.
   No journal, nenhum erro de turno:

   ```bash
   journalctl --user -u whatsapp-assistant@$UUID --since "-10 min" | grep -E "error|failed" | tail
   ```

2. **O cliente não tem mais as ferramentas.** Do mesmo número, peça algo que
   só daria para responder lendo outra conversa ("o que o fulano te mandou
   hoje?"). A IA não consegue, e diz que não tem acesso. (O audit de
   ferramentas, `NUCLEO_TOOL_AUDIT_PATH`, registra só as ferramentas do Núcleo,
   não as do WhatsApp: ele não serve de prova aqui. A prova automática é
   `test_runner.py`, que confere a lista de ferramentas do turno de cliente.)

3. **O operador ganha as ferramentas de volta.** Do celular de um operador,
   peça ao assistente um resumo das últimas mensagens de um contato. Antes, isso
   falhava sem ninguém ver. Agora responde. Se aparecer `ASSISTANT_MESSAGES_DB e
   obrigatorio`, a conferência do passo 1 foi pulada: acrescente a chave e
   reinicie.

4. **Aviso de agenda.** O próximo lembrete sai igual, com "Major" no texto.

## Rollback

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/midia-no-portal ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
```

Nada no estado muda de formato: o rollback não precisa de backup. O Bridge não
foi reiniciado, então não há nada a desfazer nele.

## 6. O que foi feito

- **22/09/2026, preparação:** base conferida por hash (121/121); patch enviado
  para `/tmp/runtime-tres-planos.patch` (hash confere); `git apply --check` na
  release ativa: OK.
- **22/09/2026, 19:25 (Brasília), deploy autorizado pelo dono:**
  1. Os 7 hashes da base conferidos na release ativa `midia-no-portal`: iguais.
  2. Ambiente da Major (`/proc/<pid>/environ`): `ASSISTANT_MESSAGES_DB` =
     `.../whatsapp/8ee1e6d0-…/messages.db` e `EMYLEADS_RUNTIME_CONNECTION_ID`
     definidos. O leitor do WhatsApp tem o banco certo.
  3. Release `tres-planos` criada por `cp -a` + `git apply`; `runner.py` e
     `whatsapp.py` conferidos por hash contra `15508c5`.
  4. Na release: `go vet` OK, `go test ./...` OK, binário do Bridge compilado;
     MCP 54 OK, scripts da VPS 22 OK, assistente 831 OK.
  5. Symlink → `tres-planos`; **só o assistente** reiniciado às 22:25 UTC.
     `service.started` na porta 8090, cwd na release nova, aviso de agenda
     religado, nenhum erro. O Bridge ficou no mesmo processo (pid 203703,
     binário de `midia-no-portal`): o WhatsApp não caiu.
  6. Portal publicado no mesmo momento: `main` 045b898 → 0017107, no ar em
     segundos; `/api/billing/asaas` → 503 `billing-not-configured`,
     `checkoutUrl` vazio.
  - **Pendente:** ver o primeiro turno de cliente depois do restart (validação
    1 e 2 da seção 5).
