#!/usr/bin/env node
/**
 * D12.3 phase 14: bounded, read-only LOCAL review of selected legacy candidates
 * across a registered project. Content requires explicit interactive TTY opt-in.
 * Never promotes, changes statuses, authenticates users, or judges the meaning.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REF = /^~m[0-9a-f]{12}$/u;
const OPEN = ['pending', 'needs_confirmation', 'failed'];
const TYPES = ['decision', 'preference', 'constraint', 'correction', 'rejected_approach', 'known_issue'];
const AUTHORITIES = ['user_direct', 'repo_trusted', 'tool_observation', 'agent_inference',
  'external_untrusted', 'unclassified'];
const MAX_OPEN = 10000;
const MAX_BATCH = 8;
const MAX_VALUE = 1000;
const MAX_SOURCE = 3000;
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
const candidateRef = id => '~m' + digest(id);
const evidenceRef = id => '~e' + digest(id);
const excerpt = (value, max) => {
  const text = String(value ?? '');
  return { text: text.slice(0, max), truncated: text.length > max };
};
const safe = (value, allowed) => allowed.includes(value) ? value : 'unknown';
const tablePresent = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

export function parseLegacyCandidateReviewArgs(argv = []) {
  const args = {
    dbPath: null, projectId: null, sourceBranch: null,
    candidateRefs: null, showLocalContent: false,
  };
  const names = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'], ['--candidate-refs', 'candidateRefs'],
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
    if (!names.has(flag)) throw new Error('unsupported option');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const key = names.get(flag);
    args[key] = key === 'dbPath' ? resolve(value) : value.trim();
  }
  if (![args.dbPath, args.projectId, args.sourceBranch]
    .every(value => typeof value === 'string' && value.trim())
    || typeof args.candidateRefs !== 'string') {
    throw new Error('exact database, scope and opaque candidate refs required');
  }
  args.candidateRefs = args.candidateRefs.split(',').map(value => value.trim());
  if (args.candidateRefs.length < 1 || args.candidateRefs.length > MAX_BATCH
    || args.candidateRefs.some(value => !REF.test(value))
    || new Set(args.candidateRefs).size !== args.candidateRefs.length) {
    throw new Error('one to eight distinct opaque candidate refs required');
  }
  return args;
}

export function inspectLegacyCandidateEvidence({
  dbPath, projectId, sourceBranch, candidateRefs,
  showLocalContent = false,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch]
    .every(value => typeof value === 'string' && value.trim())
    || !Array.isArray(candidateRefs)
    || candidateRefs.length < 1 || candidateRefs.length > MAX_BATCH
    || candidateRefs.some(value => !REF.test(value))
    || new Set(candidateRefs).size !== candidateRefs.length
    || typeof showLocalContent !== 'boolean') {
    throw new TypeError('exact scoped read-only batch selection required');
  }
  const baseline = {
    type: 'agent_hub_memory_cross_branch_legacy_candidate_evidence_review_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, candidatesPromoted: 0, claimsCreated: 0,
    promotionAllowed: false, hostConsentAuthenticated: false,
    evidenceBodyIntegrityVerified: false, semanticConflictChecked: false,
    semanticConflictDetected: null, projectWidePropagationImplemented: false,
    sourcePathsIncluded: false, contentIncluded: false,
    scope: { projectId, sourceBranch }, requested: candidateRefs.length,
  };
  const db = openDb(dbPath);
  let began = false;
  try {
    db.exec('BEGIN');
    began = true;
    if (!['project_registry', 'memory_candidates', 'evidence']
      .every(name => tablePresent(db, name))) {
      return { ...baseline, status: 'blocked', blockers: ['required_ledger_missing'], items: [] };
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      return { ...baseline, status: 'blocked', blockers: ['project_not_registered'], items: [] };
    }

    // Every selected ref is resolved against all open branches in EXACTLY this project.
    const open = db.prepare(
      'SELECT id,branch,status,proposed_type,source_evidence_id,source_authority ' +
      'FROM memory_candidates WHERE project_id=? ' +
      "AND status IN ('pending','needs_confirmation','failed') " +
      'ORDER BY id LIMIT ?',
    ).all(projectId, MAX_OPEN + 1);
    if (open.length > MAX_OPEN) {
      return { ...baseline, status: 'blocked', blockers: ['too_many_open_candidates'], items: [] };
    }
    const byRef = new Map();
    for (const row of open) {
      const ref = candidateRef(row.id);
      if (byRef.has(ref)) {
        return { ...baseline, status: 'blocked', blockers: ['opaque_candidate_ref_collision'], items: [] };
      }
      byRef.set(ref, row);
    }
    const evidenceMetadata = db.prepare(
      'SELECT id,project_id,branch,sensitivity,authority_class,source_kind ' +
      'FROM evidence WHERE id=?',
    );
    const candidateText = showLocalContent ? db.prepare(
      'SELECT proposed_value FROM memory_candidates WHERE id=?',
    ) : null;
    const evidenceText = showLocalContent ? db.prepare(
      'SELECT content_redacted FROM evidence WHERE id=?',
    ) : null;
    const blockers = [];
    const items = candidateRefs.map(ref => {
      const row = byRef.get(ref);
      const problems = [];
      if (!row) {
        problems.push('candidate_not_open_in_project');
      }
      const source = row ? evidenceMetadata.get(row.source_evidence_id) : null;
      if (row && (!source || source.project_id !== projectId
        || source.branch !== row.branch || source.sensitivity !== 'normal')) {
        problems.push('source_not_safe_in_scope');
      }
      if (source && source.authority_class !== row.source_authority) {
        problems.push('authority_mismatch');
      }
      const ok = problems.length === 0;
      if (!ok) blockers.push('candidate_mismatch');
      return {
        candidateRef: ref,
        matching: ok, blockers: problems,
        ...(row ? {
          status: safe(row.status, OPEN),
          proposedType: safe(row.proposed_type, TYPES),
          sameAsSourceBranch: row.branch === sourceBranch,
          source: {
            evidenceRef: evidenceRef(row.source_evidence_id),
            exists: Boolean(source),
            normalSensitivity: Boolean(source) && source.sensitivity === 'normal',
            sameProjectAndCandidateBranch: Boolean(source)
              && source.project_id === projectId && source.branch === row.branch,
            authority: source ? safe(source.authority_class, AUTHORITIES) : 'missing',
            sourceAuthorityAgrees: Boolean(source)
              && row.source_authority === source.authority_class,
            hostOriginAuthenticatedByThisAudit: false,
            ...(showLocalContent && ok ? {
              localRedactedEvidenceExcerpt: excerpt(
                evidenceText.get(row.source_evidence_id)?.content_redacted, MAX_SOURCE,
              ),
            } : {}),
          },
          ...(showLocalContent && ok ? {
            localProposedValueExcerpt: excerpt(
              candidateText.get(row.id)?.proposed_value, MAX_VALUE,
            ),
          } : {}),
        } : {}),
        requiresHumanMeaningReview: true,
      };
    });
    return {
      ...baseline,
      status: blockers.length ? 'blocked' : 'manual_candidate_review_required',
      blockers: blockers.length ? [...new Set(blockers)] : [
        'semantic_review_not_performed',
        'host_origin_not_authenticated',
        'project_policy_scope_not_implemented',
      ],
      contentIncluded: showLocalContent && blockers.length === 0,
      projectOpenCandidates: byRef.size,
      items,
      nextStep: 'review_content_scope_duration_duplicate_risk_without_promotion',
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
    const args = parseLegacyCandidateReviewArgs(process.argv.slice(2));
    if (args.showLocalContent && !process.stdout.isTTY) {
      throw new Error('local content requires interactive TTY');
    }
    const report = inspectLegacyCandidateEvidence(args);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'manual_candidate_review_required') process.exitCode = 1;
  } catch {
    console.error('Read-only legacy candidate review unavailable. Check local scope and selection.');
    process.exitCode = 1;
  }
}
