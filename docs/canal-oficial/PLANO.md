# Canal oficial do WhatsApp (Cloud API) com coexistência

Decisão: [ADR-0008](../adr/ADR-0008-CANAL-OFICIAL-E-COEXISTENCIA.md).
Piloto escolhido pelo dono em 11/10/2026: **número final 5324** (conexão
`8ee1e6d0…`, Atendimento Major), em coexistência com o app do celular.

## Onde estamos (11/10/2026)

| Porta da Meta | Estado |
|---|---|
| App | **AdsMajor** (`1210997597353143`), portfólio Major Hub, com o produto WhatsApp |
| Verificação da empresa | Verificada em 07/02/2026 |
| Integridade do WhatsApp | **Restrita**: "não foi possível encontrar o site". Site corrigido (rodapé com razão social e CNPJ, `/privacidade`) e recurso aberto no Suporte Direto, caso `28798439879820232` |
| Configurações do app | Ícone 1024×1024 (o da Emy Leads) subido em 11/10/2026: o app deixou de ser "inelegível para envio". Termos de Serviço ainda apontam para `facebook.com` |
| App Review (`whatsapp_business_messaging`, `whatsapp_business_management`) | Rascunho nunca enviado. Precisa de vídeo do fluxo funcionando |
| Verificação de acesso (Tech Provider) | Não iniciada |
| Webhook | Banco pronto (migration aplicada em 11/10/2026). Falta publicar o portal, pôr as variáveis na Hostinger e cadastrar a URL na Meta |
| Embedded Signup, número | Nada configurado |

## Etapas

### 1. Fundação (este PR): pronta para revisão
- [x] ADR-0008.
- [x] Webhook `/api/webhooks/whatsapp-cloud` no servidor do portal: desafio,
      assinatura, separação em `message`/`echo`/`status` (`src/whatsappCloud.mjs`).
- [x] Migration `20261014100000`: `whatsapp_cloud_numbers`, fila
      `private.whatsapp_cloud_inbox`, receber/reservar/concluir.
- [x] Runtime: cliente do Graph (`whatsapp-assistant/cloud_graph.py`, commit `b753f2b` na branch
      `feat/canal-oficial` do `whatsapp-mcp-hardened`).
- [x] Ensaio da migration no SQL Editor com `raise exception` no fim, depois
      aplicação (só com o dono de acordo). Aplicada em 11/10/2026; ver
      `STATUS.md`, "Banco aplicado". O primeiro ensaio pegou `anon` com
      `EXECUTE` em reservar/concluir; corrigido antes de aplicar.
