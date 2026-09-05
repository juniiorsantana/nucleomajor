/**
 * A lógica da Central de Agentes que não é React.
 *
 * ETAPA 12B.1 (redesenho de UX). A pergunta que guiou a reescrita não foi
 * "como melhorar a tela atual", foi "como uma empresa pensaria em contratar e
 * gerenciar gente para fazer um trabalho" — e por isso quase todo texto aqui
 * é o texto que a PESSOA vê, não o nome da coluna que ele alimenta.
 *
 * Nenhuma dessas escolhas de palavra muda o contrato do backend (FASE F):
 * `isDefault`, `audience`, `status` continuam sendo os campos reais de
 * `AgentDefinition`. O que muda é só como eles são chamados na tela — a
 * tabela completa está em `docs/intelligence/MULTI-AGENT-MIGRATION.md`.
 *
 * Fica aqui, puro, porque a suíte do app renderiza para markup estático e não
 * clica em nada: regra que mora dentro de um `onClick` não é testável neste
 * repositório.
 */

import { AGENT_ERRORS } from "../../../../packages/intelligence/src/agent-management.mjs";
import { corDerivada } from "../ui/perfil.js";

export const AUDIENCIAS = Object.freeze([
  { id: "customer", rotulo: "Clientes", descricao: "Conversa com quem chega de fora — clientes e leads." },
  { id: "internal", rotulo: "Equipe", descricao: "Ajuda profissionais da sua organização." },
]);

export const rotuloDeAudiencia = (audience) =>
  AUDIENCIAS.find((item) => item.id === audience)?.rotulo ?? audience ?? "—";

/** A cor do avatar, estável por agente — mesmo algoritmo usado para pessoas. */
export const corDoAgent = (agent) => corDerivada(agent?.id);

/**
 * Ordem da lista: audience, o principal primeiro, depois nome.
 *
 * O principal vem antes por um motivo que não é estético — ele é o único
 * agente daquela audiência que responde hoje. Enterrá-lo no meio de uma lista
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

/**
 * Os selos de um agente, na ordem em que devem aparecer.
 *
 * "Principal" é a palavra de produto para `isDefault` — é ele quem atende
 * primeiro naquela audiência quando ninguém escolheu um agente específico.
 * "Padrão" foi descartado por soar a configuração de sistema, não a papel de
 * alguém dentro da empresa.
 */
export function selosDoAgent(agent) {
  const selos = [];
  if (agent?.isDefault) selos.push({ id: "principal", texto: "Principal", tom: "destaque" });
  selos.push(agent?.status === "inactive"
    ? { id: "status", texto: "Inativo", tom: "apagado" }
    : { id: "status", texto: "Ativo", tom: "vivo" });
  return selos;
}

/**
 * O agente principal daquela audiência, ou `null`.
 *
 * Existe para a tela nunca precisar de `.find(audience)` sozinho — que era
 * exato enquanto havia um agente por audiência e virou sorteio depois da
 * liberação de múltiplos agentes.
 */
export function padraoDaAudiencia(agents, audience) {
  return (agents ?? []).find((agent) => agent.audience === audience && agent.isDefault) ?? null;
}

/**
 * Desligar este agente merece confirmação?
 *
 * Só quando ele é o principal E está ativo. Desligar o principal é permitido
 * — mas quem desliga precisa saber que aquela audiência para de ser atendida,
 * e não descobrir depois pelo silêncio do WhatsApp. Ninguém é promovido
 * automaticamente no lugar dele.
 */
export function avisoAoDesativar(agent) {
  if (!agent?.isDefault || agent.status !== "active") return null;
  return {
    titulo: "Desativar o agente principal?",
    descricao: `${agent.name} é o agente principal de ${rotuloDeAudiencia(agent.audience).toLowerCase()}. `
      + "Ao desativá-lo, novas conversas dessa audiência ficam sem atendimento até ele ser "
      + "reativado ou outro agente ser definido como principal. Nenhum outro agente é promovido "
      + "automaticamente.",
    rotulo: "Desativar mesmo assim",
  };
}

