import assert from 'node:assert/strict';
import test from 'node:test';

import { stripInternal } from '../../knowledge/design-references/scripts/lib.mjs';

function record(overrides = {}) {
  return {
    id: 'ref-example-home',
    title: 'Example home',
    canonicalUrl: 'https://example.com/',
    product: 'Example',
    surfaceFamily: 'public-home',
    primaryStratum: 'direct-domain',
    platform: 'web-responsive',
    flowStates: ['landing'],
    evidenceClass: 'OBSERVED',
    accessStatus: 'AVAILABLE',
    accessMethod: 'public-product-page',
    storagePolicy: 'text-link-only',
    pageRole: 'product homepage',
    firstScreenJob: 'Explain the product and primary action.',
    topology: 'Hero followed by product proof.',
    traversal: 'Hero to proof to CTA.',
    density: 'medium',
    responsiveBehavior: 'Sections stack on narrow viewports.',
    motion: 'low',
    visualWorld: 'Neutral product marketing surface.',
    strengths: ['Clear hierarchy'],
    weaknesses: ['Limited state depth'],
    transferableDecisions: ['Keep the primary action dominant'],
    tags: ['example', 'public-home', 'design-reference'],
    sourceFamily: 'example',
    sourceKind: 'underlying-product',
    observedAt: '2026-07-20',
    lastVerifiedAt: '2026-07-21',
    ttlDays: 90,
    reviewStatus: 'reviewed',
    researchedBy: 'researcher-example',
    reviewedBy: 'reviewer-example',
    reviewedAt: '2026-07-21',
    rightsNote: 'Text notes and canonical link only.',
    provenanceNote: 'Reviewed source evidence.',
    ordinaryOrFailureProne: true,
    multiStateFlow: false,
    replacementFor: null,
    __file: '/tmp/batch-example.jsonl',
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    id: 'ref-example-home',
    verdict: 'confirm',
    verifiedAt: '2026-10-23',
    verifier: 'revalidator-example',
    sourceChecked: true,
    analysisChecked: true,
    rightsChecked: true,
    accessStatus: 'AVAILABLE',
    notes: 'Rechecked the canonical source and the existing design analysis.',
    ...overrides,
  };
}

test('confirm advances verification without rewriting review authority', async () => {
  const { applyRevalidationDecisions } = await import(
    '../../knowledge/design-references/scripts/revalidation-lib.mjs'
  );
  const before = record();

  const result = applyRevalidationDecisions([before], [decision()]);
  const after = result.records[0];

  assert.equal(after.lastVerifiedAt, '2026-10-23');
  assert.equal(after.accessStatus, 'AVAILABLE');
  assert.equal(after.reviewStatus, 'reviewed');
  assert.equal(after.reviewedAt, before.reviewedAt);
  assert.equal(after.reviewedBy, before.reviewedBy);
  assert.deepEqual(result.summary, {
    total_records: 1,
    decision_count: 1,
    confirmed: 1,
    stale: 0,
    archived: 0,
    untouched: 0,
  });
});

test('confirm can restore a previously stale reviewed record', async () => {
  const { applyRevalidationDecisions } = await import(
    '../../knowledge/design-references/scripts/revalidation-lib.mjs'
  );
  const before = record({ reviewStatus: 'stale' });

  const result = applyRevalidationDecisions([before], [decision()]);
  const after = result.records[0];

  assert.equal(after.reviewStatus, 'reviewed');
  assert.equal(after.lastVerifiedAt, '2026-10-23');
  assert.equal(after.reviewedAt, before.reviewedAt);
  assert.equal(after.reviewedBy, before.reviewedBy);
  assert.equal(result.summary.confirmed, 1);
});

test('decision hashes are stable and content-sensitive', async () => {
  const { validateRevalidationDecision } = await import(
    '../../knowledge/design-references/scripts/revalidation-lib.mjs'
  );

  const first = validateRevalidationDecision(decision());
  const repeat = validateRevalidationDecision(decision());
  const changed = validateRevalidationDecision(decision({
    notes: 'Rechecked the canonical source and analysis; the current evidence changed.',
  }));

  assert.match(first.decisionHash, /^[a-f0-9]{64}$/);
  assert.equal(first.decisionHash, repeat.decisionHash);
  assert.notEqual(first.decisionHash, changed.decisionHash);
});

test('link-only decisions are rejected', async () => {
  const { validateRevalidationDecision } = await import(
    '../../knowledge/design-references/scripts/revalidation-lib.mjs'
  );

  assert.throws(
    () => validateRevalidationDecision(decision({ analysisChecked: false })),
    /analysisChecked/i,
  );
  assert.throws(
    () => validateRevalidationDecision(decision({ sourceChecked: false })),
    /sourceChecked/i,
  );
  assert.throws(
    () => validateRevalidationDecision(decision({ notes: 'ok' })),
    /notes/i,
  );
});

test('stale and archive become ineligible review states', async () => {
  const { applyRevalidationDecisions } = await import(
    '../../knowledge/design-references/scripts/revalidation-lib.mjs'
  );
  const first = record();
  const second = record({
    id: 'ref-example-settings',
    canonicalUrl: 'https://example.com/settings',
    title: 'Example settings',
  });

  const result = applyRevalidationDecisions(
    [first, second],
    [
      decision({ verdict: 'stale', accessStatus: 'BLOCKED' }),
      decision({
        id: second.id,
        verdict: 'archive',
        accessStatus: 'UNAVAILABLE',
        notes: 'Rechecked the source and confirmed the reference is retired.',
      }),
    ],
  );

  assert.equal(result.records[0].reviewStatus, 'stale');
  assert.equal(result.records[0].lastVerifiedAt, '2026-10-23');
  assert.equal(result.records[0].accessStatus, 'BLOCKED');
  assert.equal(result.records[1].reviewStatus, 'archived');
  assert.equal(result.records[1].lastVerifiedAt, '2026-10-23');
  assert.equal(result.records[1].accessStatus, 'UNAVAILABLE');
  assert.equal(result.records[0].reviewedAt, first.reviewedAt);
  assert.equal(result.records[1].reviewedAt, second.reviewedAt);
  assert.equal(result.summary.stale, 1);
  assert.equal(result.summary.archived, 1);
});

test('duplicate or unknown decisions fail closed', async () => {
  const { applyRevalidationDecisions } = await import(
    '../../knowledge/design-references/scripts/revalidation-lib.mjs'
  );
  const records = [record()];

  assert.throws(
    () => applyRevalidationDecisions(records, [decision(), decision()]),
    /duplicate/i,
  );
  assert.throws(
    () => applyRevalidationDecisions(records, [decision({ id: 'ref-unknown' })]),
    /unknown/i,
  );
});

test('untouched records remain byte-equivalent after internal fields are stripped', async () => {
  const { applyRevalidationDecisions } = await import(
    '../../knowledge/design-references/scripts/revalidation-lib.mjs'
  );
  const touched = record();
  const untouched = record({
    id: 'ref-example-editor',
    canonicalUrl: 'https://example.com/editor',
    title: 'Example editor',
  });

  const result = applyRevalidationDecisions([touched, untouched], [decision()]);

  assert.equal(
    JSON.stringify(stripInternal(result.records[1])),
    JSON.stringify(stripInternal(untouched)),
  );
  assert.equal(result.summary.untouched, 1);
});
