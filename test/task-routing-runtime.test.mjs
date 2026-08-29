import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260828210000_corrigir_roteamento_tarefas_interno.sql",
  import.meta.url,
);

test("resolver H.2 aceita as ferramentas semânticas de tarefas", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /'task\.read'/);
  assert.match(sql, /'task\.prepare'/);
  assert.match(sql, /'task\.confirm'/);
  assert.match(sql, /published skill contains an unsupported tool/);
});

test("confirmação mantém a skill Tarefas quando há ação pendente", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /action\.kind = 'task'/);
  assert.match(sql, /action\.status in \('awaiting_confirmation', 'failed'\)/);
  assert.match(sql, /pending_task and explicit_confirmation/);
  assert.match(sql, /active_skill_id = case when force_task then task_skill else null end/);
});

test("resposta curta de prazo continua no fluxo recente de tarefas", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /context\.last_message_at > now\(\) - interval '30 minutes'/);
  assert.match(sql, /recent_task_context and task_continuation and not agenda_intent/);
  assert.match(sql, /routing_text := left\(routing_text \|\| ' tarefa', 2000\)/);
});
