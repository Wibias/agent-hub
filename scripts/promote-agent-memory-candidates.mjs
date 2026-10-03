#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGENT_DECISION_PROMOTION_POLICY_VERSION,
  finalizeAgentDecisionCandidates,
} from '../memory-engine/agent-decision-promotion.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  resolveMemoryCandidateJudgeRuntime,
} from './judge-memory-candidates.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseAgentDecisionPromotionArgs(
  argv = [],
  defaultCwd = process.cwd(),
) {
  const options = {
    cwd: defaultCwd,
    dbPath: null,
    limit: 10,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (['--cwd', '--db-path', '--limit'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      index += 1;
      if (arg === '--cwd') options.cwd = resolve(value);
      else if (arg === '--db-path') options.dbPath = resolve(value);
      else {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
          throw new Error('--limit must be an integer between 1 and 20');
        }
        options.limit = parsed;
      }
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }
  return options;
}

export async function runAgentDecisionPromotionCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  log = console.log,
  dependencies = {},
} = {}) {
  const options = parseAgentDecisionPromotionArgs(argv, cwd);
  const resolveRuntime = dependencies.resolveRuntime
    || resolveMemoryCandidateJudgeRuntime;
  const createMemory = dependencies.createMemory
    || (({ dbPath }) => new MemoryEngine({ dbPath }));
  const finalize = dependencies.finalize || finalizeAgentDecisionCandidates;

  const runtime = resolveRuntime({
    cwd: options.cwd,
    dbPath: options.dbPath,
  });
  const memory = createMemory({ dbPath: runtime.dbPath });

  try {
    const output = finalize({
      memory,
      projectId: runtime.projectId,
      branch: runtime.branch,
      apply: options.apply,
      limit: options.limit,
    });
    log(JSON.stringify(output));
    return output;
  } finally {
    memory.close();
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runAgentDecisionPromotionCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
