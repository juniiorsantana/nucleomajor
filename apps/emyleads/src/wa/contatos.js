/**
 * Leitura da agenda e das conversas do WhatsApp conectado.
 *
 * É a melhor fonte de contatos que o EmyLeads tem: diferente de uma planilha,
 * cada registro já vem com o `waId` — a identidade real do WhatsApp — e com o
 * telefone traduzido quando o contato é endereçado por LID. Contato importado
 * daqui é reconhecido na conversa desde a primeira vez, sem precisar do
 * aprendizado.
 */

import { perguntar } from "./ponte";

/** Escopos de importação, do mais relevante para o mais amplo. */
export const ESCOPOS = {
  // Quem você de fato conversa. É o recorte certo para CRM: a agenda inteira
  // traz entregador, grupo de condomínio e parente, e afogar o funil em 1400
  // contatos é pior do que não importar nenhum.
  conversas: "conversas",
  agenda: "agenda",
  etiqueta: "etiqueta",
};

/** Etiquetas do WhatsApp Business, quando a conta tiver. */
export const listarEtiquetas = () =>
  perguntar("listarEtiquetas", {}, 20000).catch(() => []);

/**
 * @param {{escopo: string, etiquetaId?: string, limite?: number}} opcoes
 * @returns {Promise<Array<{waId, nome, telefone, empresa, ehMeuContato, ultimaEm}>>}
 */
export const listarContatos = (opcoes) =>
  perguntar("listarContatos", opcoes, 60000);
