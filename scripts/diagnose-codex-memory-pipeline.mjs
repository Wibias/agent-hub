#!/usr/bin/env node
/**
 * Read-only local diagnosis for the existing canonical Codex Memory pipeline.
 *
 * Does not query any claim value, evidence content, transcripts, secrets, or
 * model context. Does not call an LLM, install hooks, refresh Git freshness,
 * create projects/candidates, or change SQLite or Codex configuration.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { resolveCodexJudgeExecutable } from '../memory-engine/codex-judge-executable.mjs';
import {
  defaultGlobalMemoryScopePath,
  describeGlobalMemoryProject,
  loadGlobalMemoryScope,
} from '../memory-engine/adapters/codex-global-memory-scope.mjs';
import { inspectAgentHubHookConfiguration } from '../memory-engine/codex-state-audit.mjs';

function count(db, sql, params = []) {
  return Number(db.prepare(sql).get(...params)?.n ?? 0);
}

function grouped(db, sql, params = []) {
  return Object.fromEntries(
    db.prepare(sql).all(...params)
      .map((row) => [String(row.label), Number(row.n)])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

function safeCodeLabel(value) {
  // Stage/error *codes* only. Never forward arbitrary error text or message.
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
    ? value : 'other_code';
}

function groupedFailureCodes(db, projectId, branch) {
  const rows = db.prepare(
    'SELECT stage, error_class, COUNT(*) n FROM memory_pipeline_failures '
    + 'WHERE project_id = ? AND branch = ? '
    + 'GROUP BY stage, error_class ORDER BY n DESC LIMIT 100',
  ).all(projectId, branch);
  const stages = {};
  const classes = {};
  for (const row of rows) {
    const stage = safeCodeLabel(row.stage);
    const errorClass = safeCodeLabel(row.error_class);
    stages[stage] = (stages[stage] ?? 0) + Number(row.n);
    classes[errorClass] = (classes[errorClass] ?? 0) + Number(row.n);
  }
  return {
    by_stage: Object.fromEntries(Object.entries(stages).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    by_error_class: Object.fromEntries(Object.entries(classes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  };
}

function importanceFailureSignatures(db, projectId, branch) {
  // Classification runs wholly inside SQLite. Node never retrieves raw
  // error_text, stderr, model output, or candidate details.
  //
  // These are diagnostic *patterns*, not proof of the underlying root cause.
  const pattern = (value) => "instr(lower(error_text), '" + value + "') > 0";
  const entries = [
    ["auth_file_missing", pattern('candidate judge requires an authenticated codex home')],
    ["codex_executable_not_found", pattern('spawn codex enoent')],
    ["codex_spawn_permission_denied", pattern('spawn codex eacces') + ' OR ' + pattern('spawn codex eperm')],
    ["isolated_git_init_failed", pattern('failed to initialize isolated judge workspace')],
    ["judge_timeout", pattern('timed out after')],
    ["auth_rejection_possible", pattern('not logged in') + ' OR ' + pattern('unauthorized') + ' OR ' + pattern('authentication failed')],
    ["rate_limited_possible", pattern('rate limit') + ' OR ' + pattern('too many requests') + ' OR ' + pattern('429')],
    ["quota_exceeded_possible", pattern('quota exceeded') + ' OR ' + pattern('insufficient quota')],
    ["judge_json_missing", pattern('judgment response must be non-empty json')],
    ["judge_json_invalid", pattern('judgment response must be json')],
    ["judge_schema_invalid", pattern('missing field in memory candidate judgment')
      + ' OR ' + pattern('unexpected field in memory candidate judgment')
      + ' OR ' + pattern('must be one of:')],
    ["judge_policy_invariant_failed", pattern('promote requires')
      + ' OR ' + pattern('ignore requires')],
    ["codex_exec_nonzero", pattern('codex candidate judge failed with exit')],
  ];
  const sql = [
    'SELECT CASE',
    ...entries.map(([label, test]) => "WHEN (" + test + ") THEN '" + label + "'"),
    "ELSE 'unclassified' END AS signature,",
    'COUNT(*) AS n FROM memory_pipeline_failures',
    "WHERE project_id = ? AND branch = ? AND stage = 'importance'",
    "AND error_class = 'candidate_stage_failure'",
    'GROUP BY signature ORDER BY n DESC, signature ASC',
  ].join(' ');
  return Object.fromEntries(
    db.prepare(sql).all(projectId, branch)
      .map((row) => [row.signature, Number(row.n)]),
  );
}

/**
 * Diagnose optional semantic indexing using aggregate SQL codes only.
 * Never select error_text, which can contain OS paths or provider output.
 */
