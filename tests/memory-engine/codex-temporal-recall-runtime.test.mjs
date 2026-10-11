import test from 'node:test';
import assert from 'node:assert/strict';

import {
  prepareCodexTemporalRecallRuntime,
} from '../../memory-engine/adapters/codex-temporal-recall-runtime.mjs';

test('codex temporal recall runtime resolves git once and prepares scoped temporal memory', () => {
  const calls = [];
  const rawMemory = { marker: 'raw' };
  const temporalMemory = { marker: 'temporal' };
  const result = prepareCodexTemporalRecallRuntime({
    memory: rawMemory,
    dbPath: '/tmp/memory.sqlite3',
    projectId: 'project-a',
    cwd: '/repo',
    clock: () => '2026-10-11T14:00:00.000Z',
    resolveGit({ cwd }) {
      calls.push(['git', cwd]);
      return {
        repoPath: '/repo',
        branch: 'main',
        revisionSha: 'abc123',
      };
    },
    prepareTemporalRuntime(options) {
      calls.push(['temporal', options]);
      return {
        memory: temporalMemory,
        expiration: { evaluated: 1, expired: 1, claim_ids: ['old'] },
        observed_at: '2026-10-11T14:00:00.000Z',
      };
    },
  });

  assert.equal(result.memory, temporalMemory);
  assert.deepEqual(result.git, {
    repoPath: '/repo', branch: 'main', revisionSha: 'abc123',
  });
  assert.equal(result.expiration.expired, 1);
  assert.equal(calls.filter(([kind]) => kind === 'git').length, 1);
  assert.equal(calls[1][1].memory, rawMemory);
  assert.equal(calls[1][1].dbPath, '/tmp/memory.sqlite3');
  assert.equal(calls[1][1].projectId, 'project-a');
  assert.equal(calls[1][1].branch, 'main');
  assert.equal(calls[1][1].clock(), '2026-10-11T14:00:00.000Z');
});

test('codex temporal recall runtime validates required integration inputs', () => {
  assert.throws(
    () => prepareCodexTemporalRecallRuntime({
      memory: {}, dbPath: '/tmp/x', projectId: 'p', cwd: '',
    }),
    /cwd/i,
  );
  assert.throws(
    () => prepareCodexTemporalRecallRuntime({
      memory: {}, dbPath: '/tmp/x', projectId: 'p', cwd: '/repo', resolveGit: null,
    }),
    /resolveGit/i,
  );
});
