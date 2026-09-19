import assert from "node:assert/strict";
import test from "node:test";
import {
  billingConfig,
  fetchAsaasCustomerEmail,
  parseAsaasEvent,
  processAsaasWebhook,
  verifyAsaasToken,
} from "../src/billing.mjs";
import { activationUrl, buildActivationEmail, buildSaleNoticeEmail, normalizeActivationCode } from "../src/activation.mjs";
import { createServer } from "../src/server.mjs";

const CONFIG = billingConfig({
  ASAAS_WEBHOOK_TOKEN: "segredo-do-painel",
  ASAAS_API_KEY: "$aact_teste",
  ASAAS_API_URL: "https://api-sandbox.asaas.com/v3/",
  BILLING_INTAKE_TOKEN: "F".repeat(64),
  OPS_NOTIFY_EMAILS: "ops@exemplo.com, nao-e-email ,dono@exemplo.com",
});

const pagamento = (overrides = {}) => JSON.stringify({
  id: "evt_1",
  event: "PAYMENT_CONFIRMED",
  payment: {
    id: "pay_1",
    customer: "cus_1",
    subscription: "sub_1",
    paymentLink: "123517639363",
    value: 97,
    billingType: "CREDIT_CARD",
    status: "CONFIRMED",
    dueDate: "2026-09-20",
    description: "Plano Base",
    customerName: "Fulano de Tal",
  },
  ...overrides,
});

function dependencias(overrides = {}) {
  const chamadas = { fetchEmail: [], receive: [], sendActivation: [], markDelivered: [], notifySale: [], log: [] };
  const deps = {
    fetchEmail: async (customerId) => { chamadas.fetchEmail.push(customerId); return "cliente@exemplo.com"; },
    receive: async (event, email) => {
      chamadas.receive.push({ event, email });
      return { action: "send_activation", grant_id: "g-1", access_code: "NM12-3456-7890-AB", email: "cliente@exemplo.com", plan_code: "base", expires_at: "2026-10-20T00:00:00Z" };
    },
    sendActivation: async (activation) => { chamadas.sendActivation.push(activation); },
    markDelivered: async (grantId, delivered) => { chamadas.markDelivered.push({ grantId, delivered }); },
    notifySale: async (sale) => { chamadas.notifySale.push(sale); },
    log: (message) => chamadas.log.push(message),
    ...overrides,
  };
  return { deps, chamadas };
}

test("configuração normaliza a URL, o token e os e-mails de aviso", () => {
  assert.equal(CONFIG.apiUrl, "https://api-sandbox.asaas.com/v3");
  assert.equal(CONFIG.intakeToken, "f".repeat(64));
  assert.deepEqual(CONFIG.opsEmails, ["ops@exemplo.com", "dono@exemplo.com"]);
  assert.equal(billingConfig({}).apiUrl, "https://api.asaas.com/v3");
});

test("o token do webhook é comparado inteiro e nunca aceita ambiente vazio", () => {
  assert.equal(verifyAsaasToken("segredo-do-painel", "segredo-do-painel"), true);
  assert.equal(verifyAsaasToken("segredo-do-paine", "segredo-do-painel"), false);
  assert.equal(verifyAsaasToken(undefined, "segredo-do-painel"), false);
  assert.equal(verifyAsaasToken("", ""), false);
});

test("o evento só leva ao banco os campos que ele usa", () => {
  const evento = parseAsaasEvent(JSON.parse(pagamento()));
  assert.deepEqual(evento, {
    id: "evt_1",
    event: "PAYMENT_CONFIRMED",
    payment: {
      id: "pay_1",
      customer: "cus_1",
      subscription: "sub_1",
      paymentLink: "123517639363",
      dueDate: "2026-09-20",
      status: "CONFIRMED",
    },
  });
  assert.doesNotMatch(JSON.stringify(evento), /Fulano|97|Plano Base/);
});

