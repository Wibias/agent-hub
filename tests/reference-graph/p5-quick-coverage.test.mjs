import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCompleteQuickCoverage,
  quickCoverageRequirements,
} from '../../knowledge/design-references/scripts/quick-coverage.mjs';
import { selectRecords } from '../../knowledge/design-references/scripts/selection.mjs';

const REFERENCE_NOW = new Date('2026-10-23T12:00:00.000Z');

function record(id, overrides = {}) {
  return {
    id,
    title: id,
    product: id,
    surfaceFamily: 'operator-control',
    primaryStratum: 'direct-domain',
    platform: 'web-responsive',
    flowStates: ['active'],
    evidenceClass: 'OBSERVED',
    accessStatus: 'AVAILABLE',
    accessMethod: 'public web',
    storagePolicy: 'text-link-only',
    pageRole: 'Fixture',
    firstScreenJob: 'Fixture job',
    topology: `topology-${id}`,
    traversal: 'Fixture traversal',
    density: 'medium',
    responsiveBehavior: 'Fixture responsive behavior',
    motion: 'Fixture motion',
    visualWorld: 'Fixture visual world',
    strengths: ['Fixture strength'],
    weaknesses: ['Fixture weakness'],
    transferableDecisions: ['Fixture decision'],
    tags: [],
    sourceFamily: `source-${id}`,
    sourceKind: 'underlying-product',
    observedAt: '2026-10-22',
    lastVerifiedAt: '2026-10-22',
    ttlDays: 90,
    reviewStatus: 'reviewed',
    researchedBy: 'researcher',
    reviewedBy: 'reviewer',
    reviewedAt: '2026-10-22',
    rightsNote: 'Synthetic fixture.',
    provenanceNote: 'Synthetic fixture.',
    ordinaryOrFailureProne: false,
    multiStateFlow: false,
    replacementFor: null,
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

test('quick selector preserves feasible platform coverage instead of spending every slot on higher-scoring surface matches', () => {
  const records = [
    record('ref-surface-a', { surfaceFamily: 'authenticated-home' }),
    record('ref-surface-b', { surfaceFamily: 'authenticated-home' }),
    record('ref-surface-c', { surfaceFamily: 'authenticated-home' }),
    record('ref-surface-d', { surfaceFamily: 'authenticated-home' }),
    record('ref-mobile-a', { platform: 'native-mobile' }),
    record('ref-mobile-b', { platform: 'native-mobile' }),
  ];
  const request = {
    profile: 'quick',
    limit: 4,
    surface: 'authenticated-home',
    platform: 'native-mobile',
    job: '',
    dimensions: '',
  };

  const first = selectRecords(records, request, { now: REFERENCE_NOW });
  const reversed = selectRecords([...records].reverse(), request, { now: REFERENCE_NOW });

  assert.equal(first.selected.length, 4);
  assert.equal(first.coverage.exactSurface >= 1, true);
  assert.equal(first.coverage.exactPlatform >= 2, true);
  assert.deepEqual(first.coverageGaps, []);
  assert.deepEqual(
    first.selected.map((item) => item.id),
    reversed.selected.map((item) => item.id),
  );
});
