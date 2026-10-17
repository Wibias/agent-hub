import { DatabaseSync } from 'node:sqlite';

const ROUTES = new Set(['fast_v1', 'fast_v2', 'judge', 'legacy', 'shadow']);
const STATUSES = new Set(['success', 'failed']);
const SHADOW_STATUSES = new Set([
  'no_candidates',
  'fast_v1_match',
  'fast_v1_mismatch',
  'fast_v2_match',
  'fast_v2_mismatch',
  'fast_path_fallback',
  'fast_path_failed',
  'judge_unavailable',
]);

function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value.trim();
}

function timestamp(value, name) {
  const text = nonEmpty(value, name);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new TypeError(name + ' must be a valid timestamp');
  return new Date(parsed).toISOString();
}

function count(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(name + ' must be a non-negative integer');
  }
  return value;
}

function prepare(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('selector telemetry event must be an object');
  }
  const route = nonEmpty(input.route, 'route');
  if (!ROUTES.has(route)) throw new TypeError('route is not supported');
  const status = nonEmpty(input.status, 'status');
  if (
    (route === 'shadow' && !SHADOW_STATUSES.has(status))
    || (route !== 'shadow' && !STATUSES.has(status))
  ) {
    throw new TypeError('status must be success or failed, or a supported shadow status');
  }
  if (typeof input.judgeCalled !== 'boolean') throw new TypeError('judgeCalled must be boolean');
  return {
    id: nonEmpty(input.id, 'id'),
    projectId: nonEmpty(input.projectId, 'projectId'),
    branch: nonEmpty(input.branch, 'branch'),
    observedAt: timestamp(input.observedAt, 'observedAt'),
    route,
    status,
    localDurationMs: count(input.localDurationMs, 'localDurationMs'),
    totalDurationMs: count(input.totalDurationMs, 'totalDurationMs'),
    candidateCount: count(input.candidateCount, 'candidateCount'),
    selectedCount: count(input.selectedCount, 'selectedCount'),
    judgeCalled: input.judgeCalled,
  };
}

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    branch: row.branch,
    observed_at: row.observed_at,
    route: row.route,
    status: row.status,
    local_duration_ms: row.local_duration_ms,
    total_duration_ms: row.total_duration_ms,
    candidate_count: row.candidate_count,
    selected_count: row.selected_count,
    judge_called: row.judge_called === 1,
  };
}

export class RecallSelectorTelemetryStore {
  #db;

  constructor({ dbPath } = {}) {
    if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
      throw new TypeError('dbPath must be a non-empty string');
    }
    this.#db = new DatabaseSync(dbPath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS memory_recall_selector_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        route TEXT NOT NULL CHECK (route IN ('fast_v1','fast_v2','judge','legacy','shadow')),
        status TEXT NOT NULL CHECK (
          (route = 'shadow' AND status IN (
            'no_candidates',
            'fast_v1_match',
            'fast_v1_mismatch',
            'fast_v2_match',
            'fast_v2_mismatch',
            'fast_path_fallback',
            'fast_path_failed',
            'judge_unavailable'
          ))
          OR
          (route <> 'shadow' AND status IN ('success','failed'))
        ),
        local_duration_ms INTEGER NOT NULL CHECK (local_duration_ms >= 0),
        total_duration_ms INTEGER NOT NULL CHECK (total_duration_ms >= 0),
        candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
        selected_count INTEGER NOT NULL CHECK (selected_count >= 0),
        judge_called INTEGER NOT NULL CHECK (judge_called IN (0,1))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS memory_recall_selector_runs_scope_time
        ON memory_recall_selector_runs(project_id, branch, observed_at DESC);
      CREATE INDEX IF NOT EXISTS memory_recall_selector_runs_scope_route
        ON memory_recall_selector_runs(project_id, branch, route);
    `);
  }

  close() {
    this.#db.close();
  }

  get(id) {
    const value = nonEmpty(id, 'id');
    return normalize(this.#db.prepare(
      'SELECT * FROM memory_recall_selector_runs WHERE id = ?',
    ).get(value));
  }

  record(input) {
    const value = prepare(input);
    const existing = this.#db.prepare(
      'SELECT * FROM memory_recall_selector_runs WHERE id = ?',
    ).get(value.id);
    if (existing) return normalize(existing);
    this.#db.prepare(`
      INSERT INTO memory_recall_selector_runs (
        id, project_id, branch, observed_at, route, status,
        local_duration_ms, total_duration_ms, candidate_count,
        selected_count, judge_called
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.projectId,
      value.branch,
      value.observedAt,
      value.route,
      value.status,
      value.localDurationMs,
      value.totalDurationMs,
      value.candidateCount,
      value.selectedCount,
      value.judgeCalled ? 1 : 0,
    );
    return normalize(this.#db.prepare(
      'SELECT * FROM memory_recall_selector_runs WHERE id = ?',
    ).get(value.id));
  }

  list({ projectId, branch, limit = 100 } = {}) {
    const project = nonEmpty(projectId, 'projectId');
    const scopedBranch = nonEmpty(branch, 'branch');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError('limit must be an integer between 1 and 1000');
    }
    return this.#db.prepare(`
      SELECT * FROM memory_recall_selector_runs
      WHERE project_id = ? AND branch = ?
      ORDER BY observed_at DESC, id ASC
      LIMIT ?
    `).all(project, scopedBranch, limit).map(normalize);
  }

  summary({ projectId, branch } = {}) {
    const project = nonEmpty(projectId, 'projectId');
    const scopedBranch = nonEmpty(branch, 'branch');
    const rows = this.#db.prepare(`
      SELECT route, COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failures,
        COALESCE(SUM(local_duration_ms), 0) AS local_duration_ms,
        COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms,
        COALESCE(SUM(CASE WHEN judge_called = 1 THEN 1 ELSE 0 END), 0) AS judge_calls
      FROM memory_recall_selector_runs
      WHERE project_id = ? AND branch = ?
      GROUP BY route
      ORDER BY route ASC
    `).all(project, scopedBranch);
    const output = { calls: 0, failures: 0, judge_calls: 0, local_duration_ms: 0, total_duration_ms: 0, by_route: {} };
    for (const row of rows) {
      const bucket = {
        calls: Number(row.calls),
        failures: Number(row.failures),
        judge_calls: Number(row.judge_calls),
        local_duration_ms: Number(row.local_duration_ms),
        total_duration_ms: Number(row.total_duration_ms),
      };
      output.by_route[row.route] = bucket;
      output.calls += bucket.calls;
      output.failures += bucket.failures;
      output.judge_calls += bucket.judge_calls;
      output.local_duration_ms += bucket.local_duration_ms;
      output.total_duration_ms += bucket.total_duration_ms;
    }
    return output;
  }
}