function semanticSyncFailureSignatures(db, projectId, branch) {
  const entries = [
    ['embedding_worker_unavailable', "instr(lower(error_text), 'embedding worker unavailable') > 0"],
    ['embedding_worker_model_mismatch', "instr(lower(error_text), 'embedding worker model identity mismatch') > 0"],
    ['embedding_worker_request_failed', "instr(lower(error_text), 'embedding worker request failed') > 0"],
    ['embedding_worker_invalid_response', "instr(lower(error_text), 'embedding worker returned an invalid') > 0"],
    ['embedding_worker_readiness_failed', "instr(lower(error_text), 'embedding worker readiness failed') > 0"],
    ['embedding_permission_denied', "instr(lower(error_text), 'eacces') > 0 OR instr(lower(error_text), 'eperm') > 0 OR instr(lower(error_text), 'permission denied') > 0"],
    ['embedding_database_busy', "instr(lower(error_text), 'database is locked') > 0 OR instr(lower(error_text), 'sqlite_busy') > 0"],
    ['embedding_unknown_project', "instr(lower(error_text), 'unknown project:') > 0"],
  ];
  const sql = [
    'SELECT CASE',
    ...entries.map(([code, condition]) => "WHEN (" + condition + ") THEN '" + code + "'"),
    "ELSE 'unclassified' END AS signature,",
    'COUNT(*) AS n FROM memory_pipeline_failures',
    "WHERE project_id = ? AND branch = ? AND stage = 'semantic_sync'",
    'GROUP BY signature ORDER BY n DESC, signature ASC',
  ].join(' ');
  return Object.fromEntries(
    db.prepare(sql).all(projectId, branch)
      .map(row => [row.signature, Number(row.n)]),
  );
}

/**
 * Pure host prerequisite inspection. Does not spawn Codex, read auth contents,
 * call an LLM, retry candidates, or touch the canonical SQLite.
 * Presence of auth.json is NOT proof of a valid CLI session or usable model.
 */
export function inspectCodexJudgePrerequisites({
  env = process.env,
  platform = process.platform,
  codexHome = join(homedir(), '.codex'),
  resolveJudge = resolveCodexJudgeExecutable,
} = {}) {
  const sourceHome = env.MEMORY_CANDIDATE_JUDGE_SOURCE_CODEX_HOME
    || env.CODEX_HOME || codexHome;
  let authFile = 'unavailable';
  if (typeof sourceHome === 'string' && isAbsolute(sourceHome)) {
    try {
      const info = lstatSync(join(sourceHome, 'auth.json'));
      authFile = info.isFile() && !info.isSymbolicLink()
        ? 'present_unverified' : 'not_regular_file';
    } catch (error) {
      authFile = error?.code === 'ENOENT'
        ? 'missing' : 'unreadable';
    }
  }

  let executable = 'unavailable';
  let executableKind = null;
  try {
    const resolved = resolveJudge({ env, platform });
    if (['native', 'node_js', 'npm_js', 'path_command'].includes(resolved?.kind)) {
      executable = 'resolved_unverified';
      executableKind = resolved.kind;
    }
  } catch {
    // Never display raw errors; override values can contain local paths.
  }

  return {
    executable,
    executable_kind: executableKind,
    auth_file: authFile,
    status: executable !== 'resolved_unverified'
      ? 'cli_not_resolved'
      : authFile !== 'present_unverified'
        ? 'auth_file_not_ready'
        : 'prerequisites_present_unverified',
    actual_cli_login_verified: false,
    model_call_performed: false,
    note: 'A resolved executable and auth.json file do not prove login, network access, quotas or an executable judge model.',
  };
}

