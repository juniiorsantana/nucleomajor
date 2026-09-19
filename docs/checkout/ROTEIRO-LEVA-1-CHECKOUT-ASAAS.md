# Leva 1: o pagamento no Asaas libera a empresa

Este roteiro leva a Leva 1 até um ensaio completo no **sandbox** do Asaas. O
link de produção só é ligado depois que as Levas 2 e 3 estiverem aplicadas,
porque sem a Leva 3 o cliente ainda não consegue conectar o WhatsApp.

## O que muda

- **Webhook novo** `POST /api/billing/asaas` no servidor do portal. Ele:
  1. confere o cabeçalho `asaas-access-token`;
  2. busca o e-mail de quem pagou na API do Asaas;
  3. repassa o evento à RPC `nucleo_billing_asaas_receive`.
- **Ativação por e-mail.** No primeiro pagamento confirmado, o banco emite o
  código e o servidor manda o e-mail com o link `/app/ativar`. A pessoa cria
  a conta, confirma o e-mail e ativa a empresa já no plano Base.
- **Estados de assinatura:**
  - atraso: aviso por 7 dias, depois suspensão;
  - estorno ou contestação: suspensão;
  - cancelamento: o acesso vale até o fim do período pago.
- **Painel da plataforma** (Configurações): lista as vendas e oferece
  "Reenviar ativação" e "Revogar".
- **Empresas que já existem.** A Major continua no plano `full`, ativa. A
  migration recusa aplicar se alguma empresa existente fosse ficar bloqueada.

**Pode publicar o portal antes da migration.** Sem a migration, o portal trata
a assinatura como "ok" e o webhook responde 503, porque não está configurado.

## Provas feitas antes de aplicar

- `scripts/sql/prova-checkout-asaas.mjs`: **74 verificações, PASS**. A prova
  reaplica o harness e **todas** as migrations reais num Postgres 18
  descartável (PGlite 0.5.8), com os gatilhos de verdade. Para rodar, siga o
  cabeçalho do arquivo.
- `npm test`: 263 testes do servidor e 61 arquivos do app, todos verdes.
  Inclui `test/billing.test.mjs` e
  `apps/emyleads/src/page/AuthGate.interactive.test.jsx`.

## Passo a passo

### 1. Asaas (sandbox)

1. Crie a conta em `sandbox.asaas.com` e gere a chave de API em
   Integrações → Chaves de API.
2. Crie o **Link de Pagamento**:
   - cobrança **recorrente**, ciclo **mensal**, com o valor do plano Base;
   - formas de pagamento: Pix, boleto e cartão;
   - opcional: o redirecionamento depois do pagamento pode apontar para
     `https://nucleomajor.com/app`. **Não** use esse retorno para liberar
     nada; quem libera é o webhook.
3. Anote o endereço do link, que termina em um número:
   `https://sandbox.asaas.com/c/<ID>`.
4. Em Integrações → Webhooks, crie um webhook com:
   - **URL:** `https://nucleomajor.com/api/billing/asaas`;
   - **Token de autenticação:** gere um valor longo e aleatório e guarde-o,
     porque ele vai para `ASAAS_WEBHOOK_TOKEN`;
   - **Tipo de envio:** sequencial;
   - **Eventos:**
     - `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
       `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`;
     - `SUBSCRIPTION_INACTIVATED`, `SUBSCRIPTION_DELETED`.

### 2. Supabase (SQL Editor): uma coisa de cada vez

Abra cada **arquivo** e copie o conteúdo inteiro. Não cole a partir do chat.

1. Aplique `supabase/migrations/20260920100000_o_pagamento_libera_a_empresa.sql`.
   A execução precisa terminar sem erro. Se uma guarda recusar, pare e me
   mande a mensagem.
2. Rode o **BLOCO 1** de `scripts/sql/ligar-checkout-asaas.sql`.
   - O resultado mostra `billing_intake_token`. Copie esse valor: ele vai para
     `BILLING_INTAKE_TOKEN` e **não aparece de novo**.
3. Rode o **BLOCO 2** trocando `COLE_AQUI_O_ID_DO_LINK` pelo `<ID>` do link do
   passo 1.3.
4. Rode `scripts/sql/conferir-checkout-asaas.sql`. Tudo precisa voltar
   `ok = true`.

### 3. Hostinger (variáveis de ambiente)

```text
ASAAS_WEBHOOK_TOKEN=<o token do passo 1.4>
ASAAS_API_KEY=<a chave de API do sandbox>
ASAAS_API_URL=https://api-sandbox.asaas.com/v3
BILLING_INTAKE_TOKEN=<o valor do BLOCO 1>
PUBLIC_CHECKOUT_URL=https://sandbox.asaas.com/c/<ID>
OPS_NOTIFY_EMAILS=<e-mail(s) que recebem o aviso de venda>
```

O SMTP usado pelos convites (`SMTP_*`) também envia a ativação, então precisa
estar configurado.

### 4. Supabase Auth

- **Confirm email** precisa estar **ligado**, com SMTP próprio configurado. É
  a pendência antiga do `supabase/README.md`. A empresa só é criada por
  conta com e-mail confirmado.
- Em URL Configuration, **Redirect URLs** precisa conter
  `https://nucleomajor.com/app/**`.

