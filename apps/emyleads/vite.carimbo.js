import { execSync } from "node:child_process";

/**
 * Carimbo de build, injetado nas três saídas.
 *
 * Existe por um sintoma concreto: "atualizei a extensão e ela não carregou as
 * mudanças" era uma afirmação que ninguém conseguia confirmar nem desmentir. A
 * versão do manifest é fixa em 0.1.0 e nada na interface dizia de qual build
 * era o código rodando.
 *
 * Com o carimbo, a pergunta vira verificável em dois segundos: o que aparece
 * em Configurações é o mesmo que o último build imprimiu, ou não é.
 */
function commitAtual() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // Fora de um repositório, ou sem git no PATH. O horário sozinho já
    // distingue um build do outro, que é o essencial.
    return "sem-git";
  }
}

export function carimboDeBuild() {
  const agora = new Date();
  const horario = agora.toISOString().slice(0, 16).replace("T", " ");
  return {
    __BUILD_STAMP__: JSON.stringify(`${horario} UTC · ${commitAtual()}`),
  };
}
