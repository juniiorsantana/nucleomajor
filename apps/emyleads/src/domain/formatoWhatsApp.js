/**
 * A formatação do WhatsApp, lida do texto da mensagem.
 *
 * O WhatsApp não usa markdown: o negrito é com UM asterisco (`*assim*`), o
 * itálico com sublinhado (`_assim_`), o riscado com til (`~assim~`) e o
 * monoespaçado com três crases (```assim```) ou uma (`assim`). Sem isto a
 * conversa mostrava os símbolos crus — e um renderizador de markdown comum
 * erraria o negrito.
 *
 * As regras que o próprio WhatsApp segue, e que evitam falso positivo:
 *   - o marcador de abertura vem no começo, depois de espaço ou pontuação, e
 *     é seguido de algo que não é espaço;
 *   - o de fechamento vem depois de algo que não é espaço, e é seguido do fim,
 *     de espaço ou de pontuação;
 *   - negrito, itálico e riscado não atravessam a quebra de linha.
 * Assim `2*3*4` e `nome_do_arquivo` ficam como estão.
 *
 * Link é separado ANTES de tudo: `site.com/a_b_c` tem sublinhados que, sem
 * isso, virariam itálico. O link vira um nó próprio, que a tela torna
 * clicável.
 *
 * O resultado é uma árvore de nós, nunca HTML: quem desenha monta elementos
 * React, e o texto do cliente nunca passa por `innerHTML`.
 */

const MARCADORES = { "*": "negrito", _: "italico", "~": "riscado" };
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,;:!?)\]]/gi;
const ANTES_VALIDO = /[\s([{"'“‘.,;:!?-]/;
const DEPOIS_VALIDO = /[\s)\]}"'”’.,;:!?-]/;

/** O texto em nós: { tipo: "texto"|"link"|"mono"|"negrito"|"italico"|"riscado", texto?, filhos? }. */
export function formatarWhatsApp(texto) {
  const entrada = String(texto ?? "");
  const nos = [];
  let posicao = 0;
  for (const achado of entrada.matchAll(LINK)) {
    if (achado.index > posicao) nos.push(...semLinks(entrada.slice(posicao, achado.index)));
    const url = achado[0];
    nos.push({ tipo: "link", texto: url, href: url.toLowerCase().startsWith("www.") ? `https://${url}` : url });
    posicao = achado.index + url.length;
  }
  if (posicao < entrada.length) nos.push(...semLinks(entrada.slice(posicao)));
  return juntar(nos);
}

/** Bloco monoespaçado primeiro (ele não tem formatação dentro), depois o resto. */
function semLinks(trecho) {
  const nos = [];
  const bloco = /```([\s\S]+?)```/g;
  let posicao = 0;
  for (const achado of trecho.matchAll(bloco)) {
    if (achado.index > posicao) nos.push(...emLinha(trecho.slice(posicao, achado.index)));
    nos.push({ tipo: "mono", texto: achado[1] });
    posicao = achado.index + achado[0].length;
  }
  if (posicao < trecho.length) nos.push(...emLinha(trecho.slice(posicao)));
  return nos;
}

function emLinha(trecho) {
  const nos = [];
  let texto = "";
  let i = 0;
  while (i < trecho.length) {
    const c = trecho[i];
    const fim = abreAqui(trecho, i);
    if (fim > 0) {
      if (texto) nos.push({ tipo: "texto", texto });
      texto = "";
      const miolo = trecho.slice(i + 1, fim);
      nos.push(c === "`" ? { tipo: "mono", texto: miolo } : { tipo: MARCADORES[c], filhos: emLinha(miolo) });
      i = fim + 1;
      continue;
    }
    texto += c;
    i += 1;
  }
  if (texto) nos.push({ tipo: "texto", texto });
  return nos;
}

/** Se `trecho[i]` abre um marcador válido, devolve o índice do fechamento; senão -1. */
function abreAqui(trecho, i) {
  const c = trecho[i];
  if (!(c in MARCADORES) && c !== "`") return -1;
  const antes = i === 0 ? " " : trecho[i - 1];
  const depois = trecho[i + 1];
  if (!ANTES_VALIDO.test(antes) || !depois || /\s/.test(depois) || depois === c) return -1;
  for (let j = i + 2; j < trecho.length; j += 1) {
    if (trecho[j] === "\n") return -1;
    if (trecho[j] !== c) continue;
    const anterior = trecho[j - 1];
    const seguinte = j + 1 < trecho.length ? trecho[j + 1] : " ";
    if (!/\s/.test(anterior) && DEPOIS_VALIDO.test(seguinte)) return j;
  }
  return -1;
}

/** Textos vizinhos viram um só: a tela desenha menos pedaços. */
function juntar(nos) {
  const saida = [];
  for (const no of nos) {
    const ultimo = saida[saida.length - 1];
    if (no.tipo === "texto" && ultimo?.tipo === "texto") ultimo.texto += no.texto;
    else saida.push(no);
  }
  return saida;
}
