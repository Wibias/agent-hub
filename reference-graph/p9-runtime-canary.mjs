import { selectRecords } from '../knowledge/design-references/scripts/selection.mjs';
import { selectPatterns } from '../knowledge/design-references/scripts/pattern-selection.mjs';
import { recordUsage } from '../knowledge/design-references/scripts/usage.mjs';
import { selectP7ParityLexicalResults } from './p7-parity-policy.mjs';
import { hydrateP8LegacyIds } from './p8-cutover-review.mjs';

function orderedIds(rows) {
  return rows.map((row) => row.id);
}

function sameOrder(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function legacyResult({ selection, patterns, graphCanary, usageWarning = null }) {
  return {
    production_source: 'legacy-control',
    activation_performed: false,
    selectedByStratum: selection.selectedByStratum,
    coverage: selection.coverage,
    coverageGaps: selection.coverageGaps,
    requiresTargetedResearch: selection.coverageGaps.length > 0,
    usageWarning,
    records: selection.selected,
    patterns,
    graph_canary: graphCanary,
  };
}

export async function runP9ShadowCanary({
  records,
  patterns,
  request,
  fetchCandidatePool,
  recordUsageFn = recordUsage,
  recordUsageEnabled = true,
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!Array.isArray(patterns)) throw new TypeError('patterns must be an array');
  if (!request || typeof request !== 'object') throw new TypeError('request is required');

  const legacySelection = selectRecords(records, request);
  const legacyPatterns = selectPatterns(patterns, legacySelection.selected, request);
  let graphCanary = {
    status: 'legacy-only',
    attempted: false,
    record_exact: null,
    pattern_exact: null,
    reason: request.profile === 'quick' ? null : 'profile-legacy-only',
    transport: null,
  };

  if (request.profile === 'quick') {
    graphCanary = {
      status: 'fallback',
      attempted: true,
      record_exact: false,
      pattern_exact: false,
      reason: 'graph-shadow-error',
      transport: null,
    };

    try {
      if (typeof fetchCandidatePool !== 'function') {
        throw new TypeError('fetchCandidatePool must be a function for quick canary requests');
      }
      const remote = await fetchCandidatePool();
      if (!remote || !Array.isArray(remote.candidates)) {
        throw new TypeError('candidate pool response is invalid');
      }

      const graphSelection = selectP7ParityLexicalResults({
        candidates: remote.candidates,
        request,
        maxItems: request.limit,
      });
      const graphRecords = hydrateP8LegacyIds({ records, legacyIds: graphSelection.ids });
      const graphPatterns = selectPatterns(patterns, graphRecords, request);
      const legacyIds = orderedIds(legacySelection.selected);
      const graphIds = orderedIds(graphRecords);
      const legacyPatternIds = orderedIds(legacyPatterns);
      const graphPatternIds = orderedIds(graphPatterns);
      const recordExact = sameOrder(legacyIds, graphIds);
      const patternExact = sameOrder(legacyPatternIds, graphPatternIds);
      const exact = recordExact && patternExact;

      graphCanary = {
        status: exact ? 'exact' : 'fallback',
        attempted: true,
        record_exact: recordExact,
        pattern_exact: patternExact,
        reason: exact ? null : 'handoff-mismatch',
        transport: remote.transport ?? null,
        legacy_ids: legacyIds,
        graph_ids: graphIds,
        legacy_pattern_ids: legacyPatternIds,
        graph_pattern_ids: graphPatternIds,
      };
    } catch {
      // The shadow path is deliberately non-authoritative. Never leak raw remote
      // errors or let graph failures interfere with the valid legacy result.
    }
  }

  let usageWarning = null;
  if (recordUsageEnabled) {
    try {
      recordUsageFn(legacySelection.selected, request);
    } catch {
      usageWarning = 'Selected legacy records are valid, but local usage recording failed.';
    }
  }

  return legacyResult({
    selection: legacySelection,
    patterns: legacyPatterns,
    graphCanary,
    usageWarning,
  });
}
