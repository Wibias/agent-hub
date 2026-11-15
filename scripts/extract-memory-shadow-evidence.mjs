#!/usr/bin/env node
/**
 * Inspection and explicitly opted-in extraction for the disposable
 * AgentHub-Evidence-Shadow copy. This is NOT a Claim pipeline.
 *
 * No automatic importance, support, relation, promotion, or approvals.
 * A successful extraction creates only pending, UNJUDGED proposal rows
 * in the shadow. Never run this against the canonical Memory database.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createIsolatedCodexJsonJudge } from './codex-isolated-memory-judge.mjs';
import { runEvidenceBoundExtractionPipeline } from '../memory-engine/evidence-bound-pipeline.mjs';
import { inspectMemoryTextSensitivity } from '../memory-engine/index.mjs';
import { classifyCodexJudgeSmokeFailure } from './smoke-codex-memory-judge.mjs';

const MAX_EVIDENCE = 25;
const ALLOWED = new Set(['user_direct', 'repo_trusted', 'tool_observation']);
const EXPECTED_FILENAME = 'memory-shadow.sqlite3';
const EXPECTED_FOLDER = /^AgentHub-Evidence-Shadow-[0-9a-f]{32}$/u;

export function parseShadowExtractionArgs(argv = []) {
  const options = { runModel: false };
  const flags = new Map([
    ['--shadow-db', 'dbPath'],
    ['--project-id', 'projectId'],
    ['--branch', 'branch'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--run-model') {
      if (options.runModel) throw new Error('duplicate run flag');
      options.runModel = true;
      continue;
    }
    const name = flags.get(flag);
    const value = argv[++index];
    if (!name || Object.hasOwn(options, name)
      || typeof value !== 'string' || !value.trim() || value !== value.trim()) {
      throw new Error('unsupported, duplicate or malformed argument');
    }
    options[name] = value;
  }
  if (!['dbPath', 'projectId', 'branch'].every(key => options[key])) {
    throw new Error('exact shadow path and project/branch required');
  }
  if (!isAbsolute(options.dbPath)) throw new Error('absolute shadow path required');
  options.dbPath = resolve(options.dbPath);
  return options;
}

/**
 * This check protects against mistakes, NOT hostile same-user processes.
 * The shadow is user-writable and cannot confer protected approval.
 */
export function requireIsolatedShadow(dbPath, {
  localAppData = process.env.LOCALAPPDATA,
} = {}) {
  if (!isAbsolute(dbPath) || typeof localAppData !== 'string'
    || !isAbsolute(localAppData)) {
    throw new Error('absolute shadow and LOCALAPPDATA required');
  }
  const resolved = resolve(dbPath);
  const root = realpathSync(resolve(localAppData));
  const container = dirname(resolved);
  const directory = lstatSync(container);
  const sqlite = lstatSync(resolved);
  if (directory.isSymbolicLink() || !directory.isDirectory()
    || sqlite.isSymbolicLink() || !sqlite.isFile()
    || realpathSync(container) !== container
    || realpathSync(resolved) !== resolved
    || dirname(container) !== root
    || !EXPECTED_FOLDER.test(container.split(/[\\/]/u).at(-1))
    || resolved.split(/[\\/]/u).at(-1) !== EXPECTED_FILENAME) {
    throw new Error('only a real, direct LOCALAPPDATA Evidence-Shadow database is allowed');
  }
  const under = relative(root, resolved);
  if (!under || under.startsWith('..' + sep) || isAbsolute(under)) {
    throw new Error('shadow is outside LOCALAPPDATA');
  }
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name));
}

function safeMetadata(raw) {
  try {
    const metadata = JSON.parse(raw ?? '{}');
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { tool_outcome: metadata.tool_outcome ?? null } : {};
  } catch {
    return {};
  }
}

