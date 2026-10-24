import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeReferenceCapture } from '../../reference-graph/capture.mjs';
import { adaptLegacyDesignReference } from '../../reference-graph/legacy-import.mjs';

function fixture() {
  return {
    id: 'ref-p7-metadata-parity',
    title: 'P7 parity reference',
    canonicalUrl: 'https://example.com/p7-parity',
    product: 'Example Product',
    surfaceFamily: 'authenticated-home',
    primaryStratum: 'direct-domain',
    platform: 'native-mobile',
    flowStates: ['home', 'detail'],
    evidenceClass: 'TESTED',
    accessStatus: 'AVAILABLE',
    accessMethod: 'public-product-surface',
    storagePolicy: 'text-link-only',
    pageRole: 'product surface',
    firstScreenJob: 'Orient the signed-in user and expose the primary action.',
    topology: 'Header -> primary action -> recent items',
    traversal: 'Primary action -> recent item -> detail',
    density: 'medium',
    responsiveBehavior: 'Primary action remains prominent on narrow screens.',
    motion: 'Subtle state transitions.',
    visualWorld: 'Dark utility surface with restrained accent color.',
    strengths: ['Clear primary action'],
    weaknesses: ['Dense recent-item area'],
    transferableDecisions: ['Keep the primary action above recent content'],
    tags: ['authenticated-home', 'native-mobile', 'visual-verified'],
    sourceFamily: 'example-product',
    sourceKind: 'underlying-product',
    observedAt: '2026-10-20',
    lastVerifiedAt: '2026-10-23',
    ttlDays: 90,
    reviewStatus: 'reviewed',
    researchedBy: 'researcher-p7',
    reviewedBy: 'reviewer-p7',
    reviewedAt: '2026-10-21',
    rightsNote: 'Text notes and canonical link only.',
    provenanceNote: 'Reviewed public product surface.',
    ordinaryOrFailureProne: true,
    multiStateFlow: false,
    replacementFor: null,
  };
}

function currentSearchableText(record) {
  return [
    record.title,
    record.product,
    record.pageRole,
    record.firstScreenJob,
    record.topology,
    record.traversal,
    record.responsiveBehavior,
    record.visualWorld,
    ...record.strengths,
    ...record.weaknesses,
    ...record.transferableDecisions,
    ...record.flowStates,
    ...record.tags,
  ].join('\n');
}

function baselineIdentityCapture(record) {
  return normalizeReferenceCapture({
    source: {
      canonicalUrl: record.canonicalUrl,
      sourceKind: record.sourceKind,
      title: record.product,
      sourceFamily: record.sourceFamily,
      metadata: {
        access_status: record.accessStatus,
        access_method: record.accessMethod,
      },
    },
    asset: {
      kind: 'web-page',
      canonicalLocator: record.canonicalUrl,
      title: record.title,
      mediaType: 'text/html',
      capturedAt: record.lastVerifiedAt,
      contentText: currentSearchableText(record),
      storagePolicy: record.storagePolicy,
      metadata: {},
    },
    provenance: {
      captureMethod: record.accessMethod,
      capturedBy: record.researchedBy,
      observedAt: record.observedAt,
      sourceRef: record.canonicalUrl,
    },
    tags: record.tags,
    observations: [],
  });
}

test('P7 legacy import persists the missing frozen lexical-parity metadata', () => {
  const record = fixture();
  const capture = adaptLegacyDesignReference(record);

  assert.equal(capture.asset.metadata.evidence_class, 'TESTED');
  assert.equal(capture.asset.metadata.ordinary_or_failure_prone, true);
  assert.equal(capture.asset.metadata.multi_state_flow, false);
  assert.equal(capture.asset.metadata.source_family, 'example-product');
});

test('P7 metadata enrichment preserves source, asset, chunk, content, and text-hash identity', () => {
  const record = fixture();
  const baseline = baselineIdentityCapture(record);
  const enriched = adaptLegacyDesignReference(record);

  assert.equal(enriched.source.id, baseline.source.id);
  assert.equal(enriched.asset.id, baseline.asset.id);
  assert.equal(enriched.asset.content_hash, baseline.asset.content_hash);
  assert.equal(enriched.chunks.length, 1);
  assert.equal(baseline.chunks.length, 1);
  assert.equal(enriched.chunks[0].id, baseline.chunks[0].id);
  assert.equal(enriched.chunks[0].content, baseline.chunks[0].content);
  assert.equal(enriched.chunks[0].metadata.text_hash, baseline.chunks[0].metadata.text_hash);
});
