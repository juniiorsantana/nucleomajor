// O lead que clica num plano da página de vendas.
//
// O popup da landing manda nome, WhatsApp, e-mail e o plano escolhido para
// `POST /api/lead`. Este módulo confere o que chegou e entrega à mesma RPC que
// recebe o lead do site da Major (`nucleo_site_lead_receive`, migration
// 20260915000000): ela grava o contato, cria o contexto da conversa já dentro
// da campanha e enfileira a primeira mensagem do agente no WhatsApp.
//
// O token da campanha fica só no servidor (`NUCLEO_LEAD_TOKEN`). Sem ele a rota
// responde 503 e nada é gravado: é assim que ela fica desligada até a campanha
// existir.

// Os planos que o popup pode mandar. Qualquer outro valor vira recusa, e o
// texto que segue para a RPC é sempre o daqui, nunca o que chegou.
export const PLANOS_DO_SITE = Object.freeze({
  base: "Plano Base",
  atendimento: "Plano Atendimento com IA",
  completo: "Plano Completo",
  empresarial: "Plano Empresarial",
  // O formulário de contato do fim da página, para quem ainda não escolheu.
  indefinido: "Contato do site",
});

export function siteLeadConfig(env = process.env) {
  const token = String(env.NUCLEO_LEAD_TOKEN || "").trim().toLowerCase();
  return { token: /^[0-9a-f]{64}$/.test(token) ? token : "" };
}

function texto(valor, limite) {
  return String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, limite);
}

// A mesma régua da RPC: DDD de 11 a 99 e celular de onze dígitos começando
// com 9. Conferir aqui devolve a mensagem certa ao visitante em vez de um erro
// genérico vindo do banco.
export function normalizarWhatsapp(valor) {
  let digitos = String(valor ?? "").replace(/\D/g, "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length !== 10 && digitos.length !== 11) return "";
  if (digitos.slice(0, 2) < "11") return "";
  if (digitos.length === 11 && digitos[2] !== "9") return "";
  return digitos;
}

export function normalizeSiteLead(body) {
  const erros = {};
  const dados = body && typeof body === "object" && !Array.isArray(body) ? body : {};

  const nome = texto(dados.nome, 120);
  if (!nome) erros.nome = "Informe seu nome.";

  const telefone = normalizarWhatsapp(dados.whatsapp);
  if (!telefone) erros.whatsapp = "Informe um WhatsApp com DDD.";

  let email = texto(dados.email, 160).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.email = "Confira o e-mail.";
  if (!email) email = null;

  const plano = Object.hasOwn(PLANOS_DO_SITE, dados.plano) ? dados.plano : "";
  if (!plano) erros.plano = "Escolha um plano.";

  const empresa = texto(dados.empresa, 80);

  // Consentimento só é `true` de verdade. Sem ele não há como chamar pelo
  // WhatsApp, e o formulário não deixa enviar.
  if (dados.consentimento !== true) erros.consentimento = "Autorize o contato pelo WhatsApp.";

  return { erros, lead: { nome, telefone, email, plano, empresa } };
}

// O campo escondido do formulário. Gente não preenche; robô preenche tudo.
export function isBot(body) {
  return Boolean(body && typeof body === "object" && texto(body.site_da_empresa, 200));
}

export async function processSiteLead({ body, config, receive }) {
  if (!config.token) {
    return { status: 503, body: { error: "O contato pelo site ainda não está disponível.", code: "lead-not-configured" } };
  }
  // Ao robô, a mesma resposta de sucesso: recusar ensinaria a ele que existe filtro.
  if (isBot(body)) return { status: 200, body: { ok: true } };

  const { erros, lead } = normalizeSiteLead(body);
  if (Object.keys(erros).length) {
    return { status: 400, body: { error: "Confira os campos destacados.", code: "lead-invalid", fields: erros } };
  }

  const servico = PLANOS_DO_SITE[lead.plano];
  try {
    await receive({
      intake_token: config.token,
      lead: {
        nome: lead.nome,
        telefone: lead.telefone,
        email: lead.email,
        consentimento: true,
        // A RPC nasceu para o diagnóstico do site da Major e guarda o assunto
        // em `diagnostico.servico`; é esse campo que chega no aviso à equipe.
        diagnostico: { servico: lead.empresa ? texto(`${servico} · ${lead.empresa}`, 60) : servico },
      },
    });
  } catch (error) {
    const mensagem = String(error?.message || "");
    if (/phone number is invalid/.test(mensagem)) {
      return { status: 400, body: { error: "Confira os campos destacados.", code: "lead-invalid", fields: { whatsapp: "Informe um WhatsApp com DDD." } } };
    }
    if (/limit|too many/i.test(mensagem)) {
      return { status: 429, body: { error: "Recebemos muitos contatos agora. Tente de novo em alguns minutos.", code: "lead-rate-limited" } };
    }
    return { status: 502, body: { error: "Não foi possível enviar agora. Tente de novo em instantes.", code: "lead-failed" } };
  }
  return { status: 200, body: { ok: true } };
}
