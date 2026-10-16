import { buildRecallCandidatePassage } from './recall-fast-path-calibration.mjs';
import { buildRecallFastPathDiagnostics } from './recall-fast-path-diagnostics.mjs';

export const RECALL_FAST_PATH_POLICY_VERSION = 'recall-fast-path-v2';

export const RECALL_FAST_PATH_DEFAULTS = Object.freeze({
  negativeThreshold: 0.83,
  positiveThreshold: 0.85,
  supportThreshold: 0.86,
  singleMarginThreshold: 0.03,
  lexicalK: 1,
  fusedK: 1,
  minVotes: 3,
});

function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

function probability(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(name + ' must be between 0 and 1');
  }
  return value;
}

function positiveInt(value, name, max = 10) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(name + ' must be an integer between 1 and ' + max);
  }
  return value;
}

function validateItems(items) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (items.length > 10) throw new RangeError('items must contain at most 10 entries');
  const ids = new Set();
  for (const item of items) {
    const id = nonEmpty(item?.claim?.id, 'item claim id');
    if (ids.has(id)) throw new Error('items contain duplicate claim id: ' + id);
    ids.add(id);
  }
  return ids;
}

function dot(left, right) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
    throw new TypeError('embedding vectors must be Float32Array');
  }
  if (left.length === 0 || left.length !== right.length) {
    throw new RangeError('embedding vector dimensions must match and be non-empty');
  }
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}

function decideV1(candidates, settings) {
  const high = candidates.filter((candidate) => candidate.similarity >= settings.positiveThreshold);
  const ambiguous = candidates.filter((candidate) => (
    candidate.similarity >= settings.negativeThreshold
    && candidate.similarity < settings.positiveThreshold
  ));

  if (high.length === 0) {
    if (ambiguous.length === 0) return { route: 'fast_v1', selected_ids: [], decision: 'negative' };
    return { route: 'fallback', selected_ids: [], decision: 'ambiguous' };
  }
  if (ambiguous.length > 0) return { route: 'fallback', selected_ids: [], decision: 'ambiguous' };
  return {
    route: 'fast_v1',
    selected_ids: high.map((candidate) => candidate.claimId),
    decision: 'positive',
  };
}

