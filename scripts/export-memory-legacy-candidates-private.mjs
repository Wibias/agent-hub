#!/usr/bin/env node
/**
 * D12.3 Phase 14: explicit, LOCAL, read-only SQLite -> one PRIVATE JSON export
 * of all still-open legacy Candidate excerpts, for MANUAL meaning review.
 *
 * DB read-only. Writes ONLY the caller-selected, new local JSON output file.
 * Never authenticates consent, updates statuses, or promotes Claims.
 */
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, unlinkSync, writeSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const TYPE = 'agent_hub_memory_private_legacy_candidate_review_export_v1';
const OPEN = ['pending', 'needs_confirmation', 'failed'];
const CLAIM_STATES = ['active', 'candidate', 'stale', 'conflicted'];
const TYPES = ['decision', 'preference', 'constraint', 'correction',
  'rejected_approach', 'known_issue'];
const AUTHORITIES = ['user_direct', 'repo_trusted', 'tool_observation',
  'agent_inference', 'external_untrusted', 'unclassified'];
const SOURCE_KINDS = ['session', 'repository', 'tool', 'file', 'event'];
const MAX_CANDIDATES = 250;
const MAX_VALUE_CHARS = 2500;
const MAX_SOURCE_CHARS = 8000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const opaque = (prefix, id) => '~' + prefix + hash(id).slice(0, 12);
const safe = (value, choices) => choices.includes(value) ? value : 'unknown';
const excerpt = (input, cap) => {
  const full = String(input ?? '');
  return {
    text: full.slice(0, cap),
    truncated: full.length > cap,
    fullLengthChars: full.length,
    originalSha256: hash(full),
  };
};
const present = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));
const blocked = (base, code) => ({
  ...base, status: 'blocked', blockers: [code], items: [],
});

export function parseLegacyCandidateExportArgs(argv = []) {
  const names = new Map([
    ['--db-path', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--source-branch', 'sourceBranch'],
    ['--expected-count', 'expectedCount'],
    ['--output-file', 'outputFile'],
  ]);
  const args = {
    dbPath: null, projectId: null, sourceBranch: null,
    expectedCount: null, outputFile: null,
    includeLocalRedactedContent: false,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('repeated option');
    seen.add(flag);
    if (flag === '--include-local-redacted-content') {
      args.includeLocalRedactedContent = true;
      continue;
    }
    if (!names.has(flag)) throw new Error('unsupported option');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error('missing option value');
    }
    const field = names.get(flag);
    args[field] = ['dbPath', 'outputFile'].includes(field) ? resolve(value) : value.trim();
  }
  if (![args.dbPath, args.projectId, args.sourceBranch, args.outputFile]
    .every(value => typeof value === 'string' && value.trim())
    || typeof args.expectedCount !== 'string'
    || !/^[1-9][0-9]{0,2}$/u.test(args.expectedCount)
    || Number(args.expectedCount) > MAX_CANDIDATES
    || !args.includeLocalRedactedContent) {
    throw new Error('exact scope, expected count, private path, and explicit opt-in required');
  }
  if (args.dbPath === args.outputFile || !args.outputFile.endsWith('.json')) {
    throw new Error('output must be a separate, new JSON file');
  }
  args.expectedCount = Number(args.expectedCount);
  return args;
}

