import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const validator = path.resolve('skills/verification-harness/scripts/validate-verification-skill.mjs');

async function makeVerifier({ controlSurface = '', helper = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-control-surface-'));
  await mkdir(path.join(root, 'features'), { recursive: true });
  if (helper) {
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await writeFile(path.join(root, helper.path), helper.content || '#!/usr/bin/env node\n');
  }
  await writeFile(path.join(root, 'features', 'README.md'), '# Features\n\n- settings\n');
  await writeFile(path.join(root, 'SKILL.md'), `---
name: verify-demo
description: Drive Demo through its real surface and capture runtime evidence.
---

# Verify Demo

## Launch
Start Demo.

## Doctor
Confirm Demo is ready.

${controlSurface}

## Drive
Exercise the real user path.

## Evidence
Capture a head-bound receipt.

## Cleanup
Remove verifier-owned resources.

## Feature map
Read features/README.md.
`);
  return root;
}

function runValidator(root) {
  return spawnSync(process.execPath, [validator, root], { encoding: 'utf8' });
}

test('rejects a verifier without a reusable control surface contract', async () => {
  const root = await makeVerifier();
  const result = runValidator(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Control surface/);
});

test('accepts an existing reusable project control surface', async () => {
  const root = await makeVerifier({
    controlSurface: `## Control surface
Mode: existing
Command: npm run app:verify -- --json`,
  });
  const result = runValidator(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('rejects helper mode when the persistent helper is missing', async () => {
  const root = await makeVerifier({
    controlSurface: `## Control surface
Mode: helper
Command: node .agents/skills/verify-demo/scripts/control-demo.mjs
Helper: scripts/control-demo.mjs`,
  });
  const result = runValidator(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /helper.*missing/i);
});

test('accepts helper mode when the project-local helper exists', async () => {
  const root = await makeVerifier({
    controlSurface: `## Control surface
Mode: helper
Command: node .agents/skills/verify-demo/scripts/control-demo.mjs
Helper: scripts/control-demo.mjs`,
    helper: {
      path: 'scripts/control-demo.mjs',
      content: '#!/usr/bin/env node\nprocess.stdout.write("{}\\n");\n',
    },
  });
  const result = runValidator(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('rejects helper mode when the helper is a symlink outside the verifier', async () => {
  const root = await makeVerifier({
    controlSurface: `## Control surface
Mode: helper
Command: node .agents/skills/verify-demo/scripts/control-demo.mjs
Helper: scripts/control-demo.mjs`,
  });
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'verify-control-outside-'));
  const outside = path.join(outsideRoot, 'control-demo.mjs');
  await writeFile(outside, '#!/usr/bin/env node\n');
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await symlink(outside, path.join(root, 'scripts', 'control-demo.mjs'));

  const result = runValidator(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular verifier-owned file/i);
});
