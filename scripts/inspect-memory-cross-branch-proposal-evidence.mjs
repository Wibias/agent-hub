#!/usr/bin/env node
/**
 * D12.3 read-only local review of ONE open Evidence-bound proposal in a project,
 * including proposals from non-main branches without exposing branch names.
 * Only a local interactive TTY may opt in to bounded redacted content.
 * NO host authentication, automatic decision, semantic judgment, or write.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REF = /^~p[0-9a-f]{12}$/u;
const OPEN = ['pending', 'needs_confirmation', 'failed'];
const KINDS = ['preference', 'procedure', 'knowledge'];
const AUTHORITIES = ['user_direct', 'repo_trusted', 'tool_observation',
  'agent_inference', 'external_untrusted', 'unclassified'];
const SOURCE_KINDS = ['session', 'repository', 'tool', 'file', 'event'];
const MAX_OPEN = 10000;
const MAX_LINKS = 50;
const MAX_FACT_CHARS = 1000;
const MAX_EVIDENCE_CHARS = 4000;
const digest = value => createHash('sha256').update(value, 'utf8')
  .digest('hex').slice(0, 12);
const proposalRef = id => '~p' + digest(id);
const evidenceRef = id => '~e' + digest(id);
const allowed = (value, choices) => choices.includes(value) ? value : 'unknown';
const excerpt = (value, max) => {
  const text = String(value ?? '');
  return { text: text.slice(0, max), truncated: text.length > max };
};
const tablePresent = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

export function parseCrossBranchProposalReviewArgs(argv = []) {
  const args = {
    dbPath: null, projectId: null, sourceBranch: null,
    selectedRef: null, showLocalContent: false,
  };
  const keys = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'], ['--proposal-ref', 'selectedRef'],
  ]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('repeated option');
    seen.add(flag);
    if (flag === '--show-local-content') {
      args.showLocalContent = true;
      continue;
    }
    if (!keys.has(flag)) throw new Error('unsupported option');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const key = keys.get(flag);
    args[key] = key === 'dbPath' ? resolve(value) : value.trim();
  }
  if (![args.dbPath, args.projectId, args.sourceBranch]
    .every(v => typeof v === 'string' && v.trim())
    || !REF.test(args.selectedRef ?? '')) {
    throw new Error('exact database, project, source branch and opaque ref required');
  }
  return args;
}

export function inspectCrossBranchProposalEvidence({
  dbPath, projectId, sourceBranch, selectedRef, showLocalContent = false,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch]
    .every(v => typeof v === 'string' && v.trim())
    || !REF.test(selectedRef ?? '') || typeof showLocalContent !== 'boolean') {
    throw new TypeError('exact scoped read-only selection required');
  }
  const baseline = {
    type: 'agent_hub_memory_cross_branch_proposal_evidence_review_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, claimsCreated: 0, promotionAllowed: false,
    hostConsentAuthenticated: false, evidenceBodyIntegrityVerified: false,
    semanticConflictChecked: false, semanticConflictDetected: null,
    projectWidePropagationImplemented: false,
    contentIncluded: false, showLocalContentRequested: showLocalContent,
    scope: { projectId, sourceBranch }, proposalRef: selectedRef,
  };
  const db = openDb(dbPath);
  let began = false;
  try {
    db.exec('BEGIN');
    began = true;
    if (!['project_registry', 'memory_evidence_proposals',
      'memory_evidence_proposal_evidence', 'evidence'].every(name => tablePresent(db, name))) {
      return { ...baseline, status: 'blocked', blockers: ['required_ledger_missing'] };
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      return { ...baseline, status: 'blocked', blockers: ['project_not_registered'] };
    }

    // Resolve exactly one ref among ALL still-open proposals for this project.
    // Never use the caller's sourceBranch as an unsafe surrogate for project scope.
    const open = db.prepare(
      'SELECT id,kind,status,branch FROM memory_evidence_proposals WHERE project_id=? ' +
      "AND status IN ('pending','needs_confirmation','failed') ORDER BY id LIMIT ?",
    ).all(projectId, MAX_OPEN + 1);
    if (open.length > MAX_OPEN) {
      return { ...baseline, status: 'blocked', blockers: ['too_many_open_proposals'] };
    }
    const refs = open.map(row => proposalRef(row.id));
    if (new Set(refs).size !== refs.length) {
      return { ...baseline, status: 'blocked', blockers: ['opaque_proposal_ref_collision'] };
    }
    const selected = open.filter(row => proposalRef(row.id) === selectedRef);
    if (selected.length !== 1) {
      return { ...baseline, status: 'blocked', blockers: ['proposal_not_open_in_project'] };
    }
    const proposal = selected[0];
    const sources = db.prepare(
      'SELECT l.evidence_id,e.id AS source_exists,e.project_id,e.branch,' +
      'e.sensitivity,e.authority_class,e.source_kind FROM memory_evidence_proposal_evidence l ' +
      'LEFT JOIN evidence e ON e.id=l.evidence_id ' +
      'WHERE l.proposal_id=? ORDER BY l.evidence_id',
    ).all(proposal.id);
    if (sources.length > MAX_LINKS) {
      return { ...baseline, status: 'blocked', blockers: ['too_many_linked_evidence'] };
    }
    const evidenceRefs = sources.map(row => evidenceRef(row.evidence_id));
    if (new Set(evidenceRefs).size !== evidenceRefs.length) {
      return { ...baseline, status: 'blocked', blockers: ['opaque_evidence_ref_collision'] };
    }
    const sourcesSafe = sources.length > 0 && sources.every(row =>
      Boolean(row.source_exists) && row.project_id === projectId
      && row.branch === proposal.branch && row.sensitivity === 'normal');
    const localContent = showLocalContent && sourcesSafe;
    const fact = localContent ? db.prepare(
      'SELECT canonical_fact FROM memory_evidence_proposals WHERE id=?',
    ).get(proposal.id)?.canonical_fact : null;
    const evidenceContent = localContent ? db.prepare(
      'SELECT content_redacted FROM evidence WHERE id=?',
    ) : null;
    const linkedSources = sources.map(row => ({
      evidenceRef: evidenceRef(row.evidence_id),
      exists: Boolean(row.source_exists),
      sameProjectAndProposalBranch: Boolean(row.source_exists)
        && row.project_id === projectId && row.branch === proposal.branch,
      normalSensitivity: Boolean(row.source_exists) && row.sensitivity === 'normal',
      authorityClass: row.source_exists ? allowed(row.authority_class, AUTHORITIES) : 'missing',
      sourceKind: row.source_exists ? allowed(row.source_kind, SOURCE_KINDS) : 'missing',
      hostOriginAuthenticatedByThisAudit: false,
      ...(localContent ? {
        localRedactedEvidenceExcerpt: excerpt(
          evidenceContent.get(row.evidence_id)?.content_redacted, MAX_EVIDENCE_CHARS,
        ),
      } : {}),
    }));
    return {
      ...baseline,
      status: sourcesSafe ? 'manual_proposal_review_required' : 'blocked',
      blockers: sourcesSafe ? [
        'semantic_review_not_performed',
        'host_origin_not_authenticated',
        'project_policy_scope_not_implemented',
      ] : ['linked_evidence_not_safe_or_missing'],
      contentIncluded: localContent,
      proposal: {
        kind: allowed(proposal.kind, KINDS),
        status: allowed(proposal.status, OPEN),
        sameAsSourceBranch: proposal.branch === sourceBranch,
        linkedEvidence: sources.length,
        sourcesStructurallyReviewable: sourcesSafe,
        nonUserDirectEvidencePresent: sources.some(
          row => row.authority_class !== 'user_direct',
        ),
        requiresHumanMeaningReview: true,
        ...(localContent ? { localCanonicalFact: excerpt(fact, MAX_FACT_CHARS) } : {}),
      },
      sources: linkedSources,
      nextStep: 'manually_review_meaning_authority_duration_and_project_qa_overlap',
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
    const args = parseCrossBranchProposalReviewArgs(process.argv.slice(2));
    if (args.showLocalContent && !process.stdout.isTTY) {
      throw new Error('local content requires interactive TTY');
    }
    const report = inspectCrossBranchProposalEvidence(args);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'manual_proposal_review_required') process.exitCode = 1;
  } catch {
    console.error('Read-only cross-branch proposal review unavailable. Check scope and terminal.');
    process.exitCode = 1;
  }
}
