import { createHash, timingSafeEqual } from "node:crypto";

// Webhook do Asaas. O servidor só confere o cabeçalho, busca o e-mail de quem
// pagou e repassa o evento à RPC `nucleo_billing_asaas_receive`, que decide
// tudo o mais no banco (ver 20260920100000). A entrega do Asaas é "at least
// once" e a fila dele PAUSA depois de 15 respostas fora de 2xx seguidas: por
// isso só se devolve erro quando tentar de novo pode dar certo.

export const EVENTS_NEEDING_EMAIL = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const MAX_WEBHOOK_BYTES = 64_000;

export function billingConfig(env = process.env) {
  return {
    webhookToken: String(env.ASAAS_WEBHOOK_TOKEN || ""),
    apiKey: String(env.ASAAS_API_KEY || ""),
    apiUrl: String(env.ASAAS_API_URL || "https://api.asaas.com/v3").trim().replace(/\/$/, ""),
    intakeToken: String(env.BILLING_INTAKE_TOKEN || "").trim().toLowerCase(),
    checkoutUrl: String(env.PUBLIC_CHECKOUT_URL || "").trim(),
    opsEmails: String(env.OPS_NOTIFY_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)),
  };
}

// Compara o hash dos dois lados: mesmo tamanho sempre, tempo constante, e um
// token vazio no ambiente nunca aceita nada.
export function verifyAsaasToken(received, expected) {
  if (!expected) return false;
  const a = createHash("sha256").update(String(received || ""), "utf8").digest();
  const b = createHash("sha256").update(String(expected), "utf8").digest();
  return timingSafeEqual(a, b);
}

const texto = (value, max = 120) => {
  const clean = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return clean ? clean.slice(0, max) : undefined;
};

// Só os campos que o banco usa. Nome, CPF, valor e o resto do payload não
// passam daqui.
export function parseAsaasEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const event = String(body.event || "").trim().toUpperCase();
  if (!/^[A-Z_]{3,80}$/.test(event)) return null;
  const payment = body.payment && typeof body.payment === "object" ? body.payment : null;
  const subscription = body.subscription && typeof body.subscription === "object" ? body.subscription : null;
  const parsed = { id: texto(body.id, 200), event };
  if (payment) {
    parsed.payment = {
      id: texto(payment.id),
      customer: texto(payment.customer),
      subscription: texto(payment.subscription),
      paymentLink: texto(payment.paymentLink),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(payment.dueDate || "")) ? String(payment.dueDate) : undefined,
      status: texto(payment.status, 40),
    };
  }
  if (subscription) {
    parsed.subscription = {
      id: texto(subscription.id),
      customer: texto(subscription.customer),
      paymentLink: texto(subscription.paymentLink),
      status: texto(subscription.status, 40),
    };
  }
  // Versões antigas do webhook não mandam `id`. O substituto é determinístico,
  // para a reentrega do mesmo evento continuar caindo na idempotência.
  if (!parsed.id) {
    const recurso = parsed.payment?.id || parsed.subscription?.id;
    if (!recurso) return null;
    parsed.id = `${event}:${recurso}:${parsed.payment?.status || parsed.subscription?.status || ""}`.slice(0, 200);
  }
  return parsed;
}

export async function fetchAsaasCustomerEmail({ apiUrl, apiKey, customerId, fetchImpl = fetch, timeoutMs = 5000 }) {
  if (!apiKey) throw new Error("ASAAS_API_KEY não configurada.");
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(String(customerId || ""))) return null;
  const response = await fetchImpl(`${apiUrl}/customers/${encodeURIComponent(customerId)}`, {
    method: "GET",
    headers: { access_token: apiKey, "User-Agent": "nucleo-major-portal", Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Asaas respondeu ${response.status} ao buscar o cliente.`);
  const customer = await response.json().catch(() => null);
  const email = String(customer?.email || "").trim().toLowerCase();
  return email || null;
}

export async function readRawBody(req, limit = MAX_WEBHOOK_BYTES) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * O fluxo inteiro, sem HTTP nem Supabase: quem chama injeta as dependências.
 *
 *   receive(event, email)        → resposta da RPC (lança se o banco falhar)
 *   fetchEmail(customerId)       → e-mail ou null (lança se o Asaas falhar)
 *   sendActivation(activation)   → envia o e-mail de ativação (lança se falhar)
 *   markDelivered(grantId, ok)   → registra a entrega no banco
 *   notifySale(sale)             → aviso para a equipe (melhor esforço)
 */
export async function processAsaasWebhook({ token, rawBody, config, deps }) {
  if (!config.webhookToken || !config.intakeToken) {
    deps.log?.("billing webhook not configured");
    return { status: 503, body: { error: "Cobrança não configurada.", code: "billing-not-configured" } };
  }
  if (!verifyAsaasToken(token, config.webhookToken)) {
    return { status: 401, body: { error: "Token inválido.", code: "billing-token-invalid" } };
  }
  if (rawBody === null) {
    return { status: 413, body: { error: "Evento grande demais.", code: "payload-too-large" } };
  }
  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    // Um corpo que não é JSON não vai melhorar na reentrega; 2xx para não
    // pausar a fila por causa dele.
    return { status: 200, body: { ignored: true } };
  }
  const event = parseAsaasEvent(body);
  if (!event) return { status: 200, body: { ignored: true } };

  let email = null;
  const customerId = event.payment?.customer;
  if (EVENTS_NEEDING_EMAIL.has(event.event) && event.payment?.subscription && customerId) {
    try {
      email = await deps.fetchEmail(customerId);
    } catch {
      deps.log?.("billing customer lookup failed");
      return { status: 502, body: { error: "Não foi possível consultar o cliente.", code: "billing-customer-unavailable" } };
    }
  }

  let result;
  try {
    result = await deps.receive(event, email);
  } catch (error) {
    const message = String(error?.message || "");
    if (/billing event is invalid/i.test(message)) return { status: 200, body: { ignored: true } };
    deps.log?.(/intake token is invalid/i.test(message) ? "billing intake token rejected" : "billing receive failed");
    return { status: 502, body: { error: "Não foi possível registrar o evento.", code: "billing-receive-failed" } };
  }

  if (result?.action === "send_activation") {
    let delivered = false;
    try {
      await deps.sendActivation({
        email: result.email,
        code: result.access_code,
        planCode: result.plan_code,
        expiresAt: result.expires_at,
      });
      delivered = true;
    } catch {
      // O evento já está gravado e o código também. Reenviar é pelo painel
      // da plataforma, que emite outro código; aqui não se tenta de novo.
      deps.log?.("billing activation email failed");
    }
    try {
      await deps.markDelivered(result.grant_id, delivered);
    } catch {
      deps.log?.("billing delivery mark failed");
    }
    try {
      await deps.notifySale?.({ email: result.email, planCode: result.plan_code, delivered });
    } catch {
      deps.log?.("billing sale notice failed");
    }
    return { status: 200, body: { received: true, activation: delivered ? "sent" : "failed" } };
  }

  return { status: 200, body: { received: true, duplicate: Boolean(result?.duplicate) } };
}
