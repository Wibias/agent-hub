import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  createCodexMemoryHookAdapter,
  memoryClaimRef,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import {
  pipelineRunRef,
} from '../../memory-engine/pipeline-observability.mjs';

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

function event(prompt) {
  return {
    session_id: 'session-observability',
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    turn_id: 'turn-observability',
    prompt,
  };
}

test('pipeline run history and failures persist outside canonical memory truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-observability-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({
    dbPath,
    clock: () => '2026-10-03T09:00:00.000Z',
  });

  try {
    memory.registerProject({
      projectId: 'project-a',
      repoIdentity: 'project-a',
    });

    memory.startPipelineRun({
      id: 'pipeline-run:test',
      projectId: 'project-a',
      branch: 'main',
      revisionSha: 'b'.repeat(40),
      trigger: 'SubagentStop',
      startedAt: '2026-10-03T08:59:50.000Z',
    });
    memory.recordPipelineFailure({
      runId: 'pipeline-run:test',
      projectId: 'project-a',
      branch: 'main',
      candidateRef: '~0123456789',
      stage: 'agent_importance',
      errorClass: 'JudgeTimeout',
      error: 'candidate judge timed out',
      occurredAt: '2026-10-03T08:59:55.000Z',
    });
    memory.finishPipelineRun({
      id: 'pipeline-run:test',
      status: 'partial',
      finishedAt: '2026-10-03T09:00:00.000Z',
      durationMs: 10_000,
      rounds: 1,
      promotedCount: 0,
      stageCounts: {
        agent_importance: {
          total: 1,
          failed: 1,
        },
      },
      candidateRefs: ['~0123456789'],
    });

    const runs = memory.listPipelineRuns({
      projectId: 'project-a',
      branch: 'main',
    });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].trigger, 'SubagentStop');
    assert.equal(runs[0].status, 'partial');
    assert.equal(runs[0].duration_ms, 10_000);
    assert.deepEqual(runs[0].candidate_refs, ['~0123456789']);
    assert.equal(runs[0].stage_counts.agent_importance.failed, 1);

    const failures = memory.listPipelineFailures({
      projectId: 'project-a',
      branch: 'main',
    });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].candidate_ref, '~0123456789');
    assert.equal(failures[0].stage, 'agent_importance');

    const canonical = memory.exportCanonical();
    assert.equal(Object.hasOwn(canonical, 'memory_pipeline_runs'), false);
    assert.equal(Object.hasOwn(canonical, 'memory_pipeline_failures'), false);

    const health = memory.healthSnapshot({
      projectId: 'project-a',
      branch: 'main',
    });
    assert.equal(health.db_healthy, true);
    assert.equal(health.failed_runs, 1);
    assert.equal(health.recent_runs, 1);
    assert.equal(health.last_pipeline.id, 'pipeline-run:test');
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('claim inspection joins evidence and local observability without mutating memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-inspect-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });

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
        capturedAt: '2026-10-03T09:00:00.000Z',
        branch: 'main',
        commitSha: null,
        path: null,
        blobOid: null,
        content: 'memory: database is Postgres',
        authorityClass: 'user_direct',
        metadata: {
          event_type: 'user_prompt',
          explicit_memory: true,
        },
      },
      claim: {
        id: 'claim-user',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value: 'memory: database is Postgres',
        branchScope: 'main',
        createdAt: '2026-10-03T09:00:00.000Z',
      },
    });

    const inspected = memory.inspectClaimObservability({
      projectId: 'project-a',
      branch: 'main',
      claimId: 'claim-user',
    });

    assert.equal(inspected.claim.id, 'claim-user');
    assert.equal(inspected.evidence.authority_class, 'user_direct');
    assert.equal(inspected.candidate, null);
    assert.equal(inspected.semantic_indexed, false);
    assert.deepEqual(inspected.lifecycle, []);
    assert.deepEqual(inspected.conflicts, []);
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('observability memory commands parse strictly', () => {
  assert.deepEqual(parseExplicitMemoryPrompt('memory health'), {
    mode: 'health',
  });
  assert.deepEqual(parseExplicitMemoryPrompt('memory pipeline failures'), {
    mode: 'pipeline_failures',
  });
  assert.deepEqual(
    parseExplicitMemoryPrompt('memory inspect: @ABCDEF0123'),
    {
      mode: 'inspect',
      ref: '@abcdef0123',
    },
  );

  assert.equal(parseExplicitMemoryPrompt('memory inspect: @short'), null);
  assert.equal(parseExplicitMemoryPrompt('memory health now'), null);
  assert.equal(parseExplicitMemoryPrompt('memory pipeline failures now'), null);
});

