#!/usr/bin/env node
/**
 * D12.3 read-only, single-Claim local Evidence review across one project.
 * Content requires opt-in from a LOCAL interactive terminal, never by default.
 * This is not a project-policy authority / semantic conflict checker.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REF = /^~c[0-9a-f]{12}$/u;
const MAX_CLAIMS = 1000;
const MAX_CLAIM_CHARS = 1000;
const MAX_EVIDENCE_CHARS = 4000;
const STATES = ['active', 'candidate', 'stale', 'conflicted'];
const AUTHORITIES = ['user_direct', 'repo_trusted', 'tool_observation',
  'agent_inference', 'external_untrusted', 'unclassified'];
const SOURCE_KINDS = ['session', 'repository', 'tool', 'file', 'event'];
const KINDS = ['user_direct', 'agent_inference', 'code_observation',
  'preference', 'procedure', 'knowledge'];
const digest = id => createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 12);
const claimRef = id => '~c' + digest(id);
const evidenceRef = id => '~e' + digest(id);
const safe = (value, allowed) => allowed.includes(value) ? value : 'unknown';
const excerpt = (value, cap) => {
  const text = String(value ?? '');
  return { text: text.slice(0, cap), truncated: text.length > cap };
};
const hasTable = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

export function parseCrossBranchClaimReviewArgs(argv = []) {
  const args = {
    dbPath: null, projectId: null, sourceBranch: null,
    selectedRef: null, showLocalContent: false,
  };
  const names = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'], ['--claim-ref', 'selectedRef'],
  ]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate option');
    seen.add(flag);
    if (flag === '--show-local-content') {
      args.showLocalContent = true;
      continue;
    }
    if (!names.has(flag)) throw new Error('unsupported option');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const key = names.get(flag);
    args[key] = key === 'dbPath' ? resolve(value) : value.trim();
  }
  if (![args.dbPath, args.projectId, args.sourceBranch].every(
    value => typeof value === 'string' && value.trim(),
  ) || !REF.test(args.selectedRef ?? '')) {
    throw new Error('exact DB, project, source branch and opaque Claim ref required');
  }
  return args;
}

export function inspectCrossBranchClaimEvidence({
  dbPath, projectId, sourceBranch, selectedRef, showLocalContent = false,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch].every(v => typeof v === 'string' && v.trim())
    || !REF.test(selectedRef ?? '') || typeof showLocalContent !== 'boolean') {
    throw new TypeError('exact scoped Claim ref and read-only options required');
  }
  const baseline = {
    type: 'agent_hub_memory_cross_branch_claim_evidence_review_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, claimsCreated: 0, promotionAllowed: false,
    hostConsentAuthenticated: false, evidenceBodyIntegrityVerified: false,
    semanticConflictChecked: false, semanticConflictDetected: null,
    projectWidePropagationImplemented: false,
    showLocalContentRequested: showLocalContent, contentIncluded: false,
    scope: { projectId, sourceBranch }, claimRef: selectedRef,
  };
  const db = openDb(dbPath);
  let began = false;
  try {
    db.exec('BEGIN');
    began = true;
    if (!['project_registry', 'claims', 'evidence', 'claim_evidence']
      .every(name => hasTable(db, name))) {
      return { ...baseline, status: 'blocked', blockers: ['required_ledger_missing'] };
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      return { ...baseline, status: 'blocked', blockers: ['project_not_registered'] };
    }
    const claims = db.prepare(
      'SELECT id,branch_scope,kind,state,created_from_evidence_id ' +
      'FROM claims WHERE project_id=? ' +
      "AND state IN ('active','candidate','stale','conflicted') " +
      'ORDER BY id ASC LIMIT ?',
    ).all(projectId, MAX_CLAIMS + 1);
    if (claims.length > MAX_CLAIMS) {
      return { ...baseline, status: 'blocked', blockers: ['too_many_scoped_claims'] };
    }
    const allRefs = claims.map(row => claimRef(row.id));
    if (new Set(allRefs).size !== allRefs.length) {
      return { ...baseline, status: 'blocked', blockers: ['opaque_claim_ref_collision'] };
    }
    const matches = claims.filter(row => claimRef(row.id) === selectedRef);
    if (matches.length !== 1) {
      return { ...baseline, status: 'blocked', blockers: ['claim_not_found_in_scope'] };
    }
    const claim = matches[0];
    const sources = db.prepare(
      'SELECT l.evidence_id,l.role,e.id AS source_exists,e.project_id,e.branch,' +
      'e.sensitivity,e.authority_class,e.source_kind ' +
      'FROM claim_evidence l LEFT JOIN evidence e ON e.id=l.evidence_id ' +
      'WHERE l.claim_id=? ORDER BY l.role ASC,l.evidence_id ASC',
    ).all(claim.id);
    const primary = sources.filter(row => row.role === 'primary');
    const sourceSafe = sources.length > 0 && primary.length === 1
      && primary[0].evidence_id === claim.created_from_evidence_id
      && sources.length <= 50
      && sources.every(row => Boolean(row.source_exists)
        && row.project_id === projectId && row.branch === claim.branch_scope
        && row.sensitivity === 'normal'
        && ['primary', 'supporting'].includes(row.role));
    const safeContent = showLocalContent && sourceSafe;
    const claimText = safeContent ? db.prepare(
      'SELECT subject,predicate,value_text FROM claims WHERE id=?',
    ).get(claim.id) : null;
    const evidenceContentQuery = safeContent ? db.prepare(
      'SELECT content_redacted FROM evidence WHERE id=?',
    ) : null;
    const refs = sources.map(row => evidenceRef(row.evidence_id));
    if (new Set(refs).size !== refs.length) {
      return { ...baseline, status: 'blocked', blockers: ['opaque_evidence_ref_collision'] };
    }
    const details = sources.slice(0, 50).map(source => {
      const exists = Boolean(source.source_exists);
      const item = {
        evidenceRef: evidenceRef(source.evidence_id),
        role: safe(source.role, ['primary', 'supporting']),
        exists,
        sameProjectAndClaimBranch: exists && source.project_id === projectId
          && source.branch === claim.branch_scope,
        normalSensitivity: exists && source.sensitivity === 'normal',
        authority: exists ? safe(source.authority_class, AUTHORITIES) : 'missing',
        sourceKind: exists ? safe(source.source_kind, SOURCE_KINDS) : 'missing',
        hostOriginAuthenticatedByThisAudit: false,
      };
      if (safeContent) {
        item.localRedactedEvidenceExcerpt = excerpt(
          evidenceContentQuery.get(source.evidence_id)?.content_redacted, MAX_EVIDENCE_CHARS,
        );
      }
      return item;
    });
    const item = {
      kind: safe(claim.kind, KINDS), state: safe(claim.state, STATES),
      sameAsSourceBranch: claim.branch_scope === sourceBranch,
      linkedEvidence: sources.length, primaryEvidenceLinked: primary.length === 1
        && primary[0].evidence_id === claim.created_from_evidence_id,
      allSourcesStructurallySafe: sourceSafe,
      requiresHumanMeaningReview: true,
      ...(safeContent ? {
        localSubject: excerpt(claimText.subject, MAX_CLAIM_CHARS),
        localPredicate: excerpt(claimText.predicate, MAX_CLAIM_CHARS),
        localValue: excerpt(claimText.value_text, MAX_CLAIM_CHARS),
      } : {}),
    };
    return {
      ...baseline,
      status: sourceSafe ? 'manual_claim_review_required' : 'blocked',
      blockers: sourceSafe ? [
        'semantic_review_not_performed',
        'host_origin_not_authenticated',
        'project_policy_scope_not_implemented',
      ] : ['claim_primary_or_source_integrity_unverified'],
      contentIncluded: safeContent,
      claim: item, sources: details,
      otherBranchSemanticConflictDetected: null,
      nextStep: 'human_compare_claim_meaning_with_project_qa_policy',
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
    const args = parseCrossBranchClaimReviewArgs(process.argv.slice(2));
    if (args.showLocalContent && !process.stdout.isTTY) {
      throw new Error('content requires interactive terminal');
    }
    const report = inspectCrossBranchClaimEvidence(args);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'manual_claim_review_required') process.exitCode = 1;
  } catch {
    console.error('Read-only Claim review unavailable. Check local scope and terminal.');
    process.exitCode = 1;
  }
}
