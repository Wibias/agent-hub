import { selectPatterns } from '../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../knowledge/design-references/scripts/selection.mjs';
import { hydrateP8LegacyIds } from './p8-cutover-review.mjs';
import { selectP29ProfileCandidateIds } from './p29-offline-profile-parity.mjs';

function orderedIds(rows) {
  return rows.map(row => row.id);
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Standard/Deep handoff evaluation, intentionally OFFLINE and SHADOW-ONLY.
 * Works with a previously verified P30 candidate array supplied by the
 * caller, but never fetches it itself. This is NOT the P11 production router.
 *
 * No activation flags, no network, no usage writes, no public record output.
 */
export function auditP40StandardDeepShadowHandoff({
  records,
  patterns,
  request,
  candidates,
  now = new Date(),
  selectPatternsFn = selectPatterns,
} = {}) {
  if (!Array.isArray(records) || !Array.isArray(patterns)
    || !Array.isArray(candidates)
    || !(now instanceof Date) || Number.isNaN(now.valueOf())
    || !request || !['standard', 'deep'].includes(request.profile)
    || typeof selectPatternsFn !== 'function') {
    throw new TypeError('P40 requires valid Standard/Deep offline inputs');
  }

  const legacy = selectRecords(records, request, { now });
  const legacyPatterns = selectPatternsFn(patterns, legacy.selected, request);
  const selected = selectP29ProfileCandidateIds({ candidates, request });
  const hydrated = hydrateP8LegacyIds({ records, legacyIds: selected.ids });
  const graphPatterns = selectPatternsFn(patterns, hydrated, request);
  const recordExact = sameOrder(orderedIds(legacy.selected), orderedIds(hydrated));
  const patternExact = sameOrder(orderedIds(legacyPatterns), orderedIds(graphPatterns));

  return {
    schema_version: 'reference-graph.p40-standard-deep-shadow-handoff.v1',
    profile: request.profile,
    record_order_exact: recordExact,
    pattern_order_exact: patternExact,
    parity_exact: recordExact && patternExact,
    authoritative_source: 'legacy-control',
    graph_runtime_attempted: false,
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
  };
}
