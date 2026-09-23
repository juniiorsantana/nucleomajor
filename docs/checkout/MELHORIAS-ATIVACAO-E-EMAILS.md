# Ativação do cliente e e-mails: o que corrigir

> Levantado em 23/09/2026, depois da **primeira cliente real** ativada: Adriane
> ("Adriani Ademicon", plano Base, liberação manual). O fluxo **funcionou**: a
> conta foi criada, o e-mail confirmado e a empresa nasceu no plano certo. A
> experiência, porém, travou no meio, e os e-mails não estão no nível de um
> produto pago.
>
> Nada disto foi implementado ainda. Cada item traz o fato observado, a causa
> (confirmada ou provável), a correção proposta e como saber que ficou pronto.

## Ordem sugerida

| # | Item | Prioridade | Por quê |
|---|---|---|---|
| 1 | SMTP próprio no Supabase | **P0: fazer antes do próximo cliente** | Hoje saem só 2 e-mails de autenticação por hora no projeto inteiro. |
| 2 | Tela travada depois de confirmar o e-mail | P1 | O cliente precisou fechar o Chrome e limpar os cookies. |
| 3 | E-mails personalizados | P1 | Hoje são três e-mails de três lugares, um deles em inglês e com remetente do Supabase. |
| 4 | Prazo nas liberações manuais | P2 | Os 90 dias da Adriane foram aplicados à mão, por SQL. |

---

## 1. P0: os e-mails de autenticação estão limitados a 2 por hora

**Fato (lido no painel do Supabase em 23/09/2026):**

- Auth → Emails: *"Set up custom SMTP to edit templates. Emails will be sent
  using the default templates."* O projeto usa o SMTP padrão do Supabase;
- Auth → Rate Limits: `RATE_LIMIT_EMAIL_SENT = 2` por hora, **travado**. Com o
  SMTP padrão, o Supabase não deixa aumentar.

**Impacto:** confirmação de cadastro, troca de senha e troca de e-mail somam
**2 envios por hora para o projeto todo**. Se três clientes se cadastrarem na
mesma hora, o terceiro não recebe a confirmação e não consegue entrar. O
SMTP padrão também não é feito para produção: o remetente é do Supabase e o
envio pode cair em spam.

**Correção:**

1. Escolher o provedor. O mais simples é reaproveitar o mesmo SMTP que o servidor
   já usa para convites e ativação (`SMTP_*` na Hostinger). A alternativa é um
   serviço transacional (Resend, Brevo, Amazon SES).
2. No domínio `nucleomajor.com`, configurar **SPF, DKIM e DMARC** para o
   remetente.
3. Supabase → Auth → Emails → **SMTP Settings**:
   - remetente `Núcleo Major <nao-responda@nucleomajor.com>`;
   - host, porta, usuário e senha do provedor. Quem digita é o dono: senha
     não passa pelo assistente.
4. Supabase → Auth → Rate Limits: subir `emails/h` para algo como **60**.

**Pronto quando:** cinco cadastros de teste na mesma hora recebem a
confirmação, com o remetente `nucleomajor.com`, e o e-mail não cai em spam no
Gmail nem no Outlook.

---

## 2. P1: a tela trava depois de confirmar o e-mail

### O que aconteceu

1. Abriu o link de ativação (`/app/ativar?codigo=…&email=…`);
2. o portal pediu nome e senha, criou a conta e o Supabase mandou o e-mail de
   confirmação;
3. clicou em confirmar. **A tela travou** e não saiu dali;
4. só entrou no app depois de **fechar o Chrome e limpar os cookies**. O acesso
   já estava liberado: a empresa existia, com o e-mail confirmado.

### Como o fluxo funciona hoje

| Passo | Onde |
|---|---|
| O link de ativação é lido **na primeira renderização**. O código vai para o `sessionStorage` e **o endereço é reescrito** com `history.replaceState`. | `apps/emyleads/src/page/ativacao.js` (`lerAtivacaoDaUrl`) e `page/AuthGate.jsx:422` |
| O cadastro pede ao Supabase que a confirmação volte para `/app/ativar?codigo=…&email=…`. | `AuthGate.jsx:51` (`linkDeRetorno`) e `web/authProvider.js:240` (`emailRedirectTo`) |
| Ao voltar da confirmação, a sessão vem **no próprio endereço** (fluxo implícito: `#access_token=…`). O Supabase a lê sozinho (`detectSessionInUrl: true`). | `web/supabaseClient.js` |
| Enquanto a sessão não é resolvida, o `AuthGate` mostra só um ícone girando, **sem tempo-limite e sem botão**. | `AuthGate.jsx`, nos dois `LoaderCircle` |

