import { homedir } from 'node:os';
import {
  dirname,
  join,
  posix,
  resolve,
  win32,
} from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  GraphRecallShadowStore,
} from '../memory-engine/graph-recall-shadow-store.mjs';
const REQUIRED_QUALITY_SAMPLE_TARGET = 100;

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p95(values) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * 0.95) - 1;

  return sorted[index];
}

function rate(numerator, denominator) {
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function evaluateGraphRecallShadowRecords(records) {
  const qualityEligible = records.filter(
    (record) => record.quality_eligible === true,
  );

  const metrics = records.map((record) => record.metrics);

  const sourceCandidateTotal = metrics.reduce(
    (sum, value) => sum + value.source_candidate_count,
    0,
  );

  const graphCandidateTotal = metrics.reduce(
    (sum, value) => sum + value.graph_candidate_count,
    0,
  );

  const finalSelectionRecalls = metrics
    .map((value) => value.final_selection_recall)
    .filter((value) => value !== null);

  const exactPreservationValues = metrics
    .map((value) => value.exact_preservation)
    .filter((value) => value !== null);

  return {
    type: 'agent_hub_graph_recall_shadow',
    schemaVersion: 1,
    readOnly: true,
    evidence: {
      total_observation_count: records.length,
      quality_eligible_observation_count: qualityEligible.length,
      required_quality_sample_target: REQUIRED_QUALITY_SAMPLE_TARGET,
      promotion_evidence_sufficient:
        qualityEligible.length >= REQUIRED_QUALITY_SAMPLE_TARGET,
    },
    metrics: {
      mean_local_duration_ms: mean(
        metrics.map((value) => value.local_duration_ms),
      ),
      p95_local_duration_ms: p95(
        metrics.map((value) => value.local_duration_ms),
      ),
      mean_source_candidate_count: mean(
        metrics.map((value) => value.source_candidate_count),
      ),
      mean_graph_candidate_count: mean(
        metrics.map((value) => value.graph_candidate_count),
      ),
      mean_estimated_source_candidate_tokens: mean(
        metrics.map((value) => value.estimated_source_candidate_tokens),
      ),
      mean_estimated_graph_candidate_tokens: mean(
        metrics.map((value) => value.estimated_graph_candidate_tokens),
      ),
      source_pruning_rate: rate(
        metrics.reduce(
          (sum, value) => sum + value.source_pruned_count,
          0,
        ),
        sourceCandidateTotal,
      ),
      novel_candidate_rate: rate(
        metrics.reduce(
          (sum, value) => sum + value.novel_graph_count,
          0,
        ),
        graphCandidateTotal,
      ),
      aggregate_false_negative_count: metrics.reduce(
        (sum, value) => sum + value.false_negative_count,
        0,
      ),
      macro_final_selection_recall: mean(finalSelectionRecalls),
      exact_preservation_rate: exactPreservationValues.length === 0
        ? null
        : (
          exactPreservationValues.filter((value) => value === true).length
          / exactPreservationValues.length
        ),
    },
    production_recommendation: null,
  };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function defaultGraphRecallShadowRoot({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  if (nonEmpty(env.AGENT_HUB_MEMORY_DB)) {
    return join(
      dirname(env.AGENT_HUB_MEMORY_DB.trim()),
      'shadow-replay',
    );
  }

  if (platform === 'win32') {
    const local = nonEmpty(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA.trim()
      : win32.join(homeDir, 'AppData', 'Local');

    return win32.join(
      local,
      'agent-hub',
      'shadow-replay',
    );
  }

  const state = nonEmpty(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME.trim()
    : posix.join(homeDir, '.local', 'state');

  return posix.join(
    state,
    'agent-hub',
    'shadow-replay',
  );
}

export async function runGraphRecallShadowCli({
  argv = process.argv.slice(2),
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  let rootDir = defaultGraphRecallShadowRoot({
    env,
    platform,
    homeDir,
  });

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--root-dir') {
      throw new TypeError(`unknown argument: ${argv[index]}`);
    }

    const value = argv[index + 1];

    if (!nonEmpty(value)) {
      throw new TypeError('--root-dir requires a value');
    }

    rootDir = resolve(value);
    index += 1;
  }

  const store = new GraphRecallShadowStore({ rootDir });

  return evaluateGraphRecallShadowRecords(store.list());
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entry === import.meta.url) {
  runGraphRecallShadowCli()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${
          error instanceof Error
            ? error.stack ?? error.message
            : String(error)
        }\n`,
      );
      process.exitCode = 1;
    });
}
