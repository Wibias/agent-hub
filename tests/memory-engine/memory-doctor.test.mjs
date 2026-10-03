import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../../memory-engine/e5-embedder.mjs';
import {
  evaluateMemoryDoctorStatus,
  inspectCodexIntegration,
  inspectEmbeddingCache,
  inspectEmbeddingWorker,
  inspectMemoryDatabase,
  inspectNativeCodexMemoryIsolation,
  runMemoryDoctor,
} from '../../memory-engine/memory-doctor.mjs';
import {
  runMemoryDoctorCli,
} from '../../scripts/doctor-memory.mjs';

async function createHealthyFixtureDb(root) {
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });

  memory.registerProject({
    projectId: 'github.com/Wibias/agent-hub',
    canonicalRemote: 'github.com/Wibias/agent-hub',
    repoIdentity: 'github.com/Wibias/agent-hub',
    createdAt: '2026-10-01T00:00:00.000Z',
  });

  memory.ingest({
    evidence: {
      id: 'e-doctor',
      projectId: 'github.com/Wibias/agent-hub',
      sourceKind: 'session',
      sourceRef: 'user',
      capturedAt: '2026-10-01T00:00:00.000Z',
      branch: 'main',
      content: 'memory: doctor fixture is healthy',
      authorityClass: 'user_direct',
    },
    claim: {
      id: 'c-doctor',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value: 'doctor fixture is healthy',
      branchScope: 'main',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });

  const document = memory.embeddingDocument({ claimId: 'c-doctor' });
  memory.putClaimEmbedding({
    claimId: 'c-doctor',
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    textHash: document.text_hash,
    dimensions: E5_DIMENSIONS,
    vector: new Float32Array(E5_DIMENSIONS),
  });

  memory.close();
  return dbPath;
}

test('database doctor opens production memory read-only and reports canonical plus derived-state health', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-doctor-db-'));
  const dbPath = await createHealthyFixtureDb(root);
  const before = await stat(dbPath);

  const result = inspectMemoryDatabase({
    dbPath,
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
  });

  const after = await stat(dbPath);

  assert.equal(result.status, 'ok');
  assert.equal(result.readOnly, true);
  assert.equal(result.quickCheck, 'ok');
  assert.equal(result.foreignKeyViolations, 0);
  assert.equal(result.journalMode, 'wal');
  assert.equal(result.candidateLedgerAvailable, true);
  assert.equal(result.pendingCandidates, 0);
  assert.equal(result.projectRegistered, true);
  assert.equal(result.claims, 1);
  assert.equal(result.activeClaims, 1);
  assert.equal(result.ftsRows, 1);
  assert.equal(result.lexicalCoverageComplete, true);
  assert.equal(result.currentEmbeddings, 1);
  assert.equal(result.validCurrentEmbeddings, 1);
  assert.equal(result.semanticCoverageComplete, true);
  assert.equal(result.pipelineHistoryAvailable, true);
  assert.equal(result.recentPipelineRuns, 0);
  assert.equal(result.failedPipelineRuns, 0);
  assert.equal(result.pipelineFailures, 0);
  assert.equal(result.lastPipelineRun, null);
  assert.equal(result.modelId, E5_MODEL_ID);
  assert.equal(result.modelRevision, E5_MODEL_REVISION);
  assert.equal(result.dimensions, E5_DIMENSIONS);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('database doctor summarizes recent pipeline run history without mutating it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-doctor-runs-'));
  const dbPath = await createHealthyFixtureDb(root);

  const memory = new MemoryEngine({ dbPath });
  try {
    memory.startPipelineRun({
      id: 'pipeline-run:doctor',
      projectId: 'github.com/Wibias/agent-hub',
      branch: 'main',
      revisionSha: 'd'.repeat(40),
      trigger: 'Stop',
      startedAt: '2026-10-03T09:00:00.000Z',
    });
    memory.recordPipelineFailure({
      runId: 'pipeline-run:doctor',
      projectId: 'github.com/Wibias/agent-hub',
      branch: 'main',
      stage: 'semantic_sync',
      errorClass: 'WorkerUnavailable',
      error: 'embedding worker unavailable',
      occurredAt: '2026-10-03T09:00:02.000Z',
    });
    memory.finishPipelineRun({
      id: 'pipeline-run:doctor',
      status: 'partial',
      finishedAt: '2026-10-03T09:00:03.000Z',
      durationMs: 3000,
      rounds: 1,
      promotedCount: 1,
      stageCounts: { agent_promotion: { promoted: 1 } },
      candidateRefs: ['~abcdef0123'],
    });
  } finally {
    memory.close();
  }

  const result = inspectMemoryDatabase({
    dbPath,
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
  });

  assert.equal(result.pipelineHistoryAvailable, true);
  assert.equal(result.recentPipelineRuns, 1);
  assert.equal(result.failedPipelineRuns, 1);
  assert.equal(result.pipelineFailures, 1);
  assert.equal(result.lastPipelineRun.id, 'pipeline-run:doctor');
  assert.equal(result.lastPipelineRun.status, 'partial');

  await rm(root, { recursive: true, force: true });
});

