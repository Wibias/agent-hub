import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createP12ActivationBinding,
  evaluateP12ActivationPreflight,
  hashP12ActivationBinding,
} from '../../reference-graph/p12-activation-authority.mjs';

const P11_EVIDENCE_HEAD = '541e9667ea28c75de5492b79d84edf89f9cac8ac';
const P11_IMPLEMENTATION_SHA = '849a8782be4081a5821bdb354e54c33b2e2b0fb9';
const TARGET = {
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
};
const QUERY_HASH = 'a'.repeat(64);
const ROUTER_HASH = 'b'.repeat(64);
const EVIDENCE_HASH = 'c'.repeat(64);

function bindingInput(overrides = {}) {
  return {
    p11EvidenceHead: P11_EVIDENCE_HEAD,
    p11ImplementationSha: P11_IMPLEMENTATION_SHA,
    target: TARGET,
    projectionSnapshotDate: '2026-10-24',
    querySourceSha256: QUERY_HASH,
    routerSourceSha256: ROUTER_HASH,
    p11EvidenceSha256: EVIDENCE_HASH,
    ...overrides,
  };
}

function p11Evidence(overrides = {}) {
  return {
    schema_version: 'reference-graph.p11-activation-readiness.v1',
    production_source: 'legacy-control',
    repository_default_graph_enabled: false,
    activation_performed: false,
    quick_activation_ready: true,
    profile_support: {
      quick: 'activation-ready',
      standard: 'legacy-only',
      deep: 'legacy-only',
    },
    live_activated_canary: {
      status: 'available',
      case_count: 24,
      authoritative_graph_count: 24,
      exact_record_count: 24,
      exact_pattern_count: 24,
      coverage_exit_exact_count: 24,
      mismatch_count: 0,
      auth_mode: 'publishable',
    },
    fallback_verification: {
      transport_failure_fallback: true,
      missing_key_zero_fetch_fallback: true,
      stale_snapshot_fallback: true,
      empty_snapshot_fallback: true,
      malformed_payload_fallback: true,
      usage_exact_once_graph: true,
      usage_exact_once_fallback: true,
    },
    profile_isolation: {
      standard_legacy_only: true,
      deep_legacy_only: true,
      standard_fetch_count: 0,
      deep_fetch_count: 0,
    },
    security: {
      runtime_auth_mode: 'publishable',
      service_role_runtime_used: false,
      security_advisor_p9_p10_warn_error_count: 0,
    },
    ...overrides,
  };
}

