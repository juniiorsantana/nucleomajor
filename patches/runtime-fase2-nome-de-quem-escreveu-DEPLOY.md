# Deploy — Fase 2 da correção do atendimento (13/09/2026)

> **Estado em 13/09/2026 18:30 (Brasília):**
> - **Migration APLICADA** pelo dono no SQL Editor ("sucesso"). É a única peça
>   da Fase 2 que já está em produção, e ela sozinha não muda nada do que se vê:
>   o runtime que está no ar não manda autoria, e o portal no ar não lê as
>   colunas novas.
> - **Runtime: não implantado.** `feat/fase2-nome-de-quem-escreveu` @ `36fc0af`,
>   761 testes OK na máquina de desenvolvimento (eram 728).
> - **Portal: não publicado.** Mesmo nome de branch no `nucleomajor`, @ `b2c918f`
>   (app 642, servidor 253).
> - **Validação ao vivo pendente — e a da Fase 1 também.** O agente de clientes
>   segue desligado desde 13/09 09:13. As duas fases precisam da mesma sessão de
>   teste no aparelho.

Diagnóstico e decisões: `docs/atendimento/PLANO-CORRECAO-ATENDIMENTO.md`.

## O que muda para quem usa

| Quem | O que passa a ver |
|---|---|
| O contato, no WhatsApp | `*Assistente Major:*` na primeira linha do que a IA manda, e o nome do atendente no que sai do portal. **Nada** no que for digitado do celular. |
| A equipe, no portal | O nome de quem escreveu em cima de cada bolha. Mensagem sem autoria fica sem nome. |
| A equipe, no WhatsApp | Nada. Aviso de transferência, lembrete de agenda e turno do assistente interno continuam sem assinatura. |

**O nome que vai assinar é o `display_name` do agente na tela de Agents.** Hoje
é "Assistente Major". Se for para ser outro, renomeie o agente ANTES de subir o
runtime — a assinatura vale para as próximas mensagens e o histórico não é
reescrito.

## Ordem

As três peças são independentes e nenhuma quebra as outras pela metade:

1. **Migration** — já aplicada. Sozinha: nada muda.
2. **Runtime** — a partir daqui o contato lê a assinatura e a autoria começa a
   subir. Com o portal antigo, a equipe ainda não vê o nome na bolha (e vê a
   assinatura dentro do texto da mensagem, que é o que de fato saiu).
3. **Portal** — a bolha passa a mostrar o nome.

Subir o portal antes do runtime também funciona: as colunas vêm vazias e a
bolha sai sem nome, como hoje.

---

## A. Runtime

### Base esperada

Release ativa `fase1-atendimento` = `fix/fase1-atendimento` @ `860f7ac`.

```bash
cd /home/nucleo/releases/whatsapp-mcp-hardened/fase1-atendimento/whatsapp-assistant
sha256sum conversation_sync.py main.py messages.py presenca_humana.py runtime_commands.py send.py worker.py
```

Compare com os hashes do mesmo commit na máquina de desenvolvimento antes de
aplicar. Se divergirem, **pare**: a VPS já divergiu do git uma vez.

Patch: `runtime-fase2-nome-de-quem-escreveu.patch`, sha256
`fd4258d1e8a7fb55ebb28370ca94d6b7b816cbc0dc3df4239bbf8e0e14bb6244`.
12 arquivos, 952 inserções.

