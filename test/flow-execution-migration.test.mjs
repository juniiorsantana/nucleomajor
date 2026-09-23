import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = new URL('../supabase/migrations/20260907010000_fluxos_execucao_persistida.sql', import.meta.url);
test('flow execution persists a snapshot and exposes scoped transition RPCs', () => {
  const sql = readFileSync(file, 'utf8');
  for (const name of ['nucleo_flow_start', 'nucleo_flow_claim', 'nucleo_flow_ack', 'nucleo_flow_pending', 'nucleo_flow_current', 'nucleo_flow_finish_ai', 'nucleo_flow_cancel']) {
    assert.match(sql, new RegExp(`function public\\.${name}\\(`));
  }
  assert.match(sql, /definition_snapshot jsonb not null/);
  assert.match(sql, /for update/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /create or replace function private\.intelligence_payload/);
});

test('copy guard and read-only acceptance match every normalized function body', () => {
  const sql = readFileSync(file, 'utf8').replaceAll('\r', '');
  const acceptance = readFileSync(new URL('../scripts/sql/validar-fluxos-execucao.sql', import.meta.url), 'utf8');
  const functions = [...sql.matchAll(/create function (\w+)\.(\w+)(.*?)as \$\$(.*?)\$\$;/gs)];
  assert.equal(functions.length, 15);
  for (const [, schema, name, , body] of functions) {
    const hash = createHash('md5').update(body).digest('hex');
    const entry = `('${schema}', '${name}', '${hash}'`;
    assert.ok(sql.includes(entry), `${name}: transaction guard differs`);
    assert.ok(acceptance.includes(entry), `${name}: acceptance differs`);
  }
  assert.match(sql, /flow body changed during copy; transaction rolled back/);
  assert.doesNotMatch(acceptance, /\b(create|update|insert|delete|alter|drop)\s+(table|function|into|public\.)/i);
});
