import { readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  evaluateRecallFastPath,
  scoreRecallCasesWithEmbedder,
} from '../memory-engine/recall-fast-path-calibration.mjs';

import {
  createE5Embedder,
  E5_DIMENSIONS,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../memory-engine/e5-embedder.mjs';

const PACKET_FILE_RE = /^[0-9a-f]{64}\.json$/;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function probability(value, name) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }

  return number;
}

function positiveStep(value, name) {
  const number = probability(value, name);

  if (number <= 0) {
    throw new RangeError(`${name} must be greater than 0`);
  }

  return number;
}

function defaultReplayRoot(cwd, env, platform) {
  if (nonEmpty(env.AGENT_HUB_SHADOW_REPLAY_ROOT)) {
    return resolve(
      cwd,
      env.AGENT_HUB_SHADOW_REPLAY_ROOT.trim(),
    );
  }

  if (platform === 'win32' && nonEmpty(env.LOCALAPPDATA)) {
    return join(
      env.LOCALAPPDATA.trim(),
      'agent-hub',
      'shadow-replay',
    );
  }

  if (nonEmpty(env.XDG_STATE_HOME)) {
    return join(
      env.XDG_STATE_HOME.trim(),
      'agent-hub',
      'shadow-replay',
    );
  }

  if (nonEmpty(env.HOME)) {
    return join(
      env.HOME.trim(),
      '.local',
      'state',
      'agent-hub',
      'shadow-replay',
    );
  }

  return resolve(cwd, '.agent-hub-shadow-replay');
}

