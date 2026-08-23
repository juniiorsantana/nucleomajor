/**
 * Todo seletor do DOM do WhatsApp mora aqui. Nenhum outro arquivo do projeto
 * conhece a estrutura interna dele.
 *
 * O WhatsApp muda isso sem aviso e sem changelog. Quando algo parar de
 * funcionar, o conserto começa — e quase sempre termina — neste arquivo.
 *
 * Cada entrada é uma LISTA em ordem de preferência: o primeiro que casar vence.
 * Rótulos em português e inglês porque o idioma da interface é do usuário.
 */

export const SELETORES = {
  cabecalhoConversa: ["#main header"],

  // Raiz do app do WhatsApp — usada para encolher a área dele quando o painel
  // abre, em vez de sobrepor.
  appWhatsApp: ["#app"],

  composer: [
    'footer div[contenteditable="true"][data-tab]',
    'footer div[contenteditable="true"]',
    'div[contenteditable="true"][data-tab="10"]',
  ],

  botaoEnviar: [
    'footer button[aria-label="Enviar"]',
    'footer button[aria-label="Send"]',
    'footer span[data-icon="send"]',
    'footer span[data-icon="wds-ic-send-filled"]',
  ],
};

/** Primeiro elemento que casar com a lista, ou null. */
export function achar(lista, raiz = document) {
  for (const seletor of lista) {
    const el = raiz.querySelector(seletor);
    if (el) return el;
  }
  return null;
}
