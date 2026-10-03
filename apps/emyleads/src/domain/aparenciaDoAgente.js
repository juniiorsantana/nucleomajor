/**
 * A identidade visual de um agente (Sistema Grafite, 02/10/2026).
 *
 * Agente é QUADRADO e pessoa é círculo: em qualquer tela dá para saber se
 * quem fala é IA ou gente. Cada agente tem um símbolo próprio, uma grade 5x5
 * espelhada gerada de uma semente, numa das oito cores da paleta de agentes
 * (`--el-ag-1` a `--el-ag-8` em theme.css).
 *
 * Tudo aqui é puro e estável: a mesma semente dá sempre o mesmo símbolo. Sem
 * a coluna `appearance` (migration 20261006100000), cor e semente saem do id
 * do agente; com ela, o que a pessoa escolheu tem prioridade.
 */

export const CORES_DE_AGENTE = 8;
const SEMENTE_MAX = 32;

function hash(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Só o que tem forma válida passa; o resto some e volta a ser derivado. */
export function normalizarAparencia(bruta) {
  const aparencia = {};
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return aparencia;
  const cor = Number(bruta.cor);
  if (Number.isInteger(cor) && cor >= 1 && cor <= CORES_DE_AGENTE) aparencia.cor = cor;
  if (typeof bruta.semente === "string" && bruta.semente.trim()) {
    aparencia.semente = bruta.semente.trim().slice(0, SEMENTE_MAX);
  }
  return aparencia;
}

/** Cor (1 a 8) e semente efetivas do agente. */
export function aparenciaDoAgent(agent) {
  const escolhida = normalizarAparencia(agent?.appearance);
  const base = String(agent?.id || agent?.slug || agent?.name || "agente");
  return {
    cor: escolhida.cor ?? (hash(base) % CORES_DE_AGENTE) + 1,
    semente: escolhida.semente ?? base,
  };
}

/**
 * A grade 5x5 do símbolo, espelhada na vertical. Sempre tem o centro aceso e
 * pelo menos cinco casas da metade esquerda acesas: um símbolo quase vazio
 * não se reconhece de longe.
 */
export function gradeDoSimbolo(semente) {
  const h = hash(String(semente || "agente"));
  const metade = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const acesa = x === 2 && y === 2 ? true : Boolean((h >>> ((y * 3 + x) % 31)) & 1);
      metade.push({ x, y, acesa });
    }
  }
  if (metade.filter((c) => c.acesa).length < 5) {
    metade.forEach((c, i) => { if (i % 2 === 0) c.acesa = true; });
  }
  const grade = Array.from({ length: 5 }, () => Array(5).fill(false));
  for (const { x, y, acesa } of metade) {
    if (!acesa) continue;
    grade[y][x] = true;
    grade[y][4 - x] = true;
  }
  return grade;
}

/** Uma semente nova para "Outro símbolo", curta e sem significado. */
export function sementeNova(aleatorio = Math.random) {
  return Math.floor(aleatorio() * 36 ** 6).toString(36).padStart(6, "0");
}
