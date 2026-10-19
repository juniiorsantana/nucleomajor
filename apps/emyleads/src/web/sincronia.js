/**
 * A sincronia das Conversas por delta: o portal pede só o que mudou.
 *
 * Até 19/10/2026 a lista inteira, todos os contatos e as 300 últimas mensagens
 * da conversa aberta eram relidos a cada 20 segundos, a cada aviso de realtime
 * e a cada conversa aberta, e todas as fotos eram reassinadas junto. Com a
 * coluna `changed_at` (migration 20261020100000), que só anda quando o
 * conteúdo da linha muda de verdade, o portal guarda um cursor e pede o que
 * passou dele.
 *
 * Este arquivo é a parte que não fala com o banco: o cursor, a junção na
 * memória, quando reler tudo, a fila que impede dois pedidos de se cruzarem e
 * o cache de URL assinada. `conversasProvider.js` é quem consulta.
 */

/**
 * Quanto o cursor volta para trás do maior `changed_at` que chegou.
 *
 * O `changed_at` é a hora em que a linha foi gravada, e não a hora em que a
 * transação terminou: uma transação que grava antes de outra e termina depois
 * dela deixa uma linha com `changed_at` menor que o cursor, e o pedido seguinte
 * não a veria. Repetir cinco segundos custa algumas linhas por pedido, e a
 * junção é por id: repetir não duplica nada.
 */
export const SOBREPOSICAO_MS = 5000;

/**
 * A releitura completa. É a única coisa que vê uma conversa apagada (o delta
 * só traz o que existe) e o seguro contra a transação que demorou mais que a
 * sobreposição. Voltar para a aba depois de mais tempo fora que isto também
 * relê tudo, porque o primeiro pedido depois da volta já passou do prazo.
 */
export const RELEITURA_COMPLETA_MS = 10 * 60 * 1000;

/** A URL assinada é trocada quando falta menos que isto para vencer. */
export const FOLGA_DA_URL_MS = 5 * 60 * 1000;

const tempoDe = (valor) => {
  if (valor === null || valor === undefined || valor === "") return NaN;
  return new Date(valor).getTime();
};

/**
 * O próximo cursor: o maior `changed_at` das linhas, menos a sobreposição.
 *
 * Sem linha nova (ou sem a coluna) o cursor fica onde estava. Nunca anda para
 * trás: um pedido que só trouxe linhas da janela de sobreposição não pode
 * fazer o seguinte pedir mais do que este pediu.
 */
export function proximoCursor(linhas, cursorAnterior = null) {
  let maior = NaN;
  for (const linha of linhas || []) {
    const t = tempoDe(linha?.changed_at);
    if (Number.isFinite(t) && !(t <= maior)) maior = t;
  }
  const anterior = tempoDe(cursorAnterior);
  if (!Number.isFinite(maior)) return Number.isFinite(anterior) ? cursorAnterior : null;
  const candidato = maior - SOBREPOSICAO_MS;
  if (Number.isFinite(anterior) && anterior >= candidato) return cursorAnterior;
  return new Date(candidato).toISOString();
}

/** Hora de reler tudo: nunca leu, ou a última leitura completa passou do prazo. */
export function precisaReleituraCompleta({ cursor, completaEm, agora }) {
  if (!cursor || !Number.isFinite(completaEm)) return true;
  return agora - completaEm >= RELEITURA_COMPLETA_MS;
}

/** Da mais recente para a mais antiga, sem mensagem por último. */
const porUltimaMensagem = (a, b) => (b.ultimaMensagemEm || 0) - (a.ultimaMensagemEm || 0);

/**
 * Junta as conversas que mudaram à lista que a tela já tem.
 *
 * Idempotente por id: a mesma conversa duas vezes (a sobreposição do cursor, o
 * aviso de realtime junto do timer) vira uma linha só, com o dado mais novo. A
 * conversa que não veio continua a MESMA referência, e quem desenha a lista
 * não redesenha o que não mudou.
 *
 * A ordem é a da tela (`ultimaMensagemEm`, mais recente primeiro), e o sort é
 * estável: empate fica na ordem que o banco deu na última leitura completa.
 */
export function juntarConversas(lista, novas) {
  const atual = Array.isArray(lista) ? lista : [];
  if (!novas || novas.length === 0) return atual;
  const porId = new Map();
  for (const conversa of novas) porId.set(conversa.id, conversa);
  const saida = atual.map((conversa) => {
    const nova = porId.get(conversa.id);
    if (!nova) return conversa;
    porId.delete(conversa.id);
    return nova;
  });
  for (const nova of porId.values()) saida.push(nova);
  return saida.sort(porUltimaMensagem);
}

/**
 * Junta as linhas de mensagem que mudaram às que já estão na memória.
 *
 * Por `message_id`, e só troca quando a linha que chegou não é mais velha que a
 * guardada: dois pedidos da mesma conversa podem terminar fora de ordem, e o
 * mais lento não pode desfazer a transcrição que o mais rápido já trouxe.
 *
 * Fica com as `teto` mais novas por `sent_at`, o mesmo corte da primeira
 * abertura: a conversa aberta mostra o que mostraria se fosse relida inteira.
 */
export function juntarMensagens(linhas, novas, teto = 300) {
  const porId = new Map();
  for (const linha of linhas || []) porId.set(linha.message_id, linha);
  for (const nova of novas || []) {
    const guardada = porId.get(nova.message_id);
    if (guardada && tempoDe(guardada.changed_at) > tempoDe(nova.changed_at)) continue;
    porId.set(nova.message_id, nova);
  }
  const ordenadas = [...porId.values()].sort((a, b) => tempoDe(a.sent_at) - tempoDe(b.sent_at));
  return ordenadas.length > teto ? ordenadas.slice(ordenadas.length - teto) : ordenadas;
}

