/**
 * D1b: advisory, derived semantic relations. Not canonical Evidence, lifecycle,
 * user authority or a Recall source. Sidecars are integrity-checked transport,
 * not trusted evidence or an authorization mechanism.
 */
import { createHash } from 'node:crypto';
import {
  validateClaimRelationProposal, relationClaimEvidenceAuthority,
  RELATION_AUTHORITY_CLASSES, typedRelationKey,
} from './claim-relations.mjs';

const AUTHORITY_SQL = RELATION_AUTHORITY_CLASSES.map((name) => `'${name}'`).join(', ');
const SIDECAR_FORMAT = 'agent-hub-typed-relations-sidecar';
const SIDECAR_VERSION = 2;
const REDACTED_SECRET = '[REDACTED_SECRET]';
// Match the MemoryEngine's canonical redactString secret patterns. This
// derived ledger is independently writable and must redact at its boundary.
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi,
  /\btoken\s*[:=]\s*["']?[A-Za-z0-9._~+/=_-]{16,}["']?/gi,
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS claim_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project_registry(project_id),
  branch_scope TEXT NOT NULL,
  source_claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  target_claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('supports','depends_on','implements','related_to')),
  origin TEXT NOT NULL CHECK (origin = 'inferred'),
  confidence TEXT NOT NULL CHECK (confidence = 'high'),
  reason TEXT NOT NULL,
  source_evidence_id TEXT NOT NULL REFERENCES evidence(id),
  target_evidence_id TEXT NOT NULL REFERENCES evidence(id),
  evaluator_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  CHECK (source_claim_id <> target_claim_id),
  CHECK (relation <> 'related_to' OR source_claim_id < target_claim_id)
) STRICT;
CREATE INDEX IF NOT EXISTS claim_relations_scope
  ON claim_relations (project_id, branch_scope, relation, source_claim_id, target_claim_id);
`;

function nonEmpty(value, label, limit = 512) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
    throw new TypeError(`${label} must be non-empty text of at most ${limit} characters`);
  }
  return value.trim();
}

function timestamp(value, name) {
  const normalized = nonEmpty(value, name, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date`);
  return normalized;
}

function redactSecrets(text) {
  let result = text;
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, REDACTED_SECRET);
  return result;
}

function safeMetadata(value, label) {
  const text = nonEmpty(value, label);
  if (redactSecrets(text) !== text || /[\x00-\x1f\x7f]/u.test(text)) {
    throw new Error(`${label} cannot contain sensitive or control text`);
  }
  return text;
}

function exists(db) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='claim_relations'",
  ).get());
}

function normalize(row) {
  if (!row) return null;
  return { ...row, advisory: true, directed: row.relation !== 'related_to' };
}

function withSavepoint(db, name, callback) {
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = callback();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

/** Idempotent additive migration, safe even inside MemoryEngine's constructor transaction. */
export function ensureTypedRelationSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('SQLite DatabaseSync is required');
  return withSavepoint(db, 'd1b_schema', () => {
    db.exec(SCHEMA);
    const columns = new Set(db.prepare('PRAGMA table_info(claim_relations)').all().map((row) => row.name));
    if (!columns.has('validated_at')) {
      db.exec('ALTER TABLE claim_relations ADD COLUMN validated_at TEXT');
    }
    db.exec('UPDATE claim_relations SET validated_at = created_at WHERE validated_at IS NULL');
    // Retire secrets from any pre-v6 derived rows during migration.
    for (const row of db.prepare('SELECT id, reason FROM claim_relations').all()) {
      const safe = redactSecrets(row.reason);
      if (safe !== row.reason) {
        db.prepare('UPDATE claim_relations SET reason = ? WHERE id = ?').run(safe, row.id);
      }
    }
  });
}

/**
 * Save only a valid high-confidence proposal. Revalidation updates mutable
 * provenance/policy fields, without changing original creation time. Identical
 * proposals are a true no-op, including validated_at.
 */
