#!/usr/bin/env node
/**
 * D12.3 read-only reconciliation of LOCAL, UNTRUSTED manual decision intents.
 * This is not a consent authenticator, an apply tool, or promotion preflight.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const TYPE = 'agent_hub_memory_manual_decision_intents_v1';
const OPEN = ['pending', 'needs_confirmation', 'failed'];
const KINDS = ['preference', 'procedure', 'knowledge'];
const AUTHORITIES = ['user_direct', 'repo_trusted', 'tool_observation', 'agent_inference'];
const INTENTS = ['retain_project_rule_for_review', 'ignore_when_authorized'];
const RATIONALES = [
  'explicit_user_confirmation', 'single_task_instruction', 'canonical_guidance',
  'canonical_config', 'tool_guidance', 'canonical_product_data',
  'canonical_implementation',
];
const REF = /^~p[0-9a-f]{12}$/u;
const EREF = /^~e[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_ITEMS = 100;
const MAX_OPEN = 10000;
const MAX_BYTES = 128 * 1024;
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const proposalRef = id => '~p' + sha256(id).slice(0, 12);
const evidenceRef = id => '~e' + sha256(id).slice(0, 12);
const exactKeys = (value, keys) => value && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const tablePresent = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

export function parseDecisionReconciliationArgs(argv = []) {
  const args = { dbPath: null, projectId: null, branch: null, decisionsFile: null };
  const names = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--branch', 'branch'], ['--decisions-file', 'decisionsFile'],
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
  if (!Object.values(args).every(v => typeof v === 'string' && v.trim())) {
    throw new Error('exact DB, scope and local decisions file required');
  }
  return args;
}

export function validateDecisionIntentManifest(manifest, scope) {
  if (!exactKeys(manifest, ['type', 'scope', 'origin', 'items'])
    || manifest.type !== TYPE
    || manifest.origin !== 'manual_chat_transcription_unverified'
    || !exactKeys(manifest.scope, ['projectId', 'branch'])
    || manifest.scope.projectId !== scope.projectId
    || manifest.scope.branch !== scope.branch
    || !Array.isArray(manifest.items)
    || manifest.items.length < 1 || manifest.items.length > MAX_ITEMS) {
    throw new Error('invalid scoped decision-intent manifest');
  }
  const seen = new Set();
  for (const item of manifest.items) {
    if (!exactKeys(item, [
      'proposalRef', 'expectedKind', 'expectedStatus', 'canonicalFactSha256',
      'evidenceRefs', 'expectedAuthority', 'intent', 'rationaleCode',
    ])
      || !REF.test(item.proposalRef)
      || !KINDS.includes(item.expectedKind)
      || !OPEN.includes(item.expectedStatus)
      || !DIGEST.test(item.canonicalFactSha256)
      || !Array.isArray(item.evidenceRefs)
      || item.evidenceRefs.length < 1 || item.evidenceRefs.length > 10
      || item.evidenceRefs.some(ref => !EREF.test(ref))
      || new Set(item.evidenceRefs).size !== item.evidenceRefs.length
      || !AUTHORITIES.includes(item.expectedAuthority)
      || !INTENTS.includes(item.intent)
      || !RATIONALES.includes(item.rationaleCode)
      || seen.has(item.proposalRef)) {
      throw new Error('invalid or duplicate decision-intent item');
    }
    if (item.intent === 'retain_project_rule_for_review'
      && (item.rationaleCode !== 'explicit_user_confirmation'
        || item.expectedAuthority !== 'user_direct')) {
      throw new Error('retained project rule requires declared direct review');
    }
    seen.add(item.proposalRef);
  }
  return manifest;
}

export function reconcileLocalDecisionIntents({
  dbPath, projectId, branch, manifest,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, branch].every(v => typeof v === 'string' && v.trim())) {
    throw new TypeError('exact database and scope required');
  }
  validateDecisionIntentManifest(manifest, { projectId, branch });
  const output = {
    type: 'agent_hub_memory_readonly_decision_reconciliation_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, claimsCreated: 0, promotionAllowed: false,
    projectWidePropagationImplemented: false,
    hostConsentAuthenticated: false, semanticConflictChecked: false,
    sourceBodyIntegrityVerified: false,
    manifestOrigin: manifest.origin, contentIncluded: false,
    scope: { projectId, branch },
  };
  const db = openDb(dbPath);
  let began = false;
  try {
    db.exec('BEGIN');
    began = true;
    const required = [
      'memory_evidence_proposals', 'memory_evidence_proposal_evidence',
      'evidence', 'claims', 'memory_evidence_proposal_relations',
    ];
    if (!required.every(name => tablePresent(db, name))) {
      return { ...output, status: 'blocked', blockers: ['required_ledger_missing'], items: [] };
    }
    const proposals = db.prepare(
      'SELECT id, kind, status, canonical_fact FROM memory_evidence_proposals ' +
      "WHERE project_id=? AND branch=? AND status IN ('pending','needs_confirmation','failed') " +
      'ORDER BY id ASC LIMIT ?',
    ).all(projectId, branch, MAX_OPEN + 1);
    if (proposals.length > MAX_OPEN) {
      return { ...output, status: 'blocked', blockers: ['too_many_open_proposals'], items: [] };
    }
    const byRef = new Map();
    for (const proposal of proposals) {
      const ref = proposalRef(proposal.id);
      if (byRef.has(ref)) {
        return { ...output, status: 'blocked', blockers: ['opaque_proposal_ref_collision'], items: [] };
      }
      byRef.set(ref, proposal);
    }
    const expected = new Set(manifest.items.map(item => item.proposalRef));
    const actual = new Set(byRef.keys());
    const blockers = [];
    if (expected.size !== actual.size
      || [...expected].some(ref => !actual.has(ref))) {
      blockers.push('incomplete_or_stale_scope_coverage');
    }
    const evidenceQuery = db.prepare(
      'SELECT l.evidence_id, e.id AS evidence_exists, e.project_id, e.branch, ' +
      'e.sensitivity, e.authority_class FROM memory_evidence_proposal_evidence l ' +
      'LEFT JOIN evidence e ON e.id=l.evidence_id ' +
      'WHERE l.proposal_id=? ORDER BY l.evidence_id ASC',
    );
    const items = manifest.items.map(item => {
      const row = byRef.get(item.proposalRef);
      const problems = [];
      const sourceRefs = [];
      const sourceAuthorities = [];
      if (!row) {
        problems.push('proposal_not_open_in_scope');
      } else {
        if (row.kind !== item.expectedKind) problems.push('kind_changed');
        if (row.status !== item.expectedStatus) problems.push('status_changed');
        if (sha256(row.canonical_fact) !== item.canonicalFactSha256) {
          problems.push('proposal_content_changed');
        }
        const sources = evidenceQuery.all(row.id);
        for (const source of sources) {
          sourceRefs.push(evidenceRef(source.evidence_id));
          sourceAuthorities.push(source.authority_class);
          if (!source.evidence_exists
            || source.project_id !== projectId || source.branch !== branch
            || source.sensitivity !== 'normal') {
            problems.push('linked_evidence_not_safe_in_scope');
          }
        }
        if (new Set(sourceRefs).size !== sourceRefs.length) {
          problems.push('opaque_evidence_ref_collision');
        }
        if (sourceRefs.length !== item.evidenceRefs.length
          || [...sourceRefs].sort().some((ref, i) =>
            ref !== [...item.evidenceRefs].sort()[i])) {
          problems.push('evidence_links_changed');
        }
        if (sourceAuthorities.some(authority => authority !== item.expectedAuthority)) {
          problems.push('source_authority_changed');
        }
        if (item.intent === 'retain_project_rule_for_review'
          && !sourceAuthorities.includes('user_direct')) {
          problems.push('direct_evidence_missing');
        }
      }
      if (problems.length) blockers.push('item_mismatch');
      return {
        proposalRef: item.proposalRef, intent: item.intent,
        rationaleCode: item.rationaleCode,
        matching: problems.length === 0, blockers: [...new Set(problems)],
      };
    });
    const comparedStates = ['active', 'candidate', 'stale', 'conflicted'];
    const claimCount = db.prepare(
      'SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=? ' +
      "AND state IN ('active','candidate','stale','conflicted')",
    ).get(projectId, branch).n;
    const counts = {
      retainForFutureReview: manifest.items.filter(
        i => i.intent === 'retain_project_rule_for_review',
      ).length,
      ignoreWhenAuthorized: manifest.items.filter(
        i => i.intent === 'ignore_when_authorized',
      ).length,
    };
    return {
      ...output, status: blockers.length ? 'blocked' : 'matched_read_only',
      blockers: [...new Set(blockers)],
      coverage: {
        scopedOpenTotal: actual.size, manifestItems: expected.size,
        exact: expected.size === actual.size
          && [...expected].every(ref => actual.has(ref)),
      },
      decisionIntents: counts,
      claimComparison: {
        scopedCount: claimCount, states: comparedStates,
        contentCompared: false, semanticConflictDetected: null,
      },
      items,
      nextStep: 'authenticated_local_review_and_project_scope_design_required',
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
    const args = parseDecisionReconciliationArgs(process.argv.slice(2));
    if (statSync(args.decisionsFile).size > MAX_BYTES) {
      throw new Error('manifest too large');
    }
    const manifest = JSON.parse(readFileSync(args.decisionsFile, 'utf8'));
    const report = reconcileLocalDecisionIntents({ ...args, manifest });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'matched_read_only') process.exitCode = 1;
  } catch {
    console.error('Read-only decision reconciliation unavailable. Check local scope and manifest.');
    process.exitCode = 1;
  }
}
