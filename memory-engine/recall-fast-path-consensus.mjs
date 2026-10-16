function finiteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(name + ' must be finite');
  return value;
}

function probability(value, name) {
  finiteNumber(value, name);
  if (value < 0 || value > 1) throw new RangeError(name + ' must be between 0 and 1');
  return value;
}

function positiveInt(value, name, max = 10) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(name + ' must be an integer between 1 and ' + max);
  }
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

function optionalRank(value, name) {
  if (value === null || value === undefined) return null;
  return positiveInt(value, name, 10_000);
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function validateCases(cases) {
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
      const prefix = id + '.candidates[' + candidateIndex + ']';
      const claimId = nonEmpty(candidate?.claimId, prefix + '.claimId');
      if (candidateIds.has(claimId)) throw new Error(id + ' candidate ids must be unique');
      candidateIds.add(claimId);
      return {
        claimId,
        similarity: finiteNumber(candidate.similarity, prefix + '.similarity'),
        lexicalRank: optionalRank(candidate.lexicalRank, prefix + '.lexicalRank'),
        semanticRank: optionalRank(candidate.semanticRank, prefix + '.semanticRank'),
        finalRank: positiveInt(candidate.finalRank, prefix + '.finalRank', 10_000),
        rrfScore: candidate.rrfScore === null || candidate.rrfScore === undefined
          ? null
          : finiteNumber(candidate.rrfScore, prefix + '.rrfScore'),
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

function validateBaselineCases(rawBaselineCases, cases) {
  if (!Array.isArray(rawBaselineCases) || rawBaselineCases.length !== cases.length) {
    throw new TypeError('baselineCases must contain exactly one entry per case');
  }
  const caseById = new Map(cases.map((entry) => [entry.id, entry]));
  const baselineById = new Map();
  for (let index = 0; index < rawBaselineCases.length; index += 1) {
    const entry = rawBaselineCases[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('baseline case ' + index + ' must be an object');
    }
    const id = nonEmpty(entry.id, 'baseline case ' + index + ' id');
    if (!caseById.has(id)) throw new Error('baseline case id is not present in hybrid cases: ' + id);
    if (baselineById.has(id)) throw new Error('baseline case ids must be unique');
    if (!['fast_negative', 'fast_positive', 'fallback'].includes(entry.route)) {
      throw new TypeError(id + '.route is not a supported baseline route');
    }
    const selectedIds = uniqueIds(entry.selected_ids, id + '.selected_ids');
    const candidateIds = new Set(caseById.get(id).candidates.map((candidate) => candidate.claimId));
    for (const claimId of selectedIds) {
      if (!candidateIds.has(claimId)) {
        throw new Error(id + ' baseline selected id missing from hybrid candidates: ' + claimId);
      }
    }
    if (entry.route === 'fallback' && selectedIds.length !== 0) {
      throw new Error(id + ' fallback baseline must not select claims');
    }
    baselineById.set(id, { id, route: entry.route, selected_ids: selectedIds });
  }
  if (baselineById.size !== caseById.size) {
    throw new Error('baselineCases must cover every hybrid case');
  }
  return baselineById;
}

function signalVotes(candidate, { supportThreshold, lexicalK, fusedK }) {
  return Number(candidate.similarity >= supportThreshold)
    + Number(candidate.lexicalRank !== null && candidate.lexicalRank <= lexicalK)
    + Number(candidate.finalRank <= fusedK);
}

function alignedTop(candidate) {
  return candidate.semanticRank === 1
    && candidate.lexicalRank === 1
    && candidate.finalRank === 1;
}

function consensusDecision(entry, options) {
  const top = entry.candidates[0];
  const second = entry.candidates[1] ?? null;
  if (!alignedTop(top)) return null;

  const margin = top.similarity - (second?.similarity ?? 0);
  if (
    top.similarity >= options.positiveThreshold
    && margin >= options.singleMarginThreshold
  ) {
    return {
      route: 'fast_single_consensus',
      selected_ids: [top.claimId],
      rescued: true,
      margin,
    };
  }

  if (top.similarity >= options.positiveThreshold) return null;

  const selected = entry.candidates
    .filter((candidate) => signalVotes(candidate, options) >= options.minVotes)
    .sort((left, right) => left.finalRank - right.finalRank);

  if (selected.length < 2) return null;
  for (let index = 0; index < selected.length; index += 1) {
    if (selected[index].finalRank !== index + 1) return null;
  }

  return {
    route: 'fast_multi_consensus',
    selected_ids: selected.map((candidate) => candidate.claimId),
    rescued: true,
    margin,
  };
}

export function evaluateRecallHybridFastPath(rawCases, {
  baselineCases,
  negativeThreshold,
  positiveThreshold,
  supportThreshold,
  singleMarginThreshold,
  lexicalK,
  fusedK,
  minVotes,
} = {}) {
  const cases = validateCases(rawCases);
  const baselineById = validateBaselineCases(baselineCases, cases);
  const options = {
    negativeThreshold: probability(negativeThreshold, 'negativeThreshold'),
    positiveThreshold: probability(positiveThreshold, 'positiveThreshold'),
    supportThreshold: probability(supportThreshold, 'supportThreshold'),
    singleMarginThreshold: probability(singleMarginThreshold, 'singleMarginThreshold'),
    lexicalK: positiveInt(lexicalK, 'lexicalK'),
    fusedK: positiveInt(fusedK, 'fusedK'),
    minVotes: positiveInt(minVotes, 'minVotes', 3),
  };
  if (options.negativeThreshold >= options.positiveThreshold) {
    throw new RangeError('negativeThreshold must be less than positiveThreshold');
  }

  let fastCases = 0;
  let fallbackCases = 0;
  let fastErrors = 0;
  let rescuedCases = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const results = [];

  for (const entry of cases) {
    const baseline = baselineById.get(entry.id);
    const baselinePreserved = baseline.route !== 'fallback';
    const decision = baselinePreserved
      ? { route: baseline.route, selected_ids: baseline.selected_ids, rescued: false }
      : (
          consensusDecision(entry, options)
          ?? { route: 'fallback', selected_ids: [], rescued: false }
        );
    const expected = new Set(entry.relevantClaimIds);
    const selected = new Set(decision.selected_ids);
    const isFallback = decision.route === 'fallback';
    const exact = !isFallback && sameSet(expected, selected);

    if (isFallback) {
      fallbackCases += 1;
    } else {
      fastCases += 1;
      if (decision.rescued) rescuedCases += 1;
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
      rescued: Boolean(decision.rescued),
      baseline_route: baseline.route,
      baseline_preserved: baselinePreserved,
      margin: decision.margin ?? null,
      candidates: entry.candidates.map((candidate) => ({
        ...candidate,
        signalVotes: signalVotes(candidate, options),
      })),
    });
  }

  return {
    settings: {
      negative_threshold: options.negativeThreshold,
      positive_threshold: options.positiveThreshold,
      support_threshold: options.supportThreshold,
      single_margin_threshold: options.singleMarginThreshold,
      lexical_k: options.lexicalK,
      fused_k: options.fusedK,
      min_votes: options.minVotes,
    },
    fast_cases: fastCases,
    fallback_cases: fallbackCases,
    rescued_cases: rescuedCases,
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

function uniqueProbabilities(values, name) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(name + ' must be a non-empty array');
  }
  return [...new Set(values.map((value, index) => probability(value, name + '[' + index + ']')))]
    .sort((left, right) => left - right);
}

function uniqueInts(values, name, max = 10) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(name + ' must be a non-empty array');
  }
  return [...new Set(values.map((value) => positiveInt(value, name, max)))]
    .sort((left, right) => left - right);
}

