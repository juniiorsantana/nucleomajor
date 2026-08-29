/**
 * Um leitor de Markdown pequeno, só do que a base de conhecimento usa.
 *
 * Não há biblioteca de Markdown no projeto e trazer uma para renderizar
 * títulos, listas e negrito seria peso desproporcional. Este módulo cobre o
 * subconjunto que os modelos geram e que as pessoas escrevem à mão.
 *
 * Ele devolve uma ÁRVORE, não HTML. O conteúdo vem de outras pessoas da
 * empresa e é exibido para colegas; com `dangerouslySetInnerHTML` bastaria
 * alguém colar um `<img onerror=…>` num documento para executar script na
 * sessão de quem abrisse a pré-visualização. Devolvendo nós, o React escapa
 * tudo por construção e não existe caminho para injeção.
 */

/** Acima disto o assistente começa a perder o fio — o aviso aparece antes. */
export const PALAVRAS_CONFORTAVEIS = 4000;

const ESCAPE = /\\([\\`*_[\]])/g;
const MARCA = /(\d+)/g;

/**
 * Troca cada caractere escapado por uma marca antes de procurar marcação.
 *
 * Retirar a barra invertida DEPOIS de casar o padrão não funciona: em
 * "preço \*promocional\*" o `*` ainda está lá na hora da busca e o trecho
 * inteiro casa como ênfase — a pessoa escreve dois asteriscos literais e a
 * tela mostra itálico, comendo os asteriscos.
 */
function proteger(texto) {
  const guardados = [];
  const protegido = String(texto).replace(ESCAPE, (_, caractere) => {
    guardados.push(caractere);
    return `${guardados.length - 1}`;
  });
  return { protegido, guardados };
}

/** `comBarra` mantém a barra invertida — dentro de código ela é literal. */
function restaurar(texto, guardados, comBarra = false) {
  return String(texto).replace(MARCA, (_, indice) => {
    const caractere = guardados[Number(indice)] ?? "";
    return comBarra ? `\\${caractere}` : caractere;
  });
}

/**
 * Quebra uma linha nos marcadores inline.
 *
 * A ordem importa: código cru primeiro, senão um `**` dentro de crase viraria
 * negrito e o texto deixaria de ser literal.
 */
export function analisarInline(texto = "") {
  const { protegido, guardados } = proteger(texto);
  const partes = [];
  const padrao = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/;
  const texto0 = (valor) => ({ tipo: "texto", texto: restaurar(valor, guardados) });
  let resto = protegido;
  while (resto) {
    const achado = padrao.exec(resto);
    if (!achado) { partes.push(texto0(resto)); break; }
    if (achado.index > 0) partes.push(texto0(resto.slice(0, achado.index)));
    const bruto = achado[0];
    if (bruto.startsWith("`")) {
      partes.push({ tipo: "codigo", texto: restaurar(bruto.slice(1, -1), guardados, true) });
    } else if (bruto.startsWith("**") || bruto.startsWith("__")) {
      partes.push({ tipo: "forte", texto: restaurar(bruto.slice(2, -2), guardados) });
    } else if (bruto.startsWith("[")) {
      const corte = bruto.indexOf("](");
      partes.push({
        tipo: "link",
        texto: restaurar(bruto.slice(1, corte), guardados),
        href: restaurar(bruto.slice(corte + 2, -1), guardados),
      });
    } else {
      partes.push({ tipo: "enfase", texto: restaurar(bruto.slice(1, -1), guardados) });
    }
    resto = resto.slice(achado.index + bruto.length);
  }
  return partes.filter((parte) => parte.tipo !== "texto" || parte.texto !== "");
}

const ITEM_LISTA = /^\s*[-*+]\s+(.*)$/;
const ITEM_NUMERO = /^\s*\d+[.)]\s+(.*)$/;
const TITULO = /^(#{1,6})\s+(.*)$/;

export function analisarMarkdown(markdown = "") {
  const blocos = [];
  const linhas = String(markdown).split("\n");
  let paragrafo = [];
  let lista = null;
  let codigo = null;

  const fecharParagrafo = () => {
    if (!paragrafo.length) return;
    blocos.push({ tipo: "paragrafo", partes: analisarInline(paragrafo.join(" ")) });
    paragrafo = [];
  };
  const fecharLista = () => {
    if (!lista) return;
    blocos.push(lista);
    lista = null;
  };

  for (const bruta of linhas) {
    const linha = bruta.replace(/\s+$/, "");

    if (codigo !== null) {
      if (/^```/.test(linha.trim())) { blocos.push({ tipo: "codigo", texto: codigo.join("\n") }); codigo = null; }
      else codigo.push(bruta);
      continue;
    }
    if (/^```/.test(linha.trim())) { fecharParagrafo(); fecharLista(); codigo = []; continue; }

    if (!linha.trim()) { fecharParagrafo(); fecharLista(); continue; }

    const titulo = TITULO.exec(linha);
    if (titulo) {
      fecharParagrafo(); fecharLista();
      blocos.push({ tipo: "titulo", nivel: titulo[1].length, partes: analisarInline(titulo[2]) });
      continue;
    }

    const item = ITEM_LISTA.exec(linha) || ITEM_NUMERO.exec(linha);
    if (item) {
      fecharParagrafo();
      const ordenada = !ITEM_LISTA.exec(linha);
      // Trocar de marcador fecha a lista: `- a` seguido de `1. b` são duas
      // listas, e emendar as duas mudaria a numeração na tela.
      if (lista && lista.ordenada !== ordenada) fecharLista();
      if (!lista) lista = { tipo: "lista", ordenada, itens: [] };
      lista.itens.push(analisarInline(item[1]));
      continue;
    }

    fecharLista();
    paragrafo.push(linha.trim());
  }

  if (codigo !== null) blocos.push({ tipo: "codigo", texto: codigo.join("\n") });
  fecharParagrafo();
  fecharLista();
  return blocos;
}

/**
 * O endereço de um link, se for seguro abrir.
 *
 * Só http e https passam. `javascript:` num href executa ao clique, e este
 * texto é escrito por uma pessoa e lido por outra — devolver `null` faz o
 * link virar texto comum na renderização.
 */
export function hrefSeguro(href = "") {
  const limpo = String(href).trim();
  return /^https?:\/\//i.test(limpo) ? limpo : null;
}

export function contarPalavras(markdown = "") {
  const limpo = String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>[\]()-]/g, " ")
    .trim();
  return limpo ? limpo.split(/\s+/).length : 0;
}

/** "folgado" | "atento" | "longo" — o rótulo que a barra lateral mostra. */
export function folegoDoDocumento(palavras) {
  if (palavras >= PALAVRAS_CONFORTAVEIS) return "longo";
  if (palavras >= PALAVRAS_CONFORTAVEIS * 0.75) return "atento";
  return "folgado";
}
