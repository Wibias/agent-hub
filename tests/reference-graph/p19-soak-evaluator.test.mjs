import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attestP19ActivationConsumption,
  evaluateP19PromotionReadiness,
} from '../../reference-graph/p19-production-soak.mjs';

const AUTHORITY = 'e3554b76b8add430a6e0276e97c9cb16702f6af57764db53445d00b49f6e965c';
const REQUEST = 'ed31630f9bda1362f42e747a6366d8504d17638b8ba458228db6fec5a2074ce7';
const PAYLOAD = 'e2ae9a9608590b1256573b6770a226daf4b38ae0440027570f90752ec6caa465';

function p18Evidence(overrides = {}) {
  return {
    schema_version: 'reference-graph.p18-production-activation-receipt.v1',
    production_target: {
      project_ref: 'vrznfnxzlxaavpqbzbzd',
      project_name: 'agent-hub-reference-graph',
      region: 'eu-central-1',
      url: 'https://vrznfnxzlxaavpqbzbzd.supabase.co',
    },
    authority_sha256: AUTHORITY,
    request_hash: REQUEST,
    grant_payload_hash: PAYLOAD,
    activation_receipt: {
      status: 'activated',
      grant_consumed: true,
      activation_performed: true,
      rollback_performed: false,
      production_source: 'reference-graph',
      blocker: null,
    },
    post_activation_status: {
      production_source: 'reference-graph',
      quick_graph_enabled: true,
      repository_default_graph_enabled: false,
    },
    ...overrides,
  };
}

function attestation(overrides = {}) {
  return {
    schema_version: 'reference-graph.p19-activation-attestation.v1',
    observed_at: '2026-10-25T01:00:00.000Z',
    p18_evidence_sha256: '5b86bd3aaa6a87399006126b56cb0db84212c48c8135acae9e77bd8d69dd5ba9',
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    authority_sha256: AUTHORITY,
    request_hash: REQUEST,
    grant_payload_hash: PAYLOAD,
    matching_count: 1,
    total_count: 1,
    exact_match: true,
    healthy: true,
    blockers: [],
    ...overrides,
  };
}

function sampleAt(date, overrides = {}) {
  return {
    schema_version: 'reference-graph.p19-production-health-sample.v1',
    sampled_at: date.toISOString(),
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
    probe_duration_ms: 25,
    routing: {
      quick: {
        authoritative_source: 'reference-graph',
        record_exact: true,
        pattern_exact: true,
      },
      standard: { authoritative_source: 'legacy-control' },
      deep: { authoritative_source: 'legacy-control' },
    },
    healthy: true,
    blockers: [],
    ...overrides,
  };
}

function samples({ count, start = '2026-10-25T00:00:00.000Z', minutes = 60 } = {}) {
  const base = Date.parse(start);
  return Array.from({ length: count }, (_, index) => sampleAt(new Date(base + index * minutes * 60_000)));
}

