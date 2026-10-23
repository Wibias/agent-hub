import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

function greenReceipt() {
  let receipt = createP9Receipt({
    binding: BINDING,
    baseSha: '619e0b490420f5292dd4bf16ae36cded4013f7d5',
    gitSha: '1111111111111111111111111111111111111111',
    verificationAt: '2026-10-23T22:00:00.000Z',
    referenceTime: '2026-10-23T12:00:00.000Z',
  });
  for (const phase of ['preflight', 'migration', 'transport', 'canary']) {
    receipt = recordP9Phase(receipt, { phase, status: 'success' });
  }
  return receipt;
}

function finalizeWithAdvisorCount(count) {
  return finalizeP9Receipt(greenReceipt(), {
    migration: {
      status: 'verified',
      migration: '008_reference_graph_runtime_canary.sql',
      runtime_rpc: 'reference_graph_quick_candidate_pool_runtime_p9',
      zero_argument: true,
      current_date_only: true,
    },
    runtimeSecurity: {
      anon_wrapper_execute: true,
      authenticated_wrapper_execute: true,
      p7_denied: true,
      p6_denied: true,
      write_denied: true,
      direct_table_select_denied: true,
      service_role_used_by_canary: false,
      security_advisor_p9_warn_error_count: count,
    },
    candidatePool: {
      status: 'available',
      candidate_count: 275,
      complete_metadata_count: 275,
      unique_legacy_id_count: 275,
      live_hash: 'same-hash',
      offline_hash: 'same-hash',
      equivalent: true,
    },
    transport: {
      status: 'available',
      live_http_transport_verified: true,
      auth_mode: 'publishable',
      candidate_count: 275,
    },
    canary: {
      status: 'available',
      case_count: 24,
      exact_record_count: 24,
      exact_pattern_count: 24,
      mismatch_count: 0,
    },
    fallbackVerification: {
      transport_failure_fallback: true,
      malformed_payload_fallback: true,
      standard_no_network: true,
      deep_no_network: true,
      usage_legacy_only: true,
    },
  });
}

test('P9 fails closed when Supabase reports P9-attributable security WARN/ERROR findings', () => {
  const receipt = finalizeWithAdvisorCount(2);
  assert.equal(receipt.least_privilege_transport_ready, false);
  assert.equal(receipt.quick_shadow_canary_ready, false);
  assert.match(receipt.blockers.join('\n'), /security|advisor|privilege/i);
});
