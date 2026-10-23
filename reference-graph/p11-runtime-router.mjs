import { selectPatterns } from '../knowledge/design-references/scripts/pattern-selection.mjs';
import { selectRecords } from '../knowledge/design-references/scripts/selection.mjs';
import { recordUsage } from '../knowledge/design-references/scripts/usage.mjs';
import { hydrateP8LegacyIds } from './p8-cutover-review.mjs';
import { selectP7ParityLexicalResults } from './p7-parity-policy.mjs';

const LEGACY_SOURCE = 'legacy-control';
const GRAPH_SOURCE = 'reference-graph';

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('request must be an object');
  }
  return request;
}

function requireNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError('now must be a valid Date');
  }
  return now;
}

function orderedIds(rows) {
  return rows.map((row) => row.id);
}

function sameOrder(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function publicResult({ request, selection, patterns, usageWarning = null }) {
  return {
    profile: request.profile,
    requested: {
      surface: request.surface || null,
      platform: request.platform || null,
      job: request.job || null,
      dimensions: request.dimensions
        ? String(request.dimensions).split(',').filter(Boolean)
        : [],
      limit: request.limit,
    },
    countsByStratum: selection.selectedByStratum,
    coverage: selection.coverage,
    coverageGaps: selection.coverageGaps,
    requiresTargetedResearch: selection.coverageGaps.length > 0,
    usageWarning,
    records: selection.selected,
    patterns,
  };
}

function routing({
  graphMode,
  attempted = false,
  authoritativeSource = LEGACY_SOURCE,
  recordExact = null,
  patternExact = null,
  reason = null,
}) {
  return {
    requested_mode: graphMode === 'graph' ? 'graph' : 'legacy',
    attempted,
    authoritative_source: authoritativeSource,
    record_exact: recordExact,
    pattern_exact: patternExact,
    reason,
  };
}

export async function runP11RuntimeQuery({
  records,
  patterns,
  request,
  graphMode = 'legacy',
  fetchCandidatePool,
  recordUsageFn = recordUsage,
  recordUsageEnabled = true,
  usageLogPath,
  selectPatternsFn = selectPatterns,
  now = new Date(),
} = {}) {
  requireArray(records, 'records');
  requireArray(patterns, 'patterns');
  requireRequest(request);
  requireNow(now);
  if (typeof selectPatternsFn !== 'function') {
    throw new TypeError('selectPatternsFn must be a function');
  }
  if (typeof recordUsageFn !== 'function') {
    throw new TypeError('recordUsageFn must be a function');
  }

  const legacySelection = selectRecords(records, request, { now });
  const legacyPatterns = selectPatternsFn(patterns, legacySelection.selected, request);
  let authoritativeSelection = legacySelection;
  let authoritativePatterns = legacyPatterns;
  let route;

  if (request.profile !== 'quick') {
    route = routing({ graphMode, reason: 'profile-legacy-only' });
  } else if (graphMode !== 'graph') {
    route = routing({ graphMode, reason: 'activation-disabled' });
  } else if (typeof fetchCandidatePool !== 'function') {
    route = routing({ graphMode, reason: 'missing-runtime-config' });
  } else {
    route = routing({ graphMode, attempted: true, reason: 'graph-runtime-error' });
    try {
      const remote = await fetchCandidatePool();
      if (!remote || !Array.isArray(remote.candidates)) {
        throw new TypeError('candidate pool response is invalid');
      }

      const graphSelection = selectP7ParityLexicalResults({
        candidates: remote.candidates,
        request,
        maxItems: request.limit,
      });
      const graphRecords = hydrateP8LegacyIds({
        records,
        legacyIds: graphSelection.ids,
      });
      const graphPatterns = selectPatternsFn(patterns, graphRecords, request);
      const recordExact = sameOrder(
        orderedIds(legacySelection.selected),
        orderedIds(graphRecords),
      );
      const patternExact = sameOrder(
        orderedIds(legacyPatterns),
        orderedIds(graphPatterns),
      );

      if (recordExact && patternExact) {
        authoritativeSelection = {
          ...legacySelection,
          selected: graphRecords,
        };
        authoritativePatterns = graphPatterns;
        route = routing({
          graphMode,
          attempted: true,
          authoritativeSource: GRAPH_SOURCE,
          recordExact: true,
          patternExact: true,
          reason: null,
        });
      } else {
        route = routing({
          graphMode,
          attempted: true,
          recordExact,
          patternExact,
          reason: 'handoff-mismatch',
        });
      }
    } catch {
      // Graph routing is fail-closed. Remote/internal details never alter or
      // leak through the valid local legacy result.
    }
  }

  let usageWarning = null;
  if (recordUsageEnabled) {
    try {
      recordUsageFn(authoritativeSelection.selected, request, usageLogPath);
    } catch (error) {
      usageWarning =
        'Selected records are valid, but local usage recording failed: '
        + (error instanceof Error ? error.message : String(error));
    }
  }

  return {
    result: publicResult({
      request,
      selection: authoritativeSelection,
      patterns: authoritativePatterns,
      usageWarning,
    }),
    routing: route,
  };
}
