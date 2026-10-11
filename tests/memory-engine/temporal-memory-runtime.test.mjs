import test from 'node:test';
import assert from 'node:assert/strict';

import {
  prepareTemporalMemoryRuntime,
} from '../../memory-engine/temporal-memory-runtime.mjs';

test('temporal runtime expires scoped claims before creating the defensive memory view', () => {
  const calls = [];
  const rawMemory = { marker: 'raw' };
  const view = { marker: 'view' };
  const result = prepareTemporalMemoryRuntime({
    memory: rawMemory,
    dbPath: '/tmp/memory.sqlite3',
    projectId: 'project-a',
    branch: 'main',
    clock: () => '2026-10-11T12:00:00.000Z',
    expireClaims(options) {
      calls.push(['expire', options]);
      return { evaluated: 2, expired: 1, claim_ids: ['c-old'] };
    },
    createView(options) {
      calls.push(['view', options]);
      return view;
    },
  });

  assert.equal(result.memory, view);
  assert.deepEqual(result.expiration, {
    evaluated: 2, expired: 1, claim_ids: ['c-old'],
  });
  assert.equal(calls[0][0], 'expire');
  assert.equal(calls[0][1].projectId, 'project-a');
  assert.equal(calls[0][1].branch, 'main');
  assert.equal(calls[0][1].now, '2026-10-11T12:00:00.000Z');
  assert.equal(calls[1][0], 'view');
  assert.equal(calls[1][1].memory, rawMemory);
  assert.equal(calls[1][1].now(), '2026-10-11T12:00:00.000Z');
});

test('temporal runtime validates stable integration dependencies', () => {
  assert.throws(
    () => prepareTemporalMemoryRuntime({
      memory: {}, dbPath: '', projectId: 'p', branch: 'main',
    }),
    /dbPath/i,
  );
  assert.throws(
    () => prepareTemporalMemoryRuntime({
      memory: {}, dbPath: '/tmp/x', projectId: 'p', branch: 'main',
      expireClaims: null,
    }),
    /expireClaims/i,
  );
});
