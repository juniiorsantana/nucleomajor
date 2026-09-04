import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { IntelligenceCoreError, resolveIntelligence } from "../packages/intelligence/src/core.mjs";
import { validateIntelligenceResolution } from "../packages/intelligence/src/contracts/intelligence-resolution.mjs";

const FIXTURES_DIR = new URL("./fixtures/intelligence/", import.meta.url);

async function loadFixture(nome) {
  return JSON.parse(await readFile(new URL(nome, FIXTURES_DIR), "utf8"));
}

// Fake Resolver Port: nenhuma dependência de Supabase/rede. Prova o
// isolamento pedido pela ETAPA 5 — o Core inteiro é testável só com isto.
function createFakeResolver({ v2, v3 } = {}) {
  const calls = { v2: 0, v3: 0 };
  return {
    calls,
    async resolveV2(request) {
      calls.v2 += 1;
      if (v2 instanceof Error) throw v2;
      return typeof v2 === "function" ? v2(request) : v2;
    },
    async resolveV3(request) {
      calls.v3 += 1;
      if (v3 instanceof Error) throw v3;
      return typeof v3 === "function" ? v3(request) : v3;
    },
  };
}

test("A: request inválido rejeita cedo — o resolver nem é chamado", async () => {
  const fake = createFakeResolver({ v2: {}, v3: {} });
  await assert.rejects(
    () => resolveIntelligence({ audience: "internal" }, { resolverVersion: "v2" }, { resolver: fake }),
    (error) => error instanceof IntelligenceCoreError && error.code === "INVALID_REQUEST",
  );
  assert.equal(fake.calls.v2, 0);
  assert.equal(fake.calls.v3, 0);
});

test("B: resolverVersion v2 chama só resolveV2 e devolve a Resolution adaptada", async () => {
  const fixture = await loadFixture("tarefa-v2-interna.json");
  const fake = createFakeResolver({ v2: fixture.payload });
  const resolution = await resolveIntelligence(fixture.request, { resolverVersion: "v2" }, { resolver: fake });
  assert.equal(fake.calls.v2, 1);
  assert.equal(fake.calls.v3, 0);
  assert.deepEqual(validateIntelligenceResolution(resolution), []);
  assert.equal(resolution.skill.slug, "tarefas");
  assert.equal(resolution.stage, null); // v2 nunca expõe stage
});

test("C: resolverVersion v3 chama só resolveV3 e devolve a Resolution adaptada", async () => {
  const fixture = await loadFixture("recepcao-v3-primeiro-contato.json");
  const fake = createFakeResolver({ v3: fixture.payload });
  const resolution = await resolveIntelligence(fixture.request, { resolverVersion: "v3" }, { resolver: fake });
  assert.equal(fake.calls.v3, 1);
  assert.equal(fake.calls.v2, 0);
  assert.deepEqual(validateIntelligenceResolution(resolution), []);
  assert.equal(resolution.skill.slug, "recepcao");
  assert.equal(resolution.stage.id, "acolher");
});

test("D: payload inválido vindo do resolver é rejeitado como INVALID_RESOLVER_PAYLOAD", async () => {
  const fixture = await loadFixture("tarefa-v2-interna.json");
  const fake = createFakeResolver({ v2: null }); // sem runtimeContext.audience → Resolution inválida
  await assert.rejects(
    () => resolveIntelligence(fixture.request, { resolverVersion: "v2" }, { resolver: fake }),
    (error) => error instanceof IntelligenceCoreError && error.code === "INVALID_RESOLVER_PAYLOAD" && error.details?.length > 0,
  );
});

test("E: ferramenta desconhecida devolvida pelo resolver é rejeitada via Tool Registry", async () => {
  const fixture = await loadFixture("tarefa-v2-interna.json");
  const payloadComToolInvalida = structuredClone(fixture.payload);
  payloadComToolInvalida.runtimeContext.activeSkill.allowedTools.push("tool.inexistente");
  const fake = createFakeResolver({ v2: payloadComToolInvalida });
  await assert.rejects(
    () => resolveIntelligence(fixture.request, { resolverVersion: "v2" }, { resolver: fake }),
    (error) =>
      error instanceof IntelligenceCoreError &&
      error.code === "INVALID_RESOLVER_PAYLOAD" &&
      error.details.some((detalhe) => detalhe.includes("tool.inexistente")),
  );
});

test("F: falha do resolver vira RESOLVER_UNAVAILABLE, com a causa original preservada em .cause (não em .message)", async () => {
  const fixture = await loadFixture("tarefa-v2-interna.json");
  const erroOriginal = new Error("timeout de rede ao chamar o Supabase — detalhe interno");
  const fake = createFakeResolver({ v2: erroOriginal });
  await assert.rejects(
    () => resolveIntelligence(fixture.request, { resolverVersion: "v2" }, { resolver: fake }),
    (error) => {
      assert.ok(error instanceof IntelligenceCoreError);
      assert.equal(error.code, "RESOLVER_UNAVAILABLE");
      assert.equal(error.cause, erroOriginal);
      assert.ok(!error.message.includes("timeout de rede"), "detalhe interno não deve vazar em .message");
      return true;
    },
  );
});

test("G: sourceSchemaVersion da Resolution preserva o valor original do payload", async () => {
  const v2Fixture = await loadFixture("tarefa-v2-interna.json");
  const v2Resolution = await resolveIntelligence(v2Fixture.request, { resolverVersion: "v2" }, { resolver: createFakeResolver({ v2: v2Fixture.payload }) });
  assert.equal(v2Resolution.sourceSchemaVersion, "fase-h-2");

  const v3Fixture = await loadFixture("solicitacao-agenda-v3-pendente.json");
  const v3Resolution = await resolveIntelligence(v3Fixture.request, { resolverVersion: "v3" }, { resolver: createFakeResolver({ v3: v3Fixture.payload }) });
  assert.equal(v3Resolution.sourceSchemaVersion, "fase-h-3");
});

test("H: o Core não muta o IntelligenceRequest de entrada", async () => {
  const fixture = await loadFixture("recepcao-v3-primeiro-contato.json");
  const original = structuredClone(fixture.request);
  const fake = createFakeResolver({ v3: fixture.payload });
  await resolveIntelligence(fixture.request, { resolverVersion: "v3" }, { resolver: fake });
  assert.deepEqual(fixture.request, original);
});

test("resolverVersion fora de v2/v3 é rejeitado como UNSUPPORTED_RESOLVER_VERSION, sem chamar o resolver", async () => {
  const fixture = await loadFixture("tarefa-v2-interna.json");
  const fake = createFakeResolver({ v2: fixture.payload });
  await assert.rejects(
    () => resolveIntelligence(fixture.request, { resolverVersion: "shadow" }, { resolver: fake }),
    (error) => error instanceof IntelligenceCoreError && error.code === "UNSUPPORTED_RESOLVER_VERSION",
  );
  assert.equal(fake.calls.v2, 0);
});

test("resolver ausente/malformado é rejeitado como RESOLVER_UNAVAILABLE", async () => {
  const fixture = await loadFixture("tarefa-v2-interna.json");
  await assert.rejects(
    () => resolveIntelligence(fixture.request, { resolverVersion: "v2" }, { resolver: { resolveV2: "não é função" } }),
    (error) => error instanceof IntelligenceCoreError && error.code === "RESOLVER_UNAVAILABLE",
  );
  await assert.rejects(
    () => resolveIntelligence(fixture.request, { resolverVersion: "v2" }, {}),
    (error) => error instanceof IntelligenceCoreError && error.code === "RESOLVER_UNAVAILABLE",
  );
});
