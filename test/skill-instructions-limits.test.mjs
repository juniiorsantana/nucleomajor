import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { INSTRUCTIONS_MAX, INSTRUCTIONS_MIN } from "../packages/intelligence/src/skill-limits.mjs";

/**
 * A faixa de tamanho das instruções de habilidade vive em quatro lugares: nos
 * resolvedores em SQL, no runtime Python da VPS, no validador do catálogo Git e
 * agora na tela que cria habilidade privada. SQL e Python não importam
 * JavaScript, então a única forma de manter as cópias honestas é comparar.
 *
 * O que este arquivo protege é concreto: se alguém mudar o piso em SQL e
 * esquecer o JavaScript, a tela volta a deixar publicar uma habilidade que o
 * banco recusa — e a falha aparece na conversa de um cliente, não aqui.
 */

const MIGRATIONS = path.resolve(import.meta.dirname, "../supabase/migrations");

/** `length(instructions) < 80 or length(instructions) > 20000` em qualquer resolvedor. */
const FAIXA = /length\(instructions\)\s*<\s*(\d+)\s+or\s+length\(instructions\)\s*>\s*(\d+)/g;

async function faixasNoSql() {
  const arquivos = (await readdir(MIGRATIONS)).filter((nome) => nome.endsWith(".sql")).sort();
  const achadas = [];
  for (const nome of arquivos) {
    const sql = await readFile(path.join(MIGRATIONS, nome), "utf8");
    for (const [, min, max] of sql.matchAll(FAIXA)) {
      achadas.push({ nome, min: Number(min), max: Number(max) });
    }
  }
  return achadas;
}

test("algum resolvedor em SQL realmente valida o tamanho das instruções", async () => {
  const achadas = await faixasNoSql();
  assert.ok(
    achadas.length > 0,
    "nenhuma validação de tamanho de instrução encontrada nas migrations — "
    + "ou a regra saiu do banco, ou o padrão do regex mudou e este teste virou decoração",
  );
});

test("o limite do JavaScript é o mesmo que o banco aplica", async () => {
  for (const { nome, min, max } of await faixasNoSql()) {
    assert.equal(min, INSTRUCTIONS_MIN, `${nome} exige mínimo ${min}, o JavaScript diz ${INSTRUCTIONS_MIN}`);
    assert.equal(max, INSTRUCTIONS_MAX, `${nome} exige máximo ${max}, o JavaScript diz ${INSTRUCTIONS_MAX}`);
  }
});

test("o validador do catálogo Git usa a mesma faixa, sem número solto", async () => {
  const catalogo = await readFile(
    path.resolve(import.meta.dirname, "../packages/intelligence/src/catalog.mjs"),
    "utf8",
  );
  assert.match(
    catalogo,
    /requireText\(instructions, "instructions\.md", errors, \{ min: INSTRUCTIONS_MIN, max: INSTRUCTIONS_MAX \}\)/,
    "catalog.mjs voltou a carregar o número à mão em vez de importar o limite",
  );
});

test("a tela de habilidade privada grava o campo com o nome que o banco lê", async () => {
  const tela = await readFile(
    path.resolve(import.meta.dirname, "../apps/emyleads/src/page/telas/Inteligencia.jsx"),
    "utf8",
  );
  assert.match(tela, /instructionsMarkdown: instrucoes/, "o spec da tela não carrega instructionsMarkdown");
  assert.match(tela, /!instrucoesValidas/, "publicar deixou de exigir instrução válida");
});
