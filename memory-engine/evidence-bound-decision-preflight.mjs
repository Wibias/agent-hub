import { createHash } from 'node:crypto';
import { getEvidenceBoundProposal } from './evidence-bound-proposal-store.mjs';

const REVIEW_REF = /^E~[0-9a-f]{10}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const ELIGIBLE = new Set(['user_direct', 'repo_trusted', 'tool_observation']);
const MAX_PROPOSALS = 10000;
const MAX_CLAIMS = 200;
const SHA = value => createHash('sha256').update(value, 'utf8').digest('hex');
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();

export function evidenceBoundDecisionRef(id) {
  if (typeof id !== 'string' || !id) throw new TypeError('proposal id required');
  // Match the existing unified Review UI ref, not legacy ~p references.
  return 'E~' + SHA(id).slice(0, 10);
}

export function inspectEvidenceBoundDecision({
  db, projectId, branch, revisionSha, selectedRef,
  showLocalContent = false,
} = {}) {
  if (!db || typeof db.prepare !== 'function'
    || typeof projectId !== 'string' || !projectId.trim()
    || typeof branch !== 'string' || !branch.trim()
    || !GIT_SHA.test(revisionSha ?? '')
    || !REVIEW_REF.test(selectedRef ?? '')
    || typeof showLocalContent !== 'boolean') {
    throw new TypeError('exact DB, project, branch, revision, ref and content option required');
  }
  const report = {
    type: 'agent_hub_evidence_bound_decision_preflight_v1',
    scope: { projectId, branch, revisionSha },
    selectedRef,
    readOnly: true,
    decisionsApplied: 0,
    claimsCreated: 0,
    writesToSource: false,
    promotionAllowed: false,
    hostUserOriginAuthenticated: false,
    contentIncluded: false,
  };
  const hasTable = name => Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name));
  if (!['memory_evidence_proposals', 'memory_evidence_proposal_evidence',
    'evidence', 'claims'].every(hasTable)) {
    return { ...report, status: 'required_ledger_missing' };
  }
  try {
    const ids = db.prepare(
      "SELECT id FROM memory_evidence_proposals WHERE project_id=? AND branch=? "
      + "AND status='needs_confirmation' ORDER BY id LIMIT ?",
    ).all(projectId, branch, MAX_PROPOSALS + 1);
    if (ids.length > MAX_PROPOSALS) {
      return { ...report, status: 'too_many_proposals_to_resolve_safely' };
    }
    const found = ids.filter(row => evidenceBoundDecisionRef(row.id) === selectedRef);
    if (found.length !== 1) {
      return { ...report, status: found.length ? 'opaque_ref_collision' : 'not_found' };
    }
    const proposal = getEvidenceBoundProposal(db, found[0].id);
    if (!proposal || proposal.status !== 'needs_confirmation'
      || proposal.project_id !== projectId || proposal.branch !== branch
      || typeof proposal.canonical_fact !== 'string' || !proposal.canonical_fact
      || !/^[0-9a-f]{64}$/u.test(proposal.fingerprint)) {
      return { ...report, status: 'proposal_integrity_invalid' };
    }
    const sources = db.prepare(
      'SELECT l.evidence_id, e.id AS source_id, e.project_id, e.branch, '
      + 'e.authority_class, e.sensitivity, e.content_redacted, e.metadata_json '
      + 'FROM memory_evidence_proposal_evidence l '
      + 'LEFT JOIN evidence e ON e.id=l.evidence_id '
      + 'WHERE l.proposal_id=? ORDER BY l.evidence_id',
    ).all(proposal.id);
    if (sources.length < 1 || sources.length > 10
      || sources.length !== proposal.evidence_ids.length
      || sources.some((s, i) => s.evidence_id !== proposal.evidence_ids[i])) {
      return { ...report, status: 'proposal_evidence_incomplete' };
    }
    const evidenceSafe = sources.every(s => {
      if (!s.source_id || s.project_id !== projectId || s.branch !== branch
        || s.sensitivity !== 'normal' || !ELIGIBLE.has(s.authority_class)
        || typeof s.content_redacted !== 'string') return false;
      if (proposal.kind === 'preference' && s.authority_class !== 'user_direct') return false;
      if (s.authority_class === 'tool_observation') {
        let metadata;
        try { metadata = JSON.parse(s.metadata_json ?? '{}'); } catch { return false; }
        if (metadata?.tool_outcome === 'failure') return false;
      }
      return true;
    });
    if (!evidenceSafe) return { ...report, status: 'source_authority_or_scope_invalid' };
    const claimTotal = Number(db.prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=? AND state='active'",
    ).get(projectId, branch).n);
    if (!Number.isSafeInteger(claimTotal) || claimTotal > MAX_CLAIMS) {
      return { ...report, status: 'claim_comparison_not_bounded' };
    }
    const claims = db.prepare(
      "SELECT id, value_text FROM claims WHERE project_id=? AND branch_scope=? AND state='active' "
      + 'ORDER BY id LIMIT ?',
    ).all(projectId, branch, MAX_CLAIMS + 1);
    if (claims.length !== claimTotal) {
      return { ...report, status: 'claim_comparison_incomplete' };
    }
    const duplicates = claims.filter(c => normalized(c.value_text) === normalized(proposal.canonical_fact));
    const relation = proposal.relation?.relation ?? null;
    const targetId = proposal.related_claim_id;
    if (relation !== null && !['same', 'update', 'contradict', 'unrelated'].includes(relation)) {
      return { ...report, status: 'relation_invalid' };
    }
    const matchingTarget = targetId === null
      ? null : claims.find(c => c.id === targetId);
    if ((relation === 'unrelated' && targetId !== null)
      || (relation !== null && relation !== 'unrelated' && !matchingTarget)) {
      return { ...report, status: 'relation_target_missing_or_foreign' };
    }
    const fingerprint = SHA(JSON.stringify({
      revisionSha,
      projectId, branch,
      id: proposal.id,
      kind: proposal.kind,
      fact: proposal.canonical_fact,
      status: proposal.status,
      policy: proposal.policy_version,
      proposalFingerprint: proposal.fingerprint,
      createdAt: proposal.created_at,
      importance: proposal.importance,
      support: proposal.support,
      relation: proposal.relation,
      targetId,
      sources: sources.map(s => [
        s.source_id, s.project_id, s.branch, s.authority_class,
        s.sensitivity, SHA(s.content_redacted), SHA(s.metadata_json ?? ''),
      ]),
      claims: claims.map(c => [c.id, SHA(c.value_text)]),
    }));
    const blockers = [];
    if (duplicates.length > 0) blockers.push('active_exact_duplicate');
    if (claimTotal > 0) blockers.push('independent_semantic_relation_review_required');
    if (proposal.importance?.decision !== 'promote') blockers.push('importance_requires_review');
    if (proposal.support?.decision !== 'supported') blockers.push('evidence_support_requires_review');
    if (relation === null) blockers.push('relation_requires_review');
    if (relation === 'same' || relation === 'update' || relation === 'contradict') {
      blockers.push('targeted_claim_requires_separate_review');
    }
    const evidence = sources.map(s => ({
      evidenceRef: '~e' + SHA(s.source_id).slice(0, 12),
      authority: s.authority_class,
      sensitivity: s.sensitivity,
      exactSourceHash: SHA(s.content_redacted),
      ...(showLocalContent ? { localRedactedSource: s.content_redacted } : {}),
    }));
    return {
      ...report,
      status: blockers.length ? 'requires_review' : 'reviewable_no_write_authority',
      canonicalFactHash: SHA(proposal.canonical_fact),
      ...(showLocalContent ? { canonicalFact: proposal.canonical_fact, contentIncluded: true } : {}),
      kind: proposal.kind,
      evidence,
      relation: {
        type: relation,
        targetRef: matchingTarget ? '@' + SHA(matchingTarget.id).slice(0, 10) : null,
        confidence: proposal.relation?.confidence ?? null,
        meaningPreserved: proposal.relation?.meaning_preserved === true,
      },
      activeClaimsInScope: claimTotal,
      exactDuplicateCount: duplicates.length,
      blockers,
      reviewSnapshotSha256: fingerprint,
      requiresFreshLocalUserDecision: true,
      decisionCommandEnabled: false,
    };
  } catch {
    // Do not leak SQL, source content, paths or raw IDs in diagnostic failure.
    return { ...report, status: 'schema_or_integrity_error' };
  }
}
