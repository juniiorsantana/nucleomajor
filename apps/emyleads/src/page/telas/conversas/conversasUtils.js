/**
 * As decisões da tela de Conversas que não dependem de React.
 *
 * Mesmo motivo de `agenda/agendaUtils.js`: este projeto não tem jsdom, então
 * efeito de hook não roda em teste. O que dá para prender é a regra, e é aqui
 * que ela mora.
 */

/**
 * Duas listas de mensagens são a mesma conversa?
 *
 * Serve para decidir se vale trocar o estado depois de uma recarga. A conversa
 * aberta se atualiza sozinha a cada aviso do realtime e a cada 20 segundos; sem
 * esta guarda, cada recarga criaria um array novo, e o efeito que rola a
 * conversa até o fim puxaria a tela de quem está lendo o histórico.
 *
 * Compara tamanho e última linha, e não a lista inteira: é o que muda aqui —
 * mensagem chega no fim. Mensagem antiga alterada no meio passaria
 * despercebida até a próxima chegar, e hoje nada as altera, porque o espelho
 * grava com `on conflict do nothing`.
 */
export function mesmaConversa(antes, depois) {
  if (!antes || !depois) return false;
  if (antes.length !== depois.length) return false;
  if (!antes.length) return true;
  const a = antes[antes.length - 1];
  const b = depois[depois.length - 1];
  return (
    a.tipo === b.tipo &&
    a.texto === b.texto &&
    a.hora === b.hora &&
    a.direcao === b.direcao &&
    a.lido === b.lido
  );
}

/**
 * O que a pílula diz quando alguém troca quem atende.
 *
 * "Transferido para Lucas" e não "Transferido para atendente": numa equipe de
 * duas pessoas o rótulo genérico responde a pergunta errada. Sem nome, a frase
 * diz o que de fato aconteceu — alguém tirou os automatismos e ainda não há
 * dono.
 */
export function textoDaTransferencia(dono, nome) {
  if (dono === "bot") return "Devolvido ao Robô do CRM";
  if (dono === "ia") return "Transferido para o Agente de IA";
  const limpo = String(nome || "").trim();
  return limpo ? `Transferido para ${limpo}` : "Transferido para atendimento humano";
}
