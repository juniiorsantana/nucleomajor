# Plano de execução — ler o QR do WhatsApp dentro do Núcleo Major

Escrito em **09/09/2026**. Documento de handoff: quem executar não precisa
redescobrir nada daqui.
Escopo: **só o QR.** Reconexão automática, alarme de queda e a sincronia
travada estão fora — ver `plano-conexao-whatsapp.md`.

---

## ESTADO — leia primeiro

> **Onde paramos:** **A, B e C escritas e verdes.** Falta commitar e aplicar.
> **Próxima ação:** commitar as três frentes e aplicar na ordem A → B → C.
> **Nada aplicado em produção ainda, e nada commitado ainda.**
>
> Este bloco e o "Registro de andamento" no fim do arquivo são atualizados a
> cada passo concluído. Se a conversa se perder, comece por eles.

| Etapa | Estado |
|---|---|
| A — migration (portal) | `[x]` escrita e verde |
| B — runtime (Python) | `[x]` escrito e verde |
| C — portal (tela e transporte) | `[x]` escrita e verde |
| Aplicar em produção | `[ ]` na ordem A → B → C, pelo Junior |

**Arquivos criados/alterados até aqui:**

- `supabase/migrations/20260910010000_qr_do_whatsapp_pelo_portal.sql` (novo)
- `supabase/test_qr_pelo_portal_migration.py` (novo) — 14 testes
- **Runtime, em worktree própria:**
  `.worktrees/qr-pareamento`, branch **`conexao/qr-pelo-portal`**, criada de
  `17be75d`. Foi criada worktree nova de propósito: trocar a branch da
  `.worktrees/fase-14-runtime` mexeria no trabalho do gatilho `/major`, que
  está commitado lá e ainda não implantado.
  - `whatsapp-assistant/runtime_commands.py` — `COMANDOS`, `CAMPOS_DO_QR`,
    o ramo no `_execute`, `_parear`, `_falhar_pareamento` e
    `_motivo_do_pareamento`.
  - `whatsapp-assistant/test_runtime_commands.py` — 10 testes novos.

**Decisão tomada na etapa A, que muda o resto:** os dois comandos ganharam
**RPCs próprias** (`nucleo_connection_pair_request` e
`nucleo_connection_pair_status`), e não mais um tipo dentro da
`nucleo_conversation_command_enqueue`. Motivo: aquela função guarda com
`is_org_member`, e parear exige `owner`/`admin` — duas réguas na mesma função é
como uma delas afrouxa sem ninguém ver. Mesmo raciocínio que separou
`nucleo_conversation_start`. **O portal (etapa C) chama as RPCs novas, não a
`enqueue`.**

---

## 1. De onde vem o QR (a pergunta, respondida)

**O QR já é gerado, já vira imagem e já funciona.** Nada disso precisa ser
construído.

| Etapa | Quem faz | Onde |
|---|---|---|
| Gera o código | `whatsmeow`, dentro do bridge Go, quando `StartPairing()` abre o QR channel | `whatsapp-bridge/connection.go:316` |
| Vira PNG | o **próprio bridge**, com `qr.Encode` + base64 | `whatsapp-bridge/connection_http.go:85` |
| Sai pela rota | `GET /api/internal/v1/pairing/qr` → `{status, imageData, expiresAt}` | `127.0.0.1:8080` |
| Começa o pareamento | `POST /api/internal/v1/pairing/start` | `127.0.0.1:8080` |
| Cliente pronto no runtime | `start_pairing()` e `pairing_qr()` | `whatsapp-assistant/bridge_control.py:34` |
| Gateway do runtime | `/api/v1/connections/<id>/pairing/qr` | `127.0.0.1:8090` |
| A tela que desenha | `<img src={qr.imageData}>` | `Conexoes.jsx:552` |

O `imageData` volta como `data:image/png;base64,...`. **Não é preciso nenhuma
biblioteca de QR no portal** — a tela já sabe desenhar, e o painel "O QR
aparecerá aqui" já está lá, esperando.

### Então por que não aparece?

As duas portas (`8080` e `8090`) escutam **só em loopback** na VPS.
Publicamente só a 22 está aberta. E `gatewayProvider.js:21` aponta o pareamento
para `http://127.0.0.1:8090` — que, no navegador, é o **PC de quem está
olhando**, não a VPS. Foi desenhado quando runtime e navegador eram a mesma
máquina.

Por isso `Conexoes.jsx:511` esconde o botão quando `conexao.remoteManaged` (que
é só `Boolean(control)`: qualquer conexão com heartbeat). Esconder foi a decisão
certa — o botão chamaria o computador do usuário.

> **O trabalho não é gerar QR. É levar o QR que já existe da VPS até o
> navegador.** É um problema de correio, não de geração.

---

## 2. O correio já existe, e já foi provado

