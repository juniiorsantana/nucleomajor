import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidCatalog,
  canonicalJson,
  loadSkillCatalog,
  validateSkillPackage,
} from "../packages/intelligence/src/catalog.mjs";
import { publishCatalog } from "../packages/intelligence/src/publisher.mjs";

test("catálogo oficial possui quatro skills válidas e instruções versionáveis", async () => {
  const catalog = assertValidCatalog(await loadSkillCatalog());
  assert.deepEqual(catalog.map((entry) => entry.record.slug), ["agenda", "pre-qualificacao", "suporte", "vendas"]);
  for (const entry of catalog) {
    assert.equal(entry.record.owner_type, "platform");
    assert.match(entry.record.spec.instructionsMarkdown, /^# /);
    assert.match(entry.record.spec.source.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(entry.record.spec.source.path, `packages/intelligence/skills/${entry.record.slug}`);
  }
});

test("validador rejeita campos desconhecidos e testes incompatíveis com gatilhos", () => {
  const errors = validateSkillPackage({
    schemaVersion: "1.0",
    slug: "teste",
    name: "Teste",
    description: "Skill de teste",
    audience: "customer",
    status: "draft",
    objective: "Validar um pacote de teste completo.",
    activation: { keywords: ["comprar"], extra: true },
    requiredFields: [],
    questions: [],
    allowedTools: ["crm.contact.read"],
    guardrails: ["safe"],
    handoff: ["low_confidence"],
    unexpected: true,
  }, "# Teste\n\nInstruções suficientemente longas para validar corretamente este pacote de desenvolvimento.", {
    cases: [
      { id: "positivo", input: "quero comprar", expected: { shouldActivate: false } },
      { id: "negativo", input: "preciso de suporte", expected: { shouldActivate: false } },
    ],
  });
  assert.ok(errors.some((error) => error.includes("unexpected")));
  assert.ok(errors.some((error) => error.includes("activation: extra")));
  assert.ok(errors.some((error) => error.includes("não corresponde aos gatilhos")));
});

test("publicação é simulação por padrão e não grava", async () => {
  const [entry] = assertValidCatalog(await loadSkillCatalog({ slug: "agenda" }));
  const writes = [];
  const repository = {
    async findPlatformSkill() {
      return { id: "skill-id", current_version: 3, name: "Agenda antiga", description: "Antiga", audience: "both", status: "published", spec: {} };
    },
    async insert(record) { writes.push(["insert", record]); },
    async update(id, record) { writes.push(["update", id, record]); },
  };
  const results = await publishCatalog([entry], repository);
  assert.deepEqual(writes, []);
  assert.equal(results[0].action, "update");
  assert.equal(results[0].dryRun, true);
});

test("publicação aplicada atualiza somente conteúdo diferente", async () => {
  const [entry] = assertValidCatalog(await loadSkillCatalog({ slug: "vendas" }));
  const writes = [];
  let current = { id: "skill-id", current_version: 7, name: "Vendas antiga", description: "Antiga", audience: "customer", status: "published", spec: {} };
  const repository = {
    async findPlatformSkill() { return current; },
    async insert() { throw new Error("não deveria inserir"); },
    async update(id, record) {
      writes.push([id, record]);
      current = { id, current_version: 8, ...record };
      return current;
    },
  };
  const updated = await publishCatalog([entry], repository, { apply: true });
  assert.equal(updated[0].version, 8);
  assert.equal(writes.length, 1);
  const unchanged = await publishCatalog([entry], repository, { apply: true });
  assert.equal(unchanged[0].action, "unchanged");
  assert.equal(writes.length, 1);
  assert.equal(canonicalJson(current.spec), canonicalJson(entry.record.spec));
});

