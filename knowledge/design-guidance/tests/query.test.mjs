import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve('knowledge/design-guidance/scripts/query.mjs');
const catalogPath = resolve('knowledge/design-guidance/catalog.json');
const relevancePath = resolve('knowledge/design-guidance/tests/relevance-cases.json');

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { ...result, json: result.stdout ? JSON.parse(result.stdout) : null };
}

test('chart query returns bounded provenance-bearing guidance', () => {
  const result = run(['--domain', 'chart', '--query', 'time series trend line', '--max-results', '2', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.domain, 'chart');
  assert.ok(result.json.count >= 1 && result.json.count <= 2);
  assert.equal(result.json.results[0].id, 'chart-trend-over-time');
  for (const row of result.json.results) {
    assert.equal(row.provenance.upstream, 'nextlevelbuilder/ui-ux-pro-max-skill');
    assert.match(row.provenance.snapshot, /^[0-9a-f]{40}$/);
  }
});

test('native query does not leak unrelated chart guidance', () => {
  const result = run(['--domain', 'native', '--query', 'safe area dynamic type touch target', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.json.results.length >= 1);
  assert.ok(result.json.results.every((row) => row.domain === 'native'));
});

test('unknown guidance is explicit and exits 2', () => {
  const result = run(['--domain', 'chart', '--query', 'quantum banana orbital petals', '--json']);
  assert.equal(result.status, 2);
  assert.equal(result.json.count, 0);
  assert.equal(result.json.match, 'none');
  assert.match(result.json.message, /No verified guidance match/);
});

test('catalog deliberately has no style, palette, typography, landing, or gsap domains', () => {
  const result = run(['--list-domains', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.json.domains.sort(), ['accessibility', 'chart', 'interaction', 'native', 'text-layout'].sort());
});

test('catalog provenance is refreshed and governed by explicit freshness windows', () => {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.source.snapshot, '28b3b8dee8c976df4fa3e94aed4e092ad43fcb03');
  assert.equal(catalog.source.reviewedAt, '2026-10-28');
  assert.deepEqual(catalog.source.freshnessPolicy, {
    reviewAfterDays: 90,
    hardExpireAfterDays: 365,
  });
});

test('query output exposes current freshness status deterministically', () => {
  const result = run(
    ['--domain', 'chart', '--query', 'time series trend line', '--json'],
    { DESIGN_GUIDANCE_NOW: '2026-10-28' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.freshness.status, 'current');
  assert.equal(result.json.freshness.ageDays, 0);
  assert.equal(result.json.results[0].provenance.freshness.status, 'current');
});

test('hard-expired catalog fails closed before returning guidance', () => {
  const result = run(
    ['--domain', 'chart', '--query', 'time series trend line', '--json'],
    { DESIGN_GUIDANCE_NOW: '2027-11-01' },
  );
  assert.equal(result.status, 3);
  assert.equal(result.json.match, 'stale-catalog');
  assert.equal(result.json.count, 0);
  assert.equal(result.json.freshness.status, 'expired');
  assert.match(result.json.message, /refresh|review/i);
});

test('relevance regression cases keep the intended record on top', () => {
  const cases = JSON.parse(readFileSync(relevancePath, 'utf8'));
  assert.ok(cases.length >= 5);
  for (const row of cases) {
    const result = run(
      ['--domain', row.domain, '--query', row.query, '--max-results', '1', '--json'],
      { DESIGN_GUIDANCE_NOW: '2026-10-28' },
    );
    assert.equal(result.status, 0, `${row.id}: ${result.stderr}`);
    assert.equal(result.json.results[0].id, row.expectedTopId, row.id);
  }
});
