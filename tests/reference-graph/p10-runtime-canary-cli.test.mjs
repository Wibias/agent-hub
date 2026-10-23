import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseP10RuntimeCanaryArgs,
  runP10RuntimeCanaryCli,
} from '../../reference-graph/cli/p10-runtime-canary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cliPath = path.join(root, 'reference-graph/cli/p10-runtime-canary.mjs');

const required = [
  '--surface', 'public-home',
  '--job', 'creator landing page',
  '--platform', 'web-responsive',
  '--dimensions', 'visual-world,topology',
];

test('P10 canary CLI parses quick projection transport and fixed reference date', () => {
  const config = parseP10RuntimeCanaryArgs(
    [
      ...required,
      '--profile', 'quick',
      '--limit', '4',
      '--reference-date', '2026-10-24',
      '--strict-canary',
    ],
    {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-value',
      SUPABASE_ANON_KEY: 'compat-value',
    },
  );

  assert.deepEqual(config.request, {
    profile: 'quick',
    limit: 4,
    surface: 'public-home',
    platform: 'web-responsive',
    job: 'creator landing page',
    dimensions: 'visual-world,topology',
  });
  assert.equal(config.supabaseUrl, 'https://project.supabase.co');
  assert.equal(config.publishableKey, 'publishable-value');
  assert.equal(config.referenceDate, '2026-10-24');
  assert.equal(config.strictCanary, true);
  assert.equal(config.recordUsageEnabled, true);
});

test('P10 canary CLI accepts anon-key compatibility and validates reference date', () => {
  const config = parseP10RuntimeCanaryArgs(
    [...required, '--profile', 'quick', '--reference-date', '2026-10-24', '--no-record-usage'],
    {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'compat-value',
    },
  );
  assert.equal(config.publishableKey, 'compat-value');
  assert.equal(config.recordUsageEnabled, false);

  assert.throws(
    () => parseP10RuntimeCanaryArgs(
      [...required, '--profile', 'quick', '--reference-date', '24-10-2026'],
      { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' },
    ),
    /reference-date|YYYY-MM-DD/i,
  );
});

test('P10 standard and deep remain remote-config-free legacy-only modes', () => {
  for (const [profile, limit] of [['standard', '8'], ['deep', '20']]) {
    const config = parseP10RuntimeCanaryArgs([...required, '--profile', profile, '--limit', limit], {});
    assert.equal(config.request.profile, profile);
    assert.equal(config.supabaseUrl, null);
    assert.equal(config.publishableKey, null);
  }
});

test('P10 standard path performs no fetch even when an injected fetch would fail', async () => {
  let fetchCount = 0;
  const stdout = { chunks: [], write(value) { this.chunks.push(value); } };
  const code = await runP10RuntimeCanaryCli({
    argv: [...required, '--profile', 'standard', '--limit', '8', '--no-record-usage'],
    env: {},
    stdout,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error('network must not run');
    },
  });
  assert.equal(fetchCount, 0);
  assert.equal(code, 0);
  const output = JSON.parse(stdout.chunks.join(''));
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(output.graph_canary.status, 'legacy-only');
  assert.equal(output.graph_canary.attempted, false);
});

test('P10 strict quick mode remains legacy-authoritative and returns nonzero on invalid projection payload', async () => {
  const stdout = { chunks: [], write(value) { this.chunks.push(value); } };
  const code = await runP10RuntimeCanaryCli({
    argv: [
      ...required,
      '--profile', 'quick',
      '--limit', '4',
      '--reference-date', '2026-10-24',
      '--strict-canary',
      '--no-record-usage',
    ],
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-secret-value',
    },
    stdout,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return []; } }),
  });
  assert.equal(code, 3);
  const serialized = stdout.chunks.join('');
  assert.doesNotMatch(serialized, /publishable-secret-value/);
  const output = JSON.parse(serialized);
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(output.graph_canary.status, 'fallback');
  assert.equal(output.graph_canary.attempted, true);
});

test('P10 canary CLI source reuses P9 canary behavior and has no privileged credential path', () => {
  const source = readFileSync(cliPath, 'utf8');
  assert.match(source, /runP9ShadowCanary/);
  assert.match(source, /fetchP10QuickCandidatePool/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role[_-]?key/i);
  assert.doesNotMatch(source, /scripts\/query\.mjs|from ['"].*query\.mjs['"]/i);
  assert.match(source, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /--strict-canary/);
  assert.match(source, /--no-record-usage/);
});
