import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  installCodexMemoryHooks,
  parseCodexMemoryHookInstallArgs,
  planCodexMemoryHooks,
} from '../../scripts/install-codex-memory-hooks.mjs';

const HUB = '/opt/agent-hub';
const NODE = '/usr/bin/node';

function managedPromptHook(config) {
  const entries = config.hooks.UserPromptSubmit;
  return entries
    .flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks : [])
    .find((hook) => /codex-hook-cli\.mjs/.test(
      String(hook?.command ?? ''),
    ));
}

function managedSessionHook(config) {
  const entries = config.hooks.SessionStart;
  return entries
    .flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks : [])
    .find((hook) => /embedding-worker-launcher\.mjs/.test(
      String(hook?.command ?? ''),
    ));
}

test('installer plan adds current memory hooks while preserving unrelated hooks and root fields', () => {
  const unrelatedPrompt = {
    hooks: [{
      type: 'command',
      command: 'node /repo/other-prompt-hook.mjs',
    }],
  };
  const unrelatedStop = [{
    hooks: [{
      type: 'command',
      command: 'node /repo/stop-hook.mjs',
    }],
  }];
  const existing = {
    version: 1,
    custom: { keep: true },
    hooks: {
      UserPromptSubmit: [unrelatedPrompt],
      Stop: unrelatedStop,
    },
  };

  const plan = planCodexMemoryHooks({
    existing,
    hubRoot: HUB,
    nodePath: NODE,
  });

  assert.equal(plan.changed, true);
  assert.equal(plan.config.version, 1);
  assert.deepEqual(plan.config.custom, { keep: true });
  assert.deepEqual(plan.config.hooks.Stop, unrelatedStop);
  assert.deepEqual(plan.config.hooks.UserPromptSubmit[0], unrelatedPrompt);

  const prompt = managedPromptHook(plan.config);
  assert.ok(prompt);
  assert.match(prompt.command, /--ignore-memory-env/);
  assert.match(prompt.command, /--explicit-memory-requests/);
  assert.match(prompt.command, /--hybrid-recall/);
  assert.match(prompt.command, /--candidate-capture/);
  assert.match(prompt.command, /--auto-pipeline/);
  assert.match(prompt.commandWindows, /^"\/usr\/bin\/node"/);
  assert.equal(prompt.timeout, 10);
  assert.equal(prompt.additionalContextLimit, 2500);

  const session = managedSessionHook(plan.config);
  assert.ok(session);
  assert.match(session.command, /embedding-worker-launcher\.mjs/);
  assert.match(session.command, /--cache-dir/);
  assert.equal(session.timeout, 45);
  assert.equal(session.async, true);
});

test('installer replaces stale or duplicate managed hooks without deleting unrelated hooks in shared entries', () => {
  const existing = {
    hooks: {
      UserPromptSubmit: [
        {
          matcher: 'fixture',
          hooks: [
            {
              type: 'command',
              command: 'node /old/memory-engine/adapters/codex-hook-cli.mjs --candidate-capture',
            },
            {
              type: 'command',
              command: 'node /repo/keep-me.mjs',
            },
          ],
        },
        {
          hooks: [{
            type: 'command',
            commandWindows: 'node C:\\old\\memory-engine\\adapters\\codex-hook-cli.mjs',
          }],
        },
      ],
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node /old/memory-engine/embedding-worker-launcher.mjs',
            },
            {
              type: 'command',
              command: 'node /repo/session-keep.mjs',
            },
          ],
        },
      ],
    },
  };

  const plan = planCodexMemoryHooks({
    existing,
    hubRoot: HUB,
    nodePath: NODE,
  });

  const promptHooks = plan.config.hooks.UserPromptSubmit.flatMap(
    (entry) => entry.hooks ?? [],
  );
  assert.equal(
    promptHooks.filter((hook) => /codex-hook-cli\.mjs/.test(
      String(hook.command ?? '') + String(hook.commandWindows ?? ''),
    )).length,
    1,
  );
  assert.ok(
    promptHooks.some((hook) => /keep-me\.mjs/.test(String(hook.command))),
  );

  const sessionHooks = plan.config.hooks.SessionStart.flatMap(
    (entry) => entry.hooks ?? [],
  );
  assert.equal(
    sessionHooks.filter((hook) => /embedding-worker-launcher\.mjs/.test(
      String(hook.command ?? '') + String(hook.commandWindows ?? ''),
    )).length,
    1,
  );
  assert.ok(
    sessionHooks.some(
      (hook) => /session-keep\.mjs/.test(String(hook.command)),
    ),
  );
});

