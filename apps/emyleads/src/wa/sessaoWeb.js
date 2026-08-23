import { perguntar } from "./ponte";
import { chamar } from "../data/client";

/**
 * Registra qual número está logado nesta aba do WhatsApp Web.
 *
 * Existe por causa de uma confusão que a interface antiga criava: ela dizia
 * que o bridge usava um "número independente do WhatsApp Web". Errado — são
 * duas *sessões* independentes, e hoje elas são do mesmo número. Sem esse
 * registro, a tela de Conexões não tem como afirmar nem desmentir isso.
 *
 * Guarda só os quatro últimos dígitos, e no `meta` do workspace, que fica fora
 * da sincronização: é o número do operador desta máquina, não um dado do CRM.
 */
export const CHAVE_SESSAO_WEB = "sessaoWeb.operador";

export async function registrarSessaoWeb() {
  try {
    const sessao = await perguntar("sessaoWeb", {}, 60000);
    await chamar("config.gravar", {
      chave: CHAVE_SESSAO_WEB,
      valor: {
        conectado: Boolean(sessao?.conectado),
        last4: sessao?.last4 || null,
        atualizadoEm: Date.now(),
      },
    });
  } catch {
    // Falhar aqui não pode atrapalhar o painel. A tela de Conexões trata a
    // ausência do registro como "não sei", que é a verdade.
  }
}
