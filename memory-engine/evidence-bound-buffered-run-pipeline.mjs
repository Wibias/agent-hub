import { createHash } from 'node:crypto';

import {
  EVIDENCE_EXTRACTION_POLICY_VERSION,
  extractEvidenceBoundMemories,
} from './evidence-bound-extraction.mjs';
import { EvidenceBoundProposalStore } from './evidence-bound-proposal-store.mjs';
import { RunObservationBuffer } from './run-observation-buffer.mjs';
import { runEvidenceBoundImportancePipeline } from './evidence-bound-importance-pipeline.mjs';
import { runEvidenceBoundSupportPipeline } from './evidence-bound-support-pipeline.mjs';
import { runEvidenceBoundRelationPipeline } from './evidence-bound-relation-pipeline.mjs';
import { runEvidenceBoundPromotionPipeline } from './evidence-bound-promotion.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(value, name) {
  if (!nonEmptyString(value)) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function canonicalEvidenceIdForRunObservation(observationId) {
  requireString(observationId, 'observationId');
  return 'evidence:run-observation:' + createHash('sha256')
    .update(observationId, 'utf8')
    .digest('hex');
}

function assertDependencies({ protocol, memory, extractionJudge, inspectTextSensitivity }) {
  if (!protocol || typeof protocol.handle !== 'function') {
    throw new TypeError('protocol must expose handle()');
  }
  if (!memory || typeof memory.getEvidence !== 'function') {
    throw new TypeError('memory must support getEvidence()');
  }
  if (typeof extractionJudge !== 'function') {
    throw new TypeError('extractionJudge must be a function');
  }
  if (typeof inspectTextSensitivity !== 'function') {
    throw new TypeError('inspectTextSensitivity must be a function');
  }
}

function validateMaterializedEvidence(evidence, observation, canonicalId) {
  if (
    !evidence
    || evidence.id !== canonicalId
    || evidence.project_id !== observation.project_id
    || evidence.branch !== observation.branch
    || evidence.authority_class !== observation.authority_class
    || evidence.sensitivity === 'secret_redacted'
    || evidence.content_redacted !== observation.content_redacted
  ) {
    throw new Error('materialized run observation evidence invariant failed');
  }
  return evidence;
}

async function materializeObservation({
  protocol,
  memory,
  observation,
}) {
  const canonicalId = canonicalEvidenceIdForRunObservation(observation.id);
  const existing = memory.getEvidence(canonicalId);
  if (existing) {
    return validateMaterializedEvidence(existing, observation, canonicalId);
  }

  const metadata = {
    ...observation.metadata,
    passive_run_extraction: true,
    run_observation_id: observation.id,
  };
  const response = await protocol.handle({
    protocol: 'memory.protocol.v1',
    operation: 'capture_evidence',
    request_id: 'run-observation:' + createHash('sha256')
      .update(observation.id, 'utf8')
      .digest('hex')
      .slice(0, 24),
    payload: {
      id: canonicalId,
      project_id: observation.project_id,
      harness: 'codex',
      session_id: observation.session_id,
      source_kind: observation.source_kind,
      source_ref: observation.source_ref,
      captured_at: observation.observed_at,
      branch: observation.branch,
      commit_sha: observation.metadata?.revision_sha ?? null,
      path: null,
      blob_oid: null,
      content: observation.content_redacted,
      metadata,
    },
  });
  if (!response?.ok) {
    throw new Error('canonical evidence capture failed');
  }
  return validateMaterializedEvidence(
    response.result?.evidence,
    observation,
    canonicalId,
  );
}


export function inspectBufferedTurnEligibility({
  dbPath,
  projectId,
  branch,
  sessionId,
  turnId,
}) {
  for (const [value, name] of [
    [dbPath, 'dbPath'],
    [projectId, 'projectId'],
    [branch, 'branch'],
    [sessionId, 'sessionId'],
    [turnId, 'turnId'],
  ]) requireString(value, name);

  const buffer = new RunObservationBuffer({ dbPath, readOnly: true });
  try {
    const observations = buffer.listTurn({
      projectId, branch, sessionId, turnId,
    });
    const hasUserPromptObservation = observations.some((observation) => (
      observation.authority_class === 'user_direct'
      && observation.source_kind === 'session'
      && observation.metadata?.event_type === 'user_prompt'
    ));
    return {
      eligible: observations.length > 0 && hasUserPromptObservation,
      observations,
      reason: observations.length === 0
        ? 'empty_turn_buffer'
        : hasUserPromptObservation
          ? null
          : 'missing_user_prompt_observation',
    };
  } finally {
    buffer.close();
  }
}