function liveProjection(overrides = {}) {
  return {
    target_status: 'ACTIVE_HEALTHY',
    snapshot_date: '2026-10-24',
    candidate_count: 275,
    metadata_complete_count: 275,
    unique_legacy_id_count: 275,
    empty_legacy_id_count: 0,
    duplicate_legacy_id_count: 0,
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

function repository(overrides = {}) {
  return {
    p11_evidence_head_matches: true,
    query_source_sha256: QUERY_HASH,
    router_source_sha256: ROUTER_HASH,
    p11_evidence_sha256: EVIDENCE_HASH,
    repository_default_graph_enabled: false,
    migration_010_present: false,
    service_role_runtime_reference: false,
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  const binding = overrides.binding ?? createP12ActivationBinding(bindingInput());
  return evaluateP12ActivationPreflight({
    binding,
    p11Evidence: overrides.p11Evidence ?? p11Evidence(),
    liveProjection: overrides.liveProjection ?? liveProjection(),
    security: overrides.security ?? security(),
    repository: overrides.repository ?? repository(),
    now: overrides.now ?? new Date('2026-10-24T12:00:00.000Z'),
  });
}

test('P12 binding freezes the exact quick-only non-executable activation contract', () => {
  const binding = createP12ActivationBinding(bindingInput());
  assert.equal(binding.schema_version, 'reference-graph.p12-activation-binding.v1');
  assert.equal(binding.p11_evidence_head, P11_EVIDENCE_HEAD);
  assert.equal(binding.p11_implementation_sha, P11_IMPLEMENTATION_SHA);
  assert.deepEqual(binding.target, TARGET);
  assert.equal(binding.profile, 'quick');
  assert.equal(binding.activation_flag, 'REFERENCE_GRAPH_QUICK_RUNTIME');
  assert.equal(binding.activation_value, 'graph');
  assert.equal(binding.runtime_auth_mode, 'publishable');
  assert.equal(binding.service_role_runtime_allowed, false);
  assert.equal(binding.timeout_ms, 1500);
  assert.equal(binding.legacy_first, true);
  assert.equal(binding.record_parity_required, 'exact-ordered');
  assert.equal(binding.pattern_parity_required, 'exact-ordered');
  assert.equal(binding.fallback_source, 'legacy-control');
  assert.equal(binding.standard_mode, 'legacy-only');
  assert.equal(binding.deep_mode, 'legacy-only');
  assert.equal(binding.repository_default_graph_enabled, false);
  assert.equal(binding.projection_candidate_count, 275);
  assert.equal(binding.projection_metadata_complete_count, 275);
  assert.equal(binding.projection_unique_legacy_id_count, 275);
  assert.equal(binding.rollback_action, 'unset-or-change-REFERENCE_GRAPH_QUICK_RUNTIME');
});

test('binding hash is stable under object-key reordering and sensitive to semantic changes', () => {
  const binding = createP12ActivationBinding(bindingInput());
  const reordered = {
    ...Object.fromEntries(Object.entries(binding).reverse()),
    target: Object.fromEntries(Object.entries(binding.target).reverse()),
  };
  const hash = hashP12ActivationBinding(binding);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashP12ActivationBinding(reordered), hash);
  assert.notEqual(
    hashP12ActivationBinding({ ...binding, timeout_ms: 1499 }),
    hash,
  );
  assert.notEqual(
    hashP12ActivationBinding({ ...binding, projection_snapshot_date: '2026-10-25' }),
    hash,
  );
});

test('binding validation fails closed on malformed hashes, target drift, or non-date snapshot', () => {
  assert.throws(
    () => createP12ActivationBinding(bindingInput({ querySourceSha256: 'bad' })),
    /sha-?256/i,
  );
  assert.throws(
    () => createP12ActivationBinding(bindingInput({ p11EvidenceHead: 'bad' })),
    /commit sha/i,
  );
  assert.throws(
    () => createP12ActivationBinding(bindingInput({ target: { ...TARGET, project_ref: 'wrong' } })),
    /target/i,
  );
  assert.throws(
    () => createP12ActivationBinding(bindingInput({ projectionSnapshotDate: 'yesterday' })),
    /snapshot date/i,
  );
});

test('fully green structural evidence yields preflight-ready without implying authority', () => {
  const result = evaluate();
  assert.equal(result.preflightReady, true);
  assert.match(result.bindingHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.blockers, []);
  assert.equal(Object.values(result.checks).every(Boolean), true);
  assert.equal('activationAuthorized' in result, false);
  assert.equal('activationPerformed' in result, false);
});

test('UTC rollover or incomplete projection fails preflight even when P11 remains green', () => {
  const stale = evaluate({ now: new Date('2026-10-25T00:00:00.000Z') });
  assert.equal(stale.preflightReady, false);
  assert.match(stale.blockers.join('\n'), /snapshot.*current utc date/i);

  for (const patch of [
    { candidate_count: 274 },
    { metadata_complete_count: 274 },
    { unique_legacy_id_count: 274 },
    { empty_legacy_id_count: 1 },
    { duplicate_legacy_id_count: 1 },
    { target_status: 'PAUSED' },
  ]) {
    const result = evaluate({ liveProjection: liveProjection(patch) });
    assert.equal(result.preflightReady, false, JSON.stringify(patch));
  }
});

test('P11 readiness, fallback, isolation, and security are structural gates', () => {
  const variants = [
    p11Evidence({ quick_activation_ready: false }),
    p11Evidence({ production_source: 'reference-graph' }),
    p11Evidence({ repository_default_graph_enabled: true }),
    p11Evidence({ activation_performed: true }),
    p11Evidence({ live_activated_canary: { ...p11Evidence().live_activated_canary, case_count: 23 } }),
    p11Evidence({ fallback_verification: { ...p11Evidence().fallback_verification, stale_snapshot_fallback: false } }),
    p11Evidence({ profile_isolation: { ...p11Evidence().profile_isolation, standard_fetch_count: 1 } }),
    p11Evidence({ security: { ...p11Evidence().security, service_role_runtime_used: true } }),
  ];
  for (const evidence of variants) {
    const result = evaluate({ p11Evidence: evidence });
    assert.equal(result.preflightReady, false);
  }
});

test('repository drift or runtime security drift invalidates preflight', () => {
  for (const patch of [
    { p11_evidence_head_matches: false },
    { query_source_sha256: 'd'.repeat(64) },
    { router_source_sha256: 'd'.repeat(64) },
    { p11_evidence_sha256: 'd'.repeat(64) },
    { repository_default_graph_enabled: true },
    { migration_010_present: true },
    { service_role_runtime_reference: true },
  ]) {
    const result = evaluate({ repository: repository(patch) });
    assert.equal(result.preflightReady, false, JSON.stringify(patch));
  }

  for (const patch of [
    { runtime_auth_mode: 'service-role' },
    { service_role_runtime_used: true },
    { security_advisor_p9_p10_warn_error_count: 1 },
  ]) {
    const result = evaluate({ security: security(patch) });
    assert.equal(result.preflightReady, false, JSON.stringify(patch));
  }
});
