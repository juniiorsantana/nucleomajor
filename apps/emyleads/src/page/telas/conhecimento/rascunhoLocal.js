/**
 * O rascunho que sobrevive a fechar a aba.
 *
 * O assistente é o lugar onde um documento inteiro é digitado, e até aqui o
 * único guarda-corpo era um `confirm()` ao fechar. Recarregar a página, a
 * sessão expirar ou o navegador cair apagava tudo sem aviso — e com a gravação
 * falhando, essa era a diferença entre "deu erro" e "perdi o texto".
 *
 * Guardar aqui muda também o fechamento: como nada se perde, fechar deixa de
 * precisar de confirmação. A pergunta sai da saída e vira uma oferta na
 * entrada, que é onde a pessoa tem contexto para responder.
 *
 * `localStorage` é o lugar certo para isto e só para isto: é conveniência de
 * um navegador, não persistência. Some ao limpar o site, não acompanha a
 * pessoa para outro aparelho, e nada aqui é fonte de verdade — o documento
 * salvo mora no Supabase.
 */

const CHAVE = "nucleo:conhecimento:rascunho";

/** Depois disto o rascunho é ruído: quem ia voltar já voltou. */
const VALIDADE_EM_DIAS = 7;
const DIA_EM_MS = 86400000;

/**
 * O acesso ao storage é embrulhado porque ele lança, e não devolve erro.
 *
 * Janela anônima, cookies bloqueados e a captura de miniatura do navegador
 * derrubam a leitura com exceção. Um assistente que não abre porque o rascunho
 * não pôde ser lido troca um conforto por um bloqueio.
 */
function area(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function gravarRascunho(estado, storage) {
  const alvo = area(storage);
  if (!alvo || !estado) return false;
  try {
    alvo.setItem(CHAVE, JSON.stringify({ estado, salvoEm: Date.now() }));
    return true;
  } catch {
    // Cota estourada é o caso real aqui: um documento de 1 MB colado no campo
    // de texto. Não avisar é deliberado — o texto continua na tela, e um erro
    // sobre armazenamento no meio da escrita não ajudaria em nada.
    return false;
  }
}

export function limparRascunho(storage) {
  const alvo = area(storage);
  if (!alvo) return;
  try {
    alvo.removeItem(CHAVE);
  } catch {
    /* nada a fazer: o rascunho será descartado pela validade */
  }
}

/**
 * O rascunho guardado, se ainda valer a pena oferecê-lo.
 *
 * Devolve `null` também para o rascunho vazio: oferecer "retomar" um
 * assistente onde ninguém escreveu nada é ruído que ensina a ignorar o aviso.
 */
export function lerRascunho(storage) {
  const alvo = area(storage);
  if (!alvo) return null;
  let bruto;
  try {
    bruto = alvo.getItem(CHAVE);
  } catch {
    return null;
  }
  if (!bruto) return null;

  let guardado;
  try {
    guardado = JSON.parse(bruto);
  } catch {
    // Conteúdo corrompido por uma versão anterior do formato. Limpar é melhor
    // do que carregar para sempre um item que nunca mais será lido.
    limparRascunho(alvo);
    return null;
  }

  const estado = guardado?.estado;
  const salvoEm = Number(guardado?.salvoEm || 0);
  if (!estado || typeof estado !== "object" || !salvoEm) {
    limparRascunho(alvo);
    return null;
  }
  if (Date.now() - salvoEm > VALIDADE_EM_DIAS * DIA_EM_MS) {
    limparRascunho(alvo);
    return null;
  }
  return { estado, salvoEm };
}
