import {
  EVIDENCE_RELATION_POLICY_VERSION,
  buildEvidenceRelationJudgePrompt,
  parseEvidenceRelationJudgment,
  validateEvidenceRelationJudgment,
} from './evidence-bound-relation-judge.mjs';
import { EvidenceBoundProposalStore } from './evidence-bound-proposal-store.mjs';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function deterministicUnrelated() {
  return {
    relation: 'unrelated',
    target_ref: null,
    confidence: 'high',
    meaning_preserved: true,
    reason: 'No active comparable durable claims exist in the current project and branch.',
  };
}

function resolveTarget(memories, relation) {
  if (relation.relation === 'unrelated') return null;
  const matches = memories.filter((memory) => memory.ref === relation.target_ref);
  if (matches.length !== 1) {
    throw new Error('relation target_ref does not resolve to exactly one supplied claim');
  }
  return matches[0];
}

export async function runEvidenceBoundRelationPipeline({
  dbPath,
  projectId,
  branch,
  judge,
  evaluatorId,
  inspectTextSensitivity,
  clock = () => new Date().toISOString(),
  limit = 20,
}) {
  if (typeof judge !== 'function') {
    throw new TypeError('judge must be a function');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }

  const store = new EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity,
    clock,
  });
  try {
    const proposals = store.listRelationPending({ projectId, branch, limit });
    const memories = store.activeRelationClaims({ projectId, branch });
    const results = [];
    let evaluated = 0;
    let failed = 0;

    for (const proposal of proposals) {
      try {
        let relation;
        if (memories.length === 0) {
          relation = deterministicUnrelated();
        } else {
          const prompt = buildEvidenceRelationJudgePrompt({ proposal, memories });
          const raw = await judge({
            proposal,
            memories,
            prompt,
            policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
          });
          relation = typeof raw === 'string'
            ? parseEvidenceRelationJudgment(raw)
            : validateEvidenceRelationJudgment(raw);
        }

        const target = resolveTarget(memories, relation);
        const stored = store.evaluateRelation({
          proposalId: proposal.id,
          evaluatorId,
          policyVersion: EVIDENCE_RELATION_POLICY_VERSION,
          relation,
          relatedClaimId: target?.claim_id ?? null,
          evaluatedAt: clock(),
        });
        evaluated += 1;
        results.push({
          proposal_id: proposal.id,
          ok: true,
          relation: relation.relation,
          target_ref: relation.target_ref,
          related_claim_id: stored.related_claim_id,
          status: stored.status,
        });
      } catch (error) {
        failed += 1;
        results.push({
          proposal_id: proposal.id,
          ok: false,
          relation: null,
          target_ref: null,
          related_claim_id: null,
          status: proposal.status,
          error: errorMessage(error),
        });
      }
    }

    return {
      total: proposals.length,
      evaluated,
      failed,
      results,
    };
  } finally {
    store.close();
  }
}