test('database doctor treats a pre-candidate-ledger database as degraded but structurally valid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-doctor-legacy-db-'));
  const dbPath = await createHealthyFixtureDb(root);

  const db = new DatabaseSync(dbPath);
  db.exec('DROP TABLE memory_candidates;');
  db.close();

  const result = inspectMemoryDatabase({
    dbPath,
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
  });

  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.missingTables, []);
  assert.equal(result.candidateLedgerAvailable, false);
  assert.equal(result.pendingCandidates, null);
  assert.equal(result.quickCheck, 'ok');
  assert.equal(result.foreignKeyViolations, 0);
});

test('database doctor fails closed for a missing or corrupt canonical database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-doctor-bad-db-'));
  const missing = inspectMemoryDatabase({
    dbPath: join(root, 'missing.sqlite3'),
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
  });

  assert.equal(missing.status, 'broken');
  assert.equal(missing.exists, false);

  const corruptPath = join(root, 'corrupt.sqlite3');
  await writeFile(corruptPath, 'not sqlite');

  const corrupt = inspectMemoryDatabase({
    dbPath: corruptPath,
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
  });

  assert.equal(corrupt.status, 'broken');
  assert.equal(corrupt.exists, true);
  assert.match(corrupt.error, /sqlite|database/i);
});

test('embedding cache doctor is metadata-only and does not manufacture a missing cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-doctor-cache-'));
  const missingPath = join(root, 'missing');

  const missing = await inspectEmbeddingCache({
    cacheDir: missingPath,
  });

  assert.deepEqual(missing, {
    status: 'degraded',
    exists: false,
    nonEmpty: false,
    cacheDir: missingPath,
    remoteModelsAllowed: false,
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
  });

  await mkdir(join(root, 'cache', 'nested'), { recursive: true });
  await writeFile(join(root, 'cache', 'nested', 'model.bin'), 'fixture');

  const present = await inspectEmbeddingCache({
    cacheDir: join(root, 'cache'),
  });

  assert.equal(present.status, 'ok');
  assert.equal(present.exists, true);
  assert.equal(present.nonEmpty, true);
});


