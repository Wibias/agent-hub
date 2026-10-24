import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  P13_EVIDENCE_HEAD,
  P13_EVIDENCE_SHA256,
  P13_REQUEST_HASH,
} from '../../reference-graph/p14-authority-enrollment-grant.mjs';
import { assertSecretFreeP14Receipt } from '../../reference-graph/p14-receipt.mjs';

const WORKFLOW = '.github/workflows/verify-reference-graph.yml';
const DOC = 'reference-graph/P14.md';
const EVIDENCE = 'reference-graph/evidence/p14-authority-enrollment-grant-evidence.json';
const SOURCE_FILES = [
  'reference-graph/p14-authority-enrollment-grant.mjs',
  'reference-graph/p14-receipt.mjs',
  'reference-graph/cli/p14-authority-enrollment-grant.mjs',
];

function source() {
  return SOURCE_FILES.map((path) => readFileSync(path, 'utf8')).join('\n');
}

test('permanent workflow runs all P14 tests and Reference Graph secret scans', () => {
  const value = readFileSync(WORKFLOW, 'utf8');
  assert.match(value, /node --test tests\/reference-graph\/\*\.test\.mjs/);
  assert.match(value, /scan_secrets\.py reference-graph/);
});

test('P14 pins exact final P13 evidence, bytes, and request', () => {
  assert.equal(P13_EVIDENCE_HEAD, 'bbd29fbe596801fdb7594f45045cb41e9c9b1a5b');
  assert.equal(P13_EVIDENCE_SHA256, '06fdedcca135ce0e7e819b1ddc61e861a6c37ea01f5fbee006fdfcd2e709843e');
  assert.equal(P13_REQUEST_HASH, 'ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7');
});

test('P14 production source contains no private-key generation, parsing, or signing API', () => {
  const value = source();
  assert.doesNotMatch(value, /\b(?:createPrivateKey|generateKeyPair|generateKeyPairSync|sign)\s*\(/);
  assert.doesNotMatch(value, /from\s+['"]node:crypto['"][^\n]*(?:sign|createPrivateKey|generateKeyPair)/);
  assert.doesNotMatch(value, /private_key\s*[:=]\s*["'][^"']+/i);
});

test('P14 source owns no activation, deployment, Supabase, or P16 ledger mutation', () => {
  const value = source();
  assert.doesNotMatch(value, /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/);
  assert.doesNotMatch(value, /from\s+['"]@supabase\//);
  assert.doesNotMatch(value, /\bcreateClient\s*\(/);
  assert.doesNotMatch(value, /reference_graph_refresh_quick_runtime_projection/i);
  assert.doesNotMatch(value, /activation_grant_consumptions_p16|010_reference_graph_activation_grant_consumption/i);

  const frozen = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
  assert.equal(frozen.ceremony_ready, true);
  assert.equal(frozen.activation_performed, false);
  assert.equal(frozen.repository_default_graph_enabled, false);
});

test('repository runtime remains exact graph opt-in with legacy default', () => {
  const query = readFileSync('knowledge/design-references/scripts/query.mjs', 'utf8');
  assert.match(query, /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/);
  assert.match(query, /graphMode\s*===\s*["']graph["']/);
});

test('durable P14 evidence is secret-free and ceremony-ready only when present', () => {
  if (!existsSync(EVIDENCE)) return;
  const value = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
  assert.equal(assertSecretFreeP14Receipt(value), true);
  assert.equal(value.schema_version, 'reference-graph.p14-authority-enrollment-grant.v1');
  assert.equal(value.p13_evidence_head, P13_EVIDENCE_HEAD);
  assert.equal(value.p13_evidence_sha256, P13_EVIDENCE_SHA256);
  assert.equal(value.p13_request_hash, P13_REQUEST_HASH);
  assert.equal(value.ceremony_ready, true);
  assert.equal(value.authority_state, 'awaiting-external-enrollment');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.external_blocker, 'production-ed25519-authority-not-provided');
});

test('P14 documentation states external custody and hard stop boundary', () => {
  const doc = readFileSync(DOC, 'utf8');
  assert.match(doc, /P14 authority enrollment/i);
  assert.match(doc, /bbd29fbe596801fdb7594f45045cb41e9c9b1a5b/);
  assert.match(doc, /ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7/);
  assert.match(doc, /external.*private.key|private.key.*external/i);
  assert.match(doc, /approved_authority_sha256/);
  assert.match(doc, /awaiting-external-enrollment/);
  assert.match(doc, /authorized-not-activated/i);
  assert.match(doc, /activation_performed.*false/i);
  assert.match(doc, /production_source.*legacy-control/i);
});
