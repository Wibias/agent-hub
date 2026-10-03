import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  automaticMemoryCandidatePipelineReady,
  parseCodexHookCliOptions,
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';
import {
  launchMemoryCandidatePipeline,
} from '../../memory-engine/candidate-pipeline-launcher.mjs';
import {
  parseCodexAgentPipelineHookOptions,
  runCodexAgentPipelineHook,
} from '../../scripts/codex-agent-memory-pipeline-hook.mjs';
import {
  acquireMemoryCandidatePipelineLock,
  memoryCandidatePipelineLockPath,
  parseMemoryCandidatePipelineWorkerArgs,
  releaseMemoryCandidatePipelineLock,
  runMemoryCandidatePipelineWorker,
} from '../../scripts/run-memory-candidate-pipeline-worker.mjs';

function event() {
  return {
    session_id: 'session-auto-pipeline',
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    turn_id: 'turn-auto-pipeline',
    prompt: 'We decided to use Postgres for concurrent writers.',
  };
}

function fakeMemory({
  importance = 0,
  relation = 0,
  promotion = 0,
  agentImportance = 0,
  agentRelation = 0,
  agentPromotion = 0,
  order = [],
} = {}) {
  return {
    getProject() {
      return { project_id: 'project-a' };
    },
    listUnevaluatedCandidates() {
      return Array.from({ length: importance }, (_, index) => ({ id: 'i' + index }));
    },
    listRelationPendingCandidates() {
      return Array.from({ length: relation }, (_, index) => ({ id: 'r' + index }));
    },
    listPromotionReadyCandidates() {
      return Array.from({ length: promotion }, (_, index) => ({ id: 'p' + index }));
    },
    listUnevaluatedAgentCandidates() {
      return Array.from(
        { length: agentImportance },
        (_, index) => ({ id: 'ai' + index }),
      );
    },
    listAgentRelationPendingCandidates() {
      return Array.from(
        { length: agentRelation },
        (_, index) => ({ id: 'ar' + index }),
      );
    },
    listAgentPromotionReadyCandidates() {
      return Array.from(
        { length: agentPromotion },
        (_, index) => ({ id: 'ap' + index }),
      );
    },
    close() {
      order.push('close');
    },
  };
}

test('async agent pipeline hook captures idempotently before inline processing', async () => {
  assert.deepEqual(
    parseCodexAgentPipelineHookOptions(['--ignore-memory-env']),
    { ignoreMemoryEnv: true },
  );
  assert.throws(
    () => parseCodexAgentPipelineHookOptions(['--wat']),
    /unknown argument/i,
  );

  const order = [];
  const logs = [];
  const result = await runCodexAgentPipelineHook({
    event: {
      hook_event_name: 'Stop',
      session_id: 'session-agent-async',
      cwd: '/repo/project',
      turn_id: 'turn-agent-async',
      stop_hook_active: false,
      last_assistant_message: 'Decision: keep capture synchronous.',
    },
    env: {
      AGENT_HUB_MEMORY_DB: '/state/memory.sqlite3',
      AGENT_HUB_MEMORY_PROJECT_ID: 'project-a',
    },
    configOptions: {
      ignoreMemoryEnv: false,
    },
    async captureDecision(args) {
      order.push('capture');
      assert.equal(args.configOptions.autoPipeline, false);
      assert.equal(args.configOptions.ignoreMemoryEnv, false);
      return { continue: true };
    },
    resolveProjectScope() {
      order.push('scope');
      return {
        projectId: 'project-a',
        repoIdentity: 'project-a',
        canonicalRemote: null,
      };
    },
    resolveGit() {
      order.push('git');
      return {
        repoPath: '/repo/project',
        branch: 'feature/async-agent-pipeline',
        revisionSha: '9'.repeat(40),
      };
    },
    createLog() {
      return (value) => logs.push(String(value));
    },
    async runWorker(args) {
      order.push('worker');
      assert.deepEqual(
        {
          cwd: args.cwd,
          dbPath: args.dbPath,
          projectId: args.projectId,
          branch: args.branch,
          revisionSha: args.revisionSha,
          trigger: args.trigger,
        },
        {
          cwd: '/repo/project',
          dbPath: '/state/memory.sqlite3',
          projectId: 'project-a',
          branch: 'feature/async-agent-pipeline',
          revisionSha: '9'.repeat(40),
          trigger: 'Stop',
        },
      );
      args.log('pipeline-stage-output');
      return {
        type: 'agent_hub_memory_candidate_pipeline_worker',
        status: 'drained',
      };
    },
  });

  assert.deepEqual(order, ['capture', 'scope', 'git', 'worker']);
  assert.equal(result.status, 'completed');
  assert.deepEqual(logs, [
    'pipeline-stage-output',
    JSON.stringify({
      type: 'agent_hub_memory_candidate_pipeline_worker',
      status: 'drained',
    }),
  ]);
});