export function saveTypedRelation(db, proposal, {
  evaluatorId,
  policyVersion,
  at = new Date().toISOString(),
  originalCreatedAt = null, // Used only by checked sidecar restore.
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('SQLite DatabaseSync is required');
  const evaluator = safeMetadata(evaluatorId, 'evaluatorId');
  const policy = safeMetadata(policyVersion, 'policyVersion');
  const validated = timestamp(at, 'at');
  const created = originalCreatedAt === null ? validated : timestamp(originalCreatedAt, 'originalCreatedAt');
  if (Date.parse(created) > Date.parse(validated)) throw new Error('created_at cannot follow validation');
  if (!exists(db)) throw new Error('claim_relations schema not initialized');

  return withSavepoint(db, 'd1b_save', () => {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
      throw new TypeError('proposal is required');
    }
    const source = db.prepare('SELECT * FROM claims WHERE id = ?').get(proposal.sourceClaimId);
    const target = db.prepare('SELECT * FROM claims WHERE id = ?').get(proposal.targetClaimId);
    const relation = validateClaimRelationProposal({ claims: [source, target] }, proposal);
    const evidenceIds = [];
    for (const claim of [source, target]) {
      const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?')
        .get(claim.created_from_evidence_id);
      if (!evidence || evidence.project_id !== relation.project_id
          || evidence.branch !== relation.branch_scope) {
        throw new Error('semantic relation requires scoped primary evidence');
      }
      relationClaimEvidenceAuthority(claim, evidence);
      for (const [value, label] of [[claim.valid_from, 'valid_from'], [claim.valid_until, 'valid_until']]) {
        if (value !== null && value !== undefined && !Number.isFinite(Date.parse(value))) {
          throw new Error(`invalid temporal bound: ${label}`);
        }
      }
      const from = claim.valid_from == null ? null : Date.parse(claim.valid_from);
      const until = claim.valid_until == null ? null : Date.parse(claim.valid_until);
      const now = Date.parse(validated);
      if ((from !== null && now < from) || (until !== null && now >= until)
          || (from !== null && until !== null && from >= until)) {
        throw new Error('semantic relation requires temporally current claims');
      }
      evidenceIds.push(evidence.id);
    }
    const reason = redactSecrets(relation.reason);
    const flipped = relation.source_claim_id !== source.id;
    const evidenceA = evidenceIds[flipped ? 1 : 0];
    const evidenceB = evidenceIds[flipped ? 0 : 1];
    db.prepare(`
      INSERT INTO claim_relations (
        id, project_id, branch_scope, source_claim_id, target_claim_id,
        relation, origin, confidence, reason, source_evidence_id,
        target_evidence_id, evaluator_id, policy_version, created_at, validated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        reason = excluded.reason,
        source_evidence_id = excluded.source_evidence_id,
        target_evidence_id = excluded.target_evidence_id,
        evaluator_id = excluded.evaluator_id,
        policy_version = excluded.policy_version,
        validated_at = excluded.validated_at
      WHERE claim_relations.reason <> excluded.reason
        OR claim_relations.source_evidence_id <> excluded.source_evidence_id
        OR claim_relations.target_evidence_id <> excluded.target_evidence_id
        OR claim_relations.evaluator_id <> excluded.evaluator_id
        OR claim_relations.policy_version <> excluded.policy_version
    `).run(
      relation.key, relation.project_id, relation.branch_scope,
      relation.source_claim_id, relation.target_claim_id,
      relation.relation, relation.origin, relation.confidence, reason,
      evidenceA, evidenceB, evaluator, policy, created, validated,
    );
    return normalize(db.prepare('SELECT * FROM claim_relations WHERE id = ?').get(relation.key));
  });
}