function emptyCounts() {
  return {
    evidence_total: 0,
    user_prompt_evidence: 0,
    candidate_by_status: {},
    pending_user_candidates: 0,
    claims_current_branch_by_state: {},
    claims_other_branches: 0,
    active_current_by_authority: {},
    current_branch_fts_rows: 0,
    current_branch_pipeline_by_status: {},
    pipeline_failures: 0,
    pipeline_failure_codes: { by_stage: {}, by_error_class: {} },
    importance_failure_signatures: {},
    semantic_failure_signatures: {},
    pipeline_latest_failure_at: null,
    pipeline_running_older_than_30m: 0,
    pipeline_last_start: null,
    active_claim_blockers: {
      disallowed_authority: 0,
      path_not_current: 0,
      primary_seed_marker: 0,
      open_conflict: 0,
    },
    eligible_claims_upper_bound: 0,
  };
}

function inspectHooks({ codexHome = join(homedir(), '.codex') } = {}) {
  const path = join(codexHome, 'hooks.json');
  if (!existsSync(path)) {
    return { status: 'missing', configured: false, runtime_execution_observed: false };
  }
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      return { status: 'invalid_file', configured: false, runtime_execution_observed: false };
    }
    const audit = inspectAgentHubHookConfiguration(
      JSON.parse(readFileSync(path, 'utf8')),
    );
    return {
      status: 'parsed',
      configured: audit.configured,
      user_prompt_submit: audit.userPromptSubmit,
      session_start_launcher: audit.sessionStartLauncher,
      stop_agent_decision_capture: audit.stopAgentDecisionCapture,
      flags: {
        candidate_capture: audit.flags.candidateCapture,
        auto_pipeline_configured: audit.flags.autoPipeline,
        explicit_memory_requests: audit.flags.explicitMemoryRequests,
        ignore_memory_env: audit.flags.ignoreMemoryEnv,
      },
      runtime_execution_observed: false,
    };
  } catch {
    return { status: 'unreadable', configured: false, runtime_execution_observed: false };
  }
}

