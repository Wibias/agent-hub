export const RECALL_FAST_PATH_DIAGNOSTICS_SCHEMA_VERSION = 1;

function finiteOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function rankOrNull(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function telemetryRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['candidates', 'items', 'results', 'rows']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function rowClaimId(row) {
  for (const value of [row?.claim_id, row?.claimId, row?.id, row?.claim?.id]) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function retrievalMap(retrievalTelemetry) {
  const map = new Map();
  for (const row of telemetryRows(retrievalTelemetry)) {
    const claimId = rowClaimId(row);
    if (claimId === null || map.has(claimId)) continue;
    map.set(claimId, {
      semantic_rank: rankOrNull(row?.semantic_rank ?? row?.semanticRank),
      lexical_rank: rankOrNull(row?.lexical_rank ?? row?.lexicalRank),
      final_rank: rankOrNull(row?.final_rank ?? row?.finalRank),
      rrf_score: finiteOrNull(row?.rrf_score ?? row?.rrfScore),
      budget_retained: (row?.budget_retained ?? row?.budgetRetained) !== false,
    });
  }
  return map;
}

function signalVotes(candidate, settings) {
  if (!candidate) return null;
  const support = Number(candidate.similarity >= settings.supportThreshold);
  const lexical = Number(
    candidate.lexical_rank !== null
    && candidate.lexical_rank <= settings.lexicalK
  );
  const fused = Number(
    candidate.final_rank !== null
    && candidate.final_rank <= settings.fusedK
  );
  return support + lexical + fused;
}

export function buildRecallFastPathDiagnostics({
  scoredCandidates,
  retrievalTelemetry = null,
  settings,
} = {}) {
  if (!Array.isArray(scoredCandidates)) {
    throw new TypeError('scoredCandidates must be an array');
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('settings must be an object');
  }

  const ranks = retrievalMap(retrievalTelemetry);
  const candidates = scoredCandidates.map((candidate) => {
    const claimId = typeof candidate?.claimId === 'string'
      ? candidate.claimId.trim()
      : '';
    if (!claimId || !Number.isFinite(candidate?.similarity)) {
      throw new TypeError('scored candidates require claimId and finite similarity');
    }
    const rank = ranks.get(claimId) ?? {
      semantic_rank: null,
      lexical_rank: null,
      final_rank: null,
      rrf_score: null,
      budget_retained: null,
    };
    const output = {
      claim_id: claimId,
      similarity: Number(candidate.similarity),
      semantic_rank: rank.semantic_rank,
      lexical_rank: rank.lexical_rank,
      final_rank: rank.final_rank,
      rrf_score: rank.rrf_score,
      budget_retained: rank.budget_retained,
      signal_votes: null,
    };
    output.signal_votes = signalVotes(output, settings);
    return output;
  });

  return {
    schema_version: RECALL_FAST_PATH_DIAGNOSTICS_SCHEMA_VERSION,
    thresholds: {
      negative_threshold: settings.negativeThreshold,
      positive_threshold: settings.positiveThreshold,
      support_threshold: settings.supportThreshold,
      single_margin_threshold: settings.singleMarginThreshold,
      lexical_k: settings.lexicalK,
      fused_k: settings.fusedK,
      min_votes: settings.minVotes,
    },
    candidates,
    top_margin: candidates.length >= 2
      ? candidates[0].similarity - candidates[1].similarity
      : null,
  };
}
