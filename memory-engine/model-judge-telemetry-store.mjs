import { DatabaseSync } from 'node:sqlite';

const STATUSES = new Set(['success', 'failed']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(value, name) {
  if (!nonEmpty(value)) throw new TypeError(name + ' must be a non-empty string');
  return value.trim();
}

function timestamp(value, name) {
  const text = requireString(value, name);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new TypeError(name + ' must be a valid timestamp');
  return new Date(parsed).toISOString();
}

function nonNegativeInteger(value, name, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new TypeError(name + ' must be a non-negative integer');
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(name + ' must be a non-negative integer');
  }
  return value;
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    branch: row.branch,
    observed_at: row.observed_at,
    stage: row.stage,
    evaluator_id: row.evaluator_id,
    status: row.status,
    duration_ms: row.duration_ms,
    input_tokens: row.input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    cache_write_input_tokens: row.cache_write_input_tokens,
    output_tokens: row.output_tokens,
    reasoning_output_tokens: row.reasoning_output_tokens,
  };
}

function prepare(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('telemetry event must be an object');
  }
  const status = requireString(input.status, 'status');
  if (!STATUSES.has(status)) throw new TypeError('status must be success or failed');
  return {
    id: requireString(input.id, 'id'),
    projectId: requireString(input.projectId, 'projectId'),
    branch: requireString(input.branch, 'branch'),
    observedAt: timestamp(input.observedAt, 'observedAt'),
    stage: requireString(input.stage, 'stage'),
    evaluatorId: requireString(input.evaluatorId, 'evaluatorId'),
    status,
    durationMs: nonNegativeInteger(input.durationMs, 'durationMs'),
    inputTokens: nonNegativeInteger(input.inputTokens, 'inputTokens', { nullable: true }),
    cachedInputTokens: nonNegativeInteger(input.cachedInputTokens, 'cachedInputTokens', { nullable: true }),
    cacheWriteInputTokens: nonNegativeInteger(input.cacheWriteInputTokens, 'cacheWriteInputTokens', { nullable: true }),
    outputTokens: nonNegativeInteger(input.outputTokens, 'outputTokens', { nullable: true }),
    reasoningOutputTokens: nonNegativeInteger(input.reasoningOutputTokens, 'reasoningOutputTokens', { nullable: true }),
  };
}

function sameEvent(row, value) {
  return row.id === value.id
    && row.project_id === value.projectId
    && row.branch === value.branch
    && row.observed_at === value.observedAt
    && row.stage === value.stage
    && row.evaluator_id === value.evaluatorId
    && row.status === value.status
    && row.duration_ms === value.durationMs
    && row.input_tokens === value.inputTokens
    && row.cached_input_tokens === value.cachedInputTokens
    && row.cache_write_input_tokens === value.cacheWriteInputTokens
    && row.output_tokens === value.outputTokens
    && row.reasoning_output_tokens === value.reasoningOutputTokens;
}

export class ModelJudgeTelemetryStore {
  #db;
  #readOnly;

  constructor({ dbPath, readOnly = false } = {}) {
    if (!nonEmpty(dbPath)) throw new TypeError('dbPath must be a non-empty string');
    if (typeof readOnly !== 'boolean') throw new TypeError('readOnly must be a boolean');
    this.#readOnly = readOnly;
    this.#db = new DatabaseSync(dbPath, {
      readOnly,
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });
    if (!readOnly) this.#migrate();
  }

  #migrate() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS memory_model_judge_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        stage TEXT NOT NULL,
        evaluator_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success','failed')),
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
        cache_write_input_tokens INTEGER CHECK (cache_write_input_tokens IS NULL OR cache_write_input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        reasoning_output_tokens INTEGER CHECK (reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS memory_model_judge_runs_scope_time
        ON memory_model_judge_runs(project_id, branch, observed_at);
      CREATE INDEX IF NOT EXISTS memory_model_judge_runs_scope_stage
        ON memory_model_judge_runs(project_id, branch, stage);
    `);
  }

  close() {
    this.#db.close();
  }

  record(input) {
    if (this.#readOnly) throw new Error('telemetry store is read-only');
    const value = prepare(input);
    const existing = this.#db.prepare(
      'SELECT * FROM memory_model_judge_runs WHERE id = ?',
    ).get(value.id);
    if (existing) {
      if (!sameEvent(existing, value)) {
        throw new Error('model judge telemetry id collision: ' + value.id);
      }
      return normalizeRow(existing);
    }

    this.#db.prepare(`
      INSERT INTO memory_model_judge_runs (
        id, project_id, branch, observed_at, stage, evaluator_id, status,
        duration_ms, input_tokens, cached_input_tokens, cache_write_input_tokens,
        output_tokens, reasoning_output_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.projectId,
      value.branch,
      value.observedAt,
      value.stage,
      value.evaluatorId,
      value.status,
      value.durationMs,
      value.inputTokens,
      value.cachedInputTokens,
      value.cacheWriteInputTokens,
      value.outputTokens,
      value.reasoningOutputTokens,
    );
    return normalizeRow(this.#db.prepare(
      'SELECT * FROM memory_model_judge_runs WHERE id = ?',
    ).get(value.id));
  }

  list({ projectId, branch, limit = 100 } = {}) {
    requireString(projectId, 'projectId');
    requireString(branch, 'branch');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError('limit must be an integer between 1 and 1000');
    }
    const table = this.#db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='memory_model_judge_runs'",
    ).get();
    if (!table) return [];
    return this.#db.prepare(`
      SELECT * FROM memory_model_judge_runs
      WHERE project_id = ? AND branch = ?
      ORDER BY observed_at DESC, id ASC
      LIMIT ?
    `).all(projectId, branch, limit).map(normalizeRow);
  }

  summary({ projectId, branch } = {}) {
    requireString(projectId, 'projectId');
    requireString(branch, 'branch');
    const output = {
      calls: 0,
      failures: 0,
      duration_ms: 0,
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      by_stage: {},
    };
    const table = this.#db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='memory_model_judge_runs'",
    ).get();
    if (!table) return output;

    const totals = this.#db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failures,
        COALESCE(SUM(duration_ms), 0) AS duration_ms,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
        COALESCE(SUM(cache_write_input_tokens), 0) AS cache_write_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS reasoning_output_tokens
      FROM memory_model_judge_runs
      WHERE project_id = ? AND branch = ?
    `).get(projectId, branch);

    for (const key of [
      'calls',
      'failures',
      'duration_ms',
      'input_tokens',
      'cached_input_tokens',
      'cache_write_input_tokens',
      'output_tokens',
      'reasoning_output_tokens',
    ]) {
      output[key] = Number(totals?.[key] ?? 0);
    }

    const stages = this.#db.prepare(`
      SELECT
        stage,
        COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failures,
        COALESCE(SUM(duration_ms), 0) AS duration_ms
      FROM memory_model_judge_runs
      WHERE project_id = ? AND branch = ?
      GROUP BY stage
      ORDER BY stage ASC
    `).all(projectId, branch);

    for (const stage of stages) {
      output.by_stage[stage.stage] = {
        calls: Number(stage.calls),
        failures: Number(stage.failures),
        duration_ms: Number(stage.duration_ms),
      };
    }
    return output;
  }
}
