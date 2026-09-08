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
    a.messageId === b.messageId &&
    a.texto === b.texto &&
    a.hora === b.hora &&
    a.direcao === b.direcao &&
    a.lido === b.lido
  );
}

/**
 * Remove uma bolha provisória somente quando chega uma mensagem desconhecida
 * por aquele envio. O consumo um-a-um preserva o segundo de dois textos iguais.
 */
export function conciliarPendentes(pendentes, mensagens, conversaAtual) {
  const usadas = new Set();
  const enviadas = mensagens.filter(
    (mensagem) =>
      mensagem.tipo === "mensagem" &&
      mensagem.direcao === "sai" &&
      mensagem.messageId
  );

  return pendentes.filter((pendente) => {
    if (pendente.falhou || pendente.conversa !== conversaAtual) return true;
    const conhecidas = new Set(pendente.messageIdsConhecidos || []);
    const entregue = enviadas.find(
      (mensagem) =>
        mensagem.texto === pendente.texto &&
        !conhecidas.has(mensagem.messageId) &&
        !usadas.has(mensagem.messageId)
    );
    if (!entregue) return true;
    usadas.add(entregue.messageId);
    return false;
  });
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

/**
 * Por qual conexão a empresa fala — lida da própria lista de conversas.
 *
 * Toda conversa espelhada carrega a conexão na primeira metade do id
 * (`<connectionId>:<chat>`). Uma conversa NOVA não tem id de onde tirá-la, e
 * ler daqui evita uma consulta a mais só para descobrir o que a lista já sabe.
 *
 * Só responde quando há UMA conexão na lista. Com duas, a primeira linha seria
 * a de quem falou por último — e escolher por aí é decidir por qual número da
 * empresa aquele cliente será abordado, com base em quem mandou mensagem hoje
 * de manhã. Essa decisão não é desta função.
 *
 * `null` é resposta boa, e cobre três casos: bancada (ids de contato, sem
 * dois-pontos), caixa de entrada vazia, e mais de uma conexão. Em todos eles
 * quem decide passa a ser o banco, que resolve sozinho quando a empresa só tem
 * uma conexão e recusa com motivo próprio quando tem mais.
 */
export function conexaoDaLista(conversas) {
  const conexoes = new Set();
  for (const conversa of conversas || []) {
    const id = String(conversa?.id || "");
    const corte = id.indexOf(":");
    if (corte > 0) conexoes.add(id.slice(0, corte));
    if (conexoes.size > 1) return null;
  }
  return conexoes.size === 1 ? [...conexoes][0] : null;
}

/**
 * O telefone já tem conversa na lista?
 *
 * Iniciar conversa com quem já tem conversa é ABRIR a dela, e é a tela que
 * precisa saber disso antes de gastar uma verificação e uma ida ao banco.
 *
 * O casamento é por variantes, e não por igualdade: o nono dígito é a maior
 * fonte de falso negativo num CRM de WhatsApp brasileiro, e um contato salvo
 * como (65) 99217-8164 pode viver na conta como 556592178164. Sem isto, quem
 * digitasse o número do próprio cliente ganharia uma segunda conversa com ele.
 *
 * Grupo fica de fora: o identificador dele não é telefone de ninguém, e
 * deixá-lo entrar acharia um grupo por coincidência de dígitos.
 */
export function conversaDoTelefone(conversas, variantes, variantesDe = (t) => [t]) {
  const formas = new Set(variantes || []);
  if (!formas.size) return null;
  return (
    (conversas || []).find((conversa) => {
      if (conversa.grupo || !conversa.telefone) return false;
      // As variantes dos DOIS lados. O espelho guarda o telefone como o
      // WhatsApp o entrega — só dígitos —, mas a bancada monta a lista a partir
      // do CRM, onde ele pode estar escrito com parênteses. Normalizar um lado
      // só faria a bancada nunca reconhecer a própria conversa.
      const dela = variantesDe(String(conversa.telefone));
      return (dela.length ? dela : [String(conversa.telefone)]).some((forma) =>
        formas.has(forma)
      );
    }) || null
  );
}
