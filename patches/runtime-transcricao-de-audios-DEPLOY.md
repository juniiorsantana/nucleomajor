# Deploy: transcrição dos áudios no runtime

> **Estado em 02/10/2026, ao fechar o roteiro:** nada aplicado.
> - Base: a release ativa **`ajustes-v1`** (conferida por `readlink` em
>   02/10/2026 22:19). Os 9 arquivos que o patch altera batem por sha256 com
>   a cópia baixada da VPS nesse dia.
> - Patch `runtime-transcricao-de-audios.patch`: 11 arquivos (2 novos), 973
>   linhas a mais e 21 a menos, sha256
>   `87088a181b799fb5da5e0d5ab571c57ed1a2fd2c06e87dfbfbd3c68ec4842f0d`.
> - Base + patch, nesta máquina: **1052 testes OK** (29 novos). Os 18 de
>   `test_media_mirror` e `test_conversation_sync` que quebram pela data fixa
>   (issue #21) passam com a janela inicial ampliada só no teste.
> - Depende da migration `20261007100000_transcricao_dos_audios.sql`. Sem ela,
>   a transcrição acontece mas a gravação falha (`audio.transcript_record_failed`)
>   e o texto fica só no cache local.

## O que muda

- **Transcritor (`transcritor.py`):** uma thread com fila própria (até 500).
  O `media_mirror` já baixa cada áudio para subir ao bucket; com o transcritor
  ligado, o áudio de **conversa direta** vai para ele em vez de ser apagado.
  Ele transcreve com o faster-whisper `small`, grava o texto no `content` da
  mensagem (`nucleo_message_transcript_record`) e apaga o arquivo. Grupo não.
- **Na análise:** antes do Jev e do Claude, o analista pergunta ao banco quais
  áudios da carga ainda estão sem texto (`nucleo_message_transcript_pending`),
  baixa do bucket (ou pelo Bridge, se o arquivo não subiu), transcreve, grava
  e segue. Prazo de 7 minutos; o que não couber vai como `[áudio]`. É assim
  que os áudios **antigos** são transcritos: só quando alguém pede a análise
  daquela conversa (decisão do dono, 02/10/2026).
- **Cache local** `transcricoes.db`, ao lado do `messages.db` de cada conexão:
  o atendente guarda o que transcreve para responder, e o transcritor só grava;
  nada é transcrito duas vezes.
- **Um áudio por vez na VPS inteira** (`flock` em
  `~/.local/state/nucleo-major/whisper.lock`): as duas conexões e o atendente
  não disputam os 2 processadores.
- **Textos do Jev e do Claude:** passam a dizer que o texto depois de
  `[áudio]` é a transcrição automática.
- Log: `audio.transcribed` (com `source="transcritor"`), `audio.transcript_failed`,
  `audio.transcript_record_failed`, `analysis.transcribed`. Só id, tamanho e
  tempo: o texto não vai para log.

Variáveis (nas **duas** conexões):

| Variável | Valor |
|---|---|
| `NUCLEO_TRANSCRIBE` | `1` liga o transcritor; ausente ou `0`, nada muda |
| `NUCLEO_TRANSCRIBE_MODEL` | opcional, padrão `small` |
| `ASSISTANT_WHISPER_MODEL` | `small` — o unit manda `medium` para o atendente; com o transcritor no mesmo processo, dois modelos carregados é memória à toa, e o `medium` leva 68 s para carregar |

Medição na VPS (02/10/2026, 5 áudios, 77 s): `small` transcreve 1 min de áudio
em ~23 s; 8% de palavras diferentes do `medium`. Volume da Adriani: ~340
áudios diretos por mês, cerca de 1 h de processador no mês.

O Bridge não muda.

## 0. Migration (o dono, pelo SQL Editor)

`supabase/migrations/20261007100000_transcricao_dos_audios.sql`, com ensaio
(`raise exception` no fim) antes. Prova PGlite: 34/34, com rollback
(`scripts/sql/rollback-20261007100000-transcricao-dos-audios.sql`).

Conferência:

```sql
select
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'whatsapp_messages' and column_name = 'transcribed_at') as coluna,
  to_regprocedure('public.nucleo_message_transcript_record(jsonb)') is not null as grava,
  to_regprocedure('public.nucleo_message_transcript_pending(jsonb)') is not null as pergunta,
  has_function_privilege('anon', 'public.nucleo_message_transcript_record(jsonb)', 'execute') as anon_grava;
-- esperado: timestamp with time zone | true | true | false
```

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../ajustes-v1
cd "$ATIVA"
sha256sum whatsapp-assistant/{analista,config,coordenador,main,media_mirror,messages,operator_verification,test_media_mirror,transcribe}.py
sha256sum /tmp/runtime-transcricao-de-audios.patch
```

```
6aad36a82c17dc2dd24c3cc8dcdad46e43e47aaae647f54c50b2ef0ad85c80d6  whatsapp-assistant/analista.py
693e599cae91aa36374c5de061ce11657c7016e62c9288372481fa831aed0ca7  whatsapp-assistant/config.py
b19b3a79502ea5c869a5e0eccb3b4566ef0c44b6351221a0a791272ebab211b4  whatsapp-assistant/coordenador.py
6030911c8892445928ad07456ec64bc18f2854835ac53da1ea31db1c3c5097e3  whatsapp-assistant/main.py
d34ec7840386e9924fc5e87a51fd53dd213b38dfcceea886e33135d212db97bc  whatsapp-assistant/media_mirror.py
1e3d6f715eee54390b74e3ff4fda5e564073f63c08241a0fea1d44d934d08a4c  whatsapp-assistant/messages.py
3986417dffcd0ff94821740ad4247a9744c0da835266ac14c5768c2e1fdfd6e1  whatsapp-assistant/operator_verification.py
fe233cfb36b3eabebcb15a08b1e644e95be7d14bd65d893a29aa5afc78660463  whatsapp-assistant/test_media_mirror.py
a5e244062cfa7908830359780e78026d6d08747fd6ff4fe558f30d622b7e4bed  whatsapp-assistant/transcribe.py
87088a181b799fb5da5e0d5ab571c57ed1a2fd2c06e87dfbfbd3c68ec4842f0d  /tmp/runtime-transcricao-de-audios.patch
```

## 2. Release nova, testes, ambiente, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/transcricao-de-audios
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-transcricao-de-audios.patch
git apply        -p1 /tmp/runtime-transcricao-de-audios.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest \
  test_transcritor test_analista test_coordenador test_messages test_operator_verification test_config 2>&1 | tail -3

for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  ENV=~/.config/whatsapp-assistant/$U.env
  cp -a "$ENV" "$ENV.antes-transcricao"
  grep -q '^NUCLEO_TRANSCRIBE=' "$ENV" || echo 'NUCLEO_TRANSCRIBE=1' >> "$ENV"
  grep -q '^ASSISTANT_WHISPER_MODEL=' "$ENV" \
    && sed -i 's/^ASSISTANT_WHISPER_MODEL=.*/ASSISTANT_WHISPER_MODEL=small/' "$ENV" \
    || echo 'ASSISTANT_WHISPER_MODEL=small' >> "$ENV"
done

ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
  sleep 5
  systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$U
done
```

## 3. Conferir

```bash
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  journalctl --user -u whatsapp-assistant@$U --since "10 min ago" -o cat \
    | grep -E '"event": "(service.started|audio\.|analysis.transcribed)' | tail -5
done
# service.started deve mostrar "transcription": "small"
```

Mandar um áudio para uma conversa direta e, uns 30 s depois:

```sql
select message_id, media_type, length(content) as tamanho, transcribed_at
from public.whatsapp_messages
where transcribed_at is not null
order by transcribed_at desc limit 5;
```

E pedir uma análise de uma conversa com áudios antigos: o journal mostra
`analysis.transcribed` com `pending`, `transcribed` e `recorded`.

## 4. Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/ajustes-v1 ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  cp ~/.config/whatsapp-assistant/$U.env.antes-transcricao ~/.config/whatsapp-assistant/$U.env
  systemctl --user restart whatsapp-assistant@$U
done
```

O texto já gravado fica nas mensagens (inofensivo: a análise só lê melhor).
Para apagar também, o rollback da migration limpa o `content` transcrito.

## 5. Registro do que já rodou

- 02/10/2026: base baixada da VPS (`ajustes-v1`), patch e testes nesta máquina.
  Nada aplicado na VPS nem no banco.
