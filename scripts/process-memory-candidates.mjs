#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  validateMemoryCandidateJudgment,
} from '../memory-engine/memory-candidate-judge.mjs';
import {
  resolveMemoryCandidateJudgeRuntime,
  runMemoryCandidateJudgeCli,
} from './judge-memory-candidates.mjs';
import {
  runMemoryCandidateRelationCli,
} from './judge-memory-relations.mjs';
import {
  runMemoryCandidatePromotionCli,
} from './promote-memory-candidates.mjs';
import {
  runAgentDecisionJudgeCli,
} from './judge-agent-memory-candidates.mjs';
import {
  runAgentDecisionRelationCli,
} from './judge-agent-memory-relations.mjs';
import {
  runAgentDecisionPromotionCli,
} from './promote-agent-memory-candidates.mjs';

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

export function parseMemoryCandidatePipelineArgs(
  argv = [],
  defaultCwd = process.cwd(),
) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

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
        const normalized = value.trim().toLowerCase();
        if (!['low', 'medium', 'high'].includes(normalized)) {
          throw new Error('--reasoning-effort must be low, medium, or high');
        }
        options.reasoningEffort = normalized;
      }
      continue;
    }

    throw new Error('unknown argument: ' + arg);
  }

  return options;
}

function isEvaluatedKeptCandidate(candidate) {
  if (
    !candidate
    || candidate.status !== 'pending'
    || candidate.evaluated_at === null
    || typeof candidate.evaluation_json !== 'string'
    || candidate.relation !== null
  ) {
    return false;
  }
  try {
    return validateMemoryCandidateJudgment(
      JSON.parse(candidate.evaluation_json),
    ).decision === 'keep_candidate';
  } catch {
    return false;
  }
}

function readPipelineStatus({
  createMemory,
  runtime,
  limit,
}) {
  const memory = createMemory({ dbPath: runtime.dbPath });
  try {
    if (typeof memory.listUnevaluatedCandidates !== 'function') {
      throw new TypeError('memory does not support unevaluated candidate listing');
    }
    if (typeof memory.listRelationPendingCandidates !== 'function') {
      throw new TypeError('memory does not support relation-pending candidate listing');
    }
    if (typeof memory.listPromotionReadyCandidates !== 'function') {
      throw new TypeError('memory does not support promotion-ready candidate listing');
    }
    if (typeof memory.listScopedCandidates !== 'function') {
      throw new TypeError('memory does not support scoped candidate listing');
    }
    if (typeof memory.listUnevaluatedAgentCandidates !== 'function') {
      throw new TypeError('memory does not support unevaluated agent candidate listing');
    }
    if (typeof memory.listAgentRelationPendingCandidates !== 'function') {
      throw new TypeError('memory does not support agent relation-pending candidate listing');
    }
    if (typeof memory.listAgentPromotionReadyCandidates !== 'function') {
      throw new TypeError('memory does not support agent promotion-ready candidate listing');
    }

    const importanceReady = memory.listUnevaluatedCandidates({
      projectId: runtime.projectId,
      branch: runtime.branch,
      limit,
    }).length;
    const relationReady = memory.listRelationPendingCandidates({
      projectId: runtime.projectId,
      branch: runtime.branch,
      limit,
    }).length;
    const promotionReady = memory.listPromotionReadyCandidates({
      projectId: runtime.projectId,
      branch: runtime.branch,
      limit,
    }).length;
    const agentImportanceReady = memory.listUnevaluatedAgentCandidates({
      projectId: runtime.projectId,
      branch: runtime.branch,
      limit,
    }).length;
    const agentRelationReady = memory.listAgentRelationPendingCandidates({
      projectId: runtime.projectId,
      branch: runtime.branch,
      limit,
    }).length;
    const agentPromotionReady = memory.listAgentPromotionReadyCandidates({
      projectId: runtime.projectId,
      branch: runtime.branch,
      limit,
    }).length;
    const scoped = memory.listScopedCandidates({
      projectId: runtime.projectId,
      branch: runtime.branch,
    });
    const needsConfirmation = scoped.filter(
      (candidate) => candidate.status === 'needs_confirmation',
    ).length;
    const keptForReview = scoped.filter(isEvaluatedKeptCandidate).length;

    return {
      batch_limit: limit,
      importance_ready: importanceReady,
      relation_ready: relationReady,
      promotion_ready: promotionReady,
      agent_importance_ready: agentImportanceReady,
      agent_relation_ready: agentRelationReady,
      agent_promotion_ready: agentPromotionReady,
      needs_confirmation: needsConfirmation,
      kept_for_review: keptForReview,
    };
  } finally {
    if (memory && typeof memory.close === 'function') memory.close();
  }
}

