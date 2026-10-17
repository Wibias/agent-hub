import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import {
  planCodexMemoryHooks,
} from '../../scripts/install-codex-memory-hooks.mjs';

function managedPromptHook(config) {
  return (config.hooks.UserPromptSubmit ?? [])
    .flatMap((entry) => Array.isArray(entry?.hooks) ? entry.hooks : [])
    .find((hook) => /codex-hook-cli\.mjs/.test(
      String(hook?.command ?? ''),
    ));
}

function decodeWindows(hook) {
  const command = String(hook?.commandWindows ?? '');
  const match = /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(
    command,
  );
  assert.ok(match, 'expected encoded PowerShell hook command');
  return Buffer.from(match[1], 'base64').toString('utf16le');
}

function assertRolloutArgs(text, { windows = false } = {}) {
  const relevance = windows
    ? /'--recall-relevance'/
    : /(?:^|\s)--recall-relevance(?:\s|$)/;
  const replay = windows
    ? /'--recall-fast-path-shadow-replay'/
    : /(?:^|\s)--recall-fast-path-shadow-replay(?:\s|$)/;
  const authoritative = windows
    ? /'--recall-fast-path'/
    : /(?:^|\s)--recall-fast-path(?:\s|$)/;
  const synchronous = windows
    ? /'--recall-fast-path-shadow'/
    : /(?:^|\s)--recall-fast-path-shadow(?:\s|$)/;

  assert.match(text, relevance);
  assert.match(text, replay);
  assert.doesNotMatch(text, authoritative);
  assert.doesNotMatch(text, synchronous);
}

test('managed UserPromptSubmit is prepared for non-blocking replay Shadow rollout only', () => {
  const plan = planCodexMemoryHooks({
    existing: { hooks: {} },
    hubRoot: '/opt/agent-hub',
    nodePath: '/usr/bin/node',
  });

  const prompt = managedPromptHook(plan.config);
  assert.ok(prompt);

  assertRolloutArgs(prompt.command);
  assertRolloutArgs(decodeWindows(prompt), { windows: true });

  assert.equal(prompt.timeout, 10);
  assert.equal(prompt.additionalContextLimit, 2500);
  assert.match(prompt.command, /--hybrid-recall/);
  assert.match(prompt.command, /--candidate-capture/);
  assert.match(prompt.command, /--auto-pipeline/);
});
