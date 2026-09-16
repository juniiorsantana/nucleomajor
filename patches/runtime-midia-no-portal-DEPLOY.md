# Deploy — mídia nas conversas e conversa sob LID (16/09/2026)

> **Estado em 15/09/2026 (Brasília), ao fechar o código:**
> - Runtime em `feat/midia-no-portal` @ `19dea15`, rebaseado sobre a base
>   REAL de produção `feat/leads-do-site` @ `a2dd77a` (release `leads-do-site`;
>   a release `fase2-autoria` já tinha sido superada). 823 testes OK na máquina
>   de desenvolvimento; `go vet` e `go test ./...` do Bridge OK. Portal em
>   `feat/midia-nas-conversas` (715 testes OK, build OK).
> - O andamento do deploy está no fim deste arquivo (seção 7).

O diagnóstico e o plano: `C:\Users\junin\.claude\plans\eu-preciso-que-voc-graceful-eagle.md`
(a conversa do Juliano dividida entre o LID `20525648752707` e o telefone
`556593264109`; 7 das 23 conversas diretas sob LID; mídia só com rótulo).

## O que muda para quem usa

| Quem | O que passa a ver |
|---|---|
| A equipe, no portal | Áudio recebido toca na bolha; imagem recebida aparece e abre em tela cheia. O clipe anexa imagem (JPG/PNG/WebP até 10 MB); o microfone grava áudio, que se ouve antes de enviar. Legenda opcional. O texto de quem tem nome na bolha sai sem o `*Nome:*` repetido. |
| O contato, no WhatsApp | A imagem chega com legenda; o áudio gravado no portal chega como **mensagem de voz**. |
| A caixa de entrada | A conversa do Juliano vira uma só (a do telefone, com as quatro mensagens dele de 15:11). As outras seis sob LID convergem conforme o WhatsApp informar o telefone delas. O canal (`@newsletter`) some da lista. |

Continua como rótulo: documento, vídeo, figurinha, e mídia digitada do
celular (o Bridge não guarda chave do que ele mesmo manda).

## Ordem

Quatro peças. A ordem **importa**:

1. **Migrations** (aditivas; sozinhas não mudam nada que se vê).
2. **Bridge** — `/api/send/human` passa a aceitar `media_path`. Recompilar e
   reiniciar: o canal cai por ~1 min. **Antes do runtime**: com o Bridge velho
   o campo é ignorado e só a legenda sairia.
3. **Runtime** — espelho de arquivos, envio com anexo, `aliases`. Só o
   `whatsapp-assistant@` reinicia.
4. **Portal** — push para `main`; a Hostinger publica.

Portal antes do runtime também funciona (a bolha continua só com rótulo, o
clipe e o microfone ficam ligados mas o envio com anexo falha com
`unsupported`/`invalid_payload` até o runtime subir). Runtime antes do Bridge
**não**: anexo pelo portal sairia sem o arquivo.

---

## 1. Migrations (SQL Editor, nunca `supabase db push`)

Na ordem, cada uma num `begin; … commit;` próprio:

1. `supabase/migrations/20260916100000_conversa_sob_lid_converge_para_o_telefone.sql`
2. `supabase/migrations/20260916110000_midia_das_conversas_no_storage.sql`

Conferir de fora (REST com a chave de `.env.skills.local`, somente leitura):

```
GET /rest/v1/whatsapp_messages?select=media_path,media_mime&limit=1   → 200 (colunas existem)
GET /storage/v1/bucket/whatsapp-media (com a service key)              → public: false, 16777216
```

E pelo SQL Editor: `select proname from pg_proc where proname in
('nucleo_conversation_sync_without_photos','nucleo_conversation_command_enqueue');`
e `select policyname from pg_policies where tablename = 'objects' and
policyname like 'whatsapp_media_%';` → quatro policies.

## 2. Bridge

### Base esperada

Release ativa = `leads-do-site` = `feat/leads-do-site` @ `a2dd77a`
(conferido em 15/09/2026 por hash dos oito arquivos do assistente). O
processo do **Bridge**, porém, ainda rodava do binário de `lembrete-de-espera`
(`/proc/<pid>/exe`) — o Bridge não tinha sido reiniciado desde 10/09. Os
arquivos Go são os mesmos em todas as releases desde então. Conferir por hash,
**nunca pelo `HEAD` do release**:

```bash
cd /home/nucleo/releases/whatsapp-mcp-hardened/<release-ativa>
sha256sum whatsapp-bridge/human_send.go whatsapp-bridge/main.go
```

```
4ced2b6de1499e72a71fec895135140bcb67e3ec786b8a774dedefce37eff106  whatsapp-bridge/human_send.go
aec8024d4004fafa7c08ba0f16ce462ae7b55548946a230eeea05c590fa3e6d8  whatsapp-bridge/main.go
```

Se divergirem, **pare**: a VPS já divergiu do git uma vez.

Patch (runtime e Bridge juntos): `runtime-midia-no-portal.patch` =
`git diff a2dd77a 19dea15`, sha256
`e3c234838ee0e82b332580b525f24a39f064c6900b7fa9c77115ccd8b86c511b`.

