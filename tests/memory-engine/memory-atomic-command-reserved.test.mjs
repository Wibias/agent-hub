import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCodexMemoryHookAdapter,
  explicitMemoryCommandFailure,
  isExplicitMemoryCommandAttempt,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import { atomicRuleConfirmationText } from '../../memory-engine/memory-atomic-confirmed-staging.mjs';

const prompt = atomicRuleConfirmationText({
  projectId: 'github.com/example/streaming-app',
  branch: 'main',
  draftRef: '~d1234567890abcdef',
  ruleText: 'In future project reviews, verify source evidence and realistic fixture data before calling a bug confirmed.',
});
function event(text) {
  return {
    hook_event_name: 'UserPromptSubmit',
    cwd: '/irrelevant',
    session_id: 'test',
    turn_id: 'test',
    prompt: text,
  };
}

test('the inactive mixed-intent confirmation syntax is reserved and never falls through', async () => {
  assert.equal(isExplicitMemoryCommandAttempt(prompt), true);
  assert.equal(isExplicitMemoryCommandAttempt('MEMORY CONFIRM PERMANENT PROJECT RULE invalid'), true);
  assert.equal(isExplicitMemoryCommandAttempt('Document a project memory confirmation'), false);
  const response = explicitMemoryCommandFailure(event(prompt), { enabled: false });
  assert.equal(response.decision, 'block');
  assert.match(response.reason, /not enabled/);
  const malformed = explicitMemoryCommandFailure(
    event('memory confirm permanent project rule invalid'), { enabled: false },
  );
  assert.equal(malformed.decision, 'block');
  const adapter = createCodexMemoryHookAdapter({
    protocol: { async handle() { throw new Error('never called'); } },
    memory: {},
    projectId: 'github.com/example/streaming-app',
    explicitMemoryRequests: false,
    candidateCapture: true,
    git: {
      async resolveContext() { throw new Error('must not resolve Git for disabled command'); },
      async refreshFreshness() { return 0; },
    },
  });
  assert.deepEqual(await adapter.handle(event(prompt)), response);
  assert.equal(explicitMemoryCommandFailure(event('Please explain SQLite WAL'), { enabled: false }), null);
});
