// O pedido de orçamento do link na bio do Juniior (/juniiorsantana7/).
//
// O modal "Solicitar orçamento" manda nome, e-mail e WhatsApp para
// `POST /api/orcamento`. Este módulo confere o que chegou e entrega à mesma
// RPC dos outros formulários do site (`nucleo_site_lead_receive`, migration
// 20260915000000), com o token da campanha "Orçamento pelo link na bio":
//
//  * o contato entra no CRM da Major com a etiqueta da campanha;
//  * a primeira mensagem sai pelo WhatsApp (`site_lead_welcome` na VPS);
//  * a equipe recebe o aviso no WhatsApp.
//
// Como no Raio-X das clínicas, o token não é uma variável nova: é DERIVADO do
// token da "Planos do Site" (`NUCLEO_LEAD_TOKEN`, que a Hostinger já tem), como
// sha256("orcamento-link-na-bio:" + sha256(NUCLEO_LEAD_TOKEN)). O banco guarda o
// sha256 do token da Planos, então `criar-campanha-orcamento-link-na-bio.sql`
// faz a mesma conta sem que o segredo apareça. `NUCLEO_ORCAMENTO_LEAD_TOKEN`, se
// existir, vale no lugar do derivado. Sem nenhum dos dois a rota responde 503 e
// nada é gravado.

import { createHash } from "node:crypto";
import { isBot, normalizarWhatsapp, siteLeadConfig } from "./siteLead.mjs";

// O contato entra no CRM com a origem "Site · " + o nome da campanha.
export const CAMPANHA_DO_ORCAMENTO = "Orçamento pelo link na bio";

// O assunto que chega no aviso à equipe (a RPC guarda em `diagnostico.servico`).
export const SERVICO_DO_ORCAMENTO = "Orçamento · link na bio";

const sha256 = (valor) => createHash("sha256").update(valor, "utf8").digest("hex");

// A mesma conta de `criar-campanha-orcamento-link-na-bio.sql`.
export function tokenDoOrcamento(tokenDaPlanos) {
  return sha256(`orcamento-link-na-bio:${sha256(tokenDaPlanos)}`);
}

export function orcamentoLeadConfig(env = process.env) {
  const proprio = String(env.NUCLEO_ORCAMENTO_LEAD_TOKEN || "").trim().toLowerCase();
  const daPlanos = siteLeadConfig(env).token;
  return { token: /^[0-9a-f]{64}$/.test(proprio) ? proprio : daPlanos ? tokenDoOrcamento(daPlanos) : "" };
}

function texto(valor, limite) {
  return String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, limite);
}

// Os três dados do modal são obrigatórios: o WhatsApp é por onde a primeira
// mensagem sai, e o e-mail foi pedido para a proposta.
export function normalizeOrcamento(body) {
  const dados = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const erros = {};

  const nome = texto(dados.nome, 120);
  if (nome.length < 2) erros.nome = "Informe seu nome.";

  const email = texto(dados.email, 160).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.email = "Informe um e-mail válido.";

  const telefone = normalizarWhatsapp(dados.whatsapp);
  if (!telefone) erros.whatsapp = "Informe um WhatsApp com DDD.";

  // Consentimento só é `true` de verdade. Sem ele não há como chamar pelo WhatsApp.
  if (dados.consentimento !== true) erros.consentimento = "Autorize o contato pelo WhatsApp.";

  return { erros, lead: { nome, email, telefone } };
}

export async function processOrcamento({ body, config, receive, log = () => {} }) {
  if (!config.token) {
    return { status: 503, body: { error: "O pedido de orçamento ainda não está disponível. Tente de novo mais tarde.", code: "lead-not-configured" } };
  }
  // Ao robô, a mesma resposta de sucesso: recusar ensinaria a ele que existe filtro.
  if (isBot(body)) return { status: 200, body: { ok: true } };

  const { erros, lead } = normalizeOrcamento(body);
  if (Object.keys(erros).length) {
    return { status: 400, body: { error: "Confira os campos destacados.", code: "lead-invalid", fields: erros } };
  }

  try {
    await receive({
      intake_token: config.token,
      lead: {
        nome: lead.nome,
        telefone: lead.telefone,
        email: lead.email,
        consentimento: true,
        diagnostico: { servico: SERVICO_DO_ORCAMENTO },
      },
    });
  } catch (error) {
    const mensagem = String(error?.message || "");
    if (/phone number is invalid/.test(mensagem)) {
      return { status: 400, body: { error: "Confira os campos destacados.", code: "lead-invalid", fields: { whatsapp: "Informe um WhatsApp com DDD." } } };
    }
    if (/limit|too many/i.test(mensagem)) {
      return { status: 429, body: { error: "Recebemos muitos pedidos agora. Tente de novo em alguns minutos.", code: "lead-rate-limited" } };
    }
    log(`orcamento rpc failed: ${mensagem.slice(0, 120)}`);
    return { status: 502, body: { error: "Não foi possível enviar agora. Tente de novo em instantes.", code: "lead-failed" } };
  }
  return { status: 200, body: { ok: true } };
}
