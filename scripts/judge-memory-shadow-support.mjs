#!/usr/bin/env node
/**
 * Single evidence-support judgment for an already importance-evaluated
 * proposal in a disposable AgentHub Shadow database. Never runs Claim
 * promotion, relation judgment, protected approval, or a multi-item loop.
 *
 * Without --run-model this is a read-only, model-free inventory.
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
import { runEvidenceBoundSupportPipeline } from '../memory-engine/evidence-bound-support-pipeline.mjs';

export function parseShadowSupportArgs(argv = []) {
  const args = { runModel: false };
  const flags = new Map([
    ['--shadow-db', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--run-model') {
      if (args.runModel) throw new Error('duplicate --run-model');
      args.runModel = true;
      continue;
    }
    const name = flags.get(flag);
    const value = argv[++index];
    if (!name || Object.hasOwn(args, name)
      || typeof value !== 'string' || !value.trim() || value !== value.trim()) {
      throw new Error('unsupported, duplicate or malformed argument');
    }
    args[name] = value;
  }
  if (!['dbPath','projectId','branch'].every(name => args[name])) {
    throw new Error('exact shadow path and project/branch required');
  }
  if (!isAbsolute(args.dbPath)) throw new Error('absolute shadow DB path required');
  args.dbPath = resolve(args.dbPath);
  return args;
}

function proposalRef(id) {
  return '~p' + createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function inspectSupportQueue(dbPath, projectId, branch) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only=ON');
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all().map(row => row.name));
    if (!['project_registry', 'memory_evidence_proposals',
      'memory_evidence_proposal_evidence', 'evidence', 'claims']
      .every(name => tables.has(name))) {
      throw new Error('shadow Evidence-Bound schema missing');
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      throw new Error('scope project not registered in shadow');
    }
    const remaining = Number(db.prepare(
      "SELECT COUNT(*) AS n FROM memory_evidence_proposals "
      + "WHERE project_id=? AND branch=? AND status='pending' "
      + "AND support_json IS NULL AND json_valid(importance_json) "
      + "AND json_extract(importance_json,'$.decision')='promote'",
    ).get(projectId, branch).n);
    const claims = Number(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n);
    return { remaining, claims };
  } finally { db.close(); }
}

export async function judgeShadowSupport({
  dbPath, projectId, branch, runModel = false,
  localAppData = process.env.LOCALAPPDATA,
  createJudge = createIsolatedCodexJsonJudge,
  runPipeline = runEvidenceBoundSupportPipeline,
  onModelCallAttempt = () => {},
} = {}) {
  if (![dbPath,projectId,branch].every(value => typeof value === 'string' && value.trim())
    || typeof runModel !== 'boolean' || typeof onModelCallAttempt !== 'function') {
    throw new TypeError('exact shadow scope and explicit model mode required');
  }
  requireIsolatedShadow(dbPath, { localAppData });
  const before = inspectSupportQueue(dbPath, projectId, branch);
  const base = {
    scope: { projectId, branch },
    sourceDatabaseModifiedByTool: false,
    protectedApproval: false,
    claimsCreated: 0,
    decisionsApplied: 0,
    stage: 'evidence_support_only',
    supportRemainingBefore: before.remaining,
  };
  if (!runModel) {
    return {
      ...base,
      status: 'shadow_support_inspected',
      modelCallAttempted: false,
      instruction: 'Explicit --run-model evaluates at most ONE importance-promote proposal. No retries or Claim promotion.',
    };
  }
  if (before.remaining === 0) {
    return { ...base, status: 'no_support_work', modelCallAttempted: false };
  }
  let judge = null;
  let attempted = false;
  try {
    judge = await createJudge({
      workspaceLabel: 'evidence-shadow-support',
      policyVersion: 'evidence-support-v1',
      reasoningEffort: 'medium',
    });
    if (!judge || typeof judge.judge !== 'function'
      || typeof judge.close !== 'function'
      || typeof judge.evaluatorId !== 'string' || !judge.evaluatorId.trim()) {
      throw new Error('isolated support judge contract invalid');
    }
    const result = await runPipeline({
      dbPath, projectId, branch,
      limit: 1,
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
      throw new Error(result.results?.[0]?.error ?? 'support stage incomplete');
    }
    const after = inspectSupportQueue(dbPath, projectId, branch);
    if (after.claims !== before.claims) {
      throw new Error('shadow Claim count changed during support stage');
    }
    const item = result.results[0];
    return {
      ...base,
      status: 'shadow_support_evaluated_unapproved',
      modelCallAttempted: attempted,
      evaluated: 1,
      proposalRef: proposalRef(item.proposal_id),
      supportDecision: item.decision,
      proposalStatus: item.status,
      supportRemainingAfter: after.remaining,
      note: 'Evidence support only. No relation, Claim promotion, native approval or human consent performed.',
    };
  } finally {
    if (judge?.close) {
      try { await judge.close(); } catch {}
    }
  }
}

export async function runShadowSupportCommand({
  argv = process.argv.slice(2),
  run = judgeShadowSupport,
  write = text => process.stdout.write(text),
} = {}) {
  let attempted = false;
  try {
    const args = parseShadowSupportArgs(argv);
    const report = await run({
      ...args,
      onModelCallAttempt: () => { attempted = true; },
    });
    write(JSON.stringify(report, null, 2) + '\n');
    return 0;
  } catch (error) {
    write(JSON.stringify({
      ...sanitizeShadowExtractionFailure(error, { modelCallAttempted: attempted }),
      status: 'shadow_support_failed',
      stage: 'evidence_support_only',
      note: 'Support failed or was interrupted. Inspect the shadow inventory; never retry automatically.',
    }, null, 2) + '\n');
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runShadowSupportCommand();
}
