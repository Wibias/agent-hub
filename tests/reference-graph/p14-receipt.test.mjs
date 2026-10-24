import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P14_PHASES,
  assertSecretFreeP14Receipt,
  createP14Receipt,
  finalizeP14Receipt,
  recordP14Phase,
} from '../../reference-graph/p14-receipt.mjs';

const GIT_SHA = 'a'.repeat(40);

function receipt() {
  return createP14Receipt({
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T02:30:00.000Z',
    referenceTime: '2026-10-24T02:30:00.000Z',
  });
}

function greenChecks() {
  return {
    p13_binding: true,
    external_custody_only: true,
    enrollment_fail_closed: true,
    grant_verifier_fail_closed: true,
    repository_default_off: true,
    no_activation_path: true,
  };
}

test('P14 receipt starts with exact phases and non-authorizing legacy boundary', () => {
  const value = receipt();
  assert.equal(value.schema_version, 'reference-graph.p14-authority-enrollment-grant.v1');
  assert.deepEqual(P14_PHASES, [
    'p13_binding',
    'authority_enrollment',
    'grant_payload',
    'grant_verification',
    'activation_boundary',
  ]);
  assert.equal(value.ceremony_ready, false);
  assert.equal(value.authority_state, 'awaiting-external-enrollment');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.repository_default_graph_enabled, false);
  assert.equal(value.production_source, 'legacy-control');
  assert.equal(value.external_blocker, 'production-ed25519-authority-not-provided');
});

test('phase order is strict and failure is terminal', () => {
  let value = receipt();
  assert.throws(() => recordP14Phase(value, { phase: 'grant_payload', status: 'success' }), /phase order/i);
  value = recordP14Phase(value, { phase: 'p13_binding', status: 'success' });
  value = recordP14Phase(value, { phase: 'authority_enrollment', status: 'failed', error: 'not enrolled' });
  assert.throws(() => recordP14Phase(value, { phase: 'authority_enrollment', status: 'success' }), /terminal/i);
  assert.throws(() => recordP14Phase(value, { phase: 'grant_payload', status: 'success' }), /blocked by failed phase/i);
});

test('green infrastructure finalizes ceremony-ready without fabricating authority or grant', () => {
  let value = receipt();
  for (const phase of P14_PHASES) value = recordP14Phase(value, { phase, status: 'success' });
  value = finalizeP14Receipt(value, { checks: greenChecks() });
  assert.equal(value.ceremony_ready, true);
  assert.deepEqual(value.blockers, []);
  assert.equal(value.authority_state, 'awaiting-external-enrollment');
  assert.equal(value.grant_state, 'not-issued');
  assert.equal(value.grant_verified, false);
  assert.equal(value.activation_authorized, false);
  assert.equal(value.activation_performed, false);
  assert.equal(value.external_blocker, 'production-ed25519-authority-not-provided');
  assert.equal(value.production_source, 'legacy-control');
});

test('caller-claimed ceremony verification cannot authorize a P14 receipt', () => {
  let value = receipt();
  for (const phase of P14_PHASES) value = recordP14Phase(value, { phase, status: 'success' });
  assert.throws(() => finalizeP14Receipt(value, {
    checks: greenChecks(),
    ceremony: {
      enrollmentManifest: { schema_version: 'reference-graph.p14-authority-enrollment.v1' },
      grant: { schema_version: 'reference-graph.p13-activation-grant.v1' },
      verification: {
        grantVerified: true,
        activationAuthorized: true,
        activationPerformed: false,
        repositoryDefaultGraphEnabled: false,
        productionSource: 'legacy-control',
      },
    },
  }), /ceremony artifacts|cryptographic|re-verification/i);
});

test('false checks or inconsistent ceremony fail closed', () => {
  let value = receipt();
  for (const phase of P14_PHASES) value = recordP14Phase(value, { phase, status: 'success' });
  value = finalizeP14Receipt(value, { checks: { ...greenChecks(), no_activation_path: false } });
  assert.equal(value.ceremony_ready, false);
  assert.match(value.blockers.join('\n'), /no_activation_path/i);
  assert.equal(value.activation_authorized, false);

  assert.throws(() => finalizeP14Receipt(receipt(), {
    checks: greenChecks(),
    ceremony: { verification: { grantVerified: true, activationAuthorized: true, activationPerformed: true } },
  }), /activation|ceremony/i);
});

test('P14 receipt secret scan rejects private-key shaped fields and literal secrets', () => {
  const value = receipt();
  assert.equal(assertSecretFreeP14Receipt(value), true);
  assert.throws(() => assertSecretFreeP14Receipt({ ...value, private_key: 'x' }), /private|credential|secret/i);
  assert.throws(() => assertSecretFreeP14Receipt({ ...value, nested: { signing_key: 'x' } }), /private|credential|signing/i);
  assert.throws(() => assertSecretFreeP14Receipt({ ...value, note: 'literal-secret' }, ['literal-secret']), /secret material/i);
});