/** Legacy read-only DBs without the optional table remain supported. */
export function listTypedRelations(db, {
  projectId,
  branch,
  activeOnly = true,
  at = new Date().toISOString(),
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('SQLite DatabaseSync is required');
  const project = nonEmpty(projectId, 'projectId');
  const scopedBranch = nonEmpty(branch, 'branch');
  if (typeof activeOnly !== 'boolean') throw new TypeError('activeOnly must be boolean');
  const current = timestamp(at, 'at');
  if (!exists(db)) return [];
  return db.prepare(`
    SELECT r.* FROM claim_relations r
    JOIN claims source ON source.id = r.source_claim_id
    JOIN claims target ON target.id = r.target_claim_id
    JOIN evidence se ON se.id = r.source_evidence_id
    JOIN evidence te ON te.id = r.target_evidence_id
    WHERE r.project_id = ? AND r.branch_scope = ?
      AND source.project_id = r.project_id AND target.project_id = r.project_id
      AND source.branch_scope = r.branch_scope AND target.branch_scope = r.branch_scope
      AND se.project_id = r.project_id AND te.project_id = r.project_id
      AND se.id = source.created_from_evidence_id
      AND te.id = target.created_from_evidence_id
      AND se.branch = r.branch_scope AND te.branch = r.branch_scope
      AND se.authority_class IN (${AUTHORITY_SQL})
      AND te.authority_class IN (${AUTHORITY_SQL})
      AND (source.kind NOT IN (${AUTHORITY_SQL}) OR se.authority_class = source.kind)
      AND (target.kind NOT IN (${AUTHORITY_SQL}) OR te.authority_class = target.kind)
      AND (
        ? = 0 OR (
          source.state = 'active' AND target.state = 'active'
          AND (source.valid_from IS NULL OR julianday(source.valid_from) <= julianday(?))
          AND (target.valid_from IS NULL OR julianday(target.valid_from) <= julianday(?))
          AND (source.valid_until IS NULL OR julianday(source.valid_until) > julianday(?))
          AND (target.valid_until IS NULL OR julianday(target.valid_until) > julianday(?))
        )
      )
    ORDER BY r.relation, r.source_claim_id, r.target_claim_id, r.id
  `).all(project, scopedBranch, Number(activeOnly), current, current, current, current).map(normalize);
}

const RELATION_FIELDS = Object.freeze([
  'id', 'source_claim_id', 'target_claim_id', 'relation', 'origin', 'confidence',
  'reason', 'source_evidence_id', 'target_evidence_id',
  'evaluator_id', 'policy_version', 'created_at', 'validated_at',
  'source_content_sha256', 'target_content_sha256',
]);

/**
 * Bind an advisory edge to the canonical content it was evaluated against.
 * This is a content-identity check, not a signature or authorization proof.
 * Hashes may reveal low-entropy source content to dictionary attacks; keep
 * sidecars private, like the source memory and inference reasons.
 */
function canonicalContentFingerprint(db, claimId, evidenceId) {
  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
  const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidenceId);
  if (!claim || !evidence || claim.created_from_evidence_id !== evidence.id) {
    throw new Error('sidecar canonical content or primary evidence missing');
  }
  const nullable = (value) => value ?? null;
  return digest({
    claim: {
      id: claim.id,
      project_id: claim.project_id,
      branch_scope: claim.branch_scope,
      kind: claim.kind,
      subject: nullable(claim.subject),
      predicate: nullable(claim.predicate),
      value_text: nullable(claim.value_text),
      state: claim.state,
      created_at: nullable(claim.created_at),
      valid_from: nullable(claim.valid_from),
      valid_until: nullable(claim.valid_until),
      primary_evidence_id: claim.created_from_evidence_id,
    },
    evidence: {
      id: evidence.id,
      project_id: evidence.project_id,
      branch: evidence.branch,
      authority_class: evidence.authority_class,
      source_kind: nullable(evidence.source_kind),
      content_redacted: nullable(evidence.content_redacted),
      captured_at: nullable(evidence.captured_at),
      source_ref: nullable(evidence.source_ref),
      commit_sha: nullable(evidence.commit_sha),
      path: nullable(evidence.path),
      blob_oid: nullable(evidence.blob_oid),
      metadata_json: nullable(evidence.metadata_json),
    },
  });
}

function snapshotFields(db, row) {
  return {
    ...Object.fromEntries(RELATION_FIELDS.filter((field) => !field.endsWith('_content_sha256'))
      .map((field) => [field, row[field]])),
    source_content_sha256: canonicalContentFingerprint(db, row.source_claim_id, row.source_evidence_id),
    target_content_sha256: canonicalContentFingerprint(db, row.target_claim_id, row.target_evidence_id),
  };
}

