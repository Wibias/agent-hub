#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES,
  PIPELINE_RELATION_HOLDOUT_V4_CASES,
} from '../memory-engine/memory-judge-pipeline-holdout-v4.mjs';
import {
  runMemoryJudgeHoldout,
} from './eval-codex-memory-judge-holdout.mjs';
import {
  summarizePipelineCaptureReachability,
} from './eval-codex-memory-judge-pipeline-holdout.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function expectedById(cases) {
  return new Map(cases.map((item) => [item.id, item.expected]));
}

export async function runMemoryJudgePipelineHoldoutV4({
  model = null,
  reasoningEffort = 'medium',
  cwd = process.cwd(),
  sourceCodexHome = (
    process.env.MEMORY_JUDGE_PIPELINE_HOLDOUT_V4_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  ),
  env = process.env,
  createImportanceJudge,
  createRelationJudge,
} = {}) {
  const importanceReachability = summarizePipelineCaptureReachability(
    PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES,
  );
  const relationReachability = summarizePipelineCaptureReachability(
    PIPELINE_RELATION_HOLDOUT_V4_CASES,
  );

  const options = {
    importanceCases: PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES,
    relationCases: PIPELINE_RELATION_HOLDOUT_V4_CASES,
    suite: 'pipeline-holdout-v4',
    model,
    reasoningEffort,
    cwd,
    sourceCodexHome,
    env,
  };
  if (createImportanceJudge !== undefined) {
    options.createImportanceJudge = createImportanceJudge;
  }
  if (createRelationJudge !== undefined) {
    options.createRelationJudge = createRelationJudge;
  }

  const result = await runMemoryJudgeHoldout(options);
  const reachabilityPass = (
    importanceReachability.reachable === importanceReachability.total
    && importanceReachability.type_matches === importanceReachability.total
    && relationReachability.reachable === relationReachability.total
    && relationReachability.type_matches === relationReachability.total
  );

  return {
    ...result,
    capture_reachability: {
      importance: importanceReachability,
      relation: relationReachability,
    },
    pipeline_gate: {
      pass: result.score.quality_gate.pass && reachabilityPass,
      judge_quality_pass: result.score.quality_gate.pass,
      capture_reachability_pass: reachabilityPass,
    },
  };
}

async function main() {
  const model = nonEmpty(process.env.MEMORY_JUDGE_PIPELINE_HOLDOUT_V4_MODEL)
    ? process.env.MEMORY_JUDGE_PIPELINE_HOLDOUT_V4_MODEL.trim()
    : null;
  const reasoningEffort = nonEmpty(
    process.env.MEMORY_JUDGE_PIPELINE_HOLDOUT_V4_REASONING_EFFORT,
  )
    ? process.env.MEMORY_JUDGE_PIPELINE_HOLDOUT_V4_REASONING_EFFORT
      .trim()
      .toLowerCase()
    : 'medium';
  const sourceCodexHome = (
    process.env.MEMORY_JUDGE_PIPELINE_HOLDOUT_V4_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  );

  const result = await runMemoryJudgePipelineHoldoutV4({
    model,
    reasoningEffort,
    sourceCodexHome,
    cwd: process.cwd(),
    env: process.env,
  });

  const importanceExpected = expectedById(
    PIPELINE_IMPORTANCE_HOLDOUT_V4_CASES,
  );
  const importanceReachability = new Map(
    result.capture_reachability.importance.cases.map(
      (item) => [item.id, item],
    ),
  );
  for (const prediction of result.importance_predictions) {
    console.log(JSON.stringify({
      type: 'memory_judge_pipeline_holdout_v4_importance_case',
      id: prediction.id,
      capture: importanceReachability.get(prediction.id) ?? null,
      expected: importanceExpected.get(prediction.id),
      observed: prediction,
    }));
  }

  const relationExpected = expectedById(
    PIPELINE_RELATION_HOLDOUT_V4_CASES,
  );
  const relationReachability = new Map(
    result.capture_reachability.relation.cases.map(
      (item) => [item.id, item],
    ),
  );
  for (const prediction of result.relation_predictions) {
    console.log(JSON.stringify({
      type: 'memory_judge_pipeline_holdout_v4_relation_case',
      id: prediction.id,
      capture: relationReachability.get(prediction.id) ?? null,
      expected: relationExpected.get(prediction.id),
      observed: prediction,
    }));
  }

  console.log(JSON.stringify({
    type: 'memory_judge_pipeline_holdout_v4_summary',
    suite: result.suite,
    model: result.model,
    reasoning_effort: result.reasoning_effort,
    policy_versions: result.policy_versions,
    isolation: result.isolation,
    capture_reachability: result.capture_reachability,
    score: result.score,
    pipeline_gate: result.pipeline_gate,
  }));

  if (!result.pipeline_gate.pass) process.exitCode = 1;
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
