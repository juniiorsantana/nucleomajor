// O webhook do canal oficial do WhatsApp (Cloud API da Meta).
//
// A Meta manda para UM endereço os eventos de todos os números de todos os
// clientes ligados ao app. Este módulo só faz três coisas: confere que o aviso
// é da Meta (assinatura sobre o corpo cru), separa o aviso em eventos — uma
// mensagem, um eco ou um status cada — e entrega a lista a
// `nucleo_whatsapp_cloud_receive(token, eventos)`. Quem decide de qual conexão
// é cada evento é o banco, pelo `phone_number_id`. Quem trata o evento é o
// adaptador da conexão na VPS, que puxa a fila. Ver
// docs/adr/ADR-0008-CANAL-OFICIAL-E-COEXISTENCIA.md.
//
// Os três tipos de evento:
// - `message`: o cliente escreveu (`field: messages`, `value.messages`);
// - `echo`: alguém da empresa respondeu pelo app do celular. Só existe na
//   coexistência (`field: smb_message_echoes`), e é o sinal que pausa a IA —
//   o mesmo papel do `is_from_me` do Bridge;
// - `status`: enviada/entregue/lida/falhou, de algo que nós enviamos.
//
// Quando responder erro: a Meta reenvia enquanto receber algo diferente de 2xx.
// Só falha TEMPORÁRIA (banco fora) volta 500; o banco ignora o repetido pela
// chave (conexão, tipo, id da Meta), então reenviar é seguro.
//
// LGPD: nada do conteúdo vai para o log. Só contagens.

import { signatureIsValid } from "./metaLeads.mjs";
import { timingSafeEqual } from "node:crypto";

// Um aviso de mensagem é pequeno, mas o de status em lote e o de mídia com
// legenda crescem. Folga sem abrir a porta para corpo arbitrário.
const MAX_BODY_BYTES = 512_000;
const RPC_TIMEOUT_MS = 10_000;
// O teto da função no banco. Um POST da Meta nunca chega perto.
const MAX_EVENTS_PER_CALL = 200;

const PERMANENT_RPC_ERRORS = [/intake token is invalid/i, /events payload is invalid/i, /too many events/i];