test("evento sem id ganha um substituto estável; evento sem recurso é descartado", () => {
  const sem = { event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_9", status: "INACTIVE" } };
  assert.equal(parseAsaasEvent(sem).id, "SUBSCRIPTION_DELETED:sub_9:INACTIVE");
  assert.equal(parseAsaasEvent(sem).id, parseAsaasEvent(structuredClone(sem)).id);
  assert.equal(parseAsaasEvent({ event: "PAYMENT_RECEIVED" }), null);
  assert.equal(parseAsaasEvent({ id: "evt", event: "x-y" }), null);
  assert.equal(parseAsaasEvent([]), null);
});

test("pagamento confirmado busca o e-mail, registra, envia a ativação e avisa a equipe", async () => {
  const { deps, chamadas } = dependencias();
  const resultado = await processAsaasWebhook({ token: "segredo-do-painel", rawBody: pagamento(), config: CONFIG, deps });
  assert.deepEqual(resultado, { status: 200, body: { received: true, activation: "sent" } });
  assert.deepEqual(chamadas.fetchEmail, ["cus_1"]);
  assert.equal(chamadas.receive[0].email, "cliente@exemplo.com");
  assert.equal(chamadas.receive[0].event.payment.customer, "cus_1");
  assert.deepEqual(chamadas.sendActivation, [{ email: "cliente@exemplo.com", code: "NM12-3456-7890-AB", planCode: "base", expiresAt: "2026-10-20T00:00:00Z" }]);
  assert.deepEqual(chamadas.markDelivered, [{ grantId: "g-1", delivered: true }]);
  assert.deepEqual(chamadas.notifySale, [{ email: "cliente@exemplo.com", planCode: "base", delivered: true }]);
});

test("SMTP fora do ar ainda responde 200: o evento e o código já estão gravados", async () => {
  const { deps, chamadas } = dependencias({ sendActivation: async () => { throw new Error("smtp"); } });
  const resultado = await processAsaasWebhook({ token: "segredo-do-painel", rawBody: pagamento(), config: CONFIG, deps });
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.activation, "failed");
  assert.deepEqual(chamadas.markDelivered, [{ grantId: "g-1", delivered: false }]);
  assert.equal(chamadas.notifySale[0].delivered, false);
});

test("evento repetido não manda e-mail de novo", async () => {
  const { deps, chamadas } = dependencias({ receive: async () => ({ action: "none", duplicate: true }) });
  const resultado = await processAsaasWebhook({ token: "segredo-do-painel", rawBody: pagamento(), config: CONFIG, deps });
  assert.deepEqual(resultado, { status: 200, body: { received: true, duplicate: true } });
  assert.equal(chamadas.sendActivation.length, 0);
});

test("token errado é 401 e não toca em nada", async () => {
  const { deps, chamadas } = dependencias();
  const resultado = await processAsaasWebhook({ token: "outro", rawBody: pagamento(), config: CONFIG, deps });
  assert.equal(resultado.status, 401);
  assert.equal(chamadas.fetchEmail.length + chamadas.receive.length, 0);
});

test("sem configuração o webhook recusa com 503, para o Asaas tentar depois", async () => {
  const { deps } = dependencias();
  const semToken = billingConfig({ ASAAS_WEBHOOK_TOKEN: "x" });
  assert.equal((await processAsaasWebhook({ token: "x", rawBody: pagamento(), config: semToken, deps })).status, 503);
});

test("banco fora do ar é 502 (o Asaas reentrega); evento inválido para o banco é 200", async () => {
  const falha = dependencias({ receive: async () => { throw new Error("connection reset"); } });
  assert.equal((await processAsaasWebhook({ token: "segredo-do-painel", rawBody: pagamento(), config: CONFIG, deps: falha.deps })).status, 502);
  assert.equal(falha.chamadas.sendActivation.length, 0);

  const invalido = dependencias({ receive: async () => { throw new Error("billing event is invalid"); } });
  assert.equal((await processAsaasWebhook({ token: "segredo-do-painel", rawBody: pagamento(), config: CONFIG, deps: invalido.deps })).status, 200);

  const tokenRecusado = dependencias({ receive: async () => { throw new Error("intake token is invalid"); } });
  const recusado = await processAsaasWebhook({ token: "segredo-do-painel", rawBody: pagamento(), config: CONFIG, deps: tokenRecusado.deps });
  assert.equal(recusado.status, 502);
  assert.deepEqual(tokenRecusado.chamadas.log, ["billing intake token rejected"]);
});

test("falha ao consultar o cliente no Asaas é 502 e não registra o evento pela metade", async () => {
  const { deps, chamadas } = dependencias({ fetchEmail: async () => { throw new Error("timeout"); } });
  const resultado = await processAsaasWebhook({ token: "segredo-do-painel", rawBody: pagamento(), config: CONFIG, deps });
  assert.equal(resultado.status, 502);
  assert.equal(chamadas.receive.length, 0);
});