function inspectProject(db, approved, {
  observe = describeGlobalMemoryProject,
  git = (root, args) => execFileSync(
    'git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim(),
} = {}) {
  const base = {
    project_id: approved.project_id,
    status: 'unknown',
    branch: null,
    counts: emptyCounts(),
    findings: [],
  };
  try {
    const current = observe({ cwd: approved.root });
    if (current.project_id !== approved.project_id
        || current.repo_identity !== approved.repo_identity) {
      return { ...base, status: 'project_identity_changed',
        findings: ['allowlist_identity_mismatch'] };
    }

    const branch = git(current.root, ['branch', '--show-current']) || 'HEAD';
    const revision = git(current.root, ['rev-parse', 'HEAD']);
    const id = approved.project_id;
    const scoped = [id, branch];
    const registered = Boolean(
      db.prepare('SELECT 1 FROM project_registry WHERE project_id = ?').get(id),
    );
    if (!registered) {
      return { ...base, branch, status: 'project_not_registered',
        findings: ['approved_but_not_registered_in_memory_db'] };
    }

    const evidence = count(db,
      'SELECT COUNT(*) n FROM evidence WHERE project_id = ?', [id]);
    const userPrompts = count(db,
      "SELECT COUNT(*) n FROM evidence WHERE project_id = ? AND "
      + "source_kind = 'session' AND json_extract(metadata_json, '$.event_type') = 'user_prompt'",
      [id]);
    const candidateStatus = grouped(db,
      'SELECT status label, COUNT(*) n FROM memory_candidates '
      + 'WHERE project_id = ? AND branch = ? GROUP BY status', scoped);
    const pendingUser = count(db,
      "SELECT COUNT(*) n FROM memory_candidates WHERE project_id = ? AND branch = ? "
      + "AND status = 'pending' AND source_authority = 'user_direct' AND evaluated_at IS NULL",
      scoped);
    const claimsCurrent = grouped(db,
      'SELECT state label, COUNT(*) n FROM claims '
      + 'WHERE project_id = ? AND branch_scope = ? GROUP BY state', scoped);
    const claimsOther = count(db,
      'SELECT COUNT(*) n FROM claims WHERE project_id = ? AND branch_scope <> ?',
      scoped);
    const activeAuthority = grouped(db,
      "SELECT e.authority_class label, COUNT(*) n FROM claims c "
      + "JOIN evidence e ON e.id = c.created_from_evidence_id "
      + "WHERE c.project_id = ? AND c.branch_scope = ? AND c.state = 'active' "
      + 'GROUP BY e.authority_class', scoped);
    const fts = count(db,
      'SELECT COUNT(*) n FROM claim_fts WHERE project_id = ? AND branch_scope = ?', scoped);
    const pipeline = grouped(db,
      'SELECT status label, COUNT(*) n FROM memory_pipeline_runs '
      + 'WHERE project_id = ? AND branch = ? GROUP BY status', scoped);
    const pipelineFailures = count(db,
      'SELECT COUNT(*) n FROM memory_pipeline_failures WHERE project_id = ? AND branch = ?',
      scoped);
    const pipelineFailureCodes = groupedFailureCodes(db, id, branch);
    const importanceSignatures = importanceFailureSignatures(db, id, branch);
    const semanticSignatures = semanticSyncFailureSignatures(db, id, branch);
    const lastFailure = db.prepare(
      'SELECT MAX(occurred_at) as at FROM memory_pipeline_failures '
      + 'WHERE project_id = ? AND branch = ?',
    ).get(...scoped);
    const pendingRuns = db.prepare(
      "SELECT started_at FROM memory_pipeline_runs "
      + "WHERE project_id = ? AND branch = ? AND status = 'running'",
    ).all(...scoped);
    const oldRunning = pendingRuns.filter(({ started_at }) => {
      const ms = Date.parse(started_at);
      return Number.isFinite(ms) && (Date.now() - ms) > 30 * 60 * 1000;
    }).length;
    // These blockers are overlapping reason categories, not a partition.
    // Aggregate in SQL without selecting Claim values or Evidence contents.
    const blockersRow = db.prepare(
      "SELECT "
      + "COALESCE(SUM(CASE WHEN e.authority_class NOT IN "
      + "('user_direct','repo_trusted','tool_observation') THEN 1 ELSE 0 END),0) disallowed_authority, "
      + "COALESCE(SUM(CASE WHEN e.path IS NOT NULL AND NOT "
      + "(e.blob_oid IS NOT NULL AND rps.commit_sha = ? AND rps.blob_oid = e.blob_oid) "
      + "THEN 1 ELSE 0 END),0) path_not_current, "
      + "COALESCE(SUM(CASE WHEN lower(c.id) LIKE '%runtime-e2e-seed%' "
      + "OR lower(coalesce(e.source_ref,'')) LIKE '%runtime-e2e-seed%' "
      + "THEN 1 ELSE 0 END),0) primary_seed_marker, "
      + "COALESCE(SUM(CASE WHEN EXISTS "
      + "(SELECT 1 FROM conflicts co WHERE co.project_id = c.project_id "
      + "AND co.state = 'open' AND (co.claim_a = c.id OR co.claim_b = c.id)) "
      + "THEN 1 ELSE 0 END),0) open_conflict "
      + "FROM claims c JOIN evidence e ON e.id = c.created_from_evidence_id "
      + "LEFT JOIN repository_path_state rps ON rps.project_id = c.project_id "
      + "AND rps.branch = c.branch_scope AND rps.path = e.path "
      + "WHERE c.project_id = ? AND c.branch_scope = ? AND c.state = 'active'",
    ).get(revision, ...scoped);
    const activeBlockers = Object.fromEntries(
      ['disallowed_authority', 'path_not_current',
        'primary_seed_marker', 'open_conflict']
        .map((key) => [key, Number(blockersRow[key] ?? 0)]),
    );
    const lastRun = db.prepare(
      'SELECT started_at FROM memory_pipeline_runs '
      + 'WHERE project_id = ? AND branch = ? '
      + 'ORDER BY started_at DESC LIMIT 1',
    ).get(...scoped);

    // Conservative upper bound, not an exact reliance verdict. Supporting
    // evidence provenance can further exclude results, and FTS query matching
    // must be satisfied before the MCP can return a claim.
    const upperBound = count(db,
      "SELECT COUNT(*) n FROM claims c "
      + "JOIN evidence e ON e.id = c.created_from_evidence_id "
      + "LEFT JOIN repository_path_state rps ON rps.project_id = c.project_id "
      + "AND rps.branch = c.branch_scope AND rps.path = e.path "
      + "WHERE c.project_id = ? AND c.branch_scope = ? AND c.state = 'active' "
      + "AND (e.path IS NULL OR (e.blob_oid IS NOT NULL "
      + "AND rps.commit_sha = ? AND rps.blob_oid = e.blob_oid)) "
      + "AND e.authority_class IN ('user_direct','repo_trusted','tool_observation') "
      + "AND lower(c.id) NOT LIKE '%runtime-e2e-seed%' "
      + "AND lower(coalesce(e.source_ref,'')) NOT LIKE '%runtime-e2e-seed%' "
      + "AND NOT EXISTS (SELECT 1 FROM conflicts co WHERE "
      + "co.project_id = c.project_id AND co.state = 'open' "
      + "AND (co.claim_a = c.id OR co.claim_b = c.id))",
      [id, branch, revision]);

    const counts = {
      evidence_total: evidence,
      user_prompt_evidence: userPrompts,
      candidate_by_status: candidateStatus,
      pending_user_candidates: pendingUser,
      claims_current_branch_by_state: claimsCurrent,
      claims_other_branches: claimsOther,
      active_current_by_authority: activeAuthority,
      current_branch_fts_rows: fts,
      current_branch_pipeline_by_status: pipeline,
      pipeline_failures: pipelineFailures,
      pipeline_failure_codes: pipelineFailureCodes,
      importance_failure_signatures: importanceSignatures,
      semantic_failure_signatures: semanticSignatures,
      pipeline_latest_failure_at: lastFailure?.at ?? null,
      pipeline_running_older_than_30m: oldRunning,
      pipeline_last_start: lastRun?.started_at ?? null,
      active_claim_blockers: activeBlockers,
      eligible_claims_upper_bound: upperBound,
    };

    const findings = [];
    const currentClaims = Object.values(claimsCurrent).reduce((a, b) => a + b, 0);
    const pipelineRuns = Object.values(pipeline).reduce((a, b) => a + b, 0);
    if (evidence === 0) findings.push('no_captured_evidence');
    else if (userPrompts === 0) findings.push('no_user_prompt_evidence');
    if (currentClaims === 0 && claimsOther > 0) {
      findings.push('claims_exist_only_on_other_branches');
    }
    if (pendingUser > 0 && pipelineRuns === 0) {
      findings.push('pending_user_candidates_without_pipeline_runs');
    }
    if (pendingUser > 0) findings.push('pending_user_candidates');
    if ((candidateStatus.needs_confirmation ?? 0) > 0) {
      findings.push('candidates_need_confirmation');
    }
    if ((candidateStatus.failed ?? 0) > 0 || pipelineFailures > 0) {
      findings.push('candidate_or_pipeline_failures');
    }
    if (oldRunning > 0) findings.push('pipeline_running_older_than_30m');
    if ((pipelineFailureCodes.by_stage.pipeline_control ?? 0) > 0) {
      findings.push('pipeline_control_failures_detected');
    }
    if ((semanticSignatures.embedding_worker_unavailable ?? 0) > 0) {
      findings.push('semantic_embedding_worker_unavailable');
    }
    if ((semanticSignatures.unclassified ?? 0) > 0) {
      findings.push('semantic_sync_failure_unclassified');
    }
    if ((importanceSignatures.unclassified ?? 0) > 0) {
      findings.push('importance_failure_signature_unclassified');
    }
    if (currentClaims === 0 && Object.values(candidateStatus).reduce((a, b) => a + b, 0) === 0
        && evidence > 0) {
      findings.push('evidence_but_no_candidates_or_claims');
    }
    if (currentClaims > fts) findings.push('fts_coverage_incomplete');
    if (currentClaims > 0 && upperBound === 0) {
      findings.push('no_potentially_authorized_current_claims');
    }
    if (upperBound > 0) findings.push('some_potentially_retrievable_claims_check_query_matching');
    return { ...base, branch, status: 'inspected', counts, findings };
  } catch {
    return { ...base, status: 'inspection_unavailable',
      findings: ['project_inspection_failed_without_changes'] };
  }
}

/**
 * The user-owned SQLite file is opened readOnly with query_only PRAGMA.
 * The actual root/identity must match the already-approved scope manifest.
 */
export function diagnoseCodexMemoryPipeline({
  scopePath = defaultGlobalMemoryScopePath(),
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
  openDb = (path) => new DatabaseSync(path, { readOnly: true, timeout: 5_000 }),
  hooksInspector = inspectHooks,
  projectInspector = inspectProject,
  judgeInspector = inspectCodexJudgePrerequisites,
  env = process.env,
} = {}) {
  const hooks = hooksInspector({ codexHome });
  const common = {
    version: 1,
    read_only: true,
    hooks,
    judge_prerequisites: judgeInspector({ codexHome, env }),
    windows_prompt_hook_autopipeline_start: process.platform !== 'win32',
    note: 'No memory values, evidence content or transcripts were read or emitted. Hook configuration is not proof of hook execution.',
    projects: [],
  };

  let manifest;
  try { manifest = loadGlobalMemoryScope(scopePath); }
  catch { return { ...common, status: 'scope_invalid' }; }
  if (!manifest) return { ...common, status: 'scope_not_configured' };

  let stat;
  try { stat = lstatSync(manifest.memory_db); }
  catch { return { ...common, status: 'memory_database_unavailable' }; }
  if (!stat.isFile() || stat.isSymbolicLink() || !isAbsolute(manifest.memory_db)) {
    return { ...common, status: 'memory_database_unavailable' };
  }

  let db;
  try {
    db = openDb(manifest.memory_db);
    db.exec('PRAGMA query_only = ON');
    const schema = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
        .all().map((row) => row.name),
    );
    const required = [
      'project_registry', 'claims', 'evidence', 'memory_candidates',
      'claim_fts', 'memory_pipeline_runs', 'memory_pipeline_failures',
      'repository_path_state', 'conflicts',
    ];
    const missing = required.filter((name) => !schema.has(name));
    if (missing.length > 0) {
      return { ...common, status: 'schema_incomplete', missing_tables: missing };
    }
    return {
      ...common,
      status: 'inspected',
      approved_project_count: manifest.projects.length,
      projects: manifest.projects.map((approved) => projectInspector(db, approved)),
    };
  } catch {
    return { ...common, status: 'database_read_failed' };
  } finally {
    db?.close();
  }
}

function parseArgs(args) {
  let scopePath = defaultGlobalMemoryScopePath();
  let codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  for (let i = 0; i < args.length; i += 1) {
    if (!['--scope', '--codex-home'].includes(args[i])) {
      throw new Error('usage: node scripts/diagnose-codex-memory-pipeline.mjs [--scope ABSOLUTE_PATH] [--codex-home ABSOLUTE_PATH]');
    }
    const value = args[++i];
    if (!value || !isAbsolute(value)) throw new Error('absolute_path_required');
    if (args[i - 1] === '--scope') scopePath = resolve(value);
    else codexHome = resolve(value);
  }
  return { scopePath, codexHome };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.stdout.write(JSON.stringify(
      diagnoseCodexMemoryPipeline(parseArgs(process.argv.slice(2))),
      null, 2,
    ) + '\n');
  } catch {
    process.stderr.write('MEMORY_PIPELINE_DIAGNOSIS_FAILED\n');
    process.exitCode = 1;
  }
}