export function buildLegacyCandidateReviewExport({
  dbPath, projectId, sourceBranch, expectedCount,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, sourceBranch].every(value =>
    typeof value === 'string' && value.trim())
    || !Number.isInteger(expectedCount)
    || expectedCount < 1 || expectedCount > MAX_CANDIDATES) {
    throw new TypeError('exact scoped, bounded read-only export required');
  }
  const base = {
    type: TYPE,
    readOnlySource: true, writesToSource: false, writesOnlyLocalOutputFile: true,
    modelInvocations: 0, decisionsApplied: 0, candidatesPromoted: 0,
    claimsCreated: 0, promotionAllowed: false,
    hostConsentAuthenticated: false, evidenceBodyIntegrityVerified: false,
    semanticConflictChecked: false, semanticConflictDetected: null,
    projectWidePropagationImplemented: false,
    candidateMeaningsReviewed: false,
    scope: { projectId, sourceBranch },
  };
  const db = openDb(dbPath);
  let begun = false;
  try {
    db.exec('BEGIN');
    begun = true;
    if (!['project_registry', 'claims', 'memory_candidates',
      'memory_evidence_proposals', 'evidence']
      .every(name => present(db, name))) {
      return blocked(base, 'required_ledger_missing');
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      return blocked(base, 'project_not_registered');
    }
    const candidates = db.prepare(
      'SELECT c.id,c.branch,c.status,c.proposed_type,c.proposed_value,' +
      'c.source_evidence_id,c.source_authority,e.id AS evidence_exists,' +
      'e.project_id AS evidence_project,e.branch AS evidence_branch,' +
      'e.authority_class AS evidence_authority,e.sensitivity AS evidence_sensitivity,' +
      'e.source_kind AS evidence_source_kind,e.content_redacted AS evidence_content ' +
      'FROM memory_candidates c LEFT JOIN evidence e ON e.id=c.source_evidence_id ' +
      "WHERE c.project_id=? AND c.status IN ('pending','needs_confirmation','failed') " +
      'ORDER BY c.id LIMIT ?',
    ).all(projectId, MAX_CANDIDATES + 1);
    if (candidates.length > MAX_CANDIDATES) {
      return blocked(base, 'too_many_open_candidates');
    }
    if (candidates.length !== expectedCount) {
      return {
        ...blocked(base, 'candidate_count_changed'),
        expectedCount, observedCount: candidates.length,
      };
    }
    const candidateRefs = candidates.map(row => opaque('m', row.id));
    if (new Set(candidateRefs).size !== candidateRefs.length) {
      return blocked(base, 'opaque_candidate_ref_collision');
    }
    const distinctEvidenceRefs = new Map();
    for (const row of candidates) {
      const ref = opaque('e', row.source_evidence_id);
      if (distinctEvidenceRefs.has(ref)
        && distinctEvidenceRefs.get(ref) !== row.source_evidence_id) {
        return blocked(base, 'opaque_evidence_ref_collision');
      }
      distinctEvidenceRefs.set(ref, row.source_evidence_id);
      if (!row.evidence_exists || row.evidence_project !== projectId
        || row.evidence_branch !== row.branch
        || row.evidence_sensitivity !== 'normal') {
        return blocked(base, 'linked_evidence_not_safe_in_scope');
      }
      if (row.source_authority !== row.evidence_authority) {
        return blocked(base, 'source_authority_changed');
      }
      if (!TYPES.includes(row.proposed_type)
        || !OPEN.includes(row.status)
        || !AUTHORITIES.includes(row.evidence_authority)) {
        return blocked(base, 'unexpected_candidate_metadata');
      }
    }

    // Match the D12.3 cross-branch inventory's ephemeral source/other-NN
    // labels over the union of open Claims, Candidates, and Proposals.
    const branches = new Set(candidates.map(row => row.branch));
    for (const row of db.prepare(
      'SELECT DISTINCT branch_scope AS branch FROM claims ' +
      "WHERE project_id=? AND state IN ('active','candidate','stale','conflicted')",
    ).all(projectId)) branches.add(row.branch);
    for (const row of db.prepare(
      'SELECT DISTINCT branch FROM memory_evidence_proposals ' +
      "WHERE project_id=? AND status IN ('pending','needs_confirmation','failed')",
    ).all(projectId)) branches.add(row.branch);
    const otherBranches = [...branches].filter(branch => branch !== sourceBranch)
      .sort((a, b) => a.localeCompare(b, 'en'));
    if (otherBranches.length > 99) {
      return blocked(base, 'too_many_branch_groups');
    }
    const slots = new Map([[sourceBranch, 'source']]);
    otherBranches.forEach((branch, i) =>
      slots.set(branch, 'other-' + String(i + 1).padStart(2, '0')));

    const items = candidates.map((row, i) => {
      const sourceContent = row.evidence_content;
      return {
        candidateRef: candidateRefs[i],
        branchSlot: slots.get(row.branch),
        status: row.status,
        proposedType: row.proposed_type,
        proposedValue: excerpt(row.proposed_value, MAX_VALUE_CHARS),
        source: {
          evidenceRef: opaque('e', row.source_evidence_id),
          authority: row.evidence_authority,
          sourceKind: safe(row.evidence_source_kind, SOURCE_KINDS),
          sameProjectAndCandidateBranch: true,
          normalSensitivity: true,
          sourceAuthorityAgrees: true,
          redactedEvidence: excerpt(sourceContent, MAX_SOURCE_CHARS),
          contentAvailable: typeof sourceContent === 'string' && sourceContent.length > 0,
        },
        requiresHumanMeaningReview: true,
      };
    });
    return {
      ...base, status: 'ready_for_private_local_export', blockers: [],
      inventory: {
        expectedCount, returnedCount: items.length, complete: true,
        truncatedCandidates: items.filter(item => item.proposedValue.truncated).length,
        truncatedEvidence: items.filter(item => item.source.redactedEvidence.truncated).length,
        missingEvidenceContent: items.filter(item => !item.source.contentAvailable).length,
        branchSlots: [...slots.values()].sort(),
      },
      contentIncluded: true,
      contentRedaction: 'stored_evidence_content_redacted_only_not_independently_verified',
      maxValueChars: MAX_VALUE_CHARS,
      maxEvidenceChars: MAX_SOURCE_CHARS,
      items,
      nextStep: 'user_must_review_local_private_json_before_upload_or_manual_meaning_analysis',
    };
  } finally {
    try { if (begun) db.exec('ROLLBACK'); }
    finally { db.close(); }
  }
}

