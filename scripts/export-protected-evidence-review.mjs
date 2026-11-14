#!/usr/bin/env node
/**
 * Export an exact real E~ proposal as a CONSISTENT, read-only canonical
 * SQLite snapshot for eventual elevated operator pinning in LocalService.
 * This is a SOURCE-TRANSFER tool, NOT a Windows Hello enrollment or Claim
 * approval. Never execute elevated from an agent-writable checkout.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGitContext } from '../memory-engine/git-freshness.mjs';
import { resolveGitRepositoryIdentity } from '../memory-engine/repository-identity.mjs';
import { runEvidenceDecisionPreflight } from './inspect-evidence-bound-decision.mjs';

export const EVIDENCE_SNAPSHOT_NAME = 'operator-evidence-snapshot.sqlite3';
export const EVIDENCE_MANIFEST_NAME = 'operator-evidence-manifest.json';

export function parseOperatorEvidenceExportArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argument array required');
  const opts = {};
  const flags = {
    '--db-path': 'dbPath', '--repo-path': 'repoPath',
    '--proposal-ref': 'proposalRef', '--decision': 'decision',
    '--output-dir': 'outputDir',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags[argv[i]];
    const value = argv[i + 1];
    if (!key || Object.hasOwn(opts, key)
        || typeof value !== 'string' || !value.trim()
        || value !== value.trim()) throw new Error('invalid_export_argument');
    opts[key] = value;
  }
  if (!['dbPath','repoPath','proposalRef','decision','outputDir']
    .every(key => typeof opts[key] === 'string')) {
    throw new Error('complete_export_arguments_required');
  }
  if (!/^E~[0-9a-f]{10}$/u.test(opts.proposalRef)
      || !['confirm','reject'].includes(opts.decision)) {
    throw new Error('invalid_review_ref_or_action');
  }
  for (const key of ['dbPath','repoPath','outputDir']) {
    if (!isAbsolute(opts[key])) throw new Error('absolute_path_required');
    opts[key] = resolve(opts[key]);
  }
  return Object.freeze(opts);
}

function currentGit(repoPath) {
  const git = resolveGitContext({ cwd: repoPath });
  const identity = resolveGitRepositoryIdentity({
    repoPath: git.repoPath,
    execFile: (command, args) => execFileSync(command, args, {
      encoding: 'utf8', windowsHide: true, timeout: 3000,
      maxBuffer: 64 * 1024, stdio: ['ignore','pipe','pipe'],
    }),
  });
  return Object.freeze({
    root: git.repoPath, branch: git.branch,
    revisionSha: git.revisionSha, projectId: identity.projectId,
  });
}

function reviewable(report) {
  return report
    && ['requires_review','reviewable_no_write_authority'].includes(report.status)
    && report.scope?.revisionSha
    && ['knowledge','preference'].includes(report.kind)
    && report.activeClaimsInScope === 0
    && report.exactDuplicateCount === 0
    && [null,'unrelated'].includes(report.relation?.type)
    && Array.isArray(report.evidence) && report.evidence.length >= 1
    && report.evidence.length <= 10
    && /^[0-9a-f]{64}$/u.test(report.reviewSnapshotSha256 ?? '')
    && /^[0-9a-f]{64}$/u.test(report.canonicalFactHash ?? '');
}

/**
 * Operator intent only. Importing the exported files into protected state
 * STILL does not establish trusted human approval or Windows Hello.
 */
export async function exportProtectedEvidenceReview({
  dbPath, repoPath, proposalRef, decision, outputDir,
  sqliteBackup = backup,
} = {}) {
  const opts = parseOperatorEvidenceExportArgs([
    '--db-path', dbPath, '--repo-path', repoPath,
    '--proposal-ref', proposalRef, '--decision', decision,
    '--output-dir', outputDir,
  ]);
  if (!existsSync(opts.dbPath) || !existsSync(opts.repoPath)
      || existsSync(opts.outputDir)) {
    throw new Error('input_missing_or_export_directory_already_exists');
  }
  const firstGit = currentGit(opts.repoPath);
  const context = {
    dbPath: opts.dbPath,
    repoPath: firstGit.root,
    projectId: firstGit.projectId,
    branch: firstGit.branch,
    revisionSha: firstGit.revisionSha,
    selectedRef: opts.proposalRef,
    showLocalContent: false,
    isTty: false,
  };
  const before = runEvidenceDecisionPreflight(context);
  if (!reviewable(before)) {
    throw new Error('source_proposal_requires_separate_review_or_is_unavailable');
  }
  // No copy into ProgramData by this unprivileged source exporter. Use the
  // SQLite backup API, never copy a live WAL database file as raw bytes.
  mkdirSync(opts.outputDir, { recursive: false, mode: 0o700 });
  const snapshotPath = join(opts.outputDir, EVIDENCE_SNAPSHOT_NAME);
  const input = new DatabaseSync(opts.dbPath, { readOnly: true, timeout: 5000 });
  try {
    input.exec('PRAGMA query_only=ON');
    await sqliteBackup(input, snapshotPath);
  } finally {
    input.close();
  }

  // Re-evaluate from the CONSISTENT COPY, and independently re-read Git.
  // If source changed during export, do not create a usable manifest.
  const after = runEvidenceDecisionPreflight({
    ...context, dbPath: snapshotPath,
    expectedSnapshot: before.reviewSnapshotSha256,
  });
  const secondGit = currentGit(opts.repoPath);
  const current = runEvidenceDecisionPreflight({
    ...context, expectedSnapshot: before.reviewSnapshotSha256,
  });
  if (!reviewable(after) || !reviewable(current)
      || before.reviewSnapshotSha256 !== current.reviewSnapshotSha256
      || before.reviewSnapshotSha256 !== after.reviewSnapshotSha256
      || before.canonicalFactHash !== after.canonicalFactHash
      || firstGit.projectId !== secondGit.projectId
      || firstGit.branch !== secondGit.branch
      || firstGit.revisionSha !== secondGit.revisionSha
      || firstGit.root !== secondGit.root) {
    throw new Error('evidence_or_git_changed_during_export_manifest_not_created');
  }
  // Five exact fields. No paths or credentials in the elevated-service
  // manifest. A later independently authorized operator action must pin
  // these files; this command is NEVER proof of user approval.
  writeFileSync(join(opts.outputDir, EVIDENCE_MANIFEST_NAME),
    JSON.stringify({
      projectId: firstGit.projectId,
      branch: firstGit.branch,
      revisionSha: firstGit.revisionSha,
      proposalRef: opts.proposalRef,
      decision: opts.decision,
    }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });

  return Object.freeze({
    status: 'operator_transfer_ready_unverified_unapproved',
    proposalRef: opts.proposalRef,
    projectId: firstGit.projectId,
    branch: firstGit.branch,
    revisionSha: firstGit.revisionSha,
    factSha256: after.canonicalFactHash,
    consoleReviewSnapshotSha256: after.reviewSnapshotSha256,
    evidenceCount: after.evidence.length,
    sourceOutputDirectory: opts.outputDir,
    humanApprovalVerified: false,
    claimWritten: false,
    protectedServiceImportCompleted: false,
  });
}

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const report = await exportProtectedEvidenceReview(
      parseOperatorEvidenceExportArgs(process.argv.slice(2)),
    );
    process.stdout.write(JSON.stringify(report) + '\n');
  } catch {
    // User content, DB paths and raw Git diagnostics must not be echoed.
    process.stderr.write('E~ export unavailable or changed; no approval or Claim created.\n');
    process.exitCode = 2;
  }
}
