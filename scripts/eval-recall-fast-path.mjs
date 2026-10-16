#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calibrateRecallFastPath,
  scoreRecallCasesWithEmbedder,
} from '../memory-engine/recall-fast-path-calibration.mjs';
import {
  createE5Embedder,
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../memory-engine/e5-embedder.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedNumber(raw, name, { min, max, exclusiveMin = false } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new TypeError(name + ' must be a finite number');
  if (exclusiveMin ? value <= min : value < min) {
    throw new RangeError(name + ' is below the allowed range');
  }
  if (value > max) throw new RangeError(name + ' is above the allowed range');
  return value;
}

export function parseRecallFastPathArgs(argv = [], defaultCwd = process.cwd(), env = process.env) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const output = {
    casesPath: null,
    cacheDir: nonEmpty(env?.MEMORY_E5_MODEL_CACHE)
      ? resolve(env.MEMORY_E5_MODEL_CACHE.trim())
      : null,
    thresholdMin: 0,
    thresholdMax: 1,
    thresholdStep: 0.01,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      output.json = true;
      continue;
    }
    if ([
      '--cases', '--cache-dir', '--threshold-min', '--threshold-max', '--threshold-step',
    ].includes(arg)) {
      const raw = argv[index + 1];
      if (!nonEmpty(raw)) throw new Error(arg + ' requires a value');
      index += 1;
      if (arg === '--cases') {
        output.casesPath = isAbsolute(raw) ? raw : resolve(defaultCwd, raw);
      } else if (arg === '--cache-dir') {
        output.cacheDir = isAbsolute(raw) ? raw : resolve(defaultCwd, raw);
      } else if (arg === '--threshold-min') {
        output.thresholdMin = boundedNumber(raw, arg, { min: 0, max: 1 });
      } else if (arg === '--threshold-max') {
        output.thresholdMax = boundedNumber(raw, arg, { min: 0, max: 1 });
      } else {
        output.thresholdStep = boundedNumber(raw, arg, { min: 0, max: 1, exclusiveMin: true });
      }
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }

  if (!nonEmpty(output.casesPath)) throw new Error('--cases is required');
  if (!nonEmpty(output.cacheDir)) {
    throw new Error('--cache-dir or MEMORY_E5_MODEL_CACHE is required');
  }
  if (output.thresholdMin >= output.thresholdMax) {
    throw new RangeError('--threshold-min must be less than --threshold-max');
  }
  if (output.thresholdStep > output.thresholdMax - output.thresholdMin) {
    throw new RangeError('--threshold-step is larger than the threshold range');
  }
  return output;
}

function buildThresholds({ min, max, step }) {
  const values = [];
  const epsilon = step / 1000;
  for (let value = min; value <= max + epsilon; value += step) {
    values.push(Number(Math.min(value, max).toFixed(6)));
    if (value >= max) break;
  }
  if (values.at(-1) !== max) values.push(Number(max.toFixed(6)));
  return [...new Set(values)];
}

async function readCasesFile(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('cases file must contain a JSON array');
  return parsed;
}

function humanReport(result) {
  const r = result.calibration.recommended;
  return [
    `Recall fast-path calibration: ${result.counts.cases} cases`,
    `model: ${result.model.id}@${result.model.revision} dims=${result.model.dimensions}`,
    `thresholds: negative=${r.negative_threshold.toFixed(4)} positive=${r.positive_threshold.toFixed(4)}`,
    `fast-path: coverage=${r.coverage.toFixed(4)} fallback=${r.fallback_rate.toFixed(4)} errors=${r.fast_errors}`,
    `fast quality: precision=${r.fast_quality.precision.toFixed(4)} recall=${r.fast_quality.recall.toFixed(4)} exact=${r.fast_exact_rate.toFixed(4)}`,
    `performance: scoring=${result.performance.scoring_duration_ms} ms`,
  ].join('\n');
}

export async function runRecallFastPathCalibrationCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  log = console.log,
  dependencies = {},
  clockMs = Date.now,
} = {}) {
  if (typeof log !== 'function') throw new TypeError('log must be a function');
  if (typeof clockMs !== 'function') throw new TypeError('clockMs must be a function');
  const options = parseRecallFastPathArgs(argv, cwd, env);
  const readCases = dependencies.readCases ?? readCasesFile;
  const createEmbedder = dependencies.createEmbedder ?? createE5Embedder;
  if (typeof readCases !== 'function') throw new TypeError('readCases must be a function');
  if (typeof createEmbedder !== 'function') throw new TypeError('createEmbedder must be a function');

  const cases = await readCases(options.casesPath);
  const embedder = await createEmbedder({
    cacheDir: options.cacheDir,
    allowRemoteModels: false,
  });
  if (!embedder || typeof embedder !== 'object') {
    throw new TypeError('createEmbedder must return an embedder object');
  }

  const startedAt = clockMs();
  const scoredCases = await scoreRecallCasesWithEmbedder(cases, { embedder });
  const scoringDurationMs = Math.max(0, Number(clockMs()) - Number(startedAt));
  const thresholds = buildThresholds({
    min: options.thresholdMin,
    max: options.thresholdMax,
    step: options.thresholdStep,
  });
  const calibration = calibrateRecallFastPath(scoredCases, { thresholds });

  const result = {
    type: 'agent_hub_recall_fast_path_calibration_v1',
    settings: {
      cases_path: options.casesPath,
      cache_dir: options.cacheDir,
      threshold_min: options.thresholdMin,
      threshold_max: options.thresholdMax,
      threshold_step: options.thresholdStep,
      threshold_count: thresholds.length,
    },
    model: {
      id: embedder.modelId ?? E5_MODEL_ID,
      revision: embedder.modelRevision ?? E5_MODEL_REVISION,
      dimensions: embedder.dimensions ?? E5_DIMENSIONS,
    },
    counts: {
      cases: cases.length,
      candidates: scoredCases.reduce((sum, entry) => sum + entry.candidates.length, 0),
      unique_candidates: new Set(scoredCases.flatMap((entry) => entry.candidates.map((candidate) => candidate.claimId))).size,
    },
    performance: {
      scoring_duration_ms: Number.isFinite(scoringDurationMs) ? scoringDurationMs : 0,
    },
    calibration,
  };

  log(options.json ? JSON.stringify(result) : humanReport(result));
  return result;
}

async function main() {
  try {
    await runRecallFastPathCalibrationCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
