#!/usr/bin/env node
import "dotenv/config";
import { assertValidCatalog, loadSkillCatalog } from "../packages/intelligence/src/catalog.mjs";
import { publishCatalog, SupabaseSkillRepository } from "../packages/intelligence/src/publisher.mjs";

function parseArguments(argv) {
  const [command = "validate", ...rest] = argv;
  const options = { command, apply: false, slug: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--slug") options.slug = String(rest[++index] || "").trim();
    else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  if (!new Set(["validate", "publish"]).has(options.command)) {
    throw new Error("Use validate ou publish");
  }
  return options;
}

function printValidation(catalog) {
  for (const entry of catalog) {
    console.log(`✓ ${entry.record.name} (${entry.record.slug}) — ${entry.tests.cases.length} testes de gatilho`);
  }
  console.log(`\n${catalog.length} skill(s) válidas.`);
}

function printPublishResults(results, apply) {
  const labels = { unchanged: "sem alteração", update: "atualizar", insert: "criar" };
  for (const result of results) {
    const version = result.version ? ` · versão ${result.version}` : "";
    console.log(`${result.dryRun ? "○" : "✓"} ${result.slug}: ${labels[result.action]}${version}`);
  }
  if (!apply && results.some((result) => result.action !== "unchanged")) {
    console.log("\nSimulação concluída. Revise e repita com --apply para publicar.");
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const catalog = assertValidCatalog(await loadSkillCatalog({ slug: options.slug }));
  if (options.command === "validate") {
    printValidation(catalog);
    return;
  }
  const repository = new SupabaseSkillRepository({
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const results = await publishCatalog(catalog, repository, { apply: options.apply });
  printPublishResults(results, options.apply);
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});

