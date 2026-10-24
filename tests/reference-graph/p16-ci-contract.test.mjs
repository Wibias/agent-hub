import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = '.github/workflows/verify-reference-graph.yml';
const DOC = 'reference-graph/P16.md';

function workflow() {
  return readFileSync(WORKFLOW, 'utf8');
}

test('permanent Reference Graph governance applies migration 010 and runs the P16 replay smoke', () => {
  const source = workflow();
  assert.match(source, /010_reference_graph_activation_grant_consumption\.sql/);
  assert.match(source, /Smoke-test P16 durable grant consumption replay and privileges/);
  assert.match(source, /reference_graph_consume_activation_grant_nonce_p16/);
  assert.match(source, /activation_grant_consumptions_p16/);
});

test('P16 DB smoke proves first-use success, replay false-null, and one durable ledger row', () => {
  const source = workflow();
  assert.match(source, /'consumed'\s*:\s*true|consumed.*true/i);
  assert.match(source, /'consumed'\s*:\s*false|consumed.*false/i);
  assert.match(source, /consumption_id.*null|null.*consumption_id/i);
  assert.match(source, /count\(\*\).*activation_grant_consumptions_p16|activation_grant_consumptions_p16[\s\S]*count\(\*\)/i);
  assert.match(source, /expected exactly one P16 consumption row|count.*<>\s*1/i);
});

test('P16 DB smoke proves RPC and private table privileges are closed to runtime roles', () => {
  const source = workflow();
  assert.match(source, /has_function_privilege\('anon'.*reference_graph_consume_activation_grant_nonce_p16/i);
  assert.match(source, /has_function_privilege\('authenticated'.*reference_graph_consume_activation_grant_nonce_p16/i);
  assert.match(source, /has_function_privilege\('service_role'.*reference_graph_consume_activation_grant_nonce_p16/i);
  assert.match(source, /has_table_privilege\('anon'.*activation_grant_consumptions_p16/i);
  assert.match(source, /has_table_privilege\('authenticated'.*activation_grant_consumptions_p16/i);
  assert.match(source, /has_table_privilege\('service_role'.*activation_grant_consumptions_p16/i);
});

test('P16 runbook documents live replay protection without claiming activation or a host actuator', () => {
  assert.equal(existsSync(DOC), true, 'P16 runbook must exist');
  const source = readFileSync(DOC, 'utf8');
  assert.match(source, /vrznfnxzlxaavpqbzbzd/);
  assert.match(source, /one[- ]shot|single[- ]use/i);
  assert.match(source, /atomic/i);
  assert.match(source, /service_role/i);
  assert.match(source, /do not.*synthetic|synthetic.*must not|no synthetic/i);
  assert.match(source, /P17/i);
  assert.match(source, /host|deployment|environment/i);
  assert.match(source, /legacy-control/);
  assert.match(source, /activation_performed.*false|no production activation/i);
});
