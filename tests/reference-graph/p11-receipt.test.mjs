import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P11_PHASES,
  assertSecretFreeP11Receipt,
  createP11Receipt,
  finalizeP11Receipt,
  recordP11Phase,
} from '../../reference-graph/p11-receipt.mjs';

const BINDING = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const BASE_SHA = '43a81a3fb2ee42e083c7ca4bf6d132663c54d51d';
const GIT_SHA = '1111111111111111111111111111111111111111';

function baseReceipt() {
  let receipt = createP11Receipt({
    binding: BINDING,
    baseSha: BASE_SHA,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T00:00:00.000Z',
    referenceTime: '2026-10-24T00:00:00.000Z',
  });
  for (const phase of P11_PHASES) {
    receipt = recordP11Phase(receipt, {
      phase,
      status: 'success',
      detail: { verified: true },
    });
  }
  return receipt;
}

function defaultOff(overrides = {}) {
  return {
    verified: true,
    repository_default_graph_enabled: false,
    default_quick_legacy_equivalent: true,
    default_graph_fetch_count: 0,
    ...overrides,
  };
}

function liveActivatedCanary(overrides = {}) {
  return {
    status: 'available',
    case_count: 24,
    authoritative_graph_count: 24,
    exact_record_count: 24,
    exact_pattern_count: 24,
    coverage_exit_exact_count: 24,
    mismatch_count: 0,
    auth_mode: 'publishable',
    ...overrides,
  };
}

function fallbackVerification(overrides = {}) {
  return {
    transport_failure_fallback: true,
    missing_key_zero_fetch_fallback: true,
    stale_snapshot_fallback: true,
    empty_snapshot_fallback: true,
    malformed_payload_fallback: true,
    usage_exact_once_graph: true,
    usage_exact_once_fallback: true,
    ...overrides,
  };
}

function profileIsolation(overrides = {}) {
  return {
    standard_legacy_only: true,
    deep_legacy_only: true,
    standard_fetch_count: 0,
    deep_fetch_count: 0,
    ...overrides,
  };
}

function security(overrides = {}) {
  return {
    runtime_auth_mode: 'publishable',
    service_role_runtime_used: false,
    security_advisor_p9_p10_warn_error_count: 0,
    ...overrides,
  };
}

function finalize(overrides = {}) {
  return finalizeP11Receipt(baseReceipt(), {
    defaultOff: defaultOff(),
    liveActivatedCanary: liveActivatedCanary(),
    fallbackVerification: fallbackVerification(),
    profileIsolation: profileIsolation(),
    security: security(),
    blockers: [],
    ...overrides,
  });
}

test('P11 receipt binds P10 base and preserves repository default-off production semantics', () => {
  const receipt = baseReceipt();
  assert.equal(receipt.schema_version, 'reference-graph.p11-activation-readiness.v1');
  assert.equal(receipt.base_sha, BASE_SHA);
  assert.equal(receipt.git_sha, GIT_SHA);
  assert.deepEqual(receipt.target, BINDING);
  assert.deepEqual(Object.keys(receipt.phases), P11_PHASES);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.repository_default_graph_enabled, false);
  assert.equal(receipt.activation_performed, false);
  assert.equal(receipt.quick_activation_ready, false);
});

test('P11 receipt enforces phase order and terminal failure', () => {
  let receipt = createP11Receipt({
    binding: BINDING,
    baseSha: BASE_SHA,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T00:00:00.000Z',
    referenceTime: '2026-10-24T00:00:00.000Z',
  });
  assert.throws(
    () => recordP11Phase(receipt, { phase: 'live_canary', status: 'success' }),
    /phase order/i,
  );
  receipt = recordP11Phase(receipt, { phase: 'preflight', status: 'failed' });
  assert.throws(
    () => recordP11Phase(receipt, { phase: 'router', status: 'success' }),
    /blocked by failed phase preflight/i,
  );
  assert.throws(
    () => recordP11Phase(receipt, { phase: 'preflight', status: 'success' }),
    /terminal after failure/i,
  );
});

