import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  installCodexCombinedMemoryHooks,
} from '../../scripts/install-codex-combined-memory-hooks.mjs';

function corePlanner({ existing }) {
  const hooks = { ...(existing.hooks ?? {}) };
  hooks.UserPromptSubmit = [
    ...(hooks.UserPromptSubmit ?? []),
    { hooks: [{ type: 'command', command: 'node core-memory.mjs' }] },
  ];
  return {
    config: { ...existing, hooks },
    changed: true,
    diagnostics: { UserPromptSubmit: { action: 'install' } },
  };
}

function passivePlanner({ existing }) {
  const hooks = { ...(existing.hooks ?? {}) };
  hooks.PostToolUse = [
    ...(hooks.PostToolUse ?? []),
    { hooks: [{ type: 'command', command: 'node passive-memory.mjs' }] },
  ];
  return {
    config: { ...existing, hooks },
    changed: true,
    diagnostics: { PostToolUse: { action: 'install' } },
  };
}

test('combined installer composes core then passive plan and writes once with one backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-hook-composite-'));
  const hooksPath = join(root, 'hooks.json');
  await writeFile(hooksPath, JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node foreign.mjs' }] }],
    },
  }), 'utf8');

  let writes = 0;
  const result = installCodexCombinedMemoryHooks({
    hooksPath,
    hubRoot: root,
    nodePath: process.execPath,
    apply: true,
    planCoreHooks: corePlanner,
    planPassiveHooks: passivePlanner,
    writeFile(path, content, encoding) {
      writes += 1;
      writeFileSync(path, content, encoding);
    },
  });

  // The installer is intentionally synchronous like the existing host setup API.
  assert.equal(result.applied, true);
  assert.equal(writes, 1);
  assert.equal(typeof result.backupPath, 'string');
  assert.equal(result.hookTrustRequired, true);
  assert.equal(result.managed.coreMemory, true);
  assert.equal(result.managed.passiveRunExtraction, true);

  const written = JSON.parse(await readFile(hooksPath, 'utf8'));
  assert.match(JSON.stringify(written), /core-memory\.mjs/u);
  assert.match(JSON.stringify(written), /passive-memory\.mjs/u);
  assert.match(JSON.stringify(written), /foreign\.mjs/u);

  const backup = JSON.parse(await readFile(result.backupPath, 'utf8'));
  assert.doesNotMatch(JSON.stringify(backup), /core-memory\.mjs/u);
  assert.doesNotMatch(JSON.stringify(backup), /passive-memory\.mjs/u);
});

test('combined dry-run reports no write and preserves staged plan order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-hook-composite-dry-'));
  const hooksPath = join(root, 'hooks.json');
  await writeFile(hooksPath, JSON.stringify({ hooks: {} }), 'utf8');
  const seen = [];

  const result = installCodexCombinedMemoryHooks({
    hooksPath,
    hubRoot: root,
    nodePath: process.execPath,
    apply: false,
    planCoreHooks(args) {
      seen.push(['core', args.existing]);
      return corePlanner(args);
    },
    planPassiveHooks(args) {
      seen.push(['passive', args.existing]);
      return passivePlanner(args);
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.wouldChange, true);
  assert.equal(result.backupPath, null);
  assert.equal(seen.length, 2);
  assert.match(JSON.stringify(seen[1][1]), /core-memory\.mjs/u);
});
