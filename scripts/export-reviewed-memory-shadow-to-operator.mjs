#!/usr/bin/env node
/**
 * Explicit LOCAL operator transfer of one fully reviewed ~p candidate.
 *
 * Both ~p and E~ are opaque hashes of the SAME original proposal ID.
 * No SQL update, no authority upgrade, no approval. The exported SQLite is a
 * complete private user-writable Shadow snapshot, NOT canonical trusted data.
 * The service may only import it as operator-pinned UNVERIFIED PENDING.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

import { requireIsolatedShadow } from './extract-memory-shadow-evidence.mjs';
import { evidenceBoundDecisionRef } from '../memory-engine/evidence-bound-decision-preflight.mjs';
import { resolveGitContext } from '../memory-engine/git-freshness.mjs';
import { resolveGitRepositoryIdentity } from '../memory-engine/repository-identity.mjs';
import { exportProtectedEvidenceReview } from './export-protected-evidence-review.mjs';

const REF = /^~p[0-9a-f]{12}$/u;
const opaque = id => '~p' + createHash('sha256').update(id,'utf8').digest('hex').slice(0,12);

export function parseReviewedShadowTransferArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('arguments required');
  const names = new Map([
    ['--shadow-db', 'dbPath'],
    ['--repo-path', 'repoPath'],
    ['--proposal-ref', 'proposalRef'],
    ['--decision', 'decision'],
    ['--output-dir', 'outputDir'],
  ]);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = names.get(argv[i]);
    const value = argv[++i];
    if (!key || Object.hasOwn(result, key)
      || typeof value !== 'string' || !value.trim()
      || value.trim() !== value) {
      throw new Error('invalid or duplicate shadow transfer option');
    }
    result[key] = value;
  }
  if (!['dbPath','repoPath','proposalRef','decision','outputDir'].every(key => result[key])) {
    throw new Error('exact shadow source, repo, ref, decision and destination required');
  }
  for (const key of ['dbPath','repoPath','outputDir']) {
    if (!isAbsolute(result[key])) throw new Error('absolute paths required');
    result[key] = resolve(result[key]);
  }
  if (!REF.test(result.proposalRef)
      || !['confirm','reject'].includes(result.decision)) {
    throw new Error('invalid reference or decision');
  }
  return result;
}

export function resolveReviewedShadowAlias({
  dbPath, repoPath, proposalRef,
  localAppData = process.env.LOCALAPPDATA,
  getGitContext = resolveGitContext,
  resolveIdentity = resolveGitRepositoryIdentity,
} = {}) {
  requireIsolatedShadow(dbPath, { localAppData });
  if (!REF.test(proposalRef ?? '') || !existsSync(repoPath)) {
    throw new Error('missing shadow ref or repository');
  }
  const git = getGitContext({ cwd: repoPath });
  const identity = resolveIdentity({
    repoPath: git.repoPath,
    execFile: (program, args) => execFileSync(program, args, {
      encoding: 'utf8', windowsHide: true, timeout: 3000,
      maxBuffer: 65536, stdio: ['ignore','pipe','pipe'],
    }),
  });
  const projectId = identity.projectId;
  const branch = git.branch;
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only=ON');
    const rows = db.prepare(
      "SELECT id, status FROM memory_evidence_proposals "
      + "WHERE project_id=? AND branch=? AND status='pending' "
      + "ORDER BY id LIMIT 10001",
    ).all(projectId, branch);
    if (rows.length > 10000) throw new Error('too many open shadow refs');
    const selected = rows.filter(p => opaque(p.id) === proposalRef);
    if (selected.length !== 1) throw new Error('shadow ref not unique in current Git scope');
    return Object.freeze({
      projectId, branch, revisionSha: git.revisionSha,
      shadowRef: proposalRef,
      evidenceRef: evidenceBoundDecisionRef(selected[0].id),
    });
  } finally { db.close(); }
}

export async function exportReviewedShadowToOperator({
  dbPath, repoPath, proposalRef, decision, outputDir,
  localAppData = process.env.LOCALAPPDATA,
  exportReview = exportProtectedEvidenceReview,
  resolveAlias = resolveReviewedShadowAlias,
} = {}) {
  const args = parseReviewedShadowTransferArgs([
    '--shadow-db', dbPath, '--repo-path', repoPath,
    '--proposal-ref', proposalRef, '--decision', decision,
    '--output-dir', outputDir,
  ]);
  const source = resolveAlias({ ...args, localAppData });
  const exported = await exportReview({
    dbPath: args.dbPath, repoPath: args.repoPath,
    proposalRef: source.evidenceRef,
    decision: args.decision, outputDir: args.outputDir,
  });
  if (exported.proposalRef !== source.evidenceRef
    || exported.projectId !== source.projectId
    || exported.branch !== source.branch
    || exported.revisionSha !== source.revisionSha
    || exported.humanApprovalVerified !== false
    || exported.claimWritten !== false
    || exported.protectedServiceImportCompleted !== false) {
    throw new Error('shadow operator transfer invariants violated');
  }
  return {
    status: 'shadow_operator_transfer_prepared_unverified_unapproved',
    scope: { projectId: source.projectId, branch: source.branch },
    sourceRef: source.shadowRef,
    operatorRef: source.evidenceRef,
    factSha256: exported.factSha256,
    gitRevision: source.revisionSha,
    sourceIsUserWritableShadow: true,
    completePrivateDatabaseExported: true,
    sourceOutputDirectory: exported.sourceOutputDirectory,
    modelCalls: 0,
    originalShadowModifiedByTool: false,
    canonicalSourceDatabaseModifiedByTool: false,
    humanApprovalVerified: false,
    claimWritten: false,
    protectedServiceImportCompleted: false,
    note: 'Exact original ID has two opaque aliases; untrusted full SQLite backup is for deliberate admin-controlled pending import only. No automatic installation or authority.',
  };
}

const main = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (main) {
  try {
    const out = await exportReviewedShadowToOperator({
      ...parseReviewedShadowTransferArgs(process.argv.slice(2)),
    });
    process.stdout.write(JSON.stringify(out,null,2)+'\n');
  } catch {
    process.stderr.write(
      'Shadow operator transfer unavailable. No Claim, approval, or source DB change.\n',
    );
    process.exitCode = 2;
  }
}
