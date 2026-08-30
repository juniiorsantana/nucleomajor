import assert from "node:assert/strict";
import test from "node:test";
import { contextoParaPrompt } from "../src/intelligenceContext.mjs";
import { loadSkillCatalog } from "../packages/intelligence/src/catalog.mjs";

/** Um payload como `private.intelligence_payload` monta, com specs de verdade. */
async function payloadRealista() {
  const catalogo = await loadSkillCatalog({});
  const skills = catalogo.map((entrada, indice) => ({
    id: `skill-${indice}`,
    slug: entrada.skill.slug,
    nome: entrada.skill.name,
    descricao: entrada.skill.description,
    versao: indice + 1,
    spec: entrada.record.spec,
    prioridade: indice * 10,
    configuracao: {},
  }));
  const ativa = skills.find((item) => item.slug === "tarefas") || skills[0];
  return {
    schemaVersion: "fase-h-1",
    contextoId: "11111111-2222-3333-4444-555555555555",
    audiencia: "internal",
    assistente: {
      id: "perfil-1",
      nome: "Assistente Major",
      tom: "direto e cordial",
      marca: { cor: "#5946ff", logo: "…" },
      processo: { etapas: ["saudar", "resolver"] },
      templateId: "tpl-1",
    },
    campanha: null,
    skillAtivo: { id: ativa.id, slug: ativa.slug, nome: ativa.nome, versao: ativa.versao, spec: ativa.spec },
    skillsPermitidos: skills,
    colecoesPermitidas: [
      { id: "col-1", nome: "Processos internos", escopo: "organization", audiencia: "internal" },
    ],
    politicas: {
      organizacaoDerivada: true,
      confirmacaoParaEscrita: true,
      documentosComoDados: true,
      transferenciaHumana: false,
    },
  };
}

test("o corpo das skills sai do prompt e o essencial fica", async () => {
  const payload = await payloadRealista();
  const enxuto = contextoParaPrompt(payload);

  assert.equal(enxuto.audiencia, "internal");
  assert.equal(enxuto.assistente.nome, "Assistente Major");
  assert.equal(enxuto.assistente.tom, "direto e cordial");
  assert.equal(enxuto.skillAtiva.nome, "Tarefas");
  assert.ok(enxuto.skillAtiva.objetivo.length > 10);
  assert.ok(enxuto.skillAtiva.limites.length >= 1, "guardrails são limites de comportamento e ficam");
  assert.deepEqual(enxuto.conhecimentoAlcancavel, ["Processos internos"]);
  assert.equal(enxuto.skillsDisponiveis.length, payload.skillsPermitidos.length);
  assert.ok(enxuto.skillsDisponiveis.includes("Agenda"));
  assert.equal(enxuto.politicas.confirmacaoParaEscrita, true);
});

test("nenhuma instrução de skill sobrevive à poda", async () => {
  const payload = await payloadRealista();
  const serializado = JSON.stringify(contextoParaPrompt(payload));

  // O que mais pesava: `instructionsMarkdown` de TODAS as skills habilitadas,
  // mais o `spec` da ativa repetido. Nada disso muda a resposta de um
  // assistente cujas ferramentas são `ler_documento` e `propor_evento`.
  assert.ok(!serializado.includes("instructionsMarkdown"), "instruções não podem ir ao prompt");
  assert.ok(!serializado.includes("workflow"), "o workflow é do runtime de WhatsApp");
  assert.ok(!serializado.includes("initialStage"));
  assert.ok(!serializado.includes("contentHash"));
  assert.ok(!serializado.includes("activation"));
  // Identificadores internos não dizem nada ao modelo e ainda convidam a
  // inventá-los numa resposta.
  assert.ok(!serializado.includes("contextoId"));
  assert.ok(!serializado.includes("11111111-2222"));
});

test("a poda corta pelo menos 90% dos bytes", async () => {
  const payload = await payloadRealista();
  const antes = JSON.stringify(payload).length;
  const depois = JSON.stringify(contextoParaPrompt(payload)).length;

  assert.ok(antes > 20000, `o payload real precisa ser grande para o teste valer (${antes})`);
  assert.ok(
    depois < antes * 0.1,
    `esperado menos de 10% dos bytes; antes ${antes}, depois ${depois} (${Math.round((depois / antes) * 100)}%)`,
  );
});

test("campanha entra sem o jsonb livre de configuração", () => {
  const enxuto = contextoParaPrompt({
    audiencia: "customer",
    campanha: {
      id: "camp-1",
      nome: "Captação agosto",
      objetivo: "Agendar diagnóstico",
      oferta: "Diagnóstico gratuito",
      publico: "Clínicas",
      resultadoEsperado: "Reunião marcada",
      configuracao: { webhook: "https://exemplo", segredo: "nao-pode-vazar" },
    },
  });

  assert.equal(enxuto.campanha.nome, "Captação agosto");
  assert.equal(enxuto.campanha.oferta, "Diagnóstico gratuito");
  assert.ok(!("configuracao" in enxuto.campanha));
  assert.ok(!JSON.stringify(enxuto).includes("nao-pode-vazar"));
});

test("payload ausente ou vazio não vira linha no prompt", () => {
  // Escrever "Contexto de inteligência autorizado: {}" gasta tokens para
  // afirmar nada, e o modelo tem de decidir o que fazer com um objeto vazio.
  for (const entrada of [null, undefined, {}, "texto", 42, []]) {
    assert.equal(contextoParaPrompt(entrada), null, `entrada ${JSON.stringify(entrada)}`);
  }
});

test("chave sem valor não ocupa espaço", () => {
  const enxuto = contextoParaPrompt({
    audiencia: "internal",
    assistente: { nome: "Assistente", tom: "" },
    campanha: null,
    skillAtivo: null,
    skillsPermitidos: [],
    colecoesPermitidas: [],
  });

  assert.deepEqual(Object.keys(enxuto).sort(), ["assistente", "audiencia"]);
  assert.deepEqual(enxuto.assistente, { nome: "Assistente" });
});

test("skill ativa sem spec não quebra e não inventa campo", () => {
  const enxuto = contextoParaPrompt({
    audiencia: "internal",
    skillAtivo: { id: "s1", slug: "recepcao", nome: "Recepção", versao: 1 },
  });
  assert.deepEqual(enxuto.skillAtiva, { nome: "Recepção" });
});
