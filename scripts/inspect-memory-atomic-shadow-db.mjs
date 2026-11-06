#!/usr/bin/env node
/**
 * D12.3 database-backed shadow observation. Source opens read-only;
 * candidate text is never printed, persisted, or sent to a provider.
 * No automatic extraction, ledger writes, or policy modifications.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoryCandidateJudgeRef } from '../memory-engine/memory-candidate-judge.mjs';
import {
  proposeAtomicCandidateShadows,
  summarizeAtomicCandidateShadows,
} from '../memory-engine/memory-atomic-candidate-shadow.mjs';

const KINDS = new Set(['decision','preference','constraint','correction','rejected_approach','known_issue']);

export function parseAtomicShadowDbArgs(argv = []) {
  const result = { dbPath: null, projectId: null, branch: null, limit: 20 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate option');
    seen.add(flag);
    if (!['--db-path','--project-id','--branch','--limit'].includes(flag)) {
      throw new Error('unsupported option');
    }
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim()) throw new Error('missing value');
    if (flag === '--db-path') result.dbPath = resolve(value);
    else if (flag === '--project-id') result.projectId = value.trim();
    else if (flag === '--branch') result.branch = value.trim();
    else if (/^(?:[1-9]|1[0-9]|20)$/u.test(value)) result.limit = Number(value);
    else throw new Error('limit must be 1..20');
  }
  if (!result.dbPath || !result.projectId || !result.branch) throw new Error('exact scope is required');
  return result;
}

export function inspectAtomicShadowDb({
  dbPath, projectId, branch, limit = 20,
  openDatabase = (path) => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (typeof dbPath !== 'string' || !dbPath.trim()
    || typeof projectId !== 'string' || !projectId.trim()
    || typeof branch !== 'string' || !branch.trim()) {
    throw new Error('exact scope is required');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be 1..20');
  const db = openDatabase(dbPath);
  try {
    const candidates = db.prepare(
      'SELECT id, proposed_type, proposed_value FROM memory_candidates '
      + "WHERE project_id = ? AND branch = ? AND source_authority = 'user_direct' "
      + "AND status = 'pending' AND evaluated_at IS NULL "
      + 'ORDER BY created_at ASC, id ASC LIMIT ?',
    ).all(projectId, branch, limit);
    const items = [];
    const totals = { durable_review: 0, bounded_review: 0, ambiguous_review: 0 };
    const reasonCodes = {
      explicit_future_scope: 0,
      explicit_bounded_scope: 0,
      quality_feedback_without_duration: 0,
    };
    let candidatesRequiringReview = 0;
    let scopedAuditCandidatesExcluded = 0;
    for (const candidate of candidates) {
      const result = summarizeAtomicCandidateShadows(
        proposeAtomicCandidateShadows(candidate.proposed_value),
      );
      const suggestionCount = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
      if (suggestionCount > 0) candidatesRequiringReview += 1;
      if (result.reason === 'scoped_audit_protocol') scopedAuditCandidatesExcluded += 1;
      for (const key of Object.keys(totals)) totals[key] += result.counts[key];
      const itemReasonCodes = {};
      for (const suggestion of result.suggestions) {
        if (Object.hasOwn(reasonCodes, suggestion.reasonCode)) {
          reasonCodes[suggestion.reasonCode] += 1;
          itemReasonCodes[suggestion.reasonCode] = (itemReasonCodes[suggestion.reasonCode] ?? 0) + 1;
        }
      }
      items.push({
        candidateRef: memoryCandidateJudgeRef(candidate.id),
        candidateKind: KINDS.has(candidate.proposed_type) ? candidate.proposed_type : 'unknown',
        reason: result.reason,
        segmentsInspected: result.segmentsInspected,
        reviewCounts: result.counts,
        reviewHintCount: suggestionCount,
        reviewReasonCodes: itemReasonCodes,
        // No hashes or offsets here: never leak source-dependent data from DB.
      });
    }
    return {
      type: 'agent_hub_memory_atomic_db_shadow_v1',
      readOnly: true,
      modelInvocations: 0,
      sourceDatabaseModified: false,
      capturePolicyUnchanged: true,
      contentIncluded: false,
      scope: { projectId, branch },
      candidateCount: items.length,
      candidatesRequiringReview,
      scopedAuditCandidatesExcluded,
      reviewCounts: totals,
      reviewReasonCodes: reasonCodes,
      reviewHintInterpretation: 'Multiple hints are not independent facts, confirmed rules, or promotions.',
      items,
    };
  } finally {
    db.close();
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  try {
    const report = inspectAtomicShadowDb(parseAtomicShadowDbArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  } catch {
    console.error('DB shadow observation unavailable: verify file and exact scope.');
    process.exitCode = 1;
  }
}
