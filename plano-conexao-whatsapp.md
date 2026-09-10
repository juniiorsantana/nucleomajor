# Plano — a conexão do WhatsApp se explica e se resolve sozinha

Última atualização: **09/09/2026**
Estado geral: **escrito; nada implementado**
Origem: a queda de 08/09/2026 22:47:54, que ninguém soube por 23 horas.

Use `[ ]` para não iniciado, `[-]` para em andamento, `[x]` para concluído e
verificado e `[!]` para bloqueado.

## O incidente que produziu este plano

O WhatsApp foi desconectado em 08/09/2026 22:47:54 (`Got 403: primary device
was logged out (...) deleting session`). O `messages.db` congelou às 22:43:27.
O serviço seguiu `active`, `NRestarts=0`, e o bridge não escreveu **mais uma
linha sequer** nas 23 horas seguintes. Ninguém foi avisado.

A tela de Conexões, com o número morto, mostrava: Assistente **verde**, Modelo
de IA **verde**, Número verificado **verde**, Sinal da VPS **verde**, MCP
**verde**, Agenda **verde**, Chatbots **verde** — e "WhatsApp: Sessão
encerrada" em **cinza**, na terceira linha de catorze.

## Por que a tela ficou verde — as três causas, no código

1. **O cinza é literal.** `Conexoes.jsx:399` pinta a linha do WhatsApp com
   `tom={conectado ? "sucesso" : divergente || estado.status === "error" ?
   "erro" : "neutro"}`. `logged_out` não é `error`, então cai em `neutro`:
   a sessão encerrada tem o mesmo peso visual de "Host".
2. **"Última atividade" mede a coisa errada.** `Conexoes.jsx:427` mostra
   `estado.updatedAt`, que é o `updated_at` da linha da conexão — batido pelo
   heartbeat a cada ciclo. Por isso dizia `09/09/2026, 23:33:28` enquanto a
   última mensagem real era de `08/09 22:43:27`. Não existe, hoje, nenhum campo
   que carregue a última mensagem de verdade.
3. **O QR promete o que não pode entregar.** `Conexoes.jsx:511` esconde
   "Conectar número" quando `conexao.remoteManaged` — e esconde por um bom
   motivo: `gatewayProvider.js:21` aponta as chamadas de pareamento para
   `http://127.0.0.1:8090`, que na web é o **PC de quem está olhando**, não a
   VPS. Mas o painel do QR (linha 549) continua sendo renderizado, com
   "O QR aparecerá aqui". Ele nunca vai aparecer ali.

O dado certo **já chega** ao portal (`whatsapp_status = logged_out` vem no
heartbeat — é dele que sai o rótulo "Sessão encerrada"). O problema não é
telemetria: é interpretação.

## FASE A — a verdade aparece (só portal; sem migration, sem deploy de VPS)

- [ ] **A.1 Tom honesto:** `logged_out`, `whatsapp_disconnected` e `qr_expired`
  passam a `erro`; `reconnecting`/`connecting` a `atenção`.
- [ ] **A.2 O cartão muda de assunto quando a sessão cai:** um bloco no topo,
  vermelho, com "WhatsApp desconectado desde <data e hora>" e o que fazer. As
  linhas de infraestrutura (Assistente, Modelo, MCP, Agenda, Chatbots) recolhem
  para "Detalhes técnicos", fechado por padrão. **Nenhum selo verde ao lado de
  um número que não recebe mensagem.**
- [ ] **A.3 "Última atividade" para de mentir:** enquanto não existir o dado
  real (D.1), a linha some com a sessão encerrada e o que sobra é "Sinal da
  VPS", que já diz a verdade sobre o que mede.
- [ ] **A.4 "Número verificado" deixa de ser verde sem sessão:** vira
  `•••• 8362 · última sessão`, em tom neutro.
- [ ] **A.5 O painel do QR para de prometer:** sem caminho remoto, ele diz o
  que é preciso fazer em vez de "O QR aparecerá aqui".
- [ ] **A.6 Testes:** um por regra de tom, e um que prova que um estado
  desconectado não renderiza **nenhum** selo de sucesso no cartão.

## FASE B — Conversas para de fingir que está viva (só portal)

- [ ] **B.1** Conversas passa a ler a saúde da conexão — a mesma
  `connection_runtime_status` que Conexões já lê. Hoje a tela não sabe sequer
  que existe conexão.
- [ ] **B.2 Faixa no topo, com data:** "WhatsApp desconectado desde 08/09
  22:47. Nada novo está chegando." com o botão que leva a Conexões (e, depois
  da FASE C, resolve ali mesmo).
