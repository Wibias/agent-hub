import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { memoryClaimRef } from './adapters/codex-hooks.mjs';
import { listEvidenceBoundProposals } from './evidence-bound-proposal-store.mjs';

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeLabel(value) {
  return text(value) ? value : null;
}

/**
 * Read-only inspection of the separate evidence-bound review queue.
 * Its needs_confirmation status is a terminal pipeline outcome, not an
 * authorization to mutate a canonical Claim or to reuse candidate commands.
 */
export function memoryEvidenceReviewSnapshot({
  dbPath,
  projectId,
  branch,
  openDb = (path) => new DatabaseSync(path, { readOnly: true, timeout: 5_000 }),
} = {}) {
  if (!text(dbPath) || !text(projectId) || !text(branch)) {
    throw new TypeError('dbPath, projectId and branch are required');
  }
  const db = openDb(dbPath);
  try {
    db.exec('PRAGMA query_only = ON');
    const schema = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'memory_evidence_proposals'",
    ).get();
    if (!schema) {
      return { status: 'not_configured', total: 0, truncated: false, items: [] };
    }

    const intentTable = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'memory_evidence_bound_review_intents'",
    ).get();
    // This ledger stores an untrusted *intent*, never a user-authorized
    // promotion. Keep the existing needs_confirmation backlog unchanged.
    let intentLookup = null;
    if (intentTable) {
      try {
        intentLookup = db.prepare(
          'SELECT decision, status, recorded_at FROM memory_evidence_bound_review_intents '
          + 'WHERE proposal_id = ? AND project_id = ? AND branch = ?',
        );
      } catch {
        // A malformed/outdated optional ledger cannot grant approval or
        // suppress the original evidence-bound review backlog.
      }
    }

    const total = Number(db.prepare(
      'SELECT COUNT(*) AS n FROM memory_evidence_proposals '
      + 'WHERE project_id = ? AND branch = ? AND status = ?',
    ).get(projectId, branch, 'needs_confirmation').n);
    const rows = listEvidenceBoundProposals(db, {
      projectId,
      branch,
      status: 'needs_confirmation',
      limit: 100,
    });
    return {
      status: 'ready',
      total,
      truncated: total > rows.length,
      items: rows.map((row) => {
        let reviewIntent = null;
        if (intentLookup) {
          try {
            const intent = intentLookup.get(row.id, projectId, branch);
            if (intent && intent.status === 'awaiting_independent_host_authorization'
              && ['confirm', 'reject'].includes(intent.decision)) {
              reviewIntent = {
                decision: intent.decision,
                status: 'awaiting_independent_host_authorization',
                recordedAt: intent.recorded_at,
                humanApprovalVerified: false,
                claimsModified: false,
              };
            }
          } catch {
            // Never invent a disposition when the optional ledger is invalid.
          }
        }
        return {
        id: row.id,
        ref: 'E~' + createHash('sha256').update(row.id).digest('hex').slice(0, 10),
        value: row.canonical_fact,
        kind: row.kind,
        status: row.status,
        reviewIntent,
        createdAt: row.created_at,
        authorities: row.authorities,
        sourceCount: row.evidence_ids.length,
        importance: row.importance
          ? {
              decision: safeLabel(row.importance.decision),
              reason: safeLabel(row.importance.reason),
              confidence: safeLabel(row.importance.confidence),
            } : null,
        support: row.support
          ? {
              decision: safeLabel(row.support.decision),
              reason: safeLabel(row.support.reason),
              confidence: safeLabel(row.support.confidence),
            } : null,
        relation: row.relation
          ? {
              type: safeLabel(row.relation.relation),
              confidence: safeLabel(row.relation.confidence),
              reason: safeLabel(row.relation.reason),
              targetRef: row.related_claim_id
                ? memoryClaimRef(row.related_claim_id) : null,
            } : null,
      };
      }),
    };
  } finally {
    db.close();
  }
}
