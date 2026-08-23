/**
 * Ponte com o `chat-inject.js`, que roda no mundo principal da página.
 *
 * O content script vive num mundo isolado e não enxerga o `window.WPP`. Toda
 * conversa com o wa-js passa por aqui, via postMessage com id de correlação.
 */

const TIMEOUT_PADRAO = 30000;

let sequencia = 0;

export function perguntar(cmd, args = {}, timeout = TIMEOUT_PADRAO) {
  return new Promise((resolve, reject) => {
    const id = ++sequencia;
    const relogio = setTimeout(() => {
      limpar();
      reject(new Error(`wa-js não respondeu a "${cmd}".`));
    }, timeout);

    function aoReceber(e) {
      const d = e.data;
      if (!d || d.source !== "emyleads-page" || d.id !== id) return;
      limpar();
      d.ok ? resolve(d.dados) : reject(new Error(d.erro || `Falha em "${cmd}".`));
    }
    const limpar = () => {
      clearTimeout(relogio);
      window.removeEventListener("message", aoReceber);
    };

    window.addEventListener("message", aoReceber);
    window.postMessage({ source: "emyleads", cmd, id, ...args }, "*");
  });
}

/** Assina os eventos espontâneos vindos da página. */
export function ouvir(aoEvento) {
  const aoReceber = (e) => {
    const d = e.data;
    if (!d || d.source !== "emyleads-page" || !d.evento) return;
    aoEvento(d.evento, d.dados);
  };
  window.addEventListener("message", aoReceber);
  return () => window.removeEventListener("message", aoReceber);
}
