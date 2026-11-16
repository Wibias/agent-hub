#!/usr/bin/env node
/**
 * One explicitly selected, already extracted EVIDENCE-BOUND proposal:
 * Importance -> Support -> Relation. No Claim promotion, no approval,
 * no canonical DB access, no automatic retries or project-wide queue scan.
 *
 * Default: read-only status. --run-judges resumes missing stages only.
 * At most one isolated model call per missing stage (3 total).
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createIsolatedCodexJsonJudge } from './codex-isolated-memory-judge.mjs';
import {
  requireIsolatedShadow,
  sanitizeShadowExtractionFailure,
} from './extract-memory-shadow-evidence.mjs';
import { inspectMemoryTextSensitivity } from '../memory-engine/index.mjs';
import { runEvidenceBoundImportancePipeline } from '../memory-engine/evidence-bound-importance-pipeline.mjs';
import { runEvidenceBoundSupportPipeline } from '../memory-engine/evidence-bound-support-pipeline.mjs';
import { runEvidenceBoundRelationPipeline } from '../memory-engine/evidence-bound-relation-pipeline.mjs';

const REF = /^~p[0-9a-f]{12}$/u;
const STAGES = Object.freeze([
  ['importance', 'evidence-importance-v1', runEvidenceBoundImportancePipeline],
  ['support', 'evidence-support-v1', runEvidenceBoundSupportPipeline],
  ['relation', 'evidence-relation-v1', runEvidenceBoundRelationPipeline],
]);
const ref = id => '~p' + createHash('sha256').update(id).digest('hex').slice(0, 12);

export function parseAutoReviewArgs(argv = []) {
  const args = { runJudges: false };
  const map = new Map([
    ['--shadow-db', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
    ['--proposal-ref', 'proposalRef'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--run-judges') {
      if (args.runJudges) throw new Error('duplicate run flag');
      args.runJudges = true;
      continue;
    }
    const name = map.get(flag);
    const value = argv[++i];
    if (!name || Object.hasOwn(args, name)
      || typeof value !== 'string' || !value.trim() || value !== value.trim()) {
      throw new Error('malformed or duplicated argument');
    }
    args[name] = value;
  }
  if (!['dbPath', 'projectId', 'branch', 'proposalRef'].every(key => args[key])) {
    throw new Error('exact Shadow scope and opaque proposal ref required');
  }
  if (!isAbsolute(args.dbPath) || !REF.test(args.proposalRef)) {
    throw new Error('invalid Shadow path or proposal ref');
  }
  args.dbPath = resolve(args.dbPath);
  return args;
}

/** Read from real ledger; do not trust caller-supplied stage verdicts. */
function readState(dbPath, projectId, branch, proposalRef) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only=ON');
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all().map(row => row.name));
    if (!['project_registry', 'claims', 'evidence', 'memory_evidence_proposals',
      'memory_evidence_proposal_evidence', 'memory_evidence_proposal_relations']
      .every(t => tables.has(t))) throw new Error('Shadow schema is missing');
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) throw new Error('Shadow project is not registered');
    const candidates = db.prepare(
      'SELECT id, status, importance_json, support_json FROM memory_evidence_proposals '
      + 'WHERE project_id=? AND branch=? ORDER BY id LIMIT 10001',
    ).all(projectId, branch);
    if (candidates.length > 10000) throw new Error('too many proposals to resolve safely');
    const matching = candidates.filter(row => ref(row.id) === proposalRef);
    if (matching.length !== 1) throw new Error('opaque ref not uniquely in scope');
    const row = matching[0];
    const relation = db.prepare(
      'SELECT relation FROM memory_evidence_proposal_relations WHERE proposal_id=?',
    ).get(row.id)?.relation ?? null;
    let importance = null;
    let support = null;
    try {
      importance = row.importance_json ? JSON.parse(row.importance_json).decision : null;
      support = row.support_json ? JSON.parse(row.support_json).decision : null;
    } catch {
      throw new Error('stage verdict malformed');
    }
    if (importance !== null && !['promote', 'ignore', 'keep_candidate', 'needs_confirmation'].includes(importance))
      throw new Error('invalid importance result in Shadow');
    if (support !== null && !['supported', 'unsupported', 'needs_confirmation'].includes(support))
      throw new Error('invalid support result in Shadow');
    if (relation !== null && !['same', 'update', 'contradict', 'unrelated'].includes(relation))
      throw new Error('invalid relation in Shadow');
    const linked = Number(db.prepare(
      'SELECT COUNT(*) n FROM memory_evidence_proposal_evidence WHERE proposal_id=?',
    ).get(row.id).n);
    if (linked < 1 || linked > 10) throw new Error('proposal evidence count is invalid');
    const claims = Number(db.prepare('SELECT COUNT(*) n FROM claims').get().n);
    return {
      id: row.id, status: row.status, importance, support, relation, claims,
    };
  } finally { db.close(); }
}

