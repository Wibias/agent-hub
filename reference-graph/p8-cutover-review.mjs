import { isFresh } from '../knowledge/design-references/scripts/lib.mjs';
import { adaptLegacyDesignReference } from './legacy-import.mjs';

const PRODUCTION_SOURCE = 'legacy-control';
const ACCESSIBLE_STATUSES = new Set(['AVAILABLE', 'PAYWALLED']);

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  return now;
}

function topologyFromCapture(capture) {
  return capture.observations.find(
    (row) => row.observation_kind === 'topology',
  )?.body ?? null;
}

function candidateFromRecord(record) {
  const capture = adaptLegacyDesignReference(record);
  return {
    asset_id: capture.asset.id,
    legacy_id: capture.asset.metadata.legacy_id,
    search_text: capture.chunks.map((row) => row.content).join('\n'),
    product: capture.asset.metadata.product,
    surface_family: capture.asset.metadata.surface_family,
    platform: capture.asset.metadata.platform,
    page_role: capture.asset.metadata.page_role,
    motion: capture.asset.metadata.motion,
    source_family:
      capture.asset.metadata.source_family
      ?? capture.source.source_family
      ?? null,
    topology: topologyFromCapture(capture),
    access_status: capture.asset.metadata.access_status,
    evidence_class: capture.asset.metadata.evidence_class,
    ordinary_or_failure_prone: capture.asset.metadata.ordinary_or_failure_prone,
    multi_state_flow: capture.asset.metadata.multi_state_flow,
    tags: [...capture.tags],
  };
}

export function buildP8OfflineQuickCandidatePool(records, { now } = {}) {
  requireArray(records, 'records');
  requireNow(now);

  const seenLegacyIds = new Set();
  const seenAssetIds = new Set();
  const candidates = [];

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('records must contain objects');
    }
    if (record.reviewStatus !== 'reviewed') continue;
    if (!ACCESSIBLE_STATUSES.has(record.accessStatus)) continue;
    if (!isFresh(record, now)) continue;

    const candidate = candidateFromRecord(record);
    requireNonEmptyString(candidate.asset_id, 'candidate.asset_id');
    requireNonEmptyString(candidate.legacy_id, 'candidate.legacy_id');
    if (seenAssetIds.has(candidate.asset_id)) {
      throw new Error(`duplicate offline candidate asset id: ${candidate.asset_id}`);
    }
    if (seenLegacyIds.has(candidate.legacy_id)) {
      throw new Error(`duplicate offline candidate legacy id: ${candidate.legacy_id}`);
    }
    seenAssetIds.add(candidate.asset_id);
    seenLegacyIds.add(candidate.legacy_id);
    candidates.push(candidate);
  }

  return candidates.sort((left, right) => left.asset_id.localeCompare(right.asset_id));
}

export function hydrateP8LegacyIds({ records, legacyIds } = {}) {
  requireArray(records, 'records');
  requireArray(legacyIds, 'legacyIds');

  const byId = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('records must contain objects');
    }
    const id = requireNonEmptyString(record.id, 'record.id');
    if (byId.has(id)) throw new Error(`duplicate local record id: ${id}`);
    byId.set(id, record);
  }

  const seen = new Set();
  return legacyIds.map((rawId) => {
    const id = requireNonEmptyString(rawId, 'graph legacy id');
    if (seen.has(id)) throw new Error(`duplicate graph legacy id: ${id}`);
    seen.add(id);
    const record = byId.get(id);
    if (!record) throw new Error(`unknown graph legacy id: ${id}`);
    return record;
  });
}

function requireQuickRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('request must be an object');
  }
  if (request.profile !== 'quick') {
    throw new Error('P8 graph handoff supports quick requests only');
  }
  return request;
}

function uniqueDifference(left, right) {
  const rightSet = new Set(right);
  return left.filter((id) => !rightSet.has(id));
}

export function compareP8QuickHandoff({
  records,
  request,
  graphLegacyIds,
  legacySelection,
} = {}) {
  requireQuickRequest(request);
  requireArray(graphLegacyIds, 'graphLegacyIds');
  if (!legacySelection || typeof legacySelection !== 'object' || !Array.isArray(legacySelection.selected)) {
    throw new TypeError('legacySelection.selected must be an array');
  }

  const graphRecords = hydrateP8LegacyIds({ records, legacyIds: graphLegacyIds });
  const legacyIds = legacySelection.selected.map((record) =>
    requireNonEmptyString(record?.id, 'legacy selected record id'));
  const graphIds = graphRecords.map((record) => record.id);
  const sameOrder = legacyIds.length === graphIds.length
    && legacyIds.every((id, index) => id === graphIds[index]);
  const missingFromGraph = uniqueDifference(legacyIds, graphIds);
  const unexpectedFromGraph = uniqueDifference(graphIds, legacyIds);
  const sameMembership = legacyIds.length === graphIds.length
    && missingFromGraph.length === 0
    && unexpectedFromGraph.length === 0;

  return {
    production_source: PRODUCTION_SOURCE,
    activation_performed: false,
    handoff_exact: sameMembership && sameOrder,
    same_membership: sameMembership,
    same_order: sameOrder,
    legacy_ids: legacyIds,
    graph_ids: graphIds,
    missing_from_graph: missingFromGraph,
    unexpected_from_graph: unexpectedFromGraph,
    graph_records: graphRecords,
  };
}

export function assessP8ActivationBoundary({
  profile,
  handoffExact,
  runtimeCredentialMode,
} = {}) {
  requireNonEmptyString(profile, 'profile');
  const blockers = [];

  if (profile !== 'quick') {
    blockers.push(`graph parity is not certified for ${profile}; profile remains legacy-only`);
    if (runtimeCredentialMode === 'service-role') {
      blockers.push('service-role is operator-only and not an approved production runtime credential');
    }
    return {
      profile,
      profile_status: 'legacy-only',
      quick_path_review_eligible: false,
      production_activation_ready: false,
      production_source: PRODUCTION_SOURCE,
      activation_performed: false,
      blockers,
    };
  }

  if (handoffExact !== true) blockers.push('quick graph handoff is not exact');
  if (runtimeCredentialMode === 'service-role') {
    blockers.push('service-role is operator-only and not an approved production runtime credential');
  } else {
    blockers.push('P8 is review-only and does not authorize production activation');
  }

  return {
    profile,
    profile_status: handoffExact === true ? 'review-eligible' : 'blocked',
    quick_path_review_eligible: handoffExact === true,
    production_activation_ready: false,
    production_source: PRODUCTION_SOURCE,
    activation_performed: false,
    blockers,
  };
}
