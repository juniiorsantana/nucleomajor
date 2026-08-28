import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260827190000_fase_h4_agenda_externa_aprovacao.sql", import.meta.url);
const readinessMigrationUrl = new URL("../supabase/migrations/20260827193000_fase_h4_prontidao_runtime.sql", import.meta.url);
const availabilityMigrationUrl = new URL("../supabase/migrations/20260827210000_fase_h4_disponibilidade_cliente.sql", import.meta.url);
const modelReadinessMigrationUrl = new URL("../supabase/migrations/20260828183000_fase_h5_prontidao_modelo.sql", import.meta.url);

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

test("prontidão H.5 publica disponibilidade do modelo sem erro bruto", async () => {
  const sql = await readFile(modelReadinessMigrationUrl, "utf8");
  assert.match(sql, /model_status/);
  assert.match(sql, /last_model_success_at/);
  assert.match(sql, /last_model_error_code/);
  assert.match(sql, /quota_exhausted/);
  assert.match(sql, /safe_model_error !~ '\^\[a-z0-9_\]\+\$'/);
  assert.doesNotMatch(sql, /last_model_error_message/i);
});

test("bloqueio provisório não contém dados do cliente nem lembretes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /'Reserva provisória — aguardando aprovação'/);
  assert.match(sql, /'\{\}'::integer\[\]/);
  assert.match(sql, /contact_id, status[\s\S]{0,300}null, 'tentative'/);
});

test("disponibilidade externa devolve somente estado e intervalo sem detalhes privados", async () => {
  const sql = await readFile(availabilityMigrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.nucleo_customer_calendar_availability/);
  assert.match(sql, /context\.audience = 'customer'/);
  assert.match(sql, /event\.status in \('scheduled', 'tentative'\)/);
  assert.match(sql, /'status', case when has_conflict then 'conflict' else 'available' end/);
  assert.match(sql, /calendar interval must use 30-minute boundaries/);
  assert.doesNotMatch(sql, /jsonb_build_object\([\s\S]*?'(?:title|description|contact|category|participants)'/i);
});
