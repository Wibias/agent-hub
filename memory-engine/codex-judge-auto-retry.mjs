import { DatabaseSync } from 'node:sqlite';

/**
 * Opt-in from the automatically triggered Stop/SubagentStop worker only.
 * A short backoff avoids repeatedly paying for identical failing Codex calls.
 * No candidate is changed or approved. CLI-path failures are handled by a
 * separate fast prerequisite check and are not counted in this backoff.
 */
export function inspectAutomaticJudgeRetryBackoff({
  dbPath, projectId, branch, now = () => Date.now(),
  openDb = (path) => new DatabaseSync(path, { readOnly: true }),
} = {}) {
  if (![dbPath, projectId, branch].every(
    v => typeof v === 'string' && v.trim().length > 0,
  )) throw new TypeError('dbPath, projectId and branch are required');

  // SQL deliberately returns aggregate counts/timestamps only, never error
  // messages, command lines, paths, candidate values or model outputs.
  let db;
  try {
    db = openDb(dbPath);
    db.exec('PRAGMA query_only = ON');
    const earliest = new Date(now() - 15 * 60_000).toISOString();
    const counts = db.prepare(
      'SELECT '
      + "SUM(CASE WHEN instr(lower(error_text),'rate limit') > 0 "
      + "OR instr(lower(error_text),'too many requests') > 0 "
      + "OR instr(lower(error_text),'429') > 0 THEN 1 ELSE 0 END) as rate_errors, "
      + "SUM(CASE WHEN instr(lower(error_text),'unauthorized') > 0 "
      + "OR instr(lower(error_text),'not logged in') > 0 "
      + "OR instr(lower(error_text),'authentication failed') > 0 THEN 1 ELSE 0 END) as auth_errors, "
      + "SUM(CASE WHEN instr(lower(error_text),'spawn codex enoent') = 0 "
      + "AND instr(lower(error_text),'codeX_judge_cli_not_found') = 0 "
      + "THEN 1 ELSE 0 END) as other_errors, "
      + "MAX(occurred_at) as latest "
      + 'FROM memory_pipeline_failures '
      + "WHERE project_id = ? AND branch = ? AND stage = 'importance' "
      + "AND error_class = 'candidate_stage_failure' AND occurred_at >= ?",
    ).get(projectId, branch, earliest);
    const latest = Date.parse(counts?.latest);
    const age = Number.isFinite(latest) ? now() - latest : Infinity;
    // A rate-limiting signal is enough to pause automated requests.
    if (Number(counts?.rate_errors ?? 0) > 0 && age < 10 * 60_000) {
      return { deferred: true, reason: 'rate_limit_cooldown', minutes: 10 };
    }
    if (Number(counts?.auth_errors ?? 0) >= 2 && age < 10 * 60_000) {
      return { deferred: true, reason: 'auth_error_cooldown', minutes: 10 };
    }
    if (Number(counts?.other_errors ?? 0) >= 5 && age < 3 * 60_000) {
      return { deferred: true, reason: 'repeated_judge_failures_cooldown', minutes: 3 };
    }
    return { deferred: false, reason: null, minutes: 0 };
  } catch {
    // An unexpected schema issue must not bypass project authorization.
    // Report the diagnostic blockage rather than retrying a possibly broken DB.
    return { deferred: true, reason: 'retry_guard_unavailable', minutes: 0 };
  } finally {
    db?.close();
  }
}
