import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260827190000_fase_h4_agenda_externa_aprovacao.sql", import.meta.url);
const readinessMigrationUrl = new URL("../supabase/migrations/20260827193000_fase_h4_prontidao_runtime.sql", import.meta.url);

test("migration H.4 mantém criação externa atrás de aprovação", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /status = 'awaiting_team_approval'/);
  assert.match(sql, /status = 'tentative'/);
  assert.match(sql, /status = 'scheduled'/);
  assert.match(sql, /nucleo_customer_calendar_request_decide/);
  assert.match(sql, /operator_role not in \('owner', 'admin'\)/);
  assert.match(sql, /interval '2 hours'/);
  assert.match(sql, /interval '30 minutes'/);
  assert.match(sql, /notification_worker_claim_booking_notifications/);
  assert.match(sql, /approver-delivery-failed/);
  assert.match(sql, /approver-unavailable/);
  assert.match(sql, /recipient-unavailable/);
  assert.doesNotMatch(sql, /service_role[^\n]*browser/i);
});

test("prontidão H.4 separa agenda, aprovação, notificações e versão da skill", async () => {
  const sql = await readFile(readinessMigrationUrl, "utf8");
  assert.match(sql, /external_approval_status/);
  assert.match(sql, /notification_worker_status/);
  assert.match(sql, /last_notification_at/);
  assert.match(sql, /skill_slug/);
  assert.match(sql, /skill_version/);
  assert.match(sql, /skill_hash/);
  assert.match(sql, /create or replace function public\.nucleo_runtime_heartbeat/);
});

test("bloqueio provisório não contém dados do cliente nem lembretes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /'Reserva provisória — aguardando aprovação'/);
  assert.match(sql, /'\{\}'::integer\[\]/);
  assert.match(sql, /contact_id, status[\s\S]{0,300}null, 'tentative'/);
});
