import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P10_PHASES,
  assertSecretFreeP10Receipt,
  createP10Receipt,
  finalizeP10Receipt,
  recordP10Phase,
} from '../../reference-graph/p10-receipt.mjs';

const BINDING = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const BASE_SHA = '535a0f9e5354ba53493fc581d0eb5a60fca04e05';
const GIT_SHA = '1111111111111111111111111111111111111111';

function baseReceipt() {
  let receipt = createP10Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T00:00:00.000Z',
    referenceTime: '2026-10-24T00:00:00.000Z',
    baseSha: BASE_SHA,
  });
  for (const phase of P10_PHASES) {
    receipt = recordP10Phase(receipt, { phase, status: 'success', detail: { verified: true } });
  }
  return receipt;
}

function migration(overrides = {}) {
  return {
    status: 'verified',
    migration: '009_reference_graph_runtime_projection.sql',
    projection: 'reference_graph_quick_runtime_projection_p10',
    refresh_rpc: 'reference_graph_refresh_quick_runtime_projection_p10',
    rls_enabled: true,
    current_date_only: true,
    p9_runtime_closed: true,
    ...overrides,
  };
}

function security(overrides = {}) {
  return {
    p9_anon_execute: false,
    p9_authenticated_execute: false,
    projection_anon_select: true,
    projection_authenticated_select: true,
    projection_runtime_write_denied: true,
    refresh_anon_execute: false,
    refresh_authenticated_execute: false,
    refresh_service_role_execute: true,
    direct_table_select_denied: true,
    service_role_used_by_canary: false,
    security_advisor_p9_p10_warn_error_count: 0,
    ...overrides,
  };
}

function projection(overrides = {}) {
  return {
    status: 'available',
    snapshot_date: '2026-10-24',
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
    snapshot_date: '2026-10-24',
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
    legacy_authoritative_count: 24,
    ...overrides,
  };
}

function fallback(overrides = {}) {
  return {
    transport_failure_fallback: true,
    malformed_payload_fallback: true,
    stale_snapshot_fallback: true,
    empty_snapshot_fallback: true,
    standard_no_network: true,
    deep_no_network: true,
    usage_legacy_only: true,
    ...overrides,
  };
}

function finalize(overrides = {}) {
  return finalizeP10Receipt(baseReceipt(), {
    migration: migration(),
    runtimeSecurity: security(),
    projection: projection(),
    transport: transport(),
    canary: canary(),
    fallbackVerification: fallback(),
    ...overrides,
  });
}

test('P10 receipt binds final P9 base and permanently keeps activation outside P10', () => {
  const receipt = baseReceipt();
  assert.equal(receipt.schema_version, 'reference-graph.p10-runtime-projection.v1');
  assert.equal(receipt.base_sha, BASE_SHA);
  assert.equal(receipt.git_sha, GIT_SHA);
  assert.deepEqual(receipt.target, BINDING);
  assert.deepEqual(Object.keys(receipt.phases), P10_PHASES);
  assert.equal(receipt.production_source, 'legacy-control');
  assert.equal(receipt.production_activation_ready, false);
  assert.equal(receipt.activation_performed, false);
});

test('P10 receipt enforces phase order and terminal failure', () => {
  let receipt = createP10Receipt({
    binding: BINDING,
    gitSha: GIT_SHA,
    verificationAt: '2026-10-24T00:00:00.000Z',
    referenceTime: '2026-10-24T00:00:00.000Z',
    baseSha: BASE_SHA,
  });
  assert.throws(() => recordP10Phase(receipt, { phase: 'canary', status: 'success' }), /phase order/i);
  receipt = recordP10Phase(receipt, { phase: 'preflight', status: 'failed' });
  assert.throws(() => recordP10Phase(receipt, { phase: 'migration', status: 'success' }), /blocked by failed phase preflight/i);
  assert.throws(() => recordP10Phase(receipt, { phase: 'preflight', status: 'success' }), /terminal after failure/i);
});

test('fully green P10 evidence marks least-privilege transport and quick shadow ready without activation', () => {
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

test('P10 security and projection structure are hard readiness gates', () => {
  for (const receipt of [
    finalize({ runtimeSecurity: security({ security_advisor_p9_p10_warn_error_count: 1 }) }),
    finalize({ runtimeSecurity: security({ p9_anon_execute: true }) }),
    finalize({ runtimeSecurity: security({ projection_runtime_write_denied: false }) }),
    finalize({ runtimeSecurity: security({ refresh_anon_execute: true }) }),
    finalize({ projection: projection({ candidate_count: 274 }) }),
    finalize({ projection: projection({ equivalent: false }) }),
    finalize({ transport: transport({ auth_mode: 'privileged' }) }),
  ]) {
    assert.equal(receipt.least_privilege_transport_ready, false);
    assert.equal(receipt.quick_shadow_canary_ready, false);
  }
});

test('stale or incomplete canary evidence blocks P10 shadow readiness', () => {
  for (const [section, patch] of [
    ['projection', { snapshot_date: '2026-10-23' }],
    ['transport', { snapshot_date: '2026-10-23' }],
    ['canary', { exact_record_count: 23 }],
    ['canary', { exact_pattern_count: 23 }],
    ['canary', { legacy_authoritative_count: 23 }],
    ['fallbackVerification', { stale_snapshot_fallback: false }],
    ['fallbackVerification', { empty_snapshot_fallback: false }],
    ['fallbackVerification', { standard_no_network: false }],
  ]) {
    const overrides = section === 'projection'
      ? { projection: projection(patch) }
      : section === 'transport'
        ? { transport: transport(patch) }
        : section === 'canary'
          ? { canary: canary(patch) }
          : { fallbackVerification: fallback(patch) };
    const receipt = finalize(overrides);
    assert.equal(receipt.quick_shadow_canary_ready, false, `${section}:${JSON.stringify(patch)}`);
  }
});

test('P10 receipt secret scan rejects credential-shaped fields and supplied key values', () => {
  const receipt = finalize();
  assert.equal(assertSecretFreeP10Receipt(receipt), true);
  assert.throws(
    () => assertSecretFreeP10Receipt({ ...receipt, service_role_key: 'secret' }),
    /credential-shaped/i,
  );
  assert.throws(
    () => assertSecretFreeP10Receipt({ ...receipt, note: 'contains-publishable-value' }, ['publishable-value']),
    /secret material/i,
  );
});