test('auto-pipeline remains an explicit Codex CLI opt-in', () => {
  assert.deepEqual(
    parseCodexHookCliOptions([
      '--ignore-memory-env',
      '--candidate-capture',
      '--auto-pipeline',
    ]),
    {
      ignoreMemoryEnv: true,
      explicitMemoryRequests: false,
      hybridRecall: false,
      candidateCapture: true,
      autoPipeline: true,
    },
  );

  assert.equal(parseCodexHookCliOptions([]).autoPipeline, undefined);
});

test('automatic pipeline readiness ignores review-only backlog states', () => {
  assert.equal(automaticMemoryCandidatePipelineReady(fakeMemory(), {
    projectId: 'project-a',
    branch: 'main',
  }), false);

  assert.equal(automaticMemoryCandidatePipelineReady(fakeMemory({
    importance: 1,
  }), {
    projectId: 'project-a',
    branch: 'main',
  }), true);

  assert.equal(automaticMemoryCandidatePipelineReady(fakeMemory({
    relation: 1,
  }), {
    projectId: 'project-a',
    branch: 'main',
  }), true);

  assert.equal(automaticMemoryCandidatePipelineReady(fakeMemory({
    promotion: 1,
  }), {
    projectId: 'project-a',
    branch: 'main',
  }), true);

  assert.equal(automaticMemoryCandidatePipelineReady(fakeMemory({
    agentImportance: 1,
  }), {
    projectId: 'project-a',
    branch: 'main',
  }), true);

  assert.equal(automaticMemoryCandidatePipelineReady(fakeMemory({
    agentRelation: 1,
  }), {
    projectId: 'project-a',
    branch: 'main',
  }), true);

  assert.equal(automaticMemoryCandidatePipelineReady(fakeMemory({
    agentPromotion: 1,
  }), {
    projectId: 'project-a',
    branch: 'main',
  }), true);
});

test('Codex auto-pipeline launch happens only after memory closes and uses frozen Git scope', async () => {
  const order = [];
  const memory = fakeMemory({ importance: 1, order });
  let launchArgs = null;

  const output = await runCodexMemoryHook({
    event: event(),
    env: {
      AGENT_HUB_MEMORY_DB: '/shared/memory.sqlite3',
      AGENT_HUB_MEMORY_PROJECT_ID: 'project-a',
    },
    configOptions: {
      candidateCapture: true,
      autoPipeline: true,
    },
    createEngine() {
      return memory;
    },
    createProtocol() {
      return { handle() {} };
    },
    createAdapter() {
      return {
        async handle() {
          order.push('handle');
          return { hookSpecificOutput: { additionalContext: 'ok' } };
        },
      };
    },
    resolvePipelineGitContext() {
      return {
        repoPath: '/repo/project',
        branch: 'feature/frozen',
        revisionSha: 'b'.repeat(40),
      };
    },
    launchCandidatePipeline(args) {
      order.push('launch');
      launchArgs = args;
    },
    restoreLockExists() {
      return false;
    },
  });

  assert.deepEqual(output, {
    hookSpecificOutput: { additionalContext: 'ok' },
  });
  assert.deepEqual(order, ['handle', 'close', 'launch']);
  assert.deepEqual(launchArgs, {
    cwd: '/repo/project',
    dbPath: '/shared/memory.sqlite3',
    projectId: 'project-a',
    branch: 'feature/frozen',
    revisionSha: 'b'.repeat(40),
  });
});

test('Codex auto-pipeline does not spawn when automatic queues are empty', async () => {
  const memory = fakeMemory();
  let launches = 0;

  await runCodexMemoryHook({
    event: event(),
    env: {
      AGENT_HUB_MEMORY_DB: '/shared/memory.sqlite3',
      AGENT_HUB_MEMORY_PROJECT_ID: 'project-a',
    },
    configOptions: {
      autoPipeline: true,
    },
    createEngine() {
      return memory;
    },
    createProtocol() {
      return { handle() {} };
    },
    createAdapter() {
      return { async handle() { return null; } };
    },
    resolvePipelineGitContext() {
      return {
        repoPath: '/repo/project',
        branch: 'main',
        revisionSha: 'c'.repeat(40),
      };
    },
    launchCandidatePipeline() {
      launches += 1;
    },
    restoreLockExists() {
      return false;
    },
  });

  assert.equal(launches, 0);
});