export class WhatsappCloudError extends Error {
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

function list(value) {
  return Array.isArray(value) ? value : [];
}

// Um evento por mensagem, eco ou status. `payload` leva o que o adaptador
// precisa para remontar o aviso daquela mensagem sozinha: os metadados do
// número, os contatos (nome do perfil) e o item.
export function eventsFromWebhook(body) {
  const events = [];
  const ignored = {};
  const ignore = (reason) => {
    ignored[reason] = (ignored[reason] || 0) + 1;
  };

  if (body?.object !== "whatsapp_business_account") {
    ignore("object");
    return { events, ignored };
  }

  for (const entry of list(body.entry)) {
    for (const change of list(entry?.changes)) {
      const field = String(change?.field || "");
      const value = change?.value && typeof change.value === "object" ? change.value : {};
      const metadata = value.metadata && typeof value.metadata === "object" ? value.metadata : {};
      const phoneNumberId = String(metadata.phone_number_id || "");
      if (!/^[0-9]{5,25}$/.test(phoneNumberId)) {
        ignore(`${field || "unknown"}-without-number`);
        continue;
      }
      const base = { metadata, contacts: list(value.contacts) };

      if (field === "messages") {
        for (const message of list(value.messages)) {
          const id = String(message?.id || "");
          if (!id) {
            ignore("message-without-id");
            continue;
          }
          events.push({ phoneNumberId, kind: "message", externalId: id, payload: { ...base, message } });
        }
        for (const status of list(value.statuses)) {
          const id = String(status?.id || "");
          const state = String(status?.status || "");
          if (!id || !state) {
            ignore("status-without-id");
            continue;
          }
          // O mesmo wamid passa por sent → delivered → read: cada um é um evento.
          events.push({ phoneNumberId, kind: "status", externalId: `${id}:${state}`, payload: { metadata, status } });
        }
        continue;
      }

      if (field === "smb_message_echoes") {
        for (const echo of list(value.message_echoes)) {
          const id = String(echo?.id || "");
          if (!id) {
            ignore("echo-without-id");
            continue;
          }
          events.push({ phoneNumberId, kind: "echo", externalId: id, payload: { ...base, echo } });
        }
        continue;
      }

      // `history` (o histórico que a coexistência sincroniza na ligação),
      // `smb_app_state_sync` (contatos do app), status de template e da conta:
      // ainda sem tratamento. Contados, não perdidos em silêncio.
      ignore(field || "unknown");
    }
  }
  return { events, ignored };
}

async function readRaw(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new WhatsappCloudError(413, "payload too large", "payload-too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function createWhatsappCloudHandler({
  appSecret = "",
  verifyToken = "",
  intakeToken = "",
  supabaseUrl = "",
  publishableKey = "",
  fetchImpl = globalThis.fetch,
  log = (event, detail) => console.log(`whatsapp-cloud ${event}`, detail),
} = {}) {
  const configured = Boolean(appSecret && verifyToken && intakeToken && supabaseUrl && publishableKey);

  async function deliver(events) {
    const totals = { accepted: 0, duplicates: 0, unknownNumber: 0, invalid: 0 };
    for (let start = 0; start < events.length; start += MAX_EVENTS_PER_CALL) {
      const batch = events.slice(start, start + MAX_EVENTS_PER_CALL);
      let response;
      try {
        response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/nucleo_whatsapp_cloud_receive`, {
          method: "POST",
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${publishableKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ intake_token: intakeToken, events: batch }),
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
      } catch {
        throw new WhatsappCloudError(500, "retry later", "database-unavailable");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = String(payload?.message || "");
        // Token errado não se conserta com reenvio, mas devolver 200 esconderia
        // a configuração quebrada. 500 faz a Meta insistir e o log mostrar.
        if (PERMANENT_RPC_ERRORS.some((pattern) => pattern.test(message))) {
          log("rejected", { reason: message });
        }
        throw new WhatsappCloudError(500, "retry later", "database-unavailable");
      }
      const result = await response.json().catch(() => ({}));
      for (const key of Object.keys(totals)) totals[key] += Number(result?.[key]) || 0;
    }
    return totals;
  }

  return async function whatsappCloud(req, res, url) {
    if (!configured) throw new WhatsappCloudError(503, "whatsapp cloud not configured", "whatsapp-cloud-not-configured");

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token") || "";
      const challenge = url.searchParams.get("hub.challenge") || "";
      if (mode === "subscribe" && safeEqual(token, verifyToken) && /^[\w-]{1,128}$/.test(challenge)) {
        return send(res, 200, challenge, "text/plain; charset=utf-8");
      }
      throw new WhatsappCloudError(403, "verification failed", "verification-failed");
    }

    if (req.method !== "POST") throw new WhatsappCloudError(405, "method not allowed", "method-not-allowed");

    const raw = await readRaw(req);
    if (!signatureIsValid(raw, req.headers["x-hub-signature-256"], appSecret)) {
      throw new WhatsappCloudError(401, "invalid signature", "invalid-signature");
    }
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new WhatsappCloudError(400, "invalid json", "invalid-json");
    }

    const { events, ignored } = eventsFromWebhook(body);
    const totals = events.length ? await deliver(events) : { accepted: 0, duplicates: 0, unknownNumber: 0, invalid: 0 };
    log("received", { events: events.length, ...totals, ignored });
    return send(res, 200, { received: events.length });
  };
}

export function whatsappCloudHandlerFromEnv(env = process.env) {
  const intakeToken = String(env.WHATSAPP_CLOUD_INTAKE_TOKEN || "").trim().toLowerCase();
  if (intakeToken && !/^[0-9a-f]{64}$/.test(intakeToken)) {
    throw new Error("WHATSAPP_CLOUD_INTAKE_TOKEN precisa ter 64 caracteres hexadecimais");
  }
  return createWhatsappCloudHandler({
    appSecret: String(env.META_APP_SECRET || ""),
    verifyToken: String(env.WHATSAPP_CLOUD_VERIFY_TOKEN || ""),
    intakeToken,
    supabaseUrl: String(env.SUPABASE_URL || "").replace(/\/$/, ""),
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || ""),
  });
}
