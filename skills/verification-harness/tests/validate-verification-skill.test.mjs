import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const validator = path.resolve('skills/verification-harness/scripts/validate-verification-skill.mjs');

async function makeVerifier({ body, featureMap = '# Features\n\n- settings\n' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-skill-'));
  await mkdir(path.join(root, 'features'), { recursive: true });
  const skill = body || `---\nname: verify-demo\ndescription: Drive Demo through its real CLI and capture runtime evidence.\n---\n\n# Verify Demo\n\n## Launch\nRun the project CLI.\n\n## Doctor\nConfirm the checkout and build are current.\n\n## Control surface\nMode: existing\nCommand: demo --json\n\n## Drive\nUse the public CLI.\n\n## Evidence\nWrite a schema-versioned receipt bound to HEAD.\n\n## Cleanup\nRemove only resources created by this run.\n\n## Feature map\nRead features/README.md and the affected feature file.\n`;
  await writeFile(path.join(root, 'SKILL.md'), skill);
  await writeFile(path.join(root, 'features', 'README.md'), featureMap);
  return root;
}

function runValidator(root, receipt) {
  const args = [validator, root];
  if (receipt) args.push('--receipt', receipt);
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('accepts a minimal project verification skill', async () => {
  const root = await makeVerifier();
  const result = runValidator(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('rejects a verifier without a Doctor contract', async () => {
  const root = await makeVerifier({
    body: `---\nname: verify-demo\ndescription: Verify Demo.\n---\n\n## Launch\nRun it.\n\n## Control surface\nMode: existing\nCommand: demo --json\n\n## Drive\nUse it.\n\n## Evidence\nCapture it.\n\n## Cleanup\nClean it.\n\n## Feature map\nRead features.\n`,
  });
  const result = runValidator(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Doctor/);
});

test('rejects Cursor-specific project skill paths', async () => {
  const root = await makeVerifier({
    body: `---\nname: verify-demo\ndescription: Verify Demo.\n---\n\n## Launch\nRun .cursor/skills/verify-demo/control.mjs.\n\n## Doctor\nCheck it.\n\n## Control surface\nMode: existing\nCommand: demo --json\n\n## Drive\nUse it.\n\n## Evidence\nCapture it.\n\n## Cleanup\nClean it.\n\n## Feature map\nRead features.\n`,
  });
  const result = runValidator(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cursor-specific/);
});

test('accepts a head-bound passing receipt with successful cleanup', async () => {
  const root = await makeVerifier();
  const receipt = path.join(root, 'receipt.json');
  await writeFile(receipt, JSON.stringify({
    schema_version: 1,
    run_id: 'run-1',
    repository: 'owner/repo',
    head_sha: '0123456789abcdef0123456789abcdef01234567',
    surface: 'cli',
    feature: 'settings',
    result: 'pass',
    checks: [{ id: 'settings-roundtrip', result: 'pass' }],
    artifacts: [],
    side_effects: [],
    started_resources: [],
    cleanup: 'pass',
    blocked_reason: null,
  }));
  const result = runValidator(root, receipt);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('rejects a pass receipt that is not bound to a full git SHA', async () => {
  const root = await makeVerifier();
  const receipt = path.join(root, 'receipt.json');
  await writeFile(receipt, JSON.stringify({
    schema_version: 1,
    run_id: 'run-1',
    repository: 'owner/repo',
    head_sha: 'abc123',
    surface: 'cli',
    feature: 'settings',
    result: 'pass',
    checks: [{ id: 'settings-roundtrip', result: 'pass' }],
    artifacts: [],
    side_effects: [],
    started_resources: [],
    cleanup: 'pass',
    blocked_reason: null,
  }));
  const result = runValidator(root, receipt);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /head_sha/);
});

test('rejects blocked receipts without a concrete reason', async () => {
  const root = await makeVerifier();
  const receipt = path.join(root, 'receipt.json');
  await writeFile(receipt, JSON.stringify({
    schema_version: 1,
    run_id: 'run-1',
    repository: 'owner/repo',
    head_sha: '0123456789abcdef0123456789abcdef01234567',
    surface: 'cli',
    feature: 'settings',
    result: 'blocked',
    checks: [],
    artifacts: [],
    side_effects: [],
    started_resources: [],
    cleanup: 'pass',
    blocked_reason: null,
  }));
  const result = runValidator(root, receipt);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked_reason/);
});