### 5. Publicar

Faça o merge da branch `feat/checkout-asaas` na `main`. A Hostinger publica
sozinha.

### 6. Ensaio no sandbox

1. Abra o link do sandbox e pague com um e-mail seu que **não** tenha conta no
   Núcleo. No sandbox, o Pix pode ser confirmado pelo painel.
2. Confira:
   - chega o e-mail "Seu acesso ao Núcleo Major está liberado";
   - chega também o aviso de venda em `OPS_NOTIFY_EMAILS`.
3. Clique em "Ativar minha empresa". A tela abre em "Crie sua conta" com o
   e-mail preenchido.
4. Crie a conta, confirme o e-mail e volte pelo link da confirmação. O código
   já estará preenchido: dê o nome da empresa e ative.
5. Confira o painel:
   - funil, tags e agenda estão no lugar;
   - **não** aparecem Inteligência nem Chatbots (plano Base).
6. No painel da plataforma (Configurações, com a conta
   `cmo@majorhub.com.br`), a venda aparece como "Ativada".
7. Teste um atraso: crie outra cobrança da mesma assinatura no sandbox e deixe
   vencer, ou marque como vencida. Deve aparecer a faixa "Pagamento em
   atraso".

### Depois do ensaio

Registre em `docs/STATUS.md` o que foi aplicado e conferido. Os eventos que
chegaram podem ser vistos, sem dado pessoal, pela consulta comentada no fim de
`conferir-checkout-asaas.sql`.

## Se algo der errado

- **O e-mail de ativação não chegou.** Use "Reenviar ativação" no painel da
  plataforma. Isso emite um código novo e revoga o anterior.
- **A venda não aparece no painel.** Rode a consulta de eventos do
  `conferir-checkout-asaas.sql`. Se ela mostrar `unmapped_link`, o ID do BLOCO
  2 está errado.
  1. Corrija o BLOCO 2. As próximas vendas passam a entrar sozinhas.
  2. Registre a venda que ficou para trás. O `sub_...` sai da coluna
     `external_subscription_id` da consulta de eventos:

     ```sql
     insert into public.billing_subscriptions
       (provider, external_subscription_id, email, plan_code, status, current_period_ends_at)
     values
       ('asaas', '<sub_...>', '<e-mail do cliente>', 'base', 'active', now() + interval '1 month');
     ```

  3. No painel da plataforma, clique em "Reenviar ativação" nessa venda.
- **A fila do webhook do Asaas pausou**, depois de 15 falhas seguidas. O
  servidor só responde erro quando uma nova tentativa pode dar certo: banco
  fora do ar ou variável faltando. Corrija a causa e reative a fila em
  Integrações → Webhooks.
- **Desfazer.** Nada no banco apaga dado. Para desligar o webhook, desative-o
  no Asaas ou rode:

  ```sql
  update public.billing_intakes set enabled = false where provider = 'asaas';
  ```
