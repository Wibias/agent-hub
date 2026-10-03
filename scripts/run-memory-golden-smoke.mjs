#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  runMemoryEndToEndSmoke,
} from './eval-memory-end-to-end-smoke.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseMemoryGoldenSmokeArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const options = {
    providerBacked: false,
    model: null,
    reasoningEffort: 'medium',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--provider') {
      options.providerBacked = true;
      continue;
    }
    if (['--model', '--reasoning-effort'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      index += 1;
      if (arg === '--model') {
        options.model = value.trim();
      } else {
        const effort = value.trim().toLowerCase();
        if (!['low', 'medium', 'high'].includes(effort)) {
          throw new Error('--reasoning-effort must be low, medium, or high');
        }
        options.reasoningEffort = effort;
      }
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }

  return options;
}

export async function runMemoryGoldenSmoke({
  argv = process.argv.slice(2),
  log = console.log,
  env = process.env,
} = {}) {
  const options = parseMemoryGoldenSmokeArgs(argv);
  const result = await runMemoryEndToEndSmoke({
    ...options,
    env,
  });

  for (const item of result.checks) {
    log(JSON.stringify({
      type: 'memory_golden_smoke_check',
      ...item,
    }));
  }
  log(JSON.stringify({
    type: 'memory_golden_smoke_summary',
    pass: result.pass,
    mode: result.mode,
    model: result.model,
    reasoning_effort: result.reasoning_effort,
    policies: result.policies,
    judge_calls: result.judge_calls,
    final: result.final,
  }));

  return result;
}

async function main() {
  const result = await runMemoryGoldenSmoke();
  if (!result.pass) process.exitCode = 1;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
