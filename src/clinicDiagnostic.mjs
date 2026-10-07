// O lead que termina o Raio-X de Crescimento da Clínica (/clinicas/raio-x/).
//
// O quiz manda nome, clínica, WhatsApp e as doze respostas para
// `POST /api/clinic-diagnostic`. Este módulo recalcula o diagnóstico (a nota
// que chega do navegador nunca é usada), reaplica o corte de orçamento e
// entrega à mesma RPC dos leads do site (`nucleo_site_lead_receive`, migration
// 20260915000000), com o token da campanha "Raio-X Clínicas":
//
//  * o contato entra no CRM da Major com a etiqueta da campanha;
//  * a primeira mensagem sai pelo WhatsApp (`site_lead_welcome` na VPS);
//  * a equipe recebe o aviso com a nota, as áreas e o que ficou abaixo.
//
// O token da campanha não é uma variável nova: ele é DERIVADO do token da
// "Planos do Site" (`NUCLEO_LEAD_TOKEN`, que a Hostinger já tem), como
// sha256("raio-x-clinicas:" + sha256(NUCLEO_LEAD_TOKEN)). O banco guarda o
// sha256 do token da Planos, então o SQL de ligação faz a mesma conta sem que
// o segredo apareça em lugar nenhum. Trocar o token da Planos exige rodar de
// novo `criar-campanha-raio-x-clinicas.sql`. `NUCLEO_CLINICAS_LEAD_TOKEN`, se
// existir, vale no lugar do derivado. Sem nenhum dos dois a rota responde 503 e
// nada é gravado. Se `CAMPAIGN_LEADS_TO` existir, as doze respostas também vão
// por e-mail — o aviso do WhatsApp só tem o resumo.

import { createHash } from "node:crypto";
import { normalizarWhatsapp, siteLeadConfig } from "./siteLead.mjs";
import { diagnose, questions } from "../public/clinicas/raio-x/diagnostic.js";

export const CAMPANHA_DO_RAIO_X = "Raio-X Clínicas";

const sha256 = (valor) => createHash("sha256").update(valor, "utf8").digest("hex");

// A mesma conta de `criar-campanha-raio-x-clinicas.sql`.
export function tokenDerivado(tokenDaPlanos) {
  return sha256(`raio-x-clinicas:${sha256(tokenDaPlanos)}`);
}

export function clinicLeadConfig(env = process.env) {
  const proprio = String(env.NUCLEO_CLINICAS_LEAD_TOKEN || "").trim().toLowerCase();
  const daPlanos = siteLeadConfig(env).token;
  const token = /^[0-9a-f]{64}$/.test(proprio) ? proprio : daPlanos ? tokenDerivado(daPlanos) : "";
  const emailTo = String(env.CAMPAIGN_LEADS_TO || "").trim();
  return {
    token,
    emailTo: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTo) ? emailTo : "",
  };
}

// A RPC corta a faixa em 20 caracteres; o `level` do diagnóstico é maior.
function faixa(score) {
  if (score < 34) return "A estruturar";
  if (score < 67) return "Em desenvolvimento";
  if (score < 100) return "Base consistente";
  return "Estruturada";
}

// O aviso escreve "Não passou em: …". Um rótulo por pergunta operacional, na
// ordem de `actions` em diagnostic.js.
const LACUNAS = [
  "entrada além das indicações",
  "anúncios ligados a pacientes",
  "tempo de resposta",
  "retorno a quem parou de responder",
  "retorno pós-avaliação",
  "taxa de fechamento",
  "controle das oportunidades",
  "receita por canal",
];
const ESPECIALIDADE = ["Odontologia", "Estética/plástica", "Clínica médica", "Outra área da saúde"];
const ANUNCIOS = ["sem anúncios", "anúncios < R$1,5 mil", "anúncios R$1,5–5 mil", "anúncios > R$5 mil"];

function texto(valor, limite) {
  return String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, limite);
}

const TRACKING = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"];

export function normalizeClinicLead(body) {
  const dados = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const erros = {};
  const nome = texto(dados.name, 120);
  if (nome.length < 2) erros.name = "Informe seu nome.";
  const clinica = texto(dados.clinic, 160);
  if (clinica.length < 2) erros.clinic = "Informe o nome da clínica.";
  const telefone = normalizarWhatsapp(dados.phone);
  if (!telefone) erros.phone = "Informe um WhatsApp com DDD.";
  if (dados.consent !== true) erros.consent = "Autorize o contato pelo WhatsApp.";
  const tracking = Object.fromEntries(TRACKING.map((key) => [key, texto(dados[key], 200)]));
  return { erros, lead: { nome, clinica, telefone, answers: dados.answers, tracking } };
}

