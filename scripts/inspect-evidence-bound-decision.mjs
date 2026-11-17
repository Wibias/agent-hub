#!/usr/bin/env node
/** Read-only, exact-checkout Evidence-Bound review preflight. NO mutation flags. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveGitContext } from '../memory-engine/git-freshness.mjs';
import { resolveGitRepositoryIdentity } from '../memory-engine/repository-identity.mjs';
import {
  inspectEvidenceBoundDecision, evidenceBoundDecisionRef,
} from '../memory-engine/evidence-bound-decision-preflight.mjs';

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

/**
 * Historical review mode never invents a current Git branch. It resolves one
 * exact original user_direct session Evidence record in a read-only DB and
 * checks that its pinned commit is a real object in the named Git repository.
 * A user-writable source is still UNAUTHENTICATED; this only establishes
 * consistency of provenance fields, not the identity of the human author.
 */
function verifyHistoricalEvidence(db, {
  repoPath, projectId, branch, revisionSha, selectedRef,
}) {
  const commitType = String(execFileSync('git', [
    '-C', repoPath, 'cat-file', '-t', revisionSha,
  ], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
    maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
  if (commitType !== 'commit') throw new Error('historical commit unavailable');
  const proposals = db.prepare(
    'SELECT id FROM memory_evidence_proposals '
    + 'WHERE project_id=? AND branch=? ORDER BY id LIMIT 10001',
  ).all(projectId, branch);
  if (proposals.length > 10000) throw new Error('too many historical proposals');
  const matches = proposals.filter(p => evidenceBoundDecisionRef(p.id) === selectedRef);
  if (matches.length !== 1) throw new Error('historical proposal not unique');
  const rows = db.prepare(
    'SELECT e.id, e.project_id, e.branch, e.commit_sha, '
    + 'e.source_kind, e.authority_class '
    + 'FROM memory_evidence_proposal_evidence l '
    + 'JOIN evidence e ON e.id=l.evidence_id '
    + 'WHERE l.proposal_id=? ORDER BY e.id',
  ).all(matches[0].id);
  // Narrow special case: a single session-scoped, user_direct statement
  // explicitly pinned to the exact historic revision. No mixed source sets.
  if (rows.length !== 1 || rows[0].project_id !== projectId
      || rows[0].branch !== branch || rows[0].commit_sha !== revisionSha
      || rows[0].source_kind !== 'session'
      || rows[0].authority_class !== 'user_direct') {
    throw new Error('historical source metadata does not match pinned scope');
  }
  const digest = createHash('sha256').update(
    JSON.stringify([rows[0].id, projectId, branch, revisionSha,
      rows[0].source_kind, rows[0].authority_class]),
  ).digest('hex');
  return Object.freeze({
    status: 'historical_user_direct_metadata_consistent_unverified',
    projectId, branch, revisionSha,
    sourceEvidenceCount: 1, provenanceSha256: digest,
    identityAuthenticated: false, claimAuthorized: false,
  });
}

export function runEvidenceDecisionPreflight({
  dbPath, repoPath, projectId, branch, revisionSha, selectedRef,
  expectedSnapshot = undefined,
  historicalSource = null,
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
      || (historicalSource !== null
        && typeof context.repoPath !== 'string')) {
    throw new Error('current checkout project identity mismatch');
  }
  if (historicalSource === null) {
    if (context.branch !== branch || context.revisionSha !== revisionSha)
      throw new Error('project, branch or current Git revision mismatch');
  } else if (!historicalSource || typeof historicalSource !== 'object'
      || historicalSource.branch !== branch
      || historicalSource.revisionSha !== revisionSha
      || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u.test(branch)
      || branch.includes('..') || branch.includes('//')
      || !/^[0-9a-f]{40}$/u.test(revisionSha)) {
    throw new Error('explicit historical branch/commit pin required');
  }
  const db = openDb(input.dbPath);
  let opened = false;
  try {
    db.exec('PRAGMA query_only = ON');
    db.exec('BEGIN');
    opened = true;
    const provenance = historicalSource === null ? null
      : verifyHistoricalEvidence(db, {
        repoPath: context.repoPath, projectId, branch, revisionSha, selectedRef,
      });
    const report = inspectEvidenceBoundDecision({
      db, projectId, branch, revisionSha, selectedRef, showLocalContent,
    });
    const base = provenance === null ? report
      : { ...report, historicalProvenance: provenance,
          currentCheckout: { branch: context.branch,
            revisionSha: context.revisionSha },
          hostUserOriginAuthenticated: false,
          promotionAllowed: false, decisionCommandEnabled: false };
    const status = expectedSnapshot && base.reviewSnapshotSha256 !== expectedSnapshot
      ? { ...base, status: 'snapshot_changed', promotionAllowed: false, decisionCommandEnabled: false }
      : base;
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