test("eventos que não liberam acesso não consultam o e-mail", async () => {
  const recebidos = [];
  const { deps, chamadas } = dependencias({ receive: async (event) => { recebidos.push(event.event); return { action: "none", result: "canceled" }; } });
  const cancelamento = JSON.stringify({ id: "evt_2", event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_1", customer: "cus_1" } });
  assert.equal((await processAsaasWebhook({ token: "segredo-do-painel", rawBody: cancelamento, config: CONFIG, deps })).status, 200);
  const avulso = JSON.stringify({ id: "evt_3", event: "PAYMENT_RECEIVED", payment: { id: "pay_9", customer: "cus_9" } });
  assert.equal((await processAsaasWebhook({ token: "segredo-do-painel", rawBody: avulso, config: CONFIG, deps })).status, 200);
  assert.equal(chamadas.fetchEmail.length, 0);
  assert.deepEqual(recebidos, ["SUBSCRIPTION_DELETED", "PAYMENT_RECEIVED"]);
});

test("corpo que não é JSON ou evento sem forma é 200 ignorado; corpo grande demais é 413", async () => {
  const { deps, chamadas } = dependencias();
  assert.deepEqual(await processAsaasWebhook({ token: "segredo-do-painel", rawBody: "{nao-json", config: CONFIG, deps }), { status: 200, body: { ignored: true } });
  assert.deepEqual(await processAsaasWebhook({ token: "segredo-do-painel", rawBody: "{}", config: CONFIG, deps }), { status: 200, body: { ignored: true } });
  assert.equal((await processAsaasWebhook({ token: "segredo-do-painel", rawBody: null, config: CONFIG, deps })).status, 413);
  assert.equal(chamadas.receive.length, 0);
});

test("a consulta do cliente usa a chave no cabeçalho e trata 404 e erro", async () => {
  const pedidos = [];
  const fetchImpl = async (url, init) => {
    pedidos.push({ url, init });
    if (url.endsWith("/cus_404")) return new Response("{}", { status: 404 });
    if (url.endsWith("/cus_500")) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ id: "cus_1", email: " Cliente@Exemplo.COM " }), { status: 200 });
  };
  const base = { apiUrl: "https://api-sandbox.asaas.com/v3", apiKey: "$aact_x", fetchImpl };
  assert.equal(await fetchAsaasCustomerEmail({ ...base, customerId: "cus_1" }), "cliente@exemplo.com");
  assert.equal(pedidos[0].url, "https://api-sandbox.asaas.com/v3/customers/cus_1");
  assert.equal(pedidos[0].init.headers.access_token, "$aact_x");
  assert.ok(pedidos[0].init.headers["User-Agent"]);
  assert.equal(await fetchAsaasCustomerEmail({ ...base, customerId: "cus_404" }), null);
  await assert.rejects(fetchAsaasCustomerEmail({ ...base, customerId: "cus_500" }), /500/);
  assert.equal(await fetchAsaasCustomerEmail({ ...base, customerId: "../admin" }), null);
  assert.equal(pedidos.length, 3);
  await assert.rejects(fetchAsaasCustomerEmail({ ...base, apiKey: "", customerId: "cus_1" }), /ASAAS_API_KEY/);
});

test("o link de ativação fica debaixo de /app e leva código e e-mail", () => {
  const link = activationUrl({ publicOrigin: "https://nucleomajor.com/", code: "nm12 3456 7890 ab", email: " Pessoa@Empresa.com " });
  assert.equal(link, "https://nucleomajor.com/app/ativar?codigo=NM12-3456-7890-AB&email=pessoa%40empresa.com");
  assert.throws(() => activationUrl({ publicOrigin: "http://localhost", code: "NM12-3456-7890-AB" }), /HTTPS/);
  assert.throws(() => activationUrl({ publicOrigin: "https://nucleomajor.com", code: "abc" }), /inválido/);
  assert.equal(normalizeActivationCode("NM1234567890AB"), "NM12-3456-7890-AB");
});

test("o e-mail de ativação escapa o que veio de fora e traz código e prazo", () => {
  const message = buildActivationEmail({
    email: "<x>@exemplo.com",
    code: "NM12-3456-7890-AB",
    link: "https://nucleomajor.com/app/ativar?codigo=NM12-3456-7890-AB&email=x",
    planCode: "base",
    expiresAt: "2026-10-20T12:00:00Z",
  });
  assert.match(message.subject, /liberado/);
  assert.match(message.text, /NM12-3456-7890-AB/);
  assert.match(message.text, /20\/10\/2026/);
  assert.match(message.html, /&lt;x&gt;@exemplo\.com/);
  assert.match(message.html, /codigo=NM12-3456-7890-AB&amp;email=x/);
  assert.match(message.html, /plano Base/);

  const aviso = buildSaleNoticeEmail({ email: "cliente@exemplo.com", planCode: "base" });
  assert.match(aviso.text, /cliente@exemplo\.com/);
  assert.doesNotMatch(aviso.text, /NM12/);
});

test("o servidor entrega o webhook sem exigir sessão e publica o checkoutUrl", async (t) => {
  const recebidos = [];
  const server = createServer({
    apiHandler: async (req, res) => { res.writeHead(418).end(); },
    billingHandler: async (req, res, url) => {
      recebidos.push({ path: url.pathname, token: req.headers["asaas-access-token"] });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const webhook = await fetch(`${origin}/api/billing/asaas`, {
    method: "POST",
    headers: { "asaas-access-token": "tk", "Content-Type": "application/json" },
    body: pagamento(),
  });
  assert.equal(webhook.status, 200);
  assert.deepEqual(recebidos, [{ path: "/api/billing/asaas", token: "tk" }]);

  // GET na mesma rota não é webhook: cai no fluxo autenticado de sempre.
  assert.equal((await fetch(`${origin}/api/billing/asaas`)).status, 418);

  const config = await (await fetch(`${origin}/api/config`)).json();
  assert.ok("checkoutUrl" in config);
});
