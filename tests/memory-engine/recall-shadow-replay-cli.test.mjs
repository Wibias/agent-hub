import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RecallSelectorTelemetryStore,
} from '../../memory-engine/recall-selector-telemetry-store.mjs';
import {
  createRecallShadowReplayPacket,
} from '../../memory-engine/recall-shadow-replay-packet.mjs';
import {
  RecallShadowReplayStore,
} from '../../memory-engine/recall-shadow-replay-store.mjs';
import {
  drainRecallShadowReplay,
  defaultRecallShadowReplayDbPath,
  parseRecallShadowReplayCliArgs,
  recallShadowReplayTelemetryId,
  runRecallShadowReplayCli,
} from '../../scripts/eval-recall-shadow-replay.mjs';

function tempRoot() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-hub-shadow-replay-cli-'),
  );
}

function candidate(id = 'claim-a', value = `value:${id}`) {
  return {
    claim: {
      id,
      kind: 'user_memory',
      subject: 'memory',
      predicate: 'states',
      value,
      state: 'active',
    },
    evidence: {
      authority_class: 'user_direct',
      content_redacted: value,
    },
  };
}

function packet({
  sessionId = 'session-1',
  turnId = 'turn-1',
  candidates = [candidate()],
  fastResult = {
    route: 'fast_v1',
    selected_ids: ['claim-a'],
    duration_ms: 17,
    failed: false,
  },
  query = 'What command verifies memory health?',
} = {}) {
  return createRecallShadowReplayPacket({
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
    sessionId,
    turnId,
    query,
    candidates,
    fastResult,
    retrievalTelemetry: null,
    maxSelected: 8,
    createdAt: '2026-10-14T02:10:00.000Z',
  });
}

function evaluatorResult(status, {
  judgeCalled = !['no_candidates', 'fast_path_failed'].includes(status),
  judgeSelectedIds = ['claim-a'],
  candidateCount = 1,
  selectedCount = judgeSelectedIds.length,
  localDurationMs = 17,
  totalDurationMs = 31,
} = {}) {
  return {
    status,
    judgeCalled,
    judgeSelectedIds,
    candidateCount,
    selectedCount,
    localDurationMs,
    totalDurationMs,
  };
}

