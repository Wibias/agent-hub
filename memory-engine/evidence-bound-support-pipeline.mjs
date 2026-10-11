import {
  EVIDENCE_SUPPORT_POLICY_VERSION,
  buildEvidenceSupportJudgePrompt,
  parseEvidenceSupportJudgment,
  validateEvidenceSupportJudgment,
} from './evidence-bound-support-judge.mjs';
import { EvidenceBoundProposalStore } from './evidence-bound-proposal-store.mjs';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runEvidenceBoundSupportPipeline({
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
    const proposals = store.listSupportPending({ projectId, branch, limit });
    const results = [];
    let evaluated = 0;
    let failed = 0;

    for (const proposal of proposals) {
      try {
        const evidence = store.evidence(proposal.id);
        const prompt = buildEvidenceSupportJudgePrompt({ proposal, evidence });
        const raw = await judge({
          proposal,
          evidence,
          prompt,
          policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
        });
        const judgment = typeof raw === 'string'
          ? parseEvidenceSupportJudgment(raw)
          : validateEvidenceSupportJudgment(raw);
        const stored = store.evaluateSupport({
          proposalId: proposal.id,
          evaluatorId,
          policyVersion: EVIDENCE_SUPPORT_POLICY_VERSION,
          judgment,
          evaluatedAt: clock(),
        });
        evaluated += 1;
        results.push({
          proposal_id: proposal.id,
          ok: true,
          decision: judgment.decision,
          status: stored.status,
        });
      } catch (error) {
        failed += 1;
        results.push({
          proposal_id: proposal.id,
          ok: false,
          decision: null,
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
