import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMemoryCandidatePipelineArgs,
  runMemoryCandidatePipelineCli,
} from '../../scripts/process-memory-candidates.mjs';

function runtime() {
  return {
    cwd: '/repo',
    dbPath: '/state/memory.sqlite3',
    projectId: 'github.com/Wibias/agent-hub',
    branch: 'main',
    revisionSha: 'a'.repeat(40),
  };
}

function createLedgerState({
  importance = 0,
  relation = 0,
  promotion = 0,
  needsConfirmation = 0,
  keptForReview = 0,
} = {}) {
  return {
    importance,
    relation,
    promotion,
    needsConfirmation,
    keptForReview,
    closes: 0,
  };
}

function createMemoryFactory(state) {
  return () => ({
    listUnevaluatedCandidates({ limit }) {
      return Array.from(
        { length: Math.min(state.importance, limit) },
        (_, index) => ({ id: 'importance-' + index }),
      );
    },
    listRelationPendingCandidates({ limit }) {
      return Array.from(
        { length: Math.min(state.relation, limit) },
        (_, index) => ({ id: 'relation-' + index }),
      );
    },
    listPromotionReadyCandidates({ limit }) {
      return Array.from(
        { length: Math.min(state.promotion, limit) },
        (_, index) => ({ id: 'promotion-' + index }),
      );
    },
    listScopedCandidates() {
      return [
        ...Array.from(
          { length: state.needsConfirmation },
          (_, index) => ({
            id: 'confirm-' + index,
            status: 'needs_confirmation',
          }),
        ),
        ...Array.from(
          { length: state.keptForReview },
          (_, index) => ({
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
          }),
        ),
      ];
    },
    close() {
      state.closes += 1;
    },
  });
}

test('pipeline CLI defaults to status-only and bounds all batches', () => {
  assert.deepEqual(
    parseMemoryCandidatePipelineArgs([], '/repo'),
    {
      cwd: '/repo',
      dbPath: null,
      limit: 10,
      apply: false,
      model: null,
      reasoningEffort: 'medium',
    },
  );

  assert.equal(
    parseMemoryCandidatePipelineArgs(['--apply'], '/repo').apply,
    true,
  );
  assert.equal(
    parseMemoryCandidatePipelineArgs(['--limit', '20'], '/repo').limit,
    20,
  );
  assert.throws(
    () => parseMemoryCandidatePipelineArgs(['--limit', '21'], '/repo'),
    /between 1 and 20/i,
  );
});

test('status-only mode never invokes AI or promotion stages', async () => {
  const state = createLedgerState({
    importance: 3,
    relation: 2,
    promotion: 1,
    needsConfirmation: 4,
    keptForReview: 3,
  });
  const calls = [];
  const lines = [];

  const output = await runMemoryCandidatePipelineCli({
    argv: ['--limit', '2'],
    cwd: '/repo',
    log(value) {
      lines.push(value);
    },
    dependencies: {
      resolveRuntime: runtime,
      createMemory: createMemoryFactory(state),
      runImportance: async () => {
        calls.push('importance');
      },
      runRelation: async () => {
        calls.push('relation');
      },
      runPromotion: async () => {
        calls.push('promotion');
      },
    },
  });

  assert.equal(output.mode, 'status');
  assert.deepEqual(calls, []);
  assert.deepEqual(output.initial, {
    batch_limit: 2,
    importance_ready: 2,
    relation_ready: 2,
    promotion_ready: 1,
    needs_confirmation: 4,
    kept_for_review: 3,
  });
  assert.deepEqual(output.final, output.initial);
  assert.deepEqual(output.stages, []);
  assert.equal(lines.length, 1);
  assert.ok(state.closes >= 1);
});

