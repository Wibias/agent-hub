import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCodexMemoryHookAdapter,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function fakeGit(branch = 'main') {
  return {
    async resolveContext() {
      return {
        repoPath: '/repo',
        branch,
        revisionSha: 'a'.repeat(40),
      };
    },
    async refreshFreshness() {},
  };
}

function pipelineMemory({
  importance = 0,
  relation = 0,
  promotion = 0,
  needsConfirmation = 0,
} = {}) {
  const calls = [];
  const memory = {
    calls,
    listUnevaluatedCandidates(args) {
      calls.push(['importance', args]);
      return Array.from({ length: importance }, (_, index) => ({
        id: 'importance-' + index,
      }));
    },
    listRelationPendingCandidates(args) {
      calls.push(['relation', args]);
      return Array.from({ length: relation }, (_, index) => ({
        id: 'relation-' + index,
      }));
    },
    listPromotionReadyCandidates(args) {
      calls.push(['promotion', args]);
      return Array.from({ length: promotion }, (_, index) => ({
        id: 'promotion-' + index,
      }));
    },
    listScopedCandidates(args) {
      calls.push(['scoped', args]);
      return [
        ...Array.from({ length: needsConfirmation }, (_, index) => ({
          id: 'confirm-' + index,
          status: 'needs_confirmation',
        })),
        { id: 'done', status: 'promoted' },
      ];
    },
  };
  return memory;
}

test('memory pipeline parses as a read-only management command', () => {
  assert.deepEqual(
    parseExplicitMemoryPrompt('memory pipeline'),
    { mode: 'pipeline' },
  );
  assert.deepEqual(
    parseExplicitMemoryPrompt('  MEMORY   PIPELINE  '),
    { mode: 'pipeline' },
  );
});

test('memory pipeline reports current-scope stage readiness without protocol or mutation', async () => {
  const memory = pipelineMemory({
    importance: 2,
    relation: 1,
    promotion: 1,
    needsConfirmation: 3,
  });
  let protocolCalls = 0;

  let freshnessCalls = 0;
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        protocolCalls += 1;
        throw new Error('read-only pipeline status must not hit protocol');
      },
    },
    memory,
    projectId: 'github.com/Wibias/agent-hub',
    explicitMemoryRequests: true,
    git: {
      async resolveContext() {
        return {
          repoPath: '/repo',
          branch: 'feat/example',
          revisionSha: 'a'.repeat(40),
        };
      },
      async refreshFreshness() {
        freshnessCalls += 1;
      },
    },
  });

  const result = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    turn_id: 'pipeline',
    cwd: '/repo',
    prompt: 'memory pipeline',
  });

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /Memory candidate pipeline status/);
  assert.match(result.reason, /importance-ready:\s+2/);
  assert.match(result.reason, /relation-ready:\s+1/);
  assert.match(result.reason, /promotion-ready:\s+1/);
  assert.match(result.reason, /needs-confirmation:\s+3/);
  assert.match(
    result.reason,
    /node \.\\scripts\\process-memory-candidates\.mjs --apply/,
  );
  assert.match(result.reason, /read-only/i);
  assert.equal(protocolCalls, 0);
  assert.equal(freshnessCalls, 0);

  assert.deepEqual(
    memory.calls,
    [
      ['importance', {
        projectId: 'github.com/Wibias/agent-hub',
        branch: 'feat/example',
        limit: 20,
      }],
      ['relation', {
        projectId: 'github.com/Wibias/agent-hub',
        branch: 'feat/example',
        limit: 20,
      }],
      ['promotion', {
        projectId: 'github.com/Wibias/agent-hub',
        branch: 'feat/example',
        limit: 20,
      }],
      ['scoped', {
        projectId: 'github.com/Wibias/agent-hub',
        branch: 'feat/example',
      }],
    ],
  );
});

test('memory pipeline reports an empty pipeline without invoking any judge', async () => {
  const memory = pipelineMemory();

  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('read-only pipeline status must not hit protocol');
      },
    },
    memory,
    projectId: 'project',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const result = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    turn_id: 'pipeline-empty',
    cwd: '/repo',
    prompt: 'memory pipeline',
  });

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /importance-ready:\s+0/);
  assert.match(result.reason, /relation-ready:\s+0/);
  assert.match(result.reason, /promotion-ready:\s+0/);
  assert.match(result.reason, /needs-confirmation:\s+0/);
});

test('memory pipeline fails closed when the candidate ledger status surface is unavailable', async () => {
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('read-only pipeline status must not hit protocol');
      },
    },
    memory: {},
    projectId: 'project',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const result = await adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    turn_id: 'pipeline-unavailable',
    cwd: '/repo',
    prompt: 'memory pipeline',
  });

  assert.equal(result.decision, 'block');
  assert.equal(
    result.reason,
    'Memory candidate pipeline status is unavailable for the current configuration.',
  );
});
