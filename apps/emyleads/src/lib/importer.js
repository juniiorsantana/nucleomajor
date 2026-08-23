/**
 * Importação de lista colada ou de arquivo.
 *
 * Portado do major-contacts-v2 e renomeado para o português do resto do
 * projeto. A heurística é a parte valiosa: ninguém quer mapear coluna na mão
 * antes de importar, e planilha de cliente nunca vem no formato que a gente
 * pediu.
 */

import { normalizePhone } from "./phone.js";

/** Texto colado (Excel/Sheets usa tab) ou CSV com `;` ou `,` → matriz. */
export function parseDelimitado(texto) {
  return String(texto || "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((linha) =>
      linha
        .split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((p) => p.replace(/^"|"$/g, "").trim())
    );
}

export const pareceTelefone = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.length >= 10 && !!normalizePhone(v);
};

/**
 * Descobre qual coluna é telefone (a que tem mais células válidas), se a
 * primeira linha é cabeçalho, e tenta achar nome e empresa pelos títulos —
 * caindo para posição quando não há cabeçalho reconhecível.
 */
export function detectarMapeamento(linhas) {
  const largura = Math.max(...linhas.map((l) => l.length));

  let telefone = -1;
  let melhor = 0;
  for (let c = 0; c < largura; c++) {
    const acertos = linhas.filter((l) => pareceTelefone(l[c])).length;
    if (acertos > melhor) {
      melhor = acertos;
      telefone = c;
    }
  }

  const temCabecalho =
    telefone >= 0 && linhas.length > 1 && !pareceTelefone(linhas[0][telefone]);
  const cabecalho = temCabecalho
    ? linhas[0].map((h) => String(h).toLowerCase())
    : null;
  const acharNoCabecalho = (re) =>
    cabecalho ? cabecalho.findIndex((h) => re.test(h)) : -1;

  let nome = acharNoCabecalho(/nome|name|cliente|contato|respons/);
  let empresa = acharNoCabecalho(
    /empresa|company|neg[oó]cio|cl[ií]nica|org|local/
  );

  const ocupada = (c) => c === telefone || c === nome || c === empresa;
  if (nome < 0) nome = [...Array(largura).keys()].find((c) => !ocupada(c)) ?? -1;
  if (empresa < 0)
    empresa =
      [...Array(largura).keys()].find((c) => !ocupada(c) && c !== nome) ?? -1;

  return { telefone, nome, empresa, temCabecalho };
}

/**
 * Aplica o mapeamento e devolve o formato que `contatos.importar` espera.
 * Não valida nem deduplica — isso é decisão do provider, que é quem conhece
 * a base.
 */
export function linhasParaContatos(linhas, mapeamento) {
  const { telefone, nome, empresa, temCabecalho } = mapeamento;
  const corpo = temCabecalho ? linhas.slice(1) : linhas;
  const celula = (linha, indice) =>
    indice >= 0 ? String(linha[indice] || "").trim() : "";

  return corpo
    .filter((linha) => celula(linha, telefone))
    .map((linha) => ({
      nome: celula(linha, nome),
      telefone: celula(linha, telefone),
      empresa: celula(linha, empresa),
    }));
}
