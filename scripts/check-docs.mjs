import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs/README.md",
  "docs/STATUS.md",
  "docs/DEVELOPMENT.md",
  "docs/TESTING.md",
  "docs/DEPLOYMENT.md",
  "docs/RUNBOOK.md",
  "docs/GLOSSARY.md",
  "docs/DOMAIN-MAP.md",
  "docs/FLOW-MAP.md",
  "docs/TERMINOLOGY-AUDIT.md",
  "docs/specs/SPEC-PRODUCT.md",
  "docs/specs/SPEC-ARCHITECTURE.md",
  "docs/specs/SPEC-EXTENSION.md",
];

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ["node_modules", "public", "dist"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (extname(entry.name) === ".md") files.push(path);
  }
  return files;
}

const failures = [];
for (const path of required) {
  try { await access(resolve(root, path)); }
  catch { failures.push(`documento obrigatório ausente: ${path}`); }
}

const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const file of await markdownFiles(root)) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const target = decodeURIComponent(raw.split("#", 1)[0]);
    try { await access(resolve(dirname(file), target)); }
    catch { failures.push(`link quebrado em ${file.slice(root.length + 1)}: ${raw}`); }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Documentação validada: arquivos obrigatórios e links locais estão íntegros.");
