import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dir = new URL('../supabase/migrations/', import.meta.url);
const read = async name => (await readFile(new URL(name, dir), 'utf8')).replaceAll('\r', '');
const sql = await read('20260906180000_fase_14b_handoff_entre_agentes.sql');
const capability = await read('20260906190000_fase_14c_capacidade_handoff_agente.sql');
const code = sql.replace(/^\s*--.*$/gm, '');

test('14B: assinatura, autenticação, contexto customer/WhatsApp e lock', () => {
  assert.match(code, /function public\.nucleo_customer_agent_handoff\(\s*conversation_key_hash text,\s*requester_phone text,\s*target_agent_slug text,\s*handoff_reason text,\s*handoff_summary text default ''/);
  for (const fragment of ['returns jsonb', 'security definer', "set search_path = ''", 'private.robot_organization()', "context.channel = 'whatsapp'", "context.audience = 'customer'", 'context.organization_id = robot_org', 'limit 1 for update']) assert.ok(code.includes(fragment), fragment);
  assert.match(code, /revoke all .* from public, anon/);
  assert.match(code, /grant execute .* to authenticated/);
});

test('14B: recusas em ordem e sem interpolar dados do cliente', () => {
  let previous = -1;
  for (const reason of ['active robot credential required', 'customer intelligence context required', 'conversation already handed off to human', 'target agent unavailable', 'target agent audience mismatch', 'target agent inactive', 'target agent is current agent', 'agent handoff limit reached; use human handoff', 'invalid agent handoff reason']) {
    const index = code.indexOf(`raise exception '${reason}'`);
    assert.ok(index > previous, reason);
    previous = index;
  }
  assert.match(code, /profile.organization_id = robot_org\s+and profile.slug = target_agent_slug/);
  assert.match(code, /handoff_reason is null or handoff_reason not in/);
});

test('14B: contador persistido, teto 3 e incremento sob lock', () => {
  assert.match(code, /add column agent_handoff_count integer not null default 0/);
  assert.match(code, /max_handoffs constant integer := 3/);
  assert.match(code, /context_row.agent_handoff_count >= max_handoffs/);
  assert.match(code, /agent_handoff_count = agent_handoff_count \+ 1/);
});

test('14B: limpa skill, fecha sessão e mantém state', () => {
  assert.match(code, /assistant_profile_id = target_agent.id,\s+active_skill_id = null/);
  assert.match(code, /update public.conversation_skill_sessions\s+set status = 'handed_off', revision = revision \+ 1/);
  assert.doesNotMatch(code, /set state\s*=/);
});

test('14B: auditoria e resposta sem resumo ou telefone', () => {
  const effect = code.slice(code.indexOf('insert into public.intelligence_audit_log'));
  for (const field of ['sourceAgentSlug', 'targetAgentSlug', 'reason', 'handoffCount']) assert.ok(effect.includes(field));
  assert.match(effect, /'conversation', context_row.id, 'agent_handoff'/);
  assert.doesNotMatch(effect, /summary|requester_phone|normalized_phone/);
});

test('14B: não redefine payload nem acrescenta vocabulário de roteamento', () => {
  assert.equal((code.match(/create or replace function/gi) || []).length, 1);
  assert.doesNotMatch(code, /intelligence_payload|targetMode|targetAgentId|keyword|schemaVersion/);
  assert.doesNotMatch(capability, /(?:create or replace function) private\.intelligence_payload/i);
});

function body(source, name) {
  const pattern = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as (\\$[a-z]*\\$)([\\s\\S]*?)\\1;`, 'i');
  const match = source.match(pattern);
  assert.ok(match, name);
  return match[2];
}
for (const [name, baseline] of [
  ['nucleo_intelligence_context_resolve_v2', '20260904230000_resolvers_usam_agente_padrao.sql'],
  ['nucleo_intelligence_context_resolve_v3', '20260904120000_sincronizar_allowedtools_do_resolve_v3.sql'],
]) {
  test(`14C: ${name} muda exclusivamente uma string na allowlist`, async () => {
    const before = body(await read(baseline), name);
    const after = body(capability, name);
    assert.equal(after, before.replace("'conversation.handoff'", "'conversation.handoff', 'conversation.handoff.agent'"));
  });
}
