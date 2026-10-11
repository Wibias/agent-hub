import { runEvidenceBoundExtractionPipeline } from './evidence-bound-pipeline.mjs';
import { runEvidenceBoundImportancePipeline } from './evidence-bound-importance-pipeline.mjs';
import { runEvidenceBoundSupportPipeline } from './evidence-bound-support-pipeline.mjs';
import { runEvidenceBoundRelationPipeline } from './evidence-bound-relation-pipeline.mjs';
import { runEvidenceBoundPromotionPipeline } from './evidence-bound-promotion.mjs';
import { runInstrumentedMemoryJudge } from './model-judge-telemetry.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function runEvidenceBoundMemoryPipeline({
  dbPath,
  memory,
  projectId,
  branch,
  evidence,
  extractionJudge,
  importanceJudge,
  supportJudge,
  relationJudge,
  evaluatorIds,
  inspectTextSensitivity,
  clock = () => new Date().toISOString(),
  limit = 20,
}) {
  if (!evaluatorIds || typeof evaluatorIds !== 'object' || Array.isArray(evaluatorIds)) {
    throw new TypeError('evaluatorIds must be an object');
  }
  for (const key of ['extraction', 'importance', 'support', 'relation']) {
    if (!nonEmptyString(evaluatorIds[key])) {
      throw new TypeError('evaluatorIds.' + key + ' must be a non-empty string');
    }
  }

  const extraction = await runEvidenceBoundExtractionPipeline({
    dbPath,
    projectId,
    branch,
    evidence,
    judge: extractionJudge,
    evaluatorId: evaluatorIds.extraction,
    inspectTextSensitivity,
    clock,
  });

  const importance = await runEvidenceBoundImportancePipeline({
    dbPath,
    projectId,
    branch,
    judge: importanceJudge,
    evaluatorId: evaluatorIds.importance,
    inspectTextSensitivity,
    clock,
    limit,
  });

  const support = await runEvidenceBoundSupportPipeline({
    dbPath,
    projectId,
    branch,
    judge: supportJudge,
    evaluatorId: evaluatorIds.support,
    inspectTextSensitivity,
    clock,
    limit,
  });

  const relation = {
    total: 0,
    evaluated: 0,
    failed: 0,
    results: [],
  };
  const promotion = {
    total: 0,
    promoted: 0,
    superseded: 0,
    needs_confirmation: 0,
    failed: 0,
    results: [],
  };

  // Relation and promotion are deliberately interleaved one proposal at a
  // time. A claim created by proposal N must be visible when proposal N+1 is
  // compared, otherwise sibling paraphrases can both be classified as
  // unrelated and promoted as duplicate claims in the same run.
  const maxRounds = Math.max(1, limit * 2);
  for (let round = 0; round < maxRounds; round += 1) {
    const relationStep = await runEvidenceBoundRelationPipeline({
      dbPath,
      projectId,
      branch,
      judge: relationJudge,
      evaluatorId: evaluatorIds.relation,
      inspectTextSensitivity,
      clock,
      limit: 1,
    });
    relation.total += relationStep.total;
    relation.evaluated += relationStep.evaluated;
    relation.failed += relationStep.failed;
    relation.results.push(...relationStep.results);

    const promotionStep = await runEvidenceBoundPromotionPipeline({
      dbPath,
      memory,
      projectId,
      branch,
      inspectTextSensitivity,
      clock,
      limit: 1,
    });
    promotion.total += promotionStep.total;
    promotion.promoted += promotionStep.promoted;
    promotion.superseded += promotionStep.superseded;
    promotion.needs_confirmation += promotionStep.needs_confirmation;
    promotion.failed += promotionStep.failed;
    promotion.results.push(...promotionStep.results);

    const progressed = (
      relationStep.evaluated
      + promotionStep.promoted
      + promotionStep.superseded
      + promotionStep.needs_confirmation
    ) > 0;
    const workObserved = relationStep.total > 0 || promotionStep.total > 0;

    if (!workObserved) break;
    if (!progressed) {
      // Failed proposals remain untouched for audit/retry. Stop rather than
      // repeatedly selecting the same row and spinning forever.
      break;
    }
  }

  return {
    extraction,
    importance,
    support,
    relation,
    promotion,
  };
}

export async function createEvidenceBoundJudgeBundle({
  createJsonJudge,
  model = null,
  reasoningEffort = 'medium',
  env = process.env,
  timeoutMs = 120_000,
  onUsage = null,
  clockMs = Date.now,
} = {}) {
  if (typeof createJsonJudge !== 'function') {
    throw new TypeError('createJsonJudge must be a function');
  }
  if (model !== null && !nonEmptyString(model)) {
    throw new TypeError('model must be null or a non-empty string');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  if (onUsage !== null && typeof onUsage !== 'function') {
    throw new TypeError('onUsage must be a function or null');
  }
  if (typeof clockMs !== 'function') {
    throw new TypeError('clockMs must be a function');
  }

  const runner = await createJsonJudge({
    workspaceLabel: 'evidence-bound-memory',
    policyVersion: 'evidence-bound-pipeline-v1',
    model,
    reasoningEffort,
    env,
    timeoutMs,
  });
  if (!runner || typeof runner.judge !== 'function') {
    throw new TypeError('createJsonJudge must return an object with judge()');
  }

  const evaluatorPrefix = 'codex:' + (model || 'default') + ':';
  const evaluatorIds = {
    extraction: evaluatorPrefix + 'evidence-extraction-v1',
    importance: evaluatorPrefix + 'evidence-importance-v1',
    support: evaluatorPrefix + 'evidence-support-v1',
    relation: evaluatorPrefix + 'evidence-relation-v1',
  };
  const getUsage = typeof runner.lastUsage === 'function'
    ? () => runner.lastUsage()
    : () => null;
  const makeJudge = (stage, evaluatorId) => async ({ prompt }) => {
    if (!nonEmptyString(prompt)) {
      throw new TypeError('pipeline judge prompt must be a non-empty string');
    }
    return runInstrumentedMemoryJudge({
      stage,
      evaluatorId,
      prompt,
      judge: (value) => runner.judge(value),
      getUsage,
      onUsage,
      clockMs,
    });
  };

  return {
    extractionJudge: makeJudge('evidence_extraction', evaluatorIds.extraction),
    importanceJudge: makeJudge('evidence_importance', evaluatorIds.importance),
    supportJudge: makeJudge('evidence_support', evaluatorIds.support),
    relationJudge: makeJudge('evidence_relation', evaluatorIds.relation),
    evaluatorIds,
    async close() {
      if (typeof runner.close === 'function') await runner.close();
    },
  };
}