test('detached launcher passes frozen scope and hides worker IO from the hook', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-auto-pipeline-launch-'));
  const calls = [];
  try {
    const result = launchMemoryCandidatePipeline({
      cwd: root,
      dbPath: join(root, 'memory.sqlite3'),
      projectId: 'github.com/example/project',
      branch: 'feature/frozen',
      revisionSha: 'd'.repeat(40),
      spawnProcess(executable, args, options) {
        calls.push({ executable, args, options });
        return {
          pid: 4242,
          on() {},
          unref() {
            calls.push({ unref: true });
          },
        };
      },
    });

    assert.equal(result.status, 'launched');
    assert.equal(result.pid, 4242);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].options.stdio[0], 'ignore');
    assert.ok(calls[0].args.includes('--project-id'));
    assert.ok(calls[0].args.includes('github.com/example/project'));
    assert.ok(calls[0].args.includes('--branch'));
    assert.ok(calls[0].args.includes('feature/frozen'));
    assert.ok(calls[0].args.includes('--revision-sha'));
    assert.ok(calls[0].args.includes('d'.repeat(40)));
    assert.ok(calls[0].args.includes('--trigger'));
    assert.ok(calls[0].args.includes('UserPromptSubmit'));
    assert.deepEqual(calls[1], { unref: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worker parser requires the frozen runtime scope', () => {
  const parsed = parseMemoryCandidatePipelineWorkerArgs([
    '--cwd', '/repo',
    '--db-path', '/state/memory.sqlite3',
    '--project-id', 'project-a',
    '--branch', 'main',
    '--revision-sha', 'e'.repeat(40),
    '--limit', '7',
    '--max-rounds', '3',
  ]);

  assert.equal(parsed.projectId, 'project-a');
  assert.equal(parsed.branch, 'main');
  assert.equal(parsed.revisionSha, 'e'.repeat(40));
  assert.equal(parsed.trigger, 'manual');
  assert.equal(parsed.limit, 7);
  assert.equal(parsed.maxRounds, 3);
});

test('candidate pipeline lock serializes one project and branch scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-auto-pipeline-lock-'));
  const runtime = {
    dbPath: join(root, 'memory.sqlite3'),
    projectId: 'github.com/example/project',
    branch: 'main',
  };
  const lockPath = memoryCandidatePipelineLockPath(runtime);

  let first = null;
  let third = null;
  try {
    first = await acquireMemoryCandidatePipelineLock(lockPath);
    assert.ok(first);

    const second = await acquireMemoryCandidatePipelineLock(lockPath);
    assert.equal(second, null);

    await releaseMemoryCandidatePipelineLock(first);
    first = null;

    third = await acquireMemoryCandidatePipelineLock(lockPath);
    assert.ok(third);
  } finally {
    if (first) await releaseMemoryCandidatePipelineLock(first);
    if (third) await releaseMemoryCandidatePipelineLock(third);
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate pipeline lock immediately recovers a dead recorded owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-auto-pipeline-dead-lock-'));
  const runtime = {
    dbPath: join(root, 'memory.sqlite3'),
    projectId: 'github.com/example/project',
    branch: 'feature/dead-owner',
  };
  const lockPath = memoryCandidatePipelineLockPath(runtime);
  let recovered = null;

  try {
    await writeFile(lockPath, JSON.stringify({
      pid: 424242,
      createdAt: new Date().toISOString(),
    }));

    recovered = await acquireMemoryCandidatePipelineLock(lockPath, {
      staleAfterMs: 60 * 60 * 1000,
      isProcessAlive(pid) {
        assert.equal(pid, 424242);
        return false;
      },
    });

    assert.ok(recovered);
  } finally {
    if (recovered) await releaseMemoryCandidatePipelineLock(recovered);
    await rm(root, { recursive: true, force: true });
  }
});

