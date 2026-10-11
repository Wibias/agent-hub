import { DatabaseSync } from 'node:sqlite';

import {
  evidenceExtractionFingerprint,
} from './evidence-bound-extraction.mjs';
import {
  validateEvidenceProposalJudgment,
} from './evidence-bound-proposal-judge.mjs';
import {
  validateEvidenceSupportJudgment,
} from './evidence-bound-support-judge.mjs';
import {
  evidenceRelationClaimRef,
  validateEvidenceRelationJudgment,
} from './evidence-bound-relation-judge.mjs';

const MEMORY_KINDS = new Set([
  'preference',
  'procedure',
  'knowledge',
]);
const ELIGIBLE_AUTHORITIES = new Set([
  'user_direct',
  'repo_trusted',
  'tool_observation',
]);
const PROPOSAL_STATUSES = new Set([
  'pending',
  'ignored',
  'promoted',
  'needs_confirmation',
  'superseded',
  'failed',
]);

export const EVIDENCE_PROPOSAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS memory_evidence_proposals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project_registry(project_id),
    branch TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('preference','procedure','knowledge')),
    canonical_fact TEXT NOT NULL,
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
    policy_version TEXT NOT NULL,
    evaluator_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    importance_policy_version TEXT,
    importance_evaluator_id TEXT,
    importance_evaluated_at TEXT,
    importance_json TEXT,
    support_policy_version TEXT,
    support_evaluator_id TEXT,
    support_evaluated_at TEXT,
    support_json TEXT,
    UNIQUE (project_id, branch, fingerprint)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_evidence_proposals_scope_status
  ON memory_evidence_proposals (project_id, branch, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS memory_evidence_proposal_evidence (
    proposal_id TEXT NOT NULL
      REFERENCES memory_evidence_proposals(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES evidence(id),
    linked_at TEXT NOT NULL,
    PRIMARY KEY (proposal_id, evidence_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_evidence_proposal_evidence_source
  ON memory_evidence_proposal_evidence (evidence_id, proposal_id);

  CREATE TABLE IF NOT EXISTS memory_evidence_proposal_relations (
    proposal_id TEXT PRIMARY KEY
      REFERENCES memory_evidence_proposals(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK (
      relation IN ('same','update','contradict','unrelated')
    ),
    related_claim_id TEXT,
    evaluator_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    evaluated_at TEXT NOT NULL,
    result_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_evidence_proposal_relations_target
  ON memory_evidence_proposal_relations (related_claim_id, proposal_id);

  CREATE TABLE IF NOT EXISTS memory_evidence_proposal_promotions (
    proposal_id TEXT PRIMARY KEY
      REFERENCES memory_evidence_proposals(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (
      status IN ('promoted','superseded','needs_confirmation')
    ),
    claim_id TEXT,
    related_claim_id TEXT,
    policy_version TEXT NOT NULL,
    finalized_at TEXT NOT NULL,
    result_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_evidence_proposal_promotions_claim
  ON memory_evidence_proposal_promotions (claim_id, proposal_id);
`;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, name) {
  if (!nonEmptyString(value)) {
    throw new TypeError(name + ' must be a non-empty string');
  }
}

function assertDb(db) {
  if (
    !db
    || typeof db !== 'object'
    || typeof db.prepare !== 'function'
    || typeof db.exec !== 'function'
  ) {
    throw new TypeError('db must be a DatabaseSync-like object');
  }
}

const tableCache = new WeakMap();

function tableExists(db, name) {
  let tables = tableCache.get(db);
  if (tables === undefined) {
    tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    tableCache.set(db, tables);
  }
  return tables.has(name);
}

function normalizeFact(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeProposalRow(db, row) {
  if (!row) return null;
  const evidence = db.prepare(`
    SELECT
      pe.evidence_id,
      e.authority_class
    FROM memory_evidence_proposal_evidence pe
    JOIN evidence e ON e.id = pe.evidence_id
    WHERE pe.proposal_id = ?
    ORDER BY pe.evidence_id ASC
  `).all(row.id);
  const relationRow = tableExists(db, 'memory_evidence_proposal_relations')
    ? db.prepare(`
        SELECT *
        FROM memory_evidence_proposal_relations
        WHERE proposal_id = ?
      `).get(row.id)
    : null;
  const relation = relationRow
    ? validateEvidenceRelationJudgment(JSON.parse(relationRow.result_json))
    : null;
  const promotionRow = tableExists(db, 'memory_evidence_proposal_promotions')
    ? db.prepare(`
        SELECT *
        FROM memory_evidence_proposal_promotions
        WHERE proposal_id = ?
      `).get(row.id)
    : null;
  let promotion = null;
  if (promotionRow) {
    let result = {};
    try {
      const parsed = JSON.parse(promotionRow.result_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed;
    } catch {}
    promotion = {
      status: promotionRow.status,
      claim_id: promotionRow.claim_id,
      related_claim_id: promotionRow.related_claim_id,
      policy_version: promotionRow.policy_version,
      finalized_at: promotionRow.finalized_at,
      result,
    };
  }
  return {
    id: row.id,
    project_id: row.project_id,
    branch: row.branch,
    kind: row.kind,
    canonical_fact: row.canonical_fact,
    status: row.status,
    policy_version: row.policy_version,
    evaluator_id: row.evaluator_id,
    fingerprint: row.fingerprint,
    created_at: row.created_at,
    importance_policy_version: row.importance_policy_version ?? null,
    importance_evaluator_id: row.importance_evaluator_id ?? null,
    importance_evaluated_at: row.importance_evaluated_at ?? null,
    importance: row.importance_json
      ? validateEvidenceProposalJudgment(JSON.parse(row.importance_json))
      : null,
    support_policy_version: row.support_policy_version ?? null,
    support_evaluator_id: row.support_evaluator_id ?? null,
    support_evaluated_at: row.support_evaluated_at ?? null,
    support: row.support_json
      ? validateEvidenceSupportJudgment(JSON.parse(row.support_json))
      : null,
    relation,
    related_claim_id: relationRow?.related_claim_id ?? null,
    relation_policy_version: relationRow?.policy_version ?? null,
    relation_evaluator_id: relationRow?.evaluator_id ?? null,
    relation_evaluated_at: relationRow?.evaluated_at ?? null,
    promotion,
    evidence_ids: evidence.map((item) => item.evidence_id),
    authorities: [...new Set(
      evidence.map((item) => item.authority_class),
    )].sort((left, right) => left.localeCompare(right, 'en')),
  };
}

function validateEvidenceIds(evidenceIds) {
  if (!Array.isArray(evidenceIds) || evidenceIds.length < 1) {
    throw new TypeError('evidenceIds must contain at least one evidence id');
  }
  if (evidenceIds.length > 10) {
    throw new RangeError('evidenceIds must contain at most 10 evidence ids');
  }
  const seen = new Set();
  const normalized = [];
  for (const value of evidenceIds) {
    assertNonEmptyString(value, 'evidenceIds item');
    const id = value.trim();
    if (seen.has(id)) {
      throw new Error('duplicate evidence id in proposal');
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function validateProposalEvidence(db, {
  projectId,
  branch,
  kind,
  evidenceIds,
}) {
  const select = db.prepare(`
    SELECT
      id,
      project_id,
      branch,
      sensitivity,
      authority_class,
      content_redacted
    FROM evidence
    WHERE id = ?
  `);
  const rows = [];
  for (const evidenceId of evidenceIds) {
    const row = select.get(evidenceId);
    if (!row) throw new Error('unknown cited evidence: ' + evidenceId);
    if (row.project_id !== projectId || row.branch !== branch) {
      throw new Error('cited evidence is outside proposal scope: ' + evidenceId);
    }
    if (row.sensitivity === 'secret_redacted') {
      throw new Error('secret-redacted evidence is not eligible for proposal: ' + evidenceId);
    }
    if (!ELIGIBLE_AUTHORITIES.has(row.authority_class)) {
      throw new Error('cited evidence authority is not eligible for proposal: ' + evidenceId);
    }
    rows.push(row);
  }
  if (
    kind === 'preference'
    && rows.some((row) => row.authority_class !== 'user_direct')
  ) {
    throw new Error('preference proposal requires only user_direct evidence');
  }
  return rows;
}

export function ensureEvidenceProposalSchema(db) {
  assertDb(db);
  db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);

  const columns = new Set(
    db.prepare('PRAGMA table_info(memory_evidence_proposals)').all()
      .map((row) => row.name),
  );
  const additiveColumns = [
    ['support_policy_version', 'TEXT'],
    ['support_evaluator_id', 'TEXT'],
    ['support_evaluated_at', 'TEXT'],
    ['support_json', 'TEXT'],
  ];
  for (const [name, type] of additiveColumns) {
    if (columns.has(name)) continue;
    db.exec('ALTER TABLE memory_evidence_proposals ADD COLUMN ' + name + ' ' + type);
  }
}

export function getEvidenceBoundProposal(db, id) {
  assertDb(db);
  assertNonEmptyString(id, 'id');
  return normalizeProposalRow(
    db,
    db.prepare(
      'SELECT * FROM memory_evidence_proposals WHERE id = ?',
    ).get(id),
  );
}

export function findEvidenceBoundProposalByFingerprint(db, {
  projectId,
  branch,
  fingerprint,
}) {
  assertDb(db);
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  assertNonEmptyString(fingerprint, 'fingerprint');
  return normalizeProposalRow(
    db,
    db.prepare(`
      SELECT *
      FROM memory_evidence_proposals
      WHERE project_id = ? AND branch = ? AND fingerprint = ?
    `).get(projectId, branch, fingerprint),
  );
}

export function listEvidenceBoundProposals(db, {
  projectId,
  branch,
  status = 'pending',
  limit = 50,
}) {
  assertDb(db);
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  if (!PROPOSAL_STATUSES.has(status)) {
    throw new Error('unsupported evidence proposal status');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer between 1 and 100');
  }
  return db.prepare(`
    SELECT *
    FROM memory_evidence_proposals
    WHERE project_id = ? AND branch = ? AND status = ?
    ORDER BY created_at DESC, id ASC
    LIMIT ?
  `).all(projectId, branch, status, limit)
    .map((row) => normalizeProposalRow(db, row));
}

export function recordEvidenceBoundProposal(db, {
  id,
  projectId,
  branch,
  kind,
  canonicalFact,
  evidenceIds,
  fingerprint,
  policyVersion,
  evaluatorId,
  createdAt,
  inspectTextSensitivity,
}) {
  assertDb(db);
  for (const [value, name] of [
    [id, 'id'],
    [projectId, 'projectId'],
    [branch, 'branch'],
    [kind, 'kind'],
    [canonicalFact, 'canonicalFact'],
    [fingerprint, 'fingerprint'],
    [policyVersion, 'policyVersion'],
    [evaluatorId, 'evaluatorId'],
    [createdAt, 'createdAt'],
  ]) {
    assertNonEmptyString(value, name);
  }
  if (!MEMORY_KINDS.has(kind)) {
    throw new Error('unsupported evidence proposal kind');
  }
  if (!/^[0-9a-f]{64}$/u.test(fingerprint)) {
    throw new Error('fingerprint must be a lowercase SHA-256 hex digest');
  }
  if (typeof inspectTextSensitivity !== 'function') {
    throw new TypeError('inspectTextSensitivity must be a function');
  }
  if (!db.prepare(
    'SELECT project_id FROM project_registry WHERE project_id = ?',
  ).get(projectId)) {
    throw new Error('unknown project: ' + projectId);
  }

  const fact = normalizeFact(canonicalFact);
  if (!fact) throw new TypeError('canonicalFact must be a non-empty string');
  if (fact.length > 500) {
    throw new RangeError('canonicalFact must be at most 500 characters');
  }
  if (inspectTextSensitivity(fact)?.containsSecret === true) {
    throw new Error('proposal canonical fact contains secret material');
  }

  const expectedFingerprint = evidenceExtractionFingerprint({
    kind,
    canonicalFact: fact,
  });
  if (fingerprint !== expectedFingerprint) {
    throw new Error('evidence proposal fingerprint mismatch');
  }

  const normalizedEvidenceIds = validateEvidenceIds(evidenceIds);
  validateProposalEvidence(db, {
    projectId,
    branch,
    kind,
    evidenceIds: normalizedEvidenceIds,
  });

  db.exec('BEGIN IMMEDIATE');
  try {
    let row = db.prepare(`
      SELECT *
      FROM memory_evidence_proposals
      WHERE project_id = ? AND branch = ? AND fingerprint = ?
    `).get(projectId, branch, fingerprint);

    if (!row) {
      db.prepare(`
        INSERT INTO memory_evidence_proposals (
          id, project_id, branch, kind, canonical_fact, status,
          policy_version, evaluator_id, fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        branch,
        kind,
        fact,
        policyVersion,
        evaluatorId,
        fingerprint,
        createdAt,
      );
      row = db.prepare(
        'SELECT * FROM memory_evidence_proposals WHERE id = ?',
      ).get(id);
    }

    const link = db.prepare(`
      INSERT OR IGNORE INTO memory_evidence_proposal_evidence (
        proposal_id, evidence_id, linked_at
      ) VALUES (?, ?, ?)
    `);
    for (const evidenceId of normalizedEvidenceIds) {
      link.run(row.id, evidenceId, createdAt);
    }

    db.exec('COMMIT');
    return getEvidenceBoundProposal(db, row.id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}




export function getEvidenceBoundProposalEvidence(db, proposalId) {
  assertDb(db);
  assertNonEmptyString(proposalId, 'proposalId');
  return db.prepare(`
    SELECT e.*
    FROM memory_evidence_proposal_evidence pe
    JOIN evidence e ON e.id = pe.evidence_id
    WHERE pe.proposal_id = ?
    ORDER BY e.id ASC
  `).all(proposalId).map((row) => ({ ...row }));
}

export function listSupportPendingEvidenceBoundProposals({
  db,
  projectId,
  branch,
  limit = 20,
}) {
  assertDb(db);
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }
  return db.prepare(`
    SELECT *
    FROM memory_evidence_proposals
    WHERE project_id = ?
      AND branch = ?
      AND status = 'pending'
      AND support_json IS NULL
      AND json_valid(importance_json)
      AND json_extract(importance_json, '$.decision') = 'promote'
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(projectId, branch, limit)
    .map((row) => normalizeProposalRow(db, row));
}

export function evaluateEvidenceBoundProposalSupport(db, {
  proposalId,
  evaluatorId,
  policyVersion,
  judgment,
  evaluatedAt,
}) {
  assertDb(db);
  for (const [value, name] of [
    [proposalId, 'proposalId'],
    [evaluatorId, 'evaluatorId'],
    [policyVersion, 'policyVersion'],
    [evaluatedAt, 'evaluatedAt'],
  ]) {
    assertNonEmptyString(value, name);
  }

  const proposal = getEvidenceBoundProposal(db, proposalId);
  if (!proposal) throw new Error('unknown evidence proposal: ' + proposalId);
  if (proposal.status !== 'pending') {
    throw new Error('evidence proposal is not pending');
  }
  if (proposal.importance?.decision !== 'promote') {
    throw new Error('evidence proposal support requires promote importance');
  }
  if (proposal.support !== null) {
    throw new Error('evidence proposal support is already evaluated');
  }

  const normalized = validateEvidenceSupportJudgment(judgment);
  const nextStatus = normalized.decision === 'unsupported'
    ? 'ignored'
    : normalized.decision === 'needs_confirmation'
      ? 'needs_confirmation'
      : 'pending';

  const updated = db.prepare(`
    UPDATE memory_evidence_proposals
    SET status = ?,
        support_policy_version = ?,
        support_evaluator_id = ?,
        support_evaluated_at = ?,
        support_json = ?
    WHERE id = ?
      AND status = 'pending'
      AND support_json IS NULL
  `).run(
    nextStatus,
    policyVersion,
    evaluatorId,
    evaluatedAt,
    JSON.stringify(normalized),
    proposalId,
  );
  if (Number(updated.changes) !== 1) {
    throw new Error('evidence proposal support evaluation raced');
  }
  return getEvidenceBoundProposal(db, proposalId);
}

export function listRelationPendingEvidenceBoundProposals({
  db,
  projectId,
  branch,
  limit = 20,
}) {
  assertDb(db);
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }
  return db.prepare(`
    SELECT p.*
    FROM memory_evidence_proposals p
    WHERE p.project_id = ?
      AND p.branch = ?
      AND p.status = 'pending'
      AND json_valid(p.importance_json)
      AND json_extract(p.importance_json, '$.decision') = 'promote'
      AND json_valid(p.support_json)
      AND json_extract(p.support_json, '$.decision') = 'supported'
      AND NOT EXISTS (
        SELECT 1
        FROM memory_evidence_proposal_relations r
        WHERE r.proposal_id = p.id
      )
    ORDER BY p.created_at ASC, p.id ASC
    LIMIT ?
  `).all(projectId, branch, limit)
    .map((row) => normalizeProposalRow(db, row));
}

function claimEvidenceAuthorities(db, claimId) {
  const hasClaimEvidence = tableExists(db, 'claim_evidence');
  if (!hasClaimEvidence) {
    const row = db.prepare(`
      SELECT e.authority_class
      FROM claims c
      JOIN evidence e ON e.id = c.created_from_evidence_id
      WHERE c.id = ?
    `).get(claimId);
    return row ? [row.authority_class] : [];
  }
  return db.prepare(`
    SELECT e.authority_class
    FROM claim_evidence ce
    JOIN evidence e ON e.id = ce.evidence_id
    WHERE ce.claim_id = ?
    ORDER BY
      CASE ce.role WHEN 'primary' THEN 0 ELSE 1 END ASC,
      ce.evidence_id ASC
  `).all(claimId).map((row) => row.authority_class);
}

export function listActiveEvidenceRelationClaims(db, {
  projectId,
  branch,
}) {
  assertDb(db);
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  const rows = db.prepare(`
    SELECT
      c.id AS claim_id,
      c.kind,
      c.subject,
      c.predicate,
      c.value_text,
      c.state,
      e.authority_class
    FROM claims c
    JOIN evidence e ON e.id = c.created_from_evidence_id
    WHERE c.project_id = ?
      AND c.branch_scope = ?
      AND c.state = 'active'
      AND e.project_id = c.project_id
    ORDER BY c.id ASC
  `).all(projectId, branch);
  const output = rows
    .filter((row) => {
      const authorities = claimEvidenceAuthorities(db, row.claim_id);
      return (
        authorities.length > 0
        && authorities.every((authority) => ELIGIBLE_AUTHORITIES.has(authority))
      );
    })
    .map((row) => ({
      claim_id: row.claim_id,
      ref: evidenceRelationClaimRef(row.claim_id),
      kind: row.kind,
      subject: row.subject,
      predicate: row.predicate,
      value: row.value_text,
      authority: row.authority_class,
      state: row.state,
    }));
  const refs = new Set();
  for (const item of output) {
    if (refs.has(item.ref)) throw new Error('opaque evidence relation ref collision');
    refs.add(item.ref);
  }
  return output;
}

export function evaluateEvidenceBoundProposalRelation(db, {
  proposalId,
  evaluatorId,
  policyVersion,
  relation,
  relatedClaimId = null,
  evaluatedAt,
}) {
  assertDb(db);
  for (const [value, name] of [
    [proposalId, 'proposalId'],
    [evaluatorId, 'evaluatorId'],
    [policyVersion, 'policyVersion'],
    [evaluatedAt, 'evaluatedAt'],
  ]) {
    assertNonEmptyString(value, name);
  }
  const proposal = getEvidenceBoundProposal(db, proposalId);
  if (!proposal) throw new Error('unknown evidence proposal: ' + proposalId);
  if (proposal.status !== 'pending') {
    throw new Error('evidence proposal is not pending');
  }
  if (proposal.importance?.decision !== 'promote') {
    throw new Error('evidence proposal relation requires promote importance');
  }
  if (proposal.support?.decision !== 'supported') {
    throw new Error('evidence proposal relation requires supported evidence');
  }
  if (proposal.relation !== null) {
    throw new Error('evidence proposal relation is already evaluated');
  }

  const normalized = validateEvidenceRelationJudgment(relation);
  if (normalized.relation === 'unrelated') {
    if (relatedClaimId !== null) {
      throw new Error('unrelated evidence relation cannot target a claim');
    }
  } else {
    assertNonEmptyString(relatedClaimId, 'relatedClaimId');
    const target = db.prepare(`
      SELECT c.id, c.project_id, c.branch_scope, c.state, e.authority_class
      FROM claims c
      JOIN evidence e ON e.id = c.created_from_evidence_id
      WHERE c.id = ?
    `).get(relatedClaimId);
    const targetAuthorities = target
      ? claimEvidenceAuthorities(db, target.id)
      : [];
    if (
      !target
      || target.project_id !== proposal.project_id
      || target.branch_scope !== proposal.branch
      || target.state !== 'active'
      || targetAuthorities.length < 1
      || targetAuthorities.some((authority) => !ELIGIBLE_AUTHORITIES.has(authority))
    ) {
      throw new Error('evidence relation target must be active and in proposal scope');
    }
    if (normalized.target_ref !== evidenceRelationClaimRef(relatedClaimId)) {
      throw new Error('evidence relation target ref invariant failed');
    }
  }

  db.prepare(`
    INSERT INTO memory_evidence_proposal_relations (
      proposal_id, relation, related_claim_id, evaluator_id,
      policy_version, evaluated_at, result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    proposalId,
    normalized.relation,
    relatedClaimId,
    evaluatorId,
    policyVersion,
    evaluatedAt,
    JSON.stringify(normalized),
  );
  return getEvidenceBoundProposal(db, proposalId);
}

export function listPromotionReadyEvidenceBoundProposals({
  db,
  projectId,
  branch,
  limit = 20,
}) {
  assertDb(db);
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }
  return db.prepare(`
    SELECT p.*
    FROM memory_evidence_proposals p
    JOIN memory_evidence_proposal_relations r ON r.proposal_id = p.id
    WHERE p.project_id = ?
      AND p.branch = ?
      AND p.status = 'pending'
      AND json_valid(p.importance_json)
      AND json_extract(p.importance_json, '$.decision') = 'promote'
      AND json_valid(p.support_json)
      AND json_extract(p.support_json, '$.decision') = 'supported'
      AND NOT EXISTS (
        SELECT 1
        FROM memory_evidence_proposal_promotions x
        WHERE x.proposal_id = p.id
      )
    ORDER BY p.created_at ASC, p.id ASC
    LIMIT ?
  `).all(projectId, branch, limit)
    .map((row) => normalizeProposalRow(db, row));
}

export function finalizeEvidenceBoundProposalPromotion(db, {
  proposalId,
  status,
  claimId = null,
  relatedClaimId = null,
  policyVersion,
  finalizedAt,
  result,
}) {
  assertDb(db);
  for (const [value, name] of [
    [proposalId, 'proposalId'],
    [status, 'status'],
    [policyVersion, 'policyVersion'],
    [finalizedAt, 'finalizedAt'],
  ]) {
    assertNonEmptyString(value, name);
  }
  if (!['promoted', 'superseded', 'needs_confirmation'].includes(status)) {
    throw new Error('unsupported evidence proposal promotion status');
  }
  if (status === 'promoted') {
    assertNonEmptyString(claimId, 'claimId');
  } else if (claimId !== null) {
    throw new Error(status + ' promotion cannot have claimId');
  }
  if (relatedClaimId !== null) assertNonEmptyString(relatedClaimId, 'relatedClaimId');
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('result must be an object');
  }

  const proposal = getEvidenceBoundProposal(db, proposalId);
  if (!proposal) throw new Error('unknown evidence proposal: ' + proposalId);
  if (proposal.status !== 'pending') {
    throw new Error('evidence proposal is not pending');
  }
  if (proposal.relation === null) {
    throw new Error('evidence proposal has no relation audit');
  }
  if (proposal.promotion !== null) {
    throw new Error('evidence proposal promotion is already finalized');
  }
  if (relatedClaimId !== proposal.related_claim_id) {
    throw new Error('promotion related claim invariant failed');
  }
  if (
    result.status !== status
    || result.relation !== proposal.relation.relation
    || (result.claim_id ?? null) !== claimId
    || (result.related_claim_id ?? null) !== relatedClaimId
  ) {
    throw new Error('promotion audit result does not match stored relation or ids');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO memory_evidence_proposal_promotions (
        proposal_id, status, claim_id, related_claim_id,
        policy_version, finalized_at, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposalId,
      status,
      claimId,
      relatedClaimId,
      policyVersion,
      finalizedAt,
      JSON.stringify(result),
    );
    const updated = db.prepare(`
      UPDATE memory_evidence_proposals
      SET status = ?
      WHERE id = ? AND status = 'pending'
    `).run(status, proposalId);
    if (Number(updated.changes) !== 1) {
      throw new Error('evidence proposal promotion raced');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getEvidenceBoundProposal(db, proposalId);
}

export function listUnevaluatedEvidenceBoundProposals({
  db,
  projectId,
  branch,
  limit = 20,
}) {
  assertDb(db);
  assertNonEmptyString(projectId, 'projectId');
  assertNonEmptyString(branch, 'branch');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }
  return db.prepare(`
    SELECT *
    FROM memory_evidence_proposals
    WHERE project_id = ?
      AND branch = ?
      AND status = 'pending'
      AND importance_json IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(projectId, branch, limit)
    .map((row) => normalizeProposalRow(db, row));
}

export function evaluateEvidenceBoundProposal(db, {
  proposalId,
  evaluatorId,
  policyVersion,
  judgment,
  evaluatedAt,
}) {
  assertDb(db);
  for (const [value, name] of [
    [proposalId, 'proposalId'],
    [evaluatorId, 'evaluatorId'],
    [policyVersion, 'policyVersion'],
    [evaluatedAt, 'evaluatedAt'],
  ]) {
    assertNonEmptyString(value, name);
  }

  const proposal = getEvidenceBoundProposal(db, proposalId);
  if (!proposal) throw new Error('unknown evidence proposal: ' + proposalId);
  if (proposal.importance !== null) {
    throw new Error('evidence proposal is already evaluated');
  }
  if (proposal.status !== 'pending') {
    throw new Error('evidence proposal is not pending');
  }

  const normalized = validateEvidenceProposalJudgment(judgment);
  const nextStatus = normalized.decision === 'ignore'
    ? 'ignored'
    : normalized.decision === 'needs_confirmation'
      ? 'needs_confirmation'
      : 'pending';

  const updated = db.prepare(`
    UPDATE memory_evidence_proposals
    SET status = ?,
        importance_policy_version = ?,
        importance_evaluator_id = ?,
        importance_evaluated_at = ?,
        importance_json = ?
    WHERE id = ?
      AND status = 'pending'
      AND importance_json IS NULL
  `).run(
    nextStatus,
    policyVersion,
    evaluatorId,
    evaluatedAt,
    JSON.stringify(normalized),
    proposalId,
  );
  if (Number(updated.changes) !== 1) {
    throw new Error('evidence proposal importance evaluation raced');
  }
  return getEvidenceBoundProposal(db, proposalId);
}

export class EvidenceBoundProposalStore {
  #db;
  #clock;
  #inspectTextSensitivity;
  #readOnly;

  constructor({
    dbPath,
    readOnly = false,
    clock = () => new Date().toISOString(),
    inspectTextSensitivity,
  } = {}) {
    assertNonEmptyString(dbPath, 'dbPath');
    if (typeof readOnly !== 'boolean') {
      throw new TypeError('readOnly must be a boolean');
    }
    if (typeof clock !== 'function') {
      throw new TypeError('clock must be a function');
    }
    if (typeof inspectTextSensitivity !== 'function') {
      throw new TypeError('inspectTextSensitivity must be a function');
    }

    this.#clock = clock;
    this.#inspectTextSensitivity = inspectTextSensitivity;
    this.#readOnly = readOnly;
    this.#db = new DatabaseSync(dbPath, {
      readOnly,
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (!readOnly) ensureEvidenceProposalSchema(this.#db);
  }

  close() {
    this.#db.close();
  }

  get(id) {
    return getEvidenceBoundProposal(this.#db, id);
  }

  findByFingerprint({ projectId, branch, fingerprint }) {
    return findEvidenceBoundProposalByFingerprint(this.#db, {
      projectId,
      branch,
      fingerprint,
    });
  }

  list({ projectId, branch, status = 'pending', limit = 50 }) {
    return listEvidenceBoundProposals(this.#db, {
      projectId,
      branch,
      status,
      limit,
    });
  }

  listUnevaluated({ projectId, branch, limit = 20 }) {
    return listUnevaluatedEvidenceBoundProposals({
      db: this.#db,
      projectId,
      branch,
      limit,
    });
  }

  listPromotionReady({ projectId, branch, limit = 20 }) {
    return listPromotionReadyEvidenceBoundProposals({
      db: this.#db,
      projectId,
      branch,
      limit,
    });
  }

  finalizePromotion({
    proposalId,
    status,
    claimId = null,
    relatedClaimId = null,
    policyVersion,
    finalizedAt = this.#clock(),
    result,
  }) {
    if (this.#readOnly) {
      throw new Error('evidence proposal store is read-only');
    }
    return finalizeEvidenceBoundProposalPromotion(this.#db, {
      proposalId,
      status,
      claimId,
      relatedClaimId,
      policyVersion,
      finalizedAt,
      result,
    });
  }

  listRelationPending({ projectId, branch, limit = 20 }) {
    return listRelationPendingEvidenceBoundProposals({
      db: this.#db,
      projectId,
      branch,
      limit,
    });
  }

  activeRelationClaims({ projectId, branch }) {
    return listActiveEvidenceRelationClaims(this.#db, { projectId, branch });
  }

  evaluateRelation({
    proposalId,
    evaluatorId,
    policyVersion,
    relation,
    relatedClaimId = null,
    evaluatedAt = this.#clock(),
  }) {
    if (this.#readOnly) {
      throw new Error('evidence proposal store is read-only');
    }
    return evaluateEvidenceBoundProposalRelation(this.#db, {
      proposalId,
      evaluatorId,
      policyVersion,
      relation,
      relatedClaimId,
      evaluatedAt,
    });
  }

  evidence(proposalId) {
    return getEvidenceBoundProposalEvidence(this.#db, proposalId);
  }

  listSupportPending({ projectId, branch, limit = 20 }) {
    return listSupportPendingEvidenceBoundProposals({
      db: this.#db,
      projectId,
      branch,
      limit,
    });
  }

  evaluateSupport({
    proposalId,
    evaluatorId,
    policyVersion,
    judgment,
    evaluatedAt = this.#clock(),
  }) {
    if (this.#readOnly) {
      throw new Error('evidence proposal store is read-only');
    }
    return evaluateEvidenceBoundProposalSupport(this.#db, {
      proposalId,
      evaluatorId,
      policyVersion,
      judgment,
      evaluatedAt,
    });
  }

  evaluateImportance({
    proposalId,
    evaluatorId,
    policyVersion,
    judgment,
    evaluatedAt = this.#clock(),
  }) {
    if (this.#readOnly) {
      throw new Error('evidence proposal store is read-only');
    }
    return evaluateEvidenceBoundProposal(this.#db, {
      proposalId,
      evaluatorId,
      policyVersion,
      judgment,
      evaluatedAt,
    });
  }

  record({
    id,
    projectId,
    branch,
    kind,
    canonicalFact,
    evidenceIds,
    fingerprint,
    policyVersion,
    evaluatorId,
    createdAt = this.#clock(),
  }) {
    if (this.#readOnly) {
      throw new Error('evidence proposal store is read-only');
    }
    return recordEvidenceBoundProposal(this.#db, {
      id,
      projectId,
      branch,
      kind,
      canonicalFact,
      evidenceIds,
      fingerprint,
      policyVersion,
      evaluatorId,
      createdAt,
      inspectTextSensitivity: this.#inspectTextSensitivity,
    });
  }

  recordEvidenceBoundProposal(args) {
    return this.record(args);
  }
}