test('memory inspect renders authority provenance candidate lifecycle and semantic state', async () => {
  const claimId = 'claim-agent';
  const ref = memoryClaimRef(claimId);
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('inspect must stay read-only');
      },
    },
    memory: {
      exportCanonical() {
        return {
          claims: [{
            id: claimId,
            project_id: 'project-a',
            branch_scope: 'main',
            kind: 'agent_inference',
            state: 'active',
            value_text: 'Agent decision: use async processing.',
          }],
          evidence: [],
        };
      },
      inspectClaimObservability() {
        return {
          claim: {
            id: claimId,
            project_id: 'project-a',
            branch_scope: 'main',
            kind: 'agent_inference',
            state: 'active',
            created_at: '2026-10-03T09:00:00.000Z',
            value_text: 'Agent decision: use async processing.',
            superseded_by_claim_id: null,
          },
          evidence: {
            id: 'e-agent',
            authority_class: 'agent_inference',
            source_kind: 'subagent',
            source_ref: 'codex:subagent:agent-7',
            metadata: {
              event_type: 'subagent_stop',
              agent_id: 'agent-7',
              agent_type: 'explorer',
            },
          },
          candidate: {
            id: 'candidate-agent',
            evaluation_json: JSON.stringify({
              decision: 'promote',
              durability: 'long',
              future_utility: 'high',
              confidence: 'high',
            }),
          },
          relation: {
            relation: 'unrelated',
            related_claim_id: null,
          },
          promotion: {
            finalized_at: '2026-10-03T09:00:10.000Z',
          },
          confirmation: null,
          lifecycle: [],
          conflicts: [],
          semantic_indexed: true,
          embeddings: [{
            model_id: 'fixture-e5',
            model_revision: 'v1',
          }],
        };
      },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const output = await adapter.handle(event('memory inspect: ' + ref));
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /Authority: agent_inference/);
  assert.match(
    output.reason,
    /Origin: session=unknown -> subagent -> type=explorer -> id=agent-7 -> decision/,
  );
  assert.match(output.reason, /Candidate-ID: candidate-agent/);
  assert.match(output.reason, /Importance: promote/);
  assert.match(output.reason, /Relation: unrelated/);
  assert.match(output.reason, /Semantic indexed: yes/);
  assert.match(output.reason, /fixture-e5@v1/);
});

test('memory health and pipeline failures are compact read-only operator surfaces', async () => {
  const runId = 'pipeline-run:fixture';
  const memory = {
    healthSnapshot() {
      return {
        db_healthy: true,
        pending: 0,
        needs_confirmation: 1,
        kept_for_review: 2,
        failed_candidates: 0,
        failed_runs: 1,
        recent_runs: 50,
        semantic_coverage_percent: 100,
        embedded_claims: 8,
        claims: 8,
        last_pipeline: {
          id: runId,
          started_at: '2026-10-03T09:00:00.000Z',
          status: 'drained',
          trigger: 'SubagentStop',
          duration_ms: 41200,
        },
      };
    },
    listPipelineFailures() {
      return [{
        run_id: runId,
        candidate_ref: '~abcdef0123',
        stage: 'semantic_sync',
        error_class: 'WorkerUnavailable',
        error: 'embedding worker unavailable',
        occurred_at: '2026-10-03T09:00:42.000Z',
      }];
    },
  };
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('operator commands must stay read-only');
      },
    },
    memory,
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit(),
    async healthCheck() {
      return {
        e5_worker: 'ready',
        hooks: 'healthy',
      };
    },
  });

  const health = await adapter.handle(event('memory health'));
  assert.equal(health.decision, 'block');
  assert.match(health.reason, /DB: healthy/);
  assert.match(health.reason, /E5 worker: ready/);
  assert.match(health.reason, /Hooks: healthy/);
  assert.match(health.reason, /Review: 3/);
  assert.match(health.reason, /Failed\/partial runs: 1 \/ 50 recent/);
  assert.match(health.reason, /Semantic coverage: 100\.00%/);
  assert.match(health.reason, new RegExp(pipelineRunRef(runId).replace('@', '\\@')));

  const failures = await adapter.handle(event('memory pipeline failures'));
  assert.equal(failures.decision, 'block');
  assert.match(failures.reason, /semantic_sync/);
  assert.match(failures.reason, /~abcdef0123/);
  assert.match(failures.reason, /embedding worker unavailable/);
});
