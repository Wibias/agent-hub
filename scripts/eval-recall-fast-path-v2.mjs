#!/usr/bin/env node
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  calibrateRecallHybridFastPath,
} from '../memory-engine/recall-fast-path-consensus.mjs';
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

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function numberInRange(raw, name, min, max, { exclusiveMin = false } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new TypeError(name + ' must be a finite number');
  if (exclusiveMin ? value <= min : value < min) throw new RangeError(name + ' is below the allowed range');
  if (value > max) throw new RangeError(name + ' is above the allowed range');
  return value;
}

function intInRange(raw, name, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(name + ' must be an integer between ' + min + ' and ' + max);
  }
  return value;
}

export function parseRecallFastPathV2Args(argv = [], defaultCwd = process.cwd(), env = process.env) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const output = {
    casesPath: null,
    cacheDir: nonEmpty(env?.MEMORY_E5_MODEL_CACHE) ? resolve(env.MEMORY_E5_MODEL_CACHE.trim()) : null,
    negativeThreshold: 0.83,
    positiveThreshold: 0.85,
    supportMin: 0.75,
    supportMax: 0.86,
    supportStep: 0.01,
    marginMin: 0.01,
    marginMax: 0.10,
    marginStep: 0.01,
    lexicalMaxK: 5,
    fusedMaxK: 5,
    estimatedFallbackMs: 7000,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      output.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
    index += 1;
    if (arg === '--cases') output.casesPath = isAbsolute(value) ? value : resolve(defaultCwd, value);
    else if (arg === '--cache-dir') output.cacheDir = isAbsolute(value) ? value : resolve(defaultCwd, value);
    else if (arg === '--negative-threshold') output.negativeThreshold = numberInRange(value, arg, 0, 1);
    else if (arg === '--positive-threshold') output.positiveThreshold = numberInRange(value, arg, 0, 1);
    else if (arg === '--support-min') output.supportMin = numberInRange(value, arg, 0, 1);
    else if (arg === '--support-max') output.supportMax = numberInRange(value, arg, 0, 1);
    else if (arg === '--support-step') output.supportStep = numberInRange(value, arg, 0, 1, { exclusiveMin: true });
    else if (arg === '--margin-min') output.marginMin = numberInRange(value, arg, 0, 1);
    else if (arg === '--margin-max') output.marginMax = numberInRange(value, arg, 0, 1);
    else if (arg === '--margin-step') output.marginStep = numberInRange(value, arg, 0, 1, { exclusiveMin: true });
    else if (arg === '--lexical-max-k') output.lexicalMaxK = intInRange(value, arg, 1, 10);
    else if (arg === '--fused-max-k') output.fusedMaxK = intInRange(value, arg, 1, 10);
    else if (arg === '--estimated-fallback-ms') output.estimatedFallbackMs = intInRange(value, arg, 1, 120_000);
    else throw new Error('unknown argument: ' + arg);
  }

  if (!nonEmpty(output.casesPath)) throw new Error('--cases is required');
  if (!nonEmpty(output.cacheDir)) throw new Error('--cache-dir or MEMORY_E5_MODEL_CACHE is required');
  if (output.negativeThreshold >= output.positiveThreshold) {
    throw new RangeError('--negative-threshold must be less than --positive-threshold');
  }
  for (const [min, max, step, label] of [
    [output.supportMin, output.supportMax, output.supportStep, 'support'],
    [output.marginMin, output.marginMax, output.marginStep, 'margin'],
  ]) {
    if (min > max) throw new RangeError('--' + label + '-min must be <= --' + label + '-max');
    if (step > Math.max(max - min, step) && min !== max) {
      throw new RangeError('--' + label + '-step is larger than the range');
    }
  }
  return output;
}

function buildRange(min, max, step) {
  if (min === max) return [Number(min.toFixed(6))];
  const output = [];
  const epsilon = step / 1000;
  for (let value = min; value <= max + epsilon; value += step) {
    output.push(Number(Math.min(value, max).toFixed(6)));
    if (value >= max) break;
  }
  if (output.at(-1) !== max) output.push(Number(max.toFixed(6)));
  return [...new Set(output)];
}

async function readCasesFile(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('cases file must contain a JSON array');
  return parsed;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80);
}

