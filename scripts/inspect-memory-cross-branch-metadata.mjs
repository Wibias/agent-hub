#!/usr/bin/env node
/**
 * D12.3 read-only metadata index of ALL branch-scoped Memory items in one
 * registered project. No semantic conflict approval, claim read, or mutation.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CATEGORIES = ['summary', 'claims', 'candidates', 'proposals'];
const CLAIM_STATES = ['active', 'candidate', 'stale', 'conflicted'];
const OPEN_STATUSES = ['pending', 'needs_confirmation', 'failed'];
const AUTHORITIES = ['user_direct', 'repo_trusted', 'tool_observation',
  'agent_inference', 'external_untrusted', 'unclassified'];
const MAX_PER_LEDGER = 1000;
const ref = (prefix, id) => '~' + prefix + createHash('sha256')
  .update(id, 'utf8').digest('hex').slice(0, 12);
const safeValue = (value, choices) => choices.includes(value) ? value : 'unknown';
const tableExists = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

export function parseCrossBranchInventoryArgs(argv = []) {
  const keys = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'], ['--category', 'category'],
  ]);
  const values = { dbPath: null, projectId: null, sourceBranch: null, category: null };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!keys.has(flag) || seen.has(flag)) throw new Error('unsupported or repeated option');
    seen.add(flag);
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const key = keys.get(flag);
    values[key] = key === 'dbPath' ? resolve(value) : value.trim();
  }
  if (![values.dbPath, values.projectId, values.sourceBranch]
    .every(x => typeof x === 'string' && x.trim())
    || !CATEGORIES.includes(values.category)) {
    throw new Error('exact scope, database and category required');
  }
  return values;
}

function scanRows(db, sql, projectId) {
  const rows = db.prepare(sql + ' LIMIT ?').all(projectId, MAX_PER_LEDGER + 1);
  return rows.length > MAX_PER_LEDGER ? null : rows;
}

export function inspectCrossBranchMemoryIndex({
  dbPath, projectId, sourceBranch, category,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch].every(x => typeof x === 'string' && x.trim())
      || !CATEGORIES.includes(category)) {
    throw new TypeError('exact read-only category and project scope required');
  }
  const baseline = {
    type: 'agent_hub_memory_cross_branch_metadata_inventory_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, claimsCreated: 0, promotionAllowed: false,
    hostConsentAuthenticated: false, evidenceBodyIntegrityVerified: false,
    semanticConflictChecked: false, semanticConflictDetected: null,
    projectWidePropagationImplemented: false,
    contentIncluded: false, sourcePathsIncluded: false,
    scope: { projectId, sourceBranch },
    category,
  };
  const db = openDb(dbPath);
  let began = false;
  try {
    db.exec('BEGIN');
    began = true;
    if (![
      'project_registry', 'claims', 'memory_candidates',
      'memory_evidence_proposals', 'memory_evidence_proposal_evidence',
      'evidence',
    ].every(name => tableExists(db, name))) {
      return { ...baseline, status: 'blocked', blockers: ['required_ledger_missing'] };
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      return { ...baseline, status: 'blocked', blockers: ['project_not_registered'] };
    }
    const claims = scanRows(db,
      "SELECT c.id,c.branch_scope AS branch,c.state,c.created_from_evidence_id AS source_id," +
      "e.id AS source_exists,e.project_id AS source_project,e.branch AS source_branch," +
      "e.sensitivity AS sensitivity,e.authority_class AS authority " +
      "FROM claims c LEFT JOIN evidence e ON e.id=c.created_from_evidence_id " +
      "WHERE c.project_id=? AND c.state IN ('active','candidate','stale','conflicted') " +
      "ORDER BY c.branch_scope,c.id",
      projectId);
    const candidates = scanRows(db,
      "SELECT m.id,m.branch,m.status,m.source_authority AS declared_authority," +
      "e.id AS source_exists,e.project_id AS source_project,e.branch AS source_branch," +
      "e.sensitivity AS sensitivity,e.authority_class AS authority " +
      "FROM memory_candidates m LEFT JOIN evidence e ON e.id=m.source_evidence_id " +
      "WHERE m.project_id=? AND m.status IN ('pending','needs_confirmation','failed') " +
      "ORDER BY m.branch,m.id",
      projectId);
    const proposals = scanRows(db,
      "SELECT id,branch,status FROM memory_evidence_proposals " +
      "WHERE project_id=? AND status IN ('pending','needs_confirmation','failed') " +
      "ORDER BY branch,id", projectId);
    if ([claims, candidates, proposals].some(rows => rows === null)) {
      return { ...baseline, status: 'blocked', blockers: ['ledger_over_1000_records'] };
    }
    const names = new Set([...claims, ...candidates, ...proposals].map(row => row.branch));
    const others = [...names].filter(name => name !== sourceBranch)
      .sort((a, b) => a.localeCompare(b, 'en'));
    const slots = new Map([[sourceBranch, 'source']]);
    for (let i = 0; i < others.length; i++) {
      slots.set(others[i], 'other-' + String(i + 1).padStart(2, '0'));
    }
    const byBranchSlot = {};
    for (const [branch, slot] of slots) {
      byBranchSlot[slot] = {
        sourceBranch: branch === sourceBranch,
        claims: claims.filter(row => row.branch === branch).length,
        candidates: candidates.filter(row => row.branch === branch).length,
        proposals: proposals.filter(row => row.branch === branch).length,
      };
    }
    const sourceMeta = (row, branch) => ({
      exists: Boolean(row.source_exists),
      authority: safeValue(row.authority, AUTHORITIES),
      normalSensitivity: row.sensitivity === 'normal',
      sameProjectAndBranch: row.source_project === projectId && row.source_branch === branch,
    });
    const proposalEvidence = db.prepare(
      'SELECT l.evidence_id,e.id AS source_exists,e.project_id AS source_project,' +
      'e.branch AS source_branch,e.sensitivity AS sensitivity,e.authority_class AS authority ' +
      'FROM memory_evidence_proposal_evidence l LEFT JOIN evidence e ' +
      'ON e.id=l.evidence_id WHERE l.proposal_id=? ORDER BY l.evidence_id',
    );
    let selected = [];
    if (category === 'claims') {
      selected = claims.map(row => ({
        ref: ref('c', row.id),
        branchSlot: slots.get(row.branch),
        state: safeValue(row.state, CLAIM_STATES),
        primaryEvidence: sourceMeta(row, row.branch),
        requiresHumanMeaningReview: true,
      }));
    } else if (category === 'candidates') {
      selected = candidates.map(row => ({
        ref: ref('m', row.id),
        branchSlot: slots.get(row.branch),
        status: safeValue(row.status, OPEN_STATUSES),
        source: sourceMeta(row, row.branch),
        sourceAuthorityAgrees: row.declared_authority === row.authority,
        requiresHumanMeaningReview: true,
      }));
    } else if (category === 'proposals') {
      selected = proposals.map(row => {
        const linked = proposalEvidence.all(row.id);
        const records = linked.map(source => sourceMeta(source, row.branch));
        return {
          ref: ref('p', row.id),
          branchSlot: slots.get(row.branch),
          status: safeValue(row.status, OPEN_STATUSES),
          linkedEvidence: linked.length,
          sourcesStructurallyReviewable: records.length > 0 && records.every(
            source => source.exists && source.normalSensitivity && source.sameProjectAndBranch,
          ),
          authorityClasses: [...new Set(records.map(record => record.authority))].sort(),
          requiresHumanMeaningReview: true,
        };
      });
    }
    if (new Set(selected.map(row => row.ref)).size !== selected.length) {
      return { ...baseline, status: 'blocked', blockers: ['opaque_reference_collision'] };
    }
    return {
      ...baseline,
      status: 'manual_metadata_review_required',
      blockers: [
        'semantic_review_not_performed',
        'host_confirmation_not_authenticated',
        'project_policy_owner_not_implemented',
      ],
      inventory: {
        branchesWithRows: slots.size,
        claims: claims.length, candidates: candidates.length, proposals: proposals.length,
        completelyEnumerated: true, truncated: false,
        selectedReturned: selected.length,
      },
      branchSlots: byBranchSlot,
      items: selected,
      nextStep: 'inspect_selected_project_claims_and_unresolved_rows_using_authorized_local_review',
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
    const report = inspectCrossBranchMemoryIndex(parseCrossBranchInventoryArgs(
      process.argv.slice(2),
    ));
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'manual_metadata_review_required') process.exitCode = 1;
  } catch {
    console.error('Read-only cross-branch inventory unavailable. Verify scope and database.');
    process.exitCode = 1;
  }
}
