#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateRecallRelevanceCases } from '../memory-engine/recall-relevance-eval.mjs';
import { createRecallRelevanceJudgeRuntime } from '../memory-engine/recall-relevance-judge-runtime.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInt(value, name, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(name + ' must be an integer between 1 and ' + max);
  }
  return parsed;
}

export function parseRecallRelevanceBenchmarkArgs(argv = [], defaultCwd = process.cwd()) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const output = {
    casesPath: null,
    model: null,
    reasoningEffort: 'low',
    timeoutMs: 8_000,
    maxSelected: 8,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      output.json = true;
      continue;
    }
    if (['--cases', '--model', '--reasoning-effort', '--timeout-ms', '--max-selected'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      index += 1;
      if (arg === '--cases') {
        output.casesPath = isAbsolute(value) ? value : resolve(defaultCwd, value);
      } else if (arg === '--model') {
        output.model = value.trim();
      } else if (arg === '--reasoning-effort') {
        const normalized = value.trim().toLowerCase();
        if (!['low', 'medium', 'high'].includes(normalized)) {
          throw new Error('--reasoning-effort must be low, medium, or high');
        }
        output.reasoningEffort = normalized;
      } else if (arg === '--timeout-ms') {
        output.timeoutMs = positiveInt(value, '--timeout-ms', 600_000);
      } else {
        output.maxSelected = positiveInt(value, '--max-selected', 10);
      }
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }
  if (!nonEmpty(output.casesPath)) throw new Error('--cases is required');
  return output;
}

async function readCasesFile(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('cases file must contain a JSON array');
  return parsed;
}

async function defaultCreateRuntime(options) {
  const judgeModule = await import('./codex-isolated-memory-judge.mjs');
  return createRecallRelevanceJudgeRuntime({
    ...options,
    createJsonJudge: judgeModule.createIsolatedCodexJsonJudge,
  });
}

function emptyUsage() {
  return {
    calls: 0,
    failures: 0,
    duration_ms: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

function addUsage(total, event) {
  total.calls += 1;
  total.failures += event?.status === 'failed' ? 1 : 0;
  total.duration_ms += Number(event?.duration_ms ?? 0);
  for (const key of [
    'input_tokens',
    'cached_input_tokens',
    'cache_write_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
  ]) {
    total[key] += Number(event?.[key] ?? 0);
  }
}

function humanReport(result) {
  const q = result.evaluation.quality;
  const p = result.evaluation.performance;
  const u = result.model_usage;
  return [
    `Recall relevance benchmark: ${result.evaluation.counts.cases} cases`,
    `quality: precision=${q.precision.toFixed(4)} recall=${q.recall.toFixed(4)} exact=${q.exact_selection_rate.toFixed(4)} negative-fp=${q.negative_false_positive_rate.toFixed(4)}`,
    `selector: failures=${result.evaluation.counts.failures} judge-calls=${p.judge_calls} mean=${p.mean_duration_ms.toFixed(2)} ms`,
    `model usage: calls=${u.calls} failures=${u.failures} input=${u.input_tokens} cached=${u.cached_input_tokens} output=${u.output_tokens} reasoning=${u.reasoning_output_tokens} duration=${u.duration_ms} ms`,
  ].join('\n');
}

export async function runRecallRelevanceBenchmarkCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  log = console.log,
  dependencies = {},
  env = process.env,
} = {}) {
  if (typeof log !== 'function') throw new TypeError('log must be a function');
  const options = parseRecallRelevanceBenchmarkArgs(argv, cwd);
  const readCases = dependencies.readCases ?? readCasesFile;
  const createRuntime = dependencies.createRuntime ?? defaultCreateRuntime;
  if (typeof readCases !== 'function') throw new TypeError('readCases must be a function');
  if (typeof createRuntime !== 'function') throw new TypeError('createRuntime must be a function');

  const cases = await readCases(options.casesPath);
  const modelUsage = emptyUsage();
  const runtime = await createRuntime({
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    timeoutMs: options.timeoutMs,
    env,
    onUsage(event) {
      addUsage(modelUsage, event);
    },
  });
  if (!runtime || typeof runtime.judge !== 'function') {
    throw new TypeError('createRuntime must return a judge runtime');
  }

  try {
    const evaluation = await evaluateRecallRelevanceCases(cases, {
      judge: runtime.judge,
      maxSelected: options.maxSelected,
    });
    const result = {
      type: 'agent_hub_recall_relevance_benchmark',
      evaluator_id: runtime.evaluatorId ?? null,
      settings: {
        model: options.model,
        reasoning_effort: options.reasoningEffort,
        timeout_ms: options.timeoutMs,
        max_selected: options.maxSelected,
      },
      evaluation,
      model_usage: modelUsage,
    };
    log(options.json ? JSON.stringify(result) : humanReport(result));
    return result;
  } finally {
    if (typeof runtime.close === 'function') await runtime.close();
  }
}

async function main() {
  try {
    await runRecallRelevanceBenchmarkCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