`connection_runtime_commands` — a fila que o portal e a VPS usam desde 26/08 e
que ganhou comandos novos em 08/09, incluindo um que **pergunta em vez de
enviar** (`conversation_check`). É exatamente o formato de que o QR precisa.

| Peça | Nome |
|---|---|
| Tabela | `public.connection_runtime_commands` |
| Enfileirar (portal) | `public.nucleo_conversation_command_enqueue` |
| Acompanhar (portal) | `public.nucleo_conversation_command_status` |
| Reivindicar (runtime) | `public.nucleo_runtime_commands_claim` |
| Concluir (runtime) | `runtime_command_complete` |
| Laço no runtime | `whatsapp-assistant/runtime_commands.py` |

E o detalhe que encurta o trabalho: **`RuntimeCommandPoller` já recebe
`registry` e `manager` no construtor** (`runtime_commands.py:96`). Ou seja, ele
já pode chamar `manager.control_for(conexao).start_pairing()` **sem nenhuma
dependência nova**. O `ConnectionManager` também já resolve o bearer correto por
conexão (`registry.internal_token`) — que é onde um multi-tenant costuma
tropeçar.

---

## 3. Contrato proposto — dois comandos

**`connection_pair_start`**

- Payload privado: vazio. Não há nada sensível para mandar.
- Runtime: `manager.control_for(conexao).start_pairing()`.
- Resultado público: `{"status": "starting_pairing"}`.
- Erros próprios: `session_exists` (o bridge recusa com 409 — **isso é uma
  barreira de segurança, não um erro chato**: parear sobre sessão boa apagaria
  a conta que está funcionando), `pairing_in_progress`, `bridge_offline`,
  `pairing_unsupported` (VPS com binário velho; a ação é implantar, não repetir
  — mesmo raciocínio do `check_unsupported`).

**`connection_pair_qr`**

- Runtime: `manager.control_for(conexao).pairing_qr()`.
- Resultado público: `{"status", "imageData", "expiresAt"}`.
- `bridge_control.pairing_qr()` **já remove o código cru** antes de devolver
  (`bridge_control.py:40`); o resultado público leva só a imagem. Manter assim.
- "Ainda não tem QR" é **resposta**, não falha: vai em `public_result`, nunca em
  `error_code`. É a mesma decisão já documentada no `_conversa_verificar` —
  marcar como falho faria a tela mostrar erro de sistema para uma pergunta que
  foi respondida.

O código gira a cada ~20s e a janela inteira morre em ~2min, então o portal pede
o QR **várias vezes**. Cada volta pela fila custa ~2s (o poller roda em 2.0s), o
que cabe folgado.

---

## 4. Segurança — não é opcional

**O QR é uma credencial.** Quem o escaneia vincula um aparelho à conta e passa a
ler tudo. Um QR vazado é acesso à conta do cliente.

1. **Só dono/admin enfileira.** A guarda vai **na RPC**, não só na tela.
2. **`expires_at` de 60 segundos** no comando. QR guardado é chave esquecida na
   porta.
3. **Apagar o `imageData` no desfecho** — quando o status virar `connected`, ou
   no vencimento. A linha da fila não pode ficar com a imagem parada nela.
4. **Nunca em log**: nem `imageData`, nem o código cru. O `audit.log` registra
   que houve pedido e o status — como o `conversation_check` já faz, deixando o
   telefone de fora.
5. **Teto por hora por organização.** O molde está pronto: a recusa
   `too many conversations started in the last hour`.
6. **Quem pediu fica registrado** — `created_by` já existe na tabela.
7. **Não contornar o `session_exists`.** Nunca.

---

## 5. O que mudar, arquivo por arquivo

Três repositórios. A ordem importa e não é a intuitiva: **migration → runtime →
portal**. Fora de ordem, o sintoma é uma tela oferecendo o que a VPS ainda não
sabe fazer.

### A. Migration (este repo, `supabase/migrations/`)

1. Reescrever o check de `command_type` **com a lista inteira** — disciplina do
   repo: a lista mora num lugar só e é reescrita, nunca "acrescentada". Ver
   `20260908120000_nova_conversa_e_verificacao_de_numero.sql:113`. Acrescentar
   `connection_pair_start` e `connection_pair_qr`.
2. `nucleo_conversation_command_enqueue`: aceitar os dois tipos por um caminho
   próprio — como o `conversation_check`, eles **não exigem conversa
   espelhada**. Aqui entram a guarda de papel (dono/admin) e o teto por hora.
3. `nucleo_conversation_command_status`: os dois tipos precisam entrar na lista
   `command_type in (...)`, que aparece em **três** lugares na função
   (expiração, busca e resposta). Esquecer um deles é a falha silenciosa mais
   provável desta migration.
4. Índice novo: nenhum. `connection_runtime_commands_claim_idx` já cobre.
5. Aplicar **pelo SQL Editor**. Nunca `supabase db push` — o histórico remoto
   está incompleto e o push é destrutivo.