test('apply mode executes only newly eligible stages in strict order', async () => {
  const state = createLedgerState({
    importance: 2,
    relation: 0,
    promotion: 0,
    needsConfirmation: 1,
  });
  const calls = [];

  const output = await runMemoryCandidatePipelineCli({
    argv: [
      '--apply',
      '--limit', '2',
      '--model', 'gpt-test',
      '--reasoning-effort', 'high',
    ],
    cwd: '/repo',
    log() {},
    dependencies: {
      resolveRuntime: runtime,
      createMemory: createMemoryFactory(state),
      async runImportance(args) {
        assert.deepEqual(args.dependencies.resolveRuntime(), runtime());
        calls.push(['importance', args.argv]);
        state.importance = 0;
        state.relation = 2;
        return {
          type: 'importance',
          summary: { total: 2, evaluated: 2, applied: 2, failed: 0 },
        };
      },
      async runRelation(args) {
        assert.deepEqual(args.dependencies.resolveRuntime(), runtime());
        calls.push(['relation', args.argv]);
        state.relation = 0;
        state.promotion = 2;
        return {
          type: 'relation',
          summary: { total: 2, evaluated: 2, applied: 2, failed: 0 },
        };
      },
      async runPromotion(args) {
        assert.deepEqual(args.dependencies.resolveRuntime(), runtime());
        calls.push(['promotion', args.argv]);
        state.promotion = 0;
        return {
          type: 'promotion',
          summary: {
            total: 2,
            promoted: 2,
            superseded: 0,
            needs_confirmation: 0,
            failed: 0,
          },
        };
      },
    },
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    ['importance', 'relation', 'promotion'],
  );

  for (const [name, argv] of calls) {
    assert.ok(argv.includes('--apply'), name);
    assert.deepEqual(
      argv.slice(argv.indexOf('--limit'), argv.indexOf('--limit') + 2),
      ['--limit', '2'],
      name,
    );
    assert.deepEqual(
      argv.slice(argv.indexOf('--cwd'), argv.indexOf('--cwd') + 2),
      ['--cwd', '/repo'],
      name,
    );
    assert.deepEqual(
      argv.slice(argv.indexOf('--db-path'), argv.indexOf('--db-path') + 2),
      ['--db-path', '/state/memory.sqlite3'],
      name,
    );
  }

  for (const [name, argv] of calls.slice(0, 2)) {
    assert.deepEqual(
      argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2),
      ['--model', 'gpt-test'],
      name,
    );
    assert.deepEqual(
      argv.slice(
        argv.indexOf('--reasoning-effort'),
        argv.indexOf('--reasoning-effort') + 2,
      ),
      ['--reasoning-effort', 'high'],
      name,
    );
  }
  assert.equal(calls[2][1].includes('--model'), false);
  assert.equal(calls[2][1].includes('--reasoning-effort'), false);

  assert.equal(output.mode, 'apply');
  assert.deepEqual(
    output.stages.map((stage) => [stage.name, stage.skipped]),
    [
      ['importance', false],
      ['relation', false],
      ['promotion', false],
    ],
  );
  assert.deepEqual(output.final, {
    batch_limit: 2,
    importance_ready: 0,
    relation_ready: 0,
    promotion_ready: 0,
    needs_confirmation: 1,
    kept_for_review: 0,
  });
});

test('apply skips empty stages and never starts an unnecessary judge', async () => {
  const state = createLedgerState({
    importance: 0,
    relation: 1,
    promotion: 0,
  });
  const calls = [];

  const output = await runMemoryCandidatePipelineCli({
    argv: ['--apply'],
    cwd: '/repo',
    log() {},
    dependencies: {
      resolveRuntime: runtime,
      createMemory: createMemoryFactory(state),
      async runImportance() {
        calls.push('importance');
      },
      async runRelation() {
        calls.push('relation');
        state.relation = 0;
        state.promotion = 1;
        return { summary: { total: 1, applied: 1, failed: 0 } };
      },
      async runPromotion() {
        calls.push('promotion');
        state.promotion = 0;
        return { summary: { total: 1, promoted: 1, failed: 0 } };
      },
    },
  });

  assert.deepEqual(calls, ['relation', 'promotion']);
  assert.deepEqual(
    output.stages.map((stage) => [stage.name, stage.skipped]),
    [
      ['importance', true],
      ['relation', false],
      ['promotion', false],
    ],
  );
});

test('infrastructure failure aborts later stages fail-closed', async () => {
  const state = createLedgerState({
    importance: 1,
    relation: 1,
    promotion: 1,
  });
  const calls = [];

  await assert.rejects(
    runMemoryCandidatePipelineCli({
      argv: ['--apply'],
      cwd: '/repo',
      log() {},
      dependencies: {
        resolveRuntime: runtime,
        createMemory: createMemoryFactory(state),
        async runImportance() {
          calls.push('importance');
          throw new Error('judge unavailable');
        },
        async runRelation() {
          calls.push('relation');
        },
        async runPromotion() {
          calls.push('promotion');
        },
      },
    }),
    /judge unavailable/,
  );

  assert.deepEqual(calls, ['importance']);
});

test('a successful stage may report candidate failures while later eligible work continues safely', async () => {
  const state = createLedgerState({
    importance: 2,
    relation: 0,
    promotion: 0,
  });
  const calls = [];

  const output = await runMemoryCandidatePipelineCli({
    argv: ['--apply', '--limit', '2'],
    cwd: '/repo',
    log() {},
    dependencies: {
      resolveRuntime: runtime,
      createMemory: createMemoryFactory(state),
      async runImportance() {
        calls.push('importance');
        state.importance = 1;
        state.relation = 1;
        return {
          summary: {
            total: 2,
            evaluated: 1,
            applied: 1,
            failed: 1,
          },
        };
      },
      async runRelation() {
        calls.push('relation');
        state.relation = 0;
        state.promotion = 1;
        return {
          summary: {
            total: 1,
            evaluated: 1,
            applied: 1,
            failed: 0,
          },
        };
      },
      async runPromotion() {
        calls.push('promotion');
        state.promotion = 0;
        return {
          summary: {
            total: 1,
            promoted: 1,
            failed: 0,
          },
        };
      },
    },
  });

  assert.deepEqual(calls, ['importance', 'relation', 'promotion']);
  assert.equal(output.stages[0].result.summary.failed, 1);
  assert.equal(output.final.importance_ready, 1);
});