### Causas prováveis (confirmar antes de mexer)

**A. Disputa entre apagar o endereço e ler a sessão.** O cliente do Supabase é
criado antes da tela, mas só lê o `#access_token` depois de um passo assíncrono
(a trava de sessão do navegador). Enquanto isso, o `lerAtivacaoDaUrl` já pode
ter reescrito o endereço **sem o `#…`**. Quando o Supabase olha, a sessão
sumiu. Como é uma disputa de tempo, às vezes funciona e às vezes não.

**B. Outra conta aberta no mesmo navegador.** O teste foi feito no Chrome em
que a conta do dono da Major já estava logada. A sessão guardada
(`localStorage`, chave `emyleads.supabase.auth`) e a da conta nova disputam o
mesmo lugar. Limpar os cookies e o armazenamento resolve exatamente isso.

**C. Espera sem saída.** Qualquer promessa que não termine (sessão, leitura da
assinatura, controle de migração) deixa o ícone girando para sempre, sem nada
que o cliente possa fazer. Mesmo que A e B sejam corrigidas, uma falha de rede
volta a dar esta mesma tela.

**Como confirmar:** reproduzir num **perfil novo do Chrome**, com o DevTools
aberto, e anotar:

- o endereço completo ao voltar da confirmação: há `#access_token` ou `?code`?
- `localStorage['emyleads.supabase.auth']` e
  `sessionStorage['emyleads.ativacao.pendente']`, antes e depois;
- erros no console e chamadas pendentes na aba Network.

Depois repetir **com a conta da Major logada no mesmo perfil**, que é o caso B.

### Correções propostas

1. **Não apagar o que o Supabase precisa.** O `lerAtivacaoDaUrl` passa a remover
   só `codigo` e `email`, preservando o `#…` e o `?code`. E faz isso depois de
   `supabase.auth.getSession()` resolver, não na primeira renderização.
2. **Tela de "E-mail confirmado ✅".** A volta da confirmação cai numa tela
   própria, "Seu e-mail foi confirmado. Continuar", que só avança com a sessão
   garantida. Se a confirmação abrir em outro navegador ou no celular (sem a
   sessão da aba original), a tela pede **só a senha**, com o e-mail já
   preenchido, e segue para a ativação.
3. **Espera com saída.** Depois de ~10 s girando, a tela mostra *"Está
   demorando mais que o normal"*, com dois botões:
   - **Tentar de novo**;
   - **Sair e entrar de novo**: `supabase.auth.signOut({ scope: "local" })`,
     limpa as chaves `emyleads.*` do armazenamento e volta ao login.

   O cliente nunca mais precisa limpar cookies.
4. **Link de ativação com outra conta logada.** Mostrar *"Você está conectado
   como fulano@… . Para ativar o acesso de adriane@…, saia desta conta"*, com o
   botão **Sair e continuar**. Hoje o link simplesmente abre o painel da conta
   que já estava logada.
5. **Avaliar o fluxo PKCE** (`flowType: "pkce"`, trocando o `?code` por sessão
   de forma explícita). Ele é mais previsível que o implícito, mas exige que a
   confirmação abra no mesmo navegador do cadastro, e o item 2 cobre o outro
   caso.

**Pronto quando**, num perfil limpo do Chrome e também no celular:

- ativação → cadastro → confirmação **na mesma aba**: entra sem travar;
- confirmação aberta **em outra aba ou outro aparelho**: pede a senha e entra;
- com **outra conta logada**: aparece o aviso e o botão funciona;
- se a rede cair no meio, aparece o botão **em até 10 s**.

**Testes:** estender `AuthGate.interactive.test.jsx` (volta com `#access_token`,
volta sem sessão, espera longa) e criar um e2e em Playwright com o fluxo
completo.

---

## 3. P1: e-mails personalizados

### Hoje

