import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P13_PHASES,
  assertSecretFreeP13Receipt,
  createP13Receipt,
  finalizeP13Receipt,
  recordP13Phase,
} from '../../reference-graph/p13-receipt.mjs';

const P12_HEAD = '5f676c806ae864b507723ea867f5e3afd6fd4adb';
const P12_BINDING_HASH = '68930447847df8d31de01b7fb60049136ae6fd0d74c837283fb837ff7e79961b';
const P12_EVIDENCE_SHA256 = '15a0db3e27ede261554fe9993d775db07ffabcaa74b9ec49b3df55d788659bcb';
const GIT_SHA = 'b'.repeat(40);
const TARGET = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};

function grantRequest() {
  return {
    schema_version: 'reference-graph.p13-activation-grant-request.v1',
    p12_evidence_head: P12_HEAD,
    p12_binding_hash: P12_BINDING_HASH,
    p12_evidence_sha256: P12_EVIDENCE_SHA256,
    target: TARGET,
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    runtime_auth_mode: 'publishable',
    timeout_ms: 1500,
    legacy_first: true,
    record_parity_required: 'exact-ordered',
    pattern_parity_required: 'exact-ordered',
    fallback_source: 'legacy-control',
    standard_mode: 'legacy-only',
    deep_mode: 'legacy-only',
    repository_default_graph_enabled_before: false,
    production_source_before: 'legacy-control',
    rollback_action: 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME',
  };
}

function receipt() {
  return createP13Receipt({
    grantRequest: grantRequest(),
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T02:00:00.000Z',
    referenceTime: '2026-10-24T02:00:00.000Z',
  });
}

test('P13 receipt starts fail-closed with exact immutable authority boundary', () => {
  const value = receipt();
  assert.equal(value.schema_version, 'reference-graph.p13-activation-grant-authority.v1');
  assert.equal(value.p12_evidence_head, P12_HEAD);
  assert.equal(value.p12_binding_hash, P12_BINDING_HASH);
  assert.equal(value.p12_evidence_sha256, P12_EVIDENCE_SHA256);
  assert.deepEqual(value.grant_request, grantRequest());
  assert.match(value.request_hash, /^[0-9a-f]{64}$/);
  assert.equal(value.infrastructure_ready, false);
  assert.equal(value.authority_state, 'unconfigured');
  assert.equal(value.trusted_authority_sha256, null);
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.deepEqual(P13_PHASES, [
    'p12_binding',
    'authority_policy',
    'grant_verifier',
    'activation_boundary',
  ]);
  assert.deepEqual(
    Object.fromEntries(P13_PHASES.map((phase) => [phase, value.phases[phase].status])),
    Object.fromEntries(P13_PHASES.map((phase) => [phase, 'pending'])),
  );
});

test('phase recording is ordered and failure is terminal', () => {
  let value = receipt();
  assert.throws(
    () => recordP13Phase(value, { phase: 'grant_verifier', status: 'success' }),
    /phase order/i,
  );
  value = recordP13Phase(value, { phase: 'p12_binding', status: 'success', detail: { verified: true } });
  value = recordP13Phase(value, { phase: 'authority_policy', status: 'failed', error: 'missing policy' });
  assert.throws(
    () => recordP13Phase(value, { phase: 'authority_policy', status: 'success' }),
    /terminal/i,
  );
  assert.throws(
    () => recordP13Phase(value, { phase: 'grant_verifier', status: 'success' }),
    /blocked by failed phase/i,
  );
});

test('successful infrastructure finalization never invents production authority or grant', () => {
  let value = receipt();
  for (const phase of P13_PHASES) {
    value = recordP13Phase(value, { phase, status: 'success', detail: { verified: true } });
  }
  value = finalizeP13Receipt(value, {
    checks: {
      p12_binding: true,
      p12_evidence_bytes: true,
      authority_requires_external_trust: true,
      verifier_fail_closed: true,
      repository_default_off: true,
      no_activation_path: true,
    },
  });
  assert.equal(value.infrastructure_ready, true);
  assert.deepEqual(value.blockers, []);
  assert.equal(value.authority_state, 'unconfigured');
  assert.equal(value.trusted_authority_sha256, null);
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
});

test('failed phase or false check keeps infrastructure blocked with unique reasons', () => {
  let value = receipt();
  value = recordP13Phase(value, { phase: 'p12_binding', status: 'success' });
  value = recordP13Phase(value, { phase: 'authority_policy', status: 'failed', error: 'no trust' });
  value = finalizeP13Receipt(value, {
    checks: { p12_binding: true, authority_requires_external_trust: false },
    blockers: ['no trust', 'no trust'],
  });
  assert.equal(value.infrastructure_ready, false);
  assert.equal(value.blockers.filter((item) => item === 'no trust').length, 1);
  assert.match(value.blockers.join('\n'), /phase authority_policy is not successful/i);
  assert.match(value.blockers.join('\n'), /authority_requires_external_trust/i);
  assert.equal(value.activation_authorized, false);
});

test('receipt creation rejects drifted P12 anchors and malformed metadata', () => {
  assert.throws(
    () => createP13Receipt({
      grantRequest: { ...grantRequest(), p12_evidence_sha256: '0'.repeat(64) },
      gitSha: GIT_SHA,
      verificationAt: '2026-10-24T02:00:00.000Z',
      referenceTime: '2026-10-24T02:00:00.000Z',
    }),
    /grant request|P12|evidence/i,
  );
  assert.throws(
    () => createP13Receipt({
      grantRequest: { ...grantRequest(), p12_binding_hash: '0'.repeat(64) },
      gitSha: GIT_SHA,
      verificationAt: '2026-10-24T02:00:00.000Z',
      referenceTime: '2026-10-24T02:00:00.000Z',
    }),
    /grant request|P12/i,
  );
  assert.throws(
    () => createP13Receipt({
      grantRequest: grantRequest(),
      gitSha: 'bad',
      verificationAt: '2026-10-24T02:00:00.000Z',
      referenceTime: '2026-10-24T02:00:00.000Z',
    }),
    /gitSha|commit SHA/i,
  );
});

test('P13 receipt rejects credential and private-key shaped fields or literal secret material', () => {
  const value = receipt();
  assert.equal(assertSecretFreeP13Receipt(value), true);
  assert.throws(
    () => assertSecretFreeP13Receipt({ ...value, private_key: 'oops' }),
    /credential|private|secret/i,
  );
  assert.throws(
    () => assertSecretFreeP13Receipt({ ...value, nested: { service_role_key: 'oops' } }),
    /credential|private|secret/i,
  );
  assert.throws(
    () => assertSecretFreeP13Receipt({ ...value, note: 'literal-secret-value' }, ['literal-secret-value']),
    /secret material/i,
  );
});
