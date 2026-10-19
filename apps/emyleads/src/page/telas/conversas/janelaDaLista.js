/**
 * Quais linhas da lista de conversas viram elementos na tela.
 *
 * A lista tinha um botão por conversa: com 461 conversas eram 461 botões, cada
 * um com avatar, foto e duas linhas de texto, refeitos a cada recarga. A janela
 * desenha só as que cabem na caixa, mais uma folga acima e abaixo para a
 * rolagem rápida não mostrar buraco, e dois espaçadores com a altura do resto —
 * a barra de rolagem continua do tamanho da lista inteira.
 *
 * Todas as linhas têm a mesma altura (nome e prévia cortados em uma linha
 * cada), e é isso que deixa a conta ser uma divisão em vez de medir cada uma.
 *
 * Sem altura da caixa (antes do primeiro desenho, ou fora do navegador) a
 * janela mostra `minimo` linhas: a lista nunca aparece vazia por não saber o
 * próprio tamanho.
 */
export function janelaDaLista({ total, alturaLinha, primeiraVisivel = 0, alturaVisivel = 0, folga = 8, minimo = 30 }) {
  if (!total) return { inicio: 0, fim: 0, antes: 0, depois: 0 };
  const altura = Math.max(1, alturaLinha);
  const cabem = alturaVisivel > 0 ? Math.ceil(alturaVisivel / altura) : minimo;
  const primeira = Math.min(total - 1, Math.max(0, primeiraVisivel));
  const inicio = Math.max(0, primeira - folga);
  const fim = Math.min(total, primeira + cabem + folga);
  return { inicio, fim, antes: inicio * altura, depois: (total - fim) * altura };
}
