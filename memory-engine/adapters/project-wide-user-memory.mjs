import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine, evaluateReliance } from '../index.mjs';
import { publicItem } from './codex-readonly-memory-mcp.mjs';
import { isSyntheticMemoryItem } from './memory-read-provenance.mjs';

const SOURCE = 'local:operator-confirmation';
const EVENT_PREFIX = 'evidence:project-memory-scope:';
const PUBLISH = 'project_memory_publish';
const REVOKE = 'project_memory_revoke';

const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

function ensureProjectUserClaim(memory, { projectId, claimId }) {
  const claim = memory.getClaim(claimId);
  if (!claim || claim.project_id !== projectId || claim.state !== 'active'
    || claim.kind !== 'user_direct' || claim.subject !== 'user memory'
    || claim.predicate !== 'states') {
    throw new Error('project_scope_claim_not_eligible');
  }
  const evidence = memory.getEvidence(claim.created_from_evidence_id);
  if (!evidence || evidence.project_id !== projectId
    || evidence.authority_class !== 'user_direct'
    || evidence.source_kind !== 'session'
    || evidence.metadata?.event_type !== 'user_prompt'
    || evidence.branch !== claim.branch_scope
    || evidence.path !== null || evidence.blob_oid !== null
    || evidence.sensitivity === 'secret_redacted'
    || isSyntheticMemoryItem({ claim, evidence })) {
    throw new Error('project_scope_provenance_not_eligible');
  }
  return { claim, evidence, valueHash: digest(claim.value) };
}

