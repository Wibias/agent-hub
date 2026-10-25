import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const SQL_PATH = 'reference-graph/schema/011_reference_graph_activation_attestation.sql';

function sql() {
  assert.equal(existsSync(SQL_PATH), true, 'P19 migration 011 must exist');
  return readFileSync(SQL_PATH, 'utf8');
}

test('P19 migration 011 creates the exact service-only aggregate attestation RPC', () => {
  const source = sql();
  assert.match(source, /create\s+or\s+replace\s+function\s+public\.reference_graph_attest_activation_consumption_p19\s*\(\s*p_grant_payload_hash\s+text\s*,\s*p_request_hash\s+text\s*,\s*p_authority_hash\s+text\s*\)/i);
  assert.match(source, /returns\s+jsonb/i);
  assert.match(source, /security\s+definer/i);
  assert.match(source, /\bstable\b/i);
  assert.match(source, /set\s+search_path\s*=\s*pg_catalog\s*,\s*reference_graph/i);
  assert.match(source, /set\s+statement_timeout\s*=\s*'5s'/i);

  assert.match(source, /from\s+reference_graph\.activation_grant_consumptions_p16/i);
  assert.match(source, /'matching_count'/i);
  assert.match(source, /'total_count'/i);
  assert.match(source, /'exact_match'/i);

  assert.doesNotMatch(source, /\b(?:insert\s+into|update\s+reference_graph|delete\s+from|truncate\s+)\b/i);
  assert.doesNotMatch(source, /\b(?:nonce|consumption_id|consumed_at)\b\s*[,)]/i);
});

test('P19 migration 011 validates all public activation hashes as lowercase SHA-256', () => {
  const source = sql();
  for (const name of ['p_grant_payload_hash', 'p_request_hash', 'p_authority_hash']) {
    assert.match(source, new RegExp(`${name}\\s+is\\s+null\\s+or\\s+${name}\\s*!~\\s*'\\^\\[0-9a-f\\]\\{64\\}\\$'`, 'i'));
  }
  assert.match(source, /errcode\s*=\s*'22023'/i);
});

test('P19 migration 011 preserves private ledger privileges and grants only RPC execute to service_role', () => {
  const source = sql();
  assert.match(source, /revoke\s+all\s+on\s+function\s+public\.reference_graph_attest_activation_consumption_p19\s*\(\s*text\s*,\s*text\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(source, /grant\s+execute\s+on\s+function\s+public\.reference_graph_attest_activation_consumption_p19\s*\(\s*text\s*,\s*text\s*,\s*text\s*\)\s+to\s+service_role/i);
  assert.doesNotMatch(source, /grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?reference_graph\.activation_grant_consumptions_p16/i);
  assert.doesNotMatch(source, /alter\s+table\s+reference_graph\.activation_grant_consumptions_p16/i);
  assert.doesNotMatch(source, /create\s+table\s+(?:if\s+not\s+exists\s+)?reference_graph\.activation_grant_consumptions_p16/i);
});