/** Promover pede confirmação, porque muda quem atende primeiro. */
export function avisoAoTornarPadrao(agent, principalAtual) {
  return {
    titulo: "Tornar este o agente principal?",
    descricao: `${agent.name} passa a ser o agente inicial de `
      + `${rotuloDeAudiencia(agent.audience).toLowerCase()}`
      + (principalAtual && principalAtual.id !== agent.id
        ? `, no lugar de ${principalAtual.name}, que continua existindo como agente comum.`
        : ".")
      + (agent.status === "inactive"
        ? " Ele está inativo: enquanto continuar assim, essa audiência segue sem atendimento."
        : ""),
    rotulo: "Tornar principal",
  };
}

/**
 * Separa o catálogo de skills entre vinculadas e disponíveis para um agente.
 *
 * `bindings` são as linhas de vínculo do agente. A relação é N:N: uma skill
 * vinculada aqui continua vinculada em outros agentes, e desvincular daqui
 * não mexe em ninguém.
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

/** O que mostrar quando a skill não tem descrição escrita — nunca o slug cru. */
export const descricaoDaSkill = (skill) => skill?.description?.trim() || "Sem descrição disponível.";

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
    return "Esta audiência já tem um agente principal. Use “Tornar principal” no agente desejado.";
  }
  if (codigo === AGENT_ERRORS.FORBIDDEN) {
    return "Você não tem permissão para gerenciar agentes desta organização.";
  }
  if (codigo === AGENT_ERRORS.AUDIENCE_IMMUTABLE) {
    return "Quem o agente atende não pode ser alterado depois da criação. Crie outro agente.";
  }
  if (codigo === AGENT_ERRORS.NOT_FOUND) return "Agente não encontrado.";
  if (erro?.message) return erro.message;
  return "Não foi possível concluir a ação.";
}

/* ------------------------------------------------------------------------ *
 * O assistente de criação — "quero criar alguém para fazer X", não um       *
 * formulário técnico. Presets são só UX: sugerem função, tom, personalidade *
 * e skills, e o usuário pode mudar tudo. Nenhum preset vira entidade nova   *
 * no backend, e nenhum agente nasce principal (isso é ação separada).      *
 * ------------------------------------------------------------------------ */

/**
 * "O que você quer que esse agente faça?" — o primeiro passo do assistente.
 *
 * `skillsSugeridas` são slugs do catálogo real (`agenda`, `vendas`,
 * `pre-qualificacao`, `recepcao`, `solicitacao-agenda`, `suporte`,
 * `tarefas` — os mesmos nomes registrados em `docs/STATUS.md`). Uma
 * organização que não publicou aquela skill simplesmente não a vê sugerida:
 * `skillsPreSelecionadas` cruza com o catálogo real antes de marcar qualquer
 * caixa.
 */
