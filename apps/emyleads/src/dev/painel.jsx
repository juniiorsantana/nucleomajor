/**
 * Bancada do painel da plataforma — as telas de painel.nucleomajor.com sem
 * banco nenhum. O transporte é falso e guarda tudo em memória: ligar uma
 * função, estender, encerrar e trocar plano mudam a empresa e escrevem no
 * histórico, como as funções `platform_*` fazem de verdade.
 *
 * `?restrito=1` abre como quem não é da administração; `?sair=1`, sem sessão.
 */

import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../ui/theme.css";
import PainelApp from "../painel/PainelApp";

const parametros = new URLSearchParams(window.location.search);
const DIA = 86_400_000;
const agora = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const CATALOGO = [
  ["crm", "feature", "Contatos, funil e tarefas", "Telas de Contatos, Funil e Tarefas.", false],
  ["agenda", "feature", "Agenda", "Agenda e compromissos.", false],
  ["team_management", "feature", "Equipe", "Convidar pessoas e definir papéis.", false],
  ["whatsapp_web", "feature", "WhatsApp no portal", "Conversas e Conexões.", false],
  ["chatbots", "feature", "Chatbots", "Fluxos automáticos de atendimento.", false],
  ["knowledge", "feature", "Base de conhecimento", "O que a IA consulta para responder.", true],
  ["ai_customer", "feature", "IA atendendo clientes", "Exige WhatsApp próprio e a conexão montada na VPS.", true],
  ["ai_team", "feature", "Assistente da equipe", "A equipe conversa com o assistente.", true],
  ["whatsapp_official", "feature", "API oficial do WhatsApp", "Reservado.", false],
  ["connections", "limit", "Números de WhatsApp", "Hoje: 0 ou 1.", false],
].map(([key, kind, name, description, isAi]) => ({ key, kind, name, description, isAi }));

const BASE = { crm: true, agenda: true, team_management: true, whatsapp_web: true, chatbots: false, knowledge: false, ai_customer: false, ai_team: false, whatsapp_official: false };
const PLANOS = {
  base: { nome: "Base", recursos: BASE },
  atendimento: { nome: "Atendimento com IA", recursos: { ...BASE, chatbots: true, knowledge: true, ai_customer: true } },
  completo: { nome: "Completo", recursos: { ...BASE, chatbots: true, knowledge: true, ai_customer: true, ai_team: true } },
  full: { nome: "Full", recursos: { ...BASE, chatbots: true, knowledge: true, ai_customer: true, ai_team: true, whatsapp_official: true } },
};

const empresas = [
  { id: "major", nome: "Major", dono: "major@exemplo.invalido", plano: "full", status: "active", origem: "migration", fimDoPeriodo: null, membros: 4, contatos: 1830, whatsappEmUso: 1, ultimoSinal: iso(agora - 60_000), ultimoAcessoDono: iso(agora - 3_600_000) },
  { id: "adriane", nome: "Clínica Adriane", dono: "adriane@exemplo.invalido", plano: "base", status: "canceled", origem: "manual", fimDoPeriodo: iso(agora + 88 * DIA), membros: 2, contatos: 214, whatsappEmUso: 1, ultimoSinal: null, ultimoAcessoDono: iso(agora - 2 * DIA) },
  { id: "estudio", nome: "Estúdio Norte", dono: "norte@exemplo.invalido", plano: "atendimento", status: "canceled", origem: "manual", fimDoPeriodo: iso(agora + 4 * DIA), membros: 1, contatos: 57, whatsappEmUso: 0, ultimoSinal: null, ultimoAcessoDono: null },
  { id: "loja", nome: "Loja Vale", dono: "vale@exemplo.invalido", plano: "completo", status: "active", origem: "payment", fimDoPeriodo: iso(agora + 20 * DIA), membros: 3, contatos: 402, whatsappEmUso: 1, ultimoSinal: iso(agora - 120_000), ultimoAcessoDono: iso(agora - DIA) },
].map((empresa) => ({ ...empresa, criadaEm: iso(agora - 40 * DIA), ajustes: {}, estado: "ok" }));

