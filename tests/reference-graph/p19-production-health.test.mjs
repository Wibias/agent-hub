import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runtimeEnvWithoutElevatedSupabaseCredentialsP19,
  sampleP19ProductionHealth,
} from '../../reference-graph/p19-production-soak.mjs';

const PROD_URL = 'https://vrznfnxzlxaavpqbzbzd.supabase.co';

function graphState(overrides = {}) {
  return {
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
    ...overrides,
  };
}

function healthyProbe(overrides = {}) {
  return {
    quick: {
      authoritative_source: 'reference-graph',
      record_exact: true,
      pattern_exact: true,
      ...(overrides.quick ?? {}),
    },
    standard: {
      authoritative_source: 'legacy-control',
      ...(overrides.standard ?? {}),
    },
    deep: {
      authoritative_source: 'legacy-control',
      ...(overrides.deep ?? {}),
    },
  };
}

function env(overrides = {}) {
  return {
    SUPABASE_URL: PROD_URL,
    SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
    ...overrides,
  };
}

function clocks() {
  const values = [100, 132.5];
  return () => values.shift();
}

test('P19 health sample records exact healthy Quick graph parity with Standard/Deep legacy', async () => {
  const sample = await sampleP19ProductionHealth({
    env: env(),
    now: () => new Date('2026-10-25T01:00:00.000Z'),
    monotonicNow: clocks(),
    readState: async () => graphState(),
    probeRuntime: async () => healthyProbe(),
  });

  assert.deepEqual(sample, {
    schema_version: 'reference-graph.p19-production-health-sample.v1',
    sampled_at: '2026-10-25T01:00:00.000Z',
    target_project_ref: 'vrznfnxzlxaavpqbzbzd',
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
    probe_duration_ms: 32.5,
    routing: healthyProbe(),
    healthy: true,
    blockers: [],
  });
});

test('P19 health sample refuses wrong target or missing publishable key before probing', async () => {
  for (const [caseName, inputEnv, blocker] of [
    ['wrong target', env({ SUPABASE_URL: 'https://wrong.supabase.co' }), 'wrong-supabase-target'],
    ['missing publishable', env({ SUPABASE_PUBLISHABLE_KEY: '   ' }), 'missing-publishable-key'],
  ]) {
    let probeCalls = 0;
    const sample = await sampleP19ProductionHealth({
      env: inputEnv,
      now: () => new Date('2026-10-25T02:00:00.000Z'),
      monotonicNow: () => 10,
      readState: async () => graphState(),
      probeRuntime: async () => {
        probeCalls += 1;
        return healthyProbe();
      },
    });
    assert.equal(probeCalls, 0, caseName);
    assert.equal(sample.healthy, false, caseName);
    assert.equal(sample.routing, null, caseName);
    assert.equal(sample.probe_duration_ms, 0, caseName);
    assert.deepEqual(sample.blockers, [blocker], caseName);
  }
});

test('P19 health sample fails closed on local activation-state drift', async () => {
  const sample = await sampleP19ProductionHealth({
    env: env(),
    now: () => new Date('2026-10-25T03:00:00.000Z'),
    monotonicNow: clocks(),
    readState: async () => graphState({
      production_source: 'legacy-control',
      quick_graph_enabled: false,
      repository_default_graph_enabled: true,
    }),
    probeRuntime: async () => healthyProbe(),
  });

  assert.equal(sample.healthy, false);
  assert.deepEqual(sample.blockers, [
    'production-source-not-reference-graph',
    'quick-graph-disabled',
    'repository-default-graph-enabled',
  ]);
});

