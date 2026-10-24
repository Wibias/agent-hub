import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P9_PHASES,
  assertSecretFreeP9Receipt,
  createP9Receipt,
  finalizeP9Receipt,
  recordP9Phase,
} from '../../reference-graph/p9-receipt.mjs';

const BINDING = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const BASE_SHA = '619e0b490420f5292dd4bf16ae36cded4013f7d5';
const GIT_SHA = '1111111111111111111111111111111111111111';

function baseReceipt() {
  let receipt = createP9Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-23T22:00:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
    baseSha: BASE_SHA,
  });
  for (const phase of P9_PHASES) {
    receipt = recordP9Phase(receipt, { phase, status: 'success', detail: { verified: true } });
  }
  return receipt;
}

function migration(overrides = {}) {
  return {
    status: 'verified',
    migration: '008_reference_graph_runtime_canary.sql',
    runtime_rpc: 'reference_graph_quick_candidate_pool_runtime_p9',
    zero_argument: true,
    current_date_only: true,
    ...overrides,
  };
}

function security(overrides = {}) {
  return {
    anon_wrapper_execute: true,
    authenticated_wrapper_execute: true,
    p7_denied: true,
    p6_denied: true,
    write_denied: true,
    direct_table_select_denied: true,
    service_role_used_by_canary: false,
    security_advisor_p9_warn_error_count: 0,
    ...overrides,
  };
}

function pool(overrides = {}) {
  return {
    status: 'available',
    candidate_count: 275,
    complete_metadata_count: 275,
    unique_legacy_id_count: 275,
    live_hash: 'same-hash',
    offline_hash: 'same-hash',
    equivalent: true,
    ...overrides,
  };
}

function transport(overrides = {}) {
  return {
    status: 'available',
    live_http_transport_verified: true,
    auth_mode: 'publishable',
    candidate_count: 275,
    ...overrides,
  };
}

function canary(overrides = {}) {
  return {
    status: 'available',
    case_count: 24,
    exact_record_count: 24,
    exact_pattern_count: 24,
    mismatch_count: 0,
    ...overrides,
  };
}

function fallback(overrides = {}) {
  return {
    transport_failure_fallback: true,
    malformed_payload_fallback: true,
    standard_no_network: true,
    deep_no_network: true,
    usage_legacy_only: true,
    ...overrides,
  };
}

function finalize(overrides = {}) {
  return finalizeP9Receipt(baseReceipt(), {
    migration: migration(),
    runtimeSecurity: security(),
    candidatePool: pool(),
    transport: transport(),
    canary: canary(),
    fallbackVerification: fallback(),
    ...overrides,
  });
}

test('P9 receipt binds final P8 base and keeps production activation permanently false', () => {
  const receipt = baseReceipt();
  assert.equal(receipt.schema_version, 'reference-graph.p9-runtime-canary.v1');
  assert.equal(receipt.base_sha, BASE_SHA);
  assert.equal(receipt.git_sha, GIT_SHA);
  assert.deepEqual(receipt.target, BINDING);
  assert.deepEqual(Object.keys(receipt.phases), P9_PHASES);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.activation_performed, false);
  assert.equal(receipt.production_activation_ready, false);
});

test('P9 receipt enforces phase order and terminal failure', () => {
  let receipt = createP9Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-23T22:00:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
    baseSha: BASE_SHA,
  });
  assert.throws(() => recordP9Phase(receipt, { phase: 'transport', status: 'success' }), /phase order/i);
  receipt = recordP9Phase(receipt, { phase: 'preflight', status: 'failed' });
  assert.throws(() => recordP9Phase(receipt, { phase: 'migration', status: 'success' }), /blocked by failed phase preflight/i);
  assert.throws(() => recordP9Phase(receipt, { phase: 'preflight', status: 'success' }), /terminal after failure/i);
});