function openSandbox() {
  const root = tempRoot();
  const replayRoot = path.join(root, 'shadow-replay');
  const dbPath = path.join(root, 'memory.sqlite3');
  const store = new RecallShadowReplayStore({ rootDir: replayRoot });
  const telemetry = new RecallSelectorTelemetryStore({ dbPath });

  return {
    root,
    replayRoot,
    dbPath,
    store,
    telemetry,
    close() {
      try {
        telemetry.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

function fakeJudgeRuntime() {
  return {
    judge: async () => JSON.stringify({
      selected_ids: ['claim-a'],
      reason: 'synthetic',
    }),
    async close() {},
  };
}

test('CLI args pin bounded default and explicit maintenance semantics', () => {
  assert.deepEqual(parseRecallShadowReplayCliArgs([]), {
    limit: 20,
    limitExplicit: false,
    recoverStaleProcessingMinutes: null,
    cleanupFailedOlderThanDays: null,
    evaluate: true,
  });

  assert.deepEqual(
    parseRecallShadowReplayCliArgs([
      '--recover-stale-processing-minutes',
      '15',
    ]),
    {
      limit: 20,
      limitExplicit: false,
      recoverStaleProcessingMinutes: 15,
      cleanupFailedOlderThanDays: null,
      evaluate: false,
    },
  );

  assert.deepEqual(
    parseRecallShadowReplayCliArgs([
      '--cleanup-failed-older-than-days',
      '7',
      '--limit',
      '3',
    ]),
    {
      limit: 3,
      limitExplicit: true,
      recoverStaleProcessingMinutes: null,
      cleanupFailedOlderThanDays: 7,
      evaluate: true,
    },
  );

  for (const argv of [
    ['--limit', '0'],
    ['--limit', '-1'],
    ['--limit', '1.5'],
    ['--recover-stale-processing-minutes', '0'],
    ['--cleanup-failed-older-than-days', 'wat'],
    ['--unknown'],
  ]) {
    assert.throws(
      () => parseRecallShadowReplayCliArgs(argv),
      /positive integer|unknown argument|requires a value/i,
    );
  }
});

test('replay DB path follows Agent Hub env/platform conventions without importing hook runtime', () => {
  assert.equal(
    defaultRecallShadowReplayDbPath({
      env: { AGENT_HUB_MEMORY_DB: 'D:\\custom\\memory.sqlite3' },
      platform: 'win32',
      homeDir: 'C:\\Users\\ws',
    }),
    'D:\\custom\\memory.sqlite3',
  );

  assert.equal(
    defaultRecallShadowReplayDbPath({
      env: { LOCALAPPDATA: 'C:\\Users\\ws\\AppData\\Local' },
      platform: 'win32',
      homeDir: 'C:\\Users\\ws',
    }),
    'C:\\Users\\ws\\AppData\\Local\\agent-hub\\memory.sqlite3',
  );

  assert.equal(
    defaultRecallShadowReplayDbPath({
      env: { XDG_STATE_HOME: '/state' },
      platform: 'linux',
      homeDir: '/home/ws',
    }),
    '/state/agent-hub/memory.sqlite3',
  );
});

for (const scenario of [
  { status: 'fast_v1_match', final: 'completed' },
  { status: 'fast_v2_match', final: 'completed', route: 'fast_v2' },
  { status: 'fast_path_fallback', final: 'completed', route: 'fallback' },
  { status: 'no_candidates', final: 'completed', zero: true },
  { status: 'fast_path_failed', final: 'failed', failed: true },
  { status: 'judge_unavailable', final: 'failed' },
  { status: 'fast_v1_mismatch', final: 'review' },
  { status: 'fast_v2_mismatch', final: 'review', route: 'fast_v2' },
]) {
  test(`${scenario.status} writes one Shadow row and transitions to ${scenario.final}`, async () => {
    const sandbox = openSandbox();
    try {
      const value = scenario.zero
        ? packet({
            candidates: [],
            fastResult: null,
          })
        : packet({
            fastResult: scenario.failed
              ? {
                  route: 'fallback',
                  selected_ids: [],
                  duration_ms: 17,
                  failed: true,
                  error: 'captured local failure',
                }
              : {
                  route: scenario.route ?? 'fast_v1',
                  selected_ids:
                    (scenario.route === 'fallback')
                      ? []
                      : ['claim-a'],
                  duration_ms: 17,
                  failed: false,
                },
          });

      sandbox.store.capture(value);

      const result = await drainRecallShadowReplay({
        store: sandbox.store,
        telemetryStore: sandbox.telemetry,
        limit: 1,
        createJudgeRuntime: async () => fakeJudgeRuntime(),
        evaluatePacket: async ({ packet: frozen }) => evaluatorResult(
          scenario.status,
          {
            judgeCalled: ![
              'no_candidates',
              'fast_path_failed',
            ].includes(scenario.status),
            judgeSelectedIds:
              scenario.status === 'no_candidates'
              || scenario.status === 'fast_path_failed'
                ? []
                : ['claim-a'],
            candidateCount: frozen.candidates.length,
            localDurationMs:
              frozen.localFastPath?.duration_ms ?? 0,
          },
        ),
        clock: () => '2026-10-14T02:15:00.000Z',
      });

      const telemetryId = recallShadowReplayTelemetryId(value.id);
      const row = sandbox.telemetry.get(telemetryId);

      assert.ok(row);
      assert.equal(row.id, telemetryId);
      assert.equal(row.route, 'shadow');
      assert.equal(row.status, scenario.status);
      assert.equal(row.project_id, value.scope.projectId);
      assert.equal(row.branch, value.scope.branch);
      assert.equal(
        row.candidate_count,
        value.candidates.length,
      );
      assert.equal(
        row.local_duration_ms,
        value.localFastPath?.duration_ms ?? 0,
      );
      assert.equal(
        row.selected_count,
        value.localFastPath?.selected_ids?.length ?? 0,
      );

      if (scenario.final === 'completed') {
        assert.equal(result.completed, 1);
        assert.equal(sandbox.store.counts().pending, 0);
        assert.equal(sandbox.store.counts().processing, 0);
      } else if (scenario.final === 'review') {
        assert.equal(result.review, 1);
        assert.equal(sandbox.store.counts().review, 1);
      } else {
        assert.equal(result.failed, 1);
        assert.equal(sandbox.store.counts().failed, 1);
      }

      const serializedRow = JSON.stringify(row);
      assert.equal(
        serializedRow.includes(value.query),
        false,
      );
      assert.equal(
        serializedRow.includes(
          value.candidates[0]?.claim?.value ?? '__none__',
        ),
        false,
      );
    } finally {
      sandbox.close();
    }
  });
}

test('malformed packet writes no selector row and moves to failed', async () => {
  const sandbox = openSandbox();
  try {
    sandbox.store.counts();
    const malformedId = '0'.repeat(64);

    fs.writeFileSync(
      path.join(
        sandbox.replayRoot,
        'pending',
        `${malformedId}.json`,
      ),
      '{"schemaVersion":1,"broken":true}',
      'utf8',
    );

    const result = await drainRecallShadowReplay({
      store: sandbox.store,
      telemetryStore: sandbox.telemetry,
      limit: 1,
      createJudgeRuntime: async () => fakeJudgeRuntime(),
      evaluatePacket: async () => {
        throw new Error('malformed packet must not evaluate');
      },
    });

    assert.equal(result.malformed, 1);
    assert.equal(result.failed, 1);
    assert.equal(sandbox.store.counts().failed, 1);
    assert.equal(
      sandbox.telemetry.list({
        projectId: 'github.com/Wibias/agent-hub',
        branch: 'main',
      }).length,
      0,
    );
  } finally {
    sandbox.close();
  }
});

test('telemetry success plus transition failure is idempotent on retry', async () => {
  const sandbox = openSandbox();
  try {
    const value = packet();
    sandbox.store.capture(value);

    const originalComplete =
      sandbox.store.complete.bind(sandbox.store);
    let failOnce = true;

    sandbox.store.complete = (id) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('synthetic complete failure');
      }
      return originalComplete(id);
    };

    let evaluations = 0;
    const first = await drainRecallShadowReplay({
      store: sandbox.store,
      telemetryStore: sandbox.telemetry,
      limit: 1,
      createJudgeRuntime: async () => fakeJudgeRuntime(),
      evaluatePacket: async () => {
        evaluations += 1;
        return evaluatorResult('fast_v1_match');
      },
      clock: () => '2026-10-14T02:20:00.000Z',
    });

    assert.equal(first.transitionFailures, 1);
    assert.equal(first.released, 1);
    assert.equal(sandbox.store.counts().pending, 1);

    const telemetryId = recallShadowReplayTelemetryId(value.id);
    assert.equal(
      sandbox.telemetry.list({
        projectId: value.scope.projectId,
        branch: value.scope.branch,
      }).filter((row) => row.id === telemetryId).length,
      1,
    );

    const second = await drainRecallShadowReplay({
      store: sandbox.store,
      telemetryStore: sandbox.telemetry,
      limit: 1,
      createJudgeRuntime: async () => {
        throw new Error('existing terminal telemetry must skip Judge');
      },
      evaluatePacket: async () => {
        throw new Error('existing terminal telemetry must skip evaluator');
      },
    });

    assert.equal(evaluations, 1);
    assert.equal(second.alreadyRecorded, 1);
    assert.equal(second.completed, 1);
    assert.equal(sandbox.store.counts().pending, 0);
    assert.equal(
      sandbox.telemetry.list({
        projectId: value.scope.projectId,
        branch: value.scope.branch,
      }).filter((row) => row.id === telemetryId).length,
      1,
    );
  } finally {
    sandbox.close();
  }
});

test('conflicting existing telemetry is never overwritten and packet is retained for diagnosis', async () => {
  const sandbox = openSandbox();
  try {
    const value = packet();
    sandbox.store.capture(value);

    const telemetryId = recallShadowReplayTelemetryId(value.id);
    sandbox.telemetry.record({
      id: telemetryId,
      projectId: value.scope.projectId,
      branch: value.scope.branch,
      observedAt: '2026-10-14T02:25:00.000Z',
      route: 'shadow',
      status: 'fast_v2_match',
      localDurationMs: 17,
      totalDurationMs: 20,
      candidateCount: 1,
      selectedCount: 1,
      judgeCalled: true,
    });

    const result = await drainRecallShadowReplay({
      store: sandbox.store,
      telemetryStore: sandbox.telemetry,
      limit: 1,
      createJudgeRuntime: async () => {
        throw new Error('conflict must not invoke Judge');
      },
      evaluatePacket: async () => {
        throw new Error('conflict must not invoke evaluator');
      },
    });

    assert.equal(result.telemetryConflicts, 1);
    assert.equal(result.failed, 1);
    assert.equal(sandbox.store.counts().failed, 1);

    const row = sandbox.telemetry.get(telemetryId);
    assert.equal(row.status, 'fast_v2_match');
  } finally {
    sandbox.close();
  }
});

test('telemetry write failure releases packet to pending and creates no terminal state', async () => {
  const root = tempRoot();
  try {
    const store = new RecallShadowReplayStore({
      rootDir: path.join(root, 'shadow-replay'),
    });
    const value = packet();
    store.capture(value);

    const result = await drainRecallShadowReplay({
      store,
      telemetryStore: {
        get() {
          return null;
        },
        record() {
          throw new Error('synthetic telemetry failure');
        },
      },
      limit: 1,
      createJudgeRuntime: async () => fakeJudgeRuntime(),
      evaluatePacket: async () => evaluatorResult('fast_v1_match'),
    });

    assert.equal(result.telemetryFailures, 1);
    assert.equal(result.released, 1);
    assert.deepEqual(store.counts(), {
      pending: 1,
      processing: 0,
      failed: 0,
      review: 0,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Judge creation failure becomes terminal judge_unavailable and is not retried', async () => {
  const sandbox = openSandbox();
  try {
    const value = packet();
    sandbox.store.capture(value);

    let createCalls = 0;
    const result = await drainRecallShadowReplay({
      store: sandbox.store,
      telemetryStore: sandbox.telemetry,
      limit: 1,
      createJudgeRuntime: async () => {
        createCalls += 1;
        throw new Error('synthetic isolated Judge startup failure');
      },
    });

    assert.equal(createCalls, 1);
    assert.equal(result.failed, 1);

    const row = sandbox.telemetry.get(
      recallShadowReplayTelemetryId(value.id),
    );
    assert.equal(row.status, 'judge_unavailable');
    assert.equal(row.judge_called, false);
    assert.equal(sandbox.store.counts().failed, 1);
  } finally {
    sandbox.close();
  }
});

test('bounded drain is sequential and leaves remaining pending packets untouched', async () => {
  const sandbox = openSandbox();
  try {
    for (let index = 0; index < 5; index += 1) {
      sandbox.store.capture(packet({
        sessionId: `session-${index}`,
        turnId: `turn-${index}`,
      }));
    }

    let active = 0;
    let maxActive = 0;
    let calls = 0;

    const result = await drainRecallShadowReplay({
      store: sandbox.store,
      telemetryStore: sandbox.telemetry,
      limit: 2,
      createJudgeRuntime: async () => fakeJudgeRuntime(),
      evaluatePacket: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return evaluatorResult('fast_v1_match');
      },
    });

    assert.equal(result.claimed, 2);
    assert.equal(result.evaluated, 2);
    assert.equal(calls, 2);
    assert.equal(maxActive, 1);
    assert.equal(sandbox.store.counts().pending, 3);
  } finally {
    sandbox.close();
  }
});

test('malformed packet does not prevent next valid packet within claimed limit', async () => {
  const sandbox = openSandbox();
  try {
    sandbox.store.counts();
    fs.writeFileSync(
      path.join(
        sandbox.replayRoot,
        'pending',
        `${'0'.repeat(64)}.json`,
      ),
      '{"broken":true}',
      'utf8',
    );

    sandbox.store.capture(packet({
      sessionId: 'valid-session',
      turnId: 'valid-turn',
    }));

    let evaluations = 0;
    const result = await drainRecallShadowReplay({
      store: sandbox.store,
      telemetryStore: sandbox.telemetry,
      limit: 2,
      createJudgeRuntime: async () => fakeJudgeRuntime(),
      evaluatePacket: async () => {
        evaluations += 1;
        return evaluatorResult('fast_v1_match');
      },
    });

    assert.equal(result.claimed, 2);
    assert.equal(result.malformed, 1);
    assert.equal(result.evaluated, 1);
    assert.equal(evaluations, 1);
  } finally {
    sandbox.close();
  }
});

test('maintenance-only flags do not implicitly evaluate pending packets', async () => {
  const sandbox = openSandbox();
  try {
    sandbox.store.capture(packet());

    const result = await runRecallShadowReplayCli({
      argv: ['--recover-stale-processing-minutes', '5'],
      dbPath: sandbox.dbPath,
      rootDir: sandbox.replayRoot,
      createStore: () => sandbox.store,
      createTelemetryStore: () => {
        throw new Error('maintenance-only must not open telemetry store');
      },
      createJudgeRuntime: async () => {
        throw new Error('maintenance-only must not create Judge');
      },
      evaluatePacket: async () => {
        throw new Error('maintenance-only must not evaluate');
      },
    });

    assert.equal(result.mode, 'maintenance');
    assert.equal(result.evaluated, 0);
    assert.equal(sandbox.store.counts().pending, 1);
  } finally {
    sandbox.close();
  }
});

test('replay CLI source remains free of MemoryEngine/retriever/embedding imports', () => {
  const source = fs.readFileSync(
    new URL('../../scripts/eval-recall-shadow-replay.mjs', import.meta.url),
    'utf8',
  );

  for (const forbidden of [
    'MemoryEngine',
    'HybridMemoryRetriever',
    'embedding-worker',
    'embedding-worker-client',
    'e5-embedder',
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `replay drain must not depend on ${forbidden}`,
    );
  }
});