- [ ] Publicar o portal (merge do PR #58) e pôr `WHATSAPP_CLOUD_VERIFY_TOKEN`
      e `WHATSAPP_CLOUD_INTAKE_TOKEN` na Hostinger.
- [ ] Cadastrar `https://nucleomajor.com/api/webhooks/whatsapp-cloud` na Meta
      (AdsMajor → WhatsApp → Configuração) e assinar `messages` e
      `smb_message_echoes`.

### 2. Adaptador na VPS (próximo)
- [ ] Processo `whatsapp-cloud@<conexão>` com as rotas do Bridge
      (`/api/send` com a mesma allowlist e as duas fases, `/api/send/human`,
      `/api/notify`, `/api/contacts/check`), por cima de `cloud_graph.py`.
- [ ] Puxar a fila, gravar `messages.db` (mesmo esquema do Bridge) e avisar o
      `POST /inbound` (formato pronto em `cloud_api.InboundMessage.notice`).
- [ ] Eco do app (`echo`) gravado como `is_from_me = 1`, para a pausa da IA.
- [ ] Mídia: baixar pelo `media_id` para o mesmo diretório que o Bridge usa.
- [ ] Janela de 24h: fora dela, recusar texto livre com motivo próprio
      (`outside_service_window`) em vez de deixar a Meta recusar.

### 3. Ligar um número (Embedded Signup)
- [ ] Configuração de login do Embedded Signup no app (tipo "WhatsApp
      Embedded Signup", com coexistência).
- [ ] Botão "Conectar com a Meta" no cartão "API Oficial" da tela Conexões
      (SDK JS do Facebook, `featureType: whatsapp_business_app_onboarding`).
- [ ] Rota do servidor que troca o código pelo token, registra o número,
      inscreve o app na WABA e grava `whatsapp_cloud_numbers`. O token vai para
      o env da conexão na VPS (comando de runtime próprio), nunca para o banco.
- [ ] Desligar o Bridge da conexão no mesmo ato (a Meta já o desvincula).

### 4. Templates
- [ ] Criar e aprovar os templates de que o produto precisa para iniciar
      conversa: boas-vindas do lead, lembrete da agenda, retomada de fluxo.
- [ ] Fluxos e avisos escolhem template quando a janela fechou.

### 5. Produção
- [ ] Recurso da integridade aceito pela Meta.
- [ ] Vídeo do fluxo + App Review + verificação de acesso (Tech Provider).
- [ ] Piloto no 5324: 48 h de observação.
- [ ] Liberar para clientes por plano.

**Plano B**, se a Meta demorar: os clientes entram por um parceiro oficial
(`provider = '360dialog'`). A conta WhatsApp fica no portfólio do cliente, e
a restrição da Major não os atinge. O 5324 continua dependendo do recurso.

## Custos (levantados em 11/10/2026)

Os números variam entre as fontes. Confirme na tabela oficial da Meta (em BRL)
e com o comercial do parceiro antes de fechar preço com cliente.

### Tarifa da Meta (paga em qualquer caminho)
- Cobrança **por mensagem de template entregue** desde 01/07/2025.
- **Grátis:** respostas dentro da janela de 24 h, template de utilidade dentro
  da janela e tudo nas 72 h após clique em anúncio para WhatsApp. Na
  coexistência, o que a equipe manda **pelo app do celular** é grátis.
- **Brasil, por template:** marketing ≈ US$ 0,0625 (≈ R$ 0,32–0,39);
  utilidade e autenticação ≈ US$ 0,007–0,008 (há fonte com valor maior para
  autenticação).
- Moeda: WABA nova do Brasil pode ser em **BRL** desde 01/07/2026. As antigas
  precisam migrar até 30/06/2027.

### Plataforma
| Caminho | Mensalidade | Por mensagem | Observação |
|---|---|---|---|
| **App próprio (Tech Provider)** | R$ 0 | só a Meta | Depende do recurso e do App Review |
| 360dialog, por número | €49 (Regular) / €99 (Premium) | sem margem | Coexistência pelo fluxo "COEX"; Brasil não confirmado na documentação |
| 360dialog Partner (ISV) | €250 + €49/canal (5 incl.) · €500 + €25/canal (10 incl.) · €1.000 + €15/canal (20 incl.) | sem margem | Para revender aos clientes |
| Twilio | sem mensalidade | + US$ 0,005 | Fonte de terceiros |
| Gupshup | US$ 10–80 | + US$ 0,001–0,004 | Fonte de terceiros |

Exemplo, 10 clientes com um número cada: pelo app próprio, R$ 0 de
plataforma; pela 360dialog Partner Growth, cerca de €500 por mês; pela
360dialog por número, 10 × €49 = €490 por mês. A tarifa da Meta soma-se igual
nos três.

Fontes: [Meta, preços da plataforma](https://developers.facebook.com/docs/whatsapp/pricing/),
[360dialog, preços](https://360dialog.com/pricing),
[360dialog, coexistência](https://docs.360dialog.com/partner/waba-management/whatsapp-coexistence),
[Hyperleap, calculadora Brasil](https://hyperleap.ai/whatsapp-pricing-calculator-brazil),
[Landbot, Twilio](https://landbot.io/blog/twilio-whatsapp-pricing),
[The Chat Quotient, comparação de BSPs](https://www.thechatquotient.com/en/blog/whatsapp-bsp-comparison/).
