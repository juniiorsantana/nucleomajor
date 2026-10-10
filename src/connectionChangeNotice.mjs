import { escapeHtml } from "./invite.mjs";

/**
 * O aviso de segurança da troca de WhatsApp (migration 20261012100000).
 *
 * Aplicada uma troca ou desconexão, os donos e administradores da empresa
 * recebem um e-mail. Quem envia é este servidor, e não o navegador de quem
 * trocou: quem fizesse uma troca indevida não teria como calar o aviso. O
 * banco entrega os avisos pendentes a quem tem o token
 * (CONNECTION_CHANGE_NOTICE_TOKEN), e só com os finais do número: nunca o
 * telefone inteiro, nunca hash.
 */

const FUSO = "America/Sao_Paulo";
const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;
const TOKEN = /^[0-9a-f]{64}$/;

function quando(instante) {
  const data = new Date(instante || "");
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
}

const final = (valor) => (/^[0-9]{4}$/.test(String(valor || "")) ? String(valor) : "????");
const umaLinha = (valor, max) => String(valor || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

export function buildConnectionChangeNotice({
  organizationName,
  kind,
  oldLast4,
  newLast4,
  appliedAt,
  requesterEmail,
  remoteLogout = null,
} = {}) {
  const empresa = umaLinha(organizationName, 80) || "sua empresa";
  const autor = umaLinha(requesterEmail, 200) || "um administrador";
  const hora = quando(appliedAt);
  const troca = kind === "change_number";
  const linhas = troca
    ? [
        `O WhatsApp de ${empresa} no Núcleo Major foi trocado do número final ${final(oldLast4)} para o número final ${final(newLast4)}${hora ? `, em ${hora}` : ""}.`,
        `Quem pediu: ${autor}.`,
        "",
        "As conversas, os contatos e o funil continuam no portal. Mensagens enviadas para o número antigo não chegam mais ao portal.",
      ]
    : [
        `O WhatsApp final ${final(oldLast4)} de ${empresa} foi desconectado do Núcleo Major${hora ? ` em ${hora}` : ""}.`,
        `Quem pediu: ${autor}.`,
        "",
        "As conversas, os contatos e o funil continuam no portal. Até um número ser conectado de novo, nada sai por esta conexão.",
      ];
  if (remoteLogout === false) {
    linhas.push(
      "",
      `O WhatsApp não confirmou o desligamento. No celular do número final ${final(oldLast4)}, abra Aparelhos conectados e remova o aparelho do Núcleo Major se ele ainda aparecer.`,
    );
  }
  linhas.push(
    "",
    "Se ninguém da sua equipe pediu isso, fale com o Núcleo Major agora e troque a senha de quem aparece acima.",
    "",
    "Você recebe este e-mail por ser dono ou administrador desta empresa no Núcleo Major.",
  );
  const text = linhas.join("\n");
  return {
    subject: troca ? `O WhatsApp de ${empresa} foi trocado` : `O WhatsApp de ${empresa} foi desconectado`,
    text,
    html: `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#121730"><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre></body></html>`,
  };
}

const motivo = (erro) => umaLinha(erro?.message || erro, 120).replace(/[^\s@]+@[^\s@]+/g, "<e-mail>");

/**
 * Uma volta: pega os avisos pendentes, manda um e-mail por destinatário (um
 * administrador não vê o endereço dos outros) e registra o desfecho no banco.
 * Nunca lança: a falha de um aviso não segura os outros, e o log não leva
 * endereço de ninguém.
 */
export async function deliverConnectionChangeNotices({
  claim,
  send,
  done,
  log = () => {},
  build = buildConnectionChangeNotice,
}) {
  let notices;
  try {
    const resposta = await claim();
    notices = Array.isArray(resposta?.notices) ? resposta.notices : [];
  } catch (erro) {
    log(`connection change notices: claim failed (${motivo(erro)})`);
    return { notices: 0, delivered: 0, failed: 0 };
  }

  let entreguesNaVolta = 0;
  let falhasNaVolta = 0;
  for (const notice of notices) {
    const destinatarios = [...new Set(
      (Array.isArray(notice?.recipients) ? notice.recipients : [])
        .map((email) => String(email || "").trim().toLowerCase())
        .filter((email) => EMAIL.test(email)),
    )];
    let message = null;
    try {
      message = build(notice);
    } catch (erro) {
      log(`connection change notices: could not build ${notice?.requestId} (${motivo(erro)})`);
    }
    let entregues = 0;
    let falhas = 0;
    if (message) {
      for (const to of destinatarios) {
        try {
          await send({ to, message });
          entregues += 1;
        } catch {
          falhas += 1;
        }
      }
    } else {
      falhas = Math.max(destinatarios.length, 1);
    }
    try {
      await done(notice?.requestId, entregues, falhas);
    } catch (erro) {
      log(`connection change notices: could not record ${notice?.requestId} (${motivo(erro)})`);
    }
    entreguesNaVolta += entregues;
    falhasNaVolta += falhas;
  }
  if (notices.length) {
    log(`connection change notices: ${notices.length} aviso(s), ${entreguesNaVolta} entregue(s), ${falhasNaVolta} falha(s)`);
  }
  return { notices: notices.length, delivered: entreguesNaVolta, failed: falhasNaVolta };
}

/**
 * Liga a volta periódica, só com um token válido. Sem ele, não faz nada: os
 * avisos ficam pendentes no banco até alguém configurar o envio.
 */
export function startConnectionChangeNotices({
  token,
  deps,
  intervalMs = 60_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const limpo = String(token || "").trim().toLowerCase();
  if (!TOKEN.test(limpo) || typeof deps !== "function") return null;
  let rodando = false;
  const volta = async () => {
    if (rodando) return null;
    rodando = true;
    try {
      return await deliverConnectionChangeNotices(deps(limpo));
    } finally {
      rodando = false;
    }
  };
  const timer = setIntervalFn(volta, intervalMs);
  timer?.unref?.();
  return { tick: volta, stop: () => clearIntervalFn(timer) };
}
