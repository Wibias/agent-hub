import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = '.github/workflows/verify-reference-graph.yml';
const P14_EVIDENCE = 'reference-graph/evidence/p14-authority-enrollment-grant-evidence.json';
const P15_EVIDENCE = 'reference-graph/evidence/p15-activation-executor-evidence.json';
const QUERY = 'knowledge/design-references/scripts/query.mjs';
const P15_SOURCES = [
  'reference-graph/p15-activation-executor.mjs',
  'reference-graph/p15-receipt.mjs',
  'reference-graph/cli/p15-activation-executor.mjs',
];

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('permanent Reference Graph governance automatically executes P15 contracts and broad secret scanning', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  assert.match(workflow, /node --test tests\/reference-graph\/\*\.test\.mjs/);
  assert.match(workflow, /scan_secrets\.py reference-graph/);
  assert.match(workflow, /Execute Reference Graph migrations/);
  assert.match(workflow, /Smoke-test P10 runtime projection RLS, refresh grants, and P9 closure/);
});

test('P15 production sources pin immutable P14 bytes and contain no production signer or provider mutation implementation', () => {
  assert.equal(sha256(P14_EVIDENCE), '610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393');

  const source = P15_SOURCES.map((path) => readFileSync(path, 'utf8')).join('\n');
  for (const forbidden of [
    /\bcreatePrivateKey\s*\(/,
    /\bgenerateKeyPair(?:Sync)?\s*\(/,
    /\bsign\s*\(/,
    /@supabase\//,
    /\bcreateClient\s*\(/,
    /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }

  assert.match(source, /43fd2adf9e73749b03283f7ae7c6e700bd383b35/);
  assert.match(source, /610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393/);
});

test('P15 owns no migration 010 while immutable P15 evidence preserves its pre-P16 boundary', () => {
  const source = P15_SOURCES.map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(source, /activation_grant_consumptions_p16|010_reference_graph_activation_grant_consumption/i);

  const frozen = JSON.parse(readFileSync(P15_EVIDENCE, 'utf8'));
  assert.equal(frozen.checks.no_migration_010_or_later, true);
  assert.equal(frozen.activation_performed, false);
  assert.equal(frozen.repository_default_graph_enabled, false);

  const query = readFileSync(QUERY, 'utf8');
  assert.match(query, /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/);
  assert.match(query, /graphMode\s*===\s*["']graph["']/);
});

test('P15 operator remains inspection-only while the core keeps external actuator interfaces explicit', () => {
  const operator = readFileSync('reference-graph/cli/p15-activation-executor.mjs', 'utf8');
  assert.match(operator, /--plan/);
  assert.match(operator, /--verify-repository/);
  assert.doesNotMatch(operator, /--(?:activate|apply|deploy|set-env|sign|finalize)\b/);

  const core = readFileSync('reference-graph/p15-activation-executor.mjs', 'utf8');
  for (const callback of [
    'readActivationState',
    'consumeGrantNonce',
    'applyActivation',
    'probeRuntime',
    'rollbackActivation',
  ]) {
    assert.match(core, new RegExp(`\\b${callback}\\b`));
  }
});