test('P19 independently attests the exact frozen P18 activation hashes without exposing ledger row identity', async () => {
  const calls = [];
  const store = {
    async attestActivationConsumptionP19(input) {
      calls.push(input);
      return { matching_count: 1, total_count: 1, exact_match: true };
    },
  };

  const result = await attestP19ActivationConsumption({
    p18Evidence: p18Evidence(),
    store,
    now: () => new Date('2026-10-25T08:00:00.000Z'),
  });

  assert.deepEqual(calls, [{
    grant_payload_hash: PAYLOAD,
    request_hash: REQUEST,
    authority_hash: AUTHORITY,
  }]);
  assert.deepEqual(result, {
    schema_version: 'reference-graph.p19-activation-attestation.v1',
    observed_at: '2026-10-25T08:00:00.000Z',
    p18_evidence_sha256: '5b86bd3aaa6a87399006126b56cb0db84212c48c8135acae9e77bd8d69dd5ba9',
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    authority_sha256: AUTHORITY,
    request_hash: REQUEST,
    grant_payload_hash: PAYLOAD,
    matching_count: 1,
    total_count: 1,
    exact_match: true,
    healthy: true,
    blockers: [],
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /nonce|consumption_id|signature|private_key|sb_secret_/i);
});

test('P19 refuses altered or non-activated P18 evidence before making an attestation RPC', async () => {
  const invalid = [
    p18Evidence({ schema_version: 'wrong' }),
    p18Evidence({ authority_sha256: '0'.repeat(64) }),
    p18Evidence({ request_hash: '0'.repeat(64) }),
    p18Evidence({ grant_payload_hash: '0'.repeat(64) }),
    p18Evidence({ production_target: { project_ref: 'wrong', url: 'https://wrong.supabase.co' } }),
    p18Evidence({ activation_receipt: { status: 'rolled-back', grant_consumed: true, activation_performed: false, rollback_performed: true, production_source: 'legacy-control' } }),
    p18Evidence({ post_activation_status: { production_source: 'legacy-control', quick_graph_enabled: false, repository_default_graph_enabled: false } }),
  ];

  for (const evidence of invalid) {
    let calls = 0;
    await assert.rejects(
      attestP19ActivationConsumption({
        p18Evidence: evidence,
        store: { attestActivationConsumptionP19: async () => { calls += 1; } },
      }),
      /P18 production activation evidence/i,
    );
    assert.equal(calls, 0);
  }
});

test('P19 attestation fails closed when matching or total ledger counts are unexpected', async () => {
  for (const [response, blockers] of [
    [{ matching_count: 0, total_count: 1, exact_match: false }, ['matching-count-not-one', 'exact-match-false']],
    [{ matching_count: 1, total_count: 2, exact_match: true }, ['unexpected-ledger-total']],
    [{ matching_count: 2, total_count: 2, exact_match: false }, ['matching-count-not-one', 'unexpected-ledger-total', 'exact-match-false']],
  ]) {
    const result = await attestP19ActivationConsumption({
      p18Evidence: p18Evidence(),
      store: { attestActivationConsumptionP19: async () => response },
      now: () => new Date('2026-10-25T09:00:00.000Z'),
    });
    assert.equal(result.healthy, false);
    assert.deepEqual(result.blockers, blockers);
  }
});

test('P19 24 hourly samples span only 23 hours and are not promotion eligible', () => {
  const result = evaluateP19PromotionReadiness({
    attestation: attestation(),
    samples: samples({ count: 24, minutes: 60 }),
  });
  assert.equal(result.eligible, false);
  assert.equal(result.observed_samples, 24);
  assert.equal(result.observed_window_hours, 23);
  assert.deepEqual(result.blockers, ['insufficient-soak-window']);
});

test('P19 25 healthy hourly samples spanning 24 hours are promotion eligible', () => {
  const result = evaluateP19PromotionReadiness({
    attestation: attestation(),
    samples: samples({ count: 25, minutes: 60 }),
  });
  assert.deepEqual(result, {
    schema_version: 'reference-graph.p19-promotion-readiness.v1',
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    eligible: true,
    required_window_hours: 24,
    required_samples: 24,
    allowed_max_gap_minutes: 90,
    observed_samples: 25,
    healthy_samples: 25,
    observed_window_hours: 24,
    observed_max_gap_minutes: 60,
    attestation_exact: true,
    blockers: [],
  });
});

test('P19 can accept exactly 24 samples only when they span 24 hours without exceeding the gap limit', () => {
  const result = evaluateP19PromotionReadiness({
    attestation: attestation(),
    samples: samples({ count: 24, minutes: 24 * 60 / 23 }),
  });
  assert.equal(result.eligible, true);
  assert.equal(result.observed_samples, 24);
  assert.ok(result.observed_window_hours >= 24);
  assert.ok(result.observed_max_gap_minutes <= 90);
});

test('P19 soak eligibility blocks unhealthy samples, duplicate timestamps, long gaps, and forged default enablement', () => {
  const baseline = samples({ count: 25, minutes: 60 });
  const cases = [
    [[...baseline.slice(0, 12), { ...baseline[12], healthy: false, blockers: ['probe-error'] }, ...baseline.slice(13)], 'unhealthy-sample'],
    [[...baseline.slice(0, 13), { ...baseline[13], sampled_at: baseline[12].sampled_at }, ...baseline.slice(14)], 'duplicate-sample-timestamp'],
    [samples({ count: 25, minutes: 91 }), 'sample-gap-exceeded'],
    [[...baseline.slice(0, 5), { ...baseline[5], repository_default_graph_enabled: true }, ...baseline.slice(6)], 'repository-default-graph-enabled'],
  ];

  for (const [inputSamples, blocker] of cases) {
    const result = evaluateP19PromotionReadiness({
      attestation: attestation(),
      samples: inputSamples,
    });
    assert.equal(result.eligible, false, blocker);
    assert.equal(result.blockers.includes(blocker), true, blocker);
  }
});

test('P19 soak evaluator rejects malformed or noncanonical sample timestamps', () => {
  const baseline = samples({ count: 25, minutes: 60 });
  for (const sampled_at of ['not-a-date', '2026-10-25T01:00:00Z', null]) {
    const altered = baseline.map((value, index) => index === 3 ? { ...value, sampled_at } : value);
    assert.throws(
      () => evaluateP19PromotionReadiness({ attestation: attestation(), samples: altered }),
      /sampled_at.*canonical UTC/i,
    );
  }
});

test('P19 soak evaluator returns aggregate readiness only and never embeds raw samples or probe records', () => {
  const result = evaluateP19PromotionReadiness({
    attestation: attestation(),
    samples: samples({ count: 25, minutes: 60 }),
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /routing|records|signature|nonce|consumption_id|probe_duration_ms/i);
});