export function exportLegacyCandidateReviewFile({
  dbPath, projectId, sourceBranch, expectedCount, outputFile,
  openDb,
} = {}) {
  if (typeof outputFile !== 'string' || !outputFile.endsWith('.json')
    || resolve(outputFile) === resolve(dbPath)) {
    throw new TypeError('separate explicit JSON output path required');
  }
  const report = buildLegacyCandidateReviewExport({
    dbPath, projectId, sourceBranch, expectedCount,
    ...(openDb ? { openDb } : {}),
  });
  if (report.status !== 'ready_for_private_local_export') {
    return { status: report.status, blockers: report.blockers, inventory: report.inventory ?? null };
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  const bytes = Buffer.from(json, 'utf8');
  if (bytes.length > MAX_FILE_BYTES) {
    return { status: 'blocked', blockers: ['private_export_exceeds_size_limit'] };
  }
  const destination = resolve(outputFile);
  let fd = null;
  let created = false;
  try {
    // Exclusive creation; refuse overwrite, including preexisting symlinks.
    fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    created = true;
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error('private export could not be completed');
      offset += written;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (created) {
      try { unlinkSync(destination); } catch { /* report original failure */ }
    }
    throw error;
  }
  return {
    type: 'agent_hub_memory_private_legacy_candidate_export_receipt_v1',
    status: 'private_local_export_created',
    databaseReadOnly: true, decisionsApplied: 0, claimsCreated: 0,
    hostConsentAuthenticated: false, promotionAllowed: false,
    candidatesExported: report.items.length,
    truncation: {
      candidateValues: report.inventory.truncatedCandidates,
      evidenceBodies: report.inventory.truncatedEvidence,
      missingEvidenceBodies: report.inventory.missingEvidenceContent,
    },
    bytes: bytes.length, sha256: hash(json), outputPathIncluded: false,
    privateContentPrinted: false,
    reminder: 'inspect_private_json_before_sharing;_not_an_authenticated_review',
  };
}

const isCli = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (isCli) {
  try {
    const args = parseLegacyCandidateExportArgs(process.argv.slice(2));
    if (!process.stdout.isTTY) {
      throw new Error('explicit private export requires an interactive terminal');
    }
    const receipt = exportLegacyCandidateReviewFile(args);
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.status !== 'private_local_export_created') process.exitCode = 1;
  } catch {
    console.error('Private read-only Candidate export unavailable. Check source, scope, opt-in and output path.');
    process.exitCode = 1;
  }
}
