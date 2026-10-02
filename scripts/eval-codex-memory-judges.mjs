#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  IMPORTANCE_JUDGE_CALIBRATION_CASES,
  RELATION_JUDGE_CALIBRATION_CASES,
  scoreMemoryJudgeCalibration,
} from '../memory-engine/memory-judge-calibration.mjs';
import {
  buildMemoryCandidateRelationPrompt,
  CANDIDATE_RELATION_POLICY_VERSION,
  parseMemoryCandidateRelation,
  validateMemoryCandidateRelation,
} from '../memory-engine/memory-candidate-relation.mjs';
import {
  CANDIDATE_JUDGE_POLICY_VERSION,
  parseMemoryCandidateJudgment,
  validateMemoryCandidateJudgment,
} from '../memory-engine/memory-candidate-judge.mjs';
import {
  createCodexMemoryCandidateJudge,
} from './judge-memory-candidates.mjs';
import {
  createCodexMemoryCandidateRelationJudge,
} from './judge-memory-relations.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJudgment(raw) {
  return typeof raw === 'string'
    ? parseMemoryCandidateJudgment(raw)
    : validateMemoryCandidateJudgment(raw);
}

function parseRelation(raw) {
  return typeof raw === 'string'
    ? parseMemoryCandidateRelation(raw)
    : validateMemoryCandidateRelation(raw);
}

function relationCandidate(caseSpec) {
  return {
    id: 'calibration:' + caseSpec.id,
    proposed_type: caseSpec.candidate.proposed_type,
    source_authority: 'user_direct',
    proposed_value: caseSpec.candidate.proposed_value,
    evaluation_json: JSON.stringify({
      decision: 'promote',
      suggested_type: caseSpec.candidate.proposed_type,
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: caseSpec.candidate.canonical_fact,
      reason: 'Calibration fixture canonical fact.',
      risk_flags: [],
    }),
  };
}

async function closeResource(resource) {
  if (resource && typeof resource.close === 'function') {
    await resource.close().catch(() => {});
  }
}

