#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ModelJudgeTelemetryStore } from '../memory-engine/model-judge-telemetry-store.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseModelJudgeUsageArgs(argv = [], defaultCwd = process.cwd()) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const output = {
    cwd: resolve(defaultCwd),
    dbPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      output.json = true;
      continue;
    }
    if (arg === '--cwd' || arg === '--db-path') {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a path');
      if (arg === '--cwd') output.cwd = resolve(value);
      else output.dbPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }
  return output;
}

async function loadDefaultRuntime() {
  const [gitModule, hookCliModule] = await Promise.all([
    import('../memory-engine/git-freshness.mjs'),
    import('../memory-engine/adapters/codex-hook-cli.mjs'),
  ]);
  return {
    resolveGitContext: gitModule.resolveGitContext,
    resolveCodexProjectScope: hookCliModule.resolveCodexProjectScope,
    defaultCodexMemoryDbPath: hookCliModule.defaultCodexMemoryDbPath,
    createStore({ dbPath }) {
      return new ModelJudgeTelemetryStore({ dbPath, readOnly: true });
    },
  };
}

function humanReport(result) {
  const usage = result.usage;
  const lines = [
    `Memory model usage for ${result.projectId} @ ${result.branch}:`,
    `calls: ${usage.calls} | failures: ${usage.failures} | duration: ${usage.duration_ms} ms`,
    `tokens: input=${usage.input_tokens} cached=${usage.cached_input_tokens} cache-write=${usage.cache_write_input_tokens} output=${usage.output_tokens} reasoning=${usage.reasoning_output_tokens}`,
  ];
  const stages = Object.entries(usage.by_stage ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en'));
  if (stages.length === 0) lines.push('stages: none');
  else {
    lines.push('stages:');
    for (const [stage, value] of stages) {
      lines.push(`- ${stage}: calls=${value.calls} failures=${value.failures} duration=${value.duration_ms} ms`);
    }
  }
  return lines.join('\n');
}

export async function runModelJudgeUsageCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  log = console.log,
  runtime = null,
  env = process.env,
} = {}) {
  if (typeof log !== 'function') throw new TypeError('log must be a function');
  const options = parseModelJudgeUsageArgs(argv, cwd);
  const deps = runtime ?? await loadDefaultRuntime();
  for (const name of [
    'resolveGitContext',
    'resolveCodexProjectScope',
    'defaultCodexMemoryDbPath',
    'createStore',
  ]) {
    if (typeof deps?.[name] !== 'function') {
      throw new TypeError('runtime.' + name + ' must be a function');
    }
  }

  const git = deps.resolveGitContext({ cwd: options.cwd });
  const scope = deps.resolveCodexProjectScope({
    event: { cwd: options.cwd },
    config: { projectId: null, repoIdentity: null },
  });
  const dbPath = options.dbPath ?? deps.defaultCodexMemoryDbPath({ env });
  const store = deps.createStore({ dbPath });
  try {
    const result = {
      type: 'agent_hub_memory_model_usage',
      projectId: scope.projectId,
      branch: git.branch,
      revisionSha: git.revisionSha ?? null,
      dbPath,
      usage: store.summary({
        projectId: scope.projectId,
        branch: git.branch,
      }),
    };
    log(options.json ? JSON.stringify(result) : humanReport(result));
    return result;
  } finally {
    if (store && typeof store.close === 'function') store.close();
  }
}

async function main() {
  try {
    await runModelJudgeUsageCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