async function defaultRankCases(cases, { embedder }) {
  const [{ MemoryEngine }, { HybridMemoryRetriever }] = await Promise.all([
    import('../memory-engine/index.mjs'),
    import('../memory-engine/hybrid-retrieval.mjs'),
  ]);
  const output = [];

  for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    const entry = cases[caseIndex];
    const root = await mkdtemp(join(tmpdir(), 'agent-hub-recall-fast-v2-'));
    const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
    const projectId = 'recall-fast-v2-' + caseIndex + '-' + safeId(entry.id);
    const branch = 'main';
    try {
      memory.registerProject({ projectId, repoIdentity: projectId });
      for (let itemIndex = 0; itemIndex < entry.items.length; itemIndex += 1) {
        const item = entry.items[itemIndex];
        const claim = item.claim ?? {};
        const evidence = item.evidence ?? {};
        const claimId = claim.id;
        const capturedAt = '2026-10-11T00:00:' + String(itemIndex).padStart(2, '0') + '.000Z';
        memory.ingest({
          evidence: {
            id: 'ev-' + caseIndex + '-' + itemIndex + '-' + safeId(claimId),
            projectId,
            harness: 'benchmark',
            sessionId: 'recall-fast-v2',
            sourceKind: 'session',
            sourceRef: evidence.source_ref ?? ('benchmark-v1:' + claimId),
            capturedAt,
            branch,
            commitSha: null,
            path: null,
            blobOid: null,
            content: evidence.content_redacted ?? claim.value ?? '',
            authorityClass: evidence.authority_class ?? 'unclassified',
            metadata: { benchmark_case: entry.id },
          },
          claim: {
            id: claimId,
            kind: claim.kind ?? 'knowledge',
            subject: claim.subject ?? 'memory',
            predicate: claim.predicate ?? 'states',
            value: claim.value ?? claim.value_text ?? '',
            branchScope: branch,
            createdAt: capturedAt,
          },
        });
      }

      const hybrid = new HybridMemoryRetriever({ memory, embedder });
      const rebuilt = await hybrid.rebuildSemanticIndex({ projectId, branch });
      if (rebuilt.failed !== 0) throw new Error('semantic index rebuild failed for ' + entry.id);
      const diagnosed = await hybrid.diagnoseRecall({
        projectId,
        branch,
        query: entry.query,
        mode: 'current',
        maxItems: 10,
      });
      const candidates = diagnosed.candidates.map((candidate) => ({
        claimId: candidate.item.claim.id,
        similarity: candidate.semanticSimilarity,
        lexicalRank: candidate.lexicalRank,
        semanticRank: candidate.semanticRank,
        finalRank: candidate.finalRank,
        rrfScore: candidate.rrfScore,
      }));
      output.push({
        id: entry.id,
        relevantClaimIds: entry.relevantClaimIds,
        candidates,
      });
    } finally {
      memory.close();
      await rm(root, { recursive: true, force: true });
    }
  }
  return output;
}

function humanReport(result) {
  const r = result.calibration.recommended;
  return [
    `Recall hybrid fast-path calibration: ${result.counts.cases} cases`,
    `coverage=${r.coverage.toFixed(4)} fallback=${r.fallback_rate.toFixed(4)} rescued=${r.rescued_cases} errors=${r.fast_errors}`,
    `settings: support=${r.settings.support_threshold.toFixed(4)} margin=${r.settings.single_margin_threshold.toFixed(4)} lexicalK=${r.settings.lexical_k} fusedK=${r.settings.fused_k} votes=${r.settings.min_votes}`,
    `fast quality: precision=${r.fast_quality.precision.toFixed(4)} recall=${r.fast_quality.recall.toFixed(4)} exact=${r.fast_exact_rate.toFixed(4)}`,
    `estimated Codex fallback latency: ${result.performance.estimated_mean_fallback_latency_ms.toFixed(2)} ms/query`,
  ].join('\n');
}

