import { DatabaseSync } from 'node:sqlite';

import { assertAuthorityClass } from './authority.mjs';

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

export class MemoryEngine {
  #db;

  constructor({ dbPath }) {
    assertNonEmptyString(dbPath, 'dbPath');

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

      CREATE TABLE IF NOT EXISTS repository_path_state (
        project_id TEXT NOT NULL REFERENCES project_registry(project_id),
        branch TEXT NOT NULL,
        path TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        blob_oid TEXT,
        checked_at TEXT,
        PRIMARY KEY (project_id, branch, path)
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

  ingest({ evidence, claim, lifecycle = {} }) {
    if (!evidence || !claim) {
      throw new TypeError('ingest requires evidence and claim');
    }

    for (const [value, name] of [
      [evidence.id, 'evidence.id'],
      [evidence.projectId, 'evidence.projectId'],
      [evidence.sourceKind, 'evidence.sourceKind'],
      [evidence.capturedAt, 'evidence.capturedAt'],
      [evidence.authorityClass, 'evidence.authorityClass'],
      [claim.id, 'claim.id'],
      [claim.kind, 'claim.kind'],
      [claim.subject, 'claim.subject'],
      [claim.predicate, 'claim.predicate'],
      [claim.createdAt, 'claim.createdAt'],
    ]) {
      assertNonEmptyString(value, name);
    }

    if (!this.getProject(evidence.projectId)) {
      throw new Error(`unknown project: ${evidence.projectId}`);
    }
    assertAuthorityClass(evidence.authorityClass);

    const branchScope = claim.branchScope ?? evidence.branch;
    assertNonEmptyString(branchScope, 'claim.branchScope');

    const state = claim.state ?? 'active';
    if (!CLAIM_STATES.has(state)) {
      throw new Error(`unsupported claim state: ${state}`);
    }

    const redactedContent = redactString(String(evidence.content ?? ''));
    const redactedSource = redactString(evidence.sourceRef);
    const redactedMetadata = redactValue(evidence.metadata ?? {});
    const redactedClaim = redactString(String(claim.value ?? ''));

    const sensitivity = (
      redactedContent.redacted
      || redactedSource.redacted
      || redactedMetadata.redacted
      || redactedClaim.redacted
    ) ? 'secret_redacted' : (evidence.sensitivity ?? 'normal');

    const sanitizedEvidence = {
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
      sensitivity,
      authorityClass: evidence.authorityClass,
      metadataJson: JSON.stringify(redactedMetadata.value),
    };

    const sanitizedClaim = {
      id: claim.id,
      projectId: evidence.projectId,
      kind: claim.kind,
      subject: redactString(claim.subject).value,
      predicate: redactString(claim.predicate).value,
      value: redactedClaim.value,
      state,
      branchScope,
      createdFromEvidenceId: evidence.id,
      createdAt: claim.createdAt,
      validFrom: claim.validFrom ?? null,
      validUntil: claim.validUntil ?? null,
    };

    const supersedes = [...new Set(lifecycle.supersedes ?? [])];
    const rejects = [...new Set(lifecycle.rejects ?? [])];
    const conflictsWith = [...new Set(lifecycle.conflictsWith ?? [])];

    if (
      supersedes.includes(claim.id)
      || rejects.includes(claim.id)
      || conflictsWith.includes(claim.id)
    ) {
      throw new Error('a claim cannot transition itself');
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare(`
        INSERT INTO evidence (
          id, project_id, harness, session_id, source_kind, source_ref,
          captured_at, branch, commit_sha, path, blob_oid, content_redacted,
          sensitivity, authority_class, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sanitizedEvidence.id,
        sanitizedEvidence.projectId,
        sanitizedEvidence.harness,
        sanitizedEvidence.sessionId,
        sanitizedEvidence.sourceKind,
        sanitizedEvidence.sourceRef,
        sanitizedEvidence.capturedAt,
        sanitizedEvidence.branch,
        sanitizedEvidence.commitSha,
        sanitizedEvidence.path,
        sanitizedEvidence.blobOid,
        sanitizedEvidence.content,
        sanitizedEvidence.sensitivity,
        sanitizedEvidence.authorityClass,
        sanitizedEvidence.metadataJson,
      );

      this.#db.prepare(`
        INSERT INTO claims (
          id, project_id, kind, subject, predicate, value_text, state,
          branch_scope, created_from_evidence_id, created_at, valid_from,
          valid_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sanitizedClaim.id,
        sanitizedClaim.projectId,
        sanitizedClaim.kind,
        sanitizedClaim.subject,
        sanitizedClaim.predicate,
        sanitizedClaim.value,
        sanitizedClaim.state,
        sanitizedClaim.branchScope,
        sanitizedClaim.createdFromEvidenceId,
        sanitizedClaim.createdAt,
        sanitizedClaim.validFrom,
        sanitizedClaim.validUntil,
      );

      for (const targetId of supersedes) {
        const target = this.#db
          .prepare('SELECT project_id, state FROM claims WHERE id = ?')
          .get(targetId);
        if (!target) throw new Error(`cannot supersede unknown claim: ${targetId}`);
        if (target.project_id !== evidence.projectId) {
          throw new Error('lifecycle transitions cannot cross project boundaries');
        }
        if (target.state !== 'active') {
          throw new Error(`cannot supersede claim ${targetId} in state ${target.state}`);
        }

        this.#db.prepare(`
          UPDATE claims
          SET state = 'superseded', superseded_by_claim_id = ?
          WHERE id = ?
        `).run(claim.id, targetId);

        this.#db.prepare(`
          INSERT INTO lifecycle_events (
            project_id, action, source_claim_id, target_claim_id, evidence_id, created_at
          ) VALUES (?, 'supersede', ?, ?, ?, ?)
        `).run(evidence.projectId, claim.id, targetId, evidence.id, claim.createdAt);

        this.#db.prepare(`
          UPDATE conflicts
          SET state = 'resolved',
              resolved_by_evidence_id = ?,
              resolved_at = ?
          WHERE project_id = ?
            AND state = 'open'
            AND (claim_a = ? OR claim_b = ?)
        `).run(evidence.id, claim.createdAt, evidence.projectId, targetId, targetId);
      }

      for (const targetId of rejects) {
        const target = this.#db
          .prepare('SELECT project_id, state FROM claims WHERE id = ?')
          .get(targetId);
        if (!target) throw new Error(`cannot reject unknown claim: ${targetId}`);
        if (target.project_id !== evidence.projectId) {
          throw new Error('lifecycle transitions cannot cross project boundaries');
        }
        if (target.state !== 'active') {
          throw new Error(`cannot reject claim ${targetId} in state ${target.state}`);
        }

        this.#db.prepare(`
          UPDATE claims
          SET state = 'rejected', rejected_by_evidence_id = ?
          WHERE id = ?
        `).run(evidence.id, targetId);

        this.#db.prepare(`
          INSERT INTO lifecycle_events (
            project_id, action, source_claim_id, target_claim_id, evidence_id, created_at
          ) VALUES (?, 'reject', ?, ?, ?, ?)
        `).run(evidence.projectId, claim.id, targetId, evidence.id, claim.createdAt);

        this.#db.prepare(`
          UPDATE conflicts
          SET state = 'resolved',
              resolved_by_evidence_id = ?,
              resolved_at = ?
          WHERE project_id = ?
            AND state = 'open'
            AND (claim_a = ? OR claim_b = ?)
        `).run(evidence.id, claim.createdAt, evidence.projectId, targetId, targetId);
      }

      if (conflictsWith.length > 0 && state !== 'active') {
        throw new Error('only active claims can open conflicts');
      }

      for (const targetId of conflictsWith) {
        const target = this.#db
          .prepare('SELECT project_id, branch_scope, state FROM claims WHERE id = ?')
          .get(targetId);
        if (!target) throw new Error(`cannot conflict with unknown claim: ${targetId}`);
        if (target.project_id !== evidence.projectId) {
          throw new Error('conflict relations cannot cross project boundaries');
        }
        if (target.branch_scope !== branchScope) {
          throw new Error('conflict relations cannot cross branch boundaries');
        }
        if (target.state !== 'active') {
          throw new Error(`cannot conflict with claim ${targetId} in state ${target.state}`);
        }

        const [claimA, claimB] = [claim.id, targetId].sort();
        this.#db.prepare(`
          INSERT INTO conflicts (
            project_id, claim_a, claim_b, state, created_by_evidence_id, created_at
          ) VALUES (?, ?, ?, 'open', ?, ?)
          ON CONFLICT(project_id, claim_a, claim_b) DO NOTHING
        `).run(evidence.projectId, claimA, claimB, evidence.id, claim.createdAt);
      }

      this.#db.prepare(`
        INSERT INTO claim_fts (claim_id, project_id, branch_scope, text)
        VALUES (?, ?, ?, ?)
      `).run(
        claim.id,
        evidence.projectId,
        branchScope,
        searchableText(sanitizedClaim, sanitizedEvidence.content),
      );

      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }

    return {
      evidence: this.getEvidence(evidence.id),
      claim: this.getClaim(claim.id),
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
          AND (
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
          AND (
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
        ORDER BY c.created_at DESC, c.id ASC
        LIMIT ?
      `).all(projectId, branch, mode, revisionSha, revisionSha, limit);
    }

    const items = rows.map((row) => ({
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
    }));

    const ids = new Set(items.map((item) => item.claim.id));
    let currentEligibleIds = null;
    if (mode === 'current') {
      currentEligibleIds = new Set(this.#db.prepare(`
        SELECT c.id
        FROM claims c
        JOIN evidence e ON e.id = c.created_from_evidence_id
        LEFT JOIN repository_path_state rps
          ON rps.project_id = c.project_id
         AND rps.branch = c.branch_scope
         AND rps.path = e.path
        WHERE c.project_id = ?
          AND c.branch_scope = ?
          AND c.state = 'active'
          AND (
            e.path IS NULL
            OR (
              ? IS NOT NULL
              AND e.blob_oid IS NOT NULL
              AND rps.commit_sha = ?
              AND rps.blob_oid = e.blob_oid
            )
          )
      `).all(projectId, branch, revisionSha, revisionSha).map((row) => row.id));
    }

    const conflicts = this.#db.prepare(`
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
        && (ids.has(conflict.claim_a) || ids.has(conflict.claim_b))
      ),
    );

    return {
      project_id: projectId,
      branch,
      mode,
      items,
      conflicts,
    };
  }
}
