import { escapeHtml } from "./invite.mjs";

const CODE_PATTERN = /^NM[0-9A-F]{2}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{2}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const PLAN_LABELS = { base: "Base", full: "Full" };

export function normalizeActivationCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^NM[0-9A-F]{12}$/.test(compact)) throw new Error("Código de ativação inválido.");
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 14)}`;
}

// O caminho fica debaixo de /app porque a lista de redirects do Supabase Auth
// libera `/app/**`: o mesmo link serve de retorno da confirmação de e-mail.
export function activationUrl({ publicOrigin, code, email }) {
  const origin = String(publicOrigin || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(origin)) throw new Error("PUBLIC_ORIGIN precisa usar HTTPS.");
  const codigo = normalizeActivationCode(code);
  const url = new URL(`${origin}/app/ativar`);
  url.searchParams.set("codigo", codigo);
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (normalizedEmail) {
    if (!EMAIL_PATTERN.test(normalizedEmail)) throw new Error("E-mail inválido.");
    url.searchParams.set("email", normalizedEmail);
  }
  return url.toString();
}

export function buildActivationEmail({ email, code, link, planCode = "base", expiresAt }) {
  const codigo = normalizeActivationCode(code);
  if (!CODE_PATTERN.test(codigo)) throw new Error("Código de ativação inválido.");
  const plano = PLAN_LABELS[planCode] || "contratado";
  const expiry = new Date(expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const safeEmail = escapeHtml(email);
  const safeLink = escapeHtml(link);
  const safeCode = escapeHtml(codigo);
  const safePlan = escapeHtml(plano);

  return {
    subject: "Seu acesso ao Núcleo Major está liberado",
    text: [
      `Pagamento confirmado. O plano ${plano} do Núcleo Major está liberado para ${email}.`,
      "",
      `Ative sua empresa pelo link: ${link}`,
      "",
      "Crie sua conta com este mesmo e-mail. Se o link não abrir, entre em",
      "https://nucleomajor.com/app, crie a conta e use o código de ativação:",
      codigo,
      "",
      `O código vale até ${expiry} e só pode ser usado uma vez.`,
      "Se você não fez esta compra, ignore esta mensagem.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f5f6f8;color:#121730;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;padding:24px">
    <div style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4f3cfc">Núcleo Major</div>
    <div style="margin-top:14px;padding:32px;background:#fff;border:1px solid #e6e9ed;border-radius:12px">
      <p style="margin:0;color:#667085;font-size:13px">Pagamento confirmado</p>
      <h1 style="margin:10px 0 14px;font-size:28px;line-height:1.15;color:#121730">Seu plano ${safePlan} está liberado</h1>
      <p style="font-size:15px;line-height:1.6;color:#667085">Crie sua conta com o e-mail <strong style="color:#121730">${safeEmail}</strong> e ative sua empresa. Depois é só conectar o WhatsApp e começar.</p>
      <p style="margin:24px 0"><a href="${safeLink}" style="display:inline-block;padding:13px 18px;background:#4f3cfc;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Ativar minha empresa</a></p>
      <div style="padding:14px;background:#f5f6f8;border-radius:8px;color:#667085;font-size:13px;line-height:1.5">Se o botão não abrir, entre em nucleomajor.com/app, crie a conta e use o código de ativação:<br><strong style="display:block;margin-top:7px;color:#121730;letter-spacing:.08em">${safeCode}</strong></div>
      <p style="margin:18px 0 0;color:#98a2b3;font-size:12px">O código vale até ${expiry} e só pode ser usado uma vez. Se você não fez esta compra, ignore esta mensagem.</p>
    </div>
  </div>
</body></html>`,
  };
}

// Aviso curto para a equipe da Major. Sem o código: quem ativa é o cliente.
export function buildSaleNoticeEmail({ email, planCode = "base", subscriptionResult = "activation_issued" }) {
  const plano = PLAN_LABELS[planCode] || planCode;
  const text = [
    `Nova venda do Núcleo: plano ${plano}.`,
    `Cliente: ${email}`,
    `Situação: ${subscriptionResult === "activation_issued" ? "e-mail de ativação enviado" : subscriptionResult}.`,
    "",
    "Acompanhe em Configurações → Administração do Núcleo Major.",
  ].join("\n");
  return {
    subject: `Nova venda do Núcleo (${plano})`,
    text,
    html: `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#121730"><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre></body></html>`,
  };
}
