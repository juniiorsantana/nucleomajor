import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInviteEmail, inviteUrl, normalizeInviteId, normalizeInviteInput } from "./invite.mjs";
import { createMailer, sendInviteEmail } from "./email.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = resolve(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || "0.0.0.0");
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || "https://nucleomajor.com").replace(/\/$/, "");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || "");
const ALLOWED_ORIGINS = new Set(
  String(process.env.CORS_ALLOWED_ORIGINS || PUBLIC_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 8;
const attempts = new Map();

class HttpError extends Error {
  constructor(status, message, code = "portal-error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  securityHeaders(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'");
}

function bearer(req) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Sua sessão não foi encontrada.", "auth-required");
  return match[1];
}

async function readJson(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 32_000) throw new HttpError(413, "A requisição é grande demais.", "payload-too-large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Envie os dados em formato JSON.", "invalid-json");
  }
}

async function supabaseRequest(path, token, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new HttpError(503, "O portal ainda não está conectado ao banco.", "supabase-not-configured");
  }
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
  if (!response.ok) {
    const message = String(payload?.message || payload?.hint || "Operação recusada pelo Supabase");
    if (/already a member/i.test(message)) throw new HttpError(409, "Esta pessoa já participa desta organização.", "already-member");
    if (/organization management required/i.test(message)) throw new HttpError(403, "Você não pode gerenciar esta organização.", "not-manager");
    if (/invite (invalid|not found|was already|was cancelled)/i.test(message)) throw new HttpError(409, "Este convite não está mais disponível.", "invite-closed");
    if (/different email/i.test(message)) throw new HttpError(403, "Esta conta usa outro e-mail. Entre com o e-mail convidado.", "invite-email-mismatch");
    if (/confirmed email/i.test(message)) throw new HttpError(403, "Confirme seu e-mail antes de aceitar o convite.", "email-not-confirmed");
    throw new HttpError(response.status >= 500 ? 502 : response.status, "Não foi possível concluir o convite.", "supabase-operation-failed");
  }
  return payload;
}

async function authenticatedUser(token) {
  const user = await supabaseRequest("/auth/v1/user", token, { method: "GET" });
  if (!user?.id) throw new HttpError(401, "Sua sessão expirou. Entre novamente.", "auth-expired");
  return user;
}

async function organizationName(organizationId, token) {
  const query = `/rest/v1/organizations?select=id,name&id=eq.${encodeURIComponent(organizationId)}&limit=1`;
  const rows = await supabaseRequest(query, token, { method: "GET" });
  return rows?.[0]?.name || "Major";
}

function rowOf(data) {
  return Array.isArray(data) ? data[0] : data;
}

function countAttempt(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) throw new HttpError(429, "Aguarde um minuto antes de tentar novamente.", "rate-limited");
  recent.push(now);
  attempts.set(key, recent);
}

async function markDelivery(token, organizationId, inviteId, delivered, failureReason = null) {
  try {
    await supabaseRequest("/rest/v1/rpc/mark_organization_invite_delivery", token, {
      method: "POST",
      body: JSON.stringify({
        target_organization: organizationId,
        target_invite: inviteId,
        delivered,
        failure_reason: failureReason,
      }),
    });
  } catch {
    // O envio e a operação principal. Se a marcação falhar depois de um e-mail
    // aceito pelo SMTP, não se tenta reenviar automaticamente.
  }
}

async function deliverInvite({ token, organizationId, invite }) {
  try {
    const mailer = createMailer();
    const orgName = await organizationName(organizationId, token);
    const link = inviteUrl({ publicOrigin: PUBLIC_ORIGIN, token: invite.invite_token, email: invite.invited_email });
    const message = buildInviteEmail({
      organizationName: orgName,
      email: invite.invited_email,
      role: invite.invited_role,
      link,
      token: invite.invite_token,
      expiresAt: invite.expires_at,
    });
    await sendInviteEmail({ mailer, email: invite.invited_email, message });
  } catch {
    await markDelivery(token, organizationId, invite.invite_id, false, "smtp delivery failed");
    throw new HttpError(502, "O convite foi criado, mas o e-mail não pôde ser enviado.", "email-delivery-failed");
  }
  await markDelivery(token, organizationId, invite.invite_id, true);
  return {
    inviteId: invite.invite_id,
    email: invite.invited_email,
    role: invite.invited_role,
    expiresAt: invite.expires_at,
    delivery: "sent",
  };
}

