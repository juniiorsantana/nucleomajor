import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ALLOWED_FIELDS,
  RUNTIME_TOOLS,
  SCHEMA_VERSIONS,
  detectarCiclosDeDelegacao,
  loadSkillCatalog,
} from "../packages/intelligence/src/catalog.mjs";

const SCHEMA = new URL("../packages/intelligence/skills/skill.schema.json", import.meta.url);
const schema = JSON.parse(await readFile(SCHEMA, "utf8"));

/**
 * O `skill.schema.json` é o que o editor lê enquanto alguém digita; o validador
 * de verdade é `catalog.mjs`. Os dois divergiram em silêncio: o schema fixava
 * `schemaVersion: {"const": "1.0"}` com `additionalProperties: false` e não
 * conhecia `routing` nem `workflow`, enquanto as sete skills declaravam "1.1" e
 * usavam os dois campos. Resultado: todo editor marcava as sete como inválidas
 * — justamente o sinal que deveria proteger quem edita à mão.
 *
 * Estes testes não validam JSON Schema (não há validador no projeto). Eles
 * comparam schema e validador campo a campo, que é a divergência que machuca.
 */

test("o schema aceita as duas versões que o validador aceita", () => {
  assert.deepEqual(new Set(schema.properties.schemaVersion.enum), SCHEMA_VERSIONS);
  // A regressão exata que existia: `const: "1.0"` rejeitando o catálogo inteiro.
  assert.ok(!("const" in schema.properties.schemaVersion), "schemaVersion não pode ser fixo em uma versão");
});

test("os campos de topo do schema são os mesmos que o validador admite", () => {
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...ALLOWED_FIELDS].sort(),
  );
});

test("a lista de ferramentas do schema é a lista fechada do runtime", () => {
  // Markdown pode orientar o uso de uma destas; não pode criar outra nem
  // liberar permissão. Se o schema permitisse um nome a mais, o editor
  // aprovaria uma skill que o `catalog.mjs` e o resolver do banco recusam.
  const doSchema = schema.$defs.ferramentas.items.enum;
  assert.deepEqual([...doSchema].sort(), [...RUNTIME_TOOLS].sort());
  assert.deepEqual(schema.properties.allowedTools.$ref, "#/$defs/ferramentas");
  assert.deepEqual(
    schema.properties.workflow.properties.stages.items.properties.allowedTools.$ref,
    "#/$defs/ferramentas",
  );
});

test("routing e workflow existem no schema, com os campos do validador", () => {
  assert.deepEqual(Object.keys(schema.properties.routing.properties).sort(), ["fallback", "intent", "priority"]);
  assert.deepEqual(Object.keys(schema.properties.workflow.properties).sort(), ["delegatesTo", "initialStage", "stages"]);
  assert.deepEqual(
    Object.keys(schema.properties.workflow.properties.stages.items.properties).sort(),
    ["allowedTools", "completion", "id", "objective", "requiredFields"],
  );
  assert.deepEqual(Object.keys(schema.properties.activation.properties).sort(), ["keywords", "negativeKeywords"]);
});

test("nenhuma skill do catálogo usa campo que o schema desconhece", async () => {
  const catalogo = await loadSkillCatalog({});
  const conhecidos = new Set(Object.keys(schema.properties));
  for (const entrada of catalogo) {
    for (const campo of Object.keys(entrada.skill)) {
      assert.ok(conhecidos.has(campo), `${entrada.skill.slug}: campo "${campo}" não está no schema`);
    }
    for (const etapa of entrada.skill.workflow?.stages || []) {
      for (const campo of Object.keys(etapa)) {
        const permitidos = Object.keys(schema.properties.workflow.properties.stages.items.properties);
        assert.ok(permitidos.includes(campo), `${entrada.skill.slug}: etapa com campo "${campo}" fora do schema`);
      }
    }
  }
});

test("todas as skills apontam o $schema para este arquivo", async () => {
  const catalogo = await loadSkillCatalog({});
  for (const entrada of catalogo) {
    assert.equal(entrada.skill.$schema, "../skill.schema.json", entrada.skill.slug);
  }
});

test("o catálogo publicado não tem ciclo de delegação", async () => {
  assert.deepEqual(detectarCiclosDeDelegacao(await loadSkillCatalog({})), []);
});

test("um ciclo direto é detectado", () => {
  // Duas skills apontando uma para a outra viram laço em produção: cada
  // rodada troca a skill ativa e o modelo recomeça o fluxo.
  const ciclos = detectarCiclosDeDelegacao([
    { skill: { slug: "a", workflow: { delegatesTo: ["b"] } } },
    { skill: { slug: "b", workflow: { delegatesTo: ["a"] } } },
  ]);
  assert.equal(ciclos.length, 1);
  assert.match(ciclos[0], /a → b → a|b → a → b/);
});

test("um ciclo indireto também é detectado", () => {
  const ciclos = detectarCiclosDeDelegacao([
    { skill: { slug: "a", workflow: { delegatesTo: ["b"] } } },
    { skill: { slug: "b", workflow: { delegatesTo: ["c"] } } },
    { skill: { slug: "c", workflow: { delegatesTo: ["a"] } } },
  ]);
  assert.equal(ciclos.length, 1);
  assert.match(ciclos[0], /→ a$|→ b$|→ c$/);
});

test("delegação para skill que ainda não existe não é ciclo", () => {
  // O catálogo pode ser publicado por partes; uma referência que ainda não
  // existe apenas não é seguida.
  assert.deepEqual(
    detectarCiclosDeDelegacao([{ skill: { slug: "a", workflow: { delegatesTo: ["fantasma"] } } }]),
    [],
  );
});

test("uma skill que delega para si mesma é ciclo", () => {
  const ciclos = detectarCiclosDeDelegacao([{ skill: { slug: "a", workflow: { delegatesTo: ["a"] } } }]);
  assert.deepEqual(ciclos, ["a → a"]);
});

test("um losango sem ciclo não é falso positivo", () => {
  // a → b → d e a → c → d: `d` é visitado duas vezes por caminhos
  // diferentes, e isso não é ciclo.
  assert.deepEqual(
    detectarCiclosDeDelegacao([
      { skill: { slug: "a", workflow: { delegatesTo: ["b", "c"] } } },
      { skill: { slug: "b", workflow: { delegatesTo: ["d"] } } },
      { skill: { slug: "c", workflow: { delegatesTo: ["d"] } } },
      { skill: { slug: "d", workflow: { delegatesTo: [] } } },
    ]),
    [],
  );
});