// Scope changes are append-only canonical Evidence; export/import preserves them.
// No Claim value, branch, lifecycle edge or semantic embedding is rewritten.
function publicationEvents(dbPath, projectId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT id, metadata_json FROM evidence
      WHERE project_id = ?
        AND harness = 'codex'
        AND source_kind = 'operator_explicit'
        AND source_ref = ?
        AND authority_class = 'user_direct'
        AND id LIKE 'evidence:project-memory-scope:%'
      ORDER BY captured_at DESC, id DESC
    `).all(projectId, SOURCE).flatMap((row) => {
      try {
        const m = JSON.parse(row.metadata_json);
        return m && (m.event_type === PUBLISH || m.event_type === REVOKE)
          && nonEmpty(m.claim_id) && nonEmpty(m.origin_branch)
          && nonEmpty(m.primary_evidence_id) && /^[a-f0-9]{64}$/.test(m.value_hash)
          ? [{ id: row.id, ...m }] : [];
      } catch {
        return [];
      }
    });
  } finally {
    db.close();
  }
}

function latestPublicationStates(dbPath, projectId) {
  const states = new Map();
  for (const event of publicationEvents(dbPath, projectId)) {
    if (!states.has(event.claim_id)) states.set(event.claim_id, event);
  }
  return states;
}

export function inspectProjectMemoryPublication({ dbPath, projectId, claimId }) {
  if (![dbPath, projectId, claimId].every(nonEmpty)) throw new Error('invalid_publication_request');
  const memory = new MemoryEngine({ dbPath, readOnly: true });
  try {
    const { claim, evidence, valueHash } = ensureProjectUserClaim(memory, { projectId, claimId });
    const event = latestPublicationStates(dbPath, projectId).get(claimId);
    const published = event?.event_type === PUBLISH && event.value_hash === valueHash
      && event.origin_branch === claim.branch_scope
      && event.primary_evidence_id === evidence.id;
    return {
      claim_id: claim.id, project_id: claim.project_id, origin_branch: claim.branch_scope,
      value: claim.value, authority: evidence.authority_class, published,
    };
  } finally {
    memory.close();
  }
}

export function changeProjectMemoryPublication({
  dbPath, projectId, claimId, operation, confirmed = false,
  now = () => new Date().toISOString(),
}) {
  if (confirmed !== true) throw new Error('explicit_operator_confirmation_required');
  if (![dbPath, projectId, claimId].every(nonEmpty)
    || !['publish', 'revoke'].includes(operation)) {
    throw new Error('invalid_publication_request');
  }
  const memory = new MemoryEngine({ dbPath });
  try {
    const { claim, evidence, valueHash } = ensureProjectUserClaim(memory, { projectId, claimId });
    const last = latestPublicationStates(dbPath, projectId).get(claimId);
    const active = last?.event_type === PUBLISH && last.value_hash === valueHash
      && last.origin_branch === claim.branch_scope
      && last.primary_evidence_id === evidence.id;
    if (operation === 'publish' && active) {
      return { status: 'already_published', claim_id: claimId, project_id: projectId };
    }
    if (operation === 'revoke' && !active) {
      return { status: 'already_revoked', claim_id: claimId, project_id: projectId };
    }
    const occurredAt = now();
    if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) {
      throw new Error('invalid_publication_clock');
    }
    memory.recordEvidence({
      id: EVENT_PREFIX + randomUUID(), projectId, harness: 'codex', sessionId: null,
      sourceKind: 'operator_explicit', sourceRef: SOURCE,
      capturedAt: occurredAt, branch: claim.branch_scope,
      commitSha: null, path: null, blobOid: null,
      content: 'Operator ' + (operation === 'publish' ? 'published' : 'revoked')
        + ' project-wide visibility for existing claim ' + claimId + '.',
      authorityClass: 'user_direct',
      metadata: {
        event_type: operation === 'publish' ? PUBLISH : REVOKE,
        claim_id: claimId, origin_branch: claim.branch_scope,
        primary_evidence_id: evidence.id, value_hash: valueHash, scope: 'project',
      },
    });
    return {
      status: operation === 'publish' ? 'published' : 'revoked',
      claim_id: claimId, project_id: projectId, origin_branch: claim.branch_scope,
    };
  } finally {
    memory.close();
  }
}

// The original source branch still owns freshness and conflicts. Other
// branch-bound or inferred memories never enter this projection.
export function readPublishedProjectUserMemories({
  dbPath, projectId, currentBranch, query, maxItems = 10,
}) {
  if (![dbPath, projectId, currentBranch, query].every(nonEmpty)) {
    throw new Error('invalid_published_memory_read');
  }
  const approved = new Map(
    [...latestPublicationStates(dbPath, projectId)].filter(([, event]) => event.event_type === PUBLISH),
  );
  if (approved.size === 0) return [];

  const memory = new MemoryEngine({ dbPath, readOnly: true });
  try {
    const grouped = new Map();
    for (const [claimId, event] of approved) {
      let verified;
      try { verified = ensureProjectUserClaim(memory, { projectId, claimId }); }
      catch { continue; }
      const { claim, evidence, valueHash } = verified;
      if (claim.branch_scope === currentBranch || event.origin_branch !== claim.branch_scope
        || event.primary_evidence_id !== evidence.id || event.value_hash !== valueHash) continue;
      const ids = grouped.get(claim.branch_scope) ?? new Set();
      ids.add(claimId);
      grouped.set(claim.branch_scope, ids);
    }
    const found = [];
    for (const [branch, allowedIds] of grouped) {
      const result = memory.recall({ projectId, branch, query, mode: 'current', limit: 100 });
      const relied = evaluateReliance({
        items: result.items.filter((item) => !isSyntheticMemoryItem(item)),
        conflicts: result.conflicts,
        use: 'answer',
      });
      for (const item of relied.selected) {
        if (!allowedIds.has(item.claim.id)) continue;
        found.push({ ...publicItem(item), scope: 'project', origin_branch: branch });
      }
    }
    found.sort((a, b) => b.claim.created_at.localeCompare(a.claim.created_at)
      || a.claim.id.localeCompare(b.claim.id));
    return found.slice(0, maxItems);
  } finally {
    memory.close();
  }
}
