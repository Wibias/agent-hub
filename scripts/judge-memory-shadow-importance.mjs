#!/usr/bin/env node
/**
 * ONE explicitly requested importance judgment on a disposable AgentHub
 * Evidence-Shadow copy. No support, relation, promotion or Claim writes.
 * No model call unless --run-model; default is a metadata-only inventory.
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

export function parseShadowImportanceArgs(argv = []) {
  const args = { runModel: false };
  const flags = new Map([
    ['--shadow-db', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
    ['--proposal-ref', 'targetProposalRef'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--run-model') {
      if (args.runModel) throw new Error('duplicate model flag');
      args.runModel = true;
      continue;
    }
    const name = flags.get(flag);
    const value = argv[++i];
    if (!name || Object.hasOwn(args, name)
      || typeof value !== 'string' || !value.trim() || value !== value.trim()) {
      throw new Error('unsupported, duplicate or malformed argument');
    }
    args[name] = value;
  }
  if (!['dbPath','projectId','branch'].every(key => args[key])) {
    throw new Error('exact shadow DB, project and branch required');
  }
  if (!isAbsolute(args.dbPath)) throw new Error('absolute shadow DB path required');
  if (args.targetProposalRef && !/^~p[0-9a-f]{12}$/u.test(args.targetProposalRef)) {
    throw new Error('invalid target proposal ref');
  }
  args.dbPath = resolve(args.dbPath);
  return args;
}

function proposalRef(id) {
  return '~p' + createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function inspectQueue(dbPath, projectId, branch, targetProposalRef = null) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5_000 });
  try {
    db.exec('PRAGMA query_only=ON');
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all().map(row => row.name));
    if (!['project_registry','memory_evidence_proposals','claims']
      .every(name => tables.has(name))) {
      throw new Error('shadow Evidence-Bound schema missing');
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      throw new Error('scope project not registered in shadow');
    }
    let targetProposalId = null;
    if (targetProposalRef !== null) {
      const rows = db.prepare(
        "SELECT id FROM memory_evidence_proposals "
        + "WHERE project_id=? AND branch=? AND status='pending' AND importance_json IS NULL",
      ).all(projectId, branch);
      const matching = rows.filter(row => proposalRef(row.id) === targetProposalRef);
      if (matching.length !== 1) {
        throw new Error('exact in-scope unevaluated proposal not found');
      }
      targetProposalId = matching[0].id;
    }
    const count = query => Number(db.prepare(query).get(projectId, branch).n);
    return {
      targetProposalId,
      importanceRemaining: count(
        "SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=? AND status='pending' AND importance_json IS NULL",
      ),
      claimsBefore: count(
        'SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=?',
      ),
    };
  } finally {
    db.close();
  }
}

export async function judgeShadowImportance({
  dbPath, projectId, branch, runModel = false,
  targetProposalRef = null,
  localAppData = process.env.LOCALAPPDATA,
  createJudge = createIsolatedCodexJsonJudge,
  runPipeline = runEvidenceBoundImportancePipeline,
  onModelCallAttempt = () => {},
} = {}) {
  if (![dbPath,projectId,branch].every(value => typeof value === 'string' && value.trim())
    || typeof runModel !== 'boolean' || typeof onModelCallAttempt !== 'function'
    || (targetProposalRef !== null && !/^~p[0-9a-f]{12}$/u.test(targetProposalRef))) {
    throw new TypeError('exact scope and model mode required');
  }
  requireIsolatedShadow(dbPath, { localAppData });
  const before = inspectQueue(dbPath, projectId, branch, targetProposalRef);
  const base = {
    scope: { projectId, branch },
    sourceDatabaseModifiedByTool: false,
    protectedApproval: false,
    claimsCreated: 0,
    // A status change to needs_confirmation does not authorize any Claim.
    decisionsApplied: 0,
    stage: 'evidence_importance_only',
    importanceRemainingBefore: before.importanceRemaining,
    ...(targetProposalRef !== null ? { targetProposalRef } : {}),
  };
  if (!runModel) {
    return {
      ...base, status: 'shadow_importance_inspected',
      modelCallAttempted: false,
      instruction: 'Explicit --run-model evaluates at most ONE pending proposal. No automatic retries.',
    };
  }
  if (before.importanceRemaining === 0) {
    return { ...base, status: 'no_importance_work', modelCallAttempted: false };
  }

  let judge = null;
  let attempted = false;
  try {
    judge = await createJudge({
      workspaceLabel: 'evidence-shadow-importance',
      policyVersion: 'evidence-importance-v1',
      reasoningEffort: 'medium',
    });
    if (!judge || typeof judge.judge !== 'function'
      || typeof judge.close !== 'function'
      || typeof judge.evaluatorId !== 'string' || !judge.evaluatorId.trim()) {
      throw new Error('isolated importance judge contract invalid');
    }
    const result = await runPipeline({
      dbPath, projectId, branch,
      limit: 1,
      proposalId: before.targetProposalId,
      evaluatorId: judge.evaluatorId,
      inspectTextSensitivity: inspectMemoryTextSensitivity,
      judge: async ({ prompt }) => {
        attempted = true;
        onModelCallAttempt();
        return judge.judge(prompt);
      },
    });
    if (result.total !== 1 || result.failed !== 0 || result.evaluated !== 1
      || result.results?.length !== 1 || result.results[0]?.ok !== true) {
      const error = result.results?.[0]?.error ?? 'importance stage incomplete';
      throw new Error(error);
    }
    const after = inspectQueue(dbPath, projectId, branch);
    if (before.targetProposalId !== null
      && result.results?.[0]?.proposal_id !== before.targetProposalId) {
      throw new Error('target importance evaluation diverged from requested ref');
    }
    if (after.claimsBefore !== before.claimsBefore) {
      throw new Error('shadow Claim count changed during importance stage');
    }
    const item = result.results[0];
    return {
      ...base,
      status: 'shadow_importance_evaluated_unapproved',
      modelCallAttempted: attempted,
      evaluated: 1,
      proposalRef: proposalRef(item.proposal_id),
      importanceDecision: item.decision,
      proposalStatus: item.status,
      importanceRemainingAfter: after.importanceRemaining,
      note: 'Importance only; no support, relation or Claim promotion was run. Human authorization is still absent.',
    };
  } finally {
    if (judge?.close) {
      try { await judge.close(); } catch {}
    }
  }
}

export async function runShadowImportanceCommand({
  argv = process.argv.slice(2),
  run = judgeShadowImportance,
  write = text => process.stdout.write(text),
} = {}) {
  let attempted = false;
  try {
    const args = parseShadowImportanceArgs(argv);
    const report = await run({
      ...args,
      onModelCallAttempt: () => { attempted = true; },
    });
    write(JSON.stringify(report, null, 2) + '\n');
    return 0;
  } catch (error) {
    write(JSON.stringify({
      ...sanitizeShadowExtractionFailure(error, { modelCallAttempted: attempted }),
      status: 'shadow_importance_failed',
      stage: 'evidence_importance_only',
      note: 'The importance stage failed or was interrupted. Inspect the shadow inventory before considering a retry; never repeat automatically.',
    }, null, 2) + '\n');
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runShadowImportanceCommand();
}
