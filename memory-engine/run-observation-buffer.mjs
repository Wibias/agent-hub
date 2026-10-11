import { DatabaseSync } from 'node:sqlite';

const ELIGIBLE_AUTHORITIES = new Set([
  'user_direct',
  'repo_trusted',
  'tool_observation',
]);

export const RUN_OBSERVATION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS memory_run_observations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project_registry(project_id),
    branch TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    authority_class TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    content_redacted TEXT NOT NULL,
    metadata_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_run_observations_turn
  ON memory_run_observations (
    project_id, branch, session_id, turn_id, observed_at ASC, id ASC
  );

  CREATE INDEX IF NOT EXISTS memory_run_observations_time
  ON memory_run_observations (observed_at ASC, id ASC);
`;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(value, name) {
  if (!nonEmptyString(value)) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

function normalizeTimestamp(value, name) {
  const raw = requireString(value, name);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(name + ' must be a valid timestamp');
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

function normalizeMetadata(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('metadata must be an object');
  }
  return canonicalJson(value);
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    branch: row.branch,
    session_id: row.session_id,
    turn_id: row.turn_id,
    source_kind: row.source_kind,
    source_ref: row.source_ref,
    observed_at: row.observed_at,
    authority_class: row.authority_class,
    sensitivity: row.sensitivity,
    content_redacted: row.content_redacted,
    metadata: JSON.parse(row.metadata_json),
  };
}

function normalizeObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('observation must be an object');
  }
  const authorityClass = requireString(value.authorityClass, 'authorityClass');
  if (!ELIGIBLE_AUTHORITIES.has(authorityClass)) {
    throw new Error('run observation authority is not eligible');
  }
  const sensitivity = requireString(value.sensitivity, 'sensitivity');
  if (sensitivity === 'secret_redacted') {
    throw new Error('secret-redacted run observations are not retained');
  }

  return {
    id: requireString(value.id, 'id'),
    projectId: requireString(value.projectId, 'projectId'),
    branch: requireString(value.branch, 'branch'),
    sessionId: requireString(value.sessionId, 'sessionId'),
    turnId: requireString(value.turnId, 'turnId'),
    sourceKind: requireString(value.sourceKind, 'sourceKind'),
    sourceRef: requireString(value.sourceRef, 'sourceRef'),
    observedAt: normalizeTimestamp(value.observedAt, 'observedAt'),
    authorityClass,
    sensitivity,
    contentRedacted: requireString(value.contentRedacted, 'contentRedacted'),
    metadata: normalizeMetadata(value.metadata),
  };
}

function sameObservation(existing, value) {
  return (
    existing.id === value.id
    && existing.project_id === value.projectId
    && existing.branch === value.branch
    && existing.session_id === value.sessionId
    && existing.turn_id === value.turnId
    && existing.source_kind === value.sourceKind
    && existing.source_ref === value.sourceRef
    && existing.observed_at === value.observedAt
    && existing.authority_class === value.authorityClass
    && existing.sensitivity === value.sensitivity
    && existing.content_redacted === value.contentRedacted
    && JSON.stringify(existing.metadata) === JSON.stringify(value.metadata)
  );
}

export class RunObservationBuffer {
  #db;

  constructor({ dbPath, readOnly = false }) {
    requireString(dbPath, 'dbPath');
    if (typeof readOnly !== 'boolean') {
      throw new TypeError('readOnly must be a boolean');
    }
    this.#db = new DatabaseSync(dbPath, {
      readOnly,
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });
    if (!readOnly) {
      this.#db.exec(RUN_OBSERVATION_SCHEMA_SQL);
    }
  }

  close() {
    this.#db.close();
  }

  get(id) {
    requireString(id, 'id');
    return normalizeRow(
      this.#db.prepare('SELECT * FROM memory_run_observations WHERE id = ?').get(id),
    );
  }

  record(observation) {
    const value = normalizeObservation(observation);
    const existing = this.get(value.id);
    if (existing) {
      if (!sameObservation(existing, value)) {
        throw new Error('run observation id collision');
      }
      return existing;
    }

    this.#db.prepare(`
      INSERT INTO memory_run_observations (
        id, project_id, branch, session_id, turn_id,
        source_kind, source_ref, observed_at, authority_class,
        sensitivity, content_redacted, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.projectId,
      value.branch,
      value.sessionId,
      value.turnId,
      value.sourceKind,
      value.sourceRef,
      value.observedAt,
      value.authorityClass,
      value.sensitivity,
      value.contentRedacted,
      JSON.stringify(value.metadata),
    );
    return this.get(value.id);
  }

  listTurn({ projectId, branch, sessionId, turnId }) {
    for (const [value, name] of [
      [projectId, 'projectId'],
      [branch, 'branch'],
      [sessionId, 'sessionId'],
      [turnId, 'turnId'],
    ]) requireString(value, name);

    return this.#db.prepare(`
      SELECT *
      FROM memory_run_observations
      WHERE project_id = ?
        AND branch = ?
        AND session_id = ?
        AND turn_id = ?
      ORDER BY observed_at ASC, id ASC
    `).all(projectId, branch, sessionId, turnId).map(normalizeRow);
  }

  prune({ before }) {
    const normalized = normalizeTimestamp(before, 'before');
    const result = this.#db.prepare(
      'DELETE FROM memory_run_observations WHERE observed_at < ?',
    ).run(normalized);
    return Number(result.changes);
  }
}
