/**
 * A conversa de WhatsApp de cada lead, para a tela de Leads e a ficha.
 *
 * Nada novo no banco: é a mesma lista que a tela de Conversas carrega
 * (`conversas.listar`), casada com o contato pelo telefone. O casamento é por
 * variantes (`variantesBR`), porque o formulário do Meta entrega o número com
 * o nono dígito e o WhatsApp costuma guardá-lo sem.
 */

import { variantesBR } from "../../../lib/phone";
import { conversaDoTelefone } from "../conversas/conversasUtils";

export const SITUACOES = {
  semConversa: "sem_conversa",
  aguardando: "aguardando",
  respondeu: "respondeu",
};

export const ROTULOS_DA_SITUACAO = {
  [SITUACOES.semConversa]: "Sem conversa",
  [SITUACOES.aguardando]: "Aguardando resposta",
  [SITUACOES.respondeu]: "Respondeu",
};

/**
 * Índice de telefone → conversa, montado uma vez por lista.
 *
 * `conversaDoTelefone` percorre a lista inteira a cada busca; com 400
 * conversas e 400 leads na tela isso seria 160 mil comparações a cada render.
 */
export function indiceDeConversas(conversas) {
  const indice = new Map();
  for (const conversa of conversas || []) {
    if (conversa.grupo || !conversa.telefone) continue;
    for (const forma of variantesBR(conversa.telefone)) {
      const anterior = indice.get(forma);
      // Duas conversas para o mesmo número (com e sem o 9): fica a mais recente.
      if (!anterior || (conversa.ultimaMensagemEm || 0) > (anterior.ultimaMensagemEm || 0)) {
        indice.set(forma, conversa);
      }
    }
  }
  return indice;
}

export function conversaDoContato(indice, contato) {
  if (!contato?.telefone || !indice) return null;
  for (const forma of variantesBR(contato.telefone)) {
    const achada = indice.get(forma);
    if (achada) return achada;
  }
  return null;
}

/** Mesmo resultado que o índice, sem montá-lo: para quem só procura um. */
export function conversaDoContatoNaLista(conversas, contato) {
  if (!contato?.telefone) return null;
  return conversaDoTelefone(conversas, variantesBR(contato.telefone), variantesBR);
}

/**
 * Em que pé está a conversa com o lead.
 *
 * "Respondeu" quer dizer que a última mensagem é dele: é quem está esperando
 * a equipe. "Aguardando resposta" é o contrário — alguém do nosso lado falou
 * por último. Conversa sem nenhuma mensagem espelhada conta como sem conversa.
 */
export function situacaoDaConversa(conversa) {
  if (!conversa || !conversa.ultimaMensagemEm) return SITUACOES.semConversa;
  return conversa.saiu ? SITUACOES.aguardando : SITUACOES.respondeu;
}
