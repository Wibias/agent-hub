import { DatabaseSync } from 'node:sqlite';

import { assertAuthorityClass } from './authority.mjs';
import { validateMemoryCandidateJudgment } from './memory-candidate-judge.mjs';
import {
  memoryRelationClaimRef,
  validateMemoryCandidateRelation,
} from './memory-candidate-relation.mjs';
import {
  decodeFloat32Vector,
  encodeFloat32Vector,
  hashEmbeddingText,
} from './semantic-vectors.mjs';

export const REDACTED_SECRET = '[REDACTED_SECRET]';

const CLAIM_STATES = new Set([
  'candidate',
  'active',
  'superseded',
  'rejected',
  'stale',
  'conflicted',
  'expired',
]);

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi,
];

const QUERY_TOKEN = /[\p{L}\p{N}_-]+/gu;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'does', 'for', 'from',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'was',
  'what', 'which', 'with',
]);

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function redactString(value) {
  if (typeof value !== 'string') return { value, redacted: false };

  let text = value;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redacted = true;
      return REDACTED_SECRET;
    });
  }
  return { value: text, redacted };
}

export function inspectMemoryTextSensitivity(value) {
  const result = redactString(String(value ?? ''));
  return {
    containsSecret: result.redacted,
    redacted: result.value,
  };
}

function redactValue(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const result = redactValue(item);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value: next, redacted };
  }
  if (value && typeof value === 'object') {
    let redacted = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(?:api[_-]?key|access[_-]?token|secret|password)$/i.test(key)
        && typeof item === 'string'
        && item.length > 0
      ) {
        redacted = true;
        next[key] = REDACTED_SECRET;
        continue;
      }

      const result = redactValue(item);
      redacted ||= result.redacted;
      next[key] = result.value;
    }
    return { value: next, redacted };
  }
  return { value, redacted: false };
}

function parseMetadata(value) {
  if (!value) return {};
  return JSON.parse(value);
}

function normalizeEvidence(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    harness: row.harness,
    session_id: row.session_id,
    source_kind: row.source_kind,
    source_ref: row.source_ref,
    captured_at: row.captured_at,
    branch: row.branch,
    commit_sha: row.commit_sha,
    path: row.path,
    blob_oid: row.blob_oid,
    content_redacted: row.content_redacted,
    sensitivity: row.sensitivity,
    authority_class: row.authority_class,
    metadata: parseMetadata(row.metadata_json),
  };
}

function normalizeCandidateRelation(row) {
  if (!row) return null;
  return {
    candidate_id: row.candidate_id,
    relation: row.relation,
    related_claim_id: row.related_claim_id,
    evaluator_id: row.evaluator_id,
    policy_version: row.policy_version,
    evaluated_at: row.evaluated_at,
    result_json: row.result_json,
  };
}

function normalizeCandidate(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    branch: row.branch,
    source_evidence_id: row.source_evidence_id,
    proposed_type: row.proposed_type,
    proposed_value: row.proposed_value,
    source_authority: row.source_authority,
    status: row.status,
    decision_reason: row.decision_reason,
    created_at: row.created_at,
    evaluated_at: row.evaluated_at,
    related_claim_id: row.related_claim_id,
    relation: row.relation,
    policy_version: row.policy_version,
    evaluator_id: row.evaluator_id,
    evaluation_json: row.evaluation_json,
    fingerprint: row.fingerprint,
  };
}

function normalizeClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    kind: row.kind,
    subject: row.subject,
    predicate: row.predicate,
    value: row.value_text,
    state: row.state,
    branch_scope: row.branch_scope,
    created_from_evidence_id: row.created_from_evidence_id,
    created_at: row.created_at,
    valid_from: row.valid_from,
    valid_until: row.valid_until,
    superseded_by_claim_id: row.superseded_by_claim_id,
    rejected_by_evidence_id: row.rejected_by_evidence_id,
  };
}

function normalizeClaimEmbedding(row) {
  if (!row) return null;
  return {
    claim_id: row.claim_id,
    model_id: row.model_id,
    model_revision: row.model_revision,
    text_hash: row.text_hash,
    dimensions: row.dimensions,
    vector: decodeFloat32Vector(Buffer.from(row.vector_blob), row.dimensions),
    indexed_at: row.indexed_at,
  };
}

function embeddingDocumentFromRow(row) {
  const text = [
    'passage:',
    row.kind,
    row.subject,
    row.predicate,
    row.value_text,
    row.content_redacted,
  ]
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    claim_id: row.id,
    project_id: row.project_id,
    branch_scope: row.branch_scope,
    created_at: row.created_at,
    text,
    text_hash: hashEmbeddingText(text),
  };
}

function normalizeRecallRow(row, revisionSha) {
  return {
    claim: normalizeClaim(row),
    evidence: {
      id: row.evidence_id,
      project_id: row.project_id,
      harness: row.evidence_harness,
      session_id: row.evidence_session_id,
      source_kind: row.evidence_source_kind,
      source_ref: row.evidence_source_ref,
      captured_at: row.evidence_captured_at,
      branch: row.evidence_branch,
      commit_sha: row.evidence_commit_sha,
      path: row.evidence_path,
      blob_oid: row.evidence_blob_oid,
      content_redacted: row.evidence_content_redacted,
      sensitivity: row.evidence_sensitivity,
      authority_class: row.evidence_authority_class,
      metadata: parseMetadata(row.evidence_metadata_json),
    },
    freshness: (
      row.evidence_path !== null
      ? {
          status: (
            revisionSha === null
            || row.freshness_commit_sha === null
            || row.freshness_commit_sha !== revisionSha
          )
            ? 'unchecked'
            : (
                row.evidence_blob_oid !== null
                && row.freshness_blob_oid === row.evidence_blob_oid
                  ? 'fresh'
                  : 'stale'
              ),
          observed_blob_oid: row.evidence_blob_oid,
          current_blob_oid: row.freshness_blob_oid,
          current_commit_sha: row.freshness_commit_sha,
          checked_at: row.freshness_checked_at,
        }
      : null
    ),
    rank: Number(row.rank),
  };
}

function recallConflicts(db, {
  projectId,
  branch,
  mode,
  revisionSha,
  itemIds,
}) {
  let currentEligibleIds = null;
  if (mode === 'current') {
    currentEligibleIds = new Set(db.prepare(`
      SELECT c.id
      FROM claims c
      JOIN evidence e ON e.id = c.created_from_evidence_id
      LEFT JOIN repository_path_state rps
        ON rps.project_id = c.project_id
       AND rps.branch = c.branch_scope
       AND rps.path = e.path
      WHERE c.project_id = ?
        AND c.branch_scope = ?
        AND ${CLAIM_ELIGIBILITY_SQL}
    `).all(
      projectId,
      branch,
      mode,
      revisionSha,
      revisionSha,
    ).map((row) => row.id));
  }

  return db.prepare(`
    SELECT
      claim_a,
      claim_b,
      state,
      created_by_evidence_id,
      created_at,
      resolved_by_evidence_id,
      resolved_at
    FROM conflicts
    WHERE project_id = ?
    ORDER BY claim_a, claim_b
  `).all(projectId).filter(
    (conflict) => (
      (mode === 'historical' || (
        conflict.state === 'open'
        && currentEligibleIds.has(conflict.claim_a)
        && currentEligibleIds.has(conflict.claim_b)
      ))
      && (itemIds.has(conflict.claim_a) || itemIds.has(conflict.claim_b))
    ),
  );
}

function normalizeApproval(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    actor: row.actor,
    action: row.action,
    target: row.target,
    environment: row.environment,
    artifact: row.artifact,
    constraints: parseMetadata(row.constraints_json),
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    max_uses: row.max_uses,
    uses: row.uses,
    revoked_at: row.revoked_at,
    source_evidence_id: row.source_evidence_id,
  };
}

function normalizeTimestamp(value, name) {
  assertNonEmptyString(value, name);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${name} must be a valid timestamp`);
  }
  return new Date(milliseconds).toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function jsonEquivalent(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function constraintsMatch(required, actual) {
  return Object.entries(required).every(
    ([key, value]) => (
      Object.hasOwn(actual, key)
      && jsonEquivalent(value, actual[key])
    ),
  );
}

function normalizeLexicalToken(token) {
  let normalized = token.toLowerCase();
  if (normalized.length > 4 && normalized.endsWith('ies')) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (
    normalized.length > 4
    && normalized.endsWith('s')
    && !normalized.endsWith('ss')
  ) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function lexicalTerms(value) {
  const expanded = String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');

  const tokens = expanded.match(QUERY_TOKEN) ?? [];
  return [...new Set(
    tokens
      .map(normalizeLexicalToken)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
  )];
}

function buildFtsQuery(query) {
  return lexicalTerms(query)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' OR ');
}

function searchableText(claim, evidenceContent) {
  const raw = [
    claim.kind,
    claim.subject,
    claim.predicate,
    claim.value,
    evidenceContent,
  ].filter(Boolean).join(' ');

  return `${raw} ${lexicalTerms(raw).join(' ')}`;
}


function prepareEvidenceInput(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    throw new TypeError('evidence is required');
  }

  for (const [value, name] of [
    [evidence.id, 'evidence.id'],
    [evidence.projectId, 'evidence.projectId'],
    [evidence.sourceKind, 'evidence.sourceKind'],
    [evidence.capturedAt, 'evidence.capturedAt'],
    [evidence.authorityClass, 'evidence.authorityClass'],
  ]) {
    assertNonEmptyString(value, name);
  }
  assertAuthorityClass(evidence.authorityClass);

  const redactedContent = redactString(String(evidence.content ?? ''));
  const redactedSource = redactString(evidence.sourceRef);
  const redactedMetadata = redactValue(evidence.metadata ?? {});

  return {
    id: evidence.id,
    projectId: evidence.projectId,
    harness: evidence.harness ?? null,
    sessionId: evidence.sessionId ?? null,
    sourceKind: evidence.sourceKind,
    sourceRef: redactedSource.value ?? null,
    capturedAt: evidence.capturedAt,
    branch: evidence.branch ?? null,
    commitSha: evidence.commitSha ?? null,
    path: evidence.path ?? null,
    blobOid: evidence.blobOid ?? null,
    content: redactedContent.value,
    sensitivity: (
      redactedContent.redacted
      || redactedSource.redacted
      || redactedMetadata.redacted
    ) ? 'secret_redacted' : (evidence.sensitivity ?? 'normal'),
    authorityClass: evidence.authorityClass,
    metadataJson: JSON.stringify(redactedMetadata.value),
  };
}

function prepareClaimInput({ evidence, claim }) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('claim is required');
  }

  for (const [value, name] of [
    [claim.id, 'claim.id'],
    [claim.kind, 'claim.kind'],
    [claim.subject, 'claim.subject'],
    [claim.predicate, 'claim.predicate'],
    [claim.createdAt, 'claim.createdAt'],
  ]) {
    assertNonEmptyString(value, name);
  }

  const branchScope = claim.branchScope ?? evidence.branch;
  assertNonEmptyString(branchScope, 'claim.branchScope');

  const state = claim.state ?? 'active';
  if (!CLAIM_STATES.has(state)) {
    throw new Error(`unsupported claim state: ${state}`);
  }

  const redactedSubject = redactString(claim.subject);
  const redactedPredicate = redactString(claim.predicate);
  const redactedValue = redactString(String(claim.value ?? ''));

  return {
    id: claim.id,
    projectId: evidence.projectId ?? evidence.project_id,
    kind: claim.kind,
    subject: redactedSubject.value,
    predicate: redactedPredicate.value,
    value: redactedValue.value,
    valueRedacted: redactedValue.redacted,
    state,
    branchScope,
    createdFromEvidenceId: evidence.id,
    createdAt: claim.createdAt,
    validFrom: claim.validFrom ?? null,
    validUntil: claim.validUntil ?? null,
  };
}

function prepareLifecycle(claimId, lifecycle = {}) {
  const supersedes = [...new Set(lifecycle.supersedes ?? [])];
  const rejects = [...new Set(lifecycle.rejects ?? [])];
  const conflictsWith = [...new Set(lifecycle.conflictsWith ?? [])];

  if (
    supersedes.includes(claimId)
    || rejects.includes(claimId)
    || conflictsWith.includes(claimId)
  ) {
    throw new Error('a claim cannot transition itself');
  }

  return { supersedes, rejects, conflictsWith };
}

function insertEvidenceRow(db, evidence) {
  db.prepare(`
    INSERT INTO evidence (
      id, project_id, harness, session_id, source_kind, source_ref,
      captured_at, branch, commit_sha, path, blob_oid, content_redacted,
      sensitivity, authority_class, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidence.id,
    evidence.projectId,
    evidence.harness,
    evidence.sessionId,
    evidence.sourceKind,
    evidence.sourceRef,
    evidence.capturedAt,
    evidence.branch,
    evidence.commitSha,
    evidence.path,
    evidence.blobOid,
    evidence.content,
    evidence.sensitivity,
    evidence.authorityClass,
    evidence.metadataJson,
  );
}

