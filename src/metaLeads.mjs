// O lead do formulário instantâneo do Meta (Lead Ads) entra no CRM e é chamado
// no WhatsApp, pela mesma porta do lead do site.
//
// O Meta não manda o lead: manda um aviso (`leadgen`) com o id dele. Este
// módulo confere a assinatura do aviso, busca o lead no Graph e o entrega a
// `nucleo_site_lead_receive(token, lead)` — a função que já grava o lead, o
// contato com etiqueta e enfileira a primeira mensagem, com teto por hora, sem
// repetir mensagem e sem mandar nada sem consentimento. Nada disso é refeito
// aqui.
//
// Por que a função aceita a chave publicável: sem o token da campanha ela não
// encontra campanha, organização nem conexão. O token vive só na variável de
// ambiente deste servidor, um por página do Facebook.
//
// Quando responder erro: o Meta reenvia o aviso enquanto receber algo diferente
// de 2xx. Por isso só falha TEMPORÁRIA (Graph ou banco fora, teto da hora)
// volta 500. Lead que nunca vai entrar (telefone inválido, página sem
// campanha) volta 200, ou o Meta repetiria para sempre. Reenviar é seguro:
// a função não chama duas vezes o mesmo telefone na mesma campanha.
//
// LGPD: nome, telefone e e-mail do lead não vão para o log. Só o id do lead do
// Meta e o desfecho.

import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 64_000;
const GRAPH_TIMEOUT_MS = 10_000;

// Erros da função que o reenvio não conserta.
const PERMANENT_RPC_ERRORS = [
  /phone number is invalid/i,
  /lead name is required/i,
  /lead payload is invalid/i,
  /intake token is invalid/i,
];

export class MetaLeadsError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signatureIsValid(rawBody, header, appSecret) {
  const match = String(header || "").match(/^sha256=([0-9a-f]{64})$/i);
  if (!match || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, match[1].toLowerCase());
}

// `{"<page_id>": "<token da campanha>"}`. Token fora do formato é descartado
// na leitura, para o erro aparecer na subida e não no primeiro lead.
export function parseIntakes(raw) {
  if (!raw) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("META_LEADS_INTAKES não é JSON válido");
  }
  const intakes = new Map();
  for (const [pageId, token] of Object.entries(parsed || {})) {
    const cleanToken = String(token || "").trim().toLowerCase();
    if (!/^\d+$/.test(pageId) || !/^[0-9a-f]{64}$/.test(cleanToken)) {
      throw new Error(`META_LEADS_INTAKES tem uma entrada inválida para a página ${pageId}`);
    }
    intakes.set(pageId, cleanToken);
  }
  return intakes;
}

function answer(fields, pattern) {
  const field = fields.find((item) => pattern.test(String(item?.name || "")));
  const value = Array.isArray(field?.values) ? field.values[0] : field?.values;
  return typeof value === "string" ? value.trim() : "";
}

// Os nomes dos campos padrão do Meta são fixos (`full_name`, `phone_number`,
// `email`); pergunta personalizada tem o nome que quem montou o formulário deu.
// Aceita os dois.
export function leadFromFieldData(fieldData) {
  const fields = Array.isArray(fieldData) ? fieldData : [];
  const fullName = answer(fields, /^(full_name|nome(_completo)?|name)$/i)
    || [answer(fields, /^first_name$/i), answer(fields, /^last_name$/i)].filter(Boolean).join(" ");
  const phone = answer(fields, /^(phone_number|telefone|celular|whatsapp)$/i);
  const email = answer(fields, /^(email|e-mail)$/i);

  // Enviar o formulário é pedir o contato. Se o formulário tiver uma pergunta
  // de consentimento, vale a resposta dela, e só um "sim" claro conta.
  const consentField = fields.find((item) => /consent|autoriz/i.test(String(item?.name || "")));
  const consent = consentField
    ? /^(sim|yes|true|1|aceito|autorizo)$/i.test(answer([consentField], /./))
    : true;

  return { nome: fullName, telefone: phone, email, consentimento: consent };
}

