# ADR-0008 — Canal oficial do WhatsApp e coexistência

Estado: **aceito em 11/10/2026**, implementação em andamento (fundação no PR
deste ADR). Nada disto está no ar.

## Contexto

Hoje toda conexão fala com o WhatsApp pelo Bridge (whatsmeow, protocolo não
oficial), com risco de bloqueio e de quebra. O dono quer o canal oficial da
Meta (Cloud API) para a Major e para os clientes, mantendo o app WhatsApp
Business no celular da equipe: a **coexistência**.

Fatos que definem o desenho:

- Na coexistência, ao ligar o número à Cloud API a Meta **desvincula todos os
  aparelhos companheiros**. O Bridge é um aparelho companheiro. Bridge e API
  no mesmo número também duplicariam cada mensagem, e o ADR-0002 já proíbe
  dois runtimes num número.
- O que a equipe responde pelo app do celular chega como webhook
  `smb_message_echoes`. É o equivalente do `is_from_me` do Bridge, e é o que
  pausa a IA (regra dos 30 minutos).
- A Meta manda os eventos de **todos** os números ligados ao app para **um**
  webhook público. A VPS não tem endereço público.
- Ligar número de cliente exige o app como **Tech Provider** (verificação da
  empresa, App Review das permissões `whatsapp_business_*`, verificação de
  acesso) e o Embedded Signup. Em 11/10/2026 o portfólio Major Hub está
  restrito pela integridade do WhatsApp (site), com recurso aberto.

## Decisão

1. **Por conexão, o canal oficial substitui o Bridge.** Uma conexão é do
   Bridge **ou** da Cloud API, nunca dos dois. Quem diz é
   `public.whatsapp_cloud_numbers`: sem linha, é Bridge, como sempre foi.
2. **Webhook no servidor do portal, fila no Supabase, VPS puxa.**
   `/api/webhooks/whatsapp-cloud` confere a assinatura e entrega os eventos a
   `nucleo_whatsapp_cloud_receive`, que roteia pelo `phone_number_id` para
   `private.whatsapp_cloud_inbox`. A VPS reserva com a mesma credencial de
   robô dos comandos: um robô só enxerga a própria conexão.
3. **Na VPS, um adaptador com a mesma porta do Bridge.** O resto do runtime
   (assistente, árbitro, fluxos, espelho de conversas, portal) não aprende que
   a Cloud API existe. O adaptador fala as mesmas rotas locais (`/api/send`,
   `/api/send/human`, `/api/notify`, `/api/contacts/check`), grava o mesmo
   `messages.db` e avisa o `POST /inbound`. Por dentro, chama o Graph.
4. **O token de acesso da Meta fica no env da conexão, na VPS** (ADR-0005:
   credencial escopada por conexão). Nunca no banco, nunca no agente.
5. **Provedor plugável.** `provider` é `meta` (app próprio) ou `360dialog`
   (plano B, se o Tech Provider demorar). A fila e o adaptador são os mesmos;
   muda só quem faz a ponte com a Meta.
6. **O agente continua sem enviar** (memória "MCP da Meta fica no PC"): quem
   envia é o runner, pelas rotas do adaptador, com a mesma allowlist.

## Consequências

- O que a API tem e o Bridge não tinha passa a existir: status de entrega
  (`failed` deixa de ser silencioso) e **janela de 24 horas**. Fora dela só
  sai **template aprovado**: fluxos, avisos da agenda e lead do site precisam
  de template para iniciar conversa (`cloud_api.within_service_window`).
- Mensagem iniciada pela empresa passa a custar (tarifa da Meta por template).
- Na ligação de um número em coexistência, o histórico do app chega pelo
  webhook `history`. Fundação conta e descarta; importar é etapa própria.
- Pareamento por QR, "trocar número" e o aviso de queda do Bridge não se
  aplicam a conexão oficial; a tela Conexões mostra o estado da API.
- Mensagens de aparelhos não suportados (WhatsApp para Windows, WearOS) não
  geram webhook e não chegam ao portal (limitação da Meta).

## Alternativas rejeitadas

- **Webhook direto na VPS:** exigiria endereço público e TLS por VPS, e um
  roteamento entre VPSs por número.
- **Bridge e API juntos no mesmo número:** a Meta desvincula o Bridge, e se
  não desvinculasse cada mensagem chegaria duas vezes.
- **Reescrever o runtime para conhecer a API:** espalharia "se for oficial"
  pelos dez pontos que enviam; o adaptador concentra num lugar só.
- **Token no Supabase:** uma leitura indevida exporia o envio de todos os
  números. No env da conexão, o estrago fica numa conexão.
