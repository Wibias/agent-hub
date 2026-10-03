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
  agentImportance = 0,
  agentRelation = 0,
  agentPromotion = 0,
  needsConfirmation = 0,
  keptForReview = 0,
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
    listUnevaluatedAgentCandidates(args) {
      calls.push(['agent-importance', args]);
      return Array.from({ length: agentImportance }, (_, index) => ({
        id: 'agent-importance-' + index,
      }));
    },
    listAgentRelationPendingCandidates(args) {
      calls.push(['agent-relation', args]);
      return Array.from({ length: agentRelation }, (_, index) => ({
        id: 'agent-relation-' + index,
      }));
    },
    listAgentPromotionReadyCandidates(args) {
      calls.push(['agent-promotion', args]);
      return Array.from({ length: agentPromotion }, (_, index) => ({
        id: 'agent-promotion-' + index,
      }));
    },
    listScopedCandidates(args) {
      calls.push(['scoped', args]);
      return [
        ...Array.from({ length: needsConfirmation }, (_, index) => ({
          id: 'confirm-' + index,
          status: 'needs_confirmation',
        })),
        ...Array.from({ length: keptForReview }, (_, index) => ({
          id: 'kept-' + index,
          status: 'pending',
          evaluated_at: '2026-10-01T00:00:00.000Z',
          evaluation_json: JSON.stringify({
            decision: 'keep_candidate',
            suggested_type: 'decision',
            durability: 'medium',
            future_utility: 'medium',
            specificity: 'high',
            confidence: 'high',
            meaning_preserved: true,
            canonical_fact: 'Review backlog candidate.',
            reason: 'Useful but not durable enough for automatic promotion.',
            risk_flags: ['transient'],
          }),
          relation: null,
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
    agentImportance: 2,
    agentRelation: 1,
    agentPromotion: 1,
    needsConfirmation: 3,
    keptForReview: 2,
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
  assert.match(result.reason, /agent-importance-ready:\s+2/);
  assert.match(result.reason, /agent-relation-ready:\s+1/);
  assert.match(result.reason, /agent-promotion-ready:\s+1/);
  assert.match(result.reason, /needs-confirmation:\s+3/);
  assert.match(result.reason, /kept-for-review:\s+2/);
  assert.match(
    result.reason,
    /node \.\\scripts\\process-memory-candidates\.mjs --apply/,
  );
  assert.match(result.reason, /read-only/i);
  assert.match(result.reason, /Automatic processing runs outside this command/i);
  assert.match(result.reason, /Manual fallback/i);
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
      ['agent-importance', {
        projectId: 'github.com/Wibias/agent-hub',
        branch: 'feat/example',
        limit: 20,
      }],
      ['agent-relation', {
        projectId: 'github.com/Wibias/agent-hub',
        branch: 'feat/example',
        limit: 20,
      }],
      ['agent-promotion', {
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
  assert.match(result.reason, /agent-importance-ready:\s+0/);
  assert.match(result.reason, /agent-relation-ready:\s+0/);
  assert.match(result.reason, /agent-promotion-ready:\s+0/);
  assert.match(result.reason, /needs-confirmation:\s+0/);
  assert.match(result.reason, /kept-for-review:\s+0/);
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


test('memory pipeline consumes the command when a status query fails', async () => {
  let freshnessCalls = 0;
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('read-only pipeline status must not hit protocol');
      },
    },
    memory: {
      listUnevaluatedCandidates() {
        throw new Error('candidate ledger unavailable');
      },
      listRelationPendingCandidates() {
        return [];
      },
      listPromotionReadyCandidates() {
        return [];
      },
      listScopedCandidates() {
        return [];
      },
    },
    projectId: 'project',
    explicitMemoryRequests: true,
    git: {
      async resolveContext() {
        return {
          repoPath: '/repo',
          branch: 'main',
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
    turn_id: 'pipeline-error',
    cwd: '/repo',
    prompt: 'memory pipeline',
  });

  assert.deepEqual(result, {
    decision: 'block',
    reason:
      'Memory candidate pipeline status is unavailable for the current configuration.',
  });
  assert.equal(freshnessCalls, 0);
});
