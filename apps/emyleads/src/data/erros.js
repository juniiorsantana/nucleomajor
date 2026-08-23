/**
 * Serialização de erro na fronteira do provider.
 *
 * Um Error não atravessa `chrome.runtime.sendMessage`: o que chega do outro
 * lado é um objeto simples. Sem um formato combinado, tudo que não for a
 * mensagem se perde — e foi o que aconteceu com `codigo`, deixando a interface
 * incapaz de distinguir "estágio tem negócios, pergunte para onde movê-los" de
 * um erro qualquer.
 *
 * Vive num módulo próprio porque o service worker E o dublê da bancada usam
 * este mesmo código. Enquanto for um só, é impossível a bancada testar um
 * transporte diferente do real — que é justamente o bug que este arquivo
 * conserta.
 */

/** Campos que nunca atravessam: ruído ou vazamento de caminho de arquivo. */
const IGNORAR = new Set(["stack", "message", "cause"]);

export function serializarErro(err) {
  const carga = {
    mensagem: err?.message || String(err),
    codigo: err?.codigo || "erro",
  };

  // Qualquer dado que quem lançou anexou ao erro — `quantidade`, `contatoId` —
  // vai junto. Enumerar campo a campo aqui garantiria que o próximo a
  // acrescentar um seja o próximo a descobrir que ele some no caminho.
  for (const chave of Object.keys(err || {})) {
    if (IGNORAR.has(chave) || chave in carga) continue;
    const valor = err[chave];
    const tipo = typeof valor;
    if (valor === null || tipo === "string" || tipo === "number" || tipo === "boolean") {
      carga[chave] = valor;
    }
  }

  return carga;
}

/** Reconstrói o Error do lado de quem chamou, com os campos extras. */
export function reidratarErro(carga, op) {
  const erro = new Error(carga?.mensagem || `Falha em "${op}".`);
  for (const [chave, valor] of Object.entries(carga || {})) {
    if (chave !== "mensagem") erro[chave] = valor;
  }
  return erro;
}
