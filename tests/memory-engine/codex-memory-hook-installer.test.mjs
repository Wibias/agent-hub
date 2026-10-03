import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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

function managedAgentDecisionHook(config, eventName) {
  const entries = config.hooks[eventName] ?? [];
  return entries
    .flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks : [])
    .find((hook) => /codex-agent-decision-hook-cli\.mjs/.test(
      String(hook?.command ?? '') + String(hook?.commandWindows ?? ''),
    ));
}

function managedAgentPipelineHook(config, eventName) {
  const entries = config.hooks[eventName] ?? [];
  return entries
    .flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks : [])
    .find((hook) => /codex-agent-memory-pipeline-hook\.mjs/.test(
      String(hook?.command ?? '') + String(hook?.commandWindows ?? ''),
    ));
}

function decodeWindowsPowerShellCommand(hook) {
  const command = String(hook?.commandWindows ?? '');
  const match = /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(
    command,
  );
  assert.ok(match, 'expected an encoded PowerShell command');
  return Buffer.from(match[1], 'base64').toString('utf16le');
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
  assert.deepEqual(plan.diagnostics.UserPromptSubmit, {
    event: 'UserPromptSubmit',
    action: 'install',
    managedHooksFound: 0,
    managedEntriesFound: 0,
    mixedEntries: 0,
    unrelatedHooksPreserved: 1,
    exactDefinitionPresent: false,
    reasons: ['missing_managed_hook'],
  });
  assert.deepEqual(plan.diagnostics.SessionStart, {
    event: 'SessionStart',
    action: 'install',
    managedHooksFound: 0,
    managedEntriesFound: 0,
    mixedEntries: 0,
    unrelatedHooksPreserved: 0,
    exactDefinitionPresent: false,
    reasons: ['missing_managed_hook'],
  });
  assert.equal(plan.config.version, 1);
  assert.deepEqual(plan.config.custom, { keep: true });
  assert.deepEqual(plan.config.hooks.Stop[0], unrelatedStop[0]);
  assert.equal(plan.diagnostics.Stop.action, 'install');
  assert.equal(plan.diagnostics.Stop.unrelatedHooksPreserved, 1);
  assert.equal(plan.diagnostics.SubagentStop.action, 'install');

  const stop = managedAgentDecisionHook(plan.config, 'Stop');
  assert.ok(stop);
  assert.match(stop.command, /codex-agent-decision-hook-cli\.mjs/);
  assert.match(stop.command, /--ignore-memory-env/);
  assert.doesNotMatch(stop.command, /--auto-pipeline/);
  assert.equal(stop.timeout, 10);

  const stopPipeline = managedAgentPipelineHook(plan.config, 'Stop');
  assert.ok(stopPipeline);
  assert.match(stopPipeline.command, /codex-agent-memory-pipeline-hook\.mjs/);
  assert.match(stopPipeline.command, /--ignore-memory-env/);
  assert.equal(stopPipeline.timeout, 300);
  assert.equal(stopPipeline.async, true);

  const subagentStop = managedAgentDecisionHook(plan.config, 'SubagentStop');
  assert.ok(subagentStop);
  assert.match(subagentStop.command, /codex-agent-decision-hook-cli\.mjs/);
  const subagentPipeline = managedAgentPipelineHook(
    plan.config,
    'SubagentStop',
  );
  assert.ok(subagentPipeline);
  assert.equal(subagentPipeline.async, true);
  assert.deepEqual(plan.config.hooks.UserPromptSubmit[0], unrelatedPrompt);

  const prompt = managedPromptHook(plan.config);
  assert.ok(prompt);
  assert.match(prompt.command, /--ignore-memory-env/);
  assert.match(prompt.command, /--explicit-memory-requests/);
  assert.match(prompt.command, /--hybrid-recall/);
  assert.match(prompt.command, /--candidate-capture/);
  assert.match(prompt.command, /--auto-pipeline/);
  const promptWindows = decodeWindowsPowerShellCommand(prompt);
  assert.match(promptWindows, /^& '\/usr\/bin\/node' '/);
  assert.match(promptWindows, /codex-hook-cli\.mjs/);
  assert.match(promptWindows, /'--candidate-capture'/);
  assert.match(promptWindows, /; exit \$LASTEXITCODE$/);
  assert.equal(prompt.timeout, 10);
  assert.equal(prompt.additionalContextLimit, 2500);

  const session = managedSessionHook(plan.config);
  assert.ok(session);
  assert.match(session.command, /embedding-worker-launcher\.mjs/);
  assert.match(session.command, /--cache-dir/);
  assert.equal(session.timeout, 45);
  assert.equal(session.async, true);
  const sessionWindows = decodeWindowsPowerShellCommand(session);
  assert.match(sessionWindows, /embedding-worker-launcher\.mjs/);
  assert.match(sessionWindows, /'--cache-dir'/);
  assert.match(sessionWindows, /; exit \$LASTEXITCODE$/);
});

