import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const gate = resolve(root, 'skills/quality-constraints/scripts/quality-gate.mjs');

function invoke(tool, data) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-scanner-gate-'));
  const file = join(dir, 'report.json');
  try {
    writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
    return spawnSync(process.execPath, [gate, tool, file], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function semgrep(...severities) {
  return {
    results: severities.map(severity => ({ extra: { severity } })),
    errors: [],
    paths: { scanned: ['src/app.js'] },
  };
}

function axe(impact, url = 'https://example.test/app') {
  return { url, violations: impact == null ? [] : [{ impact }] };
}

test('scanner gate passes clean or non-blocking Semgrep findings', () => {
  assert.equal(invoke('semgrep', semgrep()).status, 0);
  assert.equal(invoke('semgrep', semgrep('INFO', 'WARNING', 'MEDIUM')).status, 0);
});

test('scanner gate blocks high, critical and legacy ERROR Semgrep findings', () => {
  for (const level of ['ERROR', 'HIGH', 'CRITICAL']) {
    const result = invoke('semgrep', semgrep('LOW', level));
    assert.equal(result.status, 1, level + ': ' + result.stderr);
    assert.match(result.stdout, /1 blocking/);
  }
});

test('scanner gate fails closed when Semgrep did not complete or the format is unknown', () => {
  const cases = [
    { ...semgrep(), errors: [{ message: 'aborted' }] },
    { ...semgrep(), paths: { scanned: [] } },
    { ...semgrep(), results: [null] },
    semgrep('UNRECOGNIZED'),
    { results: [], errors: [] },
    '{',
  ];
  for (const report of cases) assert.equal(invoke('semgrep', report).status, 2);
});

test('scanner gate checks every axe page and rejects serious/critical findings', () => {
  assert.equal(invoke('axe', [axe(null), axe('moderate')]).status, 0);
  for (const level of ['serious', 'critical']) {
    const result = invoke('axe', [axe('minor'), axe(level, 'https://example.test/other')]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /1 blocking/);
  }
});

test('scanner gate never treats malformed or incomplete axe results as clean', () => {
  for (const report of [[], [null], [axe('unknown')], [{ violations: [] }], [axe(null, 'chrome-error://chromewebdata/')], '{}']) {
    assert.equal(invoke('axe', report).status, 2);
  }
  assert.equal(invoke('unknown', [axe(null)]).status, 2);
});

test('quality-constraints documents opt-in report evaluation without claiming the scanner ran', () => {
  const guide = readFileSync(resolve(root, 'skills/quality-constraints/references/project-contract.md'), 'utf8');
  assert.equal(existsSync(gate), true);
  assert.match(guide, /quality-gate\.mjs/);
  assert.match(guide, /scan report|scanner report/i);
  assert.match(guide, /exit (?:status|codes?).*2|exit 2/i);
  assert.match(guide, /does not run|not run|not a scanner/i);
});

test('Motion independent transforms are version-gated, and layout remains main-thread work', () => {
  const standards = readFileSync(resolve(root, 'skills/design-with-ai/references/standards.md'), 'utf8');
  assert.match(standards, /Motion 14\.2\+/i);
  assert.match(standards, /x.*y.*scale.*rotate/s);
  assert.match(standards, /before 14\.2|pre-14\.2/i);
  assert.match(standards, /layout.*main thread/i);
});

test('PR review checks reachable callers and baseline without exposing possible secret values', () => {
  const reviews = readFileSync(resolve(root, 'skills/github-delivery/references/policy/reviews.md'), 'utf8');
  assert.match(reviews, /caller/i);
  assert.match(reviews, /baseline/i);
  assert.match(reviews, /zero findings/i);
  assert.match(reviews, /secret values|raw secrets/i);
});
