import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createCodexMemoryHookAdapter,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { createMemoryProtocol } from '../../memory-engine/protocol.mjs';
import {
  recallQueryHash,
  recallTelemetryRunId,
} from '../../memory-engine/recall-observability.mjs';

function ingestAgentDecision(memory, {
  claimId = 'claim-agent',
  evidenceId = 'e-agent',
  createdAt = '2026-01-01T00:00:00.000Z',
  value = 'Agent decision: keep async memory processing.',
} = {}) {
  memory.ingest({
    evidence: {
      id: evidenceId,
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'session-agent',
      sourceKind: 'subagent',
      sourceRef: 'codex:subagent:agent-1',
      capturedAt: createdAt,
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: value,
      authorityClass: 'agent_inference',
      metadata: {
        event_type: 'subagent_stop',
        agent_id: 'agent-1',
        agent_type: 'explorer',
        turn_id: 'turn-subagent',
      },
    },
    claim: {
      id: claimId,
      kind: 'agent_inference',
      subject: 'agent decision',
      predicate: 'states',
      value,
      state: 'active',
      branchScope: 'main',
      createdAt,
    },
  });
}

function fakeGit() {
  return {
    async resolveContext() {
      return {
        repoPath: '/repo/project',
        branch: 'main',
        revisionSha: 'a'.repeat(40),
      };
    },
    async refreshFreshness() {},
  };
}

