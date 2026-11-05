/**
 * D8: investigate repository Evidence coverage through canonical counts only.
 * Input may contain private content; output MUST contain only bounded labels,
 * counts and caller-supplied scope identifiers. No Git trust is inferred.
 */

const MAX_GRAPH_NODES = 500;
const OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const SHA = /^[a-f0-9]{40}$/i;

/** Match the repository-detection predicate in memory-graph-v2.mjs. */
export function isRepositoryEvidenceForAudit(evidence) {
  if (!evidence) return false;
  return evidence.path != null || evidence.blob_oid != null
    || evidence.authority_class === 'repo_trusted'
    || /^(?:repo|repository|git)(?:$|[_/-])/.test(String(evidence.source_kind ?? '').toLowerCase());
}

function validEvidencePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 4096
    && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/')
    && !path.startsWith(':') && !/[*?\[\]]/.test(path)
    && !path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function claimSort(left, right) {
  const active = Number(right.state === 'active') - Number(left.state === 'active');
  const dateValue = (x) => Number.isFinite(Date.parse(x ?? '')) ? Date.parse(x) : 0;
  return active || dateValue(right.created_at) - dateValue(left.created_at)
    || String(left.id).localeCompare(String(right.id), 'en');
}

/** Produce a path-free forensic explanation for absent repository Graph claims. */
export function auditRepositoryEvidence(canonical, { projectId, branch } = {}) {
  if (!canonical || !Array.isArray(canonical.projects) || !Array.isArray(canonical.claims)
      || !Array.isArray(canonical.evidence) || !Array.isArray(canonical.claim_evidence)) {
    throw new TypeError('canonical export arrays required');
  }
  if (typeof projectId !== 'string' || !projectId.trim()
      || typeof branch !== 'string' || !branch.trim()) {
    throw new TypeError('projectId and branch required');
  }
  if (!canonical.projects.some((p) => p.project_id === projectId)) {
    throw new TypeError('scope not registered');
  }
  const projectEvidence = canonical.evidence.filter((e) => e.project_id === projectId);
  const evidenceById = new Map(projectEvidence.map((e) => [e.id, e]));
  const scopedClaims = canonical.claims.filter((c) => c.project_id === projectId
    && c.branch_scope === branch).sort(claimSort);
  const visible = scopedClaims.slice(0, MAX_GRAPH_NODES);
  const visibleIds = new Set(visible.map((c) => c.id));
  const projectClaims = canonical.claims.filter((c) => c.project_id === projectId);
  const selectedEvidence = projectEvidence.filter((e) => e.branch === branch);
  const repoEvidence = projectEvidence.filter(isRepositoryEvidenceForAudit);
  const selectedRepoEvidence = selectedEvidence.filter(isRepositoryEvidenceForAudit);
  const repoClaim = (claim) => isRepositoryEvidenceForAudit(evidenceById.get(claim.created_from_evidence_id));
  const scopedRepoClaims = scopedClaims.filter(repoClaim);
  const visibleRepoClaims = scopedRepoClaims.filter((c) => visibleIds.has(c.id));
  const repoOtherBranch = projectClaims.filter((c) => c.branch_scope !== branch && repoClaim(c));
  const primaryEvidenceIds = new Set(projectClaims.map((c) => c.created_from_evidence_id));
  const projectClaimIds = new Set(projectClaims.map((c) => c.id));
  const supportingEvidenceIds = new Set(canonical.claim_evidence
    .filter((link) => link.role === 'supporting'
      && projectClaimIds.has(link.claim_id))
    .map((link) => link.evidence_id));
  const supportingOnly = selectedRepoEvidence.filter((e) => !primaryEvidenceIds.has(e.id)
    && supportingEvidenceIds.has(e.id));
  const notPrimary = selectedRepoEvidence.filter((e) => !primaryEvidenceIds.has(e.id));
  const missingPrimary = scopedClaims.filter((c) => !evidenceById.has(c.created_from_evidence_id));
  const crossScopePrimary = scopedClaims.filter((c) => {
    const evidence = evidenceById.get(c.created_from_evidence_id);
    return evidence && evidence.branch !== branch;
  });
  const incompleteRepo = visibleRepoClaims.filter((c) => {
    const e = evidenceById.get(c.created_from_evidence_id);
    return !validEvidencePath(e.path) || !OID.test(String(e.blob_oid ?? ''))
      || !SHA.test(String(e.commit_sha ?? '')) || e.branch !== branch;
  });
  const readyRepo = visibleRepoClaims.filter((c) => c.state === 'active'
    && !incompleteRepo.includes(c));

  let nextStep;
  if (readyRepo.length) nextStep = 'run_d7_live_on_matching_checkout';
  else if (visibleRepoClaims.length) nextStep = 'review_repository_evidence_metadata_and_state';
  else if (scopedRepoClaims.length) nextStep = 'repository_claims_beyond_graph_limit';
  else if (repoOtherBranch.length) nextStep = 'repository_claims_only_on_other_branches';
  else if (selectedRepoEvidence.length) nextStep = 'repository_evidence_not_primary_for_selected_scope';
  else if (repoEvidence.length) nextStep = 'repository_evidence_only_on_other_branches';
  else nextStep = 'no_repository_evidence_recorded';

  return {
    schemaVersion: 1,
    mode: 'read_only_evidence_audit',
    outcome: readyRepo.length ? 'ready_for_d7_live' : 'blocked',
    scope: { projectId, branch },
    graphBound: MAX_GRAPH_NODES,
    claims: {
      inScope: scopedClaims.length,
      activeInScope: scopedClaims.filter((c) => c.state === 'active').length,
      visibleAtGraphBound: visible.length,
      omittedAtGraphBound: scopedClaims.length - visible.length,
      repositoryPrimaryInScope: scopedRepoClaims.length,
      repositoryPrimaryVisible: visibleRepoClaims.length,
      repositoryPrimaryBeyondBound: scopedRepoClaims.length - visibleRepoClaims.length,
      repositoryPrimaryOtherBranches: repoOtherBranch.length,
      repositoryVisibleActiveWithCompleteEvidence: readyRepo.length,
      repositoryVisibleIncompleteEvidence: incompleteRepo.length,
      missingPrimaryEvidence: missingPrimary.length,
      primaryEvidenceWrongBranch: crossScopePrimary.length,
    },
    evidence: {
      projectTotal: projectEvidence.length,
      inScope: selectedEvidence.length,
      repositoryMarkedInScope: selectedRepoEvidence.length,
      repositoryMarkedOtherBranches: repoEvidence.length - selectedRepoEvidence.length,
      repositoryMarkedWithoutPrimaryClaim: notPrimary.length,
      repositoryMarkedSupportingOnly: supportingOnly.length,
    },
    nextStep,
    notes: ['counts_only_no_repository_freshness_claimed'],
  };
}
