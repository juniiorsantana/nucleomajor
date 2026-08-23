/**
 * Escreve no composer do WhatsApp sem enviar.
 *
 * SELETORES.botaoEnviar deliberadamente NUNCA é usado aqui. É a linha entre
 * "EmyLeads escreve" e "EmyLeads manda" — a segunda nunca acontece neste
 * arquivo. O humano decide e aperta enviar pelo WhatsApp de sempre.
 */

import { achar, SELETORES } from "./seletores.js";

/**
 * @param {string} texto
 * @returns {boolean} false se o composer não foi encontrado (conversa fechada).
 */
export function escreverNoComposer(texto) {
  const composer = achar(SELETORES.composer);
  if (!composer) return false;

  composer.focus();

  // O composer do WhatsApp é um editor controlado: escrever direto em
  // textContent/innerText não dispara o pipeline interno que atualiza o
  // estado do React deles, e o texto some no próximo re-render. Um evento
  // `paste` sintético passa pelo mesmo caminho que colar de verdade usa.
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);

  const transferencia = new DataTransfer();
  transferencia.setData("text/plain", texto);
  const evento = new ClipboardEvent("paste", {
    clipboardData: transferencia,
    bubbles: true,
    cancelable: true,
  });
  composer.dispatchEvent(evento);

  return true;
}