test('recall telemetry tracks retrieval separately from actual context use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-recall-telemetry-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  try {
    memory.registerProject({
      projectId: 'project-a',
      repoIdentity: 'project-a',
    });
    ingestAgentDecision(memory);

    memory.recordRecallTelemetry({
      id: 'recall-run:old-retrieval-only',
      projectId: 'project-a',
      branch: 'main',
      queryHash: '1'.repeat(64),
      observedAt: '2026-09-20T00:00:00.000Z',
      retrievalMode: 'hybrid',
      contextBytes: 0,
      items: [{
        claimId: 'claim-agent',
        authorityClass: 'agent_inference',
        finalRank: 1,
        lexicalRank: 1,
        semanticRank: 1,
        semanticSimilarity: 0.99,
        rrfScore: 0.03,
        budgetRetained: true,
        answerSelected: false,
        advisoryIncluded: false,
        blockedReason: 'not_selected_for_context',
      }],
    });

    let stale = memory.listStaleAgentMemories({
      projectId: 'project-a',
      branch: 'main',
      now: '2026-10-03T00:00:00.000Z',
      unusedDays: 90,
    });
    assert.equal(stale.length, 1);
    assert.equal(stale[0].reason, 'never_in_context');
    assert.equal(stale[0].retrieval_count, 1);
    assert.equal(stale[0].context_count, 0);

    memory.recordRecallTelemetry({
      id: 'recall-run:recent-context',
      projectId: 'project-a',
      branch: 'main',
      queryHash: '2'.repeat(64),
      observedAt: '2026-09-25T00:00:00.000Z',
      retrievalMode: 'hybrid',
      contextBytes: 512,
      items: [{
        claimId: 'claim-agent',
        authorityClass: 'agent_inference',
        finalRank: 1,
        lexicalRank: 1,
        semanticRank: 1,
        semanticSimilarity: 0.99,
        rrfScore: 0.03,
        budgetRetained: true,
        answerSelected: false,
        advisoryIncluded: true,
        blockedReason: null,
      }],
    });

    stale = memory.listStaleAgentMemories({
      projectId: 'project-a',
      branch: 'main',
      now: '2026-10-03T00:00:00.000Z',
      unusedDays: 90,
    });
    assert.deepEqual(stale, []);

    const usage = memory.recallUsageForClaim({
      projectId: 'project-a',
      branch: 'main',
      claimId: 'claim-agent',
    });
    assert.equal(usage.retrieval_count, 2);
    assert.equal(usage.context_count, 1);
    assert.equal(usage.last_context_at, '2026-09-25T00:00:00.000Z');
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('protocol exposes detailed recall telemetry only through side channel', async () => {
  const telemetryCalls = [];
  const item = {
    claim: {
      id: 'claim-a',
      state: 'active',
    },
    evidence: {
      authority_class: 'user_direct',
    },
  };
  const protocol = createMemoryProtocol({
    memory: {},
    hybridRetriever: {
      async recall() {
        throw new Error('detailed recall should be preferred');
      },
      async recallDetailed() {
        return {
          result: {
            items: [item],
            conflicts: [],
          },
          telemetry: {
            retrieval_mode: 'hybrid',
            fallback_reason: null,
            candidates: [{
              claim_id: 'claim-a',
              authority_class: 'user_direct',
              final_rank: 1,
              lexical_rank: 1,
              semantic_rank: 1,
              semantic_similarity: 0.98,
              rrf_score: 0.03,
              budget_retained: true,
            }],
          },
        };
      },
    },
    async onRecallTelemetry(value) {
      telemetryCalls.push(value);
    },
  });

  const response = await protocol.handle({
    protocol: 'memory.protocol.v1',
    operation: 'recall',
    request_id: 'req-recall-side-channel',
    payload: {
      project_id: 'project-a',
      branch: 'main',
      revision_sha: null,
      query: 'database',
      max_items: 10,
      max_serialized_bytes: 16_384,
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.result, {
    items: [item],
    conflicts: [],
  });
  assert.equal(telemetryCalls.length, 1);
  assert.equal(telemetryCalls[0].requestId, 'req-recall-side-channel');
  assert.equal(telemetryCalls[0].telemetry.retrieval_mode, 'hybrid');
});

test('Codex adapter finalizes answer selection and context bytes on existing recall telemetry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-recall-finalize-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  try {
    memory.registerProject({
      projectId: 'project-a',
      repoIdentity: 'project-a',
    });
    memory.ingest({
      evidence: {
        id: 'e-user',
        projectId: 'project-a',
        harness: 'codex',
        sessionId: 'session-a',
        sourceKind: 'session',
        sourceRef: 'session:session-a',
        capturedAt: '2026-09-30T00:00:00.000Z',
        branch: 'main',
        commitSha: null,
        path: null,
        blobOid: null,
        content: 'memory: database is Postgres',
        authorityClass: 'user_direct',
        metadata: { event_type: 'user_prompt' },
      },
      claim: {
        id: 'claim-user',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value: 'memory: database is Postgres',
        state: 'active',
        branchScope: 'main',
        createdAt: '2026-09-30T00:00:00.000Z',
      },
    });

    const requestId = 'codex:session-a:turn-a:recall';
    const telemetryId = recallTelemetryRunId(requestId);
    memory.recordRecallTelemetry({
      id: telemetryId,
      projectId: 'project-a',
      branch: 'main',
      revisionSha: 'a'.repeat(40),
      queryHash: recallQueryHash('Which database do we use?'),
      observedAt: '2026-10-03T00:00:00.000Z',
      retrievalMode: 'hybrid',
      contextBytes: 0,
      items: [{
        claimId: 'claim-user',
        authorityClass: 'user_direct',
        finalRank: 1,
        lexicalRank: 1,
        semanticRank: 1,
        semanticSimilarity: 0.99,
        rrfScore: 0.03,
        budgetRetained: true,
        answerSelected: false,
        advisoryIncluded: false,
        blockedReason: 'awaiting_context_selection',
      }],
    });

    const recalled = memory.materializeRecall({
      projectId: 'project-a',
      branch: 'main',
      mode: 'current',
      claimIds: ['claim-user'],
    });
    const adapter = createCodexMemoryHookAdapter({
      protocol: {
        async handle(request) {
          assert.equal(request.request_id, requestId);
          return {
            ok: true,
            result: recalled,
          };
        },
      },
      memory,
      projectId: 'project-a',
      explicitMemoryRequests: true,
      git: fakeGit(),
    });

    const output = await adapter.handle({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-a',
      turn_id: 'turn-a',
      cwd: '/repo/project',
      prompt: 'Which database do we use?',
    });
    assert.match(output.hookSpecificOutput.additionalContext, /Postgres/);

    const finalized = memory.getRecallTelemetry(telemetryId);
    assert.equal(finalized.selected_count, 1);
    assert.equal(finalized.advisory_count, 0);
    assert.ok(finalized.context_bytes > 0);
    assert.equal(finalized.items[0].answer_selected, true);
    assert.equal(finalized.items[0].blocked_reason, null);
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('stale operator command is read-only and explicit', () => {
  assert.deepEqual(parseExplicitMemoryPrompt('memory stale'), {
    mode: 'stale',
  });
  assert.equal(parseExplicitMemoryPrompt('memory stale now'), null);
});