test('installer emits shell-neutral Windows hooks with safely quoted paths', () => {
  const plan = planCodexMemoryHooks({
    existing: { hooks: {} },
    hubRoot: "/opt/Agent Hub's runtime",
    nodePath: '/opt/Node Runtime/node',
  });

  const prompt = managedPromptHook(plan.config);
  const stop = managedAgentDecisionHook(plan.config, 'Stop');
  const stopPipeline = managedAgentPipelineHook(plan.config, 'Stop');
  const subagentStop = managedAgentDecisionHook(plan.config, 'SubagentStop');
  const subagentPipeline = managedAgentPipelineHook(
    plan.config,
    'SubagentStop',
  );
  const session = managedSessionHook(plan.config);

  for (const hook of [
    prompt,
    stop,
    stopPipeline,
    subagentStop,
    subagentPipeline,
    session,
  ]) {
    assert.ok(hook);
    assert.match(
      hook.commandWindows,
      /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand /,
    );
    assert.doesNotMatch(hook.commandWindows, /Node Runtime/);
  }

  const promptScript = decodeWindowsPowerShellCommand(prompt);
  assert.match(promptScript, /^& '\/opt\/Node Runtime\/node' '/);
  assert.match(
    promptScript,
    /'\/opt\/Agent Hub''s runtime\/memory-engine\/adapters\/codex-hook-cli\.mjs'/,
  );
  assert.match(promptScript, /; exit \$LASTEXITCODE$/);

  const stopScript = decodeWindowsPowerShellCommand(stop);
  assert.match(stopScript, /codex-agent-decision-hook-cli\.mjs/);
  assert.doesNotMatch(stopScript, /'--auto-pipeline'/);
  assert.match(stopScript, /; exit \$LASTEXITCODE$/);

  const stopPipelineScript = decodeWindowsPowerShellCommand(stopPipeline);
  assert.match(
    stopPipelineScript,
    /codex-agent-memory-pipeline-hook\.mjs/,
  );
  assert.match(stopPipelineScript, /'--ignore-memory-env'/);
  assert.match(stopPipelineScript, /; exit \$LASTEXITCODE$/);

  const subagentStopScript = decodeWindowsPowerShellCommand(subagentStop);
  assert.equal(subagentStopScript, stopScript);
  const subagentPipelineScript = decodeWindowsPowerShellCommand(
    subagentPipeline,
  );
  assert.equal(subagentPipelineScript, stopPipelineScript);

  const sessionScript = decodeWindowsPowerShellCommand(session);
  assert.match(sessionScript, /embedding-worker-launcher\.mjs/);
  assert.match(sessionScript, /'--cache-dir'/);
  assert.match(sessionScript, /Agent Hub''s runtime/);
  assert.match(sessionScript, /; exit \$LASTEXITCODE$/);
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
  assert.equal(plan.diagnostics.UserPromptSubmit.action, 'normalize');
  assert.equal(plan.diagnostics.UserPromptSubmit.managedHooksFound, 2);
  assert.equal(plan.diagnostics.UserPromptSubmit.managedEntriesFound, 2);
  assert.equal(plan.diagnostics.UserPromptSubmit.mixedEntries, 1);
  assert.deepEqual(
    plan.diagnostics.UserPromptSubmit.reasons,
    [
      'duplicate_managed_hooks',
      'managed_hook_shares_entry_with_unrelated_hooks',
      'managed_definition_differs',
    ],
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

test('installer replaces stale agent decision hooks without deleting unrelated stop hooks', () => {
  const existing = {
    hooks: {
      Stop: [{
        hooks: [
          {
            type: 'command',
            command: 'node /old/memory-engine/adapters/codex-agent-decision-hook-cli.mjs',
          },
          {
            type: 'command',
            command: 'node /repo/keep-stop.mjs',
          },
        ],
      }],
      SubagentStop: [{
        hooks: [{
          type: 'command',
          commandWindows: 'node C:\\old\\memory-engine\\adapters\\codex-agent-decision-hook-cli.mjs',
        }],
      }],
    },
  };

  const plan = planCodexMemoryHooks({
    existing,
    hubRoot: HUB,
    nodePath: NODE,
  });

  assert.equal(plan.diagnostics.Stop.action, 'normalize');
  assert.equal(plan.diagnostics.Stop.mixedEntries, 1);
  assert.deepEqual(
    plan.diagnostics.Stop.reasons,
    [
      'missing_managed_hook',
      'managed_hook_shares_entry_with_unrelated_hooks',
      'managed_definition_differs',
    ],
  );
  assert.equal(plan.diagnostics.SubagentStop.action, 'normalize');

  const stopHooks = plan.config.hooks.Stop.flatMap((entry) => entry.hooks ?? []);
  assert.equal(
    stopHooks.filter((hook) => /codex-agent-decision-hook-cli\.mjs/.test(
      String(hook.command ?? '') + String(hook.commandWindows ?? ''),
    )).length,
    1,
  );
  assert.equal(
    stopHooks.filter((hook) => /codex-agent-memory-pipeline-hook\.mjs/.test(
      String(hook.command ?? '') + String(hook.commandWindows ?? ''),
    )).length,
    1,
  );
  assert.ok(
    stopHooks.some((hook) => /keep-stop\.mjs/.test(String(hook.command))),
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
  assert.equal(second.diagnostics.UserPromptSubmit.action, 'current');
  assert.equal(second.diagnostics.SessionStart.action, 'current');
  assert.equal(second.diagnostics.Stop.action, 'current');
  assert.equal(second.diagnostics.SubagentStop.action, 'current');
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
    assert.equal(dry.plan.UserPromptSubmit.action, 'install');
    assert.equal(dry.plan.SessionStart.action, 'install');
    assert.equal(dry.plan.Stop.action, 'install');
    assert.equal(dry.plan.SubagentStop.action, 'install');
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
