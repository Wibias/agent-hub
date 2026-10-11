import test from 'node:test';
import assert from 'node:assert/strict';

test('passive hook config builder exposes prompt, tool, and root-stop entries', async () => {
  let module = null;
  try {
    module = await import('../../memory-engine/codex-passive-memory-hook-config.mjs');
  } catch {}
  assert.equal(typeof module?.buildCodexPassiveMemoryHookEntries, 'function');
});

test('passive hook entries keep prompt/tool synchronous and root Stop asynchronous', async () => {
  const { buildCodexPassiveMemoryHookEntries } = await import(
    '../../memory-engine/codex-passive-memory-hook-config.mjs'
  );
  const entries = buildCodexPassiveMemoryHookEntries({
    hubRoot: 'C:/Users/ws/.agents',
    nodePath: 'C:/Program Files/nodejs/node.exe',
    model: 'gpt-test',
    reasoningEffort: 'high',
    judgeTimeoutMs: 91_000,
  });

  assert.deepEqual(Object.keys(entries).sort(), ['PostToolUse', 'Stop', 'UserPromptSubmit']);
  const prompt = entries.UserPromptSubmit.hooks[0];
  const tool = entries.PostToolUse.hooks[0];
  const stop = entries.Stop.hooks[0];

  assert.equal(prompt.async, undefined);
  assert.equal(tool.async, undefined);
  assert.equal(stop.async, true);
  assert.equal(prompt.timeout, 10);
  assert.equal(tool.timeout, 10);
  assert.equal(stop.timeout, 600);
  assert.match(prompt.command, /codex-passive-memory-hook-cli\.mjs/u);
  assert.match(tool.command, /codex-passive-memory-hook-cli\.mjs/u);
  assert.match(stop.command, /--reasoning-effort" "high/u);
  assert.match(stop.command, /--judge-timeout-ms" "91000/u);
  assert.match(stop.command, /--model" "gpt-test/u);
  assert.match(stop.commandWindows, /powershell\.exe -NoProfile -NonInteractive -EncodedCommand/u);
});
