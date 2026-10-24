import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const importCli = fileURLToPath(new URL('../../reference-graph/cli/import-design-references.mjs', import.meta.url));
const embedCli = fileURLToPath(new URL('../../reference-graph/cli/embed-design-references.mjs', import.meta.url));
const p3Cli = fileURLToPath(new URL('../../reference-graph/cli/p3-live-shadow.mjs', import.meta.url));

function targetFile(projectRef = 'abcdefghijklmnopqrst') {
  const dir = mkdtempSync(join(tmpdir(), 'reference-graph-p3-'));
  const path = join(dir, 'target.json');
  writeFileSync(path, JSON.stringify({
    purpose: 'agent-hub-reference-graph',
    project_ref: projectRef,
    project_name: 'agent-hub-reference-graph',
    region: 'eu-central-1',
  }));
  return path;
}

function matchingEnv() {
  return {
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-secret',
  };
}

test('P3 keeps import and embedding plan modes credential-free and target-free', () => {
  for (const cli of [importCli, embedCli]) {
    const result = spawnSync(process.execPath, [cli, '--plan'], {
      encoding: 'utf8',
      env: {},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /--target/i);
  }
});

test('P3 import apply requires an explicit target before constructing the Supabase store', () => {
  const result = spawnSync(process.execPath, [importCli, '--apply'], {
    encoding: 'utf8',
    env: matchingEnv(),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target/i);
});

test('P3 embedding apply requires target binding before Ollama or persistence work', () => {
  const result = spawnSync(
    process.execPath,
    [embedCli, '--apply', '--allow-experimental'],
    {
      encoding: 'utf8',
      env: matchingEnv(),
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target/i);
});

test('P3 write CLIs reject a target whose project ref does not match SUPABASE_URL', () => {
  const target = targetFile('abcdefghijklmnopqrst');
  const env = {
    SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co',
  };

  const importResult = spawnSync(
    process.execPath,
    [importCli, '--apply', '--target', target],
    { encoding: 'utf8', env },
  );
  assert.notEqual(importResult.status, 0);
  assert.match(importResult.stderr, /project ref/i);

  const embedResult = spawnSync(
    process.execPath,
    [embedCli, '--apply', '--allow-experimental', '--target', target],
    { encoding: 'utf8', env },
  );
  assert.notEqual(embedResult.status, 0);
  assert.match(embedResult.stderr, /project ref/i);
});

test('P3 operator requires exactly one mode and a matching bound target', () => {
  const target = targetFile();

  const conflicting = spawnSync(
    process.execPath,
    [p3Cli, '--preflight', '--shadow-lexical', '--target', target],
    { encoding: 'utf8', env: matchingEnv() },
  );
  assert.notEqual(conflicting.status, 0);
  assert.match(conflicting.stderr, /exactly one/i);

  const mismatch = spawnSync(
    process.execPath,
    [p3Cli, '--preflight', '--target', target],
    {
      encoding: 'utf8',
      env: {
        ...matchingEnv(),
        SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co',
      },
    },
  );
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /project ref/i);
});

test('P3 preflight is read-only, secret-free, and can write a safe receipt fragment', () => {
  const target = targetFile();
  const dir = mkdtempSync(join(tmpdir(), 'reference-graph-p3-receipt-'));
  const receiptPath = join(dir, 'preflight.json');
  const result = spawnSync(
    process.execPath,
    [p3Cli, '--preflight', '--target', target, '--receipt-out', receiptPath],
    { encoding: 'utf8', env: matchingEnv() },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'preflight');
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(output.target.project_ref, 'abcdefghijklmnopqrst');
  assert.equal(output.credential_present, true);
  assert.doesNotMatch(result.stdout, /fake-service-secret/);
  assert.equal(existsSync(receiptPath), true);
  const receipt = readFileSync(receiptPath, 'utf8');
  assert.doesNotMatch(receipt, /fake-service-secret/);
  assert.equal(JSON.parse(receipt).production_source, 'legacy-control');
});

test('P3 live CLI error paths redact the Supabase credential before stderr', () => {
  for (const cli of [importCli, embedCli, p3Cli]) {
    const source = readFileSync(cli, 'utf8');
    assert.match(source, /redactDiagnostics/);
    assert.match(source, /redactDiagnostics\s*\(\s*message\s*,\s*\[?process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  }
});

test('P3 operator source carries benchmark, current-control, embedding availability, and latency evidence fields', () => {
  const source = readFileSync(p3Cli, 'utf8');
  assert.match(source, /2026-07-21T12:00:00\.000Z/);
  assert.match(source, /current_control_health/);
  assert.match(source, /embedding_availability/);
  assert.match(source, /latency_ms/);
  assert.match(source, /--verify-import/);
  assert.match(source, /--verify-embeddings/);
  assert.match(source, /--shadow-semantic/);
  assert.match(source, /--shadow-hybrid/);
});
