#!/usr/bin/env node
/**
 * D12.3 non-mutating, provenance-checked review.
 *
 * This does NOT confirm a memory. CLI selections are not user_direct evidence.
 * Never call a write-capable MemoryEngine from this path.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  inspectAtomicReviewRows,
  previewAtomicReviewIntent,
} from '../memory-engine/memory-atomic-review-provenance.mjs';

export function parseAtomicReviewArgs(argv = []) {
  const args = {
    dbPath: null, projectId: null, branch: null, limit: 20,
    candidateRef: null, reviewRefs: null, intent: null, showLocalContent: false,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate argument');
    seen.add(flag);
    if (flag === '--show-local-content') {
      args.showLocalContent = true;
      continue;
    }
    if (!['--db-path','--project-id','--branch','--limit','--candidate-ref','--review-refs','--intent'].includes(flag)) {
      throw new Error('unsupported argument');
    }
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim()) throw new Error('missing argument value');
    if (flag === '--db-path') args.dbPath = resolve(value);
    else if (flag === '--project-id') args.projectId = value.trim();
    else if (flag === '--branch') args.branch = value.trim();
    else if (flag === '--limit' && /^(?:[1-9]|1[0-9]|20)$/u.test(value)) args.limit = Number(value);
    else if (flag === '--candidate-ref' && /^~[0-9a-f]{10}$/u.test(value)) args.candidateRef = value;
    else if (flag === '--review-refs') args.reviewRefs = value.split(',').map(x => x.trim());
    else if (flag === '--intent' && ['retain_for_confirmation','dismiss_preview','defer'].includes(value)) args.intent = value;
    else if (flag === '--limit') throw new Error('limit must be 1..20');
    else throw new Error('unsupported argument value');
  }
  if (!args.dbPath || !args.projectId || !args.branch) throw new Error('exact scope required');
  if ([args.candidateRef, args.reviewRefs, args.intent].some(x => x !== null)
    && [args.candidateRef, args.reviewRefs, args.intent].some(x => x === null)) {
    throw new Error('review intent requires candidate, refs, and intent together');
  }
  if (args.reviewRefs !== null
    && (args.reviewRefs.length < 1 || args.reviewRefs.length > 5
      || args.reviewRefs.some(x => !/^~a[0-9a-f]{16}$/u.test(x))
      || new Set(args.reviewRefs).size !== args.reviewRefs.length)) {
    throw new Error('invalid review reference selection');
  }
  return args;
}

export function inspectAtomicReviewDb({
  dbPath, projectId, branch, limit = 20,
  showLocalContent = false,
  candidateRef = null, reviewRefs = null, intent = null,
  openDatabase = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (typeof dbPath !== 'string' || !dbPath
    || typeof projectId !== 'string' || !projectId.trim()
    || typeof branch !== 'string' || !branch.trim()
    || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new TypeError('exact scope and bounded limit required');
  }
  if ([candidateRef, reviewRefs, intent].some(x => x !== null)
    && [candidateRef, reviewRefs, intent].some(x => x === null)) {
    throw new TypeError('review intent requires complete selection');
  }
  const db = openDatabase(dbPath);
  try {
    const rows = db.prepare(
      'SELECT c.id AS candidate_id, c.project_id, c.branch AS candidate_branch, '
      + 'c.source_authority, c.proposed_type, c.proposed_value, c.status, '
      + 'c.evaluated_at, c.source_evidence_id, '
      + 'e.id AS evidence_id, e.project_id AS evidence_project_id, '
      + 'e.branch AS evidence_branch, e.authority_class, e.sensitivity, '
      + 'e.content_redacted '
      + 'FROM memory_candidates c LEFT JOIN evidence e ON e.id = c.source_evidence_id '
      + "WHERE c.project_id = ? AND c.branch = ? AND c.source_authority = 'user_direct' "
      + "AND c.status = 'pending' AND c.evaluated_at IS NULL "
      + 'ORDER BY c.created_at ASC, c.id ASC LIMIT ?',
    ).all(projectId, branch, limit);
    const report = inspectAtomicReviewRows(rows, { projectId, branch, showLocalContent });
    if (intent !== null) {
      return {
        ...previewAtomicReviewIntent({ report, candidateRef, reviewRefs, intent }),
        integrityRejectedCandidateCount: report.excludedIntegrity,
      };
    }
    return report;
  } finally {
    db.close();
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  try {
    console.log(JSON.stringify(
      inspectAtomicReviewDb(parseAtomicReviewArgs(process.argv.slice(2))),
      null, 2,
    ));
  } catch {
    console.error('Atomic review unavailable: check scope, provenance and selection.');
    process.exitCode = 1;
  }
}
