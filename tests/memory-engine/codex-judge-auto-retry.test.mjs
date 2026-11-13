import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { inspectAutomaticJudgeRetryBackoff } from '../../memory-engine/codex-judge-auto-retry.mjs';

const TIME = Date.parse('2026-11-12T12:00:00.000Z');
const PROJECT = 'github.com/example/codex-retries';

function withFixture(errors, fn) {
  const root = mkdtempSync(join(tmpdir(), 'memory-auto-retry-'));
  const dbPath = join(root, 'memory.sqlite3');
  try {
    const mem = new MemoryEngine({ dbPath });
    mem.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    mem.startPipelineRun({
      id: 'pipeline-run-1', projectId: PROJECT, branch: 'main',
      trigger: 'Stop', startedAt: new Date(TIME - 60_000).toISOString(),
    });
    errors.forEach((error, i) => {
      mem.recordPipelineFailure({
        runId: 'pipeline-run-1', projectId: PROJECT, branch: 'main',
        stage: 'importance', errorClass: 'candidate_stage_failure',
        error, occurredAt: new Date(TIME - 30_000 + 1000 * i).toISOString(),
      });
    });
    mem.finishPipelineRun({
      id: 'pipeline-run-1', status: 'partial',
      finishedAt: new Date(TIME - 15_000).toISOString(),
      durationMs: 45_000,
    });
    mem.close();
    const hash = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    const original = hash();
    fn({ dbPath, now: () => TIME });
    assert.equal(hash(), original, 'retry guard must never mutate canonical SQLite');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function inspect({ dbPath, now }) {
  return inspectAutomaticJudgeRetryBackoff({
    dbPath, projectId: PROJECT, branch: 'main', now,
  });
}

test('repeated missing-cli legacy errors do not block a repaired CLI', () => {
  withFixture(Array(10).fill('spawn codex ENOENT'), (ctx) => {
    assert.deepEqual(inspect(ctx), {
      deferred: false, reason: null, minutes: 0,
    });
  });
});

test('one rate-limit indication defers only automatic worker requests', () => {
  withFixture(['codex candidate judge failed with exit 1: HTTP 429 rate limit'], ctx => {
    assert.deepEqual(inspect(ctx), {
      deferred: true, reason: 'rate_limit_cooldown', minutes: 10,
    });
  });
});

test('one usage-window, credits or spend-cap failure suppresses repeated auto-judging for six hours', () => {
  for (const message of [
    "codex candidate judge failed with exit 1: You've hit your usage limit",
    'codex candidate judge failed with exit 1: You have reached the usage limit',
    'codex candidate judge failed with exit 1: usage_limit_reached',
    'codex candidate judge failed with exit 1: Your workspace is out of credits',
    'codex candidate judge failed with exit 1: Quota exceeded',
    'codex candidate judge failed with exit 1: You hit your spend cap set in your workspace',
  ]) {
    withFixture([message], (ctx) => {
      const blocked = {
        deferred: true,
        reason: 'usage_or_quota_cooldown',
        minutes: 360,
      };
      assert.deepEqual(inspect(ctx), blocked);
      assert.deepEqual(inspect({ ...ctx, now: () => TIME + 20 * 60_000 }), blocked);
      assert.deepEqual(inspect({ ...ctx, now: () => TIME + 5 * 60 * 60_000 }), blocked);
      assert.deepEqual(inspect({ ...ctx, now: () => TIME + 6 * 60 * 60_000 }), {
        deferred: false,
        reason: null,
        minutes: 0,
      });
    });
  }
});

test('repeated quota refusals extend only automatic cooldown to one day', () => {
  withFixture([
    'codex candidate judge failed with exit 1: You have reached the usage limit',
    'codex candidate judge failed with exit 1: You have reached the usage limit',
  ], (ctx) => {
    const blocked = {
      deferred: true,
      reason: 'usage_or_quota_cooldown',
      minutes: 1440,
    };
    assert.deepEqual(inspect(ctx), blocked);
    assert.deepEqual(inspect({ ...ctx, now: () => TIME + 15 * 60_000 }), blocked);
    assert.deepEqual(inspect({ ...ctx, now: () => TIME + 6 * 60 * 60_000 }), blocked);
    assert.deepEqual(inspect({ ...ctx, now: () => TIME + 20 * 60 * 60_000 }), blocked);
    assert.deepEqual(inspect({ ...ctx, now: () => TIME + 24 * 60 * 60_000 }), {
      deferred: false,
      reason: null,
      minutes: 0,
    });
  });
});

test('quota failures in another branch or failure stage cannot block this project', () => {
  withFixture(['totally normal candidate failure'], (ctx) => {
    assert.equal(inspect(ctx).deferred, false);
  });
});

test('a generic 429 remains a rate-limit cooldown rather than usage quota', () => {
  withFixture(['codex candidate judge failed with exit 1: HTTP 429 rate limit'], (ctx) => {
    assert.equal(inspect(ctx).reason, 'rate_limit_cooldown');
  });
});

test('two auth rejections create a short backoff', () => {
  withFixture(['Unauthorized (private secret)', 'Authentication failed'], ctx => {
    assert.deepEqual(inspect(ctx), {
      deferred: true, reason: 'auth_error_cooldown', minutes: 10,
    });
  });
});

test('five unknown exits defer repeated automatic failures without promotion', () => {
  withFixture(Array(5).fill('codex candidate judge failed with exit 1'), ctx => {
    assert.deepEqual(inspect(ctx), {
      deferred: true, reason: 'repeated_judge_failures_cooldown', minutes: 3,
    });
    assert.deepEqual(inspect({ ...ctx, now: () => TIME + 20 * 60_000 }), {
      deferred: false, reason: null, minutes: 0,
    });
  });
});

test('one generic error does not block further automatic processing', () => {
  withFixture(['codex candidate judge failed with exit 1'], ctx => {
    assert.equal(inspect(ctx).deferred, false);
  });
});

test('missing or unreadable DB fails closed without writing or creating it', () => {
  const result = inspectAutomaticJudgeRetryBackoff({
    dbPath: join(tmpdir(), 'agenthub-absent-retry-database.sqlite3'),
    projectId: PROJECT, branch: 'main', now: () => TIME,
  });
  assert.deepEqual(result, {
    deferred: true, reason: 'retry_guard_unavailable', minutes: 0,
  });
});

function withScopedFailures(entries, fn) {
  const root = mkdtempSync(join(tmpdir(), 'memory-scoped-auto-retry-'));
  const dbPath = join(root, 'memory.sqlite3');
  const otherProject = 'github.com/example/other-project';
  try {
    const mem = new MemoryEngine({ dbPath });
    mem.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    mem.registerProject({ projectId: otherProject, repoIdentity: otherProject });
    entries.forEach(({ projectId = PROJECT, branch = 'feature', error, stage = 'importance' }, i) => {
      const id = 'scoped-run-' + i;
      mem.startPipelineRun({
        id, projectId, branch, trigger: 'Stop',
        startedAt: new Date(TIME - 60_000 + i * 1000).toISOString(),
      });
      mem.recordPipelineFailure({
        runId: id, projectId, branch, stage,
        errorClass: 'candidate_stage_failure', error,
        occurredAt: new Date(TIME - 30_000 + i * 1000).toISOString(),
      });
      mem.finishPipelineRun({
        id, status: 'partial',
        finishedAt: new Date(TIME - 15_000 + i * 1000).toISOString(),
        durationMs: 45_000,
      });
    });
    mem.close();

    const hash = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    const before = hash();
    const inspectScope = (projectId, branch, at = TIME) => inspectAutomaticJudgeRetryBackoff({
      dbPath, projectId, branch, now: () => at,
    });
    fn({ inspectScope, otherProject });
    assert.equal(hash(), before, 'cross-branch retry guard must remain read-only');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('quota refusal on one branch defers automatic judges on sibling branches, not other projects', () => {
  withScopedFailures([
    { branch: 'feature-a', error: "codex candidate judge failed with exit 1: You've hit your usage limit" },
  ], ({ inspectScope, otherProject }) => {
    assert.deepEqual(inspectScope(PROJECT, 'feature-b'), {
      deferred: true, reason: 'usage_or_quota_cooldown', minutes: 360,
    });
    assert.deepEqual(inspectScope(PROJECT, 'main'), {
      deferred: true, reason: 'usage_or_quota_cooldown', minutes: 360,
    });
    assert.deepEqual(inspectScope(otherProject, 'main'), {
      deferred: false, reason: null, minutes: 0,
    });
    assert.deepEqual(inspectScope(PROJECT, 'feature-b', TIME + 6 * 60 * 60_000), {
      deferred: false, reason: null, minutes: 0,
    });
  });
});

test('repeated cross-branch quota refusals extend cooldown, but generic 429 remains branch-local', () => {
  withScopedFailures([
    { branch: 'feature-a', error: 'Quota exceeded' },
    { branch: 'feature-b', error: 'Your workspace is out of credits' },
  ], ({ inspectScope }) => {
    assert.deepEqual(inspectScope(PROJECT, 'feature-c'), {
      deferred: true, reason: 'usage_or_quota_cooldown', minutes: 1440,
    });
  });
  withScopedFailures([
    { branch: 'feature-a', error: 'HTTP 429 rate limit' },
  ], ({ inspectScope }) => {
    assert.deepEqual(inspectScope(PROJECT, 'feature-b'), {
      deferred: false, reason: null, minutes: 0,
    });
    assert.deepEqual(inspectScope(PROJECT, 'feature-a'), {
      deferred: true, reason: 'rate_limit_cooldown', minutes: 10,
    });
  });
});
