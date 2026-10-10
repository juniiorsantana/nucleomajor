# Deploy: desconectar e trocar o número pelo portal (troca voluntária)

> **Preparação e validações executadas pelo Codex; publicação ainda pendente (ver seção 9).** Escrito em 10/10/2026 (ORCH-014 a
> 016, `docs/troca-de-numero/PLANO.md`, fase 2). O dono autorizou a publicação em 10/10/2026. A troca efetiva da Major ainda será acompanhada pelo dono; nenhum logout foi executado. O symlink compartilhado não deve ser alterado.

## Estado ao fechar o roteiro

- **Migration:** `supabase/migrations/20261012100000_a_troca_voluntaria_de_numero.sql`.
  Não depende das migrations do aviso de queda (`20261011…`, não aplicadas).
  Pré-requisitos, todos já na `main`: a fila de comandos, o status do
  runtime, `private.is_notification_worker`, `private.is_platform_admin`,
  `private.platform_audit` e `private.org_access_state`.
- **Runtime** (`feat/troca-voluntaria`): `3f2c5cb` (o desvínculo, o mesmo de
  `41351a0`), `940f483` (Bridge), `eae3463` (assistente), `7e1f359` (prazo
  próprio da limpeza local e o recorte do histórico) e `78f1c4c`
  (`remoteLogout` nulo sem sessão), sobre o snapshot `5cf6135` da release
  ativa `analise-completa`.
- **Dois patches; use um só:**

  | Patch | Arquivos | sha256 | Quando |
  |---|---|---|---|
  | `runtime-troca-voluntaria-sobre-analise-completa.patch` | 13 (desvínculo + troca) | `528faf7b94ccb949f7d0611f20ff55ef73e5d3bf9551c760eeb3cf4655d98e31` | a ativa ainda é a `analise-completa`; `git apply --check` OK na cópia bruta dela |
  | `runtime-troca-voluntaria.patch` | 11 (só a troca) | `99ef39d7b1fa8f6c9c244bd7f54362161ba96c037002d08f32202e907e6143b8` | a release do desvínculo/aviso (patch `59e85936…`) já é a ativa; `--check` OK sobre `3f2c5cb` e `21ca806` |

- **Portal:** `feat/troca-voluntaria-de-numero` (`7170fc7` `32170fd` `7817ddc`
  `260156f` `cf65a69` `cd89963` `e0c014f`).
- **Testes:**
  - banco: prova em PGlite com todas as migrations e a fila real, 130/130;
    teste estático, 12/12;
  - servidor do portal: o aviso por e-mail com dublês, 9/9; `node --test`
    inteiro, 372/372 (nenhum e-mail real);
  - assistente: `test_runtime_commands`, `test_bridge_control` e `test_config`,
    OK (78 nos dois primeiros, na última rodada). A suíte inteira (1095) tem 28 falhas, todas fora desta mudança: as
    18 presas à data e 10 do `test_runner`, que também falham na `21ca806`
    num caminho com "ú" (o `.cmd` falso do teste não acha o Python do venv);
  - portal: vitest 1141/1141 e `build:web` OK; a bancada percorrida no
    navegador, com capturas em `docs/troca-de-numero/bancada-2026-10-10/`
    (branch de docs);
  - **Bridge validado em Linux pelo Codex:** 323 casos passaram, nenhum falhou e um foi pulado; `go build` da nova release também passou. A política do Windows não foi alterada.

## O que muda