/**
 * Um pedido por vez, e no máximo um esperando.
 *
 * O timer, o aviso de realtime, a conversa aberta e o envio confirmado pedem a
 * lista ao mesmo tempo. Dois deltas cruzados podiam gravar o cursor fora de
 * ordem; dez pedidos enfileirados repetiriam dez vezes a mesma consulta. Aqui
 * quem chega enquanto um roda espera o próximo, e todos os que chegaram nesse
 * meio tempo recebem a resposta desse mesmo próximo.
 *
 * `juntar` combina as opções de quem esperou (por exemplo, um deles pediu a
 * releitura completa: o próximo é completo para todos).
 */
export function criarFila(executar, juntar = (a, b) => ({ ...a, ...b })) {
  let rodando = null;
  let proximo = null;

  const rodar = (opcoes) => {
    rodando = Promise.resolve()
      .then(() => executar(opcoes))
      .finally(() => {
        rodando = null;
        if (proximo) {
          const { opcoes: seguintes, resolver, rejeitar } = proximo;
          proximo = null;
          rodar(seguintes).then(resolver, rejeitar);
        }
      });
    return rodando;
  };

  return (opcoes = {}) => {
    if (!rodando) return rodar(opcoes);
    if (proximo) {
      proximo.opcoes = juntar(proximo.opcoes, opcoes);
      return proximo.promessa;
    }
    let resolver;
    let rejeitar;
    const promessa = new Promise((ok, falha) => {
      resolver = ok;
      rejeitar = falha;
    });
    proximo = { opcoes, promessa, resolver, rejeitar };
    return promessa;
  };
}

/**
 * As URLs assinadas, guardadas até perto de vencer.
 *
 * Avatar e mídia saem de buckets privados por URL assinada de uma hora. Antes
 * cada recarga reassinava todas, e cada URL nova fazia o navegador baixar a
 * mesma foto de novo. Aqui a URL é reaproveitada até faltar `FOLGA_DA_URL_MS`
 * para vencer; só o que falta, ou o que está para vencer, vai ao Storage.
 *
 * A falha de assinatura não entra no cache: a próxima recarga tenta de novo,
 * como antes. O cache tem teto para uma sessão longa não crescer sem fim.
 */
export function criarCacheDeUrls({ agora = () => Date.now(), teto = 5000 } = {}) {
  const guardadas = new Map();
  const chaveDe = (bucket, caminho) => `${bucket}\n${caminho}`;

  const lembrar = (chave, valor) => {
    guardadas.delete(chave);
    guardadas.set(chave, valor);
    while (guardadas.size > teto) guardadas.delete(guardadas.keys().next().value);
  };

  /**
   * `assinarLote(caminhos)` é quem fala com o Storage e devolve
   * `Map<caminho, url>`. Devolve o mesmo formato, para todos os caminhos que
   * têm URL (do cache ou recém-assinada).
   */
  const assinar = async (bucket, caminhos, validadeSegundos, assinarLote) => {
    const unicos = [...new Set((caminhos || []).map((c) => String(c || "").trim()).filter(Boolean))];
    const saida = new Map();
    if (unicos.length === 0) return saida;
    const inicio = agora();
    const faltam = [];
    for (const caminho of unicos) {
      const guardada = guardadas.get(chaveDe(bucket, caminho));
      if (guardada && guardada.venceEm - inicio > FOLGA_DA_URL_MS) saida.set(caminho, guardada.url);
      else faltam.push(caminho);
    }
    if (faltam.length === 0) return saida;
    const novas = await assinarLote(faltam);
    // A validade conta de ANTES do pedido: a URL pode ter nascido no começo
    // dele, e contar do fim a daria por viva mais tempo do que ela vive.
    const venceEm = inicio + validadeSegundos * 1000;
    for (const [caminho, url] of novas || []) {
      if (!url) continue;
      lembrar(chaveDe(bucket, caminho), { url, venceEm });
      saida.set(caminho, url);
    }
    return saida;
  };

  return { assinar, tamanho: () => guardadas.size };
}

/**
 * O que o banco responde quando a RPC nova ainda não existe: a migration não
 * foi aplicada e o portal novo já foi publicado.
 */
export function faltaRpc(error) {
  return Boolean(error) && (error.code === "PGRST202" || error.code === "42883");
}

/**
 * "A coluna não existe", pelo nome dela. Mesmo critério de
 * `faltaColunaDeTranscricao`: o código E o nome, para outro erro de coluna não
 * desligar a coluna errada.
 */
export function faltaColuna(error, coluna) {
  if (!error) return false;
  if (error.code !== "42703" && error.code !== "PGRST204") return false;
  const texto = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  return texto.includes(coluna);
}

/**
 * O aviso de realtime toca esta conversa?
 *
 * `entityKeys` nulo quer dizer "não sei qual" (aviso sem a chave, banco antes
 * da migration 20261020120000, ou o canal que acabou de religar): toca todas.
 * A chave do tópico `conversas` é o `contact_phone`; o `entityId` é a conexão,
 * e só filtra quando o aviso veio de uma conexão só.
 */
export function avisoTocaConversa(detalhe, idDaConversa) {
  if (!idDaConversa) return false;
  const chaves = detalhe?.entityKeys;
  if (!Array.isArray(chaves)) return true;
  const corte = String(idDaConversa).indexOf(":");
  if (corte < 1) return true;
  const conexao = String(idDaConversa).slice(0, corte);
  const chat = String(idDaConversa).slice(corte + 1);
  if (detalhe.entityId && detalhe.entityId !== conexao) return false;
  return chaves.includes(chat);
}
