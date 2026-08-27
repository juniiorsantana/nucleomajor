import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SKILLS_DIR = path.resolve(HERE, "../skills");

const AUDIENCES = new Set(["internal", "customer", "both"]);
const STATUSES = new Set(["draft", "published", "archived"]);
export const RUNTIME_TOOLS = new Set([
  "knowledge.search",
  "crm.contact.read",
  "crm.contact.upsert",
  "crm.tag.apply",
  "crm.deal.qualify",
  "conversation.handoff",
  "calendar.read",
  "calendar.availability",
  "calendar.prepare",
  "calendar.confirm",
  "calendar.request.prepare",
  "calendar.request.submit",
  "task.read",
  "task.prepare",
  "task.confirm",
]);
const SCHEMA_VERSIONS = new Set(["1.0", "1.1"]);
const STAGE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_FIELDS = new Set([
  "$schema", "schemaVersion", "slug", "name", "description", "audience", "status",
  "objective", "activation", "routing", "workflow", "requiredFields", "questions", "allowedTools", "guardrails", "handoff",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, field, errors, { min = 1, max = Infinity } = {}) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    errors.push(`${field} deve ser um texto entre ${min} e ${max === Infinity ? "∞" : max} caracteres`);
  }
}

function requireStringArray(value, field, errors, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${field} deve ser uma lista com pelo menos ${min} texto(s)`);
    return;
  }
  const normalized = value.map((item) => item.trim().toLocaleLowerCase("pt-BR"));
  if (new Set(normalized).size !== normalized.length) errors.push(`${field} não pode conter valores duplicados`);
}

export function normalizeTriggerText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function evaluateSkillActivation(skill, input) {
  const normalized = normalizeTriggerText(input);
  const keywords = (skill?.activation?.keywords || []).map(normalizeTriggerText);
  const negativeKeywords = (skill?.activation?.negativeKeywords || []).map(normalizeTriggerText);
  const blocked = negativeKeywords.some((keyword) => keyword && normalized.includes(keyword));
  const matches = keywords.filter((keyword) => keyword && normalized.includes(keyword));
  return {
    shouldActivate: !blocked && matches.length > 0,
    fallback: Boolean(skill?.routing?.fallback),
    score: blocked ? -1 : matches.length,
    matches,
  };
}

function validateWorkflow(skill, errors) {
  if (skill.schemaVersion === "1.0") return;
  if (!isObject(skill.routing)) errors.push("routing deve ser um objeto no schema 1.1");
  else {
    for (const field of Object.keys(skill.routing)) {
      if (!new Set(["intent", "priority", "fallback"]).has(field)) errors.push(`campo não reconhecido em routing: ${field}`);
    }
    requireText(skill.routing.intent, "routing.intent", errors, { min: 2, max: 100 });
    if (!Number.isInteger(skill.routing.priority) || skill.routing.priority < 0 || skill.routing.priority > 1000) {
      errors.push("routing.priority deve ser um inteiro entre 0 e 1000");
    }
    if (typeof skill.routing.fallback !== "boolean") errors.push("routing.fallback deve ser booleano");
  }
  if (!isObject(skill.workflow)) errors.push("workflow deve ser um objeto no schema 1.1");
  else {
    for (const field of Object.keys(skill.workflow)) {
      if (!new Set(["initialStage", "stages", "delegatesTo"]).has(field)) errors.push(`campo não reconhecido em workflow: ${field}`);
    }
    if (typeof skill.workflow.initialStage !== "string" || !STAGE_PATTERN.test(skill.workflow.initialStage)) {
      errors.push("workflow.initialStage possui formato inválido");
    }
    requireStringArray(skill.workflow.delegatesTo ?? [], "workflow.delegatesTo", errors);
    if (!Array.isArray(skill.workflow.stages) || !skill.workflow.stages.length) {
      errors.push("workflow.stages deve conter pelo menos uma etapa");
    } else {
      const ids = new Set();
      for (const [index, stage] of skill.workflow.stages.entries()) {
        const prefix = `workflow.stages[${index}]`;
        if (!isObject(stage)) { errors.push(`${prefix} deve ser um objeto`); continue; }
        for (const field of Object.keys(stage)) {
          if (!new Set(["id", "objective", "requiredFields", "allowedTools", "completion"]).has(field)) errors.push(`campo não reconhecido em ${prefix}: ${field}`);
        }
        if (typeof stage.id !== "string" || !STAGE_PATTERN.test(stage.id)) errors.push(`${prefix}.id possui formato inválido`);
        if (ids.has(stage.id)) errors.push(`${prefix}.id está duplicado`);
        ids.add(stage.id);
        requireText(stage.objective, `${prefix}.objective`, errors, { min: 10, max: 500 });
        requireStringArray(stage.requiredFields ?? [], `${prefix}.requiredFields`, errors);
        requireStringArray(stage.allowedTools ?? [], `${prefix}.allowedTools`, errors);
        if (Array.isArray(stage.allowedTools)) {
          for (const tool of stage.allowedTools) {
            if (!RUNTIME_TOOLS.has(tool)) errors.push(`${prefix}.allowedTools contém ferramenta desconhecida: ${tool}`);
            if (Array.isArray(skill.allowedTools) && !skill.allowedTools.includes(tool)) errors.push(`${prefix}.allowedTools amplia as ferramentas da skill: ${tool}`);
          }
        }
        requireText(stage.completion, `${prefix}.completion`, errors, { min: 3, max: 300 });
      }
      if (!ids.has(skill.workflow.initialStage)) errors.push("workflow.initialStage não existe em workflow.stages");
    }
  }
}

export function validateSkillPackage(skill, instructions, tests) {
  const errors = [];
  if (!isObject(skill)) return ["skill.json deve conter um objeto JSON"];
  for (const field of Object.keys(skill)) {
    if (!ALLOWED_FIELDS.has(field)) errors.push(`campo não reconhecido em skill.json: ${field}`);
  }
  if (!SCHEMA_VERSIONS.has(skill.schemaVersion)) errors.push("schemaVersion deve ser 1.0 ou 1.1");
  if (typeof skill.slug !== "string" || !SLUG_PATTERN.test(skill.slug)) errors.push("slug possui formato inválido");
  requireText(skill.name, "name", errors, { min: 2, max: 120 });
  requireText(skill.description, "description", errors, { min: 1, max: 1200 });
  requireText(skill.objective, "objective", errors, { min: 10, max: 1200 });
  if (!AUDIENCES.has(skill.audience)) errors.push("audience deve ser internal, customer ou both");
  if (!STATUSES.has(skill.status)) errors.push("status deve ser draft, published ou archived");
  if (!isObject(skill.activation)) errors.push("activation deve ser um objeto");
  else for (const field of Object.keys(skill.activation)) {
    if (!new Set(["keywords", "negativeKeywords"]).has(field)) errors.push(`campo não reconhecido em activation: ${field}`);
  }
  requireStringArray(skill.activation?.keywords, "activation.keywords", errors, { min: 1 });
  requireStringArray(skill.activation?.negativeKeywords ?? [], "activation.negativeKeywords", errors);
  requireStringArray(skill.requiredFields ?? [], "requiredFields", errors);
  requireStringArray(skill.questions ?? [], "questions", errors);
  requireStringArray(skill.allowedTools, "allowedTools", errors, { min: 1 });
  if (Array.isArray(skill.allowedTools)) {
    for (const tool of skill.allowedTools) {
      if (typeof tool === "string" && !RUNTIME_TOOLS.has(tool.trim())) {
        errors.push(`allowedTools contém ferramenta desconhecida: ${tool}`);
      }
    }
  }
  requireStringArray(skill.guardrails, "guardrails", errors, { min: 1 });
  requireStringArray(skill.handoff, "handoff", errors, { min: 1 });
  validateWorkflow(skill, errors);
  requireText(instructions, "instructions.md", errors, { min: 80, max: 20000 });
  if (!String(instructions || "").startsWith("# ")) errors.push("instructions.md deve começar com um título H1");

  if (!isObject(tests) || !Array.isArray(tests.cases) || tests.cases.length < 2) {
    errors.push("tests.json deve conter pelo menos dois casos");
  } else {
    const ids = new Set();
    for (const [index, testCase] of tests.cases.entries()) {
      const prefix = `tests.cases[${index}]`;
      requireText(testCase?.id, `${prefix}.id`, errors);
      requireText(testCase?.input, `${prefix}.input`, errors);
      if (ids.has(testCase?.id)) errors.push(`${prefix}.id está duplicado`);
      ids.add(testCase?.id);
      if (typeof testCase?.expected?.shouldActivate !== "boolean") {
        errors.push(`${prefix}.expected.shouldActivate deve ser booleano`);
        continue;
      }
      const activation = evaluateSkillActivation(skill, testCase.input);
      if (activation.shouldActivate !== testCase.expected.shouldActivate) {
        errors.push(`${prefix} não corresponde aos gatilhos declarados (esperado ${testCase.expected.shouldActivate}, obtido ${activation.shouldActivate})`);
      }
      if (testCase.expected.stage != null && skill.schemaVersion === "1.1") {
        const stages = new Set((skill.workflow?.stages || []).map((stage) => stage.id));
        if (!stages.has(testCase.expected.stage)) errors.push(`${prefix}.expected.stage não existe no workflow`);
      }
    }
  }
  return errors;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function buildDatabaseRecord(skill, instructions, relativeDirectory) {
  const { $schema: _schema, slug, name, description, audience, status, ...runtimeSpec } = skill;
  const sourcePayload = canonicalJson({ ...runtimeSpec, instructionsMarkdown: instructions.trim() });
  const contentHash = createHash("sha256").update(sourcePayload).digest("hex");
  return {
    owner_type: "platform",
    organization_id: null,
    slug,
    name: name.trim(),
    description: description.trim(),
    audience,
    status,
    spec: {
      ...runtimeSpec,
      instructionsMarkdown: instructions.trim(),
      source: {
        kind: "git",
        path: relativeDirectory.replaceAll("\\", "/"),
        contentHash,
      },
    },
  };
}

export async function loadSkillCatalog({ skillsDir = DEFAULT_SKILLS_DIR, slug = "" } = {}) {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && (!slug || entry.name === slug))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  if (slug && directories.length === 0) throw new Error(`Skill não encontrada: ${slug}`);

  const catalog = [];
  for (const directory of directories) {
    const absoluteDirectory = path.join(skillsDir, directory.name);
    const [skillRaw, instructions, testsRaw] = await Promise.all([
      readFile(path.join(absoluteDirectory, "skill.json"), "utf8"),
      readFile(path.join(absoluteDirectory, "instructions.md"), "utf8"),
      readFile(path.join(absoluteDirectory, "tests.json"), "utf8"),
    ]);
    let skill;
    let tests;
    try { skill = JSON.parse(skillRaw); } catch (error) { throw new Error(`${directory.name}/skill.json inválido: ${error.message}`); }
    try { tests = JSON.parse(testsRaw); } catch (error) { throw new Error(`${directory.name}/tests.json inválido: ${error.message}`); }
    const errors = validateSkillPackage(skill, instructions, tests);
    if (skill.slug && skill.slug !== directory.name) errors.push(`slug ${skill.slug} deve ser igual ao nome da pasta ${directory.name}`);
    catalog.push({
      directory: absoluteDirectory,
      relativeDirectory: `packages/intelligence/skills/${directory.name}`,
      skill,
      instructions,
      tests,
      errors,
      record: errors.length ? null : buildDatabaseRecord(skill, instructions, `packages/intelligence/skills/${directory.name}`),
    });
  }
  return catalog;
}

export function assertValidCatalog(catalog) {
  const failures = catalog.flatMap((entry) => entry.errors.map((error) => `${entry.skill?.slug || path.basename(entry.directory)}: ${error}`));
  if (failures.length) throw new Error(`Catálogo inválido:\n- ${failures.join("\n- ")}`);
  const slugs = catalog.map((entry) => entry.record.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error("O catálogo contém slugs duplicados");
  return catalog;
}
