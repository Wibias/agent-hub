import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve('knowledge/design-guidance/scripts/query.mjs');

function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
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