async function readRaw(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new MetaLeadsError(413, "payload too large", "payload-too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function createMetaLeadsHandler({
  appSecret = "",
  verifyToken = "",
  accessToken = "",
  intakes = new Map(),
  supabaseUrl = "",
  publishableKey = "",
  graphVersion = "",
  fetchImpl = globalThis.fetch,
  log = (event, detail) => console.log(`meta-leads ${event}`, detail),
} = {}) {
  const graphBase = `https://graph.facebook.com${graphVersion ? `/${graphVersion}` : ""}`;
  const configured = Boolean(appSecret && verifyToken && accessToken && supabaseUrl && publishableKey && intakes.size);
  const proof = accessToken && appSecret
    ? createHmac("sha256", appSecret).update(accessToken).digest("hex")
    : "";

  async function fetchLead(leadgenId) {
    const url = new URL(`${graphBase}/${encodeURIComponent(leadgenId)}`);
    url.searchParams.set("fields", "field_data,created_time,form_id,ad_id");
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("appsecret_proof", proof);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
    if (!response.ok) {
      // Só o lead que não existe mais (código 100, apagado no Meta) é perda
      // definitiva. Permissão faltando é o erro mais comum de uma ligação nova:
      // se ele fosse descartado, todo lead até alguém corrigir o token sumiria.
      // Como erro temporário, o Meta reenvia o aviso e o lead entra depois.
      const payload = await response.json().catch(() => ({}));
      const graphCode = Number(payload?.error?.code) || null;
      if (graphCode === 100 && Number(payload?.error?.error_subcode) === 33) {
        throw new MetaLeadsError(422, "lead not found", "graph-lead-gone");
      }
      throw new MetaLeadsError(502, "graph refused", `graph-${graphCode || response.status}`);
    }
    return response.json();
  }

  async function deliver(intakeToken, lead) {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/nucleo_site_lead_receive`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ intake_token: intakeToken, lead }),
    });
    if (response.ok) return response.json().catch(() => ({}));
    const payload = await response.json().catch(() => ({}));
    const message = String(payload?.message || "");
    if (PERMANENT_RPC_ERRORS.some((pattern) => pattern.test(message))) {
      throw new MetaLeadsError(422, message, "lead-rejected");
    }
    throw new MetaLeadsError(502, "database unavailable", "database-unavailable");
  }

  async function processChange(pageId, value) {
    const leadgenId = String(value?.leadgen_id || "");
    if (!/^\d+$/.test(leadgenId)) return "ignored";
    const intakeToken = intakes.get(pageId);
    if (!intakeToken) {
      log("page-without-campaign", { pageId, leadgenId });
      return "ignored";
    }
    try {
      const data = await fetchLead(leadgenId);
      const result = await deliver(intakeToken, { ...leadFromFieldData(data?.field_data), origem: "meta_lead_ads" });
      log("delivered", { pageId, leadgenId, welcome: result?.welcome ?? null, reason: result?.reason ?? null });
      return "delivered";
    } catch (error) {
      if (error?.status === 422) {
        log("rejected", { pageId, leadgenId, code: error.code });
        return "rejected";
      }
      log("failed", { pageId, leadgenId, code: error?.code || "network" });
      return "retry";
    }
  }

  return async function metaLeads(req, res, url) {
    if (!configured) throw new MetaLeadsError(503, "meta leads not configured", "meta-leads-not-configured");

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token") || "";
      const challenge = url.searchParams.get("hub.challenge") || "";
      if (mode === "subscribe" && safeEqual(token, verifyToken) && /^[\w-]{1,128}$/.test(challenge)) {
        return send(res, 200, challenge, "text/plain; charset=utf-8");
      }
      throw new MetaLeadsError(403, "verification failed", "verification-failed");
    }

    if (req.method !== "POST") throw new MetaLeadsError(405, "method not allowed", "method-not-allowed");

    const raw = await readRaw(req);
    if (!signatureIsValid(raw, req.headers["x-hub-signature-256"], appSecret)) {
      throw new MetaLeadsError(401, "invalid signature", "invalid-signature");
    }
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new MetaLeadsError(400, "invalid json", "invalid-json");
    }
    if (body?.object !== "page") return send(res, 200, { received: 0 });

    const outcomes = [];
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      const pageId = String(entry?.id || "");
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        if (change?.field !== "leadgen") continue;
        outcomes.push(await processChange(pageId, change.value));
      }
    }

    // Um lead que falhou por motivo temporário faz o Meta reenviar o aviso
    // inteiro; os que já entraram voltam como repetidos e não recebem nada.
    if (outcomes.includes("retry")) throw new MetaLeadsError(500, "retry later", "retry-later");
    return send(res, 200, { received: outcomes.length });
  };
}

export function metaLeadsHandlerFromEnv(env = process.env) {
  return createMetaLeadsHandler({
    appSecret: String(env.META_APP_SECRET || ""),
    verifyToken: String(env.META_WEBHOOK_VERIFY_TOKEN || ""),
    accessToken: String(env.META_LEADS_ACCESS_TOKEN || ""),
    intakes: parseIntakes(env.META_LEADS_INTAKES),
    supabaseUrl: String(env.SUPABASE_URL || "").replace(/\/$/, ""),
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || ""),
    graphVersion: String(env.META_GRAPH_VERSION || ""),
  });
}