export async function runMemoryJudgeCalibration({
  importanceCases = IMPORTANCE_JUDGE_CALIBRATION_CASES,
  relationCases = RELATION_JUDGE_CALIBRATION_CASES,
  model = null,
  reasoningEffort = 'medium',
  cwd = process.cwd(),
  sourceCodexHome = (
    process.env.MEMORY_JUDGE_CALIBRATION_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  ),
  env = process.env,
  createImportanceJudge = createCodexMemoryCandidateJudge,
  createRelationJudge = createCodexMemoryCandidateRelationJudge,
} = {}) {
  if (!Array.isArray(importanceCases) || importanceCases.length === 0) {
    throw new TypeError('importanceCases must be a non-empty array');
  }
  if (!Array.isArray(relationCases) || relationCases.length === 0) {
    throw new TypeError('relationCases must be a non-empty array');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (!nonEmpty(cwd)) throw new TypeError('cwd must be a non-empty string');
  if (!nonEmpty(sourceCodexHome)) {
    throw new TypeError('sourceCodexHome must be a non-empty string');
  }
  if (typeof createImportanceJudge !== 'function') {
    throw new TypeError('createImportanceJudge must be a function');
  }
  if (typeof createRelationJudge !== 'function') {
    throw new TypeError('createRelationJudge must be a function');
  }

  let importanceResource = null;
  let relationResource = null;

  try {
    importanceResource = await createImportanceJudge({
      cwd,
      model,
      reasoningEffort,
      env,
      sourceCodexHome,
    });
    relationResource = await createRelationJudge({
      cwd,
      model,
      reasoningEffort,
      env,
      sourceCodexHome,
    });

    const importanceJudge = (
      typeof importanceResource === 'function'
        ? importanceResource
        : importanceResource?.judge
    );
    const relationJudge = (
      typeof relationResource === 'function'
        ? relationResource
        : relationResource?.judge
    );
    if (typeof importanceJudge !== 'function') {
      throw new TypeError('importance judge resource must expose judge()');
    }
    if (typeof relationJudge !== 'function') {
      throw new TypeError('relation judge resource must expose judge()');
    }

    const importancePredictions = [];
    for (const caseSpec of importanceCases) {
      try {
        const raw = await importanceJudge({
          ...caseSpec.candidate,
          calibration_id: caseSpec.id,
        });
        const judgment = parseJudgment(raw);
        importancePredictions.push({
          id: caseSpec.id,
          ok: true,
          decision: judgment.decision,
          confidence: judgment.confidence,
          judgment,
        });
      } catch (error) {
        importancePredictions.push({
          id: caseSpec.id,
          ok: false,
          decision: null,
          confidence: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const relationPredictions = [];
    for (const caseSpec of relationCases) {
      try {
        const candidate = relationCandidate(caseSpec);
        const prompt = buildMemoryCandidateRelationPrompt({
          candidate,
          memories: caseSpec.memories,
        });
        const raw = await relationJudge({
          prompt,
          caseSpec,
        });
        const relation = parseRelation(raw);
        relationPredictions.push({
          id: caseSpec.id,
          ok: true,
          relation: relation.relation,
          target_ref: relation.target_ref,
          confidence: relation.confidence,
          judgment: relation,
        });
      } catch (error) {
        relationPredictions.push({
          id: caseSpec.id,
          ok: false,
          relation: null,
          target_ref: null,
          confidence: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const score = scoreMemoryJudgeCalibration({
      importancePredictions,
      relationPredictions,
    });

    return {
      model: model ?? 'codex-default',
      reasoning_effort: reasoningEffort,
      policy_versions: {
        importance: CANDIDATE_JUDGE_POLICY_VERSION,
        relation: CANDIDATE_RELATION_POLICY_VERSION,
      },
      isolation: {
        importance: (
          typeof importanceResource === 'object'
            ? importanceResource.isolation ?? null
            : null
        ),
        relation: (
          typeof relationResource === 'object'
            ? relationResource.isolation ?? null
            : null
        ),
      },
      importance_predictions: importancePredictions,
      relation_predictions: relationPredictions,
      score,
    };
  } finally {
    await closeResource(relationResource);
    await closeResource(importanceResource);
  }
}

function expectedById(cases) {
  return new Map(cases.map((item) => [item.id, item.expected]));
}

async function main() {
  const model = nonEmpty(process.env.MEMORY_JUDGE_CALIBRATION_MODEL)
    ? process.env.MEMORY_JUDGE_CALIBRATION_MODEL.trim()
    : null;
  const reasoningEffort = nonEmpty(
    process.env.MEMORY_JUDGE_CALIBRATION_REASONING_EFFORT,
  )
    ? process.env.MEMORY_JUDGE_CALIBRATION_REASONING_EFFORT
      .trim()
      .toLowerCase()
    : 'medium';
  const sourceCodexHome = (
    process.env.MEMORY_JUDGE_CALIBRATION_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  );

  const result = await runMemoryJudgeCalibration({
    model,
    reasoningEffort,
    sourceCodexHome,
    cwd: process.cwd(),
    env: process.env,
  });

  const importanceExpected = expectedById(
    IMPORTANCE_JUDGE_CALIBRATION_CASES,
  );
  for (const prediction of result.importance_predictions) {
    console.log(JSON.stringify({
      type: 'memory_judge_calibration_importance_case',
      id: prediction.id,
      expected: importanceExpected.get(prediction.id),
      observed: prediction,
    }));
  }

  const relationExpected = expectedById(
    RELATION_JUDGE_CALIBRATION_CASES,
  );
  for (const prediction of result.relation_predictions) {
    console.log(JSON.stringify({
      type: 'memory_judge_calibration_relation_case',
      id: prediction.id,
      expected: relationExpected.get(prediction.id),
      observed: prediction,
    }));
  }

  console.log(JSON.stringify({
    type: 'memory_judge_calibration_summary',
    model: result.model,
    reasoning_effort: result.reasoning_effort,
    policy_versions: result.policy_versions,
    isolation: result.isolation,
    score: result.score,
  }));

  if (!result.score.quality_gate.pass) process.exitCode = 1;
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
