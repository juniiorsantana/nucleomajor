import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const migration = await readFile(new URL("../FASE3-MIGRATION-SQL.sql", import.meta.url), "utf8");
const validation = await readFile(new URL("../FASE3-VALIDAR-SQL.sql", import.meta.url), "utf8");

const triples = (sql) =>
  [...sql.matchAll(/\('(private|public)', '([^']+)', '([0-9a-f]{32})'/g)].map((match) => match.slice(1));

describe("contrato estático da FASE 3", () => {
  it("mantém a mesma lista e os mesmos hashes na migration e na validação", () => {
    assert.deepEqual(triples(validation), triples(migration));
  });

  it("protege a execução durável com RLS e sem grants de tabela", () => {
    assert.match(migration, /alter table public\.chatbot_flow_executions enable row level security/);
    assert.match(migration, /revoke all on public\.chatbot_flow_executions from public, anon, authenticated/);
  });

  it("publica exatamente as oito RPCs autenticadas", () => {
    const grants = [...migration.matchAll(/grant execute on function public\.(nucleo_flow_[a-z_]+)\([^)]*\) to authenticated/g)]
      .map((match) => match[1]);
    assert.deepEqual(grants, [
      "nucleo_flow_start",
      "nucleo_flow_claim",
      "nucleo_flow_ack",
      "nucleo_flow_pending",
      "nucleo_flow_current",
      "nucleo_flow_state",
      "nucleo_flow_finish_ai",
      "nucleo_flow_cancel",
    ]);
  });
});
