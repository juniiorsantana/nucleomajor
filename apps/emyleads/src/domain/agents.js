/**
 * A lógica da Central de Agents que não é React.
 *
 * FASE G. Ordenação, rótulos, separação de skills e — o que mais importa — a
 * decisão de quando avisar antes de desligar um agente. Fica aqui, puro,
 * porque a suíte do app renderiza para markup estático e não clica em nada:
 * regra que mora dentro de um `onClick` não é testável neste repositório.
 *
 * Nada aqui fala com o Supabase. As operações são as da FASE F, em
 * `web/agentsProvider.js`.
 */

import { AGENT_ERRORS } from "../../../../packages/intelligence/src/agent-management.mjs";

export const AUDIENCIAS = Object.freeze([
  { id: "customer", rotulo: "Clientes", descricao: "Conversa com quem chega de fora." },
  { id: "internal", rotulo: "Equipe", descricao: "Atende profissionais da organização." },
]);

export const rotuloDeAudiencia = (audience) =>
  AUDIENCIAS.find((item) => item.id === audience)?.rotulo ?? audience ?? "—";

/**
 * Ordem da lista: audience, padrão primeiro, depois nome.
 *
 * O padrão vem antes por um motivo que não é estético — ele é o único agente
 * daquela audience que responde hoje. Enterrá-lo no meio de uma lista
 * alfabética esconde a informação mais importante da tela.
 */
export function ordenarAgents(agents) {
  const posicao = (a) => AUDIENCIAS.findIndex((item) => item.id === a.audience);
  return [...(agents ?? [])].sort((a, b) =>
    posicao(a) - posicao(b)
    || Number(b.isDefault) - Number(a.isDefault)
    || String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR"));
}

/** Agrupa para a lista, preservando a ordem acima. */
export function agruparPorAudiencia(agents) {
  const ordenados = ordenarAgents(agents);
  return AUDIENCIAS
    .map((audiencia) => ({
      ...audiencia,
      agents: ordenados.filter((agent) => agent.audience === audiencia.id),
    }))
    .filter((grupo) => grupo.agents.length > 0);
}

/** Os selos de um agente, na ordem em que devem aparecer. */
export function selosDoAgent(agent) {
  const selos = [];
  if (agent?.isDefault) selos.push({ id: "default", texto: "Padrão", tom: "destaque" });
  selos.push(agent?.status === "inactive"
    ? { id: "status", texto: "Inativo", tom: "apagado" }
    : { id: "status", texto: "Ativo", tom: "vivo" });
  return selos;
}

/**
 * O agente padrão daquela audience, ou `null`.
 *
 * Existe para a tela nunca precisar de `.find(audience)` sozinho — que era
 * exato enquanto havia um agente por audience e virou sorteio depois da FASE E.
 */
export function padraoDaAudiencia(agents, audience) {
  return (agents ?? []).find((agent) => agent.audience === audience && agent.isDefault) ?? null;
}

/**
 * Desligar este agente merece confirmação?
 *
 * Só quando ele é o padrão E está ativo. Desligar o padrão é permitido — o
 * produto decidiu isso na FASE C, e a FASE D fez o runtime recusar em vez de
 * promover outro. Mas quem desliga precisa saber que aquela audience para de
 * ser atendida, e não descobrir depois pelo silêncio do WhatsApp.
 */
export function avisoAoDesativar(agent) {
  if (!agent?.isDefault || agent.status !== "active") return null;
  return {
    titulo: "Desativar o agente padrão?",
    descricao: `${agent.name} é o agente padrão de ${rotuloDeAudiencia(agent.audience).toLowerCase()}. `
      + "Ao desativá-lo, novas conversas dessa audiência ficam sem atendimento até ele ser "
      + "reativado ou outro agente ser definido como padrão. Nenhum outro agente é promovido "
      + "automaticamente.",
    rotulo: "Desativar mesmo assim",
  };
}

/** Promover pede confirmação, porque muda quem atende. */
export function avisoAoTornarPadrao(agent, padraoAtual) {
  return {
    titulo: "Tornar este o agente padrão?",
    descricao: `${agent.name} passa a ser o agente inicial de `
      + `${rotuloDeAudiencia(agent.audience).toLowerCase()}`
      + (padraoAtual && padraoAtual.id !== agent.id
        ? `, no lugar de ${padraoAtual.name}, que continua existindo como agente comum.`
        : ".")
      + (agent.status === "inactive"
        ? " Ele está inativo: enquanto continuar assim, essa audiência segue sem atendimento."
        : ""),
    rotulo: "Tornar padrão",
  };
}

/**
 * Separa o catálogo de skills entre vinculadas e disponíveis para um agente.
 *
 * `bindings` são as linhas de `assistant_profile_skills` do agente. A relação
 * é N:N: uma skill vinculada aqui continua vinculada em outros agentes, e
 * desvincular daqui não mexe em ninguém.
 */
export function separarSkills(catalogo, bindings, audience) {
  const porSkill = new Map((bindings ?? []).map((b) => [b.skill_id, b]));
  const elegiveis = (catalogo ?? []).filter(
    (skill) => skill?.status === "published" && [audience, "both"].includes(skill.audience),
  );
  const vinculadas = elegiveis
    .filter((skill) => porSkill.get(skill.id)?.enabled)
    .map((skill) => ({ ...skill, vinculo: porSkill.get(skill.id) }))
    .sort((a, b) => (a.vinculo.priority ?? 0) - (b.vinculo.priority ?? 0)
      || String(a.name).localeCompare(String(b.name), "pt-BR"));
  const disponiveis = elegiveis
    .filter((skill) => !porSkill.get(skill.id)?.enabled)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  return { vinculadas, disponiveis };
}

/**
 * Erro de domínio vira frase de tela.
 *
 * `AgentError` já traz uma mensagem em português; isto existe para os casos em
 * que a tela quer dizer algo mais específico do que o domínio sabe, e para não
 * deixar erro sem código virar texto técnico.
 */
export function mensagemDeErro(erro) {
  const codigo = erro?.code;
  if (codigo === AGENT_ERRORS.SLUG_ALREADY_EXISTS) {
    return "Já existe um agente com esse identificador. Troque o nome ou o identificador.";
  }
  if (codigo === AGENT_ERRORS.DEFAULT_ALREADY_EXISTS) {
    return "Esta audiência já tem um agente padrão. Use “Tornar padrão” no agente desejado.";
  }
  if (codigo === AGENT_ERRORS.FORBIDDEN) {
    return "Você não tem permissão para gerenciar agentes desta organização.";
  }
  if (codigo === AGENT_ERRORS.AUDIENCE_IMMUTABLE) {
    return "A audiência não pode ser alterada depois da criação. Crie outro agente.";
  }
  if (codigo === AGENT_ERRORS.NOT_FOUND) return "Agente não encontrado.";
  if (erro?.message) return erro.message;
  return "Não foi possível concluir a ação.";
}
