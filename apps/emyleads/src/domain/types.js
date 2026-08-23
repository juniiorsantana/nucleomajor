/**
 * Entidades do EmyLeads.
 *
 * Regra que vale para todas: campo em português, id curto e opaco, e datas em
 * epoch ms. Nada aqui conhece IndexedDB, WhatsApp ou React — este arquivo é o
 * contrato que sobrevive à troca do provider.
 *
 * DECISÃO: o estágio do funil pertence ao NEGÓCIO, não ao contato. O mesmo
 * contato pode ter mais de uma oportunidade, e amarrar estágio no contato
 * torna o segundo negócio impossível de representar sem gambiarra. Contato sem
 * negócio é só um contato — e isso é um estado válido, não um erro.
 */

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ */
/* Contato                                                             */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} Contact
 * @property {string} id
 * @property {string} nome
 * @property {string} telefone  dígitos com DDI, sem "+" — ver lib/phone.js
 * @property {string|null} waId  wid do WhatsApp ("55...@c.us" ou "...@lid").
 *   Guardado separado do telefone porque o WhatsApp endereça boa parte dos
 *   contatos por LID, que NÃO é o telefone e não dá para derivar dele.
 * @property {string} empresa
 * @property {string} cargo
 * @property {string} email
 * @property {string} origem
 * @property {string[]} tags     ids de Tag
 * @property {string} responsavel
 * @property {number} criadoEm
 * @property {number} atualizadoEm
 */

export function criarContato(partial = {}) {
  const agora = Date.now();
  return {
    id: uid(),
    nome: "",
    telefone: "",
    waId: null,
    // URL opcional de avatar fornecida por uma integração; a Gestão nunca
    // busca ou abre o WhatsApp para obtê-la.
    fotoUrl: null,
    // Momento da última troca real de mensagem. Vem preenchido na importação
    // do WhatsApp; para contato criado à mão fica nulo até existir. Não é o
    // mesmo que `atualizadoEm`, que muda quando se edita um campo — editar
    // um cadastro não é ter falado com a pessoa.
    ultimaEm: null,
    empresa: "",
    cargo: "",
    email: "",
    origem: "",
    tags: [],
    responsavel: "",
    criadoEm: agora,
    atualizadoEm: agora,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Negócio                                                             */
/* ------------------------------------------------------------------ */

export const STATUS_NEGOCIO = {
  aberto: "aberto",
  ganho: "ganho",
  perdido: "perdido",
};

/**
 * @typedef {Object} Deal
 * @property {string} id
 * @property {string} contactId
 * @property {string} titulo
 * @property {number|null} valor
 * @property {string} stageId
 * @property {string} origem
 * @property {"aberto"|"ganho"|"perdido"} status
 * @property {string} motivoPerda
 * @property {number} criadoEm
 * @property {number} atualizadoEm
 */

export function criarNegocio(partial = {}) {
  const agora = Date.now();
  return {
    id: uid(),
    contactId: "",
    titulo: "",
    valor: null,
    stageId: ESTAGIOS_PADRAO[0].id,
    origem: "",
    status: STATUS_NEGOCIO.aberto,
    motivoPerda: "",
    criadoEm: agora,
    atualizadoEm: agora,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Tarefa                                                              */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} contactId
 * @property {string|null} dealId
 * @property {string} titulo
 * @property {number|null} venceEm
 * @property {boolean} concluida
 * @property {number|null} concluidaEm
 * @property {string} responsavel
 * @property {number} criadoEm
 */

export function criarTarefa(partial = {}) {
  return {
    id: uid(),
    contactId: "",
    dealId: null,
    titulo: "",
    venceEm: null,
    concluida: false,
    concluidaEm: null,
    responsavel: "",
    criadoEm: Date.now(),
    ...partial,
  };
}

/** Uma tarefa está atrasada quando venceu e ninguém concluiu. */
export const tarefaAtrasada = (t, agora = Date.now()) =>
  !t.concluida && t.venceEm != null && t.venceEm < agora;

/* ------------------------------------------------------------------ */
/* Nota                                                                */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} contactId
 * @property {string} texto
 * @property {string} autor
 * @property {number} criadoEm
 */

export function criarNota(partial = {}) {
  return {
    id: uid(),
    contactId: "",
    texto: "",
    autor: "",
    criadoEm: Date.now(),
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Estágios e tags                                                     */
/* ------------------------------------------------------------------ */

/**
 * Estágios são dados, não código: nascem com estes valores mas o usuário pode
 * renomear, reordenar e criar novos na tela de configurações. Por isso o id é
 * um slug estável — renomear o rótulo não move nenhum negócio de lugar.
 */
export const ESTAGIOS_PADRAO = [
  { id: "novo-lead", nome: "Novo lead", ordem: 0 },
  { id: "contato", nome: "Contato", ordem: 1 },
  { id: "qualificacao", nome: "Qualificação", ordem: 2 },
  { id: "proposta", nome: "Proposta", ordem: 3 },
  { id: "negociacao", nome: "Negociação", ordem: 4 },
  { id: "fechado", nome: "Fechado", ordem: 5 },
];

/**
 * Cores das pílulas de estágio, por POSIÇÃO no funil e não por id.
 *
 * Por posição porque o usuário pode renomear, remover e criar estágios — uma
 * cor amarrada ao id deixaria estágio novo sem cor nenhuma.
 *
 * Nenhuma delas é a cor da marca. Estágio é dado, não ação: se as seis
 * pílulas forem roxas, a tela inteira fica roxa e o roxo deixa de significar
 * "clique aqui". Só a última é verde, porque fechar é o único estágio que
 * também é um resultado.
 */
export const PALETA_ESTAGIOS = [
  { texto: "#1d4ed8", fundo: "#dbeafe" }, // azul
  { texto: "#0369a1", fundo: "#e0f2fe" }, // azul claro
  // Violeta, e não índigo: índigo fica a um passo do roxo da marca, e a
  // pílula passaria a parecer clicável.
  { texto: "#7c3aed", fundo: "#ede9fe" }, // violeta
  { texto: "#b45309", fundo: "#fef3c7" }, // âmbar
  { texto: "#0f766e", fundo: "#ccfbf1" }, // turquesa
  { texto: "#15803d", fundo: "#dcfce7" }, // verde
];

export const corDoEstagio = (ordem = 0) =>
  PALETA_ESTAGIOS[((ordem % PALETA_ESTAGIOS.length) + PALETA_ESTAGIOS.length) % PALETA_ESTAGIOS.length];

export const TAGS_PADRAO = [
  { id: "cliente", nome: "Cliente", cor: "#147A52" },
  { id: "lead-quente", nome: "Lead quente", cor: "#C0362C" },
  { id: "indicacao", nome: "Indicação", cor: "#0A7CD4" },
  { id: "sem-interesse", nome: "Sem interesse", cor: "#626B7A" },
];
