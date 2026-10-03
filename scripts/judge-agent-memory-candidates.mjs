#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGENT_DECISION_IMPORTANCE_POLICY_VERSION,
  buildAgentDecisionImportancePrompt,
  evaluatePendingAgentDecisionCandidates,
} from '../memory-engine/agent-decision-judge.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  resolveMemoryCandidateJudgeRuntime,
} from './judge-memory-candidates.mjs';
import {
  createIsolatedCodexJsonJudge,
} from './codex-isolated-memory-judge.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parsePositiveInt(value, name, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(name + ' must be an integer between 1 and ' + max);
  }
  return parsed;
}

export function parseAgentDecisionJudgeArgs(
  argv = [],
  defaultCwd = process.cwd(),
) {
  const options = {
    cwd: defaultCwd,
    dbPath: null,
    limit: 10,
    apply: false,
    model: null,
    reasoningEffort: 'medium',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if ([
      '--cwd',
      '--db-path',
      '--limit',
      '--model',
      '--reasoning-effort',
    ].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      index += 1;
      if (arg === '--cwd') options.cwd = resolve(value);
      else if (arg === '--db-path') options.dbPath = resolve(value);
      else if (arg === '--limit') {
        options.limit = parsePositiveInt(value, '--limit', 20);
      } else if (arg === '--model') {
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

export async function runAgentDecisionJudgeCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  log = console.log,
  dependencies = {},
} = {}) {
  const options = parseAgentDecisionJudgeArgs(argv, cwd);
  const resolveRuntime = dependencies.resolveRuntime
    || resolveMemoryCandidateJudgeRuntime;
  const createMemory = dependencies.createMemory
    || (({ dbPath }) => new MemoryEngine({ dbPath }));
  const evaluate = dependencies.evaluate
    || evaluatePendingAgentDecisionCandidates;
  const createJudge = dependencies.createJudge
    || createIsolatedCodexJsonJudge;

  const runtime = resolveRuntime({
    cwd: options.cwd,
    dbPath: options.dbPath,
  });
  const memory = createMemory({ dbPath: runtime.dbPath });
  let judgeResource = null;

  try {
    judgeResource = await createJudge({
      workspaceLabel: 'agent-decision-importance',
      policyVersion: AGENT_DECISION_IMPORTANCE_POLICY_VERSION,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    });

    const rawJudge = judgeResource.judge;
    if (typeof rawJudge !== 'function') {
      throw new TypeError('agent decision judge factory must return judge()');
    }
    const judge = (candidate) => rawJudge(
      buildAgentDecisionImportancePrompt(candidate),
    );

    const summary = await evaluate({
      memory,
      projectId: runtime.projectId,
      branch: runtime.branch,
      judge,
      apply: options.apply,
      limit: options.limit,
      evaluatorId: judgeResource.evaluatorId,
    });

    const output = {
      type: 'agent_hub_agent_decision_importance_judge',
      mode: options.apply ? 'apply' : 'dry-run',
      projectId: runtime.projectId,
      branch: runtime.branch,
      evaluatorId: judgeResource.evaluatorId,
      policyVersion: AGENT_DECISION_IMPORTANCE_POLICY_VERSION,
      summary,
      isolation: judgeResource.isolation ?? null,
    };
    log(JSON.stringify(output));
    return output;
  } finally {
    if (judgeResource && typeof judgeResource.close === 'function') {
      await judgeResource.close().catch(() => {});
    }
    memory.close();
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runAgentDecisionJudgeCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