const historico = [];
let proximoId = 1;

const estadoDe = (empresa) => {
  if (empresa.status === "canceled" && (!empresa.fimDoPeriodo || Date.parse(empresa.fimDoPeriodo) <= Date.now())) return "blocked";
  return "ok";
};
const valendo = (ajuste) => ajuste && (!ajuste.expiresAt || Date.parse(ajuste.expiresAt) > Date.now());
const linhaDa = (empresa) => ({
  ...empresa,
  nomePlano: PLANOS[empresa.plano].nome,
  estado: estadoDe(empresa),
  whatsappLimite: valendo(empresa.ajustes.connections) ? empresa.ajustes.connections.limitValue : 1,
  ajustes: Object.values(empresa.ajustes).filter(valendo).length,
});
const achar = (id) => {
  const empresa = empresas.find((item) => item.id === id);
  if (!empresa) throw new Error("Empresa não encontrada.");
  return empresa;
};
const registrar = (empresa, acao, alvo, antes, depois, nota) => {
  historico.unshift({ id: proximoId++, em: iso(Date.now()), autor: "cmo@majorhub.com.br", empresaId: empresa.id, empresa: empresa.nome, acao, alvo, antes, depois, nota: nota || "" });
};
const assinatura = (empresa) => ({ plan_code: empresa.plano, status: empresa.status, current_period_ends_at: empresa.fimDoPeriodo, state: estadoDe(empresa) });
const resposta = (empresa) => ({ subscription: assinatura(empresa), billingInAsaas: empresa.origem === "payment" });

