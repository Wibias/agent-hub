import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseP9RuntimeCanaryArgs } from '../../reference-graph/cli/p9-runtime-canary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cliPath = path.join(root, 'reference-graph/cli/p9-runtime-canary.mjs');

const required = [
  '--surface', 'public-home',
  '--job', 'creator landing page',
  '--platform', 'web-responsive',
  '--dimensions', 'visual-world,topology',
];

test('P9 canary CLI parses query-compatible requests and publishable-key environment', () => {
  const config = parseP9RuntimeCanaryArgs(
    [...required, '--profile', 'quick', '--limit', '4', '--strict-canary'],
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
  assert.equal(config.strictCanary, true);
  assert.equal(config.recordUsageEnabled, true);
});

test('P9 canary CLI accepts compatibility anon key and no-record-usage', () => {
  const config = parseP9RuntimeCanaryArgs(
    [...required, '--profile', 'quick', '--no-record-usage'],
    {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'compat-value',
    },
  );
  assert.equal(config.publishableKey, 'compat-value');
  assert.equal(config.recordUsageEnabled, false);
});

test('P9 canary CLI does not require remote configuration for standard or deep', () => {
  for (const [profile, limit] of [['standard', '8'], ['deep', '20']]) {
    const config = parseP9RuntimeCanaryArgs([...required, '--profile', profile, '--limit', limit], {});
    assert.equal(config.request.profile, profile);
    assert.equal(config.supabaseUrl, null);
    assert.equal(config.publishableKey, null);
  }
});

test('P9 quick canary requires URL and publishable key and validates query request bounds', () => {
  assert.throws(
    () => parseP9RuntimeCanaryArgs([...required, '--profile', 'quick'], {}),
    /SUPABASE_URL/i,
  );
  assert.throws(
    () => parseP9RuntimeCanaryArgs([...required, '--profile', 'quick'], { SUPABASE_URL: 'https://x.supabase.co' }),
    /publishable|anon/i,
  );
  assert.throws(
    () => parseP9RuntimeCanaryArgs(['--surface', 'public-home'], {}),
    /Missing --job/i,
  );
  assert.throws(
    () => parseP9RuntimeCanaryArgs([...required, '--profile', 'quick', '--limit', '99'], {
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'pk',
    }),
    /must be 3-6/i,
  );
});

test('P9 canary CLI source has no service-role credential path and stays separate from production query CLI', () => {
  const source = readFileSync(cliPath, 'utf8');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role[_-]?key/i);
  assert.doesNotMatch(source, /scripts\/query\.mjs|from ['"].*query\.mjs['"]/i);
  assert.match(source, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /--strict-canary/);
  assert.match(source, /--no-record-usage/);
});
