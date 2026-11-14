#!/usr/bin/env node
/**
 * D12.3 Phase 15: strictly read-only reconciliation of one *untrusted* manual
 * 21-Proposal + 87-Candidate review manifest against the current local DB.
 * No apply, status transition, promotion, semantic approval or host consent.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const TYPE = 'agent_hub_memory_d12_3_combined_readonly_review_intents_v1';
const OPEN = ['pending', 'needs_confirmation', 'failed'];
const AUTHORITIES = ['user_direct', 'repo_trusted', 'tool_observation',
  'agent_inference', 'external_untrusted', 'unclassified'];
const P_KINDS = ['preference', 'procedure', 'knowledge'];
const C_TYPES = ['decision', 'preference', 'constraint', 'correction',
  'rejected_approach', 'known_issue'];
const SOURCE_KINDS = ['session', 'repository', 'tool', 'file', 'event'];
const CLAIM_STATES = ['active', 'candidate', 'stale', 'conflicted'];
const P_REF = /^~p[0-9a-f]{12}$/u;
const C_REF = /^~m[0-9a-f]{12}$/u;
const CLAIM_REF = /^~c[0-9a-f]{12}$/u;
const E_REF = /^~e[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const SLOT = /^(?:source|other-[0-9]{2})$/u;
const MAX_FILE_BYTES = 160 * 1024;
const MAX_RECORDS = 1000;
const MAX_LINKS = 50;
const sha256 = v => createHash('sha256').update(v, 'utf8').digest('hex');
const opaque = (prefix, id) => '~' + prefix + sha256(id).slice(0, 12);
const exact = (v, keys) => v !== null && typeof v === 'object'
  && !Array.isArray(v) && Object.keys(v).length === keys.length
  && keys.every(k => Object.hasOwn(v, k));
const tablePresent = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

export function parseFinal108ReconciliationArgs(argv = []) {
  const flags = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'], ['--review-file', 'reviewFile'],
    ['--expected-review-sha256', 'expectedReviewSha256'],
  ]);
  const args = Object.fromEntries([...flags.values()].map(k => [k, null]));
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flags.has(flag) || seen.has(flag)) throw new Error('unsupported or repeated option');
    seen.add(flag);
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const key = flags.get(flag);
    args[key] = ['dbPath', 'reviewFile'].includes(key) ? resolve(value) : value.trim();
  }
  if (!Object.values(args).every(x => typeof x === 'string' && x.trim())
    || !SHA.test(args.expectedReviewSha256)
    || args.dbPath === args.reviewFile) {
    throw new Error('exact scope, local review file, and matching digest required');
  }
  return args;
}

function validateDisposition(item, category) {
  if (item.intent === 'ignore_when_authorized') return item.targetScope === null;
  if (category === 'proposal') {
    return (item.intent === 'retain_project_rule_for_review'
      && item.targetScope === 'project_wide_e2e_qa'
      && item.branchGroup === 'source' && item.expectedAuthority === 'user_direct')
      || (item.intent === 'retain_scoped_for_review'
        && item.targetScope === 'blender_gallery_only'
        && item.expectedAuthority === 'user_direct');
  }
  return item.intent === 'retain_scoped_for_review'
    && item.targetScope === 'blender_gallery_only'
    && item.expectedAuthority === 'user_direct';
}

export function validateFinal108Manifest(manifest, { projectId, sourceBranch }) {
  if (!exact(manifest, ['type', 'origin', 'scope', 'expectedCounts',
    'sourceSnapshot', 'proposals', 'candidates', 'expectedActiveClaimRefs'])
    || manifest.type !== TYPE
    || manifest.origin !== 'untrusted_manual_chat_transcription'
    || !exact(manifest.scope, ['projectId', 'sourceBranch'])
    || manifest.scope.projectId !== projectId || manifest.scope.sourceBranch !== sourceBranch
    || !exact(manifest.expectedCounts, ['proposals', 'candidates', 'activeClaims'])
    || manifest.expectedCounts.proposals !== 21
    || manifest.expectedCounts.candidates !== 87
    || manifest.expectedCounts.activeClaims !== 2
    || !exact(manifest.sourceSnapshot, ['proposalsReviewSha256', 'legacyExportSha256', 'closureSha256'])
    || !Object.values(manifest.sourceSnapshot).every(x => typeof x === 'string' && SHA.test(x))
    || !Array.isArray(manifest.proposals) || manifest.proposals.length !== 21
    || !Array.isArray(manifest.candidates) || manifest.candidates.length !== 87
    || !Array.isArray(manifest.expectedActiveClaimRefs)
    || manifest.expectedActiveClaimRefs.length !== 2
    || new Set(manifest.expectedActiveClaimRefs).size !== 2
    || manifest.expectedActiveClaimRefs.some(x => !CLAIM_REF.test(x))) {
    throw new Error('invalid scope, fixed D12.3 review counts or schema');
  }
  const proposalRefs = new Set();
  const candidateRefs = new Set();
  for (const x of manifest.proposals) {
    if (!exact(x, ['proposalRef', 'branchGroup', 'expectedKind', 'expectedStatus',
      'canonicalFactSha256', 'evidenceRefs', 'expectedAuthority', 'intent', 'targetScope'])
      || !P_REF.test(x.proposalRef) || !SLOT.test(x.branchGroup)
      || !P_KINDS.includes(x.expectedKind) || !OPEN.includes(x.expectedStatus)
      || !SHA.test(x.canonicalFactSha256)
      || !Array.isArray(x.evidenceRefs) || x.evidenceRefs.length < 1
      || x.evidenceRefs.length > MAX_LINKS
      || x.evidenceRefs.some(ref => !E_REF.test(ref))
      || new Set(x.evidenceRefs).size !== x.evidenceRefs.length
      || !AUTHORITIES.includes(x.expectedAuthority)
      || !validateDisposition(x, 'proposal') || proposalRefs.has(x.proposalRef)) {
      throw new Error('invalid or duplicate Proposal snapshot');
    }
    proposalRefs.add(x.proposalRef);
  }
  for (const x of manifest.candidates) {
    if (!exact(x, ['candidateRef', 'branchSlot', 'expectedStatus', 'expectedType',
      'proposedValueSha256', 'evidenceRef', 'evidenceSha256', 'expectedAuthority',
      'sourceKind', 'intent', 'targetScope', 'evidenceExcerptTruncated',
      'valueExcerptTruncated'])
      || !C_REF.test(x.candidateRef) || !SLOT.test(x.branchSlot)
      || !OPEN.includes(x.expectedStatus) || !C_TYPES.includes(x.expectedType)
      || !SHA.test(x.proposedValueSha256) || !E_REF.test(x.evidenceRef)
      || !SHA.test(x.evidenceSha256) || !AUTHORITIES.includes(x.expectedAuthority)
      || !SOURCE_KINDS.includes(x.sourceKind)
      || typeof x.evidenceExcerptTruncated !== 'boolean'
      || typeof x.valueExcerptTruncated !== 'boolean'
      || !validateDisposition(x, 'candidate') || candidateRefs.has(x.candidateRef)) {
      throw new Error('invalid or duplicate legacy Candidate snapshot');
    }
    candidateRefs.add(x.candidateRef);
  }
  const count = (xs, type) => xs.filter(x => x.intent === type).length;
  if (count(manifest.proposals, 'ignore_when_authorized') !== 19
    || count(manifest.proposals, 'retain_project_rule_for_review') !== 1
    || count(manifest.proposals, 'retain_scoped_for_review') !== 1
    || count(manifest.candidates, 'ignore_when_authorized') !== 86
    || count(manifest.candidates, 'retain_scoped_for_review') !== 1
  ) {
    throw new Error('inconsistent reviewed disposition, targets or Claim baselines');
  }
  return manifest;
}

/** Read-only DB comparison. Reject altered or extra project rows before any approval. */
export function reconcileFinal108Review({
  dbPath, projectId, sourceBranch, manifest,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch].every(v => typeof v === 'string' && v.trim())) {
    throw new TypeError('exact local database and project scope required');
  }
  validateFinal108Manifest(manifest, { projectId, sourceBranch });
  const baseline = {
    type: 'agent_hub_memory_d12_3_final_108_readonly_reconciliation_v1',
    readOnly: true, writesToSource: false, modelInvocations: 0,
    decisionsApplied: 0, claimsCreated: 0, candidatesPromoted: 0,
    promotionAllowed: false, hostConsentAuthenticated: false,
    evidenceBodyIntegrityVerified: false, evidenceProvenanceAuthenticated: false,
    semanticConflictChecked: false, semanticConflictDetected: null,
    projectWidePropagationImplemented: false, contentIncluded: false,
    sourceBodiesPrinted: false, sourcePathsIncluded: false,
    reviewManifestAuthenticated: false, reviewManifestOrigin: manifest.origin,
    scope: { projectId, sourceBranch },
  };
  const db = openDb(dbPath);
  let started = false;
  try {
    db.exec('BEGIN');
    started = true;
    if (!['project_registry', 'memory_evidence_proposals',
      'memory_evidence_proposal_evidence', 'memory_candidates',
      'claims', 'claim_evidence', 'evidence'].every(name => tablePresent(db, name))) {
      return { ...baseline, status: 'blocked', blockers: ['required_ledger_missing'] };
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?').get(projectId)) {
      return { ...baseline, status: 'blocked', blockers: ['project_not_registered'] };
    }
    const proposals = db.prepare('SELECT id,branch,kind,status,canonical_fact '
      + 'FROM memory_evidence_proposals WHERE project_id=? '
      + "AND status IN ('pending','needs_confirmation','failed') ORDER BY id LIMIT ?")
      .all(projectId, MAX_RECORDS + 1);
    const candidates = db.prepare('SELECT id,branch,status,proposed_type,proposed_value,'
      + 'source_evidence_id,source_authority FROM memory_candidates WHERE project_id=? '
      + "AND status IN ('pending','needs_confirmation','failed') ORDER BY id LIMIT ?")
      .all(projectId, MAX_RECORDS + 1);
    const claims = db.prepare('SELECT id,branch_scope,state,created_from_evidence_id '
      + 'FROM claims WHERE project_id=? '
      + "AND state IN ('active','candidate','stale','conflicted') ORDER BY id LIMIT ?")
      .all(projectId, MAX_RECORDS + 1);
    if ([proposals, candidates, claims].some(xs => xs.length > MAX_RECORDS)) {
      return { ...baseline, status: 'blocked', blockers: ['inventory_limit_exceeded'] };
    }
    const observed = {
      proposals: proposals.length, candidates: candidates.length, claims: claims.length,
    };
    const expected = manifest.expectedCounts;
    const blockers = [];
    const mismatches = [];
    let storedCandidateEvidenceHashesCompared = 0;
    const mismatch = (kind, ref, code) => {
      blockers.push('snapshot_mismatch');
      mismatches.push({ kind, ref, code });
    };
    if (observed.proposals !== expected.proposals
      || observed.candidates !== expected.candidates
      || observed.claims !== expected.activeClaims) {
      blockers.push('project_inventory_changed');
    }
    const index = (rows, prefix) => {
      const m = new Map();
      let collision = false;
      for (const row of rows) {
        const ref = opaque(prefix, row.id);
        if (m.has(ref)) collision = true;
        m.set(ref, row);
      }
      return { m, collision };
    };
    const p = index(proposals, 'p');
    const c = index(candidates, 'm');
    const cl = index(claims, 'c');
    if (p.collision || c.collision || cl.collision) blockers.push('opaque_ref_collision');
    const expectedPs = new Set(manifest.proposals.map(x => x.proposalRef));
    const expectedCs = new Set(manifest.candidates.map(x => x.candidateRef));
    const expectedCl = new Set(manifest.expectedActiveClaimRefs);
    const complete = (actual, exp) => actual.m.size === exp.size
      && [...exp].every(ref => actual.m.has(ref));
    if (!complete(p, expectedPs) || !complete(c, expectedCs)
      || !complete(cl, expectedCl)) blockers.push('project_reference_set_changed');

    // The legacy export used a union of open Claims, Proposals and Candidates,
    // sorted by the inventory's ephemeral cross-branch slot scheme.
    const branchNames = new Set([
      ...proposals.map(x => x.branch),
      ...candidates.map(x => x.branch),
      ...claims.map(x => x.branch_scope),
    ]);
    const others = [...branchNames].filter(x => x !== sourceBranch)
      .sort((a, b) => a.localeCompare(b, 'en'));
    if (others.length > 99) blockers.push('too_many_branch_slots');
    const candidateSlots = new Map([[sourceBranch, 'source']]);
    others.forEach((branch, i) =>
      candidateSlots.set(branch, 'other-' + String(i + 1).padStart(2, '0')));
    // Proposal group labels come from an earlier inventory and may not have
    // the same numeric meanings as candidate-slot labels. Bind independently.
    const proposalGroups = new Map([['source', sourceBranch]]);
    const proposalBranches = new Map([[sourceBranch, 'source']]);
    const evidence = db.prepare('SELECT id,project_id,branch,sensitivity,authority_class,'
      + 'source_kind,content_redacted FROM evidence WHERE id=?');
    const proposalEvidence = db.prepare('SELECT evidence_id FROM '
      + 'memory_evidence_proposal_evidence WHERE proposal_id=? ORDER BY evidence_id');
    const claimEvidence = db.prepare('SELECT evidence_id,role FROM claim_evidence '
      + 'WHERE claim_id=? ORDER BY evidence_id');

    for (const x of manifest.proposals) {
      const row = p.m.get(x.proposalRef);
      if (!row) { mismatch('proposal', x.proposalRef, 'not_open_in_project'); continue; }
      if (row.kind !== x.expectedKind) mismatch('proposal', x.proposalRef, 'kind_changed');
      if (row.status !== x.expectedStatus) mismatch('proposal', x.proposalRef, 'status_changed');
      if (sha256(row.canonical_fact) !== x.canonicalFactSha256) {
        mismatch('proposal', x.proposalRef, 'fact_hash_changed');
      }
      const mapped = proposalGroups.get(x.branchGroup);
      const back = proposalBranches.get(row.branch);
      if ((mapped !== undefined && mapped !== row.branch)
        || (back !== undefined && back !== x.branchGroup)
        || (x.branchGroup === 'source') !== (row.branch === sourceBranch)) {
        mismatch('proposal', x.proposalRef, 'branch_group_changed');
      }
      if (mapped === undefined) proposalGroups.set(x.branchGroup, row.branch);
      if (back === undefined) proposalBranches.set(row.branch, x.branchGroup);
      const linked = proposalEvidence.all(row.id);
      if (linked.length < 1 || linked.length > MAX_LINKS) {
        mismatch('proposal', x.proposalRef, 'unexpected_evidence_count');
        continue;
      }
      const observedRefs = linked.map(s => opaque('e', s.evidence_id));
      if (new Set(observedRefs).size !== observedRefs.length
        || observedRefs.length !== x.evidenceRefs.length
        || [...observedRefs].sort().some((v, i) => v !== [...x.evidenceRefs].sort()[i])) {
        mismatch('proposal', x.proposalRef, 'evidence_links_changed');
      }
      for (const link of linked) {
        const e = evidence.get(link.evidence_id);
        if (!e || e.project_id !== projectId || e.branch !== row.branch
          || e.sensitivity !== 'normal') {
          mismatch('proposal', x.proposalRef, 'evidence_scope_changed');
        } else if (e.authority_class !== x.expectedAuthority) {
          mismatch('proposal', x.proposalRef, 'evidence_authority_changed');
        }
      }
    }

    for (const x of manifest.candidates) {
      const row = c.m.get(x.candidateRef);
      if (!row) { mismatch('candidate', x.candidateRef, 'not_open_in_project'); continue; }
      if (row.status !== x.expectedStatus) mismatch('candidate', x.candidateRef, 'status_changed');
      if (row.proposed_type !== x.expectedType) mismatch('candidate', x.candidateRef, 'type_changed');
      if (sha256(row.proposed_value) !== x.proposedValueSha256) {
        mismatch('candidate', x.candidateRef, 'proposed_value_hash_changed');
      }
      if (candidateSlots.get(row.branch) !== x.branchSlot) {
        mismatch('candidate', x.candidateRef, 'branch_slot_changed');
      }
      if (opaque('e', row.source_evidence_id) !== x.evidenceRef) {
        mismatch('candidate', x.candidateRef, 'source_link_changed');
      }
      if (row.source_authority !== x.expectedAuthority) {
        mismatch('candidate', x.candidateRef, 'declared_authority_changed');
      }
      const e = evidence.get(row.source_evidence_id);
      if (!e || e.project_id !== projectId || e.branch !== row.branch
        || e.sensitivity !== 'normal') {
        mismatch('candidate', x.candidateRef, 'evidence_scope_changed');
        continue;
      }
      if (e.authority_class !== x.expectedAuthority
        || e.source_kind !== x.sourceKind) {
        mismatch('candidate', x.candidateRef, 'evidence_metadata_changed');
      }
      // Full stored redacted Evidence SHA-256, even if only an excerpt was
      // displayed in the earlier review. This is drift comparison only.
      if (typeof e.content_redacted !== 'string') {
        mismatch('candidate', x.candidateRef, 'stored_evidence_hash_changed');
      } else {
        storedCandidateEvidenceHashesCompared++;
        if (sha256(e.content_redacted) !== x.evidenceSha256) {
          mismatch('candidate', x.candidateRef, 'stored_evidence_hash_changed');
        }
      }
    }

    for (const ref of manifest.expectedActiveClaimRefs) {
      const row = cl.m.get(ref);
      if (!row) { mismatch('claim', ref, 'not_active_in_scope'); continue; }
      if (row.state !== 'active') mismatch('claim', ref, 'claim_state_changed');
      const linked = claimEvidence.all(row.id);
      const primaries = linked.filter(x => x.role === 'primary');
      if (!linked.length || linked.length > MAX_LINKS
        || primaries.length !== 1
        || primaries[0].evidence_id !== row.created_from_evidence_id
        || linked.some(x => !['primary', 'supporting'].includes(x.role))) {
        mismatch('claim', ref, 'primary_evidence_link_changed');
      }
      const refs = linked.map(x => opaque('e', x.evidence_id));
      if (new Set(refs).size !== refs.length) mismatch('claim', ref, 'evidence_ref_collision');
      for (const link of linked) {
        const e = evidence.get(link.evidence_id);
        if (!e || e.project_id !== projectId || e.branch !== row.branch_scope
          || e.sensitivity !== 'normal') {
          mismatch('claim', ref, 'evidence_scope_changed');
        }
      }
    }
    const status = blockers.length ? 'blocked' : 'matched_read_only';
    return {
      ...baseline, status, blockers: [...new Set(blockers)],
      coverage: {
        expected: { proposals: 21, candidates: 87, activeClaims: 2 },
        observed, exact: !blockers.includes('project_inventory_changed')
          && !blockers.includes('project_reference_set_changed'),
        matchedReviewedItems: status === 'matched_read_only' ? 108 : null,
        mismatchedReviewedRefs: new Set(mismatches.map(x => x.ref)).size,
      },
      intentions: {
        proposals: { ignored: 19, retainedForReview: 2 },
        legacyCandidates: { ignored: 86, retainedForReview: 1 },
        totalIgnored: 105, totalRetainedForReview: 3,
        applied: 0,
      },
      storedCandidateEvidenceHashesCompared,
      proposalEvidenceBodyHashesCompared: 0,
      activeClaimTextHashesCompared: 0,
      activeClaimEvidenceScopeCheckAttempted: true,
      activeClaimEvidenceScopesVerified: status === 'matched_read_only',
      mismatches: mismatches.slice(0, 24),
      mismatchesTruncated: mismatches.length > 24,
      nextStep: status === 'matched_read_only'
        ? 'separate_host_authenticated_consent_and_project_policy_design_required'
        : 'reinventory_and_manually_reconcile_changed_rows_before_any_authorization',
    };
  } finally {
    try { if (started) db.exec('ROLLBACK'); }
    finally { db.close(); }
  }
}

const isCli = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (isCli) {
  try {
    const args = parseFinal108ReconciliationArgs(process.argv.slice(2));
    if (statSync(args.reviewFile).size > MAX_FILE_BYTES) throw new Error('review too large');
    const file = readFileSync(args.reviewFile);
    if (sha256(file) !== args.expectedReviewSha256) throw new Error('review checksum mismatch');
    const manifest = JSON.parse(file.toString('utf8'));
    const report = reconcileFinal108Review({ ...args, manifest });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'matched_read_only') process.exitCode = 1;
  } catch {
    // Avoid leaking untrusted source paths or contents in CLI errors.
    console.error('D12.3 read-only reconciliation unavailable. Verify local scope, manifest and database.');
    process.exitCode = 1;
  }
}