test('worker exits when another process already owns the scope lock', async () => {
  let pipelineCalls = 0;
  const result = await runMemoryCandidatePipelineWorker({
    cwd: '/repo',
    dbPath: '/state/memory.sqlite3',
    projectId: 'project-a',
    branch: 'main',
    revisionSha: 'f'.repeat(40),
    acquireLock: async () => null,
    releaseLock: async () => {},
    runPipeline: async () => {
      pipelineCalls += 1;
      throw new Error('must not run');
    },
  });

  assert.equal(result.status, 'already_running');
  assert.equal(result.rounds, 0);
  assert.equal(pipelineCalls, 0);
});

test('worker drains bounded automatic queues with one frozen runtime', async () => {
  const calls = [];
  const lock = { file: {}, path: '/tmp/lock' };
  const result = await runMemoryCandidatePipelineWorker({
    cwd: '/repo',
    dbPath: '/state/memory.sqlite3',
    projectId: 'project-a',
    branch: 'feature/frozen',
    revisionSha: '1'.repeat(40),
    maxRounds: 3,
    acquireLock: async () => lock,
    releaseLock: async (value) => {
      assert.equal(value, lock);
      calls.push('release');
    },
    restoreLocked: () => false,
    runPipeline: async (args) => {
      calls.push(args.dependencies.resolveRuntime());
      return {
        initial: {
          importance_ready: 1,
          relation_ready: 0,
          promotion_ready: 0,
        },
        final: {
          importance_ready: 0,
          relation_ready: 0,
          promotion_ready: 0,
          needs_confirmation: 1,
          kept_for_review: 2,
        },
      };
    },
    log() {},
  });

  assert.equal(result.status, 'drained');
  assert.equal(result.rounds, 1);
  assert.deepEqual(calls[0], {
    cwd: '/repo',
    dbPath: '/state/memory.sqlite3',
    projectId: 'project-a',
    branch: 'feature/frozen',
    revisionSha: '1'.repeat(40),
  });
  assert.equal(calls[1], 'release');
});

test('worker stops instead of repeatedly retrying a stalled automatic queue', async () => {
  let calls = 0;
  const result = await runMemoryCandidatePipelineWorker({
    cwd: '/repo',
    dbPath: '/state/memory.sqlite3',
    projectId: 'project-a',
    branch: 'main',
    maxRounds: 5,
    acquireLock: async () => ({ file: {}, path: '/tmp/lock' }),
    releaseLock: async () => {},
    restoreLocked: () => false,
    runPipeline: async () => {
      calls += 1;
      return {
        initial: {
          importance_ready: 1,
          relation_ready: 0,
          promotion_ready: 0,
        },
        final: {
          importance_ready: 1,
          relation_ready: 0,
          promotion_ready: 0,
        },
      };
    },
    log() {},
  });

  assert.equal(result.status, 'stalled');
  assert.equal(result.rounds, 1);
  assert.equal(calls, 1);
});


test('worker synchronizes semantic derived state once after real promotion', async () => {
  let syncCalls = 0;
  const result = await runMemoryCandidatePipelineWorker({
    cwd: '/repo',
    dbPath: '/state/memory.sqlite3',
    projectId: 'project-a',
    branch: 'main',
    maxRounds: 2,
    acquireLock: async () => ({ file: {}, path: '/tmp/lock' }),
    releaseLock: async () => {},
    restoreLocked: () => false,
    runPipeline: async () => ({
      initial: {
        importance_ready: 0,
        relation_ready: 0,
        promotion_ready: 1,
        agent_importance_ready: 0,
        agent_relation_ready: 0,
        agent_promotion_ready: 0,
      },
      stages: [
        {
          name: 'promotion',
          skipped: false,
          result: {
            summary: {
              total: 1,
              promoted: 1,
              superseded: 0,
              needs_confirmation: 0,
              failed: 0,
            },
          },
        },
        {
          name: 'agent_promotion',
          skipped: true,
          result: null,
        },
      ],
      final: {
        importance_ready: 0,
        relation_ready: 0,
        promotion_ready: 0,
        agent_importance_ready: 0,
        agent_relation_ready: 0,
        agent_promotion_ready: 0,
      },
    }),
    async syncSemantic(args) {
      syncCalls += 1;
      assert.equal(args.dbPath, '/state/memory.sqlite3');
      assert.equal(args.projectId, 'project-a');
      assert.equal(args.branch, 'main');
      return { indexed: 4, failed: 0 };
    },
    log() {},
  });

  assert.equal(syncCalls, 1);
  assert.equal(result.promotedClaims, 1);
  assert.deepEqual(result.semanticSync, {
    status: 'ok',
    indexed: 4,
    failed: 0,
  });
});

