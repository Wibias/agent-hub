import { selectRelevantRecallItems } from './recall-relevance-selector.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueIds(value, name) {
  if (!Array.isArray(value)) throw new TypeError(name + ' must be an array');
  const seen = new Set();
  const output = [];
  for (const id of value) {
    if (!nonEmpty(id)) throw new TypeError(name + ' entries must be non-empty strings');
    if (seen.has(id)) throw new Error(name + ' must not contain duplicates');
    seen.add(id);
    output.push(id);
  }
  return output;
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
    if (!nonEmpty(entry.id)) throw new TypeError('case ' + index + ' id must be non-empty');
    if (ids.has(entry.id)) throw new Error('case ids must be unique');
    ids.add(entry.id);
    if (!nonEmpty(entry.query)) throw new TypeError(entry.id + '.query must be non-empty');
    if (!Array.isArray(entry.items) || entry.items.length > 10) {
      throw new TypeError(entry.id + '.items must be an array with at most 10 entries');
    }
    const candidateIds = new Set();
    for (const item of entry.items) {
      const claimId = item?.claim?.id;
      if (!nonEmpty(claimId)) throw new TypeError(entry.id + ' item claim id must be non-empty');
      if (candidateIds.has(claimId)) throw new Error(entry.id + ' candidate ids must be unique');
      candidateIds.add(claimId);
    }
    const relevantClaimIds = uniqueIds(entry.relevantClaimIds, entry.id + '.relevantClaimIds');
    for (const id of relevantClaimIds) {
      if (!candidateIds.has(id)) {
        throw new Error(entry.id + ' relevant claim id is not present in candidates: ' + id);
      }
    }
    return {
      id: entry.id,
      query: entry.query,
      items: entry.items,
      relevantClaimIds,
    };
  });
}

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export async function evaluateRecallRelevanceCases(rawCases, {
  judge,
  maxSelected = 8,
  clockMs = Date.now,
} = {}) {
  if (typeof judge !== 'function') throw new TypeError('judge must be a function');
  if (typeof clockMs !== 'function') throw new TypeError('clockMs must be a function');
  const cases = validateCases(rawCases);

  let failures = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let exact = 0;
  let negativeCases = 0;
  let negativeFalsePositives = 0;
  let judgeCalls = 0;
  let durationMs = 0;
  let candidateCount = 0;
  let selectedCount = 0;
  const results = [];

  for (const entry of cases) {
    const selection = await selectRelevantRecallItems({
      query: entry.query,
      items: entry.items,
      judge,
      maxSelected,
      clockMs,
    });
    failures += selection.failed ? 1 : 0;
    judgeCalls += selection.telemetry.judge_called ? 1 : 0;
    durationMs += selection.telemetry.duration_ms;
    candidateCount += selection.telemetry.candidate_count;
    selectedCount += selection.telemetry.selected_count;

    const expected = new Set(entry.relevantClaimIds);
    const selected = new Set(selection.selected_ids);
    for (const id of selected) {
      if (expected.has(id)) tp += 1;
      else fp += 1;
    }
    for (const id of expected) {
      if (!selected.has(id)) fn += 1;
    }
    if (!selection.failed && sameSet(expected, selected)) exact += 1;
    if (expected.size === 0) {
      negativeCases += 1;
      if (!selection.failed && selected.size > 0) negativeFalsePositives += 1;
    }

    results.push({
      id: entry.id,
      failed: selection.failed,
      expected_ids: [...expected],
      selected_ids: selection.selected_ids,
      duration_ms: selection.telemetry.duration_ms,
      error: selection.error ?? null,
    });
  }

  return {
    counts: {
      cases: cases.length,
      failures,
      negative_cases: negativeCases,
    },
    quality: {
      true_positive: tp,
      false_positive: fp,
      false_negative: fn,
      precision: divide(tp, tp + fp),
      recall: divide(tp, tp + fn),
      exact_selection_rate: divide(exact, cases.length),
      negative_false_positive_rate: divide(negativeFalsePositives, negativeCases),
    },
    performance: {
      judge_calls: judgeCalls,
      duration_ms: durationMs,
      mean_duration_ms: divide(durationMs, judgeCalls),
      candidate_count: candidateCount,
      selected_count: selectedCount,
      mean_candidates: divide(candidateCount, cases.length),
      mean_selected: divide(selectedCount, cases.length),
    },
    results,
  };
}