function compare(left, right) {
  const leftSafe = left.fast_errors === 0 ? 1 : 0;
  const rightSafe = right.fast_errors === 0 ? 1 : 0;
  if (leftSafe !== rightSafe) return rightSafe - leftSafe;
  if (left.fast_errors !== right.fast_errors) return left.fast_errors - right.fast_errors;
  if (left.fast_cases !== right.fast_cases) return right.fast_cases - left.fast_cases;
  if (left.rescued_cases !== right.rescued_cases) return right.rescued_cases - left.rescued_cases;
  if (left.settings.min_votes !== right.settings.min_votes) return right.settings.min_votes - left.settings.min_votes;
  if (left.settings.lexical_k !== right.settings.lexical_k) return left.settings.lexical_k - right.settings.lexical_k;
  if (left.settings.fused_k !== right.settings.fused_k) return left.settings.fused_k - right.settings.fused_k;
  if (left.settings.support_threshold !== right.settings.support_threshold) {
    return right.settings.support_threshold - left.settings.support_threshold;
  }
  return right.settings.single_margin_threshold - left.settings.single_margin_threshold;
}

export function calibrateRecallHybridFastPath(rawCases, {
  baselineCases,
  negativeThreshold,
  positiveThreshold,
  supportThresholds,
  singleMarginThresholds,
  lexicalKs,
  fusedKs,
  minVotesValues,
} = {}) {
  const cases = validateCases(rawCases);
  const normalizedBaselineCases = [...validateBaselineCases(baselineCases, cases).values()];
  const supports = uniqueProbabilities(supportThresholds, 'supportThresholds');
  const margins = uniqueProbabilities(singleMarginThresholds, 'singleMarginThresholds');
  const lexical = uniqueInts(lexicalKs, 'lexicalKs');
  const fused = uniqueInts(fusedKs, 'fusedKs');
  const votes = uniqueInts(minVotesValues, 'minVotesValues', 3);

  const evaluations = [];
  for (const supportThreshold of supports) {
    for (const singleMarginThreshold of margins) {
      for (const lexicalK of lexical) {
        for (const fusedK of fused) {
          for (const minVotes of votes) {
            evaluations.push(evaluateRecallHybridFastPath(cases, {
              baselineCases: normalizedBaselineCases,
              negativeThreshold,
              positiveThreshold,
              supportThreshold,
              singleMarginThreshold,
              lexicalK,
              fusedK,
              minVotes,
            }));
          }
        }
      }
    }
  }
  evaluations.sort(compare);
  return {
    recommended: evaluations[0],
    sweep: {
      tested_configurations: evaluations.length,
      zero_error_configurations: evaluations.filter((entry) => entry.fast_errors === 0).length,
      support_thresholds: supports,
      single_margin_thresholds: margins,
      lexical_ks: lexical,
      fused_ks: fused,
      min_votes_values: votes,
    },
  };
}
