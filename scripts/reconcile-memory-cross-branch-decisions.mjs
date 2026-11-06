#!/usr/bin/env node
/**
 * D12.3 phase 13: complete cross-branch, read-only reconciliation of an
 * UNTRUSTED manual review-intent manifest against the exact local project.
 * Never treats a matching manifest as host consent or a promotion authority.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const TYPE = 'agent_hub_memory_cross_branch_manual_decision_intents_v1';
const OPEN = ['pending', 'needs_confirmation', 'failed'];
const KINDS = ['preference', 'procedure', 'knowledge'];
const AUTHORITIES = [
  'user_direct', 'repo_trusted', 'tool_observation', 'agent_inference',
  'external_untrusted', 'unclassified',
];
const INTENTS = [
  'ignore_when_authorized', 'retain_project_rule_for_review', 'retain_scoped_for_review',
];
const RATIONALES = [
  'explicit_user_confirmation', 'single_task_instruction', 'canonical_guidance',
  'canonical_config', 'tool_guidance', 'canonical_product_data',
  'canonical_implementation', 'version_specific', 'implementation_snapshot',
];
const P_REF = /^~p[0-9a-f]{12}$/u;
const E_REF = /^~e[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const GROUP = /^(?:source|other-[0-9]{2})$/u;
const MAX_ITEMS = 100;
const MAX_OPEN = 10000;
const MAX_EVIDENCE = 50;
const MAX_BYTES = 128 * 1024;
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const pRef = id => '~p' + sha256(id).slice(0, 12);
const eRef = id => '~e' + sha256(id).slice(0, 12);
const exact = (value, keys) => Boolean(value) && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const hasTable = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

export function parseCrossBranchDecisionReconciliationArgs(argv = []) {
  const args = { dbPath: null, projectId: null, sourceBranch: null, decisionsFile: null };
  const names = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'], ['--decisions-file', 'decisionsFile'],
  ]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!names.has(flag) || seen.has(flag)) throw new Error('unsupported or repeated option');
    seen.add(flag);
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const key = names.get(flag);
    args[key] = ['dbPath', 'decisionsFile'].includes(key) ? resolve(value) : value.trim();
  }
  if (!Object.values(args).every(value => typeof value === 'string' && value.trim())) {
    throw new Error('exact database, project, source branch and local decisions file required');
  }
  return args;
}

export function validateCrossBranchDecisionManifest(manifest, { projectId, sourceBranch }) {
  if (!exact(manifest, ['type', 'scope', 'origin', 'items'])
    || manifest.type !== TYPE
    || manifest.origin !== 'manual_chat_transcription_unverified'
    || !exact(manifest.scope, ['projectId', 'sourceBranch'])
    || manifest.scope.projectId !== projectId
    || manifest.scope.sourceBranch !== sourceBranch
    || !Array.isArray(manifest.items)
    || manifest.items.length < 1 || manifest.items.length > MAX_ITEMS) {
    throw new Error('invalid cross-branch intent manifest or exact scope');
  }
  const seen = new Set();
  for (const item of manifest.items) {
    if (!exact(item, [
      'proposalRef', 'expectedBranchGroup', 'expectedKind', 'expectedStatus',
      'canonicalFactSha256', 'evidenceRefs', 'expectedAuthority', 'intent',
      'targetScope', 'rationaleCode',
    ])
      || !P_REF.test(item.proposalRef)
      || !GROUP.test(item.expectedBranchGroup)
      || !KINDS.includes(item.expectedKind)
      || !OPEN.includes(item.expectedStatus)
      || !DIGEST.test(item.canonicalFactSha256)
      || !Array.isArray(item.evidenceRefs)
      || item.evidenceRefs.length < 1 || item.evidenceRefs.length > MAX_EVIDENCE
      || item.evidenceRefs.some(ref => !E_REF.test(ref))
      || new Set(item.evidenceRefs).size !== item.evidenceRefs.length
      || !AUTHORITIES.includes(item.expectedAuthority)
      || !INTENTS.includes(item.intent)
      || !RATIONALES.includes(item.rationaleCode)
      || seen.has(item.proposalRef)) {
      throw new Error('invalid, duplicate, or over-broad review-intent item');
    }
    if (item.intent === 'ignore_when_authorized' && item.targetScope !== null) {
      throw new Error('ignored decisions have no future target scope');
    }
    if (item.intent === 'retain_project_rule_for_review'
      && (item.expectedBranchGroup !== 'source'
        || item.expectedAuthority !== 'user_direct'
        || item.targetScope !== 'project_wide_e2e_qa'
        || item.rationaleCode !== 'explicit_user_confirmation')) {
      throw new Error('project rule requires explicit direct review and source grouping');
    }
    if (item.intent === 'retain_scoped_for_review'
      && (item.expectedAuthority !== 'user_direct'
        || item.targetScope !== 'blender_gallery_only'
        || item.rationaleCode !== 'explicit_user_confirmation')) {
      throw new Error('retained scoped design rule requires direct manual review');
    }
    seen.add(item.proposalRef);
  }
  return manifest;
}

export function reconcileCrossBranchDecisionIntents({
  dbPath, projectId, sourceBranch, manifest,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch]
    .every(value => typeof value === 'string' && value.trim())) {
    throw new TypeError('exact database and project scope required');
  }
  validateCrossBranchDecisionManifest(manifest, { projectId, sourceBranch });
  const baseline = {
    type: 'agent_hub_memory_cross_branch_readonly_decision_reconciliation_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, claimsCreated: 0, promotionAllowed: false,
    hostConsentAuthenticated: false, evidenceBodyIntegrityVerified: false,
    semanticConflictChecked: false, semanticConflictDetected: null,
    projectWidePropagationImplemented: false, contentIncluded: false,
    manifestOrigin: manifest.origin, sourceBodiesInspected: false,
    scope: { projectId, sourceBranch },
  };
  const db = openDb(dbPath);
  let begun = false;
  try {
    db.exec('BEGIN');
    begun = true;
    if (![
      'project_registry', 'memory_evidence_proposals',
      'memory_evidence_proposal_evidence', 'evidence', 'claims',
    ].every(name => hasTable(db, name))) {
      return { ...baseline, status: 'blocked', blockers: ['required_ledger_missing'], items: [] };
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?').get(projectId)) {
      return { ...baseline, status: 'blocked', blockers: ['project_not_registered'], items: [] };
    }

    // The complete inventory is necessary to reject extra or missing proposals.
    const proposals = db.prepare(
      'SELECT id,branch,kind,status,canonical_fact FROM memory_evidence_proposals ' +
      "WHERE project_id=? AND status IN ('pending','needs_confirmation','failed') " +
      'ORDER BY id LIMIT ?',
    ).all(projectId, MAX_OPEN + 1);
    if (proposals.length > MAX_OPEN) {
      return { ...baseline, status: 'blocked', blockers: ['too_many_open_proposals'], items: [] };
    }
    const byRef = new Map();
    for (const proposal of proposals) {
      const ref = pRef(proposal.id);
      if (byRef.has(ref)) {
        return { ...baseline, status: 'blocked', blockers: ['opaque_proposal_ref_collision'], items: [] };
      }
      byRef.set(ref, proposal);
    }
    const manifestRefs = new Set(manifest.items.map(item => item.proposalRef));
    const inventoryComplete = manifestRefs.size === byRef.size
      && [...manifestRefs].every(ref => byRef.has(ref));
    const blockers = inventoryComplete ? [] : ['incomplete_or_stale_project_coverage'];

    // Branch groups are equality-only constraints. A label such as other-02
    // must NOT be interpreted as a durable identifier or a branch name.
    const groupBranches = new Map([['source', sourceBranch]]);
    const branchGroups = new Map([[sourceBranch, 'source']]);
    const evidenceQuery = db.prepare(
      'SELECT l.evidence_id,e.id AS evidence_exists,e.project_id,e.branch,' +
      'e.sensitivity,e.authority_class FROM memory_evidence_proposal_evidence l ' +
      'LEFT JOIN evidence e ON e.id=l.evidence_id ' +
      'WHERE l.proposal_id=? ORDER BY l.evidence_id',
    );
    const groupCounts = new Map();
    const items = manifest.items.map(item => {
      const row = byRef.get(item.proposalRef);
      const problems = [];
      groupCounts.set(item.expectedBranchGroup,
        (groupCounts.get(item.expectedBranchGroup) ?? 0) + 1);
      if (!row) {
        problems.push('proposal_not_open_in_scope');
      } else {
        if (row.kind !== item.expectedKind) problems.push('kind_changed');
        if (row.status !== item.expectedStatus) problems.push('status_changed');
        if (sha256(row.canonical_fact) !== item.canonicalFactSha256) {
          problems.push('canonical_fact_changed');
        }

        const mappedBranch = groupBranches.get(item.expectedBranchGroup);
        if (mappedBranch !== undefined && mappedBranch !== row.branch) {
          problems.push('branch_group_changed');
        }
        const mappedGroup = branchGroups.get(row.branch);
        if (mappedGroup !== undefined && mappedGroup !== item.expectedBranchGroup) {
          problems.push('branch_group_changed');
        }
        if (item.expectedBranchGroup === 'source' && row.branch !== sourceBranch) {
          problems.push('source_branch_mismatch');
        }
        if (item.expectedBranchGroup !== 'source' && row.branch === sourceBranch) {
          problems.push('branch_group_changed');
        }
        if (mappedBranch === undefined) groupBranches.set(item.expectedBranchGroup, row.branch);
        if (mappedGroup === undefined) branchGroups.set(row.branch, item.expectedBranchGroup);

        const evidence = evidenceQuery.all(row.id);
        if (!evidence.length || evidence.length > MAX_EVIDENCE) {
          problems.push('unexpected_evidence_count');
        } else {
          const observedRefs = evidence.map(source => eRef(source.evidence_id));
          if (new Set(observedRefs).size !== observedRefs.length) {
            problems.push('opaque_evidence_ref_collision');
          }
          if (observedRefs.length !== item.evidenceRefs.length
            || [...observedRefs].sort().some((ref, i) =>
              ref !== [...item.evidenceRefs].sort()[i])) {
            problems.push('evidence_links_changed');
          }
          if (evidence.some(source => !source.evidence_exists
            || source.project_id !== projectId || source.branch !== row.branch
            || source.sensitivity !== 'normal')) {
            problems.push('evidence_scope_or_sensitivity_changed');
          }
          if (evidence.some(source => source.authority_class !== item.expectedAuthority)) {
            problems.push('evidence_authority_changed');
          }
        }
      }
      if (problems.length) blockers.push('item_mismatch');
      return {
        proposalRef: item.proposalRef,
        expectedBranchGroup: item.expectedBranchGroup,
        intent: item.intent, targetScope: item.targetScope,
        matching: problems.length === 0,
        blockers: [...new Set(problems)],
      };
    });
    const counts = {
      ignoredForFutureAuthorization: manifest.items
        .filter(item => item.intent === 'ignore_when_authorized').length,
      retainedProjectRuleForReview: manifest.items
        .filter(item => item.intent === 'retain_project_rule_for_review').length,
      retainedGalleryRuleForReview: manifest.items
        .filter(item => item.intent === 'retain_scoped_for_review').length,
    };
    const claimCount = db.prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE project_id=? " +
      "AND state IN ('active','candidate','stale','conflicted')",
    ).get(projectId).n;
    return {
      ...baseline,
      status: blockers.length ? 'blocked' : 'matched_read_only',
      blockers: [...new Set(blockers)],
      coverage: {
        projectOpenTotal: byRef.size, manifestItems: manifestRefs.size,
        exact: inventoryComplete, sourceAndOtherGroups: [...groupCounts]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, count]) => ({ name, count })),
      },
      decisionIntents: counts,
      projectClaims: { totalInScope: claimCount, semanticallyCompared: false },
      items,
      nextStep: 'legacy_candidate_triage_and_authenticated_host_project_rule_design_required',
    };
  } finally {
    try { if (begun) db.exec('ROLLBACK'); }
    finally { db.close(); }
  }
}

const isCli = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (isCli) {
  try {
    const args = parseCrossBranchDecisionReconciliationArgs(process.argv.slice(2));
    if (statSync(args.decisionsFile).size > MAX_BYTES) {
      throw new Error('manifest too large');
    }
    const manifest = JSON.parse(readFileSync(args.decisionsFile, 'utf8'));
    const report = reconcileCrossBranchDecisionIntents({ ...args, manifest });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'matched_read_only') process.exitCode = 1;
  } catch {
    console.error('Read-only cross-branch review reconciliation unavailable. Check scope and manifest.');
    process.exitCode = 1;
  }
}
