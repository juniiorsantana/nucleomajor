// A chave de telefone do banco (`private.br_phone_key`, 20261020110000) casa os
// mesmos contatos que `variantesBR` do portal.
//
// A tabela `supabase/provas/casos-telefone-br.json` diz, para cada entrada, a
// chave que o banco tem que devolver. Aqui a tabela é conferida contra o
// portal; em `supabase/provas/prova-escala-banco.mjs` (PGlite) e em
// `supabase/provas/conferir-escala-banco.sql` (produção), contra a função SQL.
// Juntas, as duas provam a equivalência sem que uma reimplemente a outra.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePhone, variantesBR } from "../apps/emyleads/src/lib/phone.js";

const raiz = new URL("../", import.meta.url);
const { casos } = JSON.parse(readFileSync(new URL("supabase/provas/casos-telefone-br.json", raiz), "utf8"));

test("a tabela tem casos de sobra para o nono dígito", () => {
  assert.ok(casos.length >= 40, `só ${casos.length} casos`);
  assert.ok(casos.some((c) => c.chave === null), "nenhum caso inválido");
  assert.ok(casos.some((c) => c.chave && !c.chave.startsWith("55")), "nenhum caso internacional");
});

test("chave nula exatamente quando variantesBR não acha forma nenhuma", () => {
  for (const { entrada, chave } of casos) {
    assert.equal(chave === null, variantesBR(entrada).length === 0, JSON.stringify(entrada));
  }
});

test("a chave é uma das formas de variantesBR", () => {
  for (const { entrada, chave } of casos) {
    if (chave === null) continue;
    assert.ok(variantesBR(entrada).includes(chave), `${JSON.stringify(entrada)} → ${chave} não está em ${variantesBR(entrada)}`);
  }
});

test("dois telefones casam no portal se e só se a chave é a mesma", () => {
  let casam = 0;
  for (const a of casos) {
    for (const b of casos) {
      const formas = new Set(variantesBR(a.entrada));
      const portal = variantesBR(b.entrada).some((forma) => formas.has(forma));
      const banco = a.chave !== null && a.chave === b.chave;
      assert.equal(banco, portal, `${JSON.stringify(a.entrada)} × ${JSON.stringify(b.entrada)}`);
      if (portal && a !== b) casam += 1;
    }
  }
  assert.ok(casam > 20, `poucos pares que casam (${casam}): a tabela não exercita o nono dígito`);
});

test("o desempate do banco prefere o telefone igual, como o portal", () => {
  // Conversa com 9 e dois contatos (com e sem o 9): o portal procura primeiro
  // a forma canônica da conversa, que só o contato com o 9 tem.
  const conversa = "5565912345678";
  const [canonica] = variantesBR(conversa);
  assert.equal(canonica, normalizePhone(conversa));
  assert.ok(!variantesBR("556512345678").includes(canonica));
  assert.ok(variantesBR("5565912345678").includes(canonica));
});

test("a conferência de produção carrega a mesma tabela", () => {
  const sql = readFileSync(new URL("supabase/provas/conferir-escala-banco.sql", raiz), "utf8").replace(/\r/g, "");
  const embutida = sql.match(/\$casos\$([\s\S]*?)\$casos\$/);
  assert.ok(embutida, "conferir-escala-banco.sql sem o bloco $casos$");
  assert.deepEqual(JSON.parse(embutida[1]).casos, casos);
});