### B. Runtime (`whatsapp-mcp-hardened`, worktree `.worktrees/fase-14-runtime`)

> ⚠️ **Ramificar de `17be75d`**, que é o que está em produção. O worktree está
> hoje em `equipe/agente-so-com-gatilho` (`33c9182`), que carrega trabalho **não
> implantado** — ramificar dali arrastaria o gatilho `/major` junto, sem querer.

1. `runtime_commands.py`: os dois nomes em `COMANDOS` (linha 42), dois ramos em
   `_execute` (linha 168) e dois métodos no molde de `_conversa_verificar`
   (linha 311) — inclusive a decisão de `public_result` vs `error_code`.
2. Dependência nova: **nenhuma**. `registry` e `manager` já estão no construtor.
3. `bridge_control.py`: **nada a mudar**.
4. Testes: `test_runtime_commands.py` já tem o molde do `conversation_check`.
5. Deploy: **é só Python.** Nenhum `.go` muda, então o binário do bridge se copia
   do release atual sem compilar. Release nova por `cp -a`, sobrescrever com os
   blobs do git, reiniciar **só** o `whatsapp-assistant@`.

### C. Portal (este repo)

1. `web/gatewayProvider.js`: `gateway.parear` (linha 509) e `gateway.qr` (linha
   519) ganham o caminho remoto — se a conexão é `remoteManaged`, enfileirar o
   comando em vez de bater em `127.0.0.1:8090`. As duas funções já existem; o
   que muda é o **transporte**, não a interface que a tela consome.
2. `Conexoes.jsx:511`: o botão deixa de depender de `!remoteManaged` e passa a
   depender de "existe caminho" — local **ou** remoto.
3. O laço: pedir o QR, desenhar, e **pedir de novo antes do `expiresAt`**.
   Reaproveitar o acompanhamento do `ModalNovaConversa`, que já faz
   enfileirar → acompanhar → desistir com orçamento próprio (45s).
4. Sucesso: status `connected` para o laço, fecha o QR e recarrega a conexão.
5. `Conexoes.jsx:399`: trazer junto o tom vermelho para `logged_out` (é a A.1 do
   outro plano). Sem isso o botão existe e ninguém percebe que precisa clicar —
   a tela continua toda verde.

---

## 6. Como provar

- `connection_http_test.go` já cobre a rota do QR no bridge.
- `go test` **não roda no Windows** (a política de Controle de Aplicativo
  bloqueia o binário de teste); aqui dá para `go vet ./...`, e o `go test` roda
  na VPS. Neste plano, porém, **nenhum `.go` muda**.
- Ponta a ponta: a conexão está caída de verdade agora (desde 08/09 22:47:54) —
  clicar no botão, ver o QR aparecer em ~5s, escanear com o número `•••• 8362` e
  ver o estado virar `connected`.
- **O teste que mais vale:** pedir pareamento com sessão **viva** e conferir que
  o bridge recusa com `session_exists` e que a tela explica em vez de quebrar.

---

## 7. O que este plano não faz

- Não conserta a sincronia travada desde 08/09 16:55
  (`control_plane_unavailable`).
- Não faz reconexão automática nem alarme de queda.
- Não mexe em `/reconnect` — é botão separado, para sessão que caiu mas não foi
  encerrada, e esse não precisa de celular na mão.

## Registro de andamento

| Data | Responsável | Item | Estado | Evidência / observação |
|---|---|---|---|---|
| 09/09/2026 | Claude | plano | escrito | Levantado por leitura do bridge, do runtime e do portal; nada implementado. |
| 10/09/2026 | Claude | C — portal | concluída | `pareamentoRemoto` no `gatewayProvider.js` (enfileira + acompanha, 12×700ms); `remoto` em `gateway.parear`/`gateway.qr`; botão "Conectar número" liberado para a VPS com cargo; Reconectar/Revogar seguem locais; `logged_out` virou vermelho. Portal: **627/627** (+5), servidor: **235/235**, `npm run check`: build ok. **Sem commit.** |
| 10/09/2026 | Claude | B — runtime | concluída | `_parear` no molde do `_conversa_verificar`; o código cru do QR nunca sai (lista de campos explícita); 409 dividido em `session_exists` e `pairing_in_progress`. Suíte do runtime: **396/396**. Branch `conexao/qr-pelo-portal`, **sem commit**. |
| 10/09/2026 | Claude | A — migration | concluída | `20260910010000_qr_do_whatsapp_pelo_portal.sql` + 14 testes. Suíte de migrations: **178/178**. RPCs próprias, guarda `owner`/`admin`, TTL 60s/30s, tetos separados (10 aberturas, 400 leituras), imagem apagada após 2 min. **Não aplicada no banco remoto.** |