function insertClaimAndLifecycle(db, {
  claim,
  evidenceContent,
  lifecycle,
  lifecycleEvidenceId = claim.createdFromEvidenceId,
  lifecycleCreatedAt = claim.createdAt,
}) {
  db.prepare(`
    INSERT INTO claims (
      id, project_id, kind, subject, predicate, value_text, state,
      branch_scope, created_from_evidence_id, created_at, valid_from,
      valid_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    claim.id,
    claim.projectId,
    claim.kind,
    claim.subject,
    claim.predicate,
    claim.value,
    claim.state,
    claim.branchScope,
    claim.createdFromEvidenceId,
    claim.createdAt,
    claim.validFrom,
    claim.validUntil,
  );

  for (const targetId of lifecycle.supersedes) {
    const target = db
      .prepare('SELECT project_id, state FROM claims WHERE id = ?')
      .get(targetId);
    if (!target) throw new Error(`cannot supersede unknown claim: ${targetId}`);
    if (target.project_id !== claim.projectId) {
      throw new Error('lifecycle transitions cannot cross project boundaries');
    }
    if (target.state !== 'active') {
      throw new Error(`cannot supersede claim ${targetId} in state ${target.state}`);
    }

    db.prepare(`
      UPDATE claims
      SET state = 'superseded', superseded_by_claim_id = ?
      WHERE id = ?
    `).run(claim.id, targetId);

    db.prepare(`
      INSERT INTO lifecycle_events (
        project_id, action, source_claim_id, target_claim_id, evidence_id, created_at
      ) VALUES (?, 'supersede', ?, ?, ?, ?)
    `).run(
      claim.projectId,
      claim.id,
      targetId,
      lifecycleEvidenceId,
      lifecycleCreatedAt,
    );

    db.prepare(`
      UPDATE conflicts
      SET state = 'resolved',
          resolved_by_evidence_id = ?,
          resolved_at = ?
      WHERE project_id = ?
        AND state = 'open'
        AND (claim_a = ? OR claim_b = ?)
    `).run(
      lifecycleEvidenceId,
      lifecycleCreatedAt,
      claim.projectId,
      targetId,
      targetId,
    );
  }

  for (const targetId of lifecycle.rejects) {
    const target = db
      .prepare('SELECT project_id, state FROM claims WHERE id = ?')
      .get(targetId);
    if (!target) throw new Error(`cannot reject unknown claim: ${targetId}`);
    if (target.project_id !== claim.projectId) {
      throw new Error('lifecycle transitions cannot cross project boundaries');
    }
    if (target.state !== 'active') {
      throw new Error(`cannot reject claim ${targetId} in state ${target.state}`);
    }

    db.prepare(`
      UPDATE claims
      SET state = 'rejected', rejected_by_evidence_id = ?
      WHERE id = ?
    `).run(claim.createdFromEvidenceId, targetId);

    db.prepare(`
      INSERT INTO lifecycle_events (
        project_id, action, source_claim_id, target_claim_id, evidence_id, created_at
      ) VALUES (?, 'reject', ?, ?, ?, ?)
    `).run(
      claim.projectId,
      claim.id,
      targetId,
      lifecycleEvidenceId,
      lifecycleCreatedAt,
    );

    db.prepare(`
      UPDATE conflicts
      SET state = 'resolved',
          resolved_by_evidence_id = ?,
          resolved_at = ?
      WHERE project_id = ?
        AND state = 'open'
        AND (claim_a = ? OR claim_b = ?)
    `).run(
      lifecycleEvidenceId,
      lifecycleCreatedAt,
      claim.projectId,
      targetId,
      targetId,
    );
  }

  if (lifecycle.conflictsWith.length > 0 && claim.state !== 'active') {
    throw new Error('only active claims can open conflicts');
  }

  for (const targetId of lifecycle.conflictsWith) {
    const target = db
      .prepare('SELECT project_id, branch_scope, state FROM claims WHERE id = ?')
      .get(targetId);
    if (!target) throw new Error(`cannot conflict with unknown claim: ${targetId}`);
    if (target.project_id !== claim.projectId) {
      throw new Error('conflict relations cannot cross project boundaries');
    }
    if (target.branch_scope !== claim.branchScope) {
      throw new Error('conflict relations cannot cross branch boundaries');
    }
    if (target.state !== 'active') {
      throw new Error(`cannot conflict with claim ${targetId} in state ${target.state}`);
    }

    const [claimA, claimB] = [claim.id, targetId].sort();
    db.prepare(`
      INSERT INTO conflicts (
        project_id, claim_a, claim_b, state, created_by_evidence_id, created_at
      ) VALUES (?, ?, ?, 'open', ?, ?)
      ON CONFLICT(project_id, claim_a, claim_b) DO NOTHING
    `).run(
      claim.projectId,
      claimA,
      claimB,
      lifecycleEvidenceId,
      lifecycleCreatedAt,
    );
  }

  db.prepare(`
    INSERT INTO claim_fts (claim_id, project_id, branch_scope, text)
    VALUES (?, ?, ?, ?)
  `).run(
    claim.id,
    claim.projectId,
    claim.branchScope,
    searchableText(claim, evidenceContent),
  );
}

const CLAIM_ELIGIBILITY_SQL = `
  (
    ? = 'historical'
    OR (
      c.state = 'active'
      AND (
        e.path IS NULL
        OR (
          ? IS NOT NULL
          AND e.blob_oid IS NOT NULL
          AND rps.commit_sha = ?
          AND rps.blob_oid = e.blob_oid
        )
      )
    )
  )
`;

const RELIANCE_ALLOWED = {
  planning: new Set([
    'user_direct',
    'repo_trusted',
    'tool_observation',
    'agent_inference',
    'external_untrusted',
    'unclassified',
  ]),
  answer: new Set([
    'user_direct',
    'repo_trusted',
    'tool_observation',
  ]),
  project_policy: new Set([
    'user_direct',
    'repo_trusted',
  ]),
  external_action: new Set(),
  destructive_action: new Set(),
};

export function evaluateReliance({
  items,
  conflicts = [],
  use,
}) {
  const allowedClasses = RELIANCE_ALLOWED[use];
  if (!allowedClasses) throw new Error(`unsupported reliance use: ${use}`);

  const selected = [];
  const blocked = [];
  const selectedIds = new Set();
  const authorityAllowedIds = new Set();
  const byId = new Map();

  for (const item of items ?? []) {
    const claimId = item?.claim?.id;
    if (!claimId) continue;
    byId.set(claimId, item);

    const authority = item.evidence?.authority_class ?? 'unclassified';
    if (allowedClasses.has(authority)) {
      selected.push(item);
      selectedIds.add(claimId);
      authorityAllowedIds.add(claimId);
    } else {
      blocked.push({
        item,
        reason: `authority_not_allowed_for_${use}`,
      });
    }
  }

  const conflictResolutions = [];
  for (const conflict of conflicts ?? []) {
    const a = byId.get(conflict.claim_a);
    const b = byId.get(conflict.claim_b);
    if (!a && !b) continue;

    if (!a || !b) {
      const present = a ?? b;
      const presentId = present.claim.id;
      if (selectedIds.delete(presentId)) {
        blocked.push({
          item: present,
          reason: 'unresolved_conflict_counterpart_not_retrieved',
        });
      }
      conflictResolutions.push({
        ...conflict,
        status: 'unresolved_missing_counterpart',
        winner_claim_id: null,
      });
      continue;
    }

    const aAllowed = authorityAllowedIds.has(conflict.claim_a);
    const bAllowed = authorityAllowedIds.has(conflict.claim_b);

    if (aAllowed !== bAllowed) {
      conflictResolutions.push({
        ...conflict,
        status: 'resolved_by_authority',
        winner_claim_id: aAllowed ? conflict.claim_a : conflict.claim_b,
      });
      continue;
    }

    if (aAllowed && bAllowed) {
      selectedIds.delete(conflict.claim_a);
      selectedIds.delete(conflict.claim_b);
      blocked.push(
        { item: a, reason: 'unresolved_conflict' },
        { item: b, reason: 'unresolved_conflict' },
      );
      conflictResolutions.push({
        ...conflict,
        status: 'unresolved',
        winner_claim_id: null,
      });
      continue;
    }

    conflictResolutions.push({
      ...conflict,
      status: 'blocked_by_authority',
      winner_claim_id: null,
    });
  }

  return {
    use,
    selected: selected.filter((item) => selectedIds.has(item.claim.id)),
    blocked,
    conflict_resolutions: conflictResolutions,
  };
}


function resolveCandidatePromotion(db, {
  candidateId,
  claimId,
  policyVersion,
  finalizedAt,
}) {
  assertNonEmptyString(candidateId, 'candidateId');
  assertNonEmptyString(claimId, 'claimId');
  assertNonEmptyString(policyVersion, 'policyVersion');
  assertNonEmptyString(finalizedAt, 'finalizedAt');

  const candidate = normalizeCandidate(
    db.prepare('SELECT * FROM memory_candidates WHERE id = ?').get(candidateId),
  );
  if (!candidate) throw new Error('unknown memory candidate: ' + candidateId);
  if (candidate.status !== 'pending') {
    throw new Error('memory candidate is not pending');
  }
  if (candidate.evaluated_at === null || !candidate.evaluation_json) {
    throw new Error('memory candidate has no importance evaluation');
  }
  if (candidate.relation === null) {
    throw new Error('memory candidate has no relation evaluation');
  }

  let importance;
  try {
    importance = validateMemoryCandidateJudgment(
      JSON.parse(candidate.evaluation_json),
    );
  } catch {
    throw new Error('memory candidate importance evaluation is invalid');
  }
  if (importance.decision !== 'promote') {
    throw new Error('memory candidate promotion requires promote importance judgment');
  }

  const relationAudit = normalizeCandidateRelation(
    db.prepare(
      'SELECT * FROM memory_candidate_relations WHERE candidate_id = ?',
    ).get(candidateId),
  );
  if (!relationAudit) {
    throw new Error('memory candidate relation audit is missing');
  }

  let relation;
  try {
    relation = validateMemoryCandidateRelation(
      JSON.parse(relationAudit.result_json),
    );
  } catch {
    throw new Error('memory candidate relation evaluation is invalid');
  }
  if (relation.relation !== candidate.relation) {
    throw new Error('memory candidate relation invariant failed');
  }
  if (relationAudit.related_claim_id !== candidate.related_claim_id) {
    throw new Error('memory candidate relation target invariant failed');
  }

  const evidence = normalizeEvidence(
    db.prepare('SELECT * FROM evidence WHERE id = ?')
      .get(candidate.source_evidence_id),
  );
  if (!evidence) throw new Error('candidate source evidence is missing');
  if (
    candidate.source_authority !== 'user_direct'
    || evidence.authority_class !== 'user_direct'
  ) {
    throw new Error('candidate promotion requires user_direct authority');
  }
  if (evidence.sensitivity === 'secret_redacted') {
    throw new Error('secret-redacted evidence cannot be promoted');
  }
  if (
    evidence.project_id !== candidate.project_id
    || evidence.branch !== candidate.branch
    || evidence.content_redacted !== candidate.proposed_value
  ) {
    throw new Error('candidate source evidence invariant failed');
  }

  let target = null;
  if (relation.relation === 'unrelated') {
    if (
      candidate.related_claim_id !== null
      || relationAudit.related_claim_id !== null
      || relation.target_ref !== null
    ) {
      throw new Error('unrelated promotion cannot target a claim');
    }
  } else {
    if (!candidate.related_claim_id) {
      throw new Error('related promotion requires a target claim');
    }
    target = normalizeClaim(
      db.prepare('SELECT * FROM claims WHERE id = ?')
        .get(candidate.related_claim_id),
    );
    if (!target) throw new Error('promotion relation target no longer exists');
    if (
      target.project_id !== candidate.project_id
      || target.branch_scope !== candidate.branch
      || target.state !== 'active'
      || target.kind !== 'user_direct'
      || target.subject !== 'user memory'
      || target.predicate !== 'states'
    ) {
      throw new Error(
        'promotion relation target must remain an active durable user memory in candidate scope',
      );
    }
    const targetEvidence = normalizeEvidence(
      db.prepare('SELECT * FROM evidence WHERE id = ?')
        .get(target.created_from_evidence_id),
    );
    if (
      !targetEvidence
      || targetEvidence.authority_class !== 'user_direct'
      || targetEvidence.project_id !== candidate.project_id
    ) {
      throw new Error('promotion relation target authority invariant failed');
    }
    if (relation.target_ref !== memoryRelationClaimRef(target.id)) {
      throw new Error('promotion relation opaque target ref invariant failed');
    }
  }

  if (
    relation.confidence !== 'high'
    || relation.meaning_preserved !== true
  ) {
    return {
      candidate,
      evidence,
      relation,
      status: 'needs_confirmation',
      claim: null,
      lifecycle: null,
      claim_id: null,
      related_claim_id: target?.id ?? null,
      policy_version: policyVersion,
      finalized_at: finalizedAt,
    };
  }

  if (relation.relation === 'same') {
    return {
      candidate,
      evidence,
      relation,
      status: 'superseded',
      claim: null,
      lifecycle: null,
      claim_id: null,
      related_claim_id: target.id,
      policy_version: policyVersion,
      finalized_at: finalizedAt,
    };
  }

  const sensitivity = inspectMemoryTextSensitivity(importance.canonical_fact);
  if (sensitivity.containsSecret) {
    return {
      candidate,
      evidence,
      relation,
      status: 'needs_confirmation',
      claim: null,
      lifecycle: null,
      claim_id: null,
      related_claim_id: target?.id ?? null,
      policy_version: policyVersion,
      finalized_at: finalizedAt,
    };
  }

  const claim = prepareClaimInput({
    evidence,
    claim: {
      id: claimId,
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value: importance.canonical_fact,
      state: 'active',
      branchScope: candidate.branch,
      createdAt: finalizedAt,
    },
  });

  const lifecycle = prepareLifecycle(claim.id, {
    supersedes: relation.relation === 'update' ? [target.id] : [],
    conflictsWith: relation.relation === 'contradict' ? [target.id] : [],
  });

  return {
    candidate,
    evidence,
    relation,
    status: 'promoted',
    claim,
    lifecycle,
    claim_id: claim.id,
    related_claim_id: target?.id ?? null,
    policy_version: policyVersion,
    finalized_at: finalizedAt,
  };
}

export class MemoryEngine {
  #db;
  #clock;

  constructor({
    dbPath,
    clock = () => new Date().toISOString(),
  }) {
    assertNonEmptyString(dbPath, 'dbPath');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');

    this.#clock = clock;
    this.#db = new DatabaseSync(dbPath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });

    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS project_registry (
        project_id TEXT PRIMARY KEY,
        canonical_remote TEXT,
        repo_identity TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        harness TEXT,
        session_id TEXT,
        source_kind TEXT NOT NULL,
        source_ref TEXT,
        captured_at TEXT NOT NULL,
        branch TEXT,
        commit_sha TEXT,
        path TEXT,
        blob_oid TEXT,
        content_redacted TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        authority_class TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        value_text TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('candidate','active','superseded','rejected','stale','conflicted','expired')
        ),
        branch_scope TEXT NOT NULL,
        created_from_evidence_id TEXT NOT NULL REFERENCES evidence(id),
        created_at TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        superseded_by_claim_id TEXT REFERENCES claims(id),
        rejected_by_evidence_id TEXT REFERENCES evidence(id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        branch TEXT NOT NULL,
        source_evidence_id TEXT NOT NULL REFERENCES evidence(id),
        proposed_type TEXT NOT NULL CHECK (
          proposed_type IN (
            'decision',
            'preference',
            'constraint',
            'correction',
            'rejected_approach',
            'known_issue'
          )
        ),
        proposed_value TEXT NOT NULL,
        source_authority TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            'pending',
            'ignored',
            'promoted',
            'needs_confirmation',
            'superseded',
            'failed'
          )
        ),
        decision_reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        evaluated_at TEXT,
        related_claim_id TEXT REFERENCES claims(id),
        relation TEXT,
        policy_version TEXT NOT NULL,
        evaluator_id TEXT,
        evaluation_json TEXT,
        fingerprint TEXT NOT NULL,
        UNIQUE (project_id, branch, fingerprint)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS memory_candidates_scope_status
      ON memory_candidates (project_id, branch, status, created_at DESC);


      CREATE TABLE IF NOT EXISTS memory_candidate_relations (
        candidate_id TEXT PRIMARY KEY REFERENCES memory_candidates(id),
        relation TEXT NOT NULL CHECK (
          relation IN ('same','update','contradict','unrelated')
        ),
        related_claim_id TEXT REFERENCES claims(id),
        evaluator_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS memory_candidate_relations_claim
      ON memory_candidate_relations (related_claim_id);

      CREATE TABLE IF NOT EXISTS memory_candidate_promotions (
        candidate_id TEXT PRIMARY KEY REFERENCES memory_candidates(id),
        status TEXT NOT NULL CHECK (
          status IN ('promoted','superseded','needs_confirmation')
        ),
        relation TEXT NOT NULL CHECK (
          relation IN ('same','update','contradict','unrelated')
        ),
        claim_id TEXT REFERENCES claims(id),
        related_claim_id TEXT REFERENCES claims(id),
        policy_version TEXT NOT NULL,
        finalized_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS memory_candidate_promotions_claim
      ON memory_candidate_promotions (claim_id);

      CREATE TABLE IF NOT EXISTS memory_candidate_confirmations (
        candidate_id TEXT PRIMARY KEY REFERENCES memory_candidates(id),
        confirmation_evidence_id TEXT NOT NULL REFERENCES evidence(id),
        relation TEXT NOT NULL CHECK (
          relation IN ('same','update','contradict','unrelated')
        ),
        related_claim_id TEXT REFERENCES claims(id),
        claim_id TEXT REFERENCES claims(id),
        status TEXT NOT NULL CHECK (
          status IN ('promoted','superseded')
        ),
        policy_version TEXT NOT NULL,
        confirmed_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS memory_candidate_confirmations_claim
      ON memory_candidate_confirmations (claim_id);

      CREATE TABLE IF NOT EXISTS lifecycle_events (
        id INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        action TEXT NOT NULL CHECK (action IN ('supersede','reject')),
        source_claim_id TEXT NOT NULL REFERENCES claims(id),
        target_claim_id TEXT NOT NULL REFERENCES claims(id),
        evidence_id TEXT NOT NULL REFERENCES evidence(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS conflicts (
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        claim_a TEXT NOT NULL REFERENCES claims(id),
        claim_b TEXT NOT NULL REFERENCES claims(id),
        state TEXT NOT NULL CHECK (state IN ('open','resolved')),
        created_by_evidence_id TEXT NOT NULL REFERENCES evidence(id),
        created_at TEXT NOT NULL,
        resolved_by_evidence_id TEXT REFERENCES evidence(id),
        resolved_at TEXT,
        PRIMARY KEY (project_id, claim_a, claim_b),
        CHECK (claim_a < claim_b),
        CHECK (
          (state = 'open' AND resolved_by_evidence_id IS NULL AND resolved_at IS NULL)
          OR
          (state = 'resolved' AND resolved_by_evidence_id IS NOT NULL AND resolved_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        environment TEXT NOT NULL,
        artifact TEXT,
        constraints_json TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        max_uses INTEGER NOT NULL CHECK (max_uses >= 1),
        uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
        revoked_at TEXT,
        source_evidence_id TEXT NOT NULL REFERENCES evidence(id),
        CHECK (expires_at >= issued_at)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS repository_path_state (
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        branch TEXT NOT NULL,
        path TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        blob_oid TEXT,
        checked_at TEXT,
        PRIMARY KEY (project_id, branch, path)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS claim_embeddings (
        claim_id TEXT NOT NULL REFERENCES claims(id),
        model_id TEXT NOT NULL,
        model_revision TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
        vector_blob BLOB NOT NULL,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY (claim_id, model_id, model_revision)
      ) STRICT;

      CREATE VIRTUAL TABLE IF NOT EXISTS claim_fts USING fts5(
        claim_id UNINDEXED,
        project_id UNINDEXED,
        branch_scope UNINDEXED,
        text,
        tokenize = 'unicode61'
      );
    `);
  }

  close() {
    this.#db.close();
  }

  checkpoint() {
    return this.#db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
  }

  journalMode() {
    return this.#db.prepare('PRAGMA journal_mode').get().journal_mode;
  }

  registerProject({
    projectId,
    canonicalRemote = null,
    repoIdentity = null,
    createdAt = new Date().toISOString(),
  }) {
    assertNonEmptyString(projectId, 'projectId');

    const existing = this.#db
      .prepare('SELECT project_id, canonical_remote, repo_identity FROM project_registry WHERE project_id = ?')
      .get(projectId);

    if (existing) {
      if (
        canonicalRemote !== null
        && existing.canonical_remote !== null
        && existing.canonical_remote !== canonicalRemote
      ) {
        throw new Error(`project ${projectId} is already bound to another canonical remote`);
      }
      if (
        repoIdentity !== null
        && existing.repo_identity !== null
        && existing.repo_identity !== repoIdentity
      ) {
        throw new Error(`project ${projectId} is already bound to another repository identity`);
      }

      this.#db.prepare(`
        UPDATE project_registry
        SET canonical_remote = COALESCE(canonical_remote, ?),
            repo_identity = COALESCE(repo_identity, ?)
        WHERE project_id = ?
      `).run(canonicalRemote, repoIdentity, projectId);
      return this.getProject(projectId);
    }

    this.#db.prepare(`
      INSERT INTO project_registry (
        project_id, canonical_remote, repo_identity, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(projectId, canonicalRemote, repoIdentity, createdAt);

    return this.getProject(projectId);
  }

  getProject(projectId) {
    const row = this.#db
      .prepare('SELECT project_id, canonical_remote, repo_identity FROM project_registry WHERE project_id = ?')
      .get(projectId);
    if (!row) return null;
    return {
      project_id: row.project_id,
      canonical_remote: row.canonical_remote,
      repo_identity: row.repo_identity,
    };
  }

  getEvidence(id) {
    return normalizeEvidence(
      this.#db.prepare('SELECT * FROM evidence WHERE id = ?').get(id),
    );
  }

  getClaim(id) {
    return normalizeClaim(
      this.#db.prepare('SELECT * FROM claims WHERE id = ?').get(id),
    );
  }

  embeddingDocument({ claimId }) {
    assertNonEmptyString(claimId, 'claimId');

    const row = this.#db.prepare(`
      SELECT
        c.id,
        c.project_id,
        c.branch_scope,
        c.created_at,
        c.kind,
        c.subject,
        c.predicate,
        c.value_text,
        e.content_redacted
      FROM claims c
      JOIN evidence e ON e.id = c.created_from_evidence_id
      WHERE c.id = ?
    `).get(claimId);

    return row ? embeddingDocumentFromRow(row) : null;
  }

  listEmbeddingDocuments({ projectId, branch }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    return this.#db.prepare(`
      SELECT
        c.id,
        c.project_id,
        c.branch_scope,
        c.created_at,
        c.kind,
        c.subject,
        c.predicate,
        c.value_text,
        e.content_redacted
      FROM claims c
      JOIN evidence e ON e.id = c.created_from_evidence_id
      WHERE c.project_id = ?
        AND c.branch_scope = ?
      ORDER BY c.id ASC
    `).all(projectId, branch).map(embeddingDocumentFromRow);
  }

  semanticCandidates({
    projectId,
    branch,
    revisionSha = null,
    mode = 'current',
    modelId,
    modelRevision,
  }) {
    for (const [value, name] of [
      [projectId, 'projectId'],
      [branch, 'branch'],
      [modelId, 'modelId'],
      [modelRevision, 'modelRevision'],
    ]) {
      assertNonEmptyString(value, name);
    }
    if (revisionSha !== null) assertNonEmptyString(revisionSha, 'revisionSha');
    if (!['current', 'historical'].includes(mode)) {
      throw new Error(`unsupported recall mode: ${mode}`);
    }
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    const rows = this.#db.prepare(`
      SELECT
        c.id,
        c.project_id,
        c.branch_scope,
        c.kind,
        c.subject,
        c.predicate,
        c.value_text,
        c.created_at,
        e.content_redacted,
        ce.text_hash,
        ce.dimensions,
        ce.vector_blob
      FROM claim_embeddings ce
      JOIN claims c ON c.id = ce.claim_id
      JOIN evidence e ON e.id = c.created_from_evidence_id
      LEFT JOIN repository_path_state rps
        ON rps.project_id = c.project_id
       AND rps.branch = c.branch_scope
       AND rps.path = e.path
      WHERE ce.model_id = ?
        AND ce.model_revision = ?
        AND c.project_id = ?
        AND c.branch_scope = ?
        AND ${CLAIM_ELIGIBILITY_SQL}
      ORDER BY c.created_at DESC, c.id ASC
    `).all(
      modelId,
      modelRevision,
      projectId,
      branch,
      mode,
      revisionSha,
      revisionSha,
    );

    const candidates = [];
    for (const row of rows) {
      try {
        const document = embeddingDocumentFromRow(row);
        if (row.text_hash !== document.text_hash) continue;

        candidates.push({
          claim_id: row.id,
          created_at: row.created_at,
          text_hash: row.text_hash,
          dimensions: row.dimensions,
          vector: decodeFloat32Vector(Buffer.from(row.vector_blob), row.dimensions),
        });
      } catch {
        // Semantic vectors are derived state. Corrupt or stale rows fail closed
        // locally without making canonical or lexical memory unavailable.
      }
    }
    return candidates;
  }

  materializeRecall({
    projectId,
    branch,
    revisionSha = null,
    mode = 'current',
    claimIds,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    if (revisionSha !== null) assertNonEmptyString(revisionSha, 'revisionSha');
    if (!['current', 'historical'].includes(mode)) {
      throw new Error(`unsupported recall mode: ${mode}`);
    }
    if (!Array.isArray(claimIds)) {
      throw new TypeError('claimIds must be an array');
    }
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    const select = this.#db.prepare(`
      SELECT
        c.*,
        e.id AS evidence_id,
        e.harness AS evidence_harness,
        e.session_id AS evidence_session_id,
        e.source_kind AS evidence_source_kind,
        e.source_ref AS evidence_source_ref,
        e.captured_at AS evidence_captured_at,
        e.branch AS evidence_branch,
        e.commit_sha AS evidence_commit_sha,
        e.path AS evidence_path,
        e.blob_oid AS evidence_blob_oid,
        e.content_redacted AS evidence_content_redacted,
        e.sensitivity AS evidence_sensitivity,
        e.authority_class AS evidence_authority_class,
        e.metadata_json AS evidence_metadata_json,
        rps.commit_sha AS freshness_commit_sha,
        rps.blob_oid AS freshness_blob_oid,
        rps.checked_at AS freshness_checked_at,
        0.0 AS rank
      FROM claims c
      JOIN evidence e ON e.id = c.created_from_evidence_id
      LEFT JOIN repository_path_state rps
        ON rps.project_id = c.project_id
       AND rps.branch = c.branch_scope
       AND rps.path = e.path
      WHERE c.id = ?
        AND c.project_id = ?
        AND c.branch_scope = ?
        AND ${CLAIM_ELIGIBILITY_SQL}
    `);

    const items = [];
    const seen = new Set();
    for (const claimId of claimIds) {
      assertNonEmptyString(claimId, 'claimIds item');
      if (seen.has(claimId)) continue;
      seen.add(claimId);
      const row = select.get(
        claimId,
        projectId,
        branch,
        mode,
        revisionSha,
        revisionSha,
      );
      if (row) items.push(normalizeRecallRow(row, revisionSha));
    }

    const ids = new Set(items.map((item) => item.claim.id));
    return {
      project_id: projectId,
      branch,
      mode,
      items,
      conflicts: recallConflicts(this.#db, {
        projectId,
        branch,
        mode,
        revisionSha,
        itemIds: ids,
      }),
    };
  }

  putClaimEmbedding({
    claimId,
    modelId,
    modelRevision,
    textHash,
    dimensions,
    vector,
    indexedAt = this.#clock(),
  }) {
    for (const [value, name] of [
      [claimId, 'claimId'],
      [modelId, 'modelId'],
      [modelRevision, 'modelRevision'],
      [indexedAt, 'indexedAt'],
    ]) {
      assertNonEmptyString(value, name);
    }
    if (!/^[0-9a-f]{64}$/.test(textHash)) {
      throw new TypeError('text hash must be lowercase SHA-256 hex');
    }
    if (!Number.isInteger(dimensions) || dimensions < 1) {
      throw new RangeError('dimensions must be a positive integer');
    }
    if (!(vector instanceof Float32Array) || vector.length !== dimensions) {
      throw new RangeError('vector dimensions must match dimensions');
    }
    if (!this.getClaim(claimId)) throw new Error(`unknown claim: ${claimId}`);

    const vectorBlob = encodeFloat32Vector(vector);
    this.#db.prepare(`
      INSERT INTO claim_embeddings (
        claim_id, model_id, model_revision, text_hash,
        dimensions, vector_blob, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(claim_id, model_id, model_revision) DO UPDATE SET
        text_hash = excluded.text_hash,
        dimensions = excluded.dimensions,
        vector_blob = excluded.vector_blob,
        indexed_at = excluded.indexed_at
    `).run(
      claimId,
      modelId,
      modelRevision,
      textHash,
      dimensions,
      vectorBlob,
      indexedAt,
    );

    return this.getClaimEmbedding({ claimId, modelId, modelRevision });
  }

  getClaimEmbedding({ claimId, modelId, modelRevision }) {
    for (const [value, name] of [
      [claimId, 'claimId'],
      [modelId, 'modelId'],
      [modelRevision, 'modelRevision'],
    ]) {
      assertNonEmptyString(value, name);
    }
    return normalizeClaimEmbedding(this.#db.prepare(`
      SELECT
        claim_id, model_id, model_revision, text_hash,
        dimensions, vector_blob, indexed_at
      FROM claim_embeddings
      WHERE claim_id = ? AND model_id = ? AND model_revision = ?
    `).get(claimId, modelId, modelRevision));
  }

  deleteClaimEmbeddings({ modelId = null, modelRevision = null } = {}) {
    if (modelId !== null) assertNonEmptyString(modelId, 'modelId');
    if (modelRevision !== null) assertNonEmptyString(modelRevision, 'modelRevision');

    if (modelId !== null && modelRevision !== null) {
      return Number(this.#db.prepare(`
        DELETE FROM claim_embeddings
        WHERE model_id = ? AND model_revision = ?
      `).run(modelId, modelRevision).changes);
    }
    if (modelId !== null) {
      return Number(this.#db.prepare(
        'DELETE FROM claim_embeddings WHERE model_id = ?',
      ).run(modelId).changes);
    }
    if (modelRevision !== null) {
      return Number(this.#db.prepare(
        'DELETE FROM claim_embeddings WHERE model_revision = ?',
      ).run(modelRevision).changes);
    }
    return Number(this.#db.prepare('DELETE FROM claim_embeddings').run().changes);
  }

  replaceClaimEmbeddings({
    projectId,
    branch,
    modelId,
    modelRevision,
    rows,
    indexedAt = this.#clock(),
  }) {
    for (const [value, name] of [
      [projectId, 'projectId'],
      [branch, 'branch'],
      [modelId, 'modelId'],
      [modelRevision, 'modelRevision'],
      [indexedAt, 'indexedAt'],
    ]) {
      assertNonEmptyString(value, name);
    }
    if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    const prepared = [];
    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        throw new TypeError('embedding row must be an object');
      }
      assertNonEmptyString(row.claimId, 'embedding row claimId');
      if (seen.has(row.claimId)) {
        throw new Error(`duplicate embedding row claim: ${row.claimId}`);
      }
      seen.add(row.claimId);
      if (!/^[0-9a-f]{64}$/.test(row.textHash ?? '')) {
        throw new TypeError('embedding row text hash must be lowercase SHA-256 hex');
      }
      if (!Number.isInteger(row.dimensions) || row.dimensions < 1) {
        throw new RangeError('embedding row dimensions must be a positive integer');
      }
      if (!(row.vector instanceof Float32Array) || row.vector.length !== row.dimensions) {
        throw new RangeError('embedding row vector dimensions must match dimensions');
      }
      prepared.push({
        ...row,
        vectorBlob: encodeFloat32Vector(row.vector),
      });
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const claimScope = this.#db.prepare(`
        SELECT project_id, branch_scope
        FROM claims
        WHERE id = ?
      `);
      for (const row of prepared) {
        const claim = claimScope.get(row.claimId);
        if (!claim) throw new Error(`unknown claim: ${row.claimId}`);
        if (claim.project_id !== projectId || claim.branch_scope !== branch) {
          throw new Error(`embedding row claim is outside requested project/branch: ${row.claimId}`);
        }
      }

      this.#db.prepare(`
        DELETE FROM claim_embeddings
        WHERE model_id = ?
          AND model_revision = ?
          AND claim_id IN (
            SELECT id
            FROM claims
            WHERE project_id = ?
              AND branch_scope = ?
          )
      `).run(modelId, modelRevision, projectId, branch);

      const insert = this.#db.prepare(`
        INSERT INTO claim_embeddings (
          claim_id, model_id, model_revision, text_hash,
          dimensions, vector_blob, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of prepared) {
        insert.run(
          row.claimId,
          modelId,
          modelRevision,
          row.textHash,
          row.dimensions,
          row.vectorBlob,
          indexedAt,
        );
      }

      this.#db.exec('COMMIT');
      return prepared.length;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }


  getApproval(id) {
    return normalizeApproval(
      this.#db.prepare('SELECT * FROM approvals WHERE id = ?').get(id),
    );
  }

  listApprovals({ projectId }) {
    assertNonEmptyString(projectId, 'projectId');
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    return this.#db.prepare(`
      SELECT *
      FROM approvals
      WHERE project_id = ?
      ORDER BY issued_at DESC, id ASC
    `).all(projectId).map(normalizeApproval);
  }

  exportCanonical() {
    this.#db.exec('BEGIN');
    try {
      const payload = {
        format: 'agent-hub-memory-canonical',
        version: 1,
        projects: this.#db.prepare(`
          SELECT project_id, canonical_remote, repo_identity, created_at
          FROM project_registry
          ORDER BY project_id
        `).all(),
        evidence: this.#db.prepare(`
          SELECT
            id, project_id, harness, session_id, source_kind, source_ref,
            captured_at, branch, commit_sha, path, blob_oid, content_redacted,
            sensitivity, authority_class, metadata_json
          FROM evidence
          ORDER BY id
        `).all(),
        claims: this.#db.prepare(`
          SELECT
            id, project_id, kind, subject, predicate, value_text, state,
            branch_scope, created_from_evidence_id, created_at, valid_from,
            valid_until, superseded_by_claim_id, rejected_by_evidence_id
          FROM claims
          ORDER BY id
        `).all(),
        lifecycle_events: this.#db.prepare(`
          SELECT
            id, project_id, action, source_claim_id, target_claim_id,
            evidence_id, created_at
          FROM lifecycle_events
          ORDER BY id
        `).all(),
        conflicts: this.#db.prepare(`
          SELECT
            project_id, claim_a, claim_b, state, created_by_evidence_id,
            created_at, resolved_by_evidence_id, resolved_at
          FROM conflicts
          ORDER BY project_id, claim_a, claim_b
        `).all(),
        approvals: this.#db.prepare(`
          SELECT
            id, project_id, actor, action, target, environment, artifact,
            constraints_json, issued_at, expires_at, max_uses, uses,
            revoked_at, source_evidence_id
          FROM approvals
          ORDER BY id
        `).all(),
      };
      this.#db.exec('COMMIT');
      return payload;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  clearDerivedState() {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare('DELETE FROM claim_fts').run();
      this.#db.prepare('DELETE FROM claim_embeddings').run();
      this.#db.prepare('DELETE FROM repository_path_state').run();
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  rebuildDerivedState() {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare('DELETE FROM claim_fts').run();
      this.#db.prepare('DELETE FROM claim_embeddings').run();
      const rows = this.#db.prepare(`
        SELECT
          c.id,
          c.project_id,
          c.branch_scope,
          c.kind,
          c.subject,
          c.predicate,
          c.value_text,
          e.content_redacted
        FROM claims c
        JOIN evidence e ON e.id = c.created_from_evidence_id
        ORDER BY c.id
      `).all();

      const insert = this.#db.prepare(`
        INSERT INTO claim_fts (claim_id, project_id, branch_scope, text)
        VALUES (?, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(
          row.id,
          row.project_id,
          row.branch_scope,
          searchableText({
            kind: row.kind,
            subject: row.subject,
            predicate: row.predicate,
            value: row.value_text,
          }, row.content_redacted),
        );
      }

      this.#db.prepare('DELETE FROM repository_path_state').run();
      this.#db.exec('COMMIT');
      return {
        indexed_claims: rows.length,
        repository_path_snapshots: 0,
      };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  importCanonical(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('canonical import payload must be an object');
    }
    if (payload.format !== 'agent-hub-memory-canonical' || payload.version !== 1) {
      throw new Error('unsupported canonical memory export');
    }

    for (const field of [
      'projects',
      'evidence',
      'claims',
      'lifecycle_events',
      'conflicts',
      'approvals',
    ]) {
      if (!Array.isArray(payload[field])) {
        throw new TypeError(`canonical import ${field} must be an array`);
      }
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const occupied = this.#db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM evidence)
          + (SELECT COUNT(*) FROM claims)
          + (SELECT COUNT(*) FROM lifecycle_events)
          + (SELECT COUNT(*) FROM conflicts)
          + (SELECT COUNT(*) FROM approvals) AS count
      `).get().count;
    if (occupied !== 0) {
      throw new Error('canonical import requires an empty memory store');
    }

    const projectIds = new Set(payload.projects.map((row) => row.project_id));
    const evidenceById = new Map(payload.evidence.map((row) => [row.id, row]));
    const claimById = new Map(payload.claims.map((row) => [row.id, row]));

    for (const row of payload.evidence) {
      if (!projectIds.has(row.project_id)) {
        throw new Error(`canonical import evidence references unknown project: ${row.id}`);
      }
    }

    for (const row of payload.claims) {
      const sourceEvidence = evidenceById.get(row.created_from_evidence_id);
      if (!sourceEvidence) {
        throw new Error(`canonical import claim references unknown evidence: ${row.id}`);
      }
      if (sourceEvidence.project_id !== row.project_id) {
        throw new Error(`canonical import claim evidence crosses project boundary: ${row.id}`);
      }

      if (row.superseded_by_claim_id !== null) {
        const successor = claimById.get(row.superseded_by_claim_id);
        if (!successor) {
          throw new Error(`canonical import claim references unknown successor: ${row.id}`);
        }
        if (successor.project_id !== row.project_id) {
          throw new Error(`canonical import supersession crosses project boundary: ${row.id}`);
        }
      }

      if (row.rejected_by_evidence_id !== null) {
        const rejection = evidenceById.get(row.rejected_by_evidence_id);
        if (!rejection) {
          throw new Error(`canonical import claim references unknown rejection evidence: ${row.id}`);
        }
        if (rejection.project_id !== row.project_id) {
          throw new Error(`canonical import rejection crosses project boundary: ${row.id}`);
        }
      }
    }

    for (const row of payload.lifecycle_events) {
      const source = claimById.get(row.source_claim_id);
      const target = claimById.get(row.target_claim_id);
      const evidence = evidenceById.get(row.evidence_id);
      if (!source || !target || !evidence) {
        throw new Error(`canonical import lifecycle event has missing provenance: ${row.id}`);
      }
      if (
        source.project_id !== row.project_id
        || target.project_id !== row.project_id
        || evidence.project_id !== row.project_id
      ) {
        throw new Error(`canonical import lifecycle event crosses project boundary: ${row.id}`);
      }
    }

    for (const row of payload.conflicts) {
      const a = claimById.get(row.claim_a);
      const b = claimById.get(row.claim_b);
      const createdEvidence = evidenceById.get(row.created_by_evidence_id);
      const resolvedEvidence = row.resolved_by_evidence_id === null
        ? null
        : evidenceById.get(row.resolved_by_evidence_id);
      if (!a || !b || !createdEvidence || (
        row.resolved_by_evidence_id !== null && !resolvedEvidence
      )) {
        throw new Error(`canonical import conflict has missing provenance: ${row.claim_a}/${row.claim_b}`);
      }
      if (
        a.project_id !== row.project_id
        || b.project_id !== row.project_id
        || createdEvidence.project_id !== row.project_id
        || (resolvedEvidence && resolvedEvidence.project_id !== row.project_id)
      ) {
        throw new Error(`canonical import conflict crosses project boundary: ${row.claim_a}/${row.claim_b}`);
      }
    }

    for (const row of payload.approvals) {
      const sourceEvidence = evidenceById.get(row.source_evidence_id);
      if (!sourceEvidence) {
        throw new Error(`canonical import approval references unknown evidence: ${row.id}`);
      }
      if (sourceEvidence.project_id !== row.project_id) {
        throw new Error(`canonical import approval evidence crosses project boundary: ${row.id}`);
      }
      if (sourceEvidence.authority_class !== 'user_direct') {
        throw new Error(`canonical import approval source must be user_direct: ${row.id}`);
      }
      if (sourceEvidence.source_ref !== row.actor) {
        throw new Error(`canonical import approval actor does not match source provenance: ${row.id}`);
      }
    }

    for (const row of payload.evidence) {
      assertAuthorityClass(row.authority_class);
      let metadata;
      try {
        metadata = JSON.parse(row.metadata_json);
      } catch {
        throw new Error(`canonical import has invalid evidence metadata JSON: ${row.id}`);
      }
      const scanned = redactValue({
        source_ref: row.source_ref,
        content_redacted: row.content_redacted,
        metadata,
      });
      if (scanned.redacted) {
        throw new Error(`canonical import contains unredacted secret material in evidence ${row.id}`);
      }
    }
    for (const row of payload.claims) {
      if (!CLAIM_STATES.has(row.state)) {
        throw new Error(`canonical import has unsupported claim state: ${row.state}`);
      }
      const scanned = redactValue({
        subject: row.subject,
        predicate: row.predicate,
        value_text: row.value_text,
      });
      if (scanned.redacted) {
        throw new Error(`canonical import contains unredacted secret material in claim ${row.id}`);
      }
    }
    for (const row of payload.approvals) {
      let constraints;
      try {
        constraints = JSON.parse(row.constraints_json);
      } catch {
        throw new Error(`canonical import has invalid approval constraints JSON: ${row.id}`);
      }
      if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
        throw new Error(`canonical import approval constraints must be an object: ${row.id}`);
      }
      if (
        !Number.isInteger(row.max_uses)
        || row.max_uses < 1
        || !Number.isInteger(row.uses)
        || row.uses < 0
        || row.uses > row.max_uses
      ) {
        throw new Error(`canonical import has invalid approval use counts: ${row.id}`);
      }
      const scanned = redactValue({
        actor: row.actor,
        action: row.action,
        target: row.target,
        environment: row.environment,
        artifact: row.artifact,
        constraints,
      });
      if (scanned.redacted) {
        throw new Error(`canonical import contains secret material in approval ${row.id}`);
      }
    }

      for (const row of payload.projects) {
        const existing = this.#db.prepare(`
          SELECT canonical_remote, repo_identity
          FROM project_registry
          WHERE project_id = ?
        `).get(row.project_id);
        if (existing) {
          if (
            existing.canonical_remote !== row.canonical_remote
            || existing.repo_identity !== row.repo_identity
          ) {
            throw new Error(`project ${row.project_id} conflicts with canonical import`);
          }
          this.#db.prepare(`
            UPDATE project_registry
            SET created_at = ?
            WHERE project_id = ?
          `).run(row.created_at, row.project_id);
          continue;
        }

        this.#db.prepare(`
          INSERT INTO project_registry (
            project_id, canonical_remote, repo_identity, created_at
          ) VALUES (?, ?, ?, ?)
        `).run(
          row.project_id,
          row.canonical_remote,
          row.repo_identity,
          row.created_at,
        );
      }

      const insertEvidence = this.#db.prepare(`
        INSERT INTO evidence (
          id, project_id, harness, session_id, source_kind, source_ref,
          captured_at, branch, commit_sha, path, blob_oid, content_redacted,
          sensitivity, authority_class, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of payload.evidence) {
        insertEvidence.run(
          row.id,
          row.project_id,
          row.harness,
          row.session_id,
          row.source_kind,
          row.source_ref,
          row.captured_at,
          row.branch,
          row.commit_sha,
          row.path,
          row.blob_oid,
          row.content_redacted,
          row.sensitivity,
          row.authority_class,
          row.metadata_json,
        );
      }

      const insertClaim = this.#db.prepare(`
        INSERT INTO claims (
          id, project_id, kind, subject, predicate, value_text, state,
          branch_scope, created_from_evidence_id, created_at, valid_from,
          valid_until, superseded_by_claim_id, rejected_by_evidence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `);
      for (const row of payload.claims) {
        insertClaim.run(
          row.id,
          row.project_id,
          row.kind,
          row.subject,
          row.predicate,
          row.value_text,
          row.state,
          row.branch_scope,
          row.created_from_evidence_id,
          row.created_at,
          row.valid_from,
          row.valid_until,
          row.rejected_by_evidence_id,
        );
      }

      const updateSupersession = this.#db.prepare(`
        UPDATE claims
        SET superseded_by_claim_id = ?
        WHERE id = ?
      `);
      for (const row of payload.claims) {
        if (row.superseded_by_claim_id !== null) {
          updateSupersession.run(row.superseded_by_claim_id, row.id);
        }
      }

      const insertLifecycle = this.#db.prepare(`
        INSERT INTO lifecycle_events (
          id, project_id, action, source_claim_id, target_claim_id,
          evidence_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of payload.lifecycle_events) {
        insertLifecycle.run(
          row.id,
          row.project_id,
          row.action,
          row.source_claim_id,
          row.target_claim_id,
          row.evidence_id,
          row.created_at,
        );
      }

      const insertConflict = this.#db.prepare(`
        INSERT INTO conflicts (
          project_id, claim_a, claim_b, state, created_by_evidence_id,
          created_at, resolved_by_evidence_id, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of payload.conflicts) {
        insertConflict.run(
          row.project_id,
          row.claim_a,
          row.claim_b,
          row.state,
          row.created_by_evidence_id,
          row.created_at,
          row.resolved_by_evidence_id,
          row.resolved_at,
        );
      }

      const insertApproval = this.#db.prepare(`
        INSERT INTO approvals (
          id, project_id, actor, action, target, environment, artifact,
          constraints_json, issued_at, expires_at, max_uses, uses,
          revoked_at, source_evidence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of payload.approvals) {
        insertApproval.run(
          row.id,
          row.project_id,
          row.actor,
          row.action,
          row.target,
          row.environment,
          row.artifact,
          row.constraints_json,
          row.issued_at,
          row.expires_at,
          row.max_uses,
          row.uses,
          row.revoked_at,
          row.source_evidence_id,
        );
      }

      this.#db.prepare('DELETE FROM claim_fts').run();
      const searchRows = this.#db.prepare(`
        SELECT
          c.id,
          c.project_id,
          c.branch_scope,
          c.kind,
          c.subject,
          c.predicate,
          c.value_text,
          e.content_redacted
        FROM claims c
        JOIN evidence e ON e.id = c.created_from_evidence_id
        ORDER BY c.id
      `).all();
      const insertSearch = this.#db.prepare(`
        INSERT INTO claim_fts (claim_id, project_id, branch_scope, text)
        VALUES (?, ?, ?, ?)
      `);
      for (const row of searchRows) {
        insertSearch.run(
          row.id,
          row.project_id,
          row.branch_scope,
          searchableText({
            kind: row.kind,
            subject: row.subject,
            predicate: row.predicate,
            value: row.value_text,
          }, row.content_redacted),
        );
      }
      this.#db.prepare('DELETE FROM claim_embeddings').run();
      this.#db.prepare('DELETE FROM repository_path_state').run();

      this.#db.exec('COMMIT');
      return {
        indexed_claims: searchRows.length,
        repository_path_snapshots: 0,
      };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  recordApproval({
    id,
    projectId,
    action,
    target,
    environment,
    artifact = null,
    constraints = {},
    issuedAt,
    expiresAt,
    maxUses = 1,
    sourceEvidenceId,
  }) {
    for (const [value, name] of [
      [id, 'id'],
      [projectId, 'projectId'],
      [action, 'action'],
      [target, 'target'],
      [environment, 'environment'],
      [sourceEvidenceId, 'sourceEvidenceId'],
    ]) {
      assertNonEmptyString(value, name);
    }
    if (artifact !== null) assertNonEmptyString(artifact, 'artifact');
    if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
      throw new TypeError('constraints must be an object');
    }
    if (!Number.isInteger(maxUses) || maxUses < 1) {
      throw new RangeError('maxUses must be a positive integer');
    }
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    const sourceEvidence = this.getEvidence(sourceEvidenceId);
    if (!sourceEvidence) throw new Error(`unknown source evidence: ${sourceEvidenceId}`);
    if (sourceEvidence.project_id !== projectId) {
      throw new Error('approval source evidence cannot cross project boundaries');
    }
    if (sourceEvidence.authority_class !== 'user_direct') {
      throw new Error('approval source evidence must be user_direct');
    }
    assertNonEmptyString(sourceEvidence.source_ref, 'approval source evidence source_ref');

    const normalizedIssuedAt = normalizeTimestamp(issuedAt, 'issuedAt');
    const normalizedExpiresAt = normalizeTimestamp(expiresAt, 'expiresAt');
    if (normalizedExpiresAt < normalizedIssuedAt) {
      throw new Error('approval expiresAt cannot be before issuedAt');
    }

    const redactedActor = redactString(sourceEvidence.source_ref);
    const redactedAction = redactString(action);
    const redactedTarget = redactString(target);
    const redactedEnvironment = redactString(environment);
    const redactedArtifact = redactString(artifact);
    const redactedConstraints = redactValue(constraints);
    if (
      redactedActor.redacted
      || redactedAction.redacted
      || redactedTarget.redacted
      || redactedEnvironment.redacted
      || redactedArtifact.redacted
      || redactedConstraints.redacted
    ) {
      throw new Error('approval scope cannot contain secrets');
    }

    this.#db.prepare(`
      INSERT INTO approvals (
        id, project_id, actor, action, target, environment, artifact,
        constraints_json, issued_at, expires_at, max_uses, uses,
        revoked_at, source_evidence_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).run(
      id,
      projectId,
      redactedActor.value,
      redactedAction.value,
      redactedTarget.value,
      redactedEnvironment.value,
      redactedArtifact.value,
      JSON.stringify(redactedConstraints.value),
      normalizedIssuedAt,
      normalizedExpiresAt,
      maxUses,
      sourceEvidenceId,
    );

    return this.getApproval(id);
  }

  revokeApproval({
    approvalId,
    projectId,
  }) {
    assertNonEmptyString(approvalId, 'approvalId');
    assertNonEmptyString(projectId, 'projectId');
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    const approval = this.getApproval(approvalId);
    if (!approval) throw new Error(`unknown approval: ${approvalId}`);
    if (approval.project_id !== projectId) {
      throw new Error('approval cannot be revoked across project boundaries');
    }
    if (approval.revoked_at !== null) return approval;

    const normalizedRevokedAt = normalizeTimestamp(this.#clock(), 'clock()');
    if (normalizedRevokedAt < approval.issued_at) {
      throw new Error('approval cannot be revoked before it was issued');
    }

    this.#db.prepare(`
      UPDATE approvals
      SET revoked_at = ?
      WHERE id = ? AND project_id = ? AND revoked_at IS NULL
    `).run(normalizedRevokedAt, approvalId, projectId);

    return this.getApproval(approvalId);
  }

  authorizeAction({
    projectId,
    action,
    target,
    environment,
    artifact = null,
    constraints = {},
  }) {
    for (const [value, name] of [
      [projectId, 'projectId'],
      [action, 'action'],
      [target, 'target'],
      [environment, 'environment'],
    ]) {
      assertNonEmptyString(value, name);
    }
    if (artifact !== null) assertNonEmptyString(artifact, 'artifact');
    if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
      throw new TypeError('constraints must be an object');
    }
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    const normalizedAt = normalizeTimestamp(this.#clock(), 'clock()');
    const request = {
      project_id: projectId,
      action,
      target,
      environment,
      artifact,
      constraints,
      evaluated_at: normalizedAt,
    };

    const decide = () => {
      const candidates = this.#db.prepare(`
        SELECT *
        FROM approvals
        WHERE project_id = ?
          AND action = ?
          AND target = ?
          AND environment = ?
          AND artifact IS ?
        ORDER BY expires_at ASC, issued_at DESC, id ASC
      `).all(projectId, action, target, environment, artifact)
        .map(normalizeApproval)
        .filter((approval) => (
          approval.issued_at <= normalizedAt
          && approval.expires_at >= normalizedAt
          && (approval.revoked_at === null || approval.revoked_at > normalizedAt)
          && approval.uses < approval.max_uses
          && constraintsMatch(approval.constraints, constraints)
        ));

      if (candidates.length === 0) {
        return {
          authorized: false,
          reason: 'no_valid_approval',
          request,
          approval: null,
        };
      }

      return {
        authorized: true,
        reason: 'valid_approval',
        request,
        approval: candidates[0],
      };
    };

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const decision = decide();
      if (!decision.authorized) {
        this.#db.exec('COMMIT');
        return decision;
      }

      const result = this.#db.prepare(`
        UPDATE approvals
        SET uses = uses + 1
        WHERE id = ?
          AND project_id = ?
          AND uses < max_uses
          AND issued_at <= ?
          AND expires_at >= ?
          AND (revoked_at IS NULL OR revoked_at > ?)
      `).run(
        decision.approval.id,
        projectId,
        normalizedAt,
        normalizedAt,
        normalizedAt,
      );
      if (result.changes !== 1) {
        this.#db.exec('ROLLBACK');
        return {
          authorized: false,
          reason: 'approval_no_longer_valid',
          request,
          approval: null,
        };
      }

      const consumedApproval = this.getApproval(decision.approval.id);
      this.#db.exec('COMMIT');
      return {
        authorized: true,
        reason: 'valid_approval',
        request,
        approval: consumedApproval,
        consumed: true,
      };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  repositoryPaths({ projectId, branch }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');

    return this.#db.prepare(`
      SELECT DISTINCT e.path
      FROM claims c
      JOIN evidence e ON e.id = c.created_from_evidence_id
      WHERE c.project_id = ?
        AND c.branch_scope = ?
        AND e.path IS NOT NULL
      ORDER BY e.path ASC
    `).all(projectId, branch).map((row) => row.path);
  }

  recordRepositoryPathState({
    projectId,
    branch,
    path,
    commitSha,
    blobOid = null,
    checkedAt = null,
  }) {
    for (const [value, name] of [
      [projectId, 'projectId'],
      [branch, 'branch'],
      [path, 'path'],
      [commitSha, 'commitSha'],
    ]) {
      assertNonEmptyString(value, name);
    }
    if (blobOid !== null) assertNonEmptyString(blobOid, 'blobOid');
    if (checkedAt !== null) assertNonEmptyString(checkedAt, 'checkedAt');
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);

    this.#db.prepare(`
      INSERT INTO repository_path_state (
        project_id, branch, path, commit_sha, blob_oid, checked_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, branch, path) DO UPDATE SET
        commit_sha = excluded.commit_sha,
        blob_oid = excluded.blob_oid,
        checked_at = excluded.checked_at
    `).run(projectId, branch, path, commitSha, blobOid, checkedAt);

    return {
      project_id: projectId,
      branch,
      path,
      commit_sha: commitSha,
      blob_oid: blobOid,
      checked_at: checkedAt,
    };
  }

  getCandidate(id) {
    assertNonEmptyString(id, 'id');
    return normalizeCandidate(
      this.#db.prepare(
        'SELECT * FROM memory_candidates WHERE id = ?',
      ).get(id),
    );
  }

  findCandidateByFingerprint({
    projectId,
    branch,
    fingerprint,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    assertNonEmptyString(fingerprint, 'fingerprint');

    return normalizeCandidate(
      this.#db.prepare(
        'SELECT * FROM memory_candidates '
        + 'WHERE project_id = ? AND branch = ? AND fingerprint = ?',
      ).get(projectId, branch, fingerprint),
    );
  }

  listUnevaluatedCandidates({
    projectId,
    branch,
    limit = 10,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new RangeError('limit must be an integer between 1 and 20');
    }

    return this.#db.prepare(
      'SELECT * FROM memory_candidates '
      + "WHERE project_id = ? AND branch = ? AND status = 'pending' "
      + "AND source_authority = 'user_direct' "
      + 'AND evaluated_at IS NULL '
      + 'ORDER BY created_at ASC, id ASC LIMIT ?',
    ).all(projectId, branch, limit).map(normalizeCandidate);
  }

  listScopedCandidates({
    projectId,
    branch,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');

    return this.#db.prepare(
      'SELECT * FROM memory_candidates '
      + 'WHERE project_id = ? AND branch = ? '
      + 'ORDER BY created_at DESC, id ASC',
    ).all(projectId, branch).map(normalizeCandidate);
  }

  listCandidates({
    projectId,
    branch,
    status = 'pending',
    limit = 50,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    assertNonEmptyString(status, 'status');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit must be an integer between 1 and 100');
    }

    return this.#db.prepare(
      'SELECT * FROM memory_candidates '
      + 'WHERE project_id = ? AND branch = ? AND status = ? '
      + 'ORDER BY created_at DESC, id ASC LIMIT ?',
    ).all(projectId, branch, status, limit).map(normalizeCandidate);
  }

  recordCandidate({
    id,
    evidenceId,
    type,
    proposedValue,
    decisionReason,
    policyVersion,
    fingerprint,
    createdAt = this.#clock(),
  }) {
    assertNonEmptyString(id, 'id');
    assertNonEmptyString(evidenceId, 'evidenceId');
    assertNonEmptyString(type, 'type');
    assertNonEmptyString(proposedValue, 'proposedValue');
    assertNonEmptyString(decisionReason, 'decisionReason');
    assertNonEmptyString(policyVersion, 'policyVersion');
    assertNonEmptyString(fingerprint, 'fingerprint');
    assertNonEmptyString(createdAt, 'createdAt');

    const allowedTypes = new Set([
      'decision',
      'preference',
      'constraint',
      'correction',
      'rejected_approach',
      'known_issue',
    ]);
    if (!allowedTypes.has(type)) {
      throw new Error('unsupported memory candidate type');
    }
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      throw new Error('fingerprint must be a lowercase SHA-256 hex digest');
    }

    const evidence = this.getEvidence(evidenceId);
    if (!evidence) throw new Error(`unknown evidence: ${evidenceId}`);
    if (evidence.authority_class !== 'user_direct') {
      throw new Error('memory candidates require user_direct evidence');
    }
    if (evidence.sensitivity === 'secret_redacted') {
      throw new Error('secret-redacted evidence cannot become a memory candidate');
    }
    if (!evidence.branch) {
      throw new Error('memory candidates require branch-scoped evidence');
    }
    if (proposedValue !== evidence.content_redacted) {
      throw new Error('candidate value must exactly match redacted source evidence');
    }

    const existing = this.findCandidateByFingerprint({
      projectId: evidence.project_id,
      branch: evidence.branch,
      fingerprint,
    });
    if (existing) return existing;

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare(
        'INSERT INTO memory_candidates ('
        + 'id, project_id, branch, source_evidence_id, proposed_type, '
        + 'proposed_value, source_authority, status, decision_reason, '
        + 'created_at, evaluated_at, related_claim_id, relation, policy_version, '
        + 'evaluator_id, evaluation_json, fingerprint'
        + ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?)',
      ).run(
        id,
        evidence.project_id,
        evidence.branch,
        evidence.id,
        type,
        proposedValue,
        evidence.authority_class,
        'pending',
        decisionReason,
        createdAt,
        policyVersion,
        fingerprint,
      );
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      const raced = this.findCandidateByFingerprint({
        projectId: evidence.project_id,
        branch: evidence.branch,
        fingerprint,
      });
      if (raced) return raced;
      throw error;
    }

    return this.getCandidate(id);
  }

  evaluateCandidate({
    candidateId,
    evaluatorId,
    evaluation,
    evaluatedAt = this.#clock(),
  }) {
    assertNonEmptyString(candidateId, 'candidateId');
    assertNonEmptyString(evaluatorId, 'evaluatorId');
    assertNonEmptyString(evaluatedAt, 'evaluatedAt');

    const candidate = this.getCandidate(candidateId);
    if (!candidate) throw new Error('unknown memory candidate: ' + candidateId);
    if (candidate.status !== 'pending') {
      throw new Error('memory candidate is not pending');
    }
    if (candidate.evaluated_at !== null) {
      throw new Error('memory candidate is already evaluated');
    }

    const evidence = this.getEvidence(candidate.source_evidence_id);
    if (!evidence) throw new Error('candidate source evidence is missing');
    if (
      candidate.source_authority !== 'user_direct'
      || evidence.authority_class !== 'user_direct'
    ) {
      throw new Error('candidate evaluation requires user_direct authority');
    }
    if (evidence.sensitivity === 'secret_redacted') {
      throw new Error('secret-redacted evidence cannot be evaluated for promotion');
    }
    if (
      evidence.project_id !== candidate.project_id
      || evidence.branch !== candidate.branch
      || evidence.content_redacted !== candidate.proposed_value
    ) {
      throw new Error('candidate source evidence invariant failed');
    }

    const normalized = validateMemoryCandidateJudgment(evaluation);
    const nextStatus = normalized.decision === 'ignore'
      ? 'ignored'
      : normalized.decision === 'needs_confirmation'
        ? 'needs_confirmation'
        : 'pending';

    const result = this.#db.prepare(
      'UPDATE memory_candidates '
      + 'SET status = ?, evaluated_at = ?, evaluator_id = ?, evaluation_json = ? '
      + "WHERE id = ? AND status = 'pending' AND evaluated_at IS NULL",
    ).run(
      nextStatus,
      evaluatedAt,
      evaluatorId,
      JSON.stringify(normalized),
      candidateId,
    );

    if (Number(result.changes) !== 1) {
      throw new Error('memory candidate evaluation raced or was already applied');
    }
    return this.getCandidate(candidateId);
  }

  listRelationPendingCandidates({
    projectId,
    branch,
    limit = 10,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new RangeError('limit must be an integer between 1 and 20');
    }

    const rows = this.#db.prepare(
      'SELECT * FROM memory_candidates '
      + "WHERE project_id = ? AND branch = ? AND status = 'pending' "
      + "AND source_authority = 'user_direct' "
      + 'AND evaluated_at IS NOT NULL AND relation IS NULL '
      + 'ORDER BY created_at ASC, id ASC LIMIT ?',
    ).all(projectId, branch, limit * 4).map(normalizeCandidate);

    const eligible = [];
    for (const candidate of rows) {
      let evaluation;
      try {
        evaluation = JSON.parse(candidate.evaluation_json);
      } catch {
        continue;
      }

      let normalized;
      try {
        normalized = validateMemoryCandidateJudgment(evaluation);
      } catch {
        continue;
      }

      if (normalized.decision !== 'promote') continue;
      eligible.push(candidate);
      if (eligible.length >= limit) break;
    }

    return eligible;
  }

  getCandidateRelation(candidateId) {
    assertNonEmptyString(candidateId, 'candidateId');
    return normalizeCandidateRelation(
      this.#db.prepare(
        'SELECT * FROM memory_candidate_relations WHERE candidate_id = ?',
      ).get(candidateId),
    );
  }

  evaluateCandidateRelation({
    candidateId,
    evaluatorId,
    policyVersion,
    relation,
    relatedClaimId = null,
    evaluatedAt = this.#clock(),
  }) {
    assertNonEmptyString(candidateId, 'candidateId');
    assertNonEmptyString(evaluatorId, 'evaluatorId');
    assertNonEmptyString(policyVersion, 'policyVersion');
    assertNonEmptyString(evaluatedAt, 'evaluatedAt');

    const candidate = this.getCandidate(candidateId);
    if (!candidate) throw new Error('unknown memory candidate: ' + candidateId);
    if (candidate.status !== 'pending') {
      throw new Error('memory candidate is not pending');
    }
    if (candidate.evaluated_at === null || !candidate.evaluation_json) {
      throw new Error('memory candidate has no importance evaluation');
    }
    if (candidate.relation !== null || this.getCandidateRelation(candidateId)) {
      throw new Error('memory candidate relation is already evaluated');
    }

    let importance;
    try {
      importance = validateMemoryCandidateJudgment(
        JSON.parse(candidate.evaluation_json),
      );
    } catch {
      throw new Error('memory candidate importance evaluation is invalid');
    }
    if (importance.decision !== 'promote') {
      throw new Error('memory candidate relation requires promote importance judgment');
    }

    const normalized = validateMemoryCandidateRelation(relation);
    if (normalized.relation === 'unrelated') {
      if (relatedClaimId !== null) {
        throw new Error('unrelated relation cannot target a claim');
      }
    } else {
      assertNonEmptyString(relatedClaimId, 'relatedClaimId');
      const claim = this.getClaim(relatedClaimId);
      if (!claim) throw new Error('related claim does not exist');
      if (
        claim.project_id !== candidate.project_id
        || claim.branch_scope !== candidate.branch
        || claim.state !== 'active'
        || claim.kind !== 'user_direct'
        || claim.subject !== 'user memory'
        || claim.predicate !== 'states'
      ) {
        throw new Error(
          'related claim must be an active durable user memory in candidate scope',
        );
      }
      const evidence = this.getEvidence(claim.created_from_evidence_id);
      if (
        !evidence
        || evidence.authority_class !== 'user_direct'
        || evidence.project_id !== candidate.project_id
      ) {
        throw new Error('related claim authority invariant failed');
      }
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = this.#db.prepare(
        'INSERT INTO memory_candidate_relations ('
        + 'candidate_id, relation, related_claim_id, evaluator_id, '
        + 'policy_version, evaluated_at, result_json'
        + ') VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        candidateId,
        normalized.relation,
        relatedClaimId,
        evaluatorId,
        policyVersion,
        evaluatedAt,
        JSON.stringify(normalized),
      );

      if (Number(inserted.changes) !== 1) {
        throw new Error('memory candidate relation was not stored');
      }

      const updated = this.#db.prepare(
        'UPDATE memory_candidates SET relation = ?, related_claim_id = ? '
        + 'WHERE id = ? AND relation IS NULL',
      ).run(
        normalized.relation,
        relatedClaimId,
        candidateId,
      );

      if (Number(updated.changes) !== 1) {
        throw new Error('memory candidate relation raced or was already applied');
      }

      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }

    return this.getCandidate(candidateId);
  }

  listPromotionReadyCandidates({
    projectId,
    branch,
    limit = 10,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new RangeError('limit must be an integer between 1 and 20');
    }

    return this.#db.prepare(
      'SELECT c.* FROM memory_candidates c '
      + 'JOIN memory_candidate_relations r ON r.candidate_id = c.id '
      + "WHERE c.project_id = ? AND c.branch = ? AND c.status = 'pending' "
      + "AND c.source_authority = 'user_direct' "
      + 'AND c.evaluated_at IS NOT NULL AND c.relation IS NOT NULL '
      + 'AND NOT EXISTS ('
      + 'SELECT 1 FROM memory_candidate_promotions p WHERE p.candidate_id = c.id'
      + ') '
      + 'ORDER BY c.created_at ASC, c.id ASC LIMIT ?',
    ).all(projectId, branch, limit).map(normalizeCandidate);
  }

  getCandidateConfirmation(candidateId) {
    assertNonEmptyString(candidateId, 'candidateId');
    const row = this.#db.prepare(
      'SELECT * FROM memory_candidate_confirmations WHERE candidate_id = ?',
    ).get(candidateId);
    if (!row) return null;
    return {
      candidate_id: row.candidate_id,
      confirmation_evidence_id: row.confirmation_evidence_id,
      relation: row.relation,
      related_claim_id: row.related_claim_id,
      claim_id: row.claim_id,
      status: row.status,
      policy_version: row.policy_version,
      confirmed_at: row.confirmed_at,
      result_json: row.result_json,
    };
  }

  confirmCandidate({
    projectId,
    branch,
    candidateId,
    relation,
    targetClaimId = null,
    claimId,
    confirmationEvidenceId,
    policyVersion,
    confirmedAt = this.#clock(),
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    assertNonEmptyString(candidateId, 'candidateId');
    assertNonEmptyString(relation, 'relation');
    assertNonEmptyString(claimId, 'claimId');
    assertNonEmptyString(confirmationEvidenceId, 'confirmationEvidenceId');
    assertNonEmptyString(policyVersion, 'policyVersion');
    assertNonEmptyString(confirmedAt, 'confirmedAt');

    if (!['same', 'update', 'contradict', 'unrelated'].includes(relation)) {
      throw new Error('unsupported candidate confirmation relation');
    }
    if (relation === 'unrelated' && targetClaimId !== null) {
      throw new Error('unrelated candidate confirmation cannot target a claim');
    }
    if (relation !== 'unrelated') {
      assertNonEmptyString(targetClaimId, 'targetClaimId');
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      if (this.getCandidateConfirmation(candidateId)) {
        throw new Error('memory candidate confirmation is already finalized');
      }

      const candidate = normalizeCandidate(
        this.#db.prepare('SELECT * FROM memory_candidates WHERE id = ?')
          .get(candidateId),
      );
      if (!candidate) {
        throw new Error('unknown memory candidate: ' + candidateId);
      }
      if (
        candidate.project_id !== projectId
        || candidate.branch !== branch
      ) {
        throw new Error('memory candidate confirmation scope mismatch');
      }
      let keepCandidate = false;
      if (
        candidate.status === 'pending'
        && candidate.evaluated_at !== null
        && typeof candidate.evaluation_json === 'string'
        && candidate.relation === null
      ) {
        try {
          keepCandidate = validateMemoryCandidateJudgment(
            JSON.parse(candidate.evaluation_json),
          ).decision === 'keep_candidate';
        } catch {
          keepCandidate = false;
        }
      }
      if (
        candidate.status !== 'needs_confirmation'
        && !keepCandidate
      ) {
        throw new Error('memory candidate is not confirmable');
      }

      const sourceEvidence = normalizeEvidence(
        this.#db.prepare('SELECT * FROM evidence WHERE id = ?')
          .get(candidate.source_evidence_id),
      );
      if (!sourceEvidence) {
        throw new Error('candidate source evidence is missing');
      }
      if (
        candidate.source_authority !== 'user_direct'
        || sourceEvidence.authority_class !== 'user_direct'
        || sourceEvidence.sensitivity === 'secret_redacted'
        || sourceEvidence.project_id !== projectId
        || sourceEvidence.branch !== branch
        || sourceEvidence.content_redacted !== candidate.proposed_value
      ) {
        throw new Error('candidate source evidence invariant failed');
      }

      const confirmationEvidence = normalizeEvidence(
        this.#db.prepare('SELECT * FROM evidence WHERE id = ?')
          .get(confirmationEvidenceId),
      );
      if (!confirmationEvidence) {
        throw new Error('candidate confirmation evidence is missing');
      }
      if (
        confirmationEvidence.authority_class !== 'user_direct'
        || confirmationEvidence.sensitivity === 'secret_redacted'
        || confirmationEvidence.project_id !== projectId
        || confirmationEvidence.branch !== branch
        || confirmationEvidence.metadata?.explicit_memory_mode !== 'candidate_confirm'
      ) {
        throw new Error('candidate confirmation requires direct-user confirmation evidence in scope');
      }

      let target = null;
      if (relation !== 'unrelated') {
        target = normalizeClaim(
          this.#db.prepare('SELECT * FROM claims WHERE id = ?')
            .get(targetClaimId),
        );
        if (
          !target
          || target.project_id !== projectId
          || target.branch_scope !== branch
          || target.state !== 'active'
          || target.kind !== 'user_direct'
          || target.subject !== 'user memory'
          || target.predicate !== 'states'
        ) {
          throw new Error('candidate confirmation target must be one active durable user memory in scope');
        }

        const targetEvidence = normalizeEvidence(
          this.#db.prepare('SELECT * FROM evidence WHERE id = ?')
            .get(target.created_from_evidence_id),
        );
        if (
          !targetEvidence
          || targetEvidence.project_id !== projectId
          || targetEvidence.authority_class !== 'user_direct'
        ) {
          throw new Error('candidate confirmation target authority invariant failed');
        }
      }

      let status = 'superseded';
      let createdClaimId = null;
      if (relation !== 'same') {
        const preparedClaim = prepareClaimInput({
          evidence: {
            id: sourceEvidence.id,
            projectId: sourceEvidence.project_id,
            branch: sourceEvidence.branch,
          },
          claim: {
            id: claimId,
            kind: 'user_direct',
            subject: 'user memory',
            predicate: 'states',
            value: candidate.proposed_value,
            state: 'active',
            branchScope: branch,
            createdAt: confirmedAt,
          },
        });
        const lifecycle = prepareLifecycle(preparedClaim.id, {
          supersedes: relation === 'update' ? [target.id] : [],
          conflictsWith: relation === 'contradict' ? [target.id] : [],
        });

        insertClaimAndLifecycle(this.#db, {
          claim: preparedClaim,
          evidenceContent: sourceEvidence.content_redacted,
          lifecycle,
          lifecycleEvidenceId: confirmationEvidence.id,
          lifecycleCreatedAt: confirmedAt,
        });
        status = 'promoted';
        createdClaimId = preparedClaim.id;
      }

      const updated = this.#db.prepare(
        'UPDATE memory_candidates SET status = ? '
        + 'WHERE id = ? AND status = ?',
      ).run(status, candidateId, candidate.status);
      if (Number(updated.changes) !== 1) {
        throw new Error('memory candidate confirmation raced or was already finalized');
      }

      const audit = {
        status,
        relation,
        claim_id: createdClaimId,
        related_claim_id: target?.id ?? null,
      };
      this.#db.prepare(
        'INSERT INTO memory_candidate_confirmations ('
        + 'candidate_id, confirmation_evidence_id, relation, related_claim_id, '
        + 'claim_id, status, policy_version, confirmed_at, result_json'
        + ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        candidateId,
        confirmationEvidence.id,
        relation,
        target?.id ?? null,
        createdClaimId,
        status,
        policyVersion,
        confirmedAt,
        JSON.stringify(audit),
      );

      this.#db.exec('COMMIT');
      return audit;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  getCandidatePromotion(candidateId) {
    assertNonEmptyString(candidateId, 'candidateId');
    const row = this.#db.prepare(
      'SELECT * FROM memory_candidate_promotions WHERE candidate_id = ?',
    ).get(candidateId);
    if (!row) return null;
    return {
      candidate_id: row.candidate_id,
      status: row.status,
      relation: row.relation,
      claim_id: row.claim_id,
      related_claim_id: row.related_claim_id,
      policy_version: row.policy_version,
      finalized_at: row.finalized_at,
      result_json: row.result_json,
    };
  }

  previewCandidatePromotion({
    candidateId,
    claimId,
    policyVersion,
    finalizedAt = this.#clock(),
  }) {
    const resolved = resolveCandidatePromotion(this.#db, {
      candidateId,
      claimId,
      policyVersion,
      finalizedAt,
    });
    return {
      status: resolved.status,
      relation: resolved.relation.relation,
      claim_id: resolved.claim_id,
      related_claim_id: resolved.related_claim_id,
    };
  }

  finalizeCandidatePromotion({
    candidateId,
    claimId,
    policyVersion,
    finalizedAt = this.#clock(),
  }) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      if (this.getCandidatePromotion(candidateId)) {
        throw new Error('memory candidate promotion is already finalized');
      }

      const resolved = resolveCandidatePromotion(this.#db, {
        candidateId,
        claimId,
        policyVersion,
        finalizedAt,
      });

      if (resolved.status === 'promoted') {
        insertClaimAndLifecycle(this.#db, {
          claim: resolved.claim,
          evidenceContent: resolved.evidence.content_redacted,
          lifecycle: resolved.lifecycle,
        });
      }

      const updated = this.#db.prepare(
        'UPDATE memory_candidates SET status = ? '
        + "WHERE id = ? AND status = 'pending'",
      ).run(resolved.status, candidateId);
      if (Number(updated.changes) !== 1) {
        throw new Error('memory candidate promotion raced or was already finalized');
      }

      const audit = {
        status: resolved.status,
        relation: resolved.relation.relation,
        claim_id: resolved.claim_id,
        related_claim_id: resolved.related_claim_id,
      };
      this.#db.prepare(
        'INSERT INTO memory_candidate_promotions ('
        + 'candidate_id, status, relation, claim_id, related_claim_id, '
        + 'policy_version, finalized_at, result_json'
        + ') VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        candidateId,
        resolved.status,
        resolved.relation.relation,
        resolved.claim_id,
        resolved.related_claim_id,
        policyVersion,
        finalizedAt,
        JSON.stringify(audit),
      );

      this.#db.exec('COMMIT');
      return audit;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  recordEvidence(evidence) {
    const preparedEvidence = prepareEvidenceInput(evidence);
    if (!this.getProject(preparedEvidence.projectId)) {
      throw new Error(`unknown project: ${preparedEvidence.projectId}`);
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      insertEvidenceRow(this.#db, preparedEvidence);
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }

    return this.getEvidence(preparedEvidence.id);
  }

  assertClaim({ evidenceId, claim, lifecycle = {} }) {
    assertNonEmptyString(evidenceId, 'evidenceId');

    const evidence = this.getEvidence(evidenceId);
    if (!evidence) throw new Error(`unknown evidence: ${evidenceId}`);

    const preparedClaim = prepareClaimInput({
      evidence: {
        id: evidence.id,
        projectId: evidence.project_id,
        branch: evidence.branch,
      },
      claim,
    });
    const preparedLifecycle = prepareLifecycle(preparedClaim.id, lifecycle);

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      insertClaimAndLifecycle(this.#db, {
        claim: preparedClaim,
        evidenceContent: evidence.content_redacted,
        lifecycle: preparedLifecycle,
      });
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }

    return {
      evidence: this.getEvidence(evidenceId),
      claim: this.getClaim(preparedClaim.id),
    };
  }

  ingest({ evidence, claim, lifecycle = {} }) {
    if (!evidence || !claim) {
      throw new TypeError('ingest requires evidence and claim');
    }

    const preparedEvidence = prepareEvidenceInput(evidence);
    if (!this.getProject(preparedEvidence.projectId)) {
      throw new Error(`unknown project: ${preparedEvidence.projectId}`);
    }

    const preparedClaim = prepareClaimInput({
      evidence: {
        id: preparedEvidence.id,
        projectId: preparedEvidence.projectId,
        branch: preparedEvidence.branch,
      },
      claim,
    });
    const preparedLifecycle = prepareLifecycle(preparedClaim.id, lifecycle);

    // Preserve legacy ingest semantics: a secret appearing only in the claim
    // still marks the paired evidence row as secret-redacted.
    if (preparedClaim.valueRedacted) {
      preparedEvidence.sensitivity = 'secret_redacted';
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      insertEvidenceRow(this.#db, preparedEvidence);
      insertClaimAndLifecycle(this.#db, {
        claim: preparedClaim,
        evidenceContent: preparedEvidence.content,
        lifecycle: preparedLifecycle,
      });
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }

    return {
      evidence: this.getEvidence(preparedEvidence.id),
      claim: this.getClaim(preparedClaim.id),
    };
  }

  recall({
    projectId,
    branch,
    query,
    revisionSha = null,
    mode = 'current',
    limit = 10,
  }) {
    assertNonEmptyString(projectId, 'projectId');
    assertNonEmptyString(branch, 'branch');
    if (revisionSha !== null) assertNonEmptyString(revisionSha, 'revisionSha');
    if (!['current', 'historical'].includes(mode)) {
      throw new Error(`unsupported recall mode: ${mode}`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit must be an integer between 1 and 100');
    }

    const ftsQuery = buildFtsQuery(query);
    let rows;

    if (ftsQuery) {
      rows = this.#db.prepare(`
        SELECT
          c.*,
          e.id AS evidence_id,
          e.harness AS evidence_harness,
          e.session_id AS evidence_session_id,
          e.source_kind AS evidence_source_kind,
          e.source_ref AS evidence_source_ref,
          e.captured_at AS evidence_captured_at,
          e.branch AS evidence_branch,
          e.commit_sha AS evidence_commit_sha,
          e.path AS evidence_path,
          e.blob_oid AS evidence_blob_oid,
          e.content_redacted AS evidence_content_redacted,
          e.sensitivity AS evidence_sensitivity,
          e.authority_class AS evidence_authority_class,
          e.metadata_json AS evidence_metadata_json,
          rps.commit_sha AS freshness_commit_sha,
          rps.blob_oid AS freshness_blob_oid,
          rps.checked_at AS freshness_checked_at,
          bm25(claim_fts) AS rank
        FROM claim_fts
        JOIN claims c ON c.id = claim_fts.claim_id
        JOIN evidence e ON e.id = c.created_from_evidence_id
        LEFT JOIN repository_path_state rps
          ON rps.project_id = c.project_id
         AND rps.branch = c.branch_scope
         AND rps.path = e.path
        WHERE claim_fts MATCH ?
          AND c.project_id = ?
          AND c.branch_scope = ?
          AND ${CLAIM_ELIGIBILITY_SQL}
        ORDER BY rank ASC, c.created_at DESC, c.id ASC
        LIMIT ?
      `).all(ftsQuery, projectId, branch, mode, revisionSha, revisionSha, limit);
    } else {
      rows = this.#db.prepare(`
        SELECT
          c.*,
          e.id AS evidence_id,
          e.harness AS evidence_harness,
          e.session_id AS evidence_session_id,
          e.source_kind AS evidence_source_kind,
          e.source_ref AS evidence_source_ref,
          e.captured_at AS evidence_captured_at,
          e.branch AS evidence_branch,
          e.commit_sha AS evidence_commit_sha,
          e.path AS evidence_path,
          e.blob_oid AS evidence_blob_oid,
          e.content_redacted AS evidence_content_redacted,
          e.sensitivity AS evidence_sensitivity,
          e.authority_class AS evidence_authority_class,
          e.metadata_json AS evidence_metadata_json,
          rps.commit_sha AS freshness_commit_sha,
          rps.blob_oid AS freshness_blob_oid,
          rps.checked_at AS freshness_checked_at,
          0.0 AS rank
        FROM claims c
        JOIN evidence e ON e.id = c.created_from_evidence_id
        LEFT JOIN repository_path_state rps
          ON rps.project_id = c.project_id
         AND rps.branch = c.branch_scope
         AND rps.path = e.path
        WHERE c.project_id = ?
          AND c.branch_scope = ?
          AND ${CLAIM_ELIGIBILITY_SQL}
        ORDER BY c.created_at DESC, c.id ASC
        LIMIT ?
      `).all(projectId, branch, mode, revisionSha, revisionSha, limit);
    }

    const items = rows.map((row) => normalizeRecallRow(row, revisionSha));
    const ids = new Set(items.map((item) => item.claim.id));
    const conflicts = recallConflicts(this.#db, {
      projectId,
      branch,
      mode,
      revisionSha,
      itemIds: ids,
    });

    return {
      project_id: projectId,
      branch,
      mode,
      items,
      conflicts,
    };
  }
}
