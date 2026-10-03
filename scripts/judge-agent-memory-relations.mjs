#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGENT_DECISION_RELATION_POLICY_VERSION,
  buildAgentDecisionRelationPrompt,
  evaluateAgentDecisionRelations,
} from '../memory-engine/agent-decision-relation.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  resolveMemoryCandidateJudgeRuntime,
} from './judge-memory-candidates.mjs';
import {
  createIsolatedCodexJsonJudge,
} from './codex-isolated-memory-judge.mjs';
import {
  parseAgentDecisionJudgeArgs,
} from './judge-agent-memory-candidates.mjs';

export async function runAgentDecisionRelationCli({
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
  const evaluate = dependencies.evaluate || evaluateAgentDecisionRelations;
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
      workspaceLabel: 'agent-decision-relation',
      policyVersion: AGENT_DECISION_RELATION_POLICY_VERSION,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    });
    const rawJudge = judgeResource.judge;
    if (typeof rawJudge !== 'function') {
      throw new TypeError('agent relation judge factory must return judge()');
    }
    const judge = ({ candidate, memories }) => rawJudge(
      buildAgentDecisionRelationPrompt({
        candidate,
        memories,
      }),
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
      type: 'agent_hub_agent_decision_relation_judge',
      mode: options.apply ? 'apply' : 'dry-run',
      projectId: runtime.projectId,
      branch: runtime.branch,
      evaluatorId: judgeResource.evaluatorId,
      policyVersion: AGENT_DECISION_RELATION_POLICY_VERSION,
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
  runAgentDecisionRelationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