// O que a RPC guarda em `diagnostico` e a VPS mostra no aviso à equipe.
export function resumoParaAEquipe(lead, diagnostic) {
  const answers = lead.answers;
  const lacunas = diagnostic.priorities
    .map((prioridade) => LACUNAS[questions.findIndex((q) => q.options.includes(prioridade.evidence)) - 4])
    .filter(Boolean);
  return {
    notaGeral: diagnostic.score,
    faixa: faixa(diagnostic.score),
    categorias: diagnostic.scores.map((s) => ({ nome: s.name, nota: s.score })),
    falhas: lacunas,
    servico: texto(`${texto(lead.clinica, 24)} · ${ESPECIALIDADE[answers[0]]} · ${ANUNCIOS[answers[1]]}`, 60),
  };
}

function emailDoLead(lead, diagnostic) {
  const whatsapp = `https://wa.me/55${lead.telefone}`;
  return [
    "Novo Raio-X de clínica", "Versão do questionário: 3", "",
    `Nome: ${lead.nome}`, `Clínica: ${lead.clinica}`, `WhatsApp: ${whatsapp}`,
    "Autorização de contato comercial: sim", `Recebido em: ${new Date().toISOString()}`, "",
    `Nota: ${diagnostic.score}/100`, diagnostic.level,
    ...diagnostic.scores.map((s) => `${s.name}: ${s.score}/100`), "",
    "Conclusão:", diagnostic.conclusion, "",
    "Orçamento e decisão:", diagnostic.budget, diagnostic.decision, ...diagnostic.observations, "",
    "Prioridades:", ...diagnostic.priorities.map((p) => `${p.title}: ${p.action}\nResposta que sustenta a prioridade: ${p.evidence}`), "",
    "Respostas:", ...questions.map((q, i) => `${i + 1}. ${q.title}\n${q.context ? `${q.context}\n` : ""}${q.options[lead.answers[i]]}`), "",
    ...TRACKING.map((key) => `${key}: ${lead.tracking[key] || "—"}`),
  ].join("\n");
}

export async function processClinicDiagnostic({ body, config, receive, sendEmail = null, log = () => {} }) {
  if (!config.token) {
    return { status: 503, body: { error: "O diagnóstico ainda não está disponível. Tente novamente mais tarde.", code: "lead-not-configured" } };
  }
  // Ao robô, a mesma resposta de sucesso: recusar ensinaria a ele que existe filtro.
  if (body && typeof body === "object" && texto(body.website, 200)) return { status: 200, body: { received: true } };

  const { erros, lead } = normalizeClinicLead(body);
  if (Object.keys(erros).length) {
    return { status: 400, body: { error: "Confira nome, clínica, WhatsApp com DDD e autorização de contato.", code: "lead-invalid", fields: erros } };
  }
  let diagnostic;
  try {
    diagnostic = diagnose(lead.answers);
  } catch (error) {
    return { status: 400, body: { error: error.message, code: "answers-invalid" } };
  }

  try {
    await receive({
      intake_token: config.token,
      lead: {
        nome: lead.nome,
        telefone: lead.telefone,
        consentimento: true,
        diagnostico: resumoParaAEquipe(lead, diagnostic),
      },
    });
  } catch (error) {
    const mensagem = String(error?.message || "");
    if (/phone number is invalid/.test(mensagem)) {
      return { status: 400, body: { error: "Informe um WhatsApp válido com DDD.", code: "lead-invalid", fields: { phone: "Informe um WhatsApp com DDD." } } };
    }
    if (/limit|too many/i.test(mensagem)) {
      return { status: 429, body: { error: "Recebemos muitos diagnósticos agora. Tente de novo em alguns minutos.", code: "lead-rate-limited" } };
    }
    log(`clinic diagnostic rpc failed: ${mensagem.slice(0, 120)}`);
    return { status: 502, body: { error: "Não foi possível enviar seus dados agora. Tente novamente em instantes.", code: "lead-failed" } };
  }

  // O lead já está no CRM e a equipe já foi avisada; o e-mail é cópia. Falhar
  // aqui não pode tirar do visitante o diagnóstico que ele acabou de liberar.
  if (config.emailTo && sendEmail) {
    try {
      await sendEmail({
        to: config.emailTo,
        subject: `Raio-X de clínica: ${lead.clinica.replace(/[\r\n]/g, " ")}`,
        text: emailDoLead(lead, diagnostic),
      });
    } catch {
      log("clinic diagnostic email copy failed");
    }
  }
  return { status: 200, body: { received: true, diagnostic } };
}
