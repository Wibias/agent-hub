#!/usr/bin/env node
/**
 * Explicit, one-shot Memory candidate pipeline rehearsal.
 *
 * Source DB: opened read-only and backed up with SQLite's online backup API,
 * so WAL frames are captured consistently. All stage writes use only the copy.
 * Only classic user-candidate stages run: importance, relation, promotion.
 * Output never includes candidate facts, model responses, IDs, or DB paths.
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMemoryCandidateJudgeCli } from './judge-memory-candidates.mjs';
import { runMemoryCandidateRelationCli } from './judge-memory-relations.mjs';
import { runMemoryCandidatePromotionCli } from './promote-memory-candidates.mjs';

const ALLOWED_DECISIONS = new Set([
  'promote', 'ignore', 'keep_candidate', 'needs_confirmation',
]);
const ALLOWED_RELATIONS = new Set(['same', 'update', 'contradict', 'unrelated']);
const ALLOWED_OUTCOMES = new Set(['promoted', 'superseded', 'needs_confirmation', 'failed']);

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' is required');
  return value.trim();
}

export function parseCandidateSandboxArgs(argv = []) {
  const result = {
    sourceDbPath: null, projectId: null, branch: null,
    limit: 1, model: null, reasoningEffort: 'medium', executeOnCopy: false,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate option');
    seen.add(flag);
    if (flag === '--execute-on-copy') {
      result.executeOnCopy = true;
      continue;
    }
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim()) throw new Error('missing option value');
    if (flag === '--source-db') result.sourceDbPath = resolve(value);
    else if (flag === '--project-id') result.projectId = value.trim();
    else if (flag === '--branch') result.branch = value.trim();
    else if (flag === '--model') result.model = value.trim();
    else if (flag === '--reasoning-effort' && ['low', 'medium', 'high'].includes(value)) {
      result.reasoningEffort = value;
    } else if (flag === '--limit' && /^[1-9]\d?$/u.test(value) && Number(value) <= 20) {
      result.limit = Number(value);
    } else throw new Error('unsupported option');
  }
  required(result.sourceDbPath, '--source-db');
  required(result.projectId, '--project-id');
  required(result.branch, '--branch');
  if (!result.executeOnCopy) throw new Error('--execute-on-copy must be explicit');
  return result;
}

/** Limited, known schema fields only. Database contents are never reported. */
export function countSandboxMemory(dbPath, projectId, branch) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    const claimCount = db.prepare(
      'SELECT COUNT(*) AS n FROM claims WHERE project_id = ? AND branch_scope = ?',
    ).get(projectId, branch).n;
    const activeClaims = db.prepare(
      "SELECT COUNT(*) AS n FROM claims WHERE project_id = ? AND branch_scope = ? AND state = 'active'",
    ).get(projectId, branch).n;
    const pendingImportance = db.prepare(
      "SELECT COUNT(*) AS n FROM memory_candidates WHERE project_id = ? AND branch = ? AND status = 'pending' AND evaluated_at IS NULL",
    ).get(projectId, branch).n;
    const reviewed = db.prepare(
      "SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id = ? AND branch = ? AND status = 'needs_confirmation'",
    ).get(projectId, branch).n;
    return { claims: claimCount, activeClaims, pendingImportance, evidenceNeedsConfirmation: reviewed };
  } finally {
    db.close();
  }
}

function summarizeStage(stage, summary = {}) {
  const allowed = stage === 'importance' ? ALLOWED_DECISIONS
    : stage === 'relation' ? ALLOWED_RELATIONS : ALLOWED_OUTCOMES;
  const key = stage === 'importance' ? 'decision'
    : stage === 'relation' ? 'relation' : 'status';
  const counts = {};
  for (const item of Array.isArray(summary.results) ? summary.results : []) {
    const value = item?.[key];
    if (allowed.has(value)) counts[value] = (counts[value] ?? 0) + 1;
  }
  const safeNumbers = {};
  for (const field of ['total', 'evaluated', 'applied', 'failed', 'promoted', 'superseded', 'needs_confirmation']) {
    if (Number.isInteger(summary[field]) && summary[field] >= 0) safeNumbers[field] = summary[field];
  }
  return { stage, ...safeNumbers, decisions: counts };
}

export async function runCandidateSandbox({
  sourceDbPath, projectId, branch, limit = 1, model = null, reasoningEffort = 'medium',
  cwd = process.cwd(),
  runImportance = runMemoryCandidateJudgeCli,
  runRelation = runMemoryCandidateRelationCli,
  runPromotion = runMemoryCandidatePromotionCli,
} = {}) {
  sourceDbPath = resolve(required(sourceDbPath, 'sourceDbPath'));
  projectId = required(projectId, 'projectId');
  branch = required(branch, 'branch');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('limit must be 1..20');
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) throw new RangeError('reasoningEffort unsupported');
  const tmp = await mkdtemp(join(tmpdir(), 'agent-hub-memory-sandbox-'));
  const copy = join(tmp, 'snapshot.sqlite3');
  let stage = 'backup';
  try {
    const source = new DatabaseSync(sourceDbPath, { readOnly: true, timeout: 5000 });
    try {
      await backup(source, copy);
    } finally {
      source.close();
    }
    stage = 'snapshot_scope';
    const before = countSandboxMemory(copy, projectId, branch);
    if (before.pendingImportance === 0) {
      return {
        status: 'nothing_pending', sourceOpenedReadOnly: true,
        writesToSource: false, scope: { projectId, branch },
        before, after: before, stages: [],
      };
    }

    const runtime = { cwd, dbPath: copy, projectId, branch, revisionSha: null };
    const deps = { resolveRuntime() { return runtime; } };
    const baseArgs = ['--apply', '--cwd', cwd, '--db-path', copy, '--limit', String(limit)];
    const aiArgs = [...baseArgs, '--reasoning-effort', reasoningEffort,
      ...(model === null ? [] : ['--model', required(model, 'model')])];

    stage = 'importance';
    const importance = await runImportance({ argv: aiArgs, cwd, log() {}, dependencies: deps });

    stage = 'relation';
    const relation = await runRelation({ argv: aiArgs, cwd, log() {}, dependencies: deps });

    stage = 'promotion';
    const promotion = await runPromotion({ argv: baseArgs, cwd, log() {}, dependencies: deps });

    stage = 'snapshot_report';
    const after = countSandboxMemory(copy, projectId, branch);
    const stages = [
      summarizeStage('importance', importance?.summary),
      summarizeStage('relation', relation?.summary),
      summarizeStage('promotion', promotion?.summary),
    ];
    const failures = stages.reduce((sum, item) => sum + (item.failed ?? 0), 0);
    return {
      status: failures === 0 ? 'completed' : 'partial',
      sourceOpenedReadOnly: true,
      writesToSource: false,
      scope: { projectId, branch },
      before, after, stages,
    };
  } catch {
    return {
      status: 'failed', failedStage: stage, sourceOpenedReadOnly: true,
      writesToSource: false, scope: { projectId, branch },
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  try {
    const args = parseCandidateSandboxArgs(process.argv.slice(2));
    const report = await runCandidateSandbox(args);
    console.log(JSON.stringify({
      type: 'agent_hub_candidate_sandbox_rehearsal_v1',
      memoryDatabaseAccessedReadOnly: true,
      dataMutationTarget: 'temporary_sqlite_backup',
      ...report,
    }, null, 2));
    if (report.status !== 'completed' && report.status !== 'nothing_pending') process.exitCode = 1;
  } catch {
    console.error('Sandbox rehearsal unavailable: verify explicit scope and arguments.');
    process.exitCode = 1;
  }
}