function stageArgv(runtime, options, {
  ai = false,
} = {}) {
  const argv = [
    '--apply',
    '--cwd', runtime.cwd,
    '--db-path', runtime.dbPath,
    '--limit', String(options.limit),
  ];

  if (ai) {
    if (options.model) argv.push('--model', options.model);
    argv.push('--reasoning-effort', options.reasoningEffort);
  }

  return argv;
}

async function executeStage({
  name,
  ready,
  runner,
  argv,
  cwd,
  runtime,
}) {
  if (ready < 1) {
    return {
      name,
      skipped: true,
      reason: 'no_eligible_candidates',
      result: null,
    };
  }

  const result = await runner({
    argv,
    cwd,
    log() {},
    dependencies: {
      resolveRuntime() {
        return runtime;
      },
    },
  });

  return {
    name,
    skipped: false,
    reason: null,
    result,
  };
}

export async function runMemoryCandidatePipelineCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  log = console.log,
  dependencies = {},
} = {}) {
  const options = parseMemoryCandidatePipelineArgs(argv, cwd);
  const resolveRuntime = dependencies.resolveRuntime
    || resolveMemoryCandidateJudgeRuntime;
  const createMemory = dependencies.createMemory
    || (({ dbPath }) => new MemoryEngine({ dbPath }));
  const runImportance = dependencies.runImportance
    || runMemoryCandidateJudgeCli;
  const runRelation = dependencies.runRelation
    || runMemoryCandidateRelationCli;
  const runPromotion = dependencies.runPromotion
    || runMemoryCandidatePromotionCli;
  const runAgentImportance = dependencies.runAgentImportance
    || runAgentDecisionJudgeCli;
  const runAgentRelation = dependencies.runAgentRelation
    || runAgentDecisionRelationCli;
  const runAgentPromotion = dependencies.runAgentPromotion
    || runAgentDecisionPromotionCli;

  const runtime = resolveRuntime({
    cwd: options.cwd,
    dbPath: options.dbPath,
  });

  const status = () => readPipelineStatus({
    createMemory,
    runtime,
    limit: options.limit,
  });

  const initial = status();
  const stages = [];

  if (options.apply) {
    stages.push(await executeStage({
      name: 'importance',
      ready: initial.importance_ready,
      runner: runImportance,
      argv: stageArgv(runtime, options, { ai: true }),
      cwd: runtime.cwd,
      runtime,
    }));

    const afterImportance = status();
    stages.push(await executeStage({
      name: 'relation',
      ready: afterImportance.relation_ready,
      runner: runRelation,
      argv: stageArgv(runtime, options, { ai: true }),
      cwd: runtime.cwd,
      runtime,
    }));

    const afterRelation = status();
    stages.push(await executeStage({
      name: 'promotion',
      ready: afterRelation.promotion_ready,
      runner: runPromotion,
      argv: stageArgv(runtime, options),
      cwd: runtime.cwd,
      runtime,
    }));

    const afterUserPromotion = status();
    stages.push(await executeStage({
      name: 'agent_importance',
      ready: afterUserPromotion.agent_importance_ready,
      runner: runAgentImportance,
      argv: stageArgv(runtime, options, { ai: true }),
      cwd: runtime.cwd,
      runtime,
    }));

    const afterAgentImportance = status();
    stages.push(await executeStage({
      name: 'agent_relation',
      ready: afterAgentImportance.agent_relation_ready,
      runner: runAgentRelation,
      argv: stageArgv(runtime, options, { ai: true }),
      cwd: runtime.cwd,
      runtime,
    }));

    const afterAgentRelation = status();
    stages.push(await executeStage({
      name: 'agent_promotion',
      ready: afterAgentRelation.agent_promotion_ready,
      runner: runAgentPromotion,
      argv: stageArgv(runtime, options),
      cwd: runtime.cwd,
      runtime,
    }));
  }

  const final = options.apply ? status() : initial;
  const output = {
    type: 'agent_hub_memory_candidate_pipeline',
    mode: options.apply ? 'apply' : 'status',
    projectId: runtime.projectId,
    branch: runtime.branch,
    revisionSha: runtime.revisionSha ?? null,
    initial,
    stages,
    final,
  };

  log(JSON.stringify(output));
  return output;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runMemoryCandidatePipelineCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
