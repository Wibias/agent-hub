function finiteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(name + ' must be finite');
  return value;
}

function probability(value, name) {
  finiteNumber(value, name);
  if (value < 0 || value > 1) throw new RangeError(name + ' must be between 0 and 1');
  return value;
}

function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

function uniqueIds(value, name) {
  if (!Array.isArray(value)) throw new TypeError(name + ' must be an array');
  const seen = new Set();
  const output = [];
  for (const raw of value) {
    const id = nonEmpty(raw, name + ' entry');
    if (seen.has(id)) throw new Error(name + ' must not contain duplicates');
    seen.add(id);
    output.push(id);
  }
  return output;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function validateScoredCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new TypeError('cases must be a non-empty array');
  }
  const ids = new Set();
  return cases.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('case ' + index + ' must be an object');
    }
    const id = nonEmpty(entry.id, 'case ' + index + ' id');
    if (ids.has(id)) throw new Error('case ids must be unique');
    ids.add(id);
    const relevantClaimIds = uniqueIds(entry.relevantClaimIds, id + '.relevantClaimIds');
    if (!Array.isArray(entry.candidates) || entry.candidates.length === 0) {
      throw new TypeError(id + '.candidates must be a non-empty array');
    }
    const candidateIds = new Set();
    const candidates = entry.candidates.map((candidate, candidateIndex) => {
      const claimId = nonEmpty(candidate?.claimId, id + '.candidates[' + candidateIndex + '].claimId');
      if (candidateIds.has(claimId)) throw new Error(id + ' candidate ids must be unique');
      candidateIds.add(claimId);
      return {
        claimId,
        similarity: finiteNumber(candidate.similarity, id + '.candidates[' + candidateIndex + '].similarity'),
      };
    }).sort((left, right) => (
      (right.similarity - left.similarity)
      || left.claimId.localeCompare(right.claimId)
    ));
    for (const claimId of relevantClaimIds) {
      if (!candidateIds.has(claimId)) {
        throw new Error(id + ' relevant claim id missing from candidates: ' + claimId);
      }
    }
    return { id, relevantClaimIds, candidates };
  });
}

function decideCase(entry, { negativeThreshold, positiveThreshold }) {
  const high = entry.candidates.filter((candidate) => candidate.similarity >= positiveThreshold);
  const ambiguous = entry.candidates.filter((candidate) => (
    candidate.similarity >= negativeThreshold
    && candidate.similarity < positiveThreshold
  ));

  if (high.length === 0) {
    if (ambiguous.length === 0) {
      return { route: 'fast_negative', selected_ids: [] };
    }
    return { route: 'fallback', selected_ids: [] };
  }

  if (ambiguous.length > 0) {
    return { route: 'fallback', selected_ids: [] };
  }

  return {
    route: 'fast_positive',
    selected_ids: high.map((candidate) => candidate.claimId),
  };
}

export function evaluateRecallFastPath(rawCases, {
  negativeThreshold,
  positiveThreshold,
} = {}) {
  const cases = validateScoredCases(rawCases);
  const negative = probability(negativeThreshold, 'negativeThreshold');
  const positive = probability(positiveThreshold, 'positiveThreshold');
  if (negative >= positive) {
    throw new RangeError('negativeThreshold must be less than positiveThreshold');
  }

  let fastCases = 0;
  let fallbackCases = 0;
  let fastErrors = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const results = [];

  for (const entry of cases) {
    const decision = decideCase(entry, {
      negativeThreshold: negative,
      positiveThreshold: positive,
    });
    const expected = new Set(entry.relevantClaimIds);
    const selected = new Set(decision.selected_ids);
    const isFallback = decision.route === 'fallback';
    const exact = !isFallback && sameSet(expected, selected);

    if (isFallback) {
      fallbackCases += 1;
    } else {
      fastCases += 1;
      if (!exact) fastErrors += 1;
      for (const id of selected) {
        if (expected.has(id)) truePositive += 1;
        else falsePositive += 1;
      }
      for (const id of expected) {
        if (!selected.has(id)) falseNegative += 1;
      }
    }

    results.push({
      id: entry.id,
      route: decision.route,
      expected_ids: entry.relevantClaimIds,
      selected_ids: decision.selected_ids,
      exact,
      candidates: entry.candidates,
    });
  }

  return {
    negative_threshold: negative,
    positive_threshold: positive,
    fast_cases: fastCases,
    fallback_cases: fallbackCases,
    fast_errors: fastErrors,
    coverage: fastCases / cases.length,
    fallback_rate: fallbackCases / cases.length,
    fast_exact_rate: fastCases === 0 ? 0 : (fastCases - fastErrors) / fastCases,
    fast_quality: {
      true_positive: truePositive,
      false_positive: falsePositive,
      false_negative: falseNegative,
      precision: truePositive + falsePositive === 0 ? 1 : truePositive / (truePositive + falsePositive),
      recall: truePositive + falseNegative === 0 ? 1 : truePositive / (truePositive + falseNegative),
    },
    cases: results,
  };
}