function summary(state, { projectId, branch, proposalRef, modelCalls }) {
  return {
    scope: { projectId, branch }, proposalRef,
    proposalStatus: state.status,
    importanceDecision: state.importance,
    supportDecision: state.support,
    relation: state.relation,
    modelCalls,
    claimsCreated: 0,
    protectedApproval: false,
    sourceDatabaseModifiedByTool: false,
    noClaimPromotion: true,
  };
}

export async function advanceShadowReview({
  dbPath, projectId, branch, proposalRef, runJudges = false,
  localAppData = process.env.LOCALAPPDATA,
  createJudge = createIsolatedCodexJsonJudge,
  pipelines = Object.fromEntries(STAGES.map(([name, , run]) => [name, run])),
  onModelCallAttempt = () => {},
} = {}) {
  if (![dbPath, projectId, branch, proposalRef].every(x => typeof x === 'string' && x.trim())
    || !REF.test(proposalRef) || typeof runJudges !== 'boolean'
    || typeof createJudge !== 'function'
    || typeof onModelCallAttempt !== 'function') {
    throw new TypeError('exact Shadow scope, mode and evaluator required');
  }
  requireIsolatedShadow(dbPath, { localAppData });
  const first = readState(dbPath, projectId, branch, proposalRef);
  const beforeClaims = first.claims;
  let modelCalls = 0;
  const read = () => {
    const state = readState(dbPath, projectId, branch, proposalRef);
    if (state.id !== first.id || state.claims !== beforeClaims) {
      throw new Error('Shadow proposal identity or Claim count changed');
    }
    return state;
  };
  if (!runJudges) {
    return {
      ...summary(first, { projectId, branch, proposalRef, modelCalls }),
      status: 'shadow_auto_review_inspected',
      modelCallsAttempted: 0,
      note: 'Read-only, no models or decisions. Only --run-judges can advance this single candidate.',
    };
  }

  const execute = async (stageName, policyVersion, pipeline) => {
    let judge = null;
    try {
      judge = await createJudge({
        workspaceLabel: 'evidence-shadow-auto-' + stageName,
        policyVersion, reasoningEffort: 'medium',
      });
      if (typeof judge?.judge !== 'function' || typeof judge?.close !== 'function'
        || typeof judge?.evaluatorId !== 'string' || !judge.evaluatorId.trim()) {
        throw new Error('isolated judge contract unavailable');
      }
      const outcome = await pipeline({
        dbPath, projectId, branch, proposalId: first.id, limit: 1,
        inspectTextSensitivity: inspectMemoryTextSensitivity,
        evaluatorId: judge.evaluatorId,
        judge: async ({ prompt }) => {
          if (modelCalls >= 3) throw new Error('model call cap exceeded');
          modelCalls++;
          onModelCallAttempt();
          return judge.judge(prompt);
        },
      });
      if (outcome.total !== 1 || outcome.evaluated !== 1 || outcome.failed !== 0
        || outcome.results?.length !== 1 || !outcome.results[0].ok
        || outcome.results[0].proposal_id !== first.id) {
        throw new Error('stage did not evaluate exact selected proposal');
      }
      read();
      return outcome;
    } finally {
      if (judge?.close) {
        try { await judge.close(); } catch {}
      }
    }
  };

  let state = read();
  if (state.status !== 'pending') {
    return {
      ...summary(state, { projectId, branch, proposalRef, modelCalls }),
      status: 'shadow_auto_review_not_pending',
    };
  }

  if (state.importance === null) {
    await execute('importance', STAGES[0][1], pipelines.importance);
    state = read();
  }
  if (state.status !== 'pending' || state.importance !== 'promote') {
    return {
      ...summary(state, { projectId, branch, proposalRef, modelCalls }),
      status: 'shadow_auto_review_stopped_at_importance',
    };
  }

  if (state.support === null) {
    await execute('support', STAGES[1][1], pipelines.support);
    state = read();
  }
  if (state.status !== 'pending' || state.support !== 'supported') {
    return {
      ...summary(state, { projectId, branch, proposalRef, modelCalls }),
      status: 'shadow_auto_review_stopped_at_support',
    };
  }

  if (state.relation === null) {
    // Existing relation pipeline uses a deterministic 'unrelated' verdict
    // when no comparable active claims exist in this exact project/branch.
    // The judge is lazy: do not create an isolated model unless needed.
    let judge = null;
    const result = await pipelines.relation({
      dbPath, projectId, branch, proposalId: first.id, limit: 1,
      inspectTextSensitivity: inspectMemoryTextSensitivity,
      evaluatorId: 'shadow-auto-relation-v1',
      judge: async ({ prompt }) => {
        if (!judge) {
          judge = await createJudge({
            workspaceLabel: 'evidence-shadow-auto-relation',
            policyVersion: STAGES[2][1], reasoningEffort: 'medium',
          });
        }
        if (typeof judge?.judge !== 'function' || typeof judge?.close !== 'function'
          || typeof judge?.evaluatorId !== 'string' || !judge.evaluatorId.trim()) {
          throw new Error('isolated relation judge contract unavailable');
        }
        if (modelCalls >= 3) throw new Error('model call cap exceeded');
        modelCalls++;
        onModelCallAttempt();
        return judge.judge(prompt);
      },
    }).finally(async () => {
      if (judge?.close) {
        try { await judge.close(); } catch {}
      }
    });
    if (result.total !== 1 || result.evaluated !== 1 || result.failed !== 0
      || result.results?.length !== 1 || !result.results[0].ok
      || result.results[0].proposal_id !== first.id) {
      throw new Error('relation stage did not evaluate selected proposal');
    }
    state = read();
  }
  return {
    ...summary(state, { projectId, branch, proposalRef, modelCalls }),
    status: 'shadow_auto_review_complete_unapproved',
    note: 'Importance, Support and Relation recorded in Shadow only. No Claim, protected review, consent or production write.',
  };
}

export async function runAutoReviewCommand({
  argv = process.argv.slice(2),
  run = advanceShadowReview,
  write = s => process.stdout.write(s),
} = {}) {
  let attempted = 0;
  try {
    const args = parseAutoReviewArgs(argv);
    const result = await run({
      ...args, onModelCallAttempt: () => { attempted++; },
    });
    write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    write(JSON.stringify({
      ...sanitizeShadowExtractionFailure(error, { modelCallAttempted: attempted > 0 }),
      status: 'shadow_auto_review_failed',
      modelCallsAttempted: attempted,
      note: 'Stopped without retry. Some Shadow verdicts may be durable: inspect inventory before any manual recovery. No approval/Claim functionality exists here.',
    }, null, 2) + '\n');
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runAutoReviewCommand();
}
