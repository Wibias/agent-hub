import assert from 'node:assert/strict';
import test from 'node:test';

import { planP41OperatorShadow } from '../../reference-graph/cli/p41-operator-server-shadow.mjs';

const argv = [
  '--profile', 'standard',
  '--limit', '12',
  '--surface', 'public-home',
  '--platform', 'web-responsive',
  '--job', 'creator landing page',
  '--dimensions', 'visual-world,topology',
  '--witness-file', 'C:\\audit\\p40-witness.json',
  '--witness-sha256', 'a'.repeat(64),
];
const env = { P40_SUPABASE_SECRET_KEY: 'sb_secret_p41_ci_only' };
const now = new Date('2026-11-07T11:32:00.000Z');
const readText = () => '{"external":true}';

function plan(overrides = {}) {
  return planP41OperatorShadow({
    argv, env, readText, now, records: [{}], patterns: [{}],
    ...overrides,
  });
}

test('P41 CLI plans exactly one server-only Standard/Deep shadow request', () => {
  const result = plan();
  assert.equal(result.request.profile, 'standard');
  assert.equal(result.request.limit, 12);
  assert.equal(result.request.surface, 'public-home');
  assert.equal(result.accessMode, 'server');
  assert.equal(result.supabaseUrl, 'https://vrznfnxzlxaavpqbzbzd.supabase.co/');
  assert.equal(result.serviceKey, env.P40_SUPABASE_SECRET_KEY);
  assert.equal(result.sourceWitnessJson, '{"external":true}');
  assert.equal(result.sourceWitnessSha256, 'a'.repeat(64));
});

test('P41 CLI refuses Quick, untrusted credentials, duplicate flags and missing pin', () => {
  const cases = [
    { env: {} },
    { env: { P40_SUPABASE_SECRET_KEY: 'sb_publishable_unsafe' } },
    { argv: argv.slice(0, -2) },
    { argv: ['--profile', 'quick', ...argv.slice(2)] },
    { argv: ['--profile', 'standard', '--profile', 'deep', ...argv.slice(4)] },
    { argv: [...argv.slice(0, -1), 'invalid-pin'] },
    { readText: () => { throw new Error('SECRET PRIVATE PATH'); } },
  ];
  for (const value of cases) {
    assert.throws(() => plan(value), /P41 operator input rejected/);
  }
});
