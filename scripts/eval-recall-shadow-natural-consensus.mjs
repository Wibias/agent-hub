import { homedir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RecallShadowCalibrationStore } from '../memory-engine/recall-shadow-calibration-store.mjs';

const REQUIRED_SAMPLE_TARGET = 100;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function defaultRecallShadowCalibrationRoot({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  if (nonEmpty(env.AGENT_HUB_MEMORY_DB)) return join(dirname(env.AGENT_HUB_MEMORY_DB.trim()), 'shadow-replay');
  if (platform === 'win32') {
    const local = nonEmpty(env.LOCALAPPDATA) ? env.LOCALAPPDATA.trim() : win32.join(homeDir, 'AppData', 'Local');
    return win32.join(local, 'agent-hub', 'shadow-replay');
  }
  const state = nonEmpty(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME.trim() : posix.join(homeDir, '.local', 'state');
  return posix.join(state, 'agent-hub', 'shadow-replay');
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function thresholds(record) {
  return record.diagnostics.thresholds;
}

function candidateSets(record) {
  const t = thresholds(record);
  const candidates = record.diagnostics.candidates;
  const high = candidates.filter((candidate) => candidate.similarity >= t.positive_threshold);
  const ambiguous = candidates.filter((candidate) => (
    candidate.similarity >= t.negative_threshold
    && candidate.similarity < t.positive_threshold
  ));
  return { candidates, high, ambiguous, t };
}

function fast(selectedKeys) {
  return { route: 'fast', selected_keys: [...selectedKeys] };
}

function fallback() {
  return { route: 'fallback', selected_keys: [] };
}

function negativeOrFallback(parts) {
  if (parts.high.length === 0 && parts.ambiguous.length === 0) return fast([]);
  return fallback();
}

export const NATURAL_CONSENSUS_GATES = Object.freeze({
  current_runtime(record) {
    return ['fast_v1', 'fast_v2'].includes(record.local_route)
      ? fast(record.local_selected_keys)
      : fallback();
  },
  current_v1(record) {
    const parts = candidateSets(record);
    if (parts.high.length === 0) return negativeOrFallback(parts);
    if (parts.ambiguous.length > 0) return fallback();
    return fast(parts.high.map((candidate) => candidate.candidate_key));
  },
  unique_high(record) {
    const parts = candidateSets(record);
    if (parts.high.length === 0) return negativeOrFallback(parts);
    if (parts.high.length !== 1) return fallback();
    return fast([parts.high[0].candidate_key]);
  },
  unique_high_nontrivial_consensus(record) {
    const parts = candidateSets(record);
    if (parts.high.length === 0) return negativeOrFallback(parts);
    if (parts.candidates.length < 2 || parts.high.length !== 1) return fallback();
    const candidate = parts.high[0];
    if (
      candidate.semantic_rank !== 1
      || candidate.lexical_rank !== 1
      || candidate.final_rank !== 1
      || !Number.isFinite(record.diagnostics.top_margin)
      || record.diagnostics.top_margin < parts.t.single_margin_threshold
    ) return fallback();
    return fast([candidate.candidate_key]);
  },
  unique_high_three_votes(record) {
    const parts = candidateSets(record);
    if (parts.high.length === 0) return negativeOrFallback(parts);
    if (parts.candidates.length < 2 || parts.high.length !== 1) return fallback();
    const candidate = parts.high[0];
    if (
      candidate.signal_votes !== 3
      || !Number.isFinite(record.diagnostics.top_margin)
      || record.diagnostics.top_margin < parts.t.single_margin_threshold
    ) return fallback();
    return fast([candidate.candidate_key]);
  },
});

function classify(selected, expected) {
  if (sameSet(selected, expected)) return 'match';
  const extra = [...selected].filter((value) => !expected.has(value));
  const missing = [...expected].filter((value) => !selected.has(value));
  if (selected.size > 0 && expected.size === 0) return 'false_positive';
  if (selected.size === 0 && expected.size > 0) return 'false_negative';
  if (extra.length > 0 && missing.length === 0) return 'overselect';
  if (extra.length === 0 && missing.length > 0) return 'underselect';
  return 'different_selection';
}

export function evaluateNaturalConsensusGate(records, gateName) {
  const gate = NATURAL_CONSENSUS_GATES[gateName];
  if (typeof gate !== 'function') throw new TypeError('unknown gate: ' + gateName);
  let fastCases = 0;
  let fallbackCases = 0;
  let exactMatches = 0;
  const errors = { false_positive: 0, false_negative: 0, overselect: 0, underselect: 0, different_selection: 0 };
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const record of records) {
    const decision = gate(record);
    if (decision.route === 'fallback') {
      fallbackCases += 1;
      continue;
    }
    fastCases += 1;
    const selected = new Set(decision.selected_keys);
    const expected = new Set(record.judge_selected_keys);
    const kind = classify(selected, expected);
    if (kind === 'match') exactMatches += 1;
    else errors[kind] += 1;
    for (const key of selected) expected.has(key) ? (tp += 1) : (fp += 1);
    for (const key of expected) if (!selected.has(key)) fn += 1;
  }

  const fastErrors = Object.values(errors).reduce((sum, value) => sum + value, 0);
  return {
    gate: gateName,
    sample_count: records.length,
    fast_cases: fastCases,
    fallback_cases: fallbackCases,
    coverage: records.length === 0 ? 0 : fastCases / records.length,
    exact_matches: exactMatches,
    fast_errors: fastErrors,
    false_positive_cases: errors.false_positive,
    false_negative_cases: errors.false_negative,
    overselect_cases: errors.overselect,
    underselect_cases: errors.underselect,
    different_selection_cases: errors.different_selection,
    precision: tp + fp === 0 ? null : tp / (tp + fp),
    recall: tp + fn === 0 ? null : tp / (tp + fn),
  };
}

export function evaluateNaturalConsensusRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const exact = records.filter((record) => record?.source === 'exact_runtime' && record?.diagnostics?.schema_version === 1);
  const order = ['current_runtime', 'current_v1', 'unique_high', 'unique_high_nontrivial_consensus', 'unique_high_three_votes'];
  const gates = order.map((name) => evaluateNaturalConsensusGate(exact, name));
  const experimental = gates.filter((entry) => entry.gate.startsWith('unique_high'));
  const zeroError = experimental
    .filter((entry) => entry.fast_errors === 0)
    .sort((left, right) => (right.coverage - left.coverage) || order.indexOf(left.gate) - order.indexOf(right.gate));
  const best = zeroError[0] ?? null;
  return {
    type: 'agent_hub_recall_shadow_natural_consensus',
    schemaVersion: 1,
    readOnly: true,
    evidence: {
      exact_runtime_sample_count: exact.length,
      required_sample_target: REQUIRED_SAMPLE_TARGET,
      promotion_evidence_sufficient: exact.length >= REQUIRED_SAMPLE_TARGET && best !== null && best.fast_cases > 0 && best.fast_errors === 0,
      observed_fast_errors: Object.fromEntries(gates.map((entry) => [entry.gate, entry.fast_errors])),
    },
    gates,
    best_observed_gate: best?.gate ?? null,
    production_recommendation: null,
  };
}

export async function runRecallShadowNaturalConsensusCli({
  argv = process.argv.slice(2),
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  let rootDir = defaultRecallShadowCalibrationRoot({ env, platform, homeDir });
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--root-dir') throw new TypeError('unknown argument: ' + argv[index]);
    const value = argv[index + 1];
    if (!nonEmpty(value)) throw new TypeError('--root-dir requires a value');
    rootDir = resolve(value);
    index += 1;
  }
  const store = new RecallShadowCalibrationStore({ rootDir });
  return evaluateNaturalConsensusRecords(store.list());
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  runRecallShadowNaturalConsensusCli()
    .then((result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch((error) => {
      process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + '\n');
      process.exitCode = 1;
    });
}
