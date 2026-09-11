# Deploy manual — handoff automático com prazo, e recusa de Supabase diagnosticável

> **APLICADO EM PRODUÇÃO em 11/09/2026 01:45 (-03)**, com autorização explícita
> do usuário. Tudo o que está escrito abaixo foi executado nesta ordem e
> conferido:
>
> - patch aplicado nos 6 arquivos da release `handoff-com-prazo`;
> - os 6 sha256 pós-patch bateram exatamente com os previstos aqui;
> - suíte na VPS, com `~/.venvs/whatsapp-assistant/bin/python`: **`Ran 499 tests`,
>   `OK`** em 121s;
> - backup do banco do árbitro antes do restart em
>   `~/.local/state/nucleo-major/deploy-backups/arbitro-antes-handoff-com-prazo-20260911T044537Z.db`;
> - symlink repontado, serviço reiniciado: `active`, `running`, `NRestarts=0`,
>   `service.started` limpo. Bridge não tocado;
> - **cura confirmada no banco vivo**: a sessão `17de6f0c…` ganhou
>   `dono_ate = 1970-01-01T00:00:00.000+00:00`; as duas sessões atribuídas pelo
>   portal (`691e3ac7…`, `2b16179b…`) seguiram com `dono_ate` NULL, intocadas.
>
> Release anterior preservada em `pausa-saudacao` para rollback.

Corrige dois defeitos que apareceram juntos no diagnóstico de 11/09/2026, quando
uma conversa de cliente ficou **cinco dias sem resposta**.

**1. O handoff automático não sabia acabar.** Em 06/09 às 19:42 o modelo saiu
com 1 no meio de um turno de cliente (`triage.failed`, depois `run.failed` com
`error_code: model_unavailable`). O worker fez o que devia — entregou a conversa
para um humano — mas `dono = humano` não tem validade: só sai por ação explícita.
Só que ninguém foi chamado. O handoff por falha **não registra pedido na fila do
Supabase** (quem faz isso é a ferramenta `nucleo_transferir_atendimento_humano`,
via `nucleo_customer_handoff_request`), então não havia atendente, não havia
linha na fila e não havia botão para devolver. A conversa
(`17de6f0c-…`, contato `556592475324`) acumulou dez mensagens e respondeu
`inbound.ignored / ignored_handoff` até 11/09.

O mesmo defeito existia num **segundo** caminho, ainda não disparado em produção:
`intelligence.handoff`, quando o contexto de inteligência não vem. Esse é o mais
perigoso dos dois, porque depende do Supabase — que recusa com frequência (ver
defeito 2). Os dois foram corrigidos juntos.

A correção: handoff automático nasce com vencimento (`dono_ate`, 30 minutos) e a
IA retoma sozinha quando o prazo vence sem ninguém assumir. Handoff de gente —
atendente pelo portal, ou o assistente chamando a transferência — continua
**sem prazo e permanente**, que é a garantia oposta e a mais importante das duas.

**2. Toda recusa do Supabase tinha a mesma cara.** `_rpc` descartava o status e
o corpo e levantava sempre `"Supabase recusou {label}"`. Entre 08 e 10/09 a
sincronia de conversas foi recusada **2.828 vezes** (414 + 1413 + 1001) e não
havia como saber se era 429, 403 ou 500 sem abrir o Supabase do outro lado.
Agora a mensagem leva `HTTP <status>` e, quando vier, o `code` do PostgREST. A
**mensagem de texto do banco fica de fora de propósito**: ela é texto livre, pode
carregar telefone ou trecho de conversa, e este erro termina no journal.

## O que a migração cura sozinha

`Arbitro._migrar` ganha a coluna `dono_ate` e, ao criá-la, marca com vencimento
no passado as sessões **abertas**, com `dono = humano`, motivo de falha do
runtime e **sem atendente registrado** — exatamente as conversas que o defeito
deixou mudas. Na primeira mensagem seguinte, cada uma volta para a IA.

Isso inclui a `17de6f0c-…`. Ou seja: **o deploy destrava aquela conversa**. Não é
preciso mexer no SQLite à mão.

Conversa que uma pessoa assumiu não é tocada, mesmo que o motivo gravado seja de
falha — a cláusula do atendente é o que separa abandono de atendimento.

## Base esperada

As releases não são repositórios git — a base se confere por conteúdo.
A release ativa em 11/09/2026 é `pausa-saudacao`.

```bash
cd /home/nucleo/whatsapp-mcp-hardened/whatsapp-assistant
sha256sum arbitro.py operator_verification.py worker.py \
          test_arbitro.py test_operator_verification.py test_worker.py
```

Esperado, nesta ordem:

```
6030ab33e720a637bd92d694e24c30d3d7b2c04835e050108306a0ec4f5bb05f  arbitro.py
e3ed7fabcf145dac046da158188cea0425034cca8e7b51df0d412eee661dc084  operator_verification.py
de56d6df224b472c557e3d2bd946990b8509a361f47f4f36fda7e0fc64c14a5b  worker.py
0f876826f9259f8d4742f2ddcaa5e631c515909257d5b31f2e3fac3c5bb844d3  test_arbitro.py
91a8748ad4b87955e633d1802f631d40d799acac6e8f826a2afd24568a388e16  test_operator_verification.py
54ece16ffc191a27f567d2009a157702c788207399729af33cd5950b40ccb812  test_worker.py
```