- [ ] **B.3 A caixa de escrever fecha, com o motivo escrito.** Hoje a mensagem
  entra na fila e morre em silêncio — o pior desfecho possível.
- [ ] **B.4 O histórico continua legível, mas datado** ("última sincronia há
  X"). Recomendação: **não** apagar a lista. Sumir com tudo parece produto
  quebrado; o que faz mal é apresentar o velho como se fosse novo.
- [ ] **B.5 Nova conversa** fica indisponível com o motivo, em vez de falhar
  dentro do modal na verificação de número.

## FASE C — o botão volta a existir para conexões da VPS

Três repositórios, e a ordem é a de sempre: **migration → runtime → portal**.

- [ ] **C.1** Comando `connection_pair` na fila que já existe
  (`connection_runtime_commands`), no molde exato do `conversation_check`:
  o portal enfileira, o runtime reivindica, o resultado volta em
  `public_result`. O precedente está pronto, provado e em produção.
- [ ] **C.2** Ao reivindicar, o runtime chama o bridge local
  (`POST /api/internal/v1/pairing/start`, depois
  `GET /api/internal/v1/pairing/qr`) e devolve o `imageData`.
- [ ] **C.3** O portal desenha o QR e repete a busca enquanto o código gira
  (~20s por código, ~2min de janela), com orçamento próprio — o mesmo laço de
  acompanhamento do check de número, pela mesma razão: gente parada na frente
  de um modal não espera dez minutos.
- [ ] **C.4 Segurança, e esta parte não é opcional.** O QR **é uma
  credencial**: quem o escaneia vincula um aparelho à conta. Portanto —
  só dono/admin enfileira (guarda na RPC, não só na tela); TTL curto e uso
  único; apagado no sucesso ou no vencimento; nunca em log; teto por hora, como
  o de conversas iniciadas; e registro de quem pediu.
- [ ] **C.5 "Reconectar" é outro botão.** Sessão viva que só caiu usa a rota
  `/reconnect`, que já existe, e não precisa de celular. A tela tem que separar
  "caiu" de "encerrou" — só a segunda exige alguém com o aparelho na mão.

## FASE D — a queda avisa sozinha (runtime + portal)

- [ ] **D.1 `last_inbound_at` no heartbeat:** o `max(timestamp)` do
  `messages.db`, que o runtime já abre. É o **único** sinal que separa
  "conectado" de "processo de pé com sessão morta" — foi ele que provou esta
  queda, e é o que falta para A.3 dizer a verdade.
- [ ] **D.2 Vigia no runtime:** sem conexão e sem pareamento em curso por mais
  de N minutos, tenta `/reconnect`; se não houver sessão, marca `logged_out`,
  para de tentar e deixa o motivo explícito.
- [ ] **D.3 Alarme fora do portal.** Ninguém soube por 23 horas porque o aviso
  só existia numa tela que ninguém tinha aberta. Menor caminho: a fila de
  avisos que já existe, ou e-mail ao dono (o portal já envia convite).
- [ ] **D.4 Evento de sucesso na sincronia** (`conversation.synced`). Hoje só
  existe `sync_failed`: "sem erro" e "travado" produzem o mesmo journal vazio.

## O que este plano NÃO resolve

1. **A sincronia travada desde 08/09 16:55:48** (`control_plane_unavailable`,
   ~59 falhas por hora). Mesmo com o QR lido, o espelho do portal continua
   parado até essa falha ser respondida — o diagnóstico é
   `DIAGNOSTICO-SINCRONIA-CONVERSAS.sql`, e ele ainda não foi rodado.
2. **A reconexão de hoje.** Enquanto a FASE C não existir, parear esta conexão
   só é possível a partir da VPS, por quem tem acesso SSH e o celular do
   número esperado (`•••• 8362`).

## Ordem sugerida

A e B primeiro: são só portal, publicam sozinhas e derrubam a mentira da tela
ainda esta semana. C em seguida, porque é ela que tira o SSH do caminho. D por
último, porque é a que evita o **próximo** incidente, não este.

## Registro de andamento

| Data | Responsável | Item | Estado | Evidência / observação |
|---|---|---|---|---|
| 09/09/2026 | Claude | — | plano escrito | Diagnóstico por leitura direta da VPS e do código do portal; nada implementado. |

> A FASE C tem plano de execucao proprio, detalhado, em `plano-qr-no-portal.md`.
