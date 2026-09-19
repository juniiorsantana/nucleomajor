import { escapeHtml } from "./invite.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeConnectionRequest(input = {}) {
  const organizationId = String(input.organizationId || "").trim();
  if (!UUID_PATTERN.test(organizationId)) throw new Error("Organização inválida.");
  const phone = String(input.phone || "").replace(/[^0-9]/g, "");
  if (phone.length < 10 || phone.length > 15) throw new Error("Informe o número do WhatsApp com DDD.");
  const name = String(input.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { organizationId, phone, name };
}

// O comando que a equipe roda na VPS (repositório whatsapp-mcp-hardened).
// Sem o telefone, o script pergunta — e confere com o hash do pedido.
export function provisionCommand({ organizationId, connectionId, planCode, phone = "" }) {
  if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(connectionId)) throw new Error("Identificador inválido.");
  const plano = planCode === "full" ? "full" : "base";
  const digitos = String(phone || "").replace(/[^0-9]/g, "");
  const telefone = digitos.length >= 10 && digitos.length <= 15 ? ` --telefone ${digitos}` : "";
  return `bash scripts/vps/provision-connection.sh ${organizationId} ${connectionId} --plano ${plano}${telefone}`;
}

export function buildConnectionRequestNotice({ organizationName, organizationId, connectionId, last4, planCode, requesterEmail, phone = "" }) {
  const comando = provisionCommand({ organizationId, connectionId, planCode, phone });
  const text = [
    `${organizationName} pediu a conexão do WhatsApp (número final ${last4 || "????"}, plano ${planCode || "?"}).`,
    `Quem pediu: ${requesterEmail || "?"}`,
    "",
    "Na VPS, como o usuário nucleo, dentro da release ativa do runtime:",
    comando,
    "",
    "Quando o heartbeat chegar, o QR aparece no portal do cliente sozinho.",
    "Os pedidos pendentes também estão em Configurações → Administração do Núcleo Major.",
  ].join("\n");
  return {
    subject: `Pedido de WhatsApp: ${String(organizationName || "").replace(/[\r\n]+/g, " ").slice(0, 80)}`,
    text,
    html: `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#121730"><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre></body></html>`,
  };
}
