import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260827130000_ferramenta_tarefas_operador.sql",
  import.meta.url,
);

test("migration cria fluxo confirmado e idempotente para tarefas de operador", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /alter table public\.tasks alter column contact_id drop not null/i);
  assert.match(sql, /kind in \('calendar_event', 'task'\)/i);
  assert.match(sql, /nucleo_task_operator_action_prepare/i);
  assert.match(sql, /nucleo_task_operator_action_pending/i);
  assert.match(sql, /nucleo_task_operator_action_confirm/i);
  assert.match(sql, /confirmation must arrive in a later operator turn/i);
  assert.match(sql, /context_row\.operator_role = 'member'/i);
  assert.match(sql, /action\.kind = 'calendar_event'/i);
  assert.match(sql, /grant execute on function public\.nucleo_task_operator_action_confirm/i);
  assert.doesNotMatch(sql, /service_role/i);
});
