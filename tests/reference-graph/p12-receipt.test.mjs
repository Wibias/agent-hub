import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createP12ActivationBinding,
  hashP12ActivationBinding,
} from '../../reference-graph/p12-activation-authority.mjs';
import {
  P12_PHASES,
  assertSecretFreeP12Receipt,
  createP12Receipt,
  finalizeP12Receipt,
  recordP12Phase,
} from '../../reference-graph/p12-receipt.mjs';

const TARGET = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const BASE_SHA = '541e9667ea28c75de5492b79d84edf89f9cac8ac';
const GIT_SHA = '1'.repeat(40);

function binding() {
  return createP12ActivationBinding({
    p11EvidenceHead: BASE_SHA,
    p11ImplementationSha: '849a8782be4081a5821bdb354e54c33b2e2b0fb9',
    target: TARGET,
    projectionSnapshotDate: '2026-10-24',
    querySourceSha256: 'a'.repeat(64),
    routerSourceSha256: 'b'.repeat(64),
    p11EvidenceSha256: 'c'.repeat(64),
  });
}

function baseReceipt() {
  let receipt = createP12Receipt({
    binding: binding(),
    target: TARGET,
    baseSha: BASE_SHA,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T01:00:00.000Z',
    referenceTime: '2026-10-24T00:59:00.000Z',
  });
  for (const phase of P12_PHASES) {
    receipt = recordP12Phase(receipt, {
      phase,
      status: 'success',
      detail: { verified: true },
    });
  }
  return receipt;
}

function greenPreflight(overrides = {}) {
  const value = {
    preflightReady: true,
    bindingHash: hashP12ActivationBinding(binding()),
    checks: {
      binding_contract: true,
      repository_binding: true,
      live_snapshot_current_utc_date: true,
      live_projection_complete: true,
      security_boundary: true,
    },
    blockers: [],
    ...overrides,
  };
  return value;
}

test('P12 receipt binds P11 base, P12 implementation, target, binding, and ordered phases', () => {
  const receipt = baseReceipt();
  assert.equal(receipt.schema_version, 'reference-graph.p12-activation-authority.v1');
  assert.equal(receipt.base_sha, BASE_SHA);
  assert.equal(receipt.git_sha, GIT_SHA);
  assert.deepEqual(receipt.target, TARGET);
  assert.deepEqual(receipt.activation_binding, binding());
  assert.equal(receipt.binding_hash, hashP12ActivationBinding(binding()));
  assert.deepEqual(Object.keys(receipt.phases), P12_PHASES);
  assert.equal(receipt.preflight_ready, false);
  assert.equal(receipt.grant_state, 'not-issued');
  assert.equal(receipt.activation_authorized, false);
  assert.equal(receipt.activation_performed, false);
  assert.equal(receipt.repository_default_graph_enabled, false);
  assert.equal(receipt.production_source, 'legacy-control');
});

test('P12 receipt enforces phase order and terminal failure semantics', () => {
  let receipt = createP12Receipt({
    binding: binding(),
    target: TARGET,
    baseSha: BASE_SHA,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T01:00:00.000Z',
    referenceTime: '2026-10-24T00:59:00.000Z',
  });
  assert.throws(
    () => recordP12Phase(receipt, { phase: 'live_preflight', status: 'success' }),
    /phase order/i,
  );
  receipt = recordP12Phase(receipt, { phase: 'binding', status: 'failed' });
  assert.throws(
    () => recordP12Phase(receipt, { phase: 'repository', status: 'success' }),
    /blocked by failed phase binding/i,
  );
  assert.throws(
    () => recordP12Phase(receipt, { phase: 'binding', status: 'success' }),
    /terminal after failure/i,
  );
});

test('green P12 preflight becomes ready but can never authorize or perform activation', () => {
  const receipt = finalizeP12Receipt(baseReceipt(), {
    preflight: greenPreflight(),
    blockers: [],
  });
  assert.equal(receipt.preflight_ready, true);
  assert.deepEqual(receipt.blockers, []);
  assert.equal(receipt.grant_state, 'not-issued');
  assert.equal(receipt.activation_authorized, false);
  assert.equal(receipt.activation_performed, false);
  assert.equal(receipt.repository_default_graph_enabled, false);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.deepEqual(receipt.profile_support, {
    quick: 'preflight-ready',
    standard: 'legacy-only',
    deep: 'legacy-only',
  });
});

test('receipt distrusts a green preflight boolean when binding hash, checks, or blockers disagree', () => {
  const wrongHash = finalizeP12Receipt(baseReceipt(), {
    preflight: greenPreflight({ bindingHash: 'f'.repeat(64) }),
  });
  assert.equal(wrongHash.preflight_ready, false);

  const failedCheck = finalizeP12Receipt(baseReceipt(), {
    preflight: greenPreflight({ checks: { binding_contract: true, security_boundary: false } }),
  });
  assert.equal(failedCheck.preflight_ready, false);

  const hiddenBlocker = finalizeP12Receipt(baseReceipt(), {
    preflight: greenPreflight({ blockers: ['snapshot stale'] }),
  });
  assert.equal(hiddenBlocker.preflight_ready, false);
});

test('failed phase, failed preflight, or explicit blocker prevents preflight-ready state', () => {
  const pending = baseReceipt();
  pending.phases.rollback.status = 'pending';
  const pendingFinal = finalizeP12Receipt(pending, { preflight: greenPreflight() });
  assert.equal(pendingFinal.preflight_ready, false);

  const failed = finalizeP12Receipt(baseReceipt(), {
    preflight: greenPreflight({ preflightReady: false, blockers: ['projection stale'] }),
  });
  assert.equal(failed.preflight_ready, false);
  assert.match(failed.blockers.join('\n'), /projection stale/i);

  const explicit = finalizeP12Receipt(baseReceipt(), {
    preflight: greenPreflight(),
    blockers: ['operator hold'],
  });
  assert.equal(explicit.preflight_ready, false);
  assert.match(explicit.blockers.join('\n'), /operator hold/i);
});

test('P12 receipt secret scan rejects credential-shaped fields and explicit secret material', () => {
  const receipt = finalizeP12Receipt(baseReceipt(), { preflight: greenPreflight() });
  assert.equal(assertSecretFreeP12Receipt(receipt), true);
  for (const patch of [
    { publishable_key: 'secret' },
    { service_role_key: 'secret' },
    { authorization: 'Bearer secret' },
    { database_password: 'secret' },
  ]) {
    assert.throws(
      () => assertSecretFreeP12Receipt({ ...receipt, ...patch }),
      /credential-shaped/i,
    );
  }
  assert.throws(
    () => assertSecretFreeP12Receipt({ ...receipt, note: 'contains-p12-live-secret' }, ['p12-live-secret']),
    /secret material/i,
  );
});