test('installer plan is idempotent after normalization', () => {
  const first = planCodexMemoryHooks({
    existing: { hooks: {} },
    hubRoot: HUB,
    nodePath: NODE,
  });
  assert.equal(first.changed, true);

  const second = planCodexMemoryHooks({
    existing: first.config,
    hubRoot: HUB,
    nodePath: NODE,
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.config, first.config);
});

test('installer is dry-run by default and apply creates a backup before changing hooks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-hook-install-'));
  const hooksPath = join(root, '.codex', 'hooks.json');
  mkdirSync(join(root, '.codex'), { recursive: true });

  const original = {
    custom: 'preserve',
    hooks: {
      Stop: [{
        hooks: [{
          type: 'command',
          command: 'node /repo/stop-hook.mjs',
        }],
      }],
    },
  };
  writeFileSync(hooksPath, JSON.stringify(original, null, 2) + '\n');

  try {
    const dry = installCodexMemoryHooks({
      hooksPath,
      hubRoot: HUB,
      nodePath: NODE,
    });
    assert.equal(dry.wouldChange, true);
    assert.equal(dry.applied, false);
    assert.equal(dry.backupPath, null);
    assert.deepEqual(
      JSON.parse(readFileSync(hooksPath, 'utf8')),
      original,
    );

    const applied = installCodexMemoryHooks({
      hooksPath,
      hubRoot: HUB,
      nodePath: NODE,
      apply: true,
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.hookTrustRequired, true);
    assert.ok(applied.backupPath);

    const backup = JSON.parse(readFileSync(applied.backupPath, 'utf8'));
    assert.deepEqual(backup, original);

    const installed = JSON.parse(readFileSync(hooksPath, 'utf8'));
    assert.equal(installed.custom, 'preserve');
    assert.ok(managedPromptHook(installed));
    assert.ok(managedSessionHook(installed));

    const second = installCodexMemoryHooks({
      hooksPath,
      hubRoot: HUB,
      nodePath: NODE,
      apply: true,
    });
    assert.equal(second.wouldChange, false);
    assert.equal(second.applied, false);
    assert.equal(second.backupPath, null);
    assert.equal(second.hookTrustRequired, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installer refuses to modify a symlinked hooks file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink creation may require elevated Windows privileges');
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-hook-symlink-'));
  const realPath = join(root, 'real.json');
  const hooksPath = join(root, 'hooks.json');
  writeFileSync(realPath, '{"hooks":{}}\n');
  symlinkSync(realPath, hooksPath);

  try {
    assert.throws(
      () => installCodexMemoryHooks({
        hooksPath,
        hubRoot: HUB,
        nodePath: NODE,
        apply: true,
      }),
      /symlinked Codex hooks file/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installer argument parser supports dry-run and explicit apply overrides', () => {
  assert.deepEqual(parseCodexMemoryHookInstallArgs([]), {
    apply: false,
    hooksPath: undefined,
    hubRoot: undefined,
    nodePath: undefined,
  });

  assert.deepEqual(
    parseCodexMemoryHookInstallArgs([
      '--apply',
      '--hooks', '/state/hooks.json',
      '--hub-root', '/repo/agent-hub',
      '--node', '/runtime/node',
    ]),
    {
      apply: true,
      hooksPath: '/state/hooks.json',
      hubRoot: '/repo/agent-hub',
      nodePath: '/runtime/node',
    },
  );

  assert.throws(
    () => parseCodexMemoryHookInstallArgs(['--wat']),
    /Unknown option/,
  );
});
