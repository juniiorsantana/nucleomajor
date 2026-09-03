#!/usr/bin/env node
import "dotenv/config";
import { config as carregarAmbiente } from "dotenv";
import { fileURLToPath } from "node:url";
import { assertValidCatalog, loadSkillCatalog } from "../packages/intelligence/src/catalog.mjs";
import { publishCatalog, SupabaseSkillRepository } from "../packages/intelligence/src/publisher.mjs";

/**
 * A chave de publicação não mora no `.env` do portal.
 *
 * O `.env` é o ambiente do servidor web, e ele carrega a publishable key de
 * propósito: `SPEC-DATA-SECURITY` proíbe chave secreta no processo do portal.
 * Quem publica skill precisa de chave secreta, e ela vive em
 * `.env.skills.local` — que é ignorado pelo git e só existe na máquina de quem
 * publica.
 *
 * Sem esta linha, `npm run intelligence:publish -- --apply` — o comando que o
 * `SPEC-INTELLIGENCE.md` documenta — falhava com "chave secreta obrigatória",
 * e a saída era descobrir sozinho que precisava de `--env-file`.
 *
 * O caminho é resolvido a partir deste arquivo, e não do diretório atual, para
 * o comando funcionar de qualquer pasta. Arquivo ausente é silencioso: quem só
 * roda `validate` não precisa de credencial nenhuma.
 */
carregarAmbiente({ path: fileURLToPath(new URL("../.env.skills.local", import.meta.url)) });

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
    const verification = result.verified ? ` · verificado ${String(result.contentHash || "").slice(0, 12)}` : "";
    console.log(`${result.dryRun ? "○" : "✓"} ${result.slug}: ${labels[result.action]}${version}${verification}`);
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
    serviceRoleKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const results = await publishCatalog(catalog, repository, { apply: options.apply });
  if (options.apply && catalog.some((entry) => ["agenda", "solicitacao-agenda"].includes(entry.record.slug))) {
    const synchronization = await repository.syncSchedulingBindings();
    const profiles = Number(synchronization?.profiles || 0);
    const campaigns = Number(synchronization?.campaigns || 0);
    console.log(`✓ vínculos de agenda sincronizados · ${profiles} assistente(s) · ${campaigns} campanha(s)`);
  }
  printPublishResults(results, options.apply);
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});
