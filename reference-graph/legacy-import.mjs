import { normalizeReferenceCapture } from './capture.mjs';

function compact(values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

function observation(kind, body, evidenceClass, metadata = {}) {
  if (typeof body !== 'string' || body.trim().length === 0) return null;
  return {
    kind,
    body: body.trim(),
    evidenceClass: evidenceClass || 'OBSERVED',
    metadata,
  };
}

export function adaptLegacyDesignReference(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('legacy design reference must be an object');
  }

  const evidenceClass = record.evidenceClass || 'OBSERVED';
  const observations = [
    observation('first-screen-job', record.firstScreenJob, evidenceClass),
    observation('topology', record.topology, evidenceClass),
    observation('traversal', record.traversal, evidenceClass),
    observation('responsive-behavior', record.responsiveBehavior, evidenceClass),
    observation('visual-world', record.visualWorld, evidenceClass),
    ...compact(record.strengths).map((body) => observation('strength', body, evidenceClass)),
    ...compact(record.weaknesses).map((body) => observation('weakness', body, evidenceClass)),
    ...compact(record.transferableDecisions).map((body) => (
      observation('transferable-decision', body, 'INTERPRETED')
    )),
  ].filter(Boolean);

  const searchableText = compact([
    record.title,
    record.product,
    record.pageRole,
    record.firstScreenJob,
    record.topology,
    record.traversal,
    record.responsiveBehavior,
    record.visualWorld,
    record.strengths,
    record.weaknesses,
    record.transferableDecisions,
    record.flowStates,
    record.tags,
  ]).join('\n');

  const capture = normalizeReferenceCapture({
    source: {
      canonicalUrl: record.canonicalUrl,
      sourceKind: record.sourceKind || 'underlying-product',
      title: record.product || record.title,
      sourceFamily: record.sourceFamily || null,
      metadata: {
        access_status: record.accessStatus ?? null,
        access_method: record.accessMethod ?? null,
      },
    },
    asset: {
      kind: 'web-page',
      canonicalLocator: record.canonicalUrl,
      title: record.title,
      mediaType: 'text/html',
      capturedAt: record.lastVerifiedAt || record.observedAt || record.reviewedAt,
      contentText: searchableText,
      storagePolicy: record.storagePolicy || null,
      metadata: {
        legacy_id: record.id,
        product: record.product ?? null,
        surface_family: record.surfaceFamily ?? null,
        primary_stratum: record.primaryStratum ?? null,
        platform: record.platform ?? null,
        flow_states: Array.isArray(record.flowStates) ? [...record.flowStates] : [],
        page_role: record.pageRole ?? null,
        density: record.density ?? null,
        motion: record.motion ?? null,
        ttl_days: record.ttlDays ?? null,
        access_status: record.accessStatus ?? null,
        replacement_for: record.replacementFor ?? null,
        evidence_class: record.evidenceClass ?? null,
        ordinary_or_failure_prone: record.ordinaryOrFailureProne ?? null,
        multi_state_flow: record.multiStateFlow ?? null,
        source_family: record.sourceFamily ?? null,
      },
    },
    provenance: {
      captureMethod: record.accessMethod || 'legacy-design-reference',
      capturedBy: record.researchedBy || 'legacy-design-reference',
      observedAt: record.observedAt || record.lastVerifiedAt || record.reviewedAt,
      sourceRef: record.canonicalUrl,
    },
    tags: Array.isArray(record.tags) ? record.tags : [],
    observations,
  });

  capture.asset.provenance = {
    ...capture.asset.provenance,
    review_status: record.reviewStatus ?? null,
    reviewed_by: record.reviewedBy ?? null,
    reviewed_at: record.reviewedAt ?? null,
    last_verified_at: record.lastVerifiedAt ?? null,
    rights_note: record.rightsNote ?? null,
    provenance_note: record.provenanceNote ?? null,
  };

  return capture;
}
