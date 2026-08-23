/**
 * O lado da interface da fronteira de dados.
 *
 * Painel e página de gestão falam SÓ com este arquivo. Nenhum componente
 * conhece IndexedDB, `chrome.runtime` ou, no futuro, HTTP. Quando os dados
 * passarem a vir do bridge, muda o provider dentro do service worker e nada
 * aqui nem acima daqui é tocado.
 */

import { reidratarErro } from "./erros";

const PLATAFORMA_WEB = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

const TENTATIVAS = 2;
const ESPERA_MS = 120;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function enviar(mensagem) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(mensagem, (resposta) => {
      const falha = chrome.runtime.lastError;
      if (falha) return reject(new Error(falha.message));
      if (!resposta) return reject(new Error("Sem resposta do service worker."));
      resolve(resposta);
    });
  });
}

/**
 * Chama uma operação do provider.
 *
 * A retentativa existe por um motivo específico do MV3: o service worker
 * hiberna, e a primeira mensagem depois de uma recarga da extensão pode pegar
 * a porta ainda fechada ("Receiving end does not exist"). Uma segunda tentativa
 * resolve; mais que isso esconderia erro de verdade.
 */
export async function chamar(op, args = {}) {
  if (PLATAFORMA_WEB) {
    const { chamarWeb } = await import("../web/operations.js");
    return chamarWeb(op, args);
  }
  let ultimoErro;

  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      const resposta = await enviar({ tipo: "emyleads/op", op, args });
      if (resposta.ok) return resposta.dados;

      // erro de negócio não se repete — a resposta chegou
      throw reidratarErro(resposta.erro, op);
    } catch (err) {
      const portaFechada = /Receiving end|Extension context|message port/i.test(
        err?.message || ""
      );
      if (!portaFechada) throw err;
      ultimoErro = err;
      await dormir(ESPERA_MS);
    }
  }

  const erro = new Error(
    "O EmyLeads não respondeu. Recarregue a página do WhatsApp."
  );
  erro.causa = ultimoErro;
  throw erro;
}

/**
 * Açúcar sobre `chamar`: `api.contatos.listar()` em vez de
 * `chamar("contatos.listar")`. O Proxy evita manter uma segunda lista de
 * operações que sairia de sincronia com a do provider na primeira mudança.
 */
export const api = new Proxy(
  {},
  {
    get: (_, grupo) =>
      new Proxy(
        {},
        { get: (_, metodo) => (args) => chamar(`${grupo}.${metodo}`, args) }
      ),
  }
);