### 1. Construir a release nova

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/fase2-autoria
cp -a /home/nucleo/releases/whatsapp-mcp-hardened/fase1-atendimento "$NOVA"
cd "$NOVA"
sha256sum /tmp/runtime-fase2-nome-de-quem-escreveu.patch
git apply --check -p1 /tmp/runtime-fase2-nome-de-quem-escreveu.patch
git apply        -p1 /tmp/runtime-fase2-nome-de-quem-escreveu.patch
```

### 2. Testar na VPS, com o Python do serviço

```bash
cd "$NOVA/whatsapp-assistant"
~/.venvs/whatsapp-assistant/bin/python -B -m unittest discover -s . -p 'test_*.py'
```

Esperado: `Ran 761 tests`, `OK`.

### 3. Backup do estado

O livro de saídas ganha três colunas na primeira abertura (`ALTER TABLE`, feito
pelo próprio código). O backup é o caminho de volta.

```bash
DEST=~/.local/state/nucleo-major/deploy-backups/fase2-autoria-$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"
ST=~/.local/state/whatsapp-assistant/8ee1e6d0-a9d0-4041-b6ea-878716a34a71
sqlite3 "$ST/saidas.db"  ".backup '$DEST/saidas.db'"
sqlite3 "$ST/arbitro.db" ".backup '$DEST/arbitro.db'"
```

### 4. Trocar e reiniciar (só o assistente; o Bridge não)

```bash
ln -sfn "$NOVA" /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
systemctl --user is-active 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
readlink -f /proc/$(systemctl --user show -p MainPID --value 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service')/cwd
```

O `cwd` tem de apontar para a release nova. Nenhuma variável de env muda.

### 5. Conferir que o livro migrou

```bash
sqlite3 ~/.local/state/whatsapp-assistant/8ee1e6d0-a9d0-4041-b6ea-878716a34a71/saidas.db \
  "PRAGMA table_info(saida_do_agente);"
```

Tem de listar `tipo`, `autor_nome` e `autor_id`. As linhas que já existiam ficam
com `tipo = 'ia'`, e é o certo: foram gravadas pelo único caminho que anotava
até aqui, o envio automático. Marcá-las de outra coisa faria o agente parar de
reconhecer as próprias respostas das últimas 48 h e se calar sozinho.

### Rollback

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/fase1-atendimento /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
```

As três colunas ficam no `saidas.db` e o código antigo as ignora (ele faz
`INSERT` nomeando colunas, e as novas têm default). A autoria que já subiu ao
Supabase permanece, e as bolhas que ganharam nome continuam com ele.

---

## B. Portal

`feat/fase2-nome-de-quem-escreveu` @ `b2c918f` no `nucleomajor`.

**Atenção antes de publicar:** essa branch nasceu de `melhoria/conversas-inbox`,
que está **8 commits à frente de `origin/main`** com trabalho de outro assunto
(faxina do gatilho de realtime, etiquetas nas conversas, QR). Levá-la para
`main` publica tudo isso junto — e o push para `main` implanta na Hostinger
sozinho. Se a Fase 2 tiver de ir sozinha, o caminho é `cherry-pick` do `b2c918f`
sobre uma branch criada a partir de `origin/main`; o único arquivo em que o
`conversasProvider.js` daquela branch e o de `main` divergem é ele mesmo, então
o conflito, se houver, é pequeno e legível.

Essa decisão é do dono.

---

## C. Validar em produção

Com o agente de clientes religado no portal. Do celular de teste, como contato:

1. **A assinatura.** Mande uma pergunta → a resposta chega com o nome do agente
   na primeira linha.
2. **A bolha.** No portal, a mesma mensagem aparece com o nome em cima dela.
3. **O celular não ganha nome.** Responda essa conversa pelo WhatsApp do celular
   da empresa → no portal a bolha aparece **sem** nome. É o comportamento certo:
   o aparelho envia direto, sem passar pelo runtime.
4. **O portal assina com o nome de quem clicou.** Responda pelo portal → a
   mensagem chega ao contato assinada com o seu nome curto de Minha Conta, e a
   bolha mostra o mesmo nome.
5. **O freio da Fase 1 continua de pé.** Depois do item 3 ou 4, mande outra
   mensagem do celular de teste → a IA **não** responde, e o journal registra
   `conversation.team_took_over`. Este é o item que mais importa: anotar o envio
   do portal foi exatamente o que o runtime se proibia de fazer até ontem.
6. **O modelo não imita.** Depois de três ou quatro trocas, confira que a
   assinatura aparece uma vez só por mensagem e sempre na primeira linha —
   nunca no meio do texto.

Os quatro itens da validação da Fase 1 (`runtime-fase1-atendimento-lembrete-de-espera-DEPLOY.md`,
seção 5) continuam pendentes e podem ser feitos na mesma sessão.

## O que não é regressão

- **A mensagem no portal mostra a assinatura dentro do texto, além do nome em
  cima da bolha.** Foi decisão do dono: a bolha mostra exatamente o que o
  contato recebeu.
- **Conversas antigas ficam sem nome**, inclusive as que a IA mandou antes do
  deploy. O histórico não é reescrito; a autoria vale para as próximas.
