import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inspectCodexPassiveMemoryHookConfiguration,
} from '../../memory-engine/codex-passive-hook-audit.mjs';

function passiveHook({ async = false, flags = '--ignore-memory-env' } = {}) {
  return {
    type: 'command',
    command: `node /hub/memory-engine/adapters/codex-passive-memory-hook-cli.mjs ${flags}`,
    ...(async ? { async: true } : {}),
  };
}

test('passive hook audit requires prompt/tool sync and root Stop async', () => {
  const result = inspectCodexPassiveMemoryHookConfiguration({
    hooks: {
      UserPromptSubmit: [{ hooks: [passiveHook()] }],
      PostToolUse: [{ hooks: [passiveHook()] }],
      Stop: [{ hooks: [passiveHook({ async: true, flags: '--ignore-memory-env --reasoning-effort medium' })] }],
    },
  });

  assert.deepEqual(result, {
    configured: true,
    userPromptSubmit: true,
    postToolUse: true,
    rootStop: true,
    promptSynchronous: true,
    toolSynchronous: true,
    stopAsynchronous: true,
    flags: { ignoreMemoryEnv: true },
  });
});

test('passive hook audit fails closed for missing or unsafe scheduling', () => {
  const result = inspectCodexPassiveMemoryHookConfiguration({
    hooks: {
      UserPromptSubmit: [{ hooks: [passiveHook({ async: true })] }],
      PostToolUse: [{ hooks: [passiveHook({ flags: '' })] }],
      Stop: [{ hooks: [passiveHook()] }],
    },
  });

  assert.equal(result.configured, false);
  assert.equal(result.promptSynchronous, false);
  assert.equal(result.toolSynchronous, true);
  assert.equal(result.stopAsynchronous, false);
  assert.equal(result.flags.ignoreMemoryEnv, false);
});

test('passive hook audit ignores unrelated commands', () => {
  assert.deepEqual(
    inspectCodexPassiveMemoryHookConfiguration({
      hooks: {
        PostToolUse: [{ hooks: [{ command: 'node other.js' }] }],
      },
    }),
    {
      configured: false,
      userPromptSubmit: false,
      postToolUse: false,
      rootStop: false,
      promptSynchronous: false,
      toolSynchronous: false,
      stopAsynchronous: false,
      flags: { ignoreMemoryEnv: false },
    },
  );
});


test('passive hook audit accepts quoted ignore-memory-env arguments', () => {
  const quoted = {
    type: 'command',
    command: 'node "C:\\hub\\memory-engine\\adapters\\codex-passive-memory-hook-cli.mjs" "--ignore-memory-env"',
  };
  const quotedStop = {
    ...quoted,
    command: quoted.command + ' "--reasoning-effort" "medium"',
    async: true,
  };

  const result = inspectCodexPassiveMemoryHookConfiguration({
    hooks: {
      UserPromptSubmit: [{ hooks: [quoted] }],
      PostToolUse: [{ hooks: [quoted] }],
      Stop: [{ hooks: [quotedStop] }],
    },
  });

  assert.equal(result.configured, true);
  assert.equal(result.flags.ignoreMemoryEnv, true);
});
