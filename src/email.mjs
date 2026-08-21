import nodemailer from "nodemailer";

export function mailConfig(env = process.env) {
  const port = Number(env.SMTP_PORT || 465);
  return {
    host: String(env.SMTP_HOST || "").trim(),
    port,
    secure: String(env.SMTP_SECURE || (port === 465 ? "true" : "false")) === "true",
    user: String(env.SMTP_USER || "").trim(),
    password: String(env.SMTP_PASSWORD || ""),
    fromName: String(env.SMTP_FROM_NAME || "Assistente Major").trim(),
    fromEmail: String(env.SMTP_FROM_EMAIL || env.SMTP_USER || "").trim(),
  };
}

export function createMailer(env = process.env) {
  const config = mailConfig(env);
  if (!config.host || !config.user || !config.password || !config.fromEmail) {
    throw new Error("SMTP do portal não está configurado.");
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  return { transport, config };
}

export async function sendInviteEmail({ mailer, email, message }) {
  if (!mailer?.transport || !mailer?.config) throw new Error("Mailer indisponível.");
  return mailer.transport.sendMail({
    from: `${mailer.config.fromName} <${mailer.config.fromEmail}>`,
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
