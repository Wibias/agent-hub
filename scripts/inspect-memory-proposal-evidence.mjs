#!/usr/bin/env node
/**
 * D12.3 local, single-proposal Evidence/Claim review.
 * A read-only diagnostic. Source text is available only by explicit TTY opt-in.
 * A human must review meaning, source authority and any Claim relationship.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OPEN_STATUSES = ['pending', 'needs_confirmation', 'failed'];
const REF = /^~p[0-9a-f]{12}$/u;
const CLAIM_STATES = ['active', 'candidate', 'stale', 'conflicted'];
const MAX_PROPOSALS = 10000;
const MAX_COMPARISONS = 50;
const MAX_SOURCE_CHARS = 4000;
const MAX_CLAIM_CHARS = 1000;
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
const proposalRef = id => '~p' + digest(id);
const evidenceRef = id => '~e' + digest(id);
const claimRef = id => '~c' + digest(id);
const allowed = (value, options) => options.includes(value) ? value : 'unknown';
function eventType(json) {
  try {
    const value = JSON.parse(json ?? '{}')?.event_type;
    return allowed(value, ['user_prompt', 'tool_output', 'tool_result', 'assistant_message']);
  } catch { return 'unknown'; }
}
const tablePresent = (db, name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
).get(name));

function excerpt(value, limit) {
  const text = String(value ?? '');
  return { text: text.slice(0, limit), truncated: text.length > limit };
}

export function parseLocalProposalReviewArgs(argv = []) {
  const args = {
    dbPath: null, projectId: null, branch: null,
    selectedRef: null, showLocalContent: false,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate option');
    seen.add(flag);
    if (flag === '--show-local-content') {
      args.showLocalContent = true;
      continue;
    }
    if (!['--db-path', '--project-id', '--branch', '--proposal-ref'].includes(flag)) {
      throw new Error('unsupported option');
    }
    const value = argv[++i];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('missing option value');
    }
    if (flag === '--db-path') args.dbPath = resolve(value);
    if (flag === '--project-id') args.projectId = value.trim();
    if (flag === '--branch') args.branch = value.trim();
    if (flag === '--proposal-ref') args.selectedRef = value.trim();
  }
  if (![args.dbPath, args.projectId, args.branch].every(
    v => typeof v === 'string' && v.trim(),
  ) || !REF.test(args.selectedRef ?? '')) {
    throw new Error('exact DB, project, branch and proposal ref required');
  }
  return args;
}

export function inspectLocalMemoryProposalEvidence({
  dbPath, projectId, branch, selectedRef, showLocalContent = false,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (![dbPath, projectId, branch].every(v => typeof v === 'string' && v.trim())
    || !REF.test(selectedRef ?? '') || typeof showLocalContent !== 'boolean') {
    throw new TypeError('exact scope, opaque ref and explicit local options required');
  }

  const db = openDb(dbPath);
  let began = false;
  try {
    db.exec('BEGIN');
    began = true;
    const output = {
      type: 'agent_hub_memory_local_evidence_review_v1',
      readOnly: true,
      writesToSource: false,
      modelInvocations: 0,
      decisionsApplied: 0,
      claimsCreated: 0,
      promotionAllowed: false,
      showLocalContentRequested: showLocalContent,
      contentIncluded: false,
      scope: { projectId, branch },
      proposalRef: selectedRef,
    };
    if (!['memory_evidence_proposals', 'memory_evidence_proposal_evidence', 'evidence']
      .every(name => tablePresent(db, name))) {
      return { ...output, status: 'required_ledger_missing' };
    }

    // Resolve exactly the inventory's opaque refs, never raw proposal IDs.
    // All open proposals in this scope are checked for hash collisions.
    const proposals = db.prepare(
      'SELECT id, kind, status, canonical_fact FROM memory_evidence_proposals ' +
      "WHERE project_id=? AND branch=? AND status IN ('pending','needs_confirmation','failed') " +
      'ORDER BY created_at ASC, id ASC LIMIT ?',
    ).all(projectId, branch, MAX_PROPOSALS + 1);
    if (proposals.length > MAX_PROPOSALS) {
      return { ...output, status: 'too_many_proposals_to_resolve_safely' };
    }
    const selected = proposals.filter(p => proposalRef(p.id) === selectedRef);
    if (selected.length !== 1) {
      return { ...output, status: selected.length ? 'opaque_ref_collision' : 'not_found' };
    }
    const proposal = selected[0];
    const rows = db.prepare(
      'SELECT l.evidence_id, e.id AS evidence_exists, e.project_id, e.branch, ' +
      'e.sensitivity, e.authority_class, e.source_kind, e.harness, e.content_redacted, ' +
      'e.metadata_json FROM memory_evidence_proposal_evidence l ' +
      'LEFT JOIN evidence e ON e.id=l.evidence_id ' +
      'WHERE l.proposal_id=? ORDER BY l.evidence_id ASC',
    ).all(proposal.id);
    const sourcesValid = rows.length > 0 && rows.every(
      r => r.evidence_exists && r.project_id === projectId &&
        r.branch === branch && r.sensitivity === 'normal',
    );
    const safeContent = showLocalContent && sourcesValid;
    const sources = rows.map(r => {
      const exists = Boolean(r.evidence_exists);
      const inScope = exists && r.project_id === projectId && r.branch === branch;
      const normal = exists && r.sensitivity === 'normal';
      const source = {
        evidenceRef: evidenceRef(r.evidence_id),
        exists,
        inScope,
        normalSensitivity: normal,
        authorityClass: exists ? allowed(r.authority_class, [
          'user_direct', 'repo_trusted', 'tool_observation', 'agent_inference',
        ]) : 'missing',
        sourceKind: exists ? allowed(r.source_kind, [
          'session', 'repository', 'tool', 'file', 'event',
        ]) : 'missing',
        harness: exists ? allowed(r.harness, [
          'codex', 'claude', 'cursor', 'opencode',
        ]) : 'missing',
        // A declared authority class is not proof of host-authenticated consent.
        eventType: exists ? eventType(r.metadata_json) : 'missing',
        hostOriginAuthenticatedByThisAudit: false,
      };
      if (safeContent && inScope && normal) {
        const preview = excerpt(r.content_redacted, MAX_SOURCE_CHARS);
        source.localRedactedEvidenceExcerpt = preview.text;
        source.excerptTruncated = preview.truncated;
      }
      return source;
    });
    if (new Set(sources.map(s => s.evidenceRef)).size !== sources.length) {
      return { ...output, status: 'opaque_evidence_ref_collision' };
    }

    const relationLedgerPresent = tablePresent(db, 'memory_evidence_proposal_relations');
    const relation = relationLedgerPresent
      ? db.prepare('SELECT relation, related_claim_id FROM memory_evidence_proposal_relations ' +
        'WHERE proposal_id=?').get(proposal.id)
      : null;
    const claimsLedgerPresent = tablePresent(db, 'claims');
    let claimComparison = {
      ledgerPresent: claimsLedgerPresent,
      comparisonStates: CLAIM_STATES,
      total: null,
      returned: 0,
      truncated: false,
      items: [],
      semanticConflictDetected: null,
    };
    if (claimsLedgerPresent) {
      const placeholders = CLAIM_STATES.map(() => '?').join(',');
      const total = db.prepare(
        'SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=? ' +
        'AND state IN (' + placeholders + ')',
      ).get(projectId, branch, ...CLAIM_STATES).n;
      const claims = db.prepare(
        'SELECT c.id, c.kind, c.state, c.subject, c.predicate, c.value_text, ' +
        'e.sensitivity AS source_sensitivity, e.project_id AS source_project, ' +
        'e.branch AS source_branch FROM claims c ' +
        'LEFT JOIN evidence e ON e.id=c.created_from_evidence_id ' +
        'WHERE c.project_id=? AND c.branch_scope=? AND c.state IN (' +
        placeholders + ') ORDER BY c.created_at ASC, c.id ASC LIMIT ?',
      ).all(projectId, branch, ...CLAIM_STATES, MAX_COMPARISONS + 1);
      const preview = claims.slice(0, MAX_COMPARISONS);
      claimComparison = {
        ledgerPresent: true,
        comparisonStates: CLAIM_STATES,
        total,
        returned: preview.length,
        truncated: total > preview.length,
        semanticConflictDetected: null,
        items: preview.map(c => {
          const item = {
            claimRef: claimRef(c.id),
            kind: allowed(c.kind, ['preference', 'procedure', 'knowledge']),
            state: allowed(c.state, CLAIM_STATES),
            sourceNormalAndInScope: c.source_sensitivity === 'normal' &&
              c.source_project === projectId && c.source_branch === branch,
          };
          if (safeContent && item.sourceNormalAndInScope) {
            item.localSubject = excerpt(c.subject, MAX_CLAIM_CHARS);
            item.localPredicate = excerpt(c.predicate, MAX_CLAIM_CHARS);
            item.localValue = excerpt(c.value_text, MAX_CLAIM_CHARS);
          }
          return item;
        }),
      };
      if (new Set(claimComparison.items.map(c => c.claimRef)).size !==
        claimComparison.items.length) {
        return { ...output, status: 'opaque_claim_ref_collision' };
      }
    }
    const validRelation = ['same', 'update', 'contradict', 'unrelated'];
    return {
      ...output,
      status: 'ok',
      contentIncluded: safeContent,
      proposal: {
        kind: allowed(proposal.kind, ['preference', 'procedure', 'knowledge']),
        status: allowed(proposal.status, OPEN_STATUSES),
        linkedEvidence: rows.length,
        sourcesStructurallyReviewable: sourcesValid,
        sourceAuthorityNeedsHumanReview: true,
        nonUserDirectEvidencePresent: sources.some(
          s => s.exists && s.authorityClass !== 'user_direct',
        ),
        meaningNeedsHumanReview: true,
        ...(safeContent ? { localCanonicalFact: excerpt(proposal.canonical_fact, 500) } : {}),
      },
      sources,
      recordedRelation: relation && validRelation.includes(relation.relation)
        ? relation.relation : null,
      relationLedgerPresent,
      recordedRelationTargetInScope: claimsLedgerPresent && relation?.related_claim_id
        ? Boolean(db.prepare('SELECT 1 FROM claims WHERE id=? AND project_id=? ' +
          'AND branch_scope=?').get(relation.related_claim_id, projectId, branch))
        : null,
      claimComparison,
      decision: 'manual_review_required',
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
    const args = parseLocalProposalReviewArgs(process.argv.slice(2));
    if (args.showLocalContent && !process.stdout.isTTY) {
      throw new Error('content preview requires an interactive terminal');
    }
    const report = inspectLocalMemoryProposalEvidence(args);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'ok') process.exitCode = 1;
  } catch {
    console.error('Read-only local review unavailable. Verify scope, opaque ref, and interactive terminal.');
    process.exitCode = 1;
  }
}
