/**
 * Onde um agente atende e o quanto ele está pronto (Equipe de IA, 03/10/2026).
 *
 * As duas respostas saem de dados que já existem: o agente (ativo, principal),
 * as campanhas que apontam para ele (`organization_campaigns.assistant_profile_id`),
 * as habilidades ligadas, as coleções de conhecimento do público dele e o
 * playbook publicado. Nada aqui inventa estado: o que não se sabe fica "null".
 */

/** Só estas campanhas levam conversas a um agente; rascunho, pausada e encerrada não. */
const CAMPANHA_NO_AR = new Set(["active", "test"]);

/**
 * Onde o agente atende:
 *   - "pausado": desligado, não responde ninguém;
 *   - "principal": recebe quem chega do público dele sem campanha;
 *   - "campanhas": atende pelas campanhas no ar que apontam para ele;
 *   - "nenhum": ligado, mas nada leva conversa até ele.
 */
export function ondeAtende(agent, campanhas = []) {
  const doAgente = (campanhas || []).filter(
    (c) => c?.assistant_profile_id === agent?.id && CAMPANHA_NO_AR.has(c?.status),
  );
  const nomes = doAgente.map((c) => c.name).filter(Boolean);
  if (agent?.status === "inactive") return { tipo: "pausado", campanhas: nomes };
  if (agent?.isDefault) return { tipo: "principal", campanhas: nomes };
  if (doAgente.length) return { tipo: "campanhas", campanhas: nomes };
  return { tipo: "nenhum", campanhas: [] };
}

const PERSONALIDADE_MINIMA = 40;

/**
 * O roteiro do agente, na ordem em que se monta um: cada item diz se está
 * pronto e um resumo curto. `playbookPublicado` e `temConhecimento` podem
 * chegar `null` enquanto carregam; aí o item fica "pendente de saber", não
 * "falta".
 */
export function prontidaoDoAgent({ agent, habilidades = 0, temConhecimento = null, playbookPublicado = null, onde }) {
  const textoPersonalidade = String(agent?.soulMarkdown || "").trim();
  const itens = [
    {
      id: "personalidade",
      rotulo: "Personalidade",
      pronto: textoPersonalidade.length >= PERSONALIDADE_MINIMA,
      falta: "Escreva como ele conversa",
    },
    {
      id: "conhecimento",
      rotulo: "Conhecimento",
      pronto: temConhecimento,
      falta: agent?.audience === "internal" ? "Sem conhecimento da equipe" : "Sem conhecimento para clientes",
    },
    {
      id: "habilidades",
      rotulo: "Habilidades",
      pronto: habilidades > 0,
      falta: "Nenhuma habilidade ligada",
    },
    {
      id: "vender",
      rotulo: "Como vender",
      pronto: playbookPublicado,
      falta: "Roteiro comercial não publicado",
    },
    {
      id: "onde",
      rotulo: "Onde atende",
      pronto: onde ? onde.tipo === "principal" || onde.tipo === "campanhas" : null,
      falta: onde?.tipo === "pausado" ? "Pausado" : "Ainda não atende",
    },
  ];
  const prontos = itens.filter((i) => i.pronto === true).length;
  const primeiraFalta = itens.find((i) => i.pronto === false) || null;
  return { itens, prontos, total: itens.length, primeiraFalta };
}