function snapshotCore({ projectId, branch, relations }) {
  return {
    format: SIDECAR_FORMAT,
    version: SIDECAR_VERSION,
    project_id: projectId,
    branch_scope: branch,
    relations,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(core) {
  return createHash('sha256').update(stableJson(core), 'utf8').digest('hex');
}

/**
 * Deterministic, versioned *derived-only* export. Excludes historical/stale
 * edges. A SHA-256 digest detects accidental corruption, NOT forged authorship.
 * This does not change MemoryEngine.exportCanonical() format v1.
 */
export function exportTypedRelationSidecar(db, {
  projectId,
  branch,
  at = new Date().toISOString(),
} = {}) {
  const project = nonEmpty(projectId, 'projectId');
  const scopedBranch = nonEmpty(branch, 'branch');
  const current = timestamp(at, 'at');
  const relations = listTypedRelations(db, { projectId: project, branch: scopedBranch, at: current })
    .map((row) => snapshotFields(db, row)).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const core = snapshotCore({ projectId: project, branch: scopedBranch, relations });
  return { ...core, digest_sha256: digest(core) };
}

function exactKeys(row, expected, label) {
  if (!row || Array.isArray(row) || typeof row !== 'object') throw new TypeError(`${label} must be an object`);
  const found = Object.keys(row).sort();
  if (JSON.stringify(found) !== JSON.stringify([...expected].sort())) {
    throw new Error(`unexpected ${label} fields`);
  }
}

/**
 * Explicit rebuild into an EMPTY derived scope. Never alters canonical rows.
 * All existing claim, authority, time and evidence checks are repeated, and
 * the whole import rolls back if any row fails. Does not run the model.
 */
export function importTypedRelationSidecar(db, payload, {
  projectId,
  branch,
  at = new Date().toISOString(),
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('SQLite DatabaseSync is required');
  const project = nonEmpty(projectId, 'projectId');
  const scopedBranch = nonEmpty(branch, 'branch');
  const current = timestamp(at, 'at');
  exactKeys(payload, [...Object.keys(snapshotCore({ projectId: '', branch: '', relations: [] })), 'digest_sha256'], 'sidecar');
  if (payload.format !== SIDECAR_FORMAT || payload.version !== SIDECAR_VERSION) {
    throw new Error('unsupported sidecar format or version');
  }
  if (payload.project_id !== project || payload.branch_scope !== scopedBranch) {
    throw new Error('sidecar scope mismatch');
  }
  if (!Array.isArray(payload.relations) || payload.relations.length > 10000) {
    throw new RangeError('sidecar relations must be an array of at most 10000 items');
  }
  if (typeof payload.digest_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(payload.digest_sha256)) {
    throw new Error('invalid sidecar digest');
  }
  const core = snapshotCore({ projectId: project, branch: scopedBranch, relations: payload.relations });
  if (digest(core) !== payload.digest_sha256) throw new Error('sidecar integrity digest mismatch');
  const validated = [];
  const ids = new Set();
  for (const raw of payload.relations) {
    exactKeys(raw, RELATION_FIELDS, 'sidecar relation');
    const proposal = {
      projectId: project, branch: scopedBranch,
      sourceClaimId: raw.source_claim_id, targetClaimId: raw.target_claim_id,
      relation: raw.relation, confidence: raw.confidence, reason: raw.reason,
    };
    if (raw.id !== typedRelationKey(proposal) || raw.origin !== 'inferred') {
      throw new Error('invalid sidecar relation identity or origin');
    }
    if (redactSecrets(raw.reason) !== raw.reason) throw new Error('sidecar reason contains a secret');
    for (const fingerprint of [raw.source_content_sha256, raw.target_content_sha256]) {
      if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) {
        throw new Error('invalid sidecar canonical content fingerprint');
      }
    }
    if (ids.has(raw.id)) throw new Error('duplicate sidecar relation');
    ids.add(raw.id);
    timestamp(raw.created_at, 'created_at');
    timestamp(raw.validated_at, 'validated_at');
    if (Date.parse(raw.created_at) > Date.parse(raw.validated_at)
        || Date.parse(raw.validated_at) > Date.parse(current)) {
      throw new Error('invalid or future sidecar audit timestamps');
    }
    validated.push({ raw, proposal });
  }

  return withSavepoint(db, 'd1b_import', () => {
    ensureTypedRelationSchema(db);
    const existing = db.prepare('SELECT count(*) AS n FROM claim_relations WHERE project_id = ? AND branch_scope = ?')
      .get(project, scopedBranch).n;
    if (existing !== 0) throw new Error('sidecar rebuild requires an empty derived relation scope');
    for (const { raw, proposal } of validated) {
      const actualA = db.prepare('SELECT created_from_evidence_id FROM claims WHERE id = ?').get(raw.source_claim_id);
      const actualB = db.prepare('SELECT created_from_evidence_id FROM claims WHERE id = ?').get(raw.target_claim_id);
      if (actualA?.created_from_evidence_id !== raw.source_evidence_id
          || actualB?.created_from_evidence_id !== raw.target_evidence_id) {
        throw new Error('sidecar provenance no longer matches canonical evidence');
      }
      if (canonicalContentFingerprint(db, raw.source_claim_id, raw.source_evidence_id)
          !== raw.source_content_sha256
          || canonicalContentFingerprint(db, raw.target_claim_id, raw.target_evidence_id)
          !== raw.target_content_sha256) {
        throw new Error('sidecar canonical content changed since relation evaluation');
      }
      const restored = saveTypedRelation(db, proposal, {
        evaluatorId: raw.evaluator_id,
        policyVersion: raw.policy_version,
        at: current,
        originalCreatedAt: raw.created_at,
      });
      if (restored.id !== raw.id) throw new Error('sidecar identity changed during rebuild');
      // Restore the original inference audit time, NOT the moment this sidecar
      // was rebuilt. Current eligibility has already been checked by saveTypedRelation.
      db.prepare('UPDATE claim_relations SET validated_at = ? WHERE id = ?')
        .run(raw.validated_at, raw.id);
    }
    return { imported: validated.length, format: SIDECAR_FORMAT, version: SIDECAR_VERSION };
  });
}