test('embedding worker doctor validates health plus a real query-vector canary contract', async () => {
  let received = null;
  const result = await inspectEmbeddingWorker({
    socketPath: 'fixture-pipe',
    createClient(options) {
      received = options;
      return {
        async health() {
          return { ready: true };
        },
        async embedQuery(text) {
          assert.equal(text, 'memory doctor health probe');
          return new Float32Array(E5_DIMENSIONS);
        },
      };
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.ready, true);
  assert.equal(result.queryCanary, true);
  assert.equal(received.modelId, E5_MODEL_ID);
  assert.equal(received.modelRevision, E5_MODEL_REVISION);
  assert.equal(received.dimensions, E5_DIMENSIONS);

  const degraded = await inspectEmbeddingWorker({
    socketPath: 'fixture-pipe',
    createClient() {
      return {
        async health() {
          throw new Error('worker unavailable');
        },
      };
    },
  });

  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.ready, false);
  assert.equal(degraded.queryCanary, false);
  assert.match(degraded.error, /worker unavailable/);
});

test('Codex integration doctor separates critical recall-hook failure from optional SessionStart degradation', async () => {
  const healthyHook = {
    configured: true,
    userPromptSubmit: true,
    sessionStartLauncher: true,
    stopAgentDecisionCapture: true,
    subagentStopAgentDecisionCapture: true,
    flags: {
      ignoreMemoryEnv: true,
      explicitMemoryRequests: true,
      hybridRecall: true,
      candidateCapture: true,
      autoPipeline: true,
      agentDecisionCapture: true,
    },
  };

  const healthy = await inspectCodexIntegration({
    codexHome: 'fixture',
    auditState: async () => ({
      agentHubHook: healthyHook,
      hookReadError: null,
    }),
  });
  assert.equal(healthy.status, 'ok');

  const noLauncher = await inspectCodexIntegration({
    codexHome: 'fixture',
    auditState: async () => ({
      agentHubHook: {
        ...healthyHook,
        sessionStartLauncher: false,
      },
      hookReadError: null,
    }),
  });
  assert.equal(noLauncher.status, 'degraded');
  assert.equal(noLauncher.reason, 'session_start_launcher_missing');

  const noCandidateCapture = await inspectCodexIntegration({
    codexHome: 'fixture',
    auditState: async () => ({
      agentHubHook: {
        ...healthyHook,
        flags: {
          ...healthyHook.flags,
          candidateCapture: false,
        },
      },
      hookReadError: null,
    }),
  });
  assert.equal(noCandidateCapture.status, 'degraded');
  assert.equal(noCandidateCapture.reason, 'candidate_capture_disabled');

  const noAutoPipeline = await inspectCodexIntegration({
    codexHome: 'fixture',
    auditState: async () => ({
      agentHubHook: {
        ...healthyHook,
        flags: {
          ...healthyHook.flags,
          autoPipeline: false,
        },
      },
      hookReadError: null,
    }),
  });
  assert.equal(noAutoPipeline.status, 'degraded');
  assert.equal(noAutoPipeline.reason, 'auto_pipeline_disabled');

  const noAgentDecisionCapture = await inspectCodexIntegration({
    codexHome: 'fixture',
    auditState: async () => ({
      agentHubHook: {
        ...healthyHook,
        subagentStopAgentDecisionCapture: false,
        flags: {
          ...healthyHook.flags,
          agentDecisionCapture: false,
        },
      },
      hookReadError: null,
    }),
  });
  assert.equal(noAgentDecisionCapture.status, 'degraded');
  assert.equal(
    noAgentDecisionCapture.reason,
    'agent_decision_capture_incomplete',
  );

  const missingHybrid = await inspectCodexIntegration({
    codexHome: 'fixture',
    auditState: async () => ({
      agentHubHook: {
        ...healthyHook,
        flags: {
          ...healthyHook.flags,
          hybridRecall: false,
        },
      },
      hookReadError: null,
    }),
  });
  assert.equal(missingHybrid.status, 'broken');
  assert.equal(missingHybrid.reason, 'agent_hub_hook_incomplete');
});

test('native Codex isolation doctor requires every managed control to be explicitly false', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-doctor-isolation-'));

  await writeFile(
    join(root, 'config.toml'),
    [
      '[features]',
      'memories = false',
      '',
      '[memories]',
      'use_memories = false',
      'generate_memories = false',
      '',
    ].join('\n'),
  );

  const isolated = await inspectNativeCodexMemoryIsolation({
    codexHome: root,
    agentHubHookConfigured: true,
  });
  assert.equal(isolated.status, 'isolated');
  assert.deepEqual(isolated.reasons, []);

  await writeFile(
    join(root, 'config.toml'),
    [
      '[features]',
      'memories = false',
      '',
      '[memories]',
      'generate_memories = false',
      '',
    ].join('\n'),
  );

  const drifted = await inspectNativeCodexMemoryIsolation({
    codexHome: root,
    agentHubHookConfigured: true,
  });
  assert.equal(drifted.status, 'broken');
  assert.deepEqual(drifted.reasons, ['memories.use_memories_not_false']);
});

test('overall doctor status uses broken over degraded over healthy', () => {
  assert.equal(
    evaluateMemoryDoctorStatus([
      { status: 'ok' },
      { status: 'isolated' },
      { status: 'not_applicable' },
    ]),
    'healthy',
  );

  assert.equal(
    evaluateMemoryDoctorStatus([
      { status: 'ok' },
      { status: 'degraded' },
      { status: 'isolated' },
    ]),
    'degraded',
  );

  assert.equal(
    evaluateMemoryDoctorStatus([
      { status: 'degraded' },
      { status: 'broken' },
    ]),
    'broken',
  );
});

