#!/usr/bin/env node
/**
 * Mede os textos que a pessoa cola no portal, antes de colar.
 *
 * Existe por causa de um modo de falha silencioso: persona acima de 8000
 * caracteres é **descartada** pelo banco e pelo runtime — o agente continua
 * atendendo e simplesmente perde a personalidade inteira, sem erro nenhum na
 * tela. Instrução de habilidade fora de 80–20000 é o oposto: levanta exceção e
 * para a conversa do cliente. Nos dois casos quem descobre é o cliente, não
 * quem escreveu.
 *
 * Os arquivos têm um cabeçalho que não vai para o portal. O corte é a linha que
 * contém SÓ o marcador — o cabeçalho também menciona o marcador entre crases, e
 * medir a partir da menção conta o cabeçalho como se fosse conteúdo (erro que
 * já aconteceu, e que inflou a conta em ~1400 caracteres).
 *
 * Uso: `npm run agente:medir`
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const MARCADOR = "<!-- COLAR A PARTIR DAQUI -->";

/**
 * `min` 0 significa "não há piso": persona vazia é uma escolha legítima, o
 * agente só fica sem estilo próprio. Instrução vazia não é escolha nenhuma.
 */
const TEXTOS = [
  {
    arquivo: "docs/atendimento/padroes-de-conversa.md",
    campo: "Personalidade do agente (assistant_profiles.soul_markdown)",
    min: 0,
    max: 8000,
    aoEstourar: "o banco e o runtime DESCARTAM a persona inteira, em silêncio",
  },
  {
    arquivo: "docs/atendimento/instrucao-venda-site-e-trafego.md",
    campo: "Instruções da habilidade (skill_definitions.spec.instructionsMarkdown)",
    min: 80,
    max: 20000,
    aoEstourar: "o resolvedor levanta 'published skill instructions are invalid' e a conversa para",
  },
];

function conteudoParaColar(texto, arquivo) {
  const linhas = texto.split("\n");
  const inicio = linhas.findIndex((linha) => linha.trim() === MARCADOR);
  if (inicio < 0) throw new Error(`${arquivo}: nenhuma linha contém só o marcador ${MARCADOR}`);
  return linhas.slice(inicio + 1).join("\n").trim();
}

let algumProblema = false;

for (const { arquivo, campo, min, max, aoEstourar } of TEXTOS) {
  let conteudo;
  try {
    conteudo = conteudoParaColar(await readFile(path.join(RAIZ, arquivo), "utf8"), arquivo);
  } catch (erro) {
    algumProblema = true;
    console.error(`✗ ${arquivo}\n  ${erro.message}`);
    continue;
  }
  const tamanho = conteudo.length;
  const cabe = tamanho >= min && tamanho <= max;
  if (!cabe) algumProblema = true;
  console.log(`${cabe ? "✓" : "✗"} ${arquivo}`);
  console.log(`  ${campo}`);
  console.log(
    `  ${tamanho} de ${max} caracteres`
    + (min ? ` (mínimo ${min})` : "")
    + (cabe ? ` — folga de ${max - tamanho}` : ` — FORA DA FAIXA: ${aoEstourar}`),
  );
}

if (algumProblema) {
  console.error("\nCorrija antes de colar no portal.");
  process.exit(1);
}
console.log("\nOs dois cabem. Copie do marcador para baixo.");
