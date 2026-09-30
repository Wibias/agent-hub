function finiteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function probability(value) {
  return Number.isFinite(value) ? value : 0;
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function distribution(values) {
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
    };
  }

  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: mean(values),
    median: median(values),
  };
}

function uniqueStrings(values, name) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${name} must be an array`);
  }
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`${name} entries must be non-empty strings`);
    }
    if (seen.has(value)) {
      throw new Error(`${name} must not contain duplicates`);
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function validateRanking(ranking, name) {
  return uniqueStrings(ranking, name);
}

function validateSemanticCandidates(candidates, caseId) {
  if (!Array.isArray(candidates)) {
    throw new TypeError(`${caseId}.semanticCandidates must be an array`);
  }

  const seen = new Set();
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new TypeError(
        `${caseId}.semanticCandidates[${index}] must be an object`,
      );
    }
    const claimId = candidate.claimId;
    if (typeof claimId !== 'string' || claimId.length === 0) {
      throw new TypeError(
        `${caseId}.semanticCandidates[${index}].claimId must be non-empty`,
      );
    }
    if (seen.has(claimId)) {
      throw new Error(`${caseId}.semanticCandidates must not contain duplicates`);
    }
    seen.add(claimId);
    const similarity = finiteNumber(
      candidate.similarity,
      `${caseId}.semanticCandidates[${index}].similarity`,
    );
    return { claimId, similarity };
  });
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new TypeError('recall quality cases must be a non-empty array');
  }

  const ids = new Set();
  return cases.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError(`case ${index} must be an object`);
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new TypeError(`case ${index} id must be a non-empty string`);
    }
    if (ids.has(entry.id)) {
      throw new Error('case ids must be unique');
    }
    ids.add(entry.id);

    if (!entry.rankings || typeof entry.rankings !== 'object') {
      throw new TypeError(`${entry.id}.rankings must be an object`);
    }

    const rankings = {};
    for (const route of ['lexical', 'semantic', 'fused']) {
      if (!(route in entry.rankings)) {
        throw new TypeError(`${entry.id}.rankings.${route} is required`);
      }
      rankings[route] = validateRanking(
        entry.rankings[route],
        `${entry.id}.rankings.${route}`,
      );
    }

    return {
      id: entry.id,
      relevantClaimIds: uniqueStrings(
        entry.relevantClaimIds,
        `${entry.id}.relevantClaimIds`,
      ),
      rankings,
      semanticCandidates: validateSemanticCandidates(
        entry.semanticCandidates,
        entry.id,
      ),
    };
  });
}

function validateKValues(kValues) {
  if (!Array.isArray(kValues) || kValues.length === 0) {
    throw new TypeError('kValues must be a non-empty array');
  }
  const seen = new Set();
  return kValues.map((value) => {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError('kValues entries must be positive integers');
    }
    if (seen.has(value)) {
      throw new Error('kValues must not contain duplicates');
    }
    seen.add(value);
    return value;
  });
}

function firstRelevantRank(ranking, relevant) {
  if (relevant.size === 0) return null;
  for (let index = 0; index < ranking.length; index += 1) {
    if (relevant.has(ranking[index])) return index + 1;
  }
  return null;
}

function summarizeRoute(cases, route, kValues) {
  const positive = cases.filter((entry) => entry.relevantClaimIds.length > 0);
  const negative = cases.filter((entry) => entry.relevantClaimIds.length === 0);

  const ranks = positive.map((entry) => firstRelevantRank(
    entry.rankings[route],
    new Set(entry.relevantClaimIds),
  ));

  const hitRateAtK = {};
  const falseNegativeRateAtK = {};
  for (const k of kValues) {
    const hits = ranks.filter((rank) => rank !== null && rank <= k).length;
    const hitRate = positive.length === 0 ? 0 : hits / positive.length;
    hitRateAtK[k] = hitRate;
    falseNegativeRateAtK[k] = 1 - hitRate;
  }

  const reciprocalRanks = ranks.map((rank) => (
    rank === null ? 0 : 1 / rank
  ));

  return {
    hitRateAtK,
    falseNegativeRateAtK,
    meanReciprocalRank: probability(mean(reciprocalRanks)),
    negativeNonEmptyRate: negative.length === 0
      ? 0
      : negative.filter((entry) => entry.rankings[route].length > 0).length
        / negative.length,
  };
}

function relevantSemanticScores(cases) {
  const scores = [];
  for (const entry of cases) {
    if (entry.relevantClaimIds.length === 0) continue;
    const relevant = new Set(entry.relevantClaimIds);
    for (const candidate of entry.semanticCandidates) {
      if (relevant.has(candidate.claimId)) scores.push(candidate.similarity);
    }
  }
  return scores;
}

function negativeTop1Scores(cases) {
  const scores = [];
  for (const entry of cases) {
    if (entry.relevantClaimIds.length !== 0) continue;
    if (entry.semanticCandidates.length === 0) continue;
    scores.push(entry.semanticCandidates[0].similarity);
  }
  return scores;
}

export function summarizeRecallQuality(rawCases, {
  kValues = [1, 5, 10],
} = {}) {
  const cases = validateCases(rawCases);
  const ks = validateKValues(kValues);
  const positiveQueries = cases.filter(
    (entry) => entry.relevantClaimIds.length > 0,
  ).length;
  const negativeQueries = cases.length - positiveQueries;

  return {
    counts: {
      queries: cases.length,
      positiveQueries,
      negativeQueries,
    },
    routes: {
      lexical: summarizeRoute(cases, 'lexical', ks),
      semantic: summarizeRoute(cases, 'semantic', ks),
      fused: summarizeRoute(cases, 'fused', ks),
    },
    semanticSimilarity: {
      positiveRelevant: distribution(relevantSemanticScores(cases)),
      negativeTop1: distribution(negativeTop1Scores(cases)),
    },
  };
}

function validateThresholds(thresholds) {
  if (!Array.isArray(thresholds) || thresholds.length === 0) {
    throw new TypeError('thresholds must be a non-empty array');
  }

  let previous = Number.NEGATIVE_INFINITY;
  return thresholds.map((threshold) => {
    finiteNumber(threshold, 'threshold');
    if (threshold <= previous) {
      throw new Error('thresholds must be strictly increasing and unique');
    }
    previous = threshold;
    return threshold;
  });
}

function relevantPassesThreshold(entry, threshold, k) {
  const relevant = new Set(entry.relevantClaimIds);
  return entry.semanticCandidates
    .slice(0, k)
    .some((candidate) => (
      candidate.similarity >= threshold
      && relevant.has(candidate.claimId)
    ));
}

function anyPassesThreshold(entry, threshold, k) {
  return entry.semanticCandidates
    .slice(0, k)
    .some((candidate) => candidate.similarity >= threshold);
}

export function sweepSemanticThresholds(rawCases, {
  thresholds,
  k = 5,
} = {}) {
  const cases = validateCases(rawCases);
  const normalizedThresholds = validateThresholds(thresholds);
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError('k must be a positive integer');
  }

  const positive = cases.filter((entry) => entry.relevantClaimIds.length > 0);
  const negative = cases.filter((entry) => entry.relevantClaimIds.length === 0);

  return normalizedThresholds.map((threshold) => {
    const truePositiveQueries = positive.filter(
      (entry) => relevantPassesThreshold(entry, threshold, k),
    ).length;
    const falseNegativeQueries = positive.length - truePositiveQueries;
    const falsePositiveQueries = negative.filter(
      (entry) => anyPassesThreshold(entry, threshold, k),
    ).length;
    const trueNegativeQueries = negative.length - falsePositiveQueries;

    const precisionDenominator = truePositiveQueries + falsePositiveQueries;
    const precision = precisionDenominator === 0
      ? 0
      : truePositiveQueries / precisionDenominator;
    const recall = positive.length === 0
      ? 0
      : truePositiveQueries / positive.length;
    const f1 = precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

    return {
      threshold,
      truePositiveQueries,
      falsePositiveQueries,
      falseNegativeQueries,
      trueNegativeQueries,
      precision,
      recall,
      f1,
      positiveHitRate: recall,
      negativeSuppressionRate: negative.length === 0
        ? 0
        : trueNegativeQueries / negative.length,
    };
  });
}