test('memory doctor composes database, context, embedding, hook and native-isolation checks without repair work', async () => {
  const calls = [];

  const report = await runMemoryDoctor({
    cwd: 'C:/repo',
    dbPath: 'C:/state/memory.sqlite3',
    cacheDir: 'C:/repo/.cache/memory-engine/e5',
    codexHome: 'C:/fixture/.codex',
    dependencies: {
      resolveScope() {
        calls.push('scope');
        return {
          projectId: 'github.com/Wibias/agent-hub',
          repoIdentity: 'github.com/Wibias/agent-hub',
          canonicalRemote: 'github.com/Wibias/agent-hub',
        };
      },
      resolveGitContext() {
        calls.push('git');
        return {
          repoPath: 'C:/repo',
          branch: 'main',
          revisionSha: 'a'.repeat(40),
        };
      },
      inspectDatabase() {
        calls.push('db');
        return {
          status: 'ok',
          projectRegistered: true,
          claims: 2,
          activeClaims: 1,
          lexicalCoverageComplete: true,
          semanticCoverageComplete: true,
        };
      },
      inspectCache: async () => {
        calls.push('cache');
        return { status: 'ok' };
      },
      inspectWorker: async () => {
        calls.push('worker');
        return {
          status: 'ok',
          ready: true,
          queryCanary: true,
          dimensions: E5_DIMENSIONS,
        };
      },
      inspectCodex: async () => {
        calls.push('codex');
        return {
          status: 'ok',
          hook: {
            configured: true,
            userPromptSubmit: true,
            sessionStartLauncher: true,
            flags: {
              ignoreMemoryEnv: true,
              explicitMemoryRequests: true,
              hybridRecall: true,
            },
          },
        };
      },
      inspectNativeIsolation: async () => {
        calls.push('isolation');
        return {
          status: 'isolated',
          settings: {
            featureEnabled: false,
            useMemories: false,
            generateMemories: false,
          },
        };
      },
    },
  });

  assert.equal(report.type, 'agent_hub_memory_doctor');
  assert.equal(report.status, 'healthy');
  assert.deepEqual(report.context, {
    status: 'ok',
    cwd: 'C:/repo',
    repoPath: 'C:/repo',
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
    revisionSha: 'a'.repeat(40),
  });
  assert.equal(report.database.status, 'ok');
  assert.equal(report.embedding.cache.status, 'ok');
  assert.equal(report.embedding.worker.status, 'ok');
  assert.equal(report.codex.status, 'ok');
  assert.equal(report.nativeCodexMemory.status, 'isolated');
  assert.deepEqual(calls, [
    'scope',
    'git',
    'db',
    'cache',
    'worker',
    'codex',
    'isolation',
  ]);
});

test('memory doctor degrades when semantic worker is down but canonical memory remains healthy', async () => {
  const report = await runMemoryDoctor({
    dependencies: {
      resolveScope() {
        return { projectId: 'p' };
      },
      resolveGitContext() {
        return {
          repoPath: 'C:/repo',
          branch: 'main',
          revisionSha: 'a'.repeat(40),
        };
      },
      inspectDatabase() {
        return {
          status: 'ok',
          projectRegistered: true,
          claims: 1,
          activeClaims: 1,
          lexicalCoverageComplete: true,
          semanticCoverageComplete: true,
        };
      },
      inspectCache: async () => ({ status: 'ok' }),
      inspectWorker: async () => ({
        status: 'degraded',
        ready: false,
        queryCanary: false,
      }),
      inspectCodex: async () => ({ status: 'ok' }),
      inspectNativeIsolation: async () => ({ status: 'isolated' }),
    },
  });

  assert.equal(report.status, 'degraded');
});

test('memory doctor is broken when Codex hook or native isolation is unsafe', async () => {
  const report = await runMemoryDoctor({
    dependencies: {
      resolveScope() {
        return { projectId: 'p' };
      },
      resolveGitContext() {
        return {
          repoPath: 'C:/repo',
          branch: 'main',
          revisionSha: 'a'.repeat(40),
        };
      },
      inspectDatabase() {
        return { status: 'ok' };
      },
      inspectCache: async () => ({ status: 'ok' }),
      inspectWorker: async () => ({ status: 'ok' }),
      inspectCodex: async () => ({
        status: 'broken',
        reason: 'agent_hub_hook_missing',
      }),
      inspectNativeIsolation: async () => ({
        status: 'broken',
        reason: 'native_memory_not_isolated',
      }),
    },
  });

  assert.equal(report.status, 'broken');
});

test('doctor CLI emits one JSON object and maps status to deterministic exit codes', async () => {
  for (const [status, expectedExitCode] of [
    ['healthy', 0],
    ['degraded', 1],
    ['broken', 2],
  ]) {
    const lines = [];
    let exitCode = null;

    const output = await runMemoryDoctorCli({
      argv: ['--cwd', 'C:/repo'],
      log(value) {
        lines.push(value);
      },
      setExitCode(value) {
        exitCode = value;
      },
      runDoctor: async () => ({
        type: 'agent_hub_memory_doctor',
        status,
      }),
    });

    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), output);
    assert.equal(exitCode, expectedExitCode);
  }
});