Se algum hash divergir, pare: a release não é a que este patch espera.

## Aplicar

O patch já está na VPS em `/tmp/handoff-com-prazo.patch`
(sha256 `a6fb5c4386556e917a525c1bc20d6ef3780d80525190a2ec9bdacf4c44f03386`,
idêntico ao arquivo `.patch` ao lado deste documento). Se `/tmp` tiver sido
limpo, mande de novo:

```bash
scp -i ~/.ssh/nucleo_major_vps_ed25519 \
    patches/runtime-handoff-com-prazo-pausa-saudacao.patch \
    nucleo@179.199.130.206:/tmp/handoff-com-prazo.patch
```

A release nova **já existe** e é cópia exata da ativa — não rode o `cp -a` de
novo. O `--dry-run` abaixo já foi executado nesta sessão e passou nos 6
arquivos; está aqui para você repetir antes de escrever.

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/handoff-com-prazo
cd "$NOVA"
patch -p1 --dry-run < /tmp/handoff-com-prazo.patch
patch -p1           < /tmp/handoff-com-prazo.patch
```

Confira o resultado por conteúdo:

```bash
cd "$NOVA/whatsapp-assistant"
sha256sum arbitro.py operator_verification.py worker.py \
          test_arbitro.py test_operator_verification.py test_worker.py
```

Esperado:

```
cdb41e9183562d806cc081727d5eac4eaff3c5cdc6acc86485a40f407847bd5b  arbitro.py
327ec36ce11acefaf4c7826f1b912a7883e0bb72c02e1ecce1d84ce0197bc9de  operator_verification.py
f7bdc0e510b472b8b211f5804b7c8de4473e2a6f343e73dc26925064879312ff  worker.py
707a7bcecb81e73852b17c407e681f8f020ee118f26b4accc92bc9faa0f4da43  test_arbitro.py
d648d9568a6c522a1089babbba910919a8998306921b0406276c65fee25256e3  test_operator_verification.py
fedb897eaccb6fa319ba1e4db73dc6f25e7d107f010528cdcd375b8a73350eb8  test_worker.py
```

## Testar antes de trocar o symlink

```bash
cd "$NOVA/whatsapp-assistant"
~/.venvs/whatsapp-assistant/bin/python -B -m unittest discover -s . -p 'test_*.py'
```

Referência medida localmente sobre cópia byte a byte da release: `Ran 499 tests`,
`OK`. São **23 testes novos** — 15 em `test_arbitro.py`, 6 em
`test_operator_verification.py`, 2 em `test_worker.py`. Os de `HandoffAutomaticoTest`
e `CuraDasConversasMudasTest` não existem no código antigo (`assumir_por_falha`
nem existe lá): são o defeito reproduzido.

## Trocar e reiniciar

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/handoff-com-prazo \
        /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
systemctl --user is-active 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
journalctl --user -u 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service' -n 60 --no-pager
```

O Bridge não precisa reiniciar.

## Validar em produção

**A cura da conversa muda.** Depois do restart, confira que a sessão travada
ganhou vencimento no passado:

```bash
sqlite3 -line 'file:/home/nucleo/.local/state/whatsapp-assistant/8ee1e6d0-a9d0-4041-b6ea-878716a34a71/arbitro.db?mode=ro' \
  "select id, dono, motivo, dono_ate from conversa_sessao
   where id = '17de6f0c-7fa8-489d-863b-83c4ab5692da';"
```

Esperado: `dono = humano`, `dono_ate = 1970-01-01T00:00:00.000+00:00`. A próxima
mensagem do contato devolve a conversa para a IA — no log,
`ignored_handoff` dá lugar a uma resposta normal, e a sessão passa a
`dono = ia` com motivo `espera do handoff automático venceu`.

**A recusa diagnosticável.** Na primeira recusa do Supabase, o log agora mostra
o status:

```bash
journalctl --user -u 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service' \
  --since '10 min ago' --no-pager -o cat | grep -E 'sync_failed|commands_unavailable' | tail -5
```

Esperado: `"error": "Supabase recusou sincronia de conversas (HTTP 429)"` ou
equivalente, em vez da frase sem status. **Esse número é o próximo trabalho** —
ele diz se as ~1.000 recusas por dia são limite de taxa, permissão ou falha.

## O que este patch NÃO faz

**Não registra o handoff automático na fila do portal.** Continua não existindo
linha em `customer_handoff_requests` para um handoff que o runtime deu em si
mesmo, e portanto continua não existindo o botão "devolver para a IA" para ele.
O que mudou é que a ausência do botão deixou de custar uma conversa: o prazo
devolve sozinho. Registrar o pedido de verdade exige credencial de organização
no runtime e uma RPC nova — é trabalho de outra fatia.

**Não responde a mensagem que foi perdida na falha.** A retomada acontece na
mensagem SEGUINTE. A que chegou durante o handoff já foi consumida; quem ficou
sem resposta segue sem resposta até escrever de novo.

**Não conserta a recusa do Supabase.** O defeito 2 é de diagnóstico, não de
causa: agora dá para saber qual é o erro.

## Rollback

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/pausa-saudacao \
        /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
```

A coluna `dono_ate` fica no banco — o código antigo a ignora, e `_migrar` não a
recria. A cura já aplicada também fica; para o código antigo ela é uma coluna
que ninguém lê, então as conversas curadas voltam a ficar caladas até o patch
subir de novo.
