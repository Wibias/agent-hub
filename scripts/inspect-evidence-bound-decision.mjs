#!/usr/bin/env node
/** Read-only, exact-checkout Evidence-Bound review preflight. NO mutation flags. */
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveGitContext } from '../memory-engine/git-freshness.mjs';
import { resolveGitRepositoryIdentity } from '../memory-engine/repository-identity.mjs';
import { inspectEvidenceBoundDecision } from '../memory-engine/evidence-bound-decision-preflight.mjs';

const VALUE_FLAGS = new Map([
  ['--db-path', 'dbPath'],
  ['--repo-path', 'repoPath'],
  ['--project-id', 'projectId'],
  ['--branch', 'branch'],
  ['--revision', 'revisionSha'],
  ['--proposal-ref', 'selectedRef'],
  ['--expected-snapshot', 'expectedSnapshot'],
]);

export function parseEvidenceDecisionPreflightArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv array required');
  const parsed = { showLocalContent: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate flag');
    seen.add(flag);
    if (flag === '--show-local-content') {
      parsed.showLocalContent = true;
      continue;
    }
    const key = VALUE_FLAGS.get(flag);
    if (!key) throw new Error('unknown or unsafe argument');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
      throw new Error('missing or malformed option value');
    }
    parsed[key] = key === 'dbPath' || key === 'repoPath' ? resolve(value) : value;
  }
  for (const name of ['dbPath','repoPath','projectId','branch','revisionSha','selectedRef']) {
    if (!parsed[name]) throw new Error('exact scope and checkout required');
  }
  if (!/^[0-9a-f]{40}$/u.test(parsed.revisionSha)
    || !/^E~[0-9a-f]{10}$/u.test(parsed.selectedRef)
    || (parsed.expectedSnapshot !== undefined
      && !/^[0-9a-f]{64}$/u.test(parsed.expectedSnapshot))) {
    throw new Error('invalid revision, proposal or snapshot ref');
  }
  return parsed;
}

function defaultGitResolve(repoPath) {
  const git = resolveGitContext({ cwd: repoPath });
  const execFile = (command, args) => execFileSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const identity = resolveGitRepositoryIdentity({ repoPath: git.repoPath, execFile });
  return { ...git, projectId: identity.projectId };
}

export function runEvidenceDecisionPreflight({
  dbPath, repoPath, projectId, branch, revisionSha, selectedRef,
  expectedSnapshot = undefined,
  showLocalContent = false,
  isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  gitResolve = defaultGitResolve,
  openDb = path => new DatabaseSync(path, { readOnly: true, timeout: 5000 }),
} = {}) {
  if (showLocalContent && !isTty) {
    throw new Error('source text requires a local interactive TTY');
  }
  if (typeof gitResolve !== 'function' || typeof openDb !== 'function') {
    throw new TypeError('read-only dependencies required');
  }
  const input = parseEvidenceDecisionPreflightArgs([
    '--db-path', dbPath, '--repo-path', repoPath, '--project-id', projectId,
    '--branch', branch, '--revision', revisionSha, '--proposal-ref', selectedRef,
    ...(expectedSnapshot ? ['--expected-snapshot', expectedSnapshot] : []),
    ...(showLocalContent ? ['--show-local-content'] : []),
  ]);
  const context = gitResolve(input.repoPath);
  if (!context || context.projectId !== projectId
    || context.branch !== branch || context.revisionSha !== revisionSha) {
    throw new Error('project, branch or current Git revision mismatch');
  }
  const db = openDb(input.dbPath);
  let opened = false;
  try {
    db.exec('PRAGMA query_only = ON');
    db.exec('BEGIN');
    opened = true;
    const report = inspectEvidenceBoundDecision({
      db, projectId, branch, revisionSha, selectedRef, showLocalContent,
    });
    const status = expectedSnapshot && report.reviewSnapshotSha256 !== expectedSnapshot
      ? { ...report, status: 'snapshot_changed', promotionAllowed: false, decisionCommandEnabled: false }
      : report;
    db.exec('COMMIT');
    opened = false;
    return status;
  } finally {
    if (opened) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    db.close();
  }
}

const runningAsMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (runningAsMain) {
  try {
    const report = runEvidenceDecisionPreflight(
      parseEvidenceDecisionPreflightArgs(process.argv.slice(2)),
    );
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status !== 'reviewable_no_write_authority'
      && report.status !== 'requires_review') process.exitCode = 2;
  } catch {
    // Never print private paths, source text or raw DB errors.
    process.stderr.write('Evidence-Bound review unavailable: inspect exact local scope and options.\n');
    process.exitCode = 2;
  }
}