### 2.1 Construir a release nova

```bash
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/midia-no-portal
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
sha256sum /tmp/runtime-midia-no-portal.patch
git apply --check -p1 /tmp/runtime-midia-no-portal.patch
git apply        -p1 /tmp/runtime-midia-no-portal.patch
```

### 2.2 Compilar e testar (Go de `/usr/local/go`, não `~/.local/go`)

```bash
cd "$NOVA/whatsapp-bridge"
/usr/local/go/bin/go vet ./...
/usr/local/go/bin/go test ./...
/usr/local/go/bin/go build -o /tmp/whatsapp-bridge-midia .
cp /tmp/whatsapp-bridge-midia "$NOVA/whatsapp-bridge/whatsapp-bridge"
# O release ANTERIOR precisa continuar com binário válido — é o alvo de rollback.
ls -la "$ATIVA/whatsapp-bridge/whatsapp-bridge"
```

### 2.3 Repontar e reiniciar (janela combinada — o canal cai ~1 min)

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
PID=$(systemctl --user show -p MainPID --value whatsapp-bridge@$UUID)
readlink /proc/$PID/exe; readlink /proc/$PID/cwd     # antes: a release ativa
ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-bridge@$UUID
sleep 20
PID=$(systemctl --user show -p MainPID --value whatsapp-bridge@$UUID)
readlink /proc/$PID/exe; readlink /proc/$PID/cwd     # depois: $NOVA
journalctl --user -u whatsapp-bridge@$UUID -n 40 | grep -i "Connected to WhatsApp\|logged out\|QR"
```

A sessão fica em `whatsapp.db`; **não** deve pedir QR. Se pedir, parear pelo
portal (Conexões → Conectar número) — ver a memória do QR pelo portal.

Conferência da rota: `curl -s -o /dev/null -w '%{http_code}' -X POST
http://127.0.0.1:8080/api/send/human` → `401` (existe, exige bearer).

**Atenção — o Bridge reiniciou, então o `outbox/` dele é
`$NOVA/whatsapp-bridge/outbox`.** É o mesmo que o runtime da mesma release
usa por padrão. Se um dia o runtime subir de release diferente do Bridge,
aponte `WHATSAPP_OUTBOX_DIR=<cwd do Bridge>/outbox` no env da unit do
assistente (`readlink /proc/<pid do bridge>/cwd`).

## 3. Runtime

### 3.1 Pré-requisito: ffmpeg

```bash
which ffmpeg || ffmpeg -version
```

Sem ele, o envio de **áudio** pelo portal falha com
`media_conversion_failed` (imagem e recepção não dependem dele). Instalar
(`sudo apt install -y ffmpeg`) ou, sem root, um binário estático em
`~/.local/bin/ffmpeg` e `EMYLEADS_FFMPEG_BIN=/home/nucleo/.local/bin/ffmpeg`
no env da unit.

### 3.2 Testar na release nova com o Python do serviço

```bash
cd "$NOVA/whatsapp-assistant"
# Base a2dd77a (ANTES do patch; depois dele os hashes mudam, e é esperado):
#   999ff9aee62bf73464e82294ea34c6620543813e01bfd40c7253a7296c368ca9  chat_identity.py
#   27de59d3955ab29e0b6f80ee5adadbfa6e2e286ac861e9c728d1e8469d25aadd  config.py
#   cbda36950763a15f6785647ceac56a8161d55f4a12d4da07c918940836a70524  conversation_sync.py
#   0c89be776bd4d99c2adc9c094fbd7e295fd1882aa143c52a8b0060347b5317a0  main.py
#   d76ac1d39f3d5d70202bb69b56cfa7f93863b8c63cdacda40f0da4828921f243  operator_verification.py
#   1547769097a70013f70a8e2d626e0a30f4f3cb81e6c99ccdb753f60d5613820f  presenca_humana.py
#   e64ebacfb381344d834381029e5b5a8c1b3bc0367ea1cf65b8dc8fcc0ecdd879  runtime_commands.py
#   9d1d4b616af1bf39ceeb6abf87622e4655ed9ac68858151a99f35de2991c2db4  send.py
~/.venvs/whatsapp-assistant/bin/python -B -m unittest discover -s . -p 'test_*.py' 2>&1 | tail -3
# Esperado: Ran 823 tests … OK
```

### 3.3 Reiniciar só o assistente

```bash
systemctl --user restart whatsapp-assistant@$UUID
sleep 5
journalctl --user -u whatsapp-assistant@$UUID -n 30 | grep -o '"event": "service.started".*' | head -1
```

O `service.started` precisa trazer `"media_mirror": true` e o `outbox_dir`
dentro da release nova. Depois, por alguns minutos:

```bash
journalctl --user -u whatsapp-assistant@$UUID -f | grep -E "media\.|conversation\.sync_failed"
```

- `media.mirror_failed`/`media.mirror_abandoned` com `OperatorVerificationError`
  → policy do bucket (migration 2 não aplicada, ou robô fora da organização).