async function api(req, res, url) {
  const token = bearer(req);
  const user = await authenticatedUser(token);
  const organizationId = url.searchParams.get("organizationId");
  const match = url.pathname.match(/^\/api\/invitations(?:\/([0-9a-f-]+)\/(resend|cancel))?$/i);

  if (!match) throw new HttpError(404, "Rota não encontrada.", "not-found");
  const inviteId = match[1] ? normalizeInviteId(match[1]) : null;

  if (req.method === "GET") {
    if (!organizationId) throw new HttpError(400, "Informe a organização.", "organization-required");
    const data = await supabaseRequest("/rest/v1/rpc/list_organization_invites", token, {
      method: "POST",
      body: JSON.stringify({ target_organization: organizationId }),
    });
    return json(res, 200, { invitations: data || [] });
  }

  const body = await readJson(req);
  const targetOrganization = String(body.organizationId || organizationId || "").trim();
  if (!targetOrganization) throw new HttpError(400, "Informe a organização.", "organization-required");
  countAttempt(`${user.id}:${targetOrganization}:${req.method}:${inviteId || body.email || ""}`);

  if (req.method === "POST" && !inviteId) {
    const input = normalizeInviteInput({ ...body, organizationId: targetOrganization });
    const data = await supabaseRequest("/rest/v1/rpc/create_organization_invite", token, {
      method: "POST",
      body: JSON.stringify({
        target_organization: input.organizationId,
        target_email: input.email,
        target_role: input.role,
      }),
    });
    return json(res, 200, await deliverInvite({ token, organizationId: input.organizationId, invite: rowOf(data) }));
  }

  if (req.method === "POST" && inviteId && url.pathname.endsWith("/resend")) {
    const data = await supabaseRequest("/rest/v1/rpc/resend_organization_invite", token, {
      method: "POST",
      body: JSON.stringify({ target_organization: targetOrganization, target_invite: inviteId }),
    });
    return json(res, 200, await deliverInvite({ token, organizationId: targetOrganization, invite: rowOf(data) }));
  }

  if (req.method === "POST" && inviteId && match[2] === "cancel") {
    await supabaseRequest("/rest/v1/rpc/revoke_organization_invite", token, {
      method: "POST",
      body: JSON.stringify({ target_organization: targetOrganization, target_invite: inviteId }),
    });
    return json(res, 200, { cancelled: true, inviteId });
  }

  throw new HttpError(405, "Método não permitido.", "method-not-allowed");
}

const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

async function staticFile(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const relative = pathname === "/" || pathname === "/convite" ? "index.html" : pathname.replace(/^\//, "");
  const filePath = resolve(PUBLIC_DIR, relative);
  const publicPrefix = `${PUBLIC_DIR}${process.platform === "win32" ? "\\" : "/"}`;
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(publicPrefix)) throw new HttpError(404, "Página não encontrada.", "not-found");
  try {
    const data = await readFile(filePath);
    securityHeaders(res);
    res.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    throw new HttpError(404, "Página não encontrada.", "not-found");
  }
}

export function createServer({ apiHandler = api } = {}) {
  return http.createServer(async (req, res) => {
    applyCors(req, res);
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "OPTIONS") return res.writeHead(204).end();
      if (url.pathname === "/api/config" && req.method === "GET") {
        return json(res, 200, { supabaseUrl: SUPABASE_URL, supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY, publicOrigin: PUBLIC_ORIGIN });
      }
      if (url.pathname.startsWith("/api/")) return await apiHandler(req, res, url);
      return await staticFile(req, res, url);
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500 && status !== 502) console.error("portal request failed", error?.code || "unknown");
      json(res, status, { error: error?.message || "Não foi possível concluir a operação.", code: error?.code || "portal-error" });
    }
  });
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Núcleo Major portal listening on ${HOST}:${PORT}`);
  });
}
