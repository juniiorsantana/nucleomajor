/**
 * Service worker — o dono dos dados.
 *
 * Duas responsabilidades e nada mais: rotear as operações do provider e abrir
 * a página de gestão. Sem React, sem DOM, sem regra de interface.
 *
 * Trocar o LocalProvider por um provider que fale com o bridge é a mudança de
 * UMA linha logo abaixo — é para isso que a fronteira existe.
 */

import { serializarErro } from "../data/erros.js";
import { criarOperacoesAuth } from "../data/authProvider.js";
import { operacoes as operacoesLocais } from "../data/localProvider.js";
import { criarOperacoesSincronizacao } from "../data/remoteProvider.js";
import { verificarConexaoSupabase } from "../data/supabaseClient.js";
import { criarOperacoesGateway } from "../data/gatewayProvider.js";
import { criarOperacoesAgenda } from "../data/agendaProvider.js";

const operacoesAuth = criarOperacoesAuth();
const operacoesGateway = criarOperacoesGateway();
const operacoesAgenda = criarOperacoesAgenda();
const { operacoes: operacoesSincronizadas } = criarOperacoesSincronizacao({ local: operacoesLocais });
const operacoes = {
  ...operacoesSincronizadas,
  ...operacoesAuth,
  ...operacoesGateway,
  ...operacoesAgenda,
  "sistema.verificarSupabase": verificarConexaoSupabase,
};

const PAGINA_GESTAO = "gestao.html";

// Primeira linha do console do service worker. É o jeito mais rápido de saber
// se o Chrome recarregou o código: se o carimbo não mudou depois de um build,
// ele não recarregou.
console.log(
  `[EmyLeads] service worker — build ${typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "desconhecido"}`
);

chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
  if (mensagem?.tipo !== "emyleads/op") return false;

  const executar = operacoes[mensagem.op];
  if (!executar) {
    responder({
      ok: false,
      erro: { mensagem: `Operação desconhecida: ${mensagem.op}`, codigo: "op-desconhecida" },
    });
    return false;
  }

  Promise.resolve()
    .then(() => executar(mensagem.args || {}))
    .then((dados) => responder({ ok: true, dados: dados ?? null }))
    .catch((err) => {
      // O erro fica no console do worker inteiro; para quem chamou vai só o
      // que dá para mostrar na tela.
      console.error(`[EmyLeads] ${mensagem.op} falhou:`, err);
      responder({ ok: false, erro: serializarErro(err) });
    });

  // `true` mantém o canal aberto para a resposta assíncrona. Sem isto o
  // callback do chamador dispara com `undefined` antes do await terminar.
  return true;
});

/** Clique no ícone abre a gestão numa aba, reusando a que já estiver aberta. */
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL(PAGINA_GESTAO);
  const abertas = await chrome.tabs.query({ url });
  if (abertas.length) {
    await chrome.tabs.update(abertas[0].id, { active: true });
    await chrome.windows.update(abertas[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
});
