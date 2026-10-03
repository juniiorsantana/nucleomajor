/**
 * O rótulo de uma linha do Histórico da Equipe de IA.
 *
 * O banco grava `intelligence_audit_log` pelo gatilho, com a operação crua
 * (`insert`, `update`, `delete`) e o tipo da entidade em inglês (`profile`,
 * `campaign`...). A tela mostrava isso direto — "update · profile" —, que é
 * a língua do banco e não a de quem usa. Aqui vira "Agente atualizado".
 *
 * O que não estiver no dicionário continua aparecendo como veio: uma ação
 * nova no banco não pode sumir da tela por falta de tradução.
 */

const ENTIDADES = {
  profile: { nome: "Agente", genero: "m" },
  template: { nome: "Modelo de agente", genero: "m" },
  skill: { nome: "Habilidade", genero: "f" },
  collection: { nome: "Coleção", genero: "f" },
  campaign: { nome: "Campanha", genero: "f" },
  conversation: { nome: "Conversa", genero: "f" },
  simulation: { nome: "Simulação", genero: "f" },
};

const ACOES = {
  insert: { m: "criado", f: "criada" },
  update: { m: "atualizado", f: "atualizada" },
  delete: { m: "removido", f: "removida" },
};

export function rotuloDoHistorico(entrada) {
  const tipo = String(entrada?.entity_type || "");
  const acao = String(entrada?.action || "").toLowerCase();
  const entidade = ENTIDADES[tipo];
  const verbo = entidade && ACOES[acao]?.[entidade.genero];
  const versao = entrada?.version ? ` · v${entrada.version}` : "";
  if (!verbo) return `${entrada?.action || ""} · ${tipo}${versao}`;
  return `${entidade.nome} ${verbo}${versao}`;
}
