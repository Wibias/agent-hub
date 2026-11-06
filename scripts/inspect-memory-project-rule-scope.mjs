#!/usr/bin/env node
/**
 * D12.3 read-only project/branch scope audit for a single reviewed proposal.
 * This does not implement project-wide Claims or approve promotion.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REF = /^~p[0-9a-f]{12}$/u;
const OPEN = ['pending', 'needs_confirmation', 'failed'];
const CLAIM_STATES = ['active', 'candidate', 'stale', 'conflicted'];
const MAX_OPEN = 10000;
const proposalRef = id => '~p' + createHash('sha256').update(id, 'utf8')
  .digest('hex').slice(0, 12);
const hasTable = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));
const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;

export function parseProjectScopeAuditArgs(argv = []) {
  const args = { dbPath: null, projectId: null, sourceBranch: null, selectedRef: null };
  const names = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'], ['--proposal-ref', 'selectedRef'],
  ]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!names.has(flag) || seen.has(flag)) throw new Error('unknown or repeated option');
    seen.add(flag);
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const key = names.get(flag);
    args[key] = key === 'dbPath' ? resolve(value) : value.trim();
  }
  if (![args.dbPath, args.projectId, args.sourceBranch].every(
    v => typeof v === 'string' && v.trim(),
  ) || !REF.test(args.selectedRef ?? '')) {
    throw new Error('exact database, project, source branch and opaque proposal ref required');
  }
  return args;
}

export function inspectProjectRuleScope({
  dbPath, projectId, sourceBranch, selectedRef,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch].every(v => typeof v === 'string' && v.trim())
    || !REF.test(selectedRef ?? '')) {
    throw new TypeError('exact scoped read-only inputs required');
  }
  const baseline = {
    type: 'agent_hub_memory_project_scope_audit_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, claimsCreated: 0, promotionAllowed: false,
    hostConsentAuthenticated: false, semanticConflictChecked: false,
    evidenceBodyIntegrityVerified: false, projectWidePropagationImplemented: false,
    contentIncluded: false, scope: { projectId, sourceBranch },
    proposalRef: selectedRef,
  };
  const db = openDb(dbPath);
  let began = false;
  try {
    db.exec('BEGIN');
    began = true;
    const required = [
      'project_registry', 'evidence', 'claims', 'conflicts',
      'memory_candidates', 'memory_evidence_proposals',
      'memory_evidence_proposal_evidence',
    ];
    if (!required.every(name => hasTable(db, name))) {
      return { ...baseline, status: 'blocked', blockers: ['required_ledger_missing'] };
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      return { ...baseline, status: 'blocked', blockers: ['project_not_registered'] };
    }

    const proposals = db.prepare(
      'SELECT id, kind, status FROM memory_evidence_proposals WHERE ' +
      "project_id=? AND branch=? AND status IN ('pending','needs_confirmation','failed') " +
      'ORDER BY id ASC LIMIT ?',
    ).all(projectId, sourceBranch, MAX_OPEN + 1);
    if (proposals.length > MAX_OPEN) {
      return { ...baseline, status: 'blocked', blockers: ['too_many_open_source_proposals'] };
    }
    const matching = proposals.filter(row => proposalRef(row.id) === selectedRef);
    if (matching.length !== 1) {
      return { ...baseline, status: 'blocked', blockers: [
        matching.length > 1 ? 'opaque_ref_collision' : 'source_proposal_not_open',
      ] };
    }
    const selected = matching[0];
    const sources = db.prepare(
      'SELECT l.evidence_id, e.id AS evidence_exists, e.project_id, ' +
      'e.branch, e.sensitivity, e.authority_class ' +
      'FROM memory_evidence_proposal_evidence l ' +
      'LEFT JOIN evidence e ON e.id=l.evidence_id ' +
      'WHERE l.proposal_id=?',
    ).all(selected.id);
    if (!sources.length || sources.some(row => !row.evidence_exists
      || row.project_id !== projectId || row.branch !== sourceBranch
      || row.sensitivity !== 'normal')) {
      return { ...baseline, status: 'blocked', blockers: ['source_evidence_not_safe'] };
    }
    const sourceDirect = sources.every(row => row.authority_class === 'user_direct');
    const claimStates = db.prepare(
      "SELECT state, COUNT(*) AS n FROM claims WHERE project_id=? " +
      "AND state IN ('active','candidate','stale','conflicted') GROUP BY state",
    ).all(projectId);
    const claimCounts = Object.fromEntries(CLAIM_STATES.map(s => [s, 0]));
    for (const row of claimStates) claimCounts[row.state] = row.n;
    const projectClaims = Object.values(claimCounts).reduce((n, value) => n + value, 0);
    const inSourceBranch = count(db,
      "SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=? " +
      "AND state IN ('active','candidate','stale','conflicted')",
      projectId, sourceBranch);
    const candidates = db.prepare(
      "SELECT status, COUNT(*) AS n FROM memory_candidates WHERE project_id=? " +
      "AND status IN ('pending','needs_confirmation','failed') GROUP BY status",
    ).all(projectId);
    const proposalsByStatus = db.prepare(
      "SELECT status, COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? " +
      "AND status IN ('pending','needs_confirmation','failed') GROUP BY status",
    ).all(projectId);
    const toCounts = rows => {
      const obj = { pending: 0, needs_confirmation: 0, failed: 0 };
      for (const row of rows) obj[row.status] = row.n;
      return obj;
    };
    const otherBranchProposals = count(db,
      "SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch<>? " +
      "AND status IN ('pending','needs_confirmation','failed')",
      projectId, sourceBranch);
    const otherBranchCandidates = count(db,
      "SELECT COUNT(*) AS n FROM memory_candidates WHERE project_id=? AND branch<>? " +
      "AND status IN ('pending','needs_confirmation','failed')",
      projectId, sourceBranch);
    const openConflicts = count(db,
      "SELECT COUNT(*) AS n FROM conflicts WHERE project_id=? AND state='open'", projectId);
    const distinctBranches = count(db,
      'SELECT COUNT(*) AS n FROM (' +
      'SELECT branch_scope AS b FROM claims WHERE project_id=? ' +
      'UNION SELECT branch AS b FROM memory_candidates WHERE project_id=? ' +
      'UNION SELECT branch AS b FROM memory_evidence_proposals WHERE project_id=?' +
      ')', projectId, projectId, projectId);
    return {
      ...baseline,
      status: 'manual_project_scope_review_required',
      blockers: [
        'host_confirmation_not_authenticated',
        'project_scope_schema_and_lookup_not_implemented',
        'cross_branch_semantic_conflicts_not_evaluated',
      ],
      selectedProposal: {
        kind: selected.kind, status: selected.status,
        linkedEvidence: sources.length, allSourcesUserDirect: sourceDirect,
        originalProposalOnly: true,
      },
      scopedLedgerCounts: {
        branchesWithEntries: distinctBranches,
        claims: {
          byState: claimCounts, projectTotal: projectClaims,
          sourceBranch: inSourceBranch, otherBranches: projectClaims - inSourceBranch,
        },
        candidateIntents: {
          byStatus: toCounts(candidates), otherBranches: otherBranchCandidates,
        },
        evidenceBoundProposals: {
          byStatus: toCounts(proposalsByStatus), otherBranches: otherBranchProposals,
        },
        openConflicts,
      },
      analysis: {
        allBranchRowsReviewedSemantically: false,
        otherBranchClaimsMayNeedIndividualReview: true,
        branchIdentityNotExposed: true,
        noWildcardClaimScopeAssumed: true,
      },
      nextStep: 'design_separate_project_rule_owner_and_branch_resolution_with_host_confirmation',
    };
  } finally {
    try { if (began) db.exec('ROLLBACK'); }
    finally { db.close(); }
  }
}

const isCli = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (isCli) {
  try {
    const report = inspectProjectRuleScope(
      parseProjectScopeAuditArgs(process.argv.slice(2)),
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'manual_project_scope_review_required') process.exitCode = 1;
  } catch {
    console.error('Read-only project scope audit unavailable. Verify database and scope.');
    process.exitCode = 1;
  }
}