export function parseArgs(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
) {
  const output = {
    reviewDir: join(
      defaultReplayRoot(cwd, env, platform),
      'review',
    ),

    cacheDir: nonEmpty(env.MEMORY_E5_MODEL_CACHE)
      ? resolve(cwd, env.MEMORY_E5_MODEL_CACHE.trim())
      : resolve(cwd, '.cache', 'memory-engine', 'e5'),

    negativeThreshold: 0.83,
    positiveMin: 0.85,
    positiveMax: 0.99,
    positiveStep: 0.005,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (!nonEmpty(value)) {
      throw new Error(`${arg} requires a value`);
    }

    index += 1;

    if (arg === '--review-dir') {
      output.reviewDir = isAbsolute(value)
        ? value
        : resolve(cwd, value);
    } else if (arg === '--cache-dir') {
      output.cacheDir = isAbsolute(value)
        ? value
        : resolve(cwd, value);
    } else if (arg === '--negative-threshold') {
      output.negativeThreshold = probability(value, arg);
    } else if (arg === '--positive-min') {
      output.positiveMin = probability(value, arg);
    } else if (arg === '--positive-max') {
      output.positiveMax = probability(value, arg);
    } else if (arg === '--positive-step') {
      output.positiveStep = positiveStep(value, arg);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (output.negativeThreshold >= output.positiveMin) {
    throw new RangeError(
      '--negative-threshold must be less than --positive-min',
    );
  }

  if (output.positiveMin > output.positiveMax) {
    throw new RangeError(
      '--positive-min must be <= --positive-max',
    );
  }

  return Object.freeze(output);
}

export function thresholdRange(
  minimum,
  maximum,
  step,
) {
  const min = probability(minimum, 'minimum');
  const max = probability(maximum, 'maximum');
  const increment = positiveStep(step, 'step');

  if (min > max) {
    throw new RangeError(
      'minimum must be <= maximum',
    );
  }

  const values = [];

  for (let index = 0; ; index += 1) {
    const value = Number(
      (min + index * increment).toFixed(6),
    );

    if (value > max + 1e-9) {
      break;
    }

    values.push(value);
  }

  if (
    values.length === 0
    || Math.abs(values.at(-1) - max) > 1e-9
  ) {
    values.push(max);
  }

  return [...new Set(values)];
}

function uniqueIds(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }

  const ids = [];
  const seen = new Set();

  for (const id of value) {
    if (!nonEmpty(id) || seen.has(id)) {
      throw new TypeError(
        `${name} must contain unique non-empty ids`,
      );
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export async function loadReviewCases(reviewDir) {
  const names = (await readdir(reviewDir))
    .filter((name) => PACKET_FILE_RE.test(name))
    .sort();

  const cases = [];

  let skippedNonV1 = 0;
  let skippedNonMismatch = 0;

  for (const name of names) {
    const stem = basename(name, '.json');

    const packet = JSON.parse(
      await readFile(
        join(reviewDir, name),
        'utf8',
      ),
    );

    const result = JSON.parse(
      await readFile(
        join(reviewDir, `${stem}.result.json`),
        'utf8',
      ),
    );

    if (result.status !== 'fast_v1_mismatch') {
      skippedNonMismatch += 1;
      continue;
    }

    if (packet?.localFastPath?.route !== 'fast_v1') {
      skippedNonV1 += 1;
      continue;
    }

    if (packet.id !== stem) {
      throw new Error(
        `packet id does not match filename: ${name}`,
      );
    }

    if (!nonEmpty(packet.query)) {
      throw new TypeError(
        `packet query missing: ${stem}`,
      );
    }

    if (
      !Array.isArray(packet.candidates)
      || packet.candidates.length === 0
    ) {
      throw new TypeError(
        `packet candidates missing: ${stem}`,
      );
    }

    cases.push({
      id: packet.id,
      query: packet.query,
      items: packet.candidates,

      relevantClaimIds: uniqueIds(
        result.judge_selected_ids,
        `${stem}.judge_selected_ids`,
      ),
    });
  }

  return {
    cases,

    counts: {
      packet_files: names.length,
      usable_fast_v1_mismatches: cases.length,
      skipped_non_v1: skippedNonV1,
      skipped_non_mismatch: skippedNonMismatch,
    },
  };
}

function sameSet(left, right) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function classify(entry) {
  if (entry.route === 'fallback') {
    return 'fallback';
  }

  const expected = new Set(entry.expected_ids);
  const selected = new Set(entry.selected_ids);

  if (sameSet(expected, selected)) {
    return 'match';
  }

  const extra = [...selected]
    .filter((id) => !expected.has(id));

  const missing = [...expected]
    .filter((id) => !selected.has(id));

  if (
    selected.size > 0
    && expected.size === 0
  ) {
    return 'fast_false_positive';
  }

  if (
    selected.size === 0
    && expected.size > 0
  ) {
    return 'fast_false_negative';
  }

  if (
    extra.length > 0
    && missing.length === 0
  ) {
    return 'fast_overselect';
  }

  if (
    extra.length === 0
    && missing.length > 0
  ) {
    return 'fast_underselect';
  }

  return 'different_selection';
}

function summarize(evaluation) {
  const counts = {
    match: 0,
    fallback: 0,
    fast_false_positive: 0,
    fast_false_negative: 0,
    fast_overselect: 0,
    fast_underselect: 0,
    different_selection: 0,
  };

  for (const entry of evaluation.cases) {
    counts[classify(entry)] += 1;
  }

  const fastErrors =
    counts.fast_false_positive
    + counts.fast_false_negative
    + counts.fast_overselect
    + counts.fast_underselect
    + counts.different_selection;

  return {
    negative_threshold:
      evaluation.negative_threshold,

    positive_threshold:
      evaluation.positive_threshold,

    fast_cases:
      evaluation.fast_cases,

    fallback_cases:
      evaluation.fallback_cases,

    fast_errors:
      fastErrors,

    exact_matches:
      counts.match,

    false_positive_cases:
      counts.fast_false_positive,

    overselect_cases:
      counts.fast_overselect,

    false_negative_cases:
      counts.fast_false_negative,

    underselect_cases:
      counts.fast_underselect,

    different_selection_cases:
      counts.different_selection,

    coverage:
      evaluation.coverage,

    fallback_rate:
      evaluation.fallback_rate,

    fast_exact_rate:
      evaluation.fast_exact_rate,
  };
}

export function sweep(
  scoredCases,
  options = {},
) {
  if (
    !Array.isArray(scoredCases)
    || scoredCases.length === 0
  ) {
    throw new TypeError(
      'scoredCases must be non-empty',
    );
  }

  const negative = probability(
    options.negativeThreshold ?? 0.83,
    'negativeThreshold',
  );

  const positives = thresholdRange(
    options.positiveMin ?? 0.85,
    options.positiveMax ?? 0.99,
    options.positiveStep ?? 0.005,
  ).filter(
    (value) => value > negative,
  );

  if (positives.length === 0) {
    throw new Error(
      'positive sweep contains no threshold above negative threshold',
    );
  }

  const rows = positives.map(
    (positiveThreshold) => summarize(
      evaluateRecallFastPath(
        scoredCases,
        {
          negativeThreshold: negative,
          positiveThreshold,
        },
      ),
    ),
  );

  const zeroError = rows.filter(
    (row) => row.fast_errors === 0,
  );

  return {
    baseline: rows[0],

    recommendation:
      zeroError[0] ?? null,

    zero_error_thresholds:
      zeroError.map(
        (row) => row.positive_threshold,
      ),

    sweep: rows,
  };
}

function scoreStats(scoredCases) {
  const selected = [];
  const rejected = [];

  for (const entry of scoredCases) {
    const expected = new Set(
      entry.relevantClaimIds,
    );

    for (const candidate of entry.candidates) {
      const target = expected.has(
        candidate.claimId,
      )
        ? selected
        : rejected;

      target.push(
        candidate.similarity,
      );
    }
  }

  const stats = (values) => {
    if (values.length === 0) {
      return {
        count: 0,
        min: null,
        max: null,
        mean: null,
      };
    }

    return {
      count: values.length,

      min: Math.min(...values),

      max: Math.max(...values),

      mean:
        values.reduce(
          (sum, value) => sum + value,
          0,
        ) / values.length,
    };
  };

  return {
    judge_selected_similarity:
      stats(selected),

    judge_rejected_similarity:
      stats(rejected),
  };
}

export async function run({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  dependencies = {},
} = {}) {
  const options = parseArgs(
    argv,
    cwd,
    env,
    platform,
  );

  const loadCases =
    dependencies.loadCases
    ?? loadReviewCases;

  const createEmbedder =
    dependencies.createEmbedder
    ?? createE5Embedder;

  const scoreCases =
    dependencies.scoreCases
    ?? scoreRecallCasesWithEmbedder;

  const loaded = await loadCases(
    options.reviewDir,
  );

  if (!loaded?.cases?.length) {
    throw new Error(
      'no usable fast_v1 mismatch review packets found',
    );
  }

  const embedder = await createEmbedder({
    cacheDir: options.cacheDir,
    allowRemoteModels: false,
  });

  const scoredCases = await scoreCases(
    loaded.cases,
    { embedder },
  );

  const calibration = sweep(
    scoredCases,
    options,
  );

  return {
    type:
      'agent_hub_recall_shadow_review_calibration',

    schemaVersion: 1,

    mode:
      'read_only_review_probe',

    readOnly: true,

    settings: {
      review_dir:
        options.reviewDir,

      cache_dir:
        options.cacheDir,

      negative_threshold:
        options.negativeThreshold,

      positive_min:
        options.positiveMin,

      positive_max:
        options.positiveMax,

      positive_step:
        options.positiveStep,
    },

    model: {
      id:
        embedder?.modelId
        ?? E5_MODEL_ID,

      revision:
        embedder?.modelRevision
        ?? E5_MODEL_REVISION,

      dimensions:
        embedder?.dimensions
        ?? E5_DIMENSIONS,
    },

    counts:
      loaded.counts,

    score_diagnostics:
      scoreStats(scoredCases),

    baseline:
      calibration.baseline,

    recommendation:
      calibration.recommendation,

    zero_error_thresholds:
      calibration.zero_error_thresholds,

    sweep:
      calibration.sweep,

    mutationsApplied: false,
  };
}

if (
  process.argv[1]
  && import.meta.url
    === pathToFileURL(resolve(process.argv[1])).href
) {
  run()
    .then((result) => {
      process.stdout.write(
        JSON.stringify(
          result,
          null,
          2,
        ) + '\n',
      );
    })
    .catch((error) => {
      process.stderr.write(
        'Recall shadow review calibration failed: '
        + (error?.stack ?? String(error))
        + '\n',
      );

      process.exitCode = 1;
    });
}