test('fully green P9 evidence marks least-privilege transport and quick shadow ready without activating production', () => {
  const receipt = finalize();
  assert.equal(receipt.least_privilege_transport_ready, true);
  assert.equal(receipt.quick_shadow_canary_ready, true);
  assert.equal(receipt.production_activation_ready, false);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.activation_performed, false);
  assert.deepEqual(receipt.blockers, []);
  assert.deepEqual(receipt.profile_support, {
    quick: 'shadow-ready',
    standard: 'legacy-only',
    deep: 'legacy-only',
  });
});

test('P9 structural gates reject broad privileges, incomplete pool, or non-publishable transport', () => {
  const broad = finalize({ runtimeSecurity: security({ p7_denied: false }) });
  assert.equal(broad.least_privilege_transport_ready, false);
  assert.match(broad.blockers.join('\n'), /security|privilege/i);

  const incomplete = finalize({ candidatePool: pool({ unique_legacy_id_count: 274 }) });
  assert.equal(incomplete.quick_shadow_canary_ready, false);
  assert.match(incomplete.blockers.join('\n'), /candidate pool/i);

  const wrongAuth = finalize({ transport: transport({ auth_mode: 'privileged' }) });
  assert.equal(wrongAuth.least_privilege_transport_ready, false);
  assert.match(wrongAuth.blockers.join('\n'), /transport/i);
});

test('P9 requires live HTTP verification plus exact 24-case records and patterns', () => {
  const noHttp = finalize({ transport: transport({ live_http_transport_verified: false }) });
  assert.equal(noHttp.least_privilege_transport_ready, false);

  for (const [field, value] of [
    ['case_count', 23],
    ['exact_record_count', 23],
    ['exact_pattern_count', 23],
    ['mismatch_count', 1],
  ]) {
    const receipt = finalize({ canary: canary({ [field]: value }) });
    assert.equal(receipt.quick_shadow_canary_ready, false, field);
    assert.match(receipt.blockers.join('\n'), /canary/i);
  }
});

test('P9 requires fallback and standard/deep no-network regression evidence', () => {
  for (const field of [
    'transport_failure_fallback',
    'malformed_payload_fallback',
    'standard_no_network',
    'deep_no_network',
    'usage_legacy_only',
  ]) {
    const receipt = finalize({ fallbackVerification: fallback({ [field]: false }) });
    assert.equal(receipt.quick_shadow_canary_ready, false, field);
    assert.match(receipt.blockers.join('\n'), /fallback|no-network|usage/i);
  }
});

test('P9 phase failure blocks readiness even when evidence payloads claim green', () => {
  let receipt = createP9Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-23T22:00:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
    baseSha: BASE_SHA,
  });
  receipt = recordP9Phase(receipt, { phase: 'preflight', status: 'success' });
  receipt = recordP9Phase(receipt, { phase: 'migration', status: 'failed' });
  const final = finalizeP9Receipt(receipt, {
    migration: migration(),
    runtimeSecurity: security(),
    candidatePool: pool(),
    transport: transport(),
    canary: canary(),
    fallbackVerification: fallback(),
  });
  assert.equal(final.least_privilege_transport_ready, false);
  assert.equal(final.quick_shadow_canary_ready, false);
  assert.match(final.blockers.join('\n'), /phase migration/i);
});

test('P9 receipt secret scan accepts finalized structural security fields', () => {
  assert.equal(assertSecretFreeP9Receipt(finalize()), true);
});

test('P9 receipt secret scan rejects credential-shaped fields and supplied key values', () => {
  const receipt = baseReceipt();
  assert.equal(assertSecretFreeP9Receipt(receipt), true);
  assert.throws(
    () => assertSecretFreeP9Receipt({ ...receipt, service_role_key: 'secret' }),
    /credential-shaped/i,
  );
  assert.throws(
    () => assertSecretFreeP9Receipt({ ...receipt, note: 'contains-publishable-value' }, ['publishable-value']),
    /secret material/i,
  );
});