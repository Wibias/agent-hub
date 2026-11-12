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
    // A recurring 5-hour/weekly usage-window refusal is not a short
    // requests-per-minute burst. Keep this quota check separate from 429s
    // and suppress repeated automatic Judge requests for the entire window.
    const quotaPredicate = [
      "instr(lower(error_text),'hit your usage limit') > 0",
      "instr(lower(error_text),'reached your usage limit') > 0",
      "instr(lower(error_text),'usage_limit_reached') > 0",
      "instr(lower(error_text),'quota exceeded') > 0",
      "instr(lower(error_text),'insufficient_quota') > 0",
      "instr(lower(error_text),'out of credits') > 0",
      "instr(lower(error_text),'spend cap') > 0",
    ].join(' OR ');
    const counts = db.prepare(
      'SELECT '
      + 'MAX(CASE WHEN (' + quotaPredicate
      + ') THEN occurred_at ELSE NULL END) AS latest_quota, '
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
    const quotaAt = Date.parse(counts?.latest_quota);
    const quotaAge = Number.isFinite(quotaAt) ? now() - quotaAt : Infinity;
    if (quotaAge >= 0 && quotaAge < 15 * 60_000) {
      return { deferred: true, reason: 'usage_or_quota_cooldown', minutes: 15 };
    }
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