export const PRESETS_DE_AGENTE = Object.freeze([
  {
    id: "atendimento",
    rotulo: "Atendimento",
    descricao: "Recebe quem chega e direciona a conversa.",
    audience: "customer",
    role: "Atendimento",
    tomSugerido: "acolhedor",
    soulSugerido: "Recebe cada pessoa com atenção, entende o que ela precisa e conduz para o próximo passo certo — sem pressa, sem parecer um robô de menu.",
    skillsSugeridas: ["recepcao"],
  },
  {
    id: "vendas",
    rotulo: "Vendas",
    descricao: "Conduz o interesse até a venda.",
    audience: "customer",
    role: "Vendas",
    tomSugerido: "persuasivo",
    soulSugerido: "Entende a necessidade antes de oferecer, apresenta a solução com segurança e conduz para o fechamento sem forçar.",
    skillsSugeridas: ["vendas", "pre-qualificacao"],
  },
  {
    id: "qualificacao",
    rotulo: "Qualificação",
    descricao: "Descobre se o contato tem o perfil certo.",
    audience: "customer",
    role: "Pré-qualificação",
    tomSugerido: "objetivo",
    soulSugerido: "Faz as perguntas certas, poucas por vez, para entender rápido se aquele contato tem o perfil que a empresa atende.",
    skillsSugeridas: ["pre-qualificacao"],
  },
  {
    id: "agenda",
    rotulo: "Agenda",
    descricao: "Marca e organiza horários.",
    audience: "customer",
    role: "Agendamentos",
    tomSugerido: "objetivo",
    soulSugerido: "Verifica disponibilidade, propõe horários claros e confirma o agendamento sem gerar ida e volta desnecessária.",
    skillsSugeridas: ["agenda", "solicitacao-agenda"],
  },
  {
    id: "suporte",
    rotulo: "Suporte",
    descricao: "Ajuda quem já é cliente.",
    audience: "customer",
    role: "Suporte",
    tomSugerido: "consultivo",
    soulSugerido: "Ouve o problema com paciência, explica a solução em passos simples e confirma que a pessoa conseguiu resolver.",
    skillsSugeridas: ["suporte"],
  },
  {
    id: "cobranca",
    rotulo: "Cobrança",
    descricao: "Trata pendências financeiras com firmeza e respeito.",
    audience: "customer",
    role: "Cobrança",
    tomSugerido: "profissional",
    soulSugerido: "Trata o assunto com clareza e respeito, sem constranger a pessoa, e propõe caminhos concretos para regularizar.",
    skillsSugeridas: [],
  },
  {
    id: "equipe",
    rotulo: "Equipe interna",
    descricao: "Ajuda profissionais da sua organização.",
    audience: "internal",
    role: "Equipe interna",
    tomSugerido: "objetivo",
    soulSugerido: "Ajuda a equipe a resolver o dia a dia rápido: consultar informação, registrar tarefa, encontrar resposta — sem enrolação.",
    skillsSugeridas: ["tarefas"],
  },
  {
    id: "zero",
    rotulo: "Criar do zero",
    descricao: "Sem sugestões — você define tudo.",
    audience: null,
    role: "",
    tomSugerido: null,
    soulSugerido: "",
    skillsSugeridas: [],
  },
]);

/**
 * "Como ele deve conversar?" — chips curtos na tela, frase completa no banco.
 *
 * Mesma convenção que a Central já usava para o tom do assistente único
 * (`tonePresets`, em `Inteligencia.jsx`): a pessoa escolhe uma palavra, o
 * campo `tone` recebe uma frase de verdade, porque é isso que alimenta o
 * comportamento do agente.
 */
export const TONS_SUGERIDOS = Object.freeze([
  { id: "profissional", rotulo: "Profissional", texto: "Profissional, claro e direto ao ponto." },
  { id: "consultivo", rotulo: "Consultivo", texto: "Consultivo e paciente — entende o contexto antes de orientar." },
  { id: "acolhedor", rotulo: "Acolhedor", texto: "Acolhedor e caloroso, sem perder a objetividade." },
  { id: "objetivo", rotulo: "Objetivo", texto: "Direto, organizado, sem rodeios." },
  { id: "persuasivo", rotulo: "Persuasivo", texto: "Confiante e persuasivo, sem parecer forçado." },
]);

export function presetPorId(id) {
  return PRESETS_DE_AGENTE.find((preset) => preset.id === id) ?? null;
}

export function tomPorId(id) {
  return TONS_SUGERIDOS.find((tom) => tom.id === id) ?? null;
}

/**
 * Os slugs sugeridos por um preset, restritos ao que a organização realmente
 * publicou. Sugerir uma skill que não existe no catálogo real seria mostrar
 * uma caixa marcada que a próxima tela não consegue explicar.
 */
export function skillsPreSelecionadas(catalogo, preset) {
  if (!preset?.skillsSugeridas?.length) return [];
  const porSlug = new Map((catalogo ?? []).map((skill) => [skill.slug, skill]));
  return preset.skillsSugeridas
    .map((slug) => porSlug.get(slug))
    .filter((skill) => skill?.status === "published")
    .map((skill) => skill.id);
}
