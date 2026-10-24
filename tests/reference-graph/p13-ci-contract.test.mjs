import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  P12_BINDING_HASH,
  P12_EVIDENCE_HEAD,
} from '../../reference-graph/p13-activation-grant-authority.mjs';
import { assertSecretFreeP13Receipt } from '../../reference-graph/p13-receipt.mjs';

const WORKFLOW = '.github/workflows/verify-reference-graph.yml';
const DOC = 'reference-graph/P13.md';
const P13_EVIDENCE = 'reference-graph/evidence/p13-activation-grant-authority-evidence.json';
const PRODUCTION_AUTHORITY = 'reference-graph/p13-production-authority.json';
const P13_PRODUCTION_FILES = [
  'reference-graph/p13-activation-grant-authority.mjs',
  'reference-graph/p13-receipt.mjs',
  'reference-graph/cli/p13-activation-grant-authority.mjs',
];

function allProductionSource() {
  return P13_PRODUCTION_FILES.map((file) => readFileSync(file, 'utf8')).join('\n');
}

test('permanent Reference Graph workflow executes all P13 tests and the secret scan', () => {
  const source = readFileSync(WORKFLOW, 'utf8');
  assert.match(source, /node --test tests\/reference-graph\/\*\.test\.mjs/);
  assert.match(source, /scan_secrets\.py reference-graph/);
  assert.match(source, /009_reference_graph_runtime_projection\.sql/);
});

test('P13 source pins the exact final P12 evidence and binding authority', () => {
  assert.equal(P12_EVIDENCE_HEAD, '5f676c806ae864b507723ea867f5e3afd6fd4adb');
  assert.equal(P12_BINDING_HASH, '68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b');
  const source = allProductionSource();
  assert.match(source, /trustedAuthoritySha256/);
  assert.match(source, /trusted_authority_match/);
  assert.match(source, /Ed25519/);
  assert.match(source, /15 minutes|max_lifetime_seconds:\s*900/);
});

test('P13 production code has no signer, private-key path, or executable activation/deployment mode', () => {
  const source = allProductionSource();
  const signingApi = /\b(?:createPrivateKey|generateKeyPair(?:Sync)?|sign)\s*\(/;
  const envMutation = /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/;
  const executableMode = /['"]--(?:activate|apply|deploy|set-env|sign|issue)['"]/;
  assert.doesNotMatch(source, signingApi);
  assert.doesNotMatch(source, envMutation);
  assert.doesNotMatch(source, executableMode);
  assert.equal(existsSync(PRODUCTION_AUTHORITY), false);
});

test('P13 source owns no Supabase mutation while frozen evidence preserves its pre-010 boundary', () => {
  const source = allProductionSource();
  assert.doesNotMatch(source, /from\s+['"]@supabase\//);
  assert.doesNotMatch(source, /\bcreateClient\s*\(/);
  assert.doesNotMatch(source, /reference_graph_refresh_quick_runtime_projection/i);
  assert.doesNotMatch(source, /activation_grant_consumptions_p16|010_reference_graph_activation_grant_consumption/i);

  const frozen = JSON.parse(readFileSync(P13_EVIDENCE, 'utf8'));
  assert.equal(frozen.checks.no_activation_path, true);
  assert.equal(frozen.repository_default_graph_enabled, false);
  assert.equal(frozen.activation_performed, false);
});

test('repository quick runtime remains opt-in graph with legacy default', () => {
  const query = readFileSync('knowledge/design-references/scripts/query.mjs', 'utf8');
  assert.match(query, /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/);
  assert.match(query, /graphMode\s*===\s*["']graph["']/);
});

test('P13 durable evidence is secret-free and stays non-authorizing when present', () => {
  if (!existsSync(P13_EVIDENCE)) return;
  const value = JSON.parse(readFileSync(P13_EVIDENCE, 'utf8'));
  assert.equal(assertSecretFreeP13Receipt(value), true);
  assert.equal(value.schema_version, 'reference-graph.p13-activation-grant-authority.v1');
  assert.equal(value.p12_evidence_head, P12_EVIDENCE_HEAD);
  assert.equal(value.p12_binding_hash, P12_BINDING_HASH);
  assert.equal(value.infrastructure_ready, true);
  assert.equal(value.authority_state, 'unconfigured');
  assert.equal(value.trusted_authority_sha256, null);
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
});

test('P13 operator documentation states the hard stop boundary and read-only modes', () => {
  const doc = readFileSync(DOC, 'utf8');
  assert.match(doc, /P13 activation grant authority/i);
  assert.match(doc, /5f676c806ae864b507723ea867f5e3afd6fd4adb/);
  assert.match(doc, /68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b/);
  assert.match(doc, /external trust|trusted authority/i);
  assert.match(doc, /15 minutes/i);
  assert.match(doc, /authority_state.*unconfigured/i);
  assert.match(doc, /grant_state.*not-issued/i);
  assert.match(doc, /activation_authorized.*false/i);
  assert.match(doc, /activation_performed.*false/i);
  assert.match(doc, /production_source.*legacy-control/i);
  assert.match(doc, /--verify-grant/);
  assert.doesNotMatch(doc, /\n\s*--activate\b|\n\s*--sign\b|\n\s*--issue\b/);
});