function compareRecommendations(left, right) {
  const leftSafe = left.fast_errors === 0 ? 1 : 0;
  const rightSafe = right.fast_errors === 0 ? 1 : 0;
  if (leftSafe !== rightSafe) return rightSafe - leftSafe;
  if (left.fast_errors !== right.fast_errors) return left.fast_errors - right.fast_errors;
  if (left.fast_cases !== right.fast_cases) return right.fast_cases - left.fast_cases;
  const leftMargin = left.positive_threshold - left.negative_threshold;
  const rightMargin = right.positive_threshold - right.negative_threshold;
  if (leftMargin !== rightMargin) return rightMargin - leftMargin;
  if (left.positive_threshold !== right.positive_threshold) {
    return right.positive_threshold - left.positive_threshold;
  }
  return left.negative_threshold - right.negative_threshold;
}

export function calibrateRecallFastPath(rawCases, { thresholds } = {}) {
  const cases = validateScoredCases(rawCases);
  if (!Array.isArray(thresholds) || thresholds.length < 2) {
    throw new TypeError('thresholds must contain at least two values');
  }
  const normalized = [...new Set(thresholds.map((value, index) => (
    probability(value, 'thresholds[' + index + ']')
  )))].sort((a, b) => a - b);
  if (normalized.length < 2) throw new TypeError('thresholds must contain at least two unique values');

  const evaluations = [];
  for (let lowIndex = 0; lowIndex < normalized.length - 1; lowIndex += 1) {
    for (let highIndex = lowIndex + 1; highIndex < normalized.length; highIndex += 1) {
      evaluations.push(evaluateRecallFastPath(cases, {
        negativeThreshold: normalized[lowIndex],
        positiveThreshold: normalized[highIndex],
      }));
    }
  }
  evaluations.sort(compareRecommendations);
  const recommended = evaluations[0];

  return {
    recommended,
    sweep: {
      thresholds: normalized,
      tested_pairs: evaluations.length,
      zero_error_pairs: evaluations.filter((entry) => entry.fast_errors === 0).length,
    },
  };
}

export function buildRecallCandidatePassage(item) {
  const claim = item?.claim ?? {};
  return [
    'passage:',
    claim.kind,
    claim.subject,
    claim.predicate,
    claim.value ?? claim.value_text,
  ].filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .join(' ');
}

function dot(left, right) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
    throw new TypeError('embedding vectors must be Float32Array');
  }
  if (left.length !== right.length || left.length === 0) {
    throw new RangeError('embedding vector dimensions must match and be non-empty');
  }
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export async function scoreRecallCasesWithEmbedder(rawCases, { embedder } = {}) {
  if (!embedder || typeof embedder.embedQuery !== 'function' || typeof embedder.embedPassages !== 'function') {
    throw new TypeError('embedder must provide embedQuery() and embedPassages()');
  }
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new TypeError('cases must be a non-empty array');
  }

  const candidates = new Map();
  for (const entry of rawCases) {
    if (!Array.isArray(entry?.items) || entry.items.length === 0) {
      throw new TypeError((entry?.id ?? 'case') + '.items must be a non-empty array');
    }
    for (const item of entry.items) {
      const claimId = nonEmpty(item?.claim?.id, 'candidate claim id');
      const passage = buildRecallCandidatePassage(item);
      nonEmpty(passage, 'candidate passage');
      const existing = candidates.get(claimId);
      if (existing && existing.passage !== passage) {
        throw new Error('candidate claim differs across cases: ' + claimId);
      }
      candidates.set(claimId, { claimId, passage });
    }
  }

  const candidateList = [...candidates.values()].sort((a, b) => a.claimId.localeCompare(b.claimId));
  const vectors = await embedder.embedPassages(candidateList.map((entry) => entry.passage));
  if (!Array.isArray(vectors) || vectors.length !== candidateList.length) {
    throw new Error('embedPassages must return one vector per unique candidate');
  }
  const vectorById = new Map(candidateList.map((entry, index) => [entry.claimId, vectors[index]]));

  const scored = [];
  for (const entry of rawCases) {
    const id = nonEmpty(entry?.id, 'case id');
    const query = nonEmpty(entry?.query, id + '.query');
    const relevantClaimIds = uniqueIds(entry?.relevantClaimIds, id + '.relevantClaimIds');
    const queryVector = await embedder.embedQuery(query);
    const caseCandidates = entry.items.map((item) => {
      const claimId = nonEmpty(item?.claim?.id, id + ' candidate claim id');
      return {
        claimId,
        similarity: dot(queryVector, vectorById.get(claimId)),
      };
    }).sort((left, right) => (
      (right.similarity - left.similarity)
      || left.claimId.localeCompare(right.claimId)
    ));
    scored.push({ id, relevantClaimIds, candidates: caseCandidates });
  }
  return scored;
}
