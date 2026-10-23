import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const scanner = path.join(root, 'skills/security-review-redirect/scripts/scan_secrets.py');

function runScanner(contents) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'reference-graph-secret-scan-'));
  try {
    writeFileSync(path.join(fixture, 'fixture.mjs'), contents);
    return spawnSync('python3', [scanner, fixture], {
      cwd: root,
      encoding: 'utf8',
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test('broad secret scan ignores code references used as credential values', () => {
  const result = runScanner(`
const headers = {
  apikey: this.serviceRoleKey,
  authorization: env.AUTHORIZATION_HEADER,
  token: config.runtimeToken,
};
`);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No common secret patterns found\./);
});

test('broad secret scan still rejects literal assigned secrets', () => {
  const result = runScanner(`const apiKey = 'sk-test-literal-secret-value-1234567890';\n`);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /assigned_secret|openai_key/);
  assert.doesNotMatch(result.stdout, /sk-test-literal-secret-value-1234567890/);
});
