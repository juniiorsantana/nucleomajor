const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const INVITE_ROLES = new Set(["member", "admin"]);

export function normalizeInviteInput(input = {}) {
  const organizationId = String(input.organizationId || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const role = String(input.role || "member").trim();

  if (!UUID_PATTERN.test(organizationId)) {
    throw new Error("Organização inválida.");
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw new Error("Informe um e-mail válido.");
  }
  if (!INVITE_ROLES.has(role)) {
    throw new Error("Papel de convite inválido.");
  }
  return { organizationId, email, role };
}

export function normalizeInviteId(value) {
  const id = String(value || "").trim();
  if (!UUID_PATTERN.test(id)) throw new Error("Convite inválido.");
  return id;
}

export function inviteUrl({ publicOrigin, token, email }) {
  const origin = String(publicOrigin || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(origin)) throw new Error("PUBLIC_ORIGIN precisa usar HTTPS.");
  if (!/^[0-9a-f]{64}$/.test(String(token || ""))) throw new Error("Token de convite inválido.");
  const url = new URL(`${origin}/convite`);
  url.searchParams.set("token", token);
  if (email) url.searchParams.set("email", String(email).trim().toLowerCase());
  return url.toString();
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

export function roleLabel(role) {
  return role === "admin" ? "administrador" : "atendente";
}

export function buildInviteEmail({ organizationName = "Major", email, role, link, token, expiresAt }) {
  const safeOrg = escapeHtml(organizationName);
  const safeSubjectOrg = String(organizationName).replace(/[\r\n]+/g, " ").trim() || "Major";
  const safeEmail = escapeHtml(email);
  const safeRole = escapeHtml(roleLabel(role));
  const safeLink = escapeHtml(link);
  const safeToken = escapeHtml(token);
  const expiry = new Date(expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return {
    subject: `Convite para ${safeSubjectOrg} no Núcleo Major`,
    text: [
      `Você foi convidado para fazer parte da organização ${organizationName} no Núcleo Major.`,
      "",
      `Aceite pelo link: ${link}`,
      "",
      `Código reserva: ${token}`,
      `Este convite expira em ${expiry}.`,
      "",
      "Se você não esperava este convite, ignore esta mensagem.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f5f6f8;color:#121730;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;padding:24px">
    <div style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4f3cfc">Núcleo Major</div>
    <div style="margin-top:14px;padding:32px;background:#fff;border:1px solid #e6e9ed;border-radius:12px">
      <p style="margin:0;color:#667085;font-size:13px">Convite para sua equipe</p>
      <h1 style="margin:10px 0 14px;font-size:28px;line-height:1.15;color:#121730">Entre na organização ${safeOrg}</h1>
      <p style="font-size:15px;line-height:1.6;color:#667085">O endereço <strong style="color:#121730">${safeEmail}</strong> foi convidado para entrar como ${safeRole} no Núcleo Major.</p>
      <p style="margin:24px 0"><a href="${safeLink}" style="display:inline-block;padding:13px 18px;background:#4f3cfc;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Aceitar convite</a></p>
      <div style="padding:14px;background:#f5f6f8;border-radius:8px;color:#667085;font-size:13px;line-height:1.5">Se o botão não abrir, use o código reserva:<br><strong style="display:block;margin-top:7px;color:#121730;letter-spacing:.08em;word-break:break-all">${safeToken}</strong></div>
      <p style="margin:18px 0 0;color:#98a2b3;font-size:12px">Este convite expira em ${expiry} e só pode ser usado uma vez.</p>
    </div>
  </div>
</body></html>`,
  };
}