- **Banco:** a liberação por conexão (`private.connection_change_policies`,
  só pelo SQL Editor; sem linha, ninguém troca), os pedidos, o histórico de
  identidades, a geração da conexão e `session_released_at` ("desconectada
  por escolha"). A identidade só muda quando a VPS conclui com a geração do
  pedido. Pedido, confirmação, aplicação e cada mudança de liberação vão para
  `platform_audit_log`, sem hash nem telefone.
- **Bridge:** `POST /api/internal/v1/session/logout` e `/session/identity`,
  com o token da conexão. Desligam a sessão: até 15 s para o WhatsApp
  confirmar (`Logout`) e, sem confirmação, até 5 s próprios para apagar só a
  local, dizendo `remoteLogout=false` (sem sessão, `remoteLogout` nulo). Sem
  sucesso enquanto a sessão continuar guardada. Gravam
  `store/controle_da_sessao.json` e reiniciam com exit 3, como no desvínculo.
  Depois disso o processo espera o portal em vez de abrir QR, a identidade
  esperada vem do arquivo (e não mais do `.env`), e o mesmo celular com e sem
  o nono dígito conta como o mesmo. Com `importHistory=false`, do histórico
  que o WhatsApp mandar entra só o que é de depois de o número certo conectar
  (o recorte é marcado no primeiro `Connected` com a identidade conferida).
  O `messages.db` não é apagado.
- **Assistente:** os comandos `connection_logout` e
  `connection_identity_replace` (timeout de 30 s nessas rotas), e o final
  novo no `connections.json`. O envio de código ao WhatsApp antigo
  (`connection_confirmation_send`) **não** existe: o modo com código fica
  fechado.
- **Portal:** a seção "Trocar ou desconectar o número" no cartão de cada
  conexão da VPS, para dono e administrador.
- **Aviso de segurança:** aplicada uma troca ou desconexão, os donos e
  administradores ativos recebem um e-mail. Quem envia é o servidor do portal,
  a cada minuto, com o token `CONNECTION_CHANGE_NOTICE_TOKEN` (o banco guarda
  o sha256). Sem o token, os avisos ficam pendentes e nada sai.

## Antes: condições, todas fora deste roteiro

1. Autorização do dono e uma janela de pouco movimento, com alguém olhando o
   portal e o journal.
2. **`go test` do Bridge rodado e verde** (passo 0).
3. A decisão sobre o ensaio numa conexão descartável antes da Major (D1
   intermediária, recomendada e não decidida). Os passos 3 a 8 servem às
   duas: troque `$T`.
4. As automações da Major durante a troca (D3, pendente). O interruptor da IA
   de uma conexão da VPS é só leitura no portal; pausar exige a VPS.
5. Se o worker de avisos de queda estiver ligado
   (`EMYLEADS_CONNECTION_ALERTS_LIVE=1`), a desconexão voluntária vira
   alerta. Mantê-lo desligado até o gatilho do aviso ignorar conexões com
   `session_released_at` preenchido.
6. `ASSISTANT_OWNER` da Major: conferir, sem ler o `.env` inteiro, se aponta
   para o próprio número da conexão. Se apontar, ele precisa ser trocado à mão
   depois (o runtime não conhece o número novo inteiro).
7. O chip antigo ativo e à mão: é condição para tentar voltar, **não
   garantia** (ver `docs/troca-de-numero/TESTE-REAL-NA-MAJOR.md`).
8. A lista de campanhas e links com o número antigo, e quem troca cada um.

## 0. `go test` do Bridge, antes de qualquer deploy (proposta)

Mesma receita da validação em Linux da ORCH-011: pasta temporária na VPS,
sem serviço, `GOPROXY=off`, cache próprio. Com o patch escolhido aplicado
sobre a cópia da ativa:

```bash
cd "$T_VALIDACAO/whatsapp-bridge"
/usr/local/go/bin/go vet ./... && /usr/local/go/bin/go test -count=1 ./...
```

Alternativa local: liberar no Windows o binário de teste do Go (decisão do
dono; não contornar a política).

## 1. Banco (SQL Editor, uma vez)

Pré-requisitos (só leitura):

```sql
select to_regclass('public.connection_runtime_commands') is not null as fila,
       to_regclass('public.connection_runtime_status') is not null as status_runtime,
       to_regprocedure('private.is_notification_worker()') is not null as worker,
       to_regprocedure('private.is_platform_admin()') is not null as plataforma,
       to_regprocedure('private.platform_audit(uuid,text,text,jsonb,jsonb,text)') is not null as auditoria,
       to_regclass('public.whatsapp_connection_change_requests') is null as ainda_nao_aplicada;
```

Ensaio: colar a migration trocando o `commit;` do fim por
`do $$ begin raise exception 'ensaio ok'; end $$;`. O erro desfaz tudo.
Depois, aplicar o arquivo como está e conferir o efeito:

```sql
-- um período inicial por conexão viva com número esperado
select count(*) from public.whatsapp_connection_identities where generation = 0 and reason = 'initial';
select phone_last4, reason, applied_at is not null as aplicado
from public.whatsapp_connection_identities
where connection_id = '8ee1e6d0-a9d0-4041-b6ea-878716a34a71';
-- ninguém liberado
select count(*) from private.connection_change_policies;            -- 0
select private.connection_change_mode('8ee1e6d0-a9d0-4041-b6ea-878716a34a71');  -- off
-- os três comandos novos na fila
select pg_get_constraintdef(oid) like '%connection_identity_replace%'
from pg_constraint where conname = 'connection_runtime_commands_command_type_check';
```

## 2. Release nova, com a base inteira (sem reiniciar nada)

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"        # analise-completa (patch combinado) ou desvinculo-sobre-analise (patch só da troca)
cd "$ATIVA"
sha256sum whatsapp-bridge/{connection,main,runtime}.go \
          whatsapp-assistant/{bridge_control,connections,runtime_commands,test_bridge_control,test_runtime_commands}.py
sha256sum /tmp/runtime-troca-voluntaria*.patch
systemctl --user cat whatsapp-bridge@.service whatsapp-assistant@.service
```

Hashes esperados na `analise-completa` (cópia bruta; iguais ao snapshot
`5cf6135`):

```
020b8733119005dbd4cb7c58b932c1073241c7d447c14fd0387ebcb1eae76972  whatsapp-bridge/connection.go
f776dbc3e2c9c36533d9bc2e5e1f206deeac820d263658ff770080c9aa541acc  whatsapp-bridge/main.go
0e0de1a26b407b1f589ddbbf5e536ae8b16d362aeccb85f0bcb3b349551e135b  whatsapp-bridge/runtime.go
0abf17d9619ce65ec743e9aa1c32dd06a0c41f7b968ebbe098604de76d9aa1c9  whatsapp-assistant/runtime_commands.py
0ce054c8e6793c181d9dd83b0204aa084c42bc8abf245c879223297228db6291  whatsapp-assistant/bridge_control.py
89cbbe06b8cad6f41da35ab653e7cf3a3953124f7d235d24399c8a12c243470c  whatsapp-assistant/connections.py
2c94186b5e870a1d4187d3b71fc20e2a62bad405cf9afd711b21ecfe7167b4bb  whatsapp-assistant/test_bridge_control.py
4e5853285ce0517e7baf79bc179b16d677e65485145e160a08763eabffe74a03  whatsapp-assistant/test_runtime_commands.py
```

Hash diferente: pare. Se a ativa já for a do desvínculo, os três `.go` mudam
(eles vêm do patch `59e85936…`); use o patch só da troca e confira com o
`--check`.

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/troca-voluntaria
test ! -e "$NOVA" || { echo "ja existe: $NOVA"; exit 1; }
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
P=/tmp/runtime-troca-voluntaria-sobre-analise-completa.patch   # ou o patch só da troca
git apply --check -p1 "$P" && git apply -p1 "$P"
diff -rq "$ATIVA" "$NOVA" --exclude=__pycache__ --exclude=whatsapp-bridge
cd whatsapp-bridge
/usr/local/go/bin/go vet ./... && /usr/local/go/bin/go test -count=1 ./...
/usr/local/go/bin/go build -o /tmp/whatsapp-bridge-troca .
cp /tmp/whatsapp-bridge-troca "$NOVA/whatsapp-bridge/whatsapp-bridge"
cd ../whatsapp-assistant
.venv/bin/python -m unittest test_runtime_commands test_bridge_control test_config
```

A release ativa continua intacta: é o alvo de rollback.

## 3. Só a conexão-alvo na release nova (o symlink NÃO vira)

O mesmo drop-in por instância do roteiro do desvínculo. `T` é a conexão de
ensaio ou, **só na janela**, a 8362.

```bash
T=<uuid da conexão>
for u in whatsapp-bridge whatsapp-assistant; do mkdir -p ~/.config/systemd/user/$u@$T.service.d; done
cat > ~/.config/systemd/user/whatsapp-bridge@$T.service.d/release.conf <<EOF
[Service]
WorkingDirectory=$NOVA/whatsapp-bridge
Environment=DEST=$NOVA
ExecStart=
ExecStart=/usr/bin/env bash $NOVA/scripts/run-connection.sh
EOF
cat > ~/.config/systemd/user/whatsapp-assistant@$T.service.d/release.conf <<EOF
[Service]
WorkingDirectory=$NOVA/whatsapp-assistant
Environment=ASSISTANT_MCP_CONFIG=$NOVA/scripts/vps/mcp-runtime.json
Environment=ASSISTANT_OPERATOR_RUNTIME_DIR=$NOVA/whatsapp-assistant/runtime-profile
EOF
systemctl --user daemon-reload
systemctl --user restart whatsapp-assistant@$T whatsapp-bridge@$T
for u in whatsapp-bridge@$T whatsapp-assistant@$T; do
  PID=$(systemctl --user show -p MainPID --value $u)
  echo "$u exe=$(readlink /proc/$PID/exe) cwd=$(readlink /proc/$PID/cwd)"
done
journalctl --user -u whatsapp-bridge@$T -n 30 --no-pager   # "Expected identity ****NNNN (ambiente)" e Connected
```

Com sessão guardada, o Bridge novo reconecta sozinho, sem QR: ainda não há
arquivo de controle, e a identidade é a do `.env`. Comandos proibidos: os
mesmos do roteiro do desvínculo (restart sem `$T`, `ln -sfn` no symlink
compartilhado, `daemon-reexec`).

## 4. Portal

Merge do PR de `feat/troca-voluntaria-de-numero` (o deploy do portal é
automático). Sem liberação, a seção diz "ainda não foi liberada para esta
conexão" e não oferece nada.

**O aviso de segurança por e-mail** (recomendado antes da primeira troca
real). O token é gerado por quem configura, fora de qualquer chat, e só o
sha256 vai para o banco:

```bash
TOKEN=$(openssl rand -hex 32)          # vai para CONNECTION_CHANGE_NOTICE_TOKEN do servidor do portal
printf '%s' "$TOKEN" | sha256sum       # vai para o SQL abaixo
```

```sql
insert into private.connection_change_notifier (token_hash) values ('<sha256 do token>');
```

Depois de pôr a variável no servidor do portal (com o SMTP do portal já
configurado) e reiniciá-lo, o envio roda a cada minuto. Conferir depois de
uma troca aplicada:

```sql
select notice_status, notice_attempts, notice_sent_at
from public.whatsapp_connection_change_requests
where connection_id = '<T>' order by created_at desc limit 3;   -- 'sent'
```

Sem o token, `notice_status` fica `pending` e ninguém é avisado: a troca
funciona do mesmo jeito.

## 5. Liberar a troca só para a conexão-alvo, com prazo (SQL Editor, janela)

```sql
-- quem vai operar: administrador da plataforma E dono ou admin da empresa da conexão
select exists (select 1 from public.platform_admins where user_id = '<uuid de quem opera>') as plataforma,
       (select member.role from public.organization_members member
         join public.whatsapp_connections connection on connection.organization_id = member.organization_id
        where connection.id = '<T>' and member.user_id = '<uuid de quem opera>') as cargo;

insert into private.connection_change_policies (connection_id, mode, reason, expires_at)
values ('<T>', 'direct',
        'Troca do número autorizada pelo dono em DD/MM/2026, janela HH:MM-HH:MM',
        now() + interval '6 hours');
select private.connection_change_mode('<T>');   -- direct
```

A liberação `direct` é a operação controlada: no máximo 7 dias (o banco
recusa mais), só para administrador da plataforma que também administra a
empresa, e nunca vale como padrão para todos. Fica no histórico da
plataforma (`whatsapp.change_policy_insert`).

## 6. A troca (portal, pela pessoa conferida acima)

1. Conexões → o cartão da conexão → **Trocar ou desconectar o número** →
   **Trocar por outro número** → número novo com DDD → **Continuar**.
2. Conferir o número inteiro na confirmação → **Trocar para o final NNNN**.
3. A seção mostra "Na fila da VPS", depois "A VPS está aplicando agora", e só
   então "Troca aplicada: a conexão agora espera o número final NNNN" (ainda não pronta). Na VPS:
   ```bash
   journalctl --user -u whatsapp-bridge@$T -n 40 --no-pager
   # "Session released by the portal; restarting so a fresh device can pair (exit 3)"
   # depois do reinício: "Expected identity ****NNNN (controle da sessao, geracao 1)"
   ```
   No banco:
   ```sql
   select kind, status, confirmation_method, generation, remote_logout, error_code
   from public.whatsapp_connection_change_requests where connection_id = '<T>' order by created_at desc limit 3;
   select expected_phone_last4, session_released_at is not null as liberada,
          verified_phone_last4 is null as verificada_limpa
   from public.whatsapp_connections where id = '<T>';
   ```
4. **Conectar WhatsApp** → ler o QR com o celular do número novo → o cartão
   volta a "conectado" com o final novo, e `session_released_at` some. Com o
   aviso ligado, os donos e administradores da empresa recebem o e-mail em
   até um minuto depois da "Troca aplicada".
5. Aceite: os critérios de `docs/troca-de-numero/TESTE-REAL-NA-MAJOR.md`.
6. Depois do aceite, alinhar o arquivo de ambiente do Bridge da conexão
   (`CONNECTION_EXPECTED_PHONE_HASH/LAST4`, ver `EnvironmentFile` da unit) aos
   valores novos de `whatsapp_connections`. Não precisa reiniciar: o arquivo de
   controle já manda; o `.env` alinhado só evita surpresa se o arquivo um dia
   for apagado.

Se a VPS não aplicar (fora do ar, binário velho), o pedido falha com o motivo
e a seção oferece **Tentar de novo** por 24 h, sem confirmar outra vez.

## 7. Fechar a janela

```sql
delete from private.connection_change_policies where connection_id = '<T>';
select private.connection_change_mode('<T>');   -- off
```

## 8. Voltar atrás

- **Antes de ler o QR do número novo**, ou com ele recusado: a conexão está
  liberada, então dá para **Trocar por outro número** de novo, para o número
  antigo, e ler o QR com o chip antigo. Só funciona se o WhatsApp aceitar o
  número antigo de novo naquele aparelho.
- **Runtime:** apagar os drop-ins de `$T`, `daemon-reload` e reiniciar só
  `$T`. Atenção: a release antiga não conhece `controle_da_sessao.json` e
  volta a conferir a identidade pelo `.env`. Se o número novo já estiver
  pareado, ela cai em `identity_mismatch` e bloqueia o envio até o `.env` ser
  alinhado ao número novo. Sem sessão e sem o desvínculo, ela abre QR sozinha.
- **Banco:** a migration não tem volta automática, e nem precisa: sem
  liberação, nada se mexe. Pedidos e identidades ficam como histórico.

## 9. Registro do que já rodou

Em 10/10/2026, após autorização do dono para publicar:

- Portal: 1141 testes e build:web passaram; servidor: 372 testes passaram.
- Banco descartável local: 130/130 verificações passaram.
- VPS: Bridge testado em ambiente isolado, 323 casos passaram, 0 falhas, 1 skip.
- Base ativa conferida por oito hashes; patch combinado conferido pelo sha256 e aplicado em cópia integral separada.
- Release preparada: `/home/nucleo/releases/whatsapp-mcp-hardened/troca-voluntaria`; compilação Go e 88 testes Python direcionados passaram.
- Nenhum serviço reiniciado, nenhum drop-in instalado e nenhum symlink alterado. A sessão 8362 continua na release anterior.
- SQL Editor: os seis pré-requisitos foram conferidos; migration ainda não aplicada. A abertura do arquivo local pelo navegador foi bloqueada pela política da ferramenta; aplicação SQL permanece pendente.
- Branch do portal enviada ao GitHub. Sem ativação do modo direct e sem troca real.