- `conversation.sync_failed` repetido a cada minuto → a RPC recusa o lote;
  `aliases` chega a uma função antiga (migration 1 não aplicada) é a primeira
  suspeita.

### Rollback

`ln -sfn "$ATIVA" ~/whatsapp-mcp-hardened` e reiniciar as duas units. As
migrations são aditivas e podem ficar: o runtime antigo não manda `aliases`
nem `mediaPath`, e a RPC os trata como ausentes. O `saidas.db` ganhou duas
colunas (`anexo_caminho`, `anexo_mime`) com default — o runtime antigo as
ignora.

## 4. Portal

Branch `feat/midia-nas-conversas` do `nucleomajor`. Publicar com
`git push origin feat/midia-nas-conversas:main` (ver a memória sobre o
trabalho de terceiro no working tree — nunca `git add -A`). A Hostinger
publica no push; conferir o `operations-<hash>.js` novo em nucleomajor.com/app.

## 5. Variáveis novas (todas com padrão; só mexer se precisar)

| Variável | Padrão | Serve para |
|---|---|---|
| `EMYLEADS_MEDIA_MIRROR` | `1` | `0` desliga o espelho de arquivos (mídia volta a subir só com rótulo). |
| `WHATSAPP_OUTBOX_DIR` | `<release>/whatsapp-bridge/outbox` | O outbox que o Bridge lê, quando os dois rodam de releases diferentes. |
| `EMYLEADS_FFMPEG_BIN` | `ffmpeg` | O binário do ffmpeg. |

## 6. Validação ao vivo

1. **Juliano converge.** Depois do primeiro ciclo do runtime novo, no SQL
   Editor: `select contact_phone, owner from whatsapp_conversations where
   contact_name ilike '%juliano%';` → **uma** linha, `556593264109`. E
   `select count(*) from whatsapp_messages where contact_phone =
   '556593264109';` → as 8 de antes + as 4 do LID (menos as duas respostas da
   IA que já existiam nas duas) = 10 ou mais.
2. **Ouvir/ver.** Do celular de teste, mandar um áudio e uma foto para o
   número da empresa. Em ≤ 30 s a bolha do portal toca/mostra. No journal:
   nenhum `media.mirror_failed`.
3. **Enviar imagem** pelo portal (clipe → JPG → legenda → enviar) → chega no
   celular com a legenda; a bolha provisória some quando a mensagem volta.
4. **Gravar áudio** no portal (microfone → parar → ouvir → enviar) → chega
   como mensagem de voz no celular. A IA fica fora da conversa (equipe
   assumiu), como em qualquer envio pelo portal.
5. **Bridge:** `/api/send/human` com `media_path` fora do outbox → 403
   (conferir no journal do Bridge: `Human send requested: type=direto
   media=true`).
6. **Navegadores:** Chrome/Edge/Firefox/Android tocam Ogg/Opus e WebM/Opus.
   iOS Safari só a partir do 17.5 — limitação conhecida, não defeito.

## 7. O que foi feito em 15/09/2026 (Brasília, 19:10–20:20)

1. **Migrations aplicadas** por `supabase db query --linked -f`, cada uma
   ensaiada antes com `rollback` no lugar do `commit` (as duas passaram limpas
   no banco real). Conferido: 2 colunas, 4 policies, bucket privado de 16 MB,
   `organizacao_do_caminho`, sync com `aliases`, enqueue com `mediaPath`.
2. **Release `midia-no-portal`** criada por `cp -a` de `leads-do-site` +
   `git apply` do patch; `go vet`, `go test ./...` e a suíte Python (823 OK,
   com o venv do serviço) na própria release. O binário do Bridge foi
   compilado lá com `/usr/local/go/bin/go`.
3. **Bridge reiniciado** às 22:56 UTC: `/proc/<pid>/exe` e `cwd` na release
   nova, `Connected to WhatsApp` 3 s depois, sem QR; `/api/send/human` → 401.
4. **Assistente reiniciado**: `service.started` com `media_mirror: true` e
   `outbox_dir` na release nova. A conversa do Juliano convergiu no primeiro
   ciclo (uma linha, `556593264109`, 16 mensagens); as diretas caíram de 23
   para 17. A linha do canal `120363404701403742` foi apagada à mão do
   espelho (a sincronia já não a alimenta).
5. **Marca d'água recuada 3 dias** (`conversation_sync_state.json`, backup ao
   lado) para o espelho de arquivos alcançar a mídia dos últimos dias: 790
   pendentes, 4 por ciclo — ~50 min para drenar. O ajuste `19dea15` (mais
   novas primeiro) foi aplicado por cópia do blob e restart do assistente.
6. **Portal** publicado com `git push origin feat/midia-nas-conversas:main`.

Rollback do runtime: `ln -sfn ~/releases/whatsapp-mcp-hardened/leads-do-site
~/whatsapp-mcp-hardened` e reiniciar as duas units (o binário do Bridge de
`leads-do-site` é o de 10/09, válido).