test('fully green P11 evidence may mark quick activation ready without changing repository default', () => {
  const receipt = finalize();
  assert.equal(receipt.quick_activation_ready, true);
  assert.equal(receipt.repository_default_graph_enabled, false);
  assert.equal(receipt.activation_performed, false);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.deepEqual(receipt.profile_support, {
    quick: 'activation-ready',
    standard: 'legacy-only',
    deep: 'legacy-only',
  });
  assert.deepEqual(receipt.blockers, []);
});

test('P11 structural canary, fallback, profile isolation, and security gates fail closed', () => {
  const receipts = [
    finalize({ defaultOff: defaultOff({ repository_default_graph_enabled: true }) }),
    finalize({ defaultOff: defaultOff({ default_graph_fetch_count: 1 }) }),
    finalize({ liveActivatedCanary: liveActivatedCanary({ case_count: 23 }) }),
    finalize({ liveActivatedCanary: liveActivatedCanary({ authoritative_graph_count: 23 }) }),
    finalize({ liveActivatedCanary: liveActivatedCanary({ exact_record_count: 23 }) }),
    finalize({ liveActivatedCanary: liveActivatedCanary({ exact_pattern_count: 23 }) }),
    finalize({ liveActivatedCanary: liveActivatedCanary({ coverage_exit_exact_count: 23 }) }),
    finalize({ liveActivatedCanary: liveActivatedCanary({ mismatch_count: 1 }) }),
    finalize({ fallbackVerification: fallbackVerification({ transport_failure_fallback: false }) }),
    finalize({ fallbackVerification: fallbackVerification({ malformed_payload_fallback: false }) }),
    finalize({ fallbackVerification: fallbackVerification({ usage_exact_once_graph: false }) }),
    finalize({ profileIsolation: profileIsolation({ standard_fetch_count: 1 }) }),
    finalize({ profileIsolation: profileIsolation({ deep_legacy_only: false }) }),
    finalize({ security: security({ runtime_auth_mode: 'service-role' }) }),
    finalize({ security: security({ service_role_runtime_used: true }) }),
    finalize({ security: security({ security_advisor_p9_p10_warn_error_count: 1 }) }),
  ];
  for (const receipt of receipts) {
    assert.equal(receipt.quick_activation_ready, false);
    assert.equal(receipt.repository_default_graph_enabled, false);
    assert.equal(receipt.activation_performed, false);
    assert.equal(receipt.production_source, 'legacy-control');
  }
});

test('missing phase or explicit blocker prevents P11 activation readiness', () => {
  const missingPhase = baseReceipt();
  missingPhase.phases.rollback.status = 'pending';
  const finalizedMissing = finalizeP11Receipt(missingPhase, {
    defaultOff: defaultOff(),
    liveActivatedCanary: liveActivatedCanary(),
    fallbackVerification: fallbackVerification(),
    profileIsolation: profileIsolation(),
    security: security(),
  });
  assert.equal(finalizedMissing.quick_activation_ready, false);

  const blocked = finalize({ blockers: ['operator approval withheld'] });
  assert.equal(blocked.quick_activation_ready, false);
  assert.match(blocked.blockers.join('\n'), /operator approval withheld/);
});

test('P11 receipt secret scan rejects credential-shaped fields and explicit secret material', () => {
  const receipt = finalize();
  assert.equal(assertSecretFreeP11Receipt(receipt), true);
  for (const patch of [
    { publishable_key: 'secret' },
    { service_role_key: 'secret' },
    { authorization: 'Bearer secret' },
    { database_password: 'secret' },
  ]) {
    assert.throws(
      () => assertSecretFreeP11Receipt({ ...receipt, ...patch }),
      /credential-shaped/i,
    );
  }
  assert.throws(
    () => assertSecretFreeP11Receipt({ ...receipt, note: 'contains-live-key-value' }, ['live-key-value']),
    /secret material/i,
  );
});
