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

  exportMemory({ projectId = null } = {}) {
    if (projectId !== null) assertNonEmptyString(projectId, 'projectId');

    this.#db.exec('BEGIN');
    try {
      if (projectId !== null && !this.getProject(projectId)) {
        throw new Error(`unknown project: ${projectId}`);
      }

      const params = projectId === null ? [] : [projectId];
    const where = projectId === null ? '' : ' WHERE project_id = ?';

    const projects = this.#db.prepare(`
      SELECT project_id, canonical_remote, repo_identity, created_at
      FROM project_registry
      ${projectId === null ? '' : 'WHERE project_id = ?'}
      ORDER BY project_id
    `).all(...params).map((row) => ({
      project_id: row.project_id,
      canonical_remote: row.canonical_remote,
      repo_identity: row.repo_identity,
      created_at: row.created_at,
    }));

    const evidence = this.#db.prepare(`
      SELECT *
      FROM evidence${where}
      ORDER BY project_id, captured_at, id
    `).all(...params).map(normalizeEvidence);

    const claims = this.#db.prepare(`
      SELECT *
      FROM claims${where}
      ORDER BY project_id, created_at, id
    `).all(...params).map(normalizeClaim);

    const lifecycleEvents = this.#db.prepare(`
      SELECT id, project_id, action, source_claim_id, target_claim_id, evidence_id, created_at
      FROM lifecycle_events${where}
      ORDER BY project_id, id
    `).all(...params).map((row) => ({ ...row }));

    const conflicts = this.#db.prepare(`
      SELECT
        project_id,
        claim_a,
        claim_b,
        state,
        created_by_evidence_id,
        created_at,
        resolved_by_evidence_id,
        resolved_at
      FROM conflicts${where}
      ORDER BY project_id, claim_a, claim_b
    `).all(...params).map((row) => ({ ...row }));

    const approvals = this.#db.prepare(`
      SELECT *
      FROM approvals${where}
      ORDER BY project_id, issued_at, id
    `).all(...params).map(normalizeApproval);

      const portable = {
        format: 'agent-hub-memory-export',
        version: 1,
        exported_at: normalizeTimestamp(this.#clock(), 'clock()'),
        canonical: {
          projects,
          evidence,
          claims,
          lifecycle_events: lifecycleEvents,
          conflicts,
          approvals,
        },
      };
      this.#db.exec('COMMIT');
      return portable;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  importMemory(portable) {
    if (!portable || typeof portable !== 'object' || Array.isArray(portable)) {
      throw new TypeError('portable memory export must be an object');
    }
    if (portable.format !== 'agent-hub-memory-export' || portable.version !== 1) {
      throw new Error('unsupported portable memory export');
    }

    const canonical = portable.canonical;
    if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
      throw new TypeError('portable memory export canonical state is required');
    }

    const projects = canonical.projects ?? [];
    const evidence = canonical.evidence ?? [];
    const claims = canonical.claims ?? [];
    const lifecycleEvents = canonical.lifecycle_events ?? [];
    const conflicts = canonical.conflicts ?? [];
    const approvals = canonical.approvals ?? [];
    for (const [rows, name] of [
      [projects, 'projects'],
      [evidence, 'evidence'],
      [claims, 'claims'],
      [lifecycleEvents, 'lifecycle_events'],
      [conflicts, 'conflicts'],
      [approvals, 'approvals'],
    ]) {
      if (!Array.isArray(rows)) throw new TypeError(`canonical.${name} must be an array`);
    }

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const nonProjectRows = [
      ['evidence', 'evidence'],
      ['claims', 'claims'],
      ['lifecycle_events', 'lifecycle_events'],
      ['conflicts', 'conflicts'],
      ['approvals', 'approvals'],
    ];
    for (const [table, label] of nonProjectRows) {
      const count = this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
      if (count !== 0) {
        throw new Error(`cannot import into non-empty canonical table: ${label}`);
      }
    }

    const projectById = new Map();
    for (const project of projects) {
      assertNonEmptyString(project.project_id, 'project.project_id');
      if (projectById.has(project.project_id)) {
        throw new Error(`duplicate project in portable export: ${project.project_id}`);
      }
      projectById.set(project.project_id, project);

      const existing = this.#db.prepare(`
        SELECT canonical_remote, repo_identity
        FROM project_registry
        WHERE project_id = ?
      `).get(project.project_id);
      if (
        existing
        && project.canonical_remote !== null
        && existing.canonical_remote !== null
        && project.canonical_remote !== existing.canonical_remote
      ) {
        throw new Error(`project ${project.project_id} canonical remote conflicts with import`);
      }
      if (
        existing
        && project.repo_identity !== null
        && existing.repo_identity !== null
        && project.repo_identity !== existing.repo_identity
      ) {
        throw new Error(`project ${project.project_id} repository identity conflicts with import`);
      }
    }

    const existingProjects = this.#db.prepare(
      'SELECT project_id FROM project_registry ORDER BY project_id',
    ).all();
    for (const existing of existingProjects) {
      if (!projectById.has(existing.project_id)) {
        throw new Error(`fresh import contains unrelated existing project: ${existing.project_id}`);
      }
    }

    const evidenceById = new Map();
    for (const row of evidence) {
      assertNonEmptyString(row.id, 'evidence.id');
      assertNonEmptyString(row.project_id, 'evidence.project_id');
      if (!projectById.has(row.project_id)) {
        throw new Error(`evidence ${row.id} references unknown project`);
      }
      if (evidenceById.has(row.id)) throw new Error(`duplicate evidence in portable export: ${row.id}`);
      assertAuthorityClass(row.authority_class);

      const secretCheck = redactValue({
        source_ref: row.source_ref,
        content_redacted: row.content_redacted,
        metadata: row.metadata ?? {},
      });
      if (secretCheck.redacted) {
        throw new Error(`portable export contains unredacted secret in evidence ${row.id}`);
      }
      evidenceById.set(row.id, row);
    }

    const claimById = new Map();
    for (const row of claims) {
      assertNonEmptyString(row.id, 'claim.id');
      assertNonEmptyString(row.project_id, 'claim.project_id');
      if (!projectById.has(row.project_id)) throw new Error(`claim ${row.id} references unknown project`);
      if (claimById.has(row.id)) throw new Error(`duplicate claim in portable export: ${row.id}`);
      if (!CLAIM_STATES.has(row.state)) throw new Error(`unsupported claim state in import: ${row.state}`);

      const sourceEvidence = evidenceById.get(row.created_from_evidence_id);
      if (!sourceEvidence || sourceEvidence.project_id !== row.project_id) {
        throw new Error(`claim ${row.id} has invalid source evidence`);
      }

      const secretCheck = redactValue({
        subject: row.subject,
        predicate: row.predicate,
        value: row.value,
      });
      if (secretCheck.redacted) {
        throw new Error(`portable export contains unredacted secret in claim ${row.id}`);
      }
      claimById.set(row.id, row);
    }

    for (const row of claims) {
      if (row.superseded_by_claim_id !== null) {
        const target = claimById.get(row.superseded_by_claim_id);
        if (!target || target.project_id !== row.project_id) {
          throw new Error(`claim ${row.id} has invalid supersession reference`);
        }
      }
      if (row.rejected_by_evidence_id !== null) {
        const target = evidenceById.get(row.rejected_by_evidence_id);
        if (!target || target.project_id !== row.project_id) {
          throw new Error(`claim ${row.id} has invalid rejection evidence`);
        }
      }
    }

    for (const row of lifecycleEvents) {
      const source = claimById.get(row.source_claim_id);
      const target = claimById.get(row.target_claim_id);
      const sourceEvidence = evidenceById.get(row.evidence_id);
      if (
        !projectById.has(row.project_id)
        || !source
        || !target
        || !sourceEvidence
        || source.project_id !== row.project_id
        || target.project_id !== row.project_id
        || sourceEvidence.project_id !== row.project_id
      ) {
        throw new Error(`invalid lifecycle event in portable export: ${row.id}`);
      }
      if (!['supersede', 'reject'].includes(row.action)) {
        throw new Error(`unsupported lifecycle action in import: ${row.action}`);
      }
    }

    for (const row of conflicts) {
      const a = claimById.get(row.claim_a);
      const b = claimById.get(row.claim_b);
      const createdBy = evidenceById.get(row.created_by_evidence_id);
      const resolvedBy = row.resolved_by_evidence_id === null
        ? null
        : evidenceById.get(row.resolved_by_evidence_id);
      if (
        !projectById.has(row.project_id)
        || !a
        || !b
        || !createdBy
        || a.project_id !== row.project_id
        || b.project_id !== row.project_id
        || createdBy.project_id !== row.project_id
        || (row.resolved_by_evidence_id !== null && (!resolvedBy || resolvedBy.project_id !== row.project_id))
      ) {
        throw new Error(`invalid conflict in portable export: ${row.claim_a}/${row.claim_b}`);
      }
    }

    for (const row of approvals) {
      const sourceEvidence = evidenceById.get(row.source_evidence_id);
      if (
        !projectById.has(row.project_id)
        || !sourceEvidence
        || sourceEvidence.project_id !== row.project_id
        || sourceEvidence.authority_class !== 'user_direct'
        || row.actor !== sourceEvidence.source_ref
      ) {
        throw new Error(`invalid approval in portable export: ${row.id}`);
      }
      for (const [value, name] of [
        [row.id, 'approval.id'],
        [row.action, 'approval.action'],
        [row.target, 'approval.target'],
        [row.environment, 'approval.environment'],
      ]) {
        assertNonEmptyString(value, name);
      }
      if (row.artifact !== null) assertNonEmptyString(row.artifact, 'approval.artifact');
      const issuedAt = normalizeTimestamp(row.issued_at, 'approval.issued_at');
      const expiresAt = normalizeTimestamp(row.expires_at, 'approval.expires_at');
      if (expiresAt < issuedAt) throw new Error(`invalid approval validity window: ${row.id}`);
      if (!Number.isInteger(row.max_uses) || row.max_uses < 1) {
        throw new Error(`invalid approval max_uses: ${row.id}`);
      }
      if (!Number.isInteger(row.uses) || row.uses < 0 || row.uses > row.max_uses) {
        throw new Error(`invalid approval uses: ${row.id}`);
      }
      if (row.revoked_at !== null) {
        const revokedAt = normalizeTimestamp(row.revoked_at, 'approval.revoked_at');
        if (revokedAt < issuedAt) throw new Error(`invalid approval revocation time: ${row.id}`);
      }
      const secretCheck = redactValue({
        actor: row.actor,
        action: row.action,
        target: row.target,
        environment: row.environment,
        artifact: row.artifact,
        constraints: row.constraints ?? {},
      });
      if (secretCheck.redacted) {
        throw new Error(`portable export contains unredacted secret in approval ${row.id}`);
      }
    }

      this.#db.prepare('DELETE FROM claim_fts').run();
      this.#db.prepare('DELETE FROM repository_path_state').run();

      for (const row of projects) {
        this.#db.prepare(`
          INSERT INTO project_registry (
            project_id, canonical_remote, repo_identity, created_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            canonical_remote = excluded.canonical_remote,
            repo_identity = excluded.repo_identity,
            created_at = excluded.created_at
        `).run(
          row.project_id,
          row.canonical_remote ?? null,
          row.repo_identity ?? null,
          row.created_at,
        );
      }

      for (const row of evidence) {
        this.#db.prepare(`
          INSERT INTO evidence (
            id, project_id, harness, session_id, source_kind, source_ref,
            captured_at, branch, commit_sha, path, blob_oid, content_redacted,
            sensitivity, authority_class, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id,
          row.project_id,
          row.harness ?? null,
          row.session_id ?? null,
          row.source_kind,
          row.source_ref ?? null,
          row.captured_at,
          row.branch ?? null,
          row.commit_sha ?? null,
          row.path ?? null,
          row.blob_oid ?? null,
          row.content_redacted,
          row.sensitivity,
          row.authority_class,
          JSON.stringify(row.metadata ?? {}),
        );
      }

      for (const row of claims) {
        this.#db.prepare(`
          INSERT INTO claims (
            id, project_id, kind, subject, predicate, value_text, state,
            branch_scope, created_from_evidence_id, created_at, valid_from,
            valid_until, superseded_by_claim_id, rejected_by_evidence_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        `).run(
          row.id,
          row.project_id,
          row.kind,
          row.subject,
          row.predicate,
          row.value,
          row.state,
          row.branch_scope,
          row.created_from_evidence_id,
          row.created_at,
          row.valid_from ?? null,
          row.valid_until ?? null,
        );
      }

      for (const row of claims) {
        this.#db.prepare(`
          UPDATE claims
          SET superseded_by_claim_id = ?, rejected_by_evidence_id = ?
          WHERE id = ?
        `).run(
          row.superseded_by_claim_id ?? null,
          row.rejected_by_evidence_id ?? null,
          row.id,
        );
      }

      for (const row of lifecycleEvents) {
        this.#db.prepare(`
          INSERT INTO lifecycle_events (
            id, project_id, action, source_claim_id, target_claim_id, evidence_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id,
          row.project_id,
          row.action,
          row.source_claim_id,
          row.target_claim_id,
          row.evidence_id,
          row.created_at,
        );
      }

      for (const row of conflicts) {
        this.#db.prepare(`
          INSERT INTO conflicts (
            project_id, claim_a, claim_b, state, created_by_evidence_id,
            created_at, resolved_by_evidence_id, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.project_id,
          row.claim_a,
          row.claim_b,
          row.state,
          row.created_by_evidence_id,
          row.created_at,
          row.resolved_by_evidence_id ?? null,
          row.resolved_at ?? null,
        );
      }

      for (const row of approvals) {
        this.#db.prepare(`
          INSERT INTO approvals (
            id, project_id, actor, action, target, environment, artifact,
            constraints_json, issued_at, expires_at, max_uses, uses,
            revoked_at, source_evidence_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id,
          row.project_id,
          row.actor,
          row.action,
          row.target,
          row.environment,
          row.artifact ?? null,
          JSON.stringify(row.constraints ?? {}),
          row.issued_at,
          row.expires_at,
          row.max_uses,
          row.uses,
          row.revoked_at ?? null,
          row.source_evidence_id,
        );
      }

      for (const row of claims) {
        const sourceEvidence = evidenceById.get(row.created_from_evidence_id);
        this.#db.prepare(`
          INSERT INTO claim_fts (claim_id, project_id, branch_scope, text)
          VALUES (?, ?, ?, ?)
        `).run(
          row.id,
          row.project_id,
          row.branch_scope,
          searchableText({
            kind: row.kind,
            subject: row.subject,
            predicate: row.predicate,
            value: row.value,
          }, sourceEvidence.content_redacted),
        );
      }

      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }

    return {
      projects: projects.length,
      evidence: evidence.length,
      claims: claims.length,
      lifecycle_events: lifecycleEvents.length,
      conflicts: conflicts.length,
      approvals: approvals.length,
    };
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