export async function extractShadowEvidence({
  dbPath,
  projectId,
  branch,
  runModel = false,
  localAppData = process.env.LOCALAPPDATA,
  createJudge = createIsolatedCodexJsonJudge,
  runExtraction = runEvidenceBoundExtractionPipeline,
  onModelCallAttempt = () => {},
} = {}) {
  if (![dbPath, projectId, branch].every(x => typeof x === 'string' && x.trim())
    || typeof runModel !== 'boolean' || typeof onModelCallAttempt !== 'function') {
    throw new TypeError('exact shadow scope and explicit model mode required');
  }
  requireIsolatedShadow(dbPath, { localAppData });

  // Open read-only even if the operator opts into model extraction;
  // the extraction store subsequently opens ONLY the validated shadow DB.
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  let evidence;
  let proposalsBefore;
  try {
    db.exec('PRAGMA query_only=ON');
    if (!['project_registry', 'evidence', 'claims', 'memory_evidence_proposals',
      'memory_evidence_proposal_evidence'].every(name => tableExists(db, name))) {
      throw new Error('expected Evidence-Bound shadow schema missing');
    }
    if (!db.prepare('SELECT 1 FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      throw new Error('project is not registered in shadow');
    }
    proposalsBefore = Number(db.prepare(
      'SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=?',
    ).get(projectId, branch).n);
    const rows = db.prepare(
      'SELECT id, project_id, branch, authority_class, sensitivity, '
      + 'content_redacted, source_kind, metadata_json '
      + 'FROM evidence WHERE project_id=? AND branch=? '
      + 'ORDER BY captured_at ASC, id ASC LIMIT ?',
    ).all(projectId, branch, MAX_EVIDENCE + 1);
    if (rows.length > MAX_EVIDENCE) {
      throw new Error('more than 25 evidence rows: explicit bounded batching required');
    }
    evidence = rows.filter(row => (
      row.sensitivity === 'normal'
      && ALLOWED.has(row.authority_class)
      && typeof row.content_redacted === 'string'
      && row.content_redacted.trim()
      && !(row.authority_class === 'tool_observation'
        && safeMetadata(row.metadata_json).tool_outcome === 'failure')
    )).map(row => ({
      ...row,
      metadata: safeMetadata(row.metadata_json),
    }));
    const baseline = {
      status: 'shadow_evidence_inspected',
      scope: { projectId, branch },
      readOnlyInspection: true,
      evidenceTotal: rows.length,
      evidenceEligible: evidence.length,
      evidenceExcluded: rows.length - evidence.length,
      proposalsBefore,
      sourceDatabaseModifiedByTool: false,
      protectedApproval: false,
      claimsCreated: 0,
      note: 'Shadow evidence is user-writable and untrusted for protected authorization.',
    };
    if (!runModel) {
      return {
        ...baseline,
        modelCallAttempted: false,
        modelCallSucceeded: false,
        instruction: 'Only --run-model explicitly starts one extraction judge call on the shadow. No Claim processing is available in this command.',
      };
    }
    if (evidence.length === 0) {
      return { ...baseline, status: 'no_eligible_evidence', modelCallAttempted: false };
    }
  } finally {
    db.close();
  }

  let judge = null;
  let attempted = false;
  try {
    judge = await createJudge({
      workspaceLabel: 'evidence-shadow-extraction',
      policyVersion: 'evidence-extraction-v2',
      reasoningEffort: 'medium',
    });
    if (!judge || typeof judge.judge !== 'function'
      || typeof judge.close !== 'function'
      || typeof judge.evaluatorId !== 'string') {
      throw new Error('isolated judge contract invalid');
    }
    const result = await runExtraction({
      dbPath,
      projectId,
      branch,
      evidence,
      judge: async ({ prompt }) => {
        attempted = true;
        onModelCallAttempt();
        return judge.judge(prompt);
      },
      evaluatorId: judge.evaluatorId,
      inspectTextSensitivity: inspectMemoryTextSensitivity,
    });
    return {
      status: 'shadow_extraction_completed_unreviewed',
      scope: { projectId, branch },
      modelCallAttempted: attempted,
      modelCallSucceeded: true,
      proposed: result.proposals.length,
      proposalsPersistedAs: 'pending',
      claimsCreated: 0,
      decisionsApplied: 0,
      protectedApproval: false,
      sourceDatabaseModifiedByTool: false,
      note: 'Only user-writable shadow proposals were created. No independent importance, support, relation or human approval exists.',
    };
  } finally {
    if (judge?.close) {
      try { await judge.close(); } catch {}
    }
  }
}

/**
 * Return only fixed, content-free failure classifications. Raw Codex CLI
 * stderr and judge output may contain personal prompts, source Evidence,
 * filesystem paths or account details and must NEVER be printed here.
 */
export function sanitizeShadowExtractionFailure(error, {
  modelCallAttempted = false,
} = {}) {
  const raw = String(error instanceof Error ? error.message : error ?? '');
  const known = classifyCodexJudgeSmokeFailure(error);
  let failureCode = known;
  if (known === 'judge_failure_unclassified') {
    if (/\bcodex isolated memory judge failed with exit\b/i.test(raw)) {
      failureCode = 'codex_exec_nonzero_unclassified';
    } else if (/evidence extraction response|unexpected field in memory proposal|missing field in memory proposal|unknown cited evidence|outside extraction scope|unsupported evidence extraction|memory proposal must be|kind must be preference|canonical_fact must be/i.test(raw)) {
      failureCode = 'extraction_validation_failed';
    } else if (/shadow|sqlite|database|schema|project is not registered|absolute path|unsupported|malformed argument|missing argument|eacces|eperm|enoent/i.test(raw)) {
      failureCode = 'shadow_preflight_or_storage_failure';
    } else {
      failureCode = 'shadow_extraction_failure_unclassified';
    }
  }
  const match = raw.match(/\bcodex isolated memory judge failed with exit (\d{1,3})\b/i);
  const exitCode = match ? Number(match[1]) : null;

  return {
    status: 'shadow_extraction_failed',
    failure_code: failureCode,
    model_call_attempted: modelCallAttempted === true,
    process_exit_code: exitCode !== null && exitCode >= 1 && exitCode <= 255
      ? exitCode : null,
    source_database_modified_by_tool: false,
    shadow_proposals_may_have_changed: modelCallAttempted === true,
    claims_created: 0,
    protected_approval: false,
    note: 'Classification is indicative, not a verified account status. Never upload source Evidence or raw CLI stderr.',
  };
}

/**
 * CLI boundary is intentionally injected so regression tests can exercise
 * error classification without starting a real Codex model call.
 */
export async function runShadowExtractionCommand({
  argv = process.argv.slice(2),
  run = extractShadowEvidence,
  write = text => process.stdout.write(text),
} = {}) {
  let modelCallAttempted = false;
  try {
    const args = parseShadowExtractionArgs(argv);
    const result = await run({
      ...args,
      onModelCallAttempt: () => { modelCallAttempted = true; },
    });
    write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    write(JSON.stringify(sanitizeShadowExtractionFailure(error, {
      modelCallAttempted,
    }), null, 2) + '\n');
    return 2;
  }
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  process.exitCode = await runShadowExtractionCommand();
}