function normalizeRank(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function retrievalCandidateMap(retrievalTelemetry) {
  const rows = Array.isArray(retrievalTelemetry?.items)
    ? retrievalTelemetry.items
    : Array.isArray(retrievalTelemetry?.candidates)
      ? retrievalTelemetry.candidates
      : [];
  const map = new Map();
  for (const row of rows) {
    const claimId = row?.claim_id ?? row?.claimId;
    if (typeof claimId !== 'string' || claimId.length === 0) continue;
    map.set(claimId, {
      lexicalRank: normalizeRank(row.lexical_rank ?? row.lexicalRank),
      semanticRank: normalizeRank(row.semantic_rank ?? row.semanticRank),
      finalRank: normalizeRank(row.final_rank ?? row.finalRank),
      rrfScore: Number.isFinite(row.rrf_score ?? row.rrfScore)
        ? Number(row.rrf_score ?? row.rrfScore)
        : null,
      budgetRetained: (row.budget_retained ?? row.budgetRetained) !== false,
    });
  }
  return map;
}

function signalVotes(candidate, settings) {
  return Number(candidate.similarity >= settings.supportThreshold)
    + Number(candidate.lexicalRank !== null && candidate.lexicalRank <= settings.lexicalK)
    + Number(candidate.finalRank !== null && candidate.finalRank <= settings.fusedK);
}

function alignedTop(candidate) {
  return candidate.semanticRank === 1
    && candidate.lexicalRank === 1
    && candidate.finalRank === 1;
}

function decideV2(candidates, settings) {
  if (candidates.length === 0) return null;
  const top = candidates[0];
  const second = candidates[1] ?? null;
  if (!alignedTop(top)) return null;

  const margin = top.similarity - (second?.similarity ?? 0);
  if (
    top.similarity >= settings.positiveThreshold
    && margin >= settings.singleMarginThreshold
  ) {
    return {
      route: 'fast_v2',
      selected_ids: [top.claimId],
      decision: 'single_consensus',
      margin,
    };
  }

  if (top.similarity >= settings.positiveThreshold) return null;

  const selected = candidates
    .filter((candidate) => signalVotes(candidate, settings) >= settings.minVotes)
    .sort((left, right) => (left.finalRank - right.finalRank));
  if (selected.length < 2) return null;
  for (let index = 0; index < selected.length; index += 1) {
    if (selected[index].finalRank !== index + 1) return null;
  }
  return {
    route: 'fast_v2',
    selected_ids: selected.map((candidate) => candidate.claimId),
    decision: 'multi_consensus',
    margin,
  };
}

function normalizeSettings(options = {}) {
  const settings = {
    ...RECALL_FAST_PATH_DEFAULTS,
    ...options,
  };
  settings.negativeThreshold = probability(settings.negativeThreshold, 'negativeThreshold');
  settings.positiveThreshold = probability(settings.positiveThreshold, 'positiveThreshold');
  settings.supportThreshold = probability(settings.supportThreshold, 'supportThreshold');
  settings.singleMarginThreshold = probability(settings.singleMarginThreshold, 'singleMarginThreshold');
  settings.lexicalK = positiveInt(settings.lexicalK, 'lexicalK');
  settings.fusedK = positiveInt(settings.fusedK, 'fusedK');
  settings.minVotes = positiveInt(settings.minVotes, 'minVotes', 3);
  if (settings.negativeThreshold >= settings.positiveThreshold) {
    throw new RangeError('negativeThreshold must be less than positiveThreshold');
  }
  return Object.freeze(settings);
}

export function createRecallFastPathRuntime({
  embedder,
  settings = {},
  clockMs = Date.now,
} = {}) {
  if (!embedder || typeof embedder.embedQuery !== 'function' || typeof embedder.embedPassages !== 'function') {
    throw new TypeError('embedder must expose embedQuery() and embedPassages()');
  }
  if (typeof clockMs !== 'function') throw new TypeError('clockMs must be a function');
  const policy = normalizeSettings(settings);

  return {
    policyVersion: RECALL_FAST_PATH_POLICY_VERSION,
    settings: policy,
    async select({ query, items, retrievalTelemetry = null } = {}) {
      const startedAt = Number(clockMs());
      const normalizedQuery = nonEmpty(query, 'query');
      const allowedIds = validateItems(items);
      if (items.length === 0) {
        return {
          route: 'fast_v1',
          selected_ids: [],
          decision: 'negative',
          failed: false,
          policy_version: RECALL_FAST_PATH_POLICY_VERSION,
          duration_ms: 0,
          candidate_count: 0,
          selected_count: 0,
        };
      }

      try {
        const passages = items.map((item) => buildRecallCandidatePassage(item));
        if (passages.some((passage) => typeof passage !== 'string' || passage.length === 0)) {
          throw new Error('recall item produced an empty embedding passage');
        }
        const passageVectors = await embedder.embedPassages(passages);
        const queryVector = await embedder.embedQuery(normalizedQuery);
        if (!Array.isArray(passageVectors) || passageVectors.length !== items.length) {
          throw new Error('embedPassages must return one vector per recall item');
        }

        const scored = items.map((item, index) => ({
          claimId: item.claim.id,
          similarity: dot(queryVector, passageVectors[index]),
        })).sort((left, right) => (
          (right.similarity - left.similarity)
          || left.claimId.localeCompare(right.claimId)
        ));

        let diagnostics = null;
        try {
          diagnostics = buildRecallFastPathDiagnostics({
            scoredCandidates: scored,
            retrievalTelemetry,
            settings: policy,
          });
        } catch {
          // Calibration observability is fail-open and cannot alter selection.
          diagnostics = null;
        }

        const v1 = decideV1(scored, policy);
        if (v1.route === 'fast_v1') {
          const duration = Math.max(0, Number(clockMs()) - startedAt);
          return {
            ...v1,
            failed: false,
            policy_version: RECALL_FAST_PATH_POLICY_VERSION,
            duration_ms: Number.isFinite(duration) ? duration : 0,
            candidate_count: items.length,
            selected_count: v1.selected_ids.length,
            diagnostics,
          };
        }

        const ranks = retrievalCandidateMap(retrievalTelemetry);
        if (ranks.size === 0) {
          const duration = Math.max(0, Number(clockMs()) - startedAt);
          return {
            route: 'fallback', selected_ids: [], decision: 'missing_hybrid_telemetry',
            failed: false, policy_version: RECALL_FAST_PATH_POLICY_VERSION,
            duration_ms: Number.isFinite(duration) ? duration : 0,
            candidate_count: items.length, selected_count: 0,
            diagnostics,
          };
        }

        const hybrid = scored.map((candidate) => {
          const rank = ranks.get(candidate.claimId);
          if (!rank || rank.budgetRetained !== true) return null;
          return { ...candidate, ...rank };
        });
        if (hybrid.some((candidate) => candidate === null) || hybrid.length !== allowedIds.size) {
          const duration = Math.max(0, Number(clockMs()) - startedAt);
          return {
            route: 'fallback', selected_ids: [], decision: 'incomplete_hybrid_telemetry',
            failed: false, policy_version: RECALL_FAST_PATH_POLICY_VERSION,
            duration_ms: Number.isFinite(duration) ? duration : 0,
            candidate_count: items.length, selected_count: 0,
            diagnostics,
          };
        }

        const v2 = decideV2(hybrid, policy);
        const duration = Math.max(0, Number(clockMs()) - startedAt);
        if (v2 !== null) {
          return {
            ...v2,
            failed: false,
            policy_version: RECALL_FAST_PATH_POLICY_VERSION,
            duration_ms: Number.isFinite(duration) ? duration : 0,
            candidate_count: items.length,
            selected_count: v2.selected_ids.length,
            diagnostics,
          };
        }
        return {
          route: 'fallback', selected_ids: [], decision: 'ambiguous',
          failed: false, policy_version: RECALL_FAST_PATH_POLICY_VERSION,
          duration_ms: Number.isFinite(duration) ? duration : 0,
          candidate_count: items.length, selected_count: 0,
          diagnostics,
        };
      } catch (error) {
        const duration = Math.max(0, Number(clockMs()) - startedAt);
        return {
          route: 'fallback', selected_ids: [], decision: 'fast_path_failed',
          failed: true,
          error: error instanceof Error ? error.message : String(error),
          policy_version: RECALL_FAST_PATH_POLICY_VERSION,
          duration_ms: Number.isFinite(duration) ? duration : 0,
          candidate_count: items.length,
          selected_count: 0,
        };
      }
    },
  };
}