export async function runRecallFastPathV2CalibrationCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  log = console.log,
  dependencies = {},
  clockMs = Date.now,
} = {}) {
  if (typeof log !== 'function') throw new TypeError('log must be a function');
  if (typeof clockMs !== 'function') throw new TypeError('clockMs must be a function');
  const options = parseRecallFastPathV2Args(argv, cwd, env);
  const readCases = dependencies.readCases ?? readCasesFile;
  const createEmbedder = dependencies.createEmbedder ?? createE5Embedder;
  const scoreBaselineCases = dependencies.scoreBaselineCases ?? scoreRecallCasesWithEmbedder;
  const evaluateBaseline = dependencies.evaluateBaseline ?? evaluateRecallFastPath;
  const rankCases = dependencies.rankCases ?? defaultRankCases;
  const cases = await readCases(options.casesPath);
  const embedder = await createEmbedder({ cacheDir: options.cacheDir, allowRemoteModels: false });
  if (!embedder || typeof embedder !== 'object') throw new TypeError('createEmbedder must return an embedder object');
  if (typeof scoreBaselineCases !== 'function') throw new TypeError('scoreBaselineCases must be a function');
  if (typeof evaluateBaseline !== 'function') throw new TypeError('evaluateBaseline must be a function');

  const baselineStartedAt = clockMs();
  const baselineScoredCases = await scoreBaselineCases(cases, { embedder });
  const baselineScoringDurationMs = Math.max(0, Number(clockMs()) - Number(baselineStartedAt));
  const baseline = evaluateBaseline(baselineScoredCases, {
    negativeThreshold: options.negativeThreshold,
    positiveThreshold: options.positiveThreshold,
  });
  if (!baseline || !Array.isArray(baseline.cases)) {
    throw new TypeError('evaluateBaseline must return a recall fast-path evaluation');
  }

  const rankingStartedAt = clockMs();
  const hybridCases = await rankCases(cases, { embedder });
  const rankingDurationMs = Math.max(0, Number(clockMs()) - Number(rankingStartedAt));
  const calibration = calibrateRecallHybridFastPath(hybridCases, {
    baselineCases: baseline.cases,
    negativeThreshold: options.negativeThreshold,
    positiveThreshold: options.positiveThreshold,
    supportThresholds: buildRange(options.supportMin, options.supportMax, options.supportStep),
    singleMarginThresholds: buildRange(options.marginMin, options.marginMax, options.marginStep),
    lexicalKs: Array.from({ length: options.lexicalMaxK }, (_, index) => index + 1),
    fusedKs: Array.from({ length: options.fusedMaxK }, (_, index) => index + 1),
    minVotesValues: [2, 3],
  });
  const recommended = calibration.recommended;
  const result = {
    type: 'agent_hub_recall_fast_path_calibration_v2',
    settings: {
      cases_path: options.casesPath,
      cache_dir: options.cacheDir,
      negative_threshold: options.negativeThreshold,
      positive_threshold: options.positiveThreshold,
      estimated_fallback_ms: options.estimatedFallbackMs,
    },
    model: {
      id: embedder.modelId ?? E5_MODEL_ID,
      revision: embedder.modelRevision ?? E5_MODEL_REVISION,
      dimensions: embedder.dimensions ?? E5_DIMENSIONS,
    },
    counts: {
      cases: cases.length,
      candidates: hybridCases.reduce((sum, entry) => sum + entry.candidates.length, 0),
    },
    baseline: {
      fast_cases: baseline.fast_cases,
      fallback_cases: baseline.fallback_cases,
      fast_errors: baseline.fast_errors,
      coverage: baseline.coverage ?? (baseline.fast_cases / cases.length),
      fallback_rate: baseline.fallback_rate ?? (baseline.fallback_cases / cases.length),
    },
    performance: {
      baseline_scoring_duration_ms: Number.isFinite(baselineScoringDurationMs) ? baselineScoringDurationMs : 0,
      ranking_duration_ms: Number.isFinite(rankingDurationMs) ? rankingDurationMs : 0,
      total_local_duration_ms: (Number.isFinite(baselineScoringDurationMs) ? baselineScoringDurationMs : 0)
        + (Number.isFinite(rankingDurationMs) ? rankingDurationMs : 0),
      estimated_fallback_ms: options.estimatedFallbackMs,
      estimated_mean_fallback_latency_ms: recommended.fallback_rate * options.estimatedFallbackMs,
    },
    calibration,
  };
  log(options.json ? JSON.stringify(result) : humanReport(result));
  return result;
}

async function main() {
  try {
    await runRecallFastPathV2CalibrationCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
