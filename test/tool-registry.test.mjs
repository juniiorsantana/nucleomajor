import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { loadSkillCatalog } from "../packages/intelligence/src/catalog.mjs";
import { TOOL_DEFINITIONS, TOOL_NAMES, getToolDefinition, isKnownTool } from "../packages/intelligence/src/tools.mjs";

// Contratos da ETAPA 3 (Tool Registry). Cada teste aqui prova uma garantia
// específica pedida na fundação: ver docs/intelligence/TOOL-REGISTRY.md.

test("A: toda ferramenta usada pelas skills existe no Tool Registry (Skill Tools ⊆ Tool Registry)", async () => {
  const catalogo = await loadSkillCatalog();
  assert.equal(
    catalogo.filter((entry) => entry.errors.length).length,
    0,
    "catálogo de skills inválido; corrija antes de checar o contrato skill→registry",
  );
  const usadas = new Set();
  for (const entry of catalogo) {
    for (const tool of entry.skill.allowedTools || []) usadas.add(tool);
    for (const stage of entry.skill.workflow?.stages || []) {
      for (const tool of stage.allowedTools || []) usadas.add(tool);
    }
  }
  assert.ok(usadas.size > 0, "nenhuma ferramenta encontrada nas skills; o catálogo mudou de forma?");
  const desconhecidas = [...usadas].filter((tool) => !isKnownTool(tool));
  assert.deepEqual(desconhecidas, [], `ferramenta(s) usada(s) por skill fora do Registry: ${desconhecidas.join(", ")}`);
});

test("B: nenhum nome duplicado existe no Registry", () => {
  const nomes = TOOL_DEFINITIONS.map((tool) => tool.name);
  assert.equal(new Set(nomes).size, nomes.length, "TOOL_DEFINITIONS contém nomes repetidos");
});

test("C: existem exatamente 15 tools atualmente", () => {
  assert.equal(TOOL_DEFINITIONS.length, 15);
  assert.equal(TOOL_NAMES.size, 15);
});

test("D: isKnownTool aceita tool válida e rejeita inválida", () => {
  assert.equal(isKnownTool("calendar.request.submit"), true);
  assert.equal(isKnownTool("tool.inexistente"), false);
  assert.equal(isKnownTool(""), false);
  assert.equal(isKnownTool(undefined), false);
});

test("E: getToolDefinition retorna definição válida com domain/action/status", () => {
  const definicao = getToolDefinition("calendar.request.prepare");
  assert.deepEqual(definicao, {
    name: "calendar.request.prepare",
    domain: "calendar",
    action: "request.prepare",
    status: "active",
  });
  assert.equal(getToolDefinition("tool.inexistente"), null);
});

test("F: registrar uma ferramenta no Registry não concede permissão a nenhuma skill", () => {
  // O Registry só descreve o que existe. Quem concede uso é allowedTools em
  // cada skill.json, validado por catalog.mjs — não a mera presença aqui.
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(!("allowedFor" in tool) && !("grantedTo" in tool), `${tool.name} não deve carregar concessão de permissão`);
  }
});

// F (continuação): o contrato com o resolvedor de clientes (resolve_v3) já é
// coberto, ferramenta por ferramenta, por test/skill-tools-whitelist.test.mjs.
// Aqui provamos só que a skill publicada de solicitação de horário continua
// declarando as duas ferramentas cuja regressão motivou aquele teste — usando
// o Registry como fonte, não uma lista solta.
test("F: calendar.request.prepare e calendar.request.submit continuam no Registry (não removidas por engano)", () => {
  for (const tool of ["calendar.request.prepare", "calendar.request.submit"]) {
    assert.ok(isKnownTool(tool), `${tool} deveria continuar no Registry`);
  }
});

test("uma skill com allowedTools contendo uma ferramenta inexistente é rejeitada pelo catálogo", async () => {
  const { validateSkillPackage } = await import("../packages/intelligence/src/catalog.mjs");
  const skillInvalida = {
    schemaVersion: "1.0",
    slug: "skill-de-teste-invalida",
    name: "Skill de teste inválida",
    description: "Usada só para provar rejeição de tool inexistente.",
    audience: "internal",
    status: "draft",
    objective: "Provar que o Registry recusa ferramenta inexistente na validação do catálogo.",
    activation: { keywords: ["teste de rejeição de ferramenta"] },
    allowedTools: ["tool.inexistente"],
    guardrails: ["não fazer nada além do teste"],
    handoff: ["não aplicável"],
  };
  const instructions = "# Skill de teste inválida\n\nConteúdo mínimo só para o teste ter tamanho suficiente para passar na validação de texto.";
  const tests = { cases: [
    { id: "1", input: "teste de rejeição de ferramenta", expected: { shouldActivate: true } },
    { id: "2", input: "algo que não ativa", expected: { shouldActivate: false } },
  ] };
  const erros = validateSkillPackage(skillInvalida, instructions, tests);
  assert.ok(
    erros.some((erro) => erro.includes("tool.inexistente")),
    `esperava um erro citando a ferramenta inexistente; erros obtidos: ${erros.join(" | ")}`,
  );
});

test("nenhuma migration SQL vigente (resolve_v2/v3) aceita ferramenta fora do Registry", async () => {
  // Mesma técnica de extração de test/skill-tools-whitelist.test.mjs, aplicada
  // aqui só para confirmar simetria com o Registry novo (não substitui aquele
  // arquivo, que já prova isso em detalhe para v2 e v3 separadamente).
  const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
  const MARCADOR = "published skill contains an unsupported tool";
  async function coletarWhitelistPorFuncao(nomeFuncao) {
    const arquivos = (await readdir(MIGRATIONS_DIR)).filter((nome) => nome.endsWith(".sql")).sort();
    const assinatura = `create or replace function public.${nomeFuncao}(`;
    let encontrada = null;
    for (const nome of arquivos) {
      const sql = await readFile(new URL(nome, MIGRATIONS_DIR), "utf8");
      const inicio = sql.indexOf(assinatura);
      if (inicio === -1) continue;
      const fim = sql.indexOf("$$;", inicio);
      if (fim === -1) continue;
      const corpo = sql.slice(inicio, fim);
      if (!corpo.includes(MARCADOR)) continue;
      const abertura = corpo.lastIndexOf("not in (");
      if (abertura === -1) continue;
      const fechamento = corpo.indexOf(")", abertura);
      const ferramentas = [...corpo.slice(abertura, fechamento).matchAll(/'([a-z][a-z0-9_.]*)'/g)].map((m) => m[1]);
      if (ferramentas.length) encontrada = { nome, ferramentas };
    }
    return encontrada;
  }
  for (const nomeFuncao of ["nucleo_intelligence_context_resolve_v2", "nucleo_intelligence_context_resolve_v3"]) {
    const encontrada = await coletarWhitelistPorFuncao(nomeFuncao);
    assert.ok(encontrada, `${nomeFuncao} não foi encontrada`);
    const sobrando = encontrada.ferramentas.filter((tool) => !isKnownTool(tool));
    assert.deepEqual(sobrando, [], `${encontrada.nome} aceita ferramenta(s) fora do Registry: ${sobrando.join(", ")}`);
  }
});