| E-mail | Quem manda | Estado |
|---|---|---|
| "Seu acesso ao Núcleo Major está liberado" | Nosso servidor (`SMTP_*`): texto em `src/activation.mjs` (`buildActivationEmail`), envio em `src/server.mjs` (`sendActivationEmail`) | Em português, com a nossa marca. **Só existe quando o pagamento vem pelo Asaas.** |
| Liberação manual (painel da plataforma) | **Ninguém** | O dono copia o código e manda à mão (WhatsApp, e-mail pessoal). |
| Confirmação de cadastro, troca de senha, troca de e-mail | Supabase | **Modelo padrão, em inglês, com remetente do Supabase.** Só é editável com SMTP próprio (item 1). |

### Proposta

1. **Modelos do Supabase em português e com a marca**, versionados no
   repositório em `supabase/templates/*.html` e colados no painel. São cinco:
   Confirm signup, Reset password, Magic link, Change email e Invite user.
   Exemplo de **Confirme seu e-mail**:

   - **Assunto:** Confirme seu e-mail para entrar no Núcleo Major
   - **Corpo:**

     > Olá!
     >
     > Falta só um passo para você começar a usar o Núcleo Major. Confirme
     > que este e-mail é seu:
     >
     > **[Confirmar meu e-mail]({{ .ConfirmationURL }})**
     >
     > Se você não pediu este cadastro, é só ignorar esta mensagem.
     >
     > Equipe Núcleo Major

2. **A liberação manual passa a mandar o e-mail de ativação sozinha**,
   reaproveitando o mesmo envio do pagamento (`sendActivationEmail` em
   `src/server.mjs`, que já é usado pelo "Reenviar ativação" das vendas), e ganha o botão **Reenviar**. O código continua
   visível para o administrador, como reserva.
3. **Um remetente e um visual só** para os três e-mails, com o mesmo cabeçalho,
   rodapé e cores do portal.
4. **O e-mail de ativação explica o que vem depois:** *"Você vai criar uma
   senha, confirmar este e-mail e dar o nome da sua empresa"*. Assim o segundo
   e-mail, o de confirmação, não pega o cliente de surpresa.

**Pronto quando** os três e-mails chegam em português, do mesmo remetente
`@nucleomajor.com`, com o mesmo visual, e a liberação manual chega sozinha na
caixa do cliente.

---

## 4. P2: prazo nas liberações manuais

**Hoje:** a liberação manual cria a empresa com `status = 'active'` e **sem
data de fim**. O prazo de 90 dias da Adriane foi aplicado à mão, em 23/09/2026:

```sql
update public.organization_subscriptions
set status = 'canceled',
    current_period_ends_at = '2026-12-21 23:59:59-03',
    updated_at = now()
where organization_id = '600d6eb8-4ffe-4523-a920-679105c2bc95'
  and source = 'manual';
```

Com isso, o acesso segue normal até 21/12/2026 e bloqueia sozinho a partir de
22/12, com a mensagem *"o período pago terminou"*. Para renovar, basta estender a data.

**Proposta:**

- campo **"Acesso até"** (ou "Dias de acesso") no painel de liberação, gravado
  na liberação e aplicado pelo `create_organization` quando a empresa nasce;
- no painel da plataforma, mostrar **"Pago até 21/12/2026 · sem renovação"**
  em vez de "Cancelada";
- avisar a equipe (`OPS_NOTIFY_EMAILS`) **7 dias antes** do fim, para oferecer a
  renovação;
- botão **Renovar** (+30, +90 dias) no painel.

---

## Outras pendências anotadas no caminho

- **Link de teste de R$ 5** no Asaas (`hhzk6kvsa1olo3ov`, limite de 1 venda),
  cadastrado no banco como plano Base. Depois do teste: desativar no Asaas e
  rodar `update public.billing_payment_links set active = false where
  external_link_id = 'hhzk6kvsa1olo3ov';`.
- **Links anuais**: o dono ainda não definiu o preço anual dos três planos.
- **Checkout do Asaas com a marca**: Integrações → Checkout, com logo e cores.
- **Cupons**: o Asaas não tem código de desconto digitado. Cada cupom vira um
  link com preço próprio, cadastrado no banco como o plano. Desconto só nos
  primeiros meses exige trocar o valor da assinatura pela API depois do
  primeiro pagamento.
- **Sobra antiga**: `public.create_organization(text)`, a versão de antes do
  checkout, ainda pode ser executada por `anon`. Não é explorável, porque recusa
  quem não está logado, mas merece um `revoke … from anon` ou um `drop`.