test('worker skips semantic sync when no new claim is promoted', async () => {
  let syncCalls = 0;
  const result = await runMemoryCandidatePipelineWorker({
    cwd: '/repo',
    dbPath: '/state/memory.sqlite3',
    projectId: 'project-a',
    branch: 'main',
    acquireLock: async () => ({ file: {}, path: '/tmp/lock' }),
    releaseLock: async () => {},
    restoreLocked: () => false,
    runPipeline: async () => ({
      initial: {
        importance_ready: 0,
        relation_ready: 0,
        promotion_ready: 1,
      },
      stages: [{
        name: 'promotion',
        skipped: false,
        result: {
          summary: {
            total: 1,
            promoted: 0,
            superseded: 1,
            needs_confirmation: 0,
            failed: 0,
          },
        },
      }],
      final: {
        importance_ready: 0,
        relation_ready: 0,
        promotion_ready: 0,
      },
    }),
    async syncSemantic() {
      syncCalls += 1;
      return { indexed: 1, failed: 0 };
    },
    log() {},
  });

  assert.equal(syncCalls, 0);
  assert.equal(result.promotedClaims, 0);
  assert.equal(result.semanticSync.status, 'not_needed');
});


test('worker persists structured run history and clears its lock after success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-auto-pipeline-history-'));
  const dbPath = join(root, 'memory.sqlite3');
  const projectId = 'github.com/example/history';
  const seed = new MemoryEngine({ dbPath });
  seed.registerProject({
    projectId,
    repoIdentity: projectId,
  });
  seed.close();

  const logs = [];
  let tick = 0;
  try {
    const result = await runMemoryCandidatePipelineWorker({
      cwd: root,
      dbPath,
      projectId,
      branch: 'main',
      revisionSha: '7'.repeat(40),
      trigger: 'SubagentStop',
      createRunId: () => 'pipeline-run:deterministic',
      now() {
        tick += 1;
        return 1_800_000_000_000 + tick * 100;
      },
      runPipeline: async (args) => {
        args.log(JSON.stringify({
          type: 'fixture_pipeline_stage',
        }));
        return {
          initial: {
            importance_ready: 0,
            relation_ready: 0,
            promotion_ready: 0,
            agent_importance_ready: 1,
            agent_relation_ready: 0,
            agent_promotion_ready: 0,
          },
          stages: [{
            name: 'agent_importance',
            skipped: false,
            result: {
              summary: {
                total: 1,
                evaluated: 1,
                applied: 1,
                failed: 0,
                results: [{
                  candidate_ref: '~1234567890',
                  ok: true,
                }],
              },
            },
          }],
          final: {
            importance_ready: 0,
            relation_ready: 0,
            promotion_ready: 0,
            agent_importance_ready: 0,
            agent_relation_ready: 0,
            agent_promotion_ready: 0,
          },
        };
      },
      log(value) {
        logs.push(String(value));
      },
    });

    assert.equal(result.status, 'drained');
    assert.equal(result.observabilityStatus, 'drained');
    assert.equal(result.runId, 'pipeline-run:deterministic');
    assert.equal(result.trigger, 'SubagentStop');

    const parsedLogs = logs.map((line) => JSON.parse(line));
    assert.equal(
      parsedLogs.every(
        (entry) => entry.run_id === 'pipeline-run:deterministic',
      ),
      true,
    );
    assert.equal(
      parsedLogs.some(
        (entry) => entry.type === 'agent_hub_memory_candidate_pipeline_run',
      ),
      true,
    );

    const verify = new MemoryEngine({ dbPath });
    try {
      const runs = verify.listPipelineRuns({
        projectId,
        branch: 'main',
      });
      assert.equal(runs.length, 1);
      assert.equal(runs[0].trigger, 'SubagentStop');
      assert.equal(runs[0].status, 'drained');
      assert.deepEqual(runs[0].candidate_refs, ['~1234567890']);
      assert.equal(runs[0].stage_counts.agent_importance.total, 1);
    } finally {
      verify.close();
    }

    const lockPath = memoryCandidatePipelineLockPath({
      dbPath,
      projectId,
      branch: 'main',
    });
    await assert.rejects(
      async () => {
        const content = await import('node:fs/promises')
          .then(({ readFile }) => readFile(lockPath, 'utf8'));
        return content;
      },
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
