import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Todo hook do React usado num arquivo precisa estar importado nele.
 *
 * Este teste nasceu de um bug que chegou em produção em 08/09/2026. Duas
 * frentes mexeram em `Conversas.jsx` ao mesmo tempo: uma tirou de lá todos os
 * `useEffect` (a rolagem virou um hook próprio) e estreitou o import para
 * `useMemo, useState`; a outra acrescentou um `useEffect` novo. O git fundiu as
 * duas sem conflito — a linha do import veio de um lado, o corpo do outro — e o
 * resultado foi `ReferenceError: useEffect is not defined` na primeira vez que
 * alguém abriu a tela.
 *
 * O que assusta é o que NÃO pegou. O build passou: Rollup não resolve
 * identificador livre, ele assume global. Os 622 testes passaram: nenhum deles
 * renderiza `Conversas.jsx`. E não há linter configurado neste recorte. Ou
 * seja, três redes e a bola passou por todas — porque nenhuma delas olha para
 * esta pergunta.
 *
 * A verificação é grosseira de propósito: uma regex, sem parser. Não entende
 * reexport, alias nem `React.useEffect`, e não precisa. Ela responde a única
 * pergunta que produziu o incidente, custa milissegundos, e cobre o app inteiro
 * em vez de só o arquivo que quebrou.
 */

// `fileURLToPath`, e não `.pathname`: o caminho deste repositório tem espaços e
// acento, e `.pathname` os devolve percent-encoded — `readdirSync` então
// procura por um diretório chamado "CLIENTES%202024" e não acha nada.
const RAIZ = fileURLToPath(new URL("../apps/emyleads/src", import.meta.url));

const HOOKS_DO_REACT = new Set([
  "useState",
  "useEffect",
  "useMemo",
  "useRef",
  "useCallback",
  "useId",
  "useReducer",
  "useContext",
  "useLayoutEffect",
  "useTransition",
  "useDeferredValue",
  "useSyncExternalStore",
  "useImperativeHandle",
  "useDebugValue",
  "useInsertionEffect",
  "useOptimistic",
  "useActionState",
]);

function arquivosDeFonte(diretorio) {
  const achados = [];
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      achados.push(...arquivosDeFonte(caminho));
      continue;
    }
    if (!/\.jsx?$/.test(entrada.name)) continue;
    // Testes ficam de fora: eles importam de `vitest` e montam harness
    // próprio, e um hook citado ali não é o mesmo caso.
    if (/\.test\.[jt]sx?$/.test(entrada.name)) continue;
    achados.push(caminho);
  }
  return achados;
}

test("todo hook do React usado está importado no arquivo", () => {
  const faltando = [];

  for (const caminho of arquivosDeFonte(RAIZ)) {
    const fonte = readFileSync(caminho, "utf8");

    const importacao = fonte.match(/import\s*\{([^}]*)\}\s*from\s*["']react["']/);
    const importados = new Set(
      importacao
        ? importacao[1]
            .split(",")
            // `useState as usarEstado` conta pelo nome de origem.
            .map((parte) => parte.trim().split(/\s+as\s+/)[0].trim())
            .filter(Boolean)
        : [],
    );

    // Só chamadas: `useEffect(` e não a palavra solta num comentário. O
    // `(?<![.\w])` descarta `algo.useEffect(`, que é de outro objeto.
    const usados = new Set(
      [...fonte.matchAll(/(?<![.\w])(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]),
    );

    for (const hook of usados) {
      if (!HOOKS_DO_REACT.has(hook)) continue;
      if (importados.has(hook)) continue;
      if (fonte.includes(`React.${hook}`)) continue;
      faltando.push(`${relative(RAIZ, caminho).replace(/\\/g, "/")}: ${hook}`);
    }
  }

  assert.deepEqual(
    faltando,
    [],
    `hook usado sem import (foi assim que Conversas.jsx quebrou):\n${faltando.join("\n")}`,
  );
});
