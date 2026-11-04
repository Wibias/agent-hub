/**
 * D3: bounded, explicit, in-process semantic relation shadow evaluation.
 * This module never persists or changes memory. The caller supplies a judge;
 * no provider is initialized or called unless the caller explicitly does so.
 * Ground truth labels are complete for each bounded source/target set.
 */
import { createHash } from 'node:crypto';
import { evaluateSemanticRelationsShadow, SEMANTIC_RELATION_POLICY_VERSION } from './semantic-relation-judge.mjs';

export const SEMANTIC_SHADOW_REPORT_VERSION = 'semantic-relation-shadow-v1';
export const MAX_SHADOW_CASES = 64;
const RELATION_TYPES = new Set(['supports', 'depends_on', 'implements', 'related_to']);
const MAX_TARGETS = 12;
const MAX_EDGES = 3;

class ShadowProviderFailure extends Error {}
class ShadowResponseFailure extends Error {}

function string(value, name, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${name} must be nonempty text of at most ${max} chars`);
  }
  return value;
}

function edgeKey(relation, source, target) {
  const pair = relation === 'related_to' && source > target ? [target, source] : [source, target];
  return JSON.stringify([relation, ...pair]);
}

function labels(caseSpec) {
  if (!Array.isArray(caseSpec.expectedRelations) || caseSpec.expectedRelations.length > MAX_EDGES) {
    throw new TypeError(`expectedRelations must contain at most ${MAX_EDGES} complete labels`);
  }
  const targets = new Set(caseSpec.targetClaimIds);
  const seen = new Set();
  return caseSpec.expectedRelations.map((item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object'
      || Object.keys(item).some((k) => !['relation', 'targetClaimId'].includes(k))) {
      throw new TypeError('expected relation has invalid fields');
    }
    if (!RELATION_TYPES.has(item.relation) || !targets.has(item.targetClaimId)) {
      throw new TypeError('expected relation must use a bounded target and supported type');
    }
    const key = edgeKey(item.relation, caseSpec.sourceClaimId, item.targetClaimId);
    if (seen.has(key)) throw new TypeError('duplicate expected relation');
    seen.add(key);
    return Object.freeze({ relation: item.relation, sourceClaimId: caseSpec.sourceClaimId,
      targetClaimId: item.targetClaimId, key });
  });
}

function prepare(cases) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > MAX_SHADOW_CASES) {
    throw new TypeError(`cases must contain 1 to ${MAX_SHADOW_CASES} entries`);
  }
  const seen = new Set();
  return cases.map((item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') throw new TypeError('case must be an object');
    const id = string(item.id, 'case.id', 128);
    if (seen.has(id)) throw new TypeError('duplicate case id');
    seen.add(id);
    for (const key of ['projectId', 'branch', 'sourceClaimId']) string(item[key], key);
    if (!Array.isArray(item.targetClaimIds) || item.targetClaimIds.length > MAX_TARGETS) {
      throw new TypeError(`targetClaimIds must contain 0 to ${MAX_TARGETS} targets`);
    }
    for (const target of item.targetClaimIds) string(target, 'targetClaimId');
    if (new Set([item.sourceClaimId, ...item.targetClaimIds]).size !== item.targetClaimIds.length + 1) {
      throw new TypeError('duplicate or self target');
    }
    if (!item.memory || typeof item.memory.exportCanonical !== 'function') {
      throw new TypeError('memory must provide exportCanonical');
    }
    if (item.at !== undefined && (!Number.isFinite(Date.parse(item.at)) || typeof item.at !== 'string')) {
      throw new TypeError('case at must be a date');
    }
    return { ...item, expected: labels(item) };
  });
}

function parseUsage(usage) {
  if (usage == null) return null;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw new TypeError('usage must be an object');
  const keys = Object.keys(usage);
  if (keys.some((key) => !['input_tokens', 'output_tokens', 'total_tokens'].includes(key))) {
    throw new TypeError('usage contains unexpected keys');
  }
  const parsed = {};
  for (const [key, val] of Object.entries(usage)) {
    if (!Number.isSafeInteger(val) || val < 0) throw new TypeError('usage tokens must be nonnegative integers');
    parsed[key] = val;
  }
  if (Object.hasOwn(parsed, 'input_tokens') && Object.hasOwn(parsed, 'output_tokens')) {
    const derived = parsed.input_tokens + parsed.output_tokens;
    if (!Number.isSafeInteger(derived)) throw new TypeError('usage total overflow');
    if (Object.hasOwn(parsed, 'total_tokens') && parsed.total_tokens !== derived) {
      throw new TypeError('inconsistent usage total');
    }
    parsed.total_tokens = derived;
  }
  if (keys.length === 0) throw new TypeError('usage must contain at least one token field');
  // A partial report must not claim fewer total tokens than an observed component.
  if (Object.hasOwn(parsed, 'total_tokens') && (
    (Object.hasOwn(parsed, 'input_tokens') && parsed.total_tokens < parsed.input_tokens)
    || (Object.hasOwn(parsed, 'output_tokens') && parsed.total_tokens < parsed.output_tokens)
  )) throw new TypeError('inconsistent partial token usage');
  return parsed;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function latencyMs(start, end) {
  const difference = end - start;
  return Number.isFinite(difference) ? Math.max(0, difference) : null;
}

/**
 * Evaluate complete human-labelled cases against one injected judge.
 * Invalid labels fail preflight before any judge call. Malformed provider output
 * is a failed case, never a counted true negative or a persisted relation.
 * Errors are classified without exposing exception text or raw claims.
 */
export async function evaluateSemanticRelationShadowCases({
  cases,
  judge,
  clockMs = () => performance.now(),
  apply = false,
} = {}) {
  if (apply !== false) throw new Error('semantic shadow evaluation is read-only');
  if (typeof judge !== 'function') throw new TypeError('judge function is required');
  if (typeof clockMs !== 'function') throw new TypeError('clockMs must be a function');
  const prepared = prepare(cases);
  const rows = [];
  const usageTotals = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const usageFieldCases = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let usageReportedCases = 0;
  let latencyKnownCases = 0;
  let latencyTotalMs = 0;
  let tp = 0; let fp = 0; let fn = 0;
  let scored = 0; let failed = 0; let predictedCases = 0; let correctNegatives = 0;
  let negativeCases = 0; let negativeFalseCases = 0; let positiveCases = 0;
  let judgeCalls = 0;
  let judgeFailures = 0; let invalidResponses = 0; let invalidContexts = 0;

  for (const entry of prepared) {
    const start = clockMs();
    const expected = entry.expected;
    const isNegative = expected.length === 0;
    let usage = null;
    let called = false;
    let outcome;
    try {
      const result = await evaluateSemanticRelationsShadow({
        memory: entry.memory, projectId: entry.projectId, branch: entry.branch,
        sourceClaimId: entry.sourceClaimId, targetClaimIds: entry.targetClaimIds,
        at: entry.at, apply: false,
        judge: async (request) => {
          called = true;
          let response;
          try {
            response = await judge({ ...request, caseId: entry.id });
          } catch {
            throw new ShadowProviderFailure('injected judge failed');
          }
          if (typeof response === 'string') return response;
          if (!response || Array.isArray(response) || typeof response !== 'object'
            || Object.keys(response).some((key) => !['text', 'usage'].includes(key))) {
            throw new ShadowResponseFailure('judge response has invalid shape');
          }
          try { usage = parseUsage(response.usage); } catch {
            throw new ShadowResponseFailure('invalid judge usage telemetry');
          }
          return response.text;
        },
      });
      const predicted = result.relations.map((relation) => {
        const record = { relation: relation.relation, sourceClaimId: entry.sourceClaimId,
          targetClaimId: relation.target_claim_id };
        return { ...record, key: edgeKey(record.relation, record.sourceClaimId, record.targetClaimId) };
      });
      const expectedKeys = new Set(expected.map((edge) => edge.key));
      const predictedKeys = new Set(predicted.map((edge) => edge.key));
      const correct = predicted.filter((edge) => expectedKeys.has(edge.key)).length;
      const falseEdges = predicted.filter((edge) => !expectedKeys.has(edge.key));
      const missingEdges = expected.filter((edge) => !predictedKeys.has(edge.key));
      tp += correct;
      fp += falseEdges.length;
      fn += missingEdges.length;
      scored += 1;
      if (predicted.length > 0) predictedCases += 1;
      if (isNegative) {
        negativeCases += 1;
        if (predicted.length) negativeFalseCases += 1;
        else correctNegatives += 1;
      } else positiveCases += 1;
      outcome = {
        id: entry.id, status: 'scored', predictedCount: predicted.length, expectedCount: expected.length,
        truePositive: correct, falsePositive: falseEdges.length, falseNegative: missingEdges.length,
        falseEdges: falseEdges.map(({ key, ...safe }) => safe),
        missingEdges: missingEdges.map(({ key, ...safe }) => safe),
      };
    } catch (error) {
      failed += 1;
      const failureKind = error instanceof ShadowProviderFailure ? 'judge_error'
        : !called ? 'invalid_context' : 'invalid_response';
      if (failureKind === 'judge_error') judgeFailures += 1;
      else if (failureKind === 'invalid_context') invalidContexts += 1;
      else invalidResponses += 1;
      outcome = { id: entry.id, status: 'failed', failureKind,
        predictedCount: null, expectedCount: expected.length,
        truePositive: null, falsePositive: null, falseNegative: null,
        falseEdges: [], missingEdges: [] };
    }
    if (called) judgeCalls += 1;
    // Count token usage even if the returned model text failed validation.
    // Failed inference still incurs cost, but never improves accuracy scores.
    if (usage !== null) {
      usageReportedCases += 1;
      for (const key of Object.keys(usageTotals)) {
        if (Object.hasOwn(usage, key)) {
          usageTotals[key] += usage[key];
          usageFieldCases[key] += 1;
        }
      }
    }
    const ms = latencyMs(start, clockMs());
    if (ms !== null) { latencyTotalMs += ms; latencyKnownCases += 1; }
    rows.push({ ...outcome, latencyMs: ms, judgeCalled: called });
  }

  return {
    format: SEMANTIC_SHADOW_REPORT_VERSION,
    mode: 'shadow',
    policyVersion: SEMANTIC_RELATION_POLICY_VERSION,
    complete: failed === 0,
    counts: {
      cases: prepared.length, scored, failed, judgeCalls, judgeFailures, invalidResponses, invalidContexts,
      positiveCases, negativeCases, predictedCases,
      truePositiveEdges: tp, falseEdges: fp, missingEdges: fn,
      correctNegatives, negativeFalseCases,
    },
    metrics: {
      precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
      coverage: ratio(predictedCases, scored),
      negativeCaseFalsePositiveRate: ratio(negativeFalseCases, negativeCases),
      caseFailureRate: ratio(failed, prepared.length),
    },
    latency: { measuredCases: latencyKnownCases, meanMs: ratio(latencyTotalMs, latencyKnownCases), totalMs: latencyTotalMs },
    usage: {
      reportedCases: usageReportedCases,
      reportedFieldCases: usageFieldCases,
      // A total is only complete when every usage-reporting case supplies that field.
      // Missing input/output tokens are UNKNOWN, never zero.
      totals: usageReportedCases
        ? Object.fromEntries(Object.keys(usageTotals).map((key) => [
          key, usageFieldCases[key] === usageReportedCases ? usageTotals[key] : null,
        ]))
        : null,
    },
    cases: rows,
  };
}

/** Pure fixture-output adapter: no live model or external services. */
export function buildMockSemanticRelationResponse({ sourceClaimId, targetClaimIds, mockRelations }) {
  string(sourceClaimId, 'sourceClaimId');
  if (!Array.isArray(targetClaimIds) || targetClaimIds.length > MAX_TARGETS) throw new TypeError('invalid targets');
  if (!Array.isArray(mockRelations) || mockRelations.length > MAX_EDGES) throw new TypeError('invalid mockRelations');
  const targets = new Set(targetClaimIds);
  return JSON.stringify({ relations: mockRelations.map((item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object'
      || Object.keys(item).some((k) => !['relation', 'targetClaimId', 'reason'].includes(k))
      || !RELATION_TYPES.has(item.relation) || !targets.has(item.targetClaimId)) {
      throw new TypeError('invalid mock relation');
    }
    string(item.reason, 'reason', 500);
    const ref = '@' + createHash('sha256').update(item.targetClaimId, 'utf8').digest('hex').slice(0, 10);
    return { relation: item.relation, target_ref: ref, confidence: 'high', reason: item.reason };
  }) });
}

/** Strict replay helper: consumes in-memory fixture cases only. */
export async function replaySemanticRelationShadowFixture({ fixture, clockMs } = {}) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)
    || fixture.format !== 'agent-hub-semantic-relation-shadow-fixture'
    || fixture.version !== 1 || !Array.isArray(fixture.cases)) {
    throw new TypeError('unsupported semantic relation fixture format');
  }
  const cases = fixture.cases.map((item) => {
    if (!item || !item.canonical || typeof item.canonical !== 'object') throw new TypeError('fixture canonical snapshot required');
    if (!Object.hasOwn(item, 'mockRelations') && !Object.hasOwn(item, 'rawResponse') && item.mockError !== true) {
      throw new TypeError('mockRelations, rawResponse, or mockError required');
    }
    if (item.mockRelations !== undefined && (item.rawResponse !== undefined || item.mockError === true)) {
      throw new TypeError('fixture must use a single response mode');
    }
    if (item.rawResponse !== undefined && (typeof item.rawResponse !== 'string' || item.rawResponse.length > 32768 || item.mockError === true)) {
      throw new TypeError('invalid rawResponse');
    }
    return { ...item, memory: { exportCanonical: () => structuredClone(item.canonical) } };
  });
  return evaluateSemanticRelationShadowCases({
    cases, clockMs,
    judge: async ({ caseId, sourceClaimId, targetClaimIds }) => {
      const entry = cases.find((item) => item.id === caseId);
      if (entry.mockError === true) throw new Error('simulated unavailable provider');
      const raw = entry.rawResponse ?? buildMockSemanticRelationResponse({ sourceClaimId, targetClaimIds, mockRelations: entry.mockRelations });
      return { text: raw, usage: entry.usage ?? null };
    },
  });
}
