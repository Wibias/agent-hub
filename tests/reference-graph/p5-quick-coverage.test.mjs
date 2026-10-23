import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCompleteQuickCoverage,
  quickCoverageRequirements,
} from '../../knowledge/design-references/scripts/quick-coverage.mjs';

function record(id, overrides = {}) {
  return {
    id,
    surfaceFamily: 'operator-control',
    platform: 'web-responsive',
    ...overrides,
  };
}

test('quick coverage requirements preserve the declared surface and platform minima', () => {
  assert.deepEqual(
    quickCoverageRequirements({
      profile: 'quick',
      limit: 4,
      surface: 'authenticated-home',
      platform: 'native-mobile',
    }),
    {
      minimumSurface: 1,
      minimumPlatform: 2,
    },
  );
});

test('a remaining record matching both predicates can satisfy both deficits in one slot', () => {
  const request = {
    profile: 'quick',
    limit: 2,
    surface: 'authenticated-home',
    platform: 'native-mobile',
  };
  const selectedRecords = [record('ref-selected')];
  const remainingRecords = [
    record('ref-both', {
      surfaceFamily: 'authenticated-home',
      platform: 'native-mobile',
    }),
  ];

  assert.equal(
    canCompleteQuickCoverage({ selectedRecords, remainingRecords, request }),
    true,
  );
});

test('quick coverage is infeasible when remaining predicate supply cannot satisfy a deficit', () => {
  const request = {
    profile: 'quick',
    limit: 4,
    surface: 'authenticated-home',
    platform: 'native-mobile',
  };
  const selectedRecords = [
    record('ref-surface', { surfaceFamily: 'authenticated-home' }),
    record('ref-platform', { platform: 'native-mobile' }),
  ];

  assert.equal(
    canCompleteQuickCoverage({
      selectedRecords,
      remainingRecords: [
        record('ref-web-a'),
        record('ref-web-b'),
      ],
      request,
    }),
    false,
  );
});

test('quick coverage is infeasible when individually available requirements cannot fit in the remaining slot', () => {
  const request = {
    profile: 'quick',
    limit: 3,
    surface: 'authenticated-home',
    platform: 'native-mobile',
  };
  const selectedRecords = [record('ref-selected-a'), record('ref-selected-b')];
  const remainingRecords = [
    record('ref-surface-only', { surfaceFamily: 'authenticated-home' }),
    record('ref-platform-only', { platform: 'native-mobile' }),
  ];

  assert.equal(
    canCompleteQuickCoverage({ selectedRecords, remainingRecords, request }),
    false,
  );
});

test('quick coverage feasibility is independent of remaining record order', () => {
  const request = {
    profile: 'quick',
    limit: 4,
    surface: 'authenticated-home',
    platform: 'native-mobile',
  };
  const selectedRecords = [record('ref-selected')];
  const remainingRecords = [
    record('ref-both', {
      surfaceFamily: 'authenticated-home',
      platform: 'native-mobile',
    }),
    record('ref-platform', { platform: 'native-mobile' }),
    record('ref-fill'),
  ];

  const forward = canCompleteQuickCoverage({ selectedRecords, remainingRecords, request });
  const reversed = canCompleteQuickCoverage({
    selectedRecords,
    remainingRecords: [...remainingRecords].reverse(),
    request,
  });

  assert.equal(forward, true);
  assert.equal(reversed, forward);
});

test('quick coverage rejects duplicate record identities across selected and remaining pools', () => {
  assert.throws(
    () => canCompleteQuickCoverage({
      selectedRecords: [record('ref-duplicate')],
      remainingRecords: [record('ref-duplicate')],
      request: {
        profile: 'quick',
        limit: 2,
        surface: 'authenticated-home',
        platform: 'native-mobile',
      },
    }),
    /duplicate record id/i,
  );
});