test('P19 health sample fails closed on Quick parity or Standard/Deep routing drift', async () => {
  const cases = [
    [healthyProbe({ quick: { authoritative_source: 'legacy-control' } }), 'quick-route-not-reference-graph'],
    [healthyProbe({ quick: { record_exact: false } }), 'quick-record-parity-failed'],
    [healthyProbe({ quick: { pattern_exact: false } }), 'quick-pattern-parity-failed'],
    [healthyProbe({ standard: { authoritative_source: 'reference-graph' } }), 'standard-route-not-legacy'],
    [healthyProbe({ deep: { authoritative_source: 'reference-graph' } }), 'deep-route-not-legacy'],
  ];

  for (const [probe, blocker] of cases) {
    const sample = await sampleP19ProductionHealth({
      env: env(),
      now: () => new Date('2026-10-25T04:00:00.000Z'),
      monotonicNow: clocks(),
      readState: async () => graphState(),
      probeRuntime: async () => probe,
    });
    assert.equal(sample.healthy, false, blocker);
    assert.equal(sample.blockers.includes(blocker), true, blocker);
  }
});

test('P19 health sample records only probe-error when the probe throws', async () => {
  const secretText = 'sensitive backend detail';
  const sample = await sampleP19ProductionHealth({
    env: env(),
    now: () => new Date('2026-10-25T05:00:00.000Z'),
    monotonicNow: clocks(),
    readState: async () => graphState(),
    probeRuntime: async () => { throw new Error(secretText); },
  });

  assert.equal(sample.healthy, false);
  assert.equal(sample.routing, null);
  assert.deepEqual(sample.blockers, ['probe-error']);
  assert.equal(JSON.stringify(sample).includes(secretText), false);
});

test('P19 strips elevated Supabase credentials before the P17 production probe', async () => {
  const inputEnv = env({
    SUPABASE_SECRET_KEY: 'sb_secret_should_never_reach_probe',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-should-never-reach-probe',
    KEEP_ME: 'yes',
  });
  let observedEnv;

  await sampleP19ProductionHealth({
    env: inputEnv,
    now: () => new Date('2026-10-25T06:00:00.000Z'),
    monotonicNow: clocks(),
    readState: async () => graphState(),
    probeRuntime: async ({ env: runtimeEnv }) => {
      observedEnv = runtimeEnv;
      return healthyProbe();
    },
  });

  assert.equal(observedEnv.SUPABASE_URL, PROD_URL);
  assert.equal(observedEnv.SUPABASE_PUBLISHABLE_KEY, 'publishable-test-key');
  assert.equal(observedEnv.KEEP_ME, 'yes');
  assert.equal('SUPABASE_SECRET_KEY' in observedEnv, false);
  assert.equal('SUPABASE_SERVICE_ROLE_KEY' in observedEnv, false);

  const direct = runtimeEnvWithoutElevatedSupabaseCredentialsP19(inputEnv);
  assert.equal('SUPABASE_SECRET_KEY' in direct, false);
  assert.equal('SUPABASE_SERVICE_ROLE_KEY' in direct, false);
  assert.equal(direct.KEEP_ME, 'yes');
});

test('P19 health sample output never serializes credentials, grant, nonce, signature, consumption ids, or raw records', async () => {
  const sample = await sampleP19ProductionHealth({
    env: env({
      SUPABASE_SECRET_KEY: 'sb_secret_NEVER_OUTPUT',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-NEVER_OUTPUT',
    }),
    now: () => new Date('2026-10-25T07:00:00.000Z'),
    monotonicNow: clocks(),
    readState: async () => graphState(),
    probeRuntime: async () => ({
      ...healthyProbe(),
      records: [{ secret: 'raw-record' }],
      nonce: 'n'.repeat(64),
      consumption_id: 'hidden-id',
      signature_base64: 'hidden-signature',
      grant: { hidden: true },
    }),
  });

  const serialized = JSON.stringify(sample);
  for (const forbidden of [
    'sb_secret_NEVER_OUTPUT',
    'service-role-NEVER_OUTPUT',
    'raw-record',
    'hidden-id',
    'hidden-signature',
    '"nonce"',
    '"grant"',
    'SUPABASE_PUBLISHABLE_KEY',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
