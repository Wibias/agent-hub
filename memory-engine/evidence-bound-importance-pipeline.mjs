import {
  EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
  buildEvidenceProposalJudgePrompt,
  parseEvidenceProposalJudgment,
  validateEvidenceProposalJudgment,
} from './evidence-bound-proposal-judge.mjs';
import {
  EvidenceBoundProposalStore,
} from './evidence-bound-proposal-store.mjs';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runEvidenceBoundImportancePipeline({
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
    const proposals = store.listUnevaluated({
      projectId,
      branch,
      limit,
    });
    const results = [];
    let evaluated = 0;
    let failed = 0;

    for (const proposal of proposals) {
      try {
        const prompt = buildEvidenceProposalJudgePrompt({ proposal });
        const raw = await judge({
          proposal,
          prompt,
          policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
        });
        const judgment = typeof raw === 'string'
          ? parseEvidenceProposalJudgment(raw)
          : validateEvidenceProposalJudgment(raw);
        const stored = store.evaluateImportance({
          proposalId: proposal.id,
          evaluatorId,
          policyVersion: EVIDENCE_PROPOSAL_JUDGE_POLICY_VERSION,
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
