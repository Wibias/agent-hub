import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  installCodexPassiveMemoryHooks,
  planCodexPassiveMemoryHooks,
} from '../../scripts/install-codex-passive-memory-hooks.mjs';

test('passive hook installer exposes plan and install functions', () => {
  assert.equal(typeof planCodexPassiveMemoryHooks, 'function');
  assert.equal(typeof installCodexPassiveMemoryHooks, 'function');
});

function existingHooks() {
  return {
    hooks: {
      UserPromptSubmit: [{
        hooks: [{ type: 'command', command: 'node C:/hub/memory-engine/adapters/codex-hook-cli.mjs --hybrid-recall' }],
      }],
      PostToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'node C:/other/watchdog.mjs' }],
      }],
      Stop: [{
        hooks: [{ type: 'command', command: 'node C:/hub/memory-engine/adapters/codex-agent-decision-hook-cli.mjs' }],
      }],
      SubagentStop: [{
        hooks: [{ type: 'command', command: 'node C:/hub/memory-engine/adapters/codex-agent-decision-hook-cli.mjs' }],
      }],
    },
    custom: { preserve: true },
  };
}

function passiveCount(entries) {
  return entries.flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks : [])
    .filter((hook) => /codex-passive-memory-hook-cli\.mjs/u.test(String(hook.command ?? '')))
    .length;
}

test('planner preserves existing memory/unrelated hooks and adds one separate passive entry per event', () => {
  const existing = existingHooks();
  const plan = planCodexPassiveMemoryHooks({
    existing,
    hubRoot: 'C:/hub',
    nodePath: 'C:/node/node.exe',
  });

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.config.custom, { preserve: true });
  assert.equal(plan.config.hooks.UserPromptSubmit.length, 2);
  assert.equal(plan.config.hooks.PostToolUse.length, 2);
  assert.equal(plan.config.hooks.Stop.length, 2);
  assert.deepEqual(plan.config.hooks.SubagentStop, existing.hooks.SubagentStop);
  for (const eventName of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
    assert.equal(passiveCount(plan.config.hooks[eventName]), 1);
    assert.equal(plan.diagnostics[eventName].action, 'install');
  }
  assert.match(
    plan.config.hooks.UserPromptSubmit[0].hooks[0].command,
    /codex-hook-cli\.mjs/u,
  );
  assert.match(
    plan.config.hooks.Stop[0].hooks[0].command,
    /codex-agent-decision-hook-cli\.mjs/u,
  );
  assert.match(
    plan.config.hooks.PostToolUse[0].hooks[0].command,
    /watchdog\.mjs/u,
  );
});

test('planner is idempotent and normalizes duplicate passive hooks without touching unrelated entries', () => {
  const first = planCodexPassiveMemoryHooks({
    existing: existingHooks(), hubRoot: 'C:/hub', nodePath: 'C:/node/node.exe',
  });
  const second = planCodexPassiveMemoryHooks({
    existing: first.config, hubRoot: 'C:/hub', nodePath: 'C:/node/node.exe',
  });
  assert.equal(second.changed, false);
  for (const eventName of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
    assert.equal(passiveCount(second.config.hooks[eventName]), 1);
    assert.equal(second.diagnostics[eventName].action, 'current');
  }

  const duplicate = structuredClone(first.config);
  duplicate.hooks.PostToolUse.push(first.config.hooks.PostToolUse.at(-1));
  const normalized = planCodexPassiveMemoryHooks({
    existing: duplicate, hubRoot: 'C:/hub', nodePath: 'C:/node/node.exe',
  });
  assert.equal(passiveCount(normalized.config.hooks.PostToolUse), 1);
  assert.equal(normalized.diagnostics.PostToolUse.action, 'normalize');
});

test('apply writes hooks atomically enough for installer contract and preserves backup of prior file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passive-hook-installer-'));
  const hooksPath = join(root, 'hooks.json');
  const before = JSON.stringify(existingHooks(), null, 2) + '\n';
  await writeFile(hooksPath, before, 'utf8');

  const applied = installCodexPassiveMemoryHooks({
    hooksPath,
    hubRoot: 'C:/hub',
    nodePath: 'C:/node/node.exe',
    apply: true,
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.hookTrustRequired, true);
  assert.ok(applied.backupPath);
  assert.equal(await readFile(applied.backupPath, 'utf8'), before);

  const written = JSON.parse(await readFile(hooksPath, 'utf8'));
  for (const eventName of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
    assert.equal(passiveCount(written.hooks[eventName]), 1);
  }

  const second = installCodexPassiveMemoryHooks({
    hooksPath,
    hubRoot: 'C:/hub',
    nodePath: 'C:/node/node.exe',
    apply: true,
  });
  assert.equal(second.wouldChange, false);
  assert.equal(second.applied, false);
  assert.equal(second.backupPath, null);
});
