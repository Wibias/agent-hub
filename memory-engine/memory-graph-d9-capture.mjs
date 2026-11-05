/**
 * D9: opt-in capture of exactly one committed regular Git file.
 * No source bytes or semantic conclusions are recorded as Memory Evidence.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveGitContext, gitBlobOid } from './git-freshness.mjs';
import { resolveGitRepositoryIdentity } from './repository-identity.mjs';

const SHA = /^[a-f0-9]{40}$/i;
const OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;

/** Do not let inherited Git overrides redirect read-only repository queries. */
function safeGit(command, args) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^GIT_/i.test(name)) delete env[name];
  }
  return execFileSync(command, args, {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
}

/** Match the graph's strict relative Git path contract. */
export function validD9FilePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 4096
    && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/')
    && !path.includes(':') && !/[*?\[\]]/.test(path)
    && !path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

/** Verify exact root, project identity, branch, stable HEAD and a clean tracked blob. */
export function verifyD9GitSelection({
  repoRoot, projectId, branch, path, execFile = safeGit,
} = {}) {
  for (const [value, name] of [[repoRoot, 'repoRoot'], [projectId, 'projectId'],
    [branch, 'branch'], [path, 'path']]) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(name + ' is required');
    }
  }
  if (!validD9FilePath(path)) throw new TypeError('invalid relative Git file path');
  const context = resolveGitContext({ cwd: repoRoot, execFile });
  const normalized = (value) => {
    const real = realpathSync(value);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  if (normalized(resolve(repoRoot)) !== normalized(context.repoPath)) {
    throw new Error('checkout root mismatch');
  }
  const identity = resolveGitRepositoryIdentity({ repoPath: context.repoPath, execFile });
  if (identity.projectId !== projectId || identity.repoIdentity !== projectId) {
    throw new Error('repository identity mismatch');
  }
  if (context.branch !== branch || !SHA.test(context.revisionSha)) {
    throw new Error('branch or revision mismatch');
  }
  const clean = () => String(execFile('git', ['-C', context.repoPath,
    'status', '--porcelain=v1', '--untracked-files=all', '--', path])).length === 0;
  if (!clean()) throw new Error('selected file has uncommitted changes');
  const blobOid = gitBlobOid({
    repoPath: context.repoPath, revisionSha: context.revisionSha, path, execFile,
  });
  if (!blobOid || !OID.test(blobOid)) throw new Error('selected path is not a regular committed blob');
  // A later checkout switch must invalidate the observation before it can write.
  const finalBranch = String(execFile('git', ['-C', context.repoPath, 'branch', '--show-current'])).trim();
  const finalHead = String(execFile('git', ['-C', context.repoPath, 'rev-parse', 'HEAD'])).trim();
  if (finalBranch !== context.branch || finalHead.toLowerCase() !== context.revisionSha.toLowerCase()
      || !clean()) {
    throw new Error('Git selection changed during verification');
  }
  return Object.freeze({
    projectId, branch, path, revisionSha: context.revisionSha.toLowerCase(),
    blobOid: blobOid.toLowerCase(), repoIdentity: identity.repoIdentity,
    canonicalRemote: identity.canonicalRemote,
  });
}

/**
 * Capture an existence observation only, not a claim about source semantics.
 * write=false requires no MemoryEngine mutation; write=true requires an explicit
 * writable MemoryEngine supplied by the operator.
 */
export function captureD9RepositoryFile({
  memory, repoRoot, projectId, branch, path, write = false, execFile = safeGit,
} = {}) {
  if (!memory || typeof memory.getProject !== 'function'
      || typeof memory.getEvidence !== 'function' || typeof memory.getClaim !== 'function') {
    throw new TypeError('MemoryEngine lookup required');
  }
  if (typeof write !== 'boolean') throw new TypeError('write must be boolean');
  const project = memory.getProject(projectId);
  if (!project || !project.repo_identity) throw new Error('registered repository identity required');
  const selected = verifyD9GitSelection({ repoRoot, projectId, branch, path, execFile });
  if (project.project_id !== selected.projectId || project.repo_identity !== selected.repoIdentity
      || (project.canonical_remote !== null && project.canonical_remote !== selected.canonicalRemote)) {
    throw new Error('registered project does not match verified checkout');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([
    selected.projectId, selected.branch, selected.path, selected.revisionSha, selected.blobOid,
  ])).digest('hex');
  const evidenceId = 'd9-e-' + fingerprint;
  const claimId = 'd9-c-' + fingerprint;
  const existingClaim = memory.getClaim(claimId);
  const existingEvidence = memory.getEvidence(evidenceId);
  if (existingClaim || existingEvidence) {
    if (!existingClaim || !existingEvidence
        || existingClaim.created_from_evidence_id !== evidenceId
        || existingClaim.project_id !== projectId || existingClaim.branch_scope !== branch
        || existingEvidence.project_id !== projectId || existingEvidence.branch !== branch
        || existingEvidence.path !== path
        || existingEvidence.commit_sha?.toLowerCase() !== selected.revisionSha
        || existingEvidence.blob_oid?.toLowerCase() !== selected.blobOid
        || existingEvidence.authority_class !== 'repo_trusted'
        || existingEvidence.source_kind !== 'repository') {
      throw new Error('existing D9 record does not match immutable observation');
    }
    return { schemaVersion: 1, mode: write ? 'write' : 'dry_run',
      outcome: 'already_recorded', recorded: false, repositoryVerified: true };
  }
  if (!write) return { schemaVersion: 1, mode: 'dry_run',
    outcome: 'ready', recorded: false, repositoryVerified: true };
  if (typeof memory.ingest !== 'function') throw new TypeError('writable MemoryEngine required');
  // Recheck branch/HEAD and selected file immediately before the database write.
  const again = verifyD9GitSelection({ repoRoot, projectId, branch, path, execFile });
  if (again.revisionSha !== selected.revisionSha || again.blobOid !== selected.blobOid) {
    throw new Error('Git selection changed before write');
  }
  const at = new Date().toISOString();
  memory.ingest({
    evidence: {
      id: evidenceId, projectId, harness: 'd9-explicit-capture',
      sourceKind: 'repository', sourceRef: path, capturedAt: at,
      branch, commitSha: selected.revisionSha, path, blobOid: selected.blobOid,
      authorityClass: 'repo_trusted',
      content: 'Selected regular Git blob exists in the committed tree.',
      metadata: { captureVersion: 1, sourceContentsStored: false },
    },
    claim: {
      id: claimId, kind: 'code_observation', subject: 'selected Git file',
      predicate: 'exists_at_committed_revision', value: 'regular tracked Git blob',
      state: 'active', branchScope: branch, createdAt: at,
    },
  });
  return { schemaVersion: 1, mode: 'write',
    outcome: 'captured', recorded: true, repositoryVerified: true };
}