const OPERACOES = {
  "auth.estado": () => (parametros.has("sair") ? null : { usuario: { email: parametros.has("restrito") ? "cliente@exemplo.invalido" : "cmo@majorhub.com.br" } }),
  "auth.entrar": () => ({}),
  "auth.sair": () => ({ ok: true }),
  "plataforma.estado": () => ({ administrador: !parametros.has("restrito") }),
  "plataforma.empresas": () => empresas.map(linhaDa),
  "plataforma.empresa": ({ id }) => {
    const empresa = achar(id);
    const plano = PLANOS[empresa.plano].recursos;
    return {
      empresa: linhaDa(empresa),
      funcoes: CATALOGO.map((item) => {
        const ajuste = empresa.ajustes[item.key] || null;
        const doPlano = item.kind === "limit" ? 1 : plano[item.key];
        const resultado = valendo(ajuste) ? (item.kind === "limit" ? ajuste.limitValue : ajuste.enabled) : doPlano;
        return { ...item, plan: doPlano, adjustment: ajuste && { ...ajuste, active: valendo(ajuste) }, result: resultado };
      }),
      uso: { contacts: empresa.contatos, deals: 12, conversations30d: 31, messages30d: 488 },
      pessoas: [{ email: empresa.dono, role: "owner", status: "active" }],
      conexoes: empresa.whatsappEmUso ? [{ id: "c1", name: "WhatsApp principal", last4: "8164", status: "connected", heartbeatAt: empresa.ultimoSinal }] : [],
      vendas: empresa.origem === "payment" ? [{ id: "v1", email: empresa.dono, planCode: empresa.plano, status: "active", externalSubscriptionId: "sub_bancada", currentPeriodEndsAt: empresa.fimDoPeriodo }] : [],
      historico: historico.filter((linha) => linha.empresaId === id).slice(0, 50),
    };
  },
  "plataforma.planosDoPainel": () => Object.entries(PLANOS).map(([codigo, plano]) => ({ codigo, nome: plano.nome, ativo: true, recursos: plano.recursos, limites: { connections: 1 } })),
  "plataforma.planos": () => Object.entries(PLANOS).map(([codigo, plano]) => ({ codigo, nome: plano.nome })),
  "plataforma.estenderPeriodo": ({ id, ate, renovar, nota }) => {
    const empresa = achar(id);
    const antes = assinatura(empresa);
    if (!ate || Date.parse(ate) <= Date.now()) throw new Error("A data precisa ser no futuro.");
    Object.assign(empresa, { fimDoPeriodo: new Date(ate).toISOString(), status: renovar ? "active" : "canceled" });
    registrar(empresa, "subscription.set_period", "", antes, { ...assinatura(empresa), current_period_ends_at: empresa.fimDoPeriodo }, nota);
    return resposta(empresa);
  },
  "plataforma.encerrar": ({ id, nota }) => {
    const empresa = achar(id);
    const antes = assinatura(empresa);
    Object.assign(empresa, { fimDoPeriodo: iso(Date.now() - 1000), status: "canceled" });
    registrar(empresa, "subscription.end_now", "", antes, assinatura(empresa), nota);
    return resposta(empresa);
  },
  "plataforma.trocarPlano": ({ id, plano, nota }) => {
    const empresa = achar(id);
    const antes = assinatura(empresa);
    empresa.plano = plano;
    registrar(empresa, "subscription.set_plan", plano, antes, assinatura(empresa), nota);
    return resposta(empresa);
  },
  "plataforma.ajustarFuncao": ({ id, chave, ligada, limite, ate, nota, confirmarIA }) => {
    const empresa = achar(id);
    const item = CATALOGO.find((linha) => linha.key === chave);
    if (ligada && item.isAi && !confirmarIA) throw new Error("Ligar IA exige confirmar que a empresa tem WhatsApp próprio e a conexão montada na VPS.");
    const antes = empresa.ajustes[chave] || null;
    empresa.ajustes[chave] = { enabled: item.kind === "feature" ? ligada : null, limitValue: item.kind === "limit" ? limite : null, expiresAt: ate ? new Date(ate).toISOString() : null, note: nota || "", setAt: iso(Date.now()) };
    registrar(empresa, "entitlement.set", chave, antes, { enabled: empresa.ajustes[chave].enabled, limit_value: empresa.ajustes[chave].limitValue, expires_at: empresa.ajustes[chave].expiresAt }, nota);
    return {};
  },
  "plataforma.voltarAoPlano": ({ id, chave, nota }) => {
    const empresa = achar(id);
    const antes = empresa.ajustes[chave];
    delete empresa.ajustes[chave];
    if (antes) registrar(empresa, "entitlement.clear", chave, antes, null, nota);
    return {};
  },
  "plataforma.historico": () => historico,
  "plataforma.vendas": () => [{ id: "v1", email: "vale@exemplo.invalido", plano: "completo", nomePlano: "Completo", ciclo: "MONTHLY", status: "active", empresa: "Loja Vale", codigoStatus: "redeemed" }],
  "plataforma.pedidosDeConexao": () => [{ conexaoId: "c9", empresaId: "adriane", empresa: "Clínica Adriane", dono: "adriane@exemplo.invalido", final: "8164", plano: "base", pedidoEm: iso(agora - 3_600_000), sinalEm: null }],
  "plataforma.emitirAcesso": ({ email, plano }) => ({ access_code: "NM12-3456-7890-AB", email, plan_code: plano }),
};

globalThis.__EMYLEADS_DEV_CALL__ = async (op, args = {}) => {
  const executar = OPERACOES[op];
  if (!executar) throw new Error(`Bancada do painel: ${op} não existe aqui.`);
  await new Promise((pronto) => setTimeout(pronto, 120));
  return structuredClone(executar(args));
};

// A rota mora em estado: o servidor de desenvolvimento não sabe servir
// `/dev-painel.html/empresas/<id>`, e a bancada não precisa de URL.
function Bancada() {
  const [caminho, setCaminho] = useState("/");
  return <PainelApp caminho={caminho} aoNavegar={setCaminho} />;
}

createRoot(document.getElementById("raiz")).render(<Bancada />);
