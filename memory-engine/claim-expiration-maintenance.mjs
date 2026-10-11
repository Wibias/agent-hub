import { DatabaseSync } from 'node:sqlite';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireTimestamp(value, name) {
  if (!nonEmptyString(value)) {
    throw new TypeError(name + ' must be a valid timestamp');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(name + ' is invalid');
  }
  return milliseconds;
}

function optionalTimestamp(value, name) {
  if (value === null || value === undefined) return null;
  return requireTimestamp(value, name);
}

export function expireDueClaims({
  dbPath,
  now = new Date().toISOString(),
  projectId = null,
  branch = null,
} = {}) {
  if (!nonEmptyString(dbPath)) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  if (projectId !== null && !nonEmptyString(projectId)) {
    throw new TypeError('projectId must be null or a non-empty string');
  }
  if (branch !== null && !nonEmptyString(branch)) {
    throw new TypeError('branch must be null or a non-empty string');
  }
  const nowMs = requireTimestamp(now, 'now');

  const db = new DatabaseSync(dbPath, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
    try {
      const conditions = ["state = 'active'"];
      const values = [];
      if (projectId !== null) {
        conditions.push('project_id = ?');
        values.push(projectId);
      }
      if (branch !== null) {
        conditions.push('branch_scope = ?');
        values.push(branch);
      }
      const rows = db.prepare(`
        SELECT id, valid_from, valid_until
        FROM claims
        WHERE ${conditions.join(' AND ')}
        ORDER BY id ASC
      `).all(...values);

      const due = [];
      for (const row of rows) {
        const validFromMs = optionalTimestamp(
          row.valid_from,
          'valid_from for claim ' + row.id,
        );
        const validUntilMs = optionalTimestamp(
          row.valid_until,
          'valid_until for claim ' + row.id,
        );
        if (
          validFromMs !== null
          && validUntilMs !== null
          && validUntilMs < validFromMs
        ) {
          throw new Error(
            'valid_until cannot be before valid_from for claim ' + row.id,
          );
        }
        if (validUntilMs !== null && nowMs >= validUntilMs) {
          due.push(row.id);
        }
      }

      const update = db.prepare(
        "UPDATE claims SET state = 'expired' WHERE id = ? AND state = 'active'",
      );
      const expired = [];
      for (const id of due) {
        const result = update.run(id);
        if (Number(result.changes) === 1) expired.push(id);
      }

      db.exec('COMMIT');
      return {
        evaluated: rows.length,
        expired: expired.length,
        claim_ids: expired,
      };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}
