import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CLI = 'reference-graph/cli/p15-activation-executor.mjs';
const DOC = 'reference-graph/P15.md';

function run(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('P15 operator plan is read-only and exposes only plan and repository verification', () => {
  const result = run('--plan');
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.mode, 'plan');
  assert.equal(value.p14_evidence_head, '43fd2adf9e73749b03283f7ae7c6e700bd383b35');
  assert.equal(value.p14_evidence_sha256, '610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393');
  assert.deepEqual(value.allowed_modes, ['--plan', '--verify-repository']);
  assert.equal(value.activation_flag, 'REFERENCE_GRAPH_QUICK_RUNTIME');
  assert.equal(value.activation_value, 'graph');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
});

test('P15 repository verification proves frozen P14 bytes and reports P16 schema evolution', () => {
  const result = run('--verify-repository');
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.p14_evidence_head, '43fd2adf9e73749b03283f7ae7c6e700bd383b35');
  assert.equal(value.p14_evidence_bytes, true);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.migration_010_or_later_present, true);
  assert.equal(value.production_private_key_or_signing_path, false);
  assert.equal(value.operator_activation_or_deployment_path, false);
  assert.equal(value.operator_supabase_mutation_path, false);
  assert.equal(value.p15_executor_present, true);
  assert.equal(value.p15_receipt_present, true);
});

test('P15 operator rejects signing, activation, deployment, finalization, and malformed modes', () => {
  for (const args of [
    [],
    ['--activate'],
    ['--deploy'],
    ['--sign'],
    ['--finalize'],
    ['--verify-repository', 'extra'],
  ]) {
    const result = run(...args);
    assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly succeeded`);
    assert.match(result.stderr, /P15|read-only|supported|mode/i);
  }
});

test('P15 operator source contains no signer, private-key, deployment mutation, env mutation, or Supabase mutation surface', () => {
  const source = readFileSync(CLI, 'utf8');
  for (const forbidden of [
    /\bcreatePrivateKey\s*\(/,
    /\bgenerateKeyPair(?:Sync)?\s*\(/,
    /\bsign\s*\(/,
    /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/,
    /@supabase\//,
    /\bcreateClient\s*\(/,
    /--(?:activate|apply|deploy|set-env|sign|finalize)\b/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('P15 runbook documents external one-shot quick activation without providing a mutation command', () => {
  const doc = readFileSync(DOC, 'utf8');
  assert.match(doc, /external.*actuator|actuator.*external/i);
  assert.match(doc, /one[- ]shot|single[- ]use/i);
  assert.match(doc, /new.*grant|grant.*new/i);
  assert.match(doc, /quick/i);
  assert.match(doc, /standard.*deep|deep.*standard/i);
  assert.match(doc, /legacy-control/i);
  assert.match(doc, /no provider-specific|provider-neutral|provider specific/i);
});