export async function runEvidenceBoundExtractionFromBufferedTurn({
  dbPath,
  protocol,
  memory,
  projectId,
  branch,
  sessionId,
  turnId,
  extractionJudge,
  evaluatorId,
  inspectTextSensitivity,
  clock = () => new Date().toISOString(),
}) {
  requireString(dbPath, 'dbPath');
  requireString(projectId, 'projectId');
  requireString(branch, 'branch');
  requireString(sessionId, 'sessionId');
  requireString(turnId, 'turnId');
  requireString(evaluatorId, 'evaluatorId');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  assertDependencies({ protocol, memory, extractionJudge, inspectTextSensitivity });

  const eligibility = inspectBufferedTurnEligibility({
    dbPath, projectId, branch, sessionId, turnId,
  });
  const observations = eligibility.observations;

  if (!eligibility.eligible) {
    return {
      policy_version: EVIDENCE_EXTRACTION_POLICY_VERSION,
      project_id: projectId,
      branch,
      observations: observations.length,
      materialized_evidence_ids: [],
      proposals: [],
      failed: 0,
      results: [],
      ...(eligibility.reason === 'missing_user_prompt_observation'
        ? { skipped_reason: eligibility.reason }
        : {}),
    };
  }

  const extraction = await extractEvidenceBoundMemories({
    projectId,
    branch,
    evidence: observations,
    judge: extractionJudge,
  });
  if (extraction.memories.length === 0) {
    return {
      ...extraction,
      observations: observations.length,
      materialized_evidence_ids: [],
      proposals: [],
      failed: 0,
      results: [],
    };
  }

  const observationById = new Map(observations.map((item) => [item.id, item]));
  const materializedByObservation = new Map();
  const proposalStore = new EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity,
    clock,
  });
  const proposals = [];
  const results = [];
  let failed = 0;

  try {
    for (const proposal of extraction.memories) {
      try {
        const canonicalEvidenceIds = [];
        for (const observationId of proposal.evidence_ids) {
          let evidence = materializedByObservation.get(observationId);
          if (!evidence) {
            const observation = observationById.get(observationId);
            if (!observation) {
              throw new Error('cited run observation disappeared: ' + observationId);
            }
            evidence = await materializeObservation({
              protocol,
              memory,
              observation,
            });
            materializedByObservation.set(observationId, evidence);
          }
          canonicalEvidenceIds.push(evidence.id);
        }

        const stored = proposalStore.record({
          id: 'evidence-proposal:' + proposal.fingerprint,
          projectId,
          branch,
          kind: proposal.kind,
          canonicalFact: proposal.canonical_fact,
          evidenceIds: canonicalEvidenceIds,
          fingerprint: proposal.fingerprint,
          policyVersion: extraction.policy_version,
          evaluatorId,
          createdAt: clock(),
        });
        proposals.push(stored);
        results.push({
          proposal_id: stored.id,
          ok: true,
          evidence_ids: stored.evidence_ids,
        });
      } catch (error) {
        failed += 1;
        results.push({
          proposal_id: 'evidence-proposal:' + proposal.fingerprint,
          ok: false,
          evidence_ids: [],
          error: errorMessage(error),
        });
      }
    }
  } finally {
    proposalStore.close();
  }

  return {
    policy_version: extraction.policy_version,
    project_id: projectId,
    branch,
    observations: observations.length,
    materialized_evidence_ids: [...materializedByObservation.values()]
      .map((item) => item.id)
      .sort((left, right) => left.localeCompare(right, 'en')),
    proposals,
    failed,
    results,
  };
}

export async function runEvidenceBoundBufferedMemoryPipeline({
  dbPath,
  protocol,
  memory,
  projectId,
  branch,
  sessionId,
  turnId,
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
    requireString(evaluatorIds[key], 'evaluatorIds.' + key);
  }

  const extraction = await runEvidenceBoundExtractionFromBufferedTurn({
    dbPath,
    protocol,
    memory,
    projectId,
    branch,
    sessionId,
    turnId,
    extractionJudge,
    evaluatorId: evaluatorIds.extraction,
    inspectTextSensitivity,
    clock,
  });

  const emptyStage = () => ({ total: 0, evaluated: 0, failed: 0, results: [] });
  const emptyPromotion = () => ({
    total: 0,
    promoted: 0,
    superseded: 0,
    needs_confirmation: 0,
    failed: 0,
    results: [],
  });

  if (extraction.skipped_reason || extraction.proposals.length === 0) {
    return {
      extraction,
      importance: emptyStage(),
      support: emptyStage(),
      relation: emptyStage(),
      promotion: emptyPromotion(),
    };
  }

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

  const relation = emptyStage();
  const promotion = emptyPromotion();
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
    if (!workObserved || !progressed) break;
  }

  return { extraction, importance, support, relation, promotion };
}
