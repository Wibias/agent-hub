import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUpstreamStatus, needsUpstreamAction } from '../../scripts/lib/upstream-status.mjs';

const classify = (advanced, scopedChanges, decision = 'current') =>
  classifyUpstreamStatus({ advanced, scopedChanges, decision });

test('a remote commit alone is not an adoption recommendation', () => {
  assert.equal(classify(true, null), 'REVIEW');
  assert.equal(classify(true, false), 'REMOTE_ADVANCED');
  assert.equal(classify(true, true), 'SCOPE_CHANGED');
  assert.equal(classify(false, null), 'CURRENT');
});

test('pending local adoption remains pending even if the watched scope is unchanged', () => {
  assert.equal(classify(false, null, 'update-pending'), 'PENDING');
  assert.equal(classify(true, false, 'update-pending'), 'PENDING');
  assert.equal(classify(true, true, 'update-pending'), 'SCOPE_CHANGED');
  assert.equal(classify(true, null, 'update-pending'), 'REVIEW');
});

test('historical not-applicable decision does not conceal newly changed scope', () => {
  assert.equal(classify(false, null, 'not-applicable'), 'CURRENT');
  assert.equal(classify(true, false, 'not-applicable'), 'REMOTE_ADVANCED');
  assert.equal(classify(true, true, 'not-applicable'), 'SCOPE_CHANGED');
});

test('only evidence requiring review or pending adoption causes a non-zero check', () => {
  for (const status of ['CURRENT', 'REMOTE_ADVANCED']) {
    assert.equal(needsUpstreamAction(status), false, status);
  }
  for (const status of ['PENDING', 'REVIEW', 'SCOPE_CHANGED']) {
    assert.equal(needsUpstreamAction(status), true, status);
  }
});

test('invalid or contradictory status inputs fail closed', () => {
  assert.throws(() => classifyUpstreamStatus({ advanced: false, scopedChanges: true, decision: 'current' }), TypeError);
  assert.throws(() => classifyUpstreamStatus({ advanced: 'true', scopedChanges: null, decision: 'current' }), TypeError);
  assert.throws(() => classifyUpstreamStatus({ advanced: true, scopedChanges: null, decision: 'unknown' }), TypeError);
});
