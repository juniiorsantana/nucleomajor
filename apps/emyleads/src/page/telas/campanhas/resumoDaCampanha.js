/**
 * O que a tela Campanhas mostra de cada campanha: quem entrou por ela, em que
 * pé está a conversa com cada um e qual fluxo manda a primeira mensagem.
 *
 * Função pura, para a tela só desenhar: os números dos cartões e a tabela
 * saem da mesma lista, e não podem discordar entre si.
 */

import { TIPOS_GATILHO, primeiraMensagem } from "../../../domain/chatbots";
import { SITUACOES, conversaDoContato, situacaoDaConversa } from "../leads/conversaDoLead";

const SEMANA = 7 * 24 * 60 * 60 * 1000;

export const ROTULOS_DO_STATUS = {
  active: "Ativa",
  test: "Em teste",
  paused: "Pausada",
  draft: "Rascunho",
  closed: "Encerrada",
};

/** O fluxo ativo cujo gatilho é "Lead da campanha" desta campanha. */
export function fluxoDaCampanha(chatbots, campanhaId) {
  return (
    (chatbots || []).find(
      (bot) =>
        bot.ativo &&
        bot.gatilho?.tipo === TIPOS_GATILHO.campanha &&
        bot.gatilho?.campanhaId === campanhaId,
    ) || null
  );
}

export function textoDaPrimeiraMensagem(fluxo) {
  return fluxo ? primeiraMensagem(fluxo) : null;
}

/**
 * Os leads da campanha já com contato, conversa e situação, e os totais.
 *
 * O lead cujo contato foi apagado do CRM continua contando — ele entrou pela
 * campanha —, mas aparece só com o telefone.
 */
export function resumoDaCampanha(campanha, contatos, indiceDeConversas, agora = Date.now()) {
  const porId = new Map((contatos || []).map((contato) => [contato.id, contato]));
  const linhas = (campanha?.leads || []).map((lead) => {
    const contato = porId.get(lead.contactId) || { id: null, nome: "", telefone: lead.telefone };
    const conversa = conversaDoContato(indiceDeConversas, contato.telefone ? contato : { telefone: lead.telefone });
    return { lead, contato, conversa, situacao: situacaoDaConversa(conversa) };
  });

  const conta = (situacao) => linhas.filter((linha) => linha.situacao === situacao).length;
  return {
    linhas,
    total: linhas.length,
    nestaSemana: linhas.filter((linha) => linha.lead.chegouEm && agora - linha.lead.chegouEm < SEMANA).length,
    respondeu: conta(SITUACOES.respondeu),
    aguardando: conta(SITUACOES.aguardando),
    semConversa: conta(SITUACOES.semConversa),
  };
}
