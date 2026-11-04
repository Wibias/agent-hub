/**
 * D5: trusted, stateless repository freshness for the read-only Memory Console.
 * Git roots are configured at server startup, never selected by HTTP clients.
 * The immutable HEAD tree is checked directly without updating SQLite state.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { gitBlobOid, resolveGitContext } from './git-freshness.mjs';
import { resolveGitRepositoryIdentity } from './repository-identity.mjs';

const MAX_ROOTS = 16;
const SHA = /^[0-9a-f]{40}$/i;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

function executeGit(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2500, maxBuffer: 64 * 1024, windowsHide: true,
  });
}

/** Accept only a bounded explicit allowlist of server-operator repository roots. */
export function normalizeRepositoryRoots(roots) {
  if (!Array.isArray(roots) || roots.length > MAX_ROOTS
      || roots.some((root) => typeof root !== 'string' || !root.trim() || root.includes('\0'))) {
    throw new TypeError('repositoryRoots must be at most 16 non-empty paths');
  }
  const normalized = roots.map((root) => resolve(root));
  if (new Set(normalized.map((root) => process.platform === 'win32' ? root.toLowerCase() : root)).size !== normalized.length) {
    throw new Error('duplicate repository root is not allowed');
  }
  return Object.freeze(normalized);
}

/** Compare canonical filesystem paths without treating a subdirectory as a trusted repository root. */
function sameRoot(left, right, realpath) {
  const a = realpath(left);
  const b = realpath(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Determine the server-controlled checkout whose identity and branch match the canonical scope. */
export function resolveMemoryConsoleGitScope({
  memory, projectId, branch, repositoryRoots = [],
  execFile = executeGit, realpath = realpathSync,
} = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()
      || typeof branch !== 'string' || !branch.trim()) {
    throw new TypeError('projectId and branch are required');
  }
  if (!memory || typeof memory.getProject !== 'function') {
    throw new TypeError('registered MemoryEngine project lookup is required');
  }
  if (typeof execFile !== 'function' || typeof realpath !== 'function') {
    throw new TypeError('Git execution and filesystem resolution must be functions');
  }
  const roots = normalizeRepositoryRoots(repositoryRoots);
  const unchecked = (status) => ({ status, revisionSha: null, repoPath: null });
  if (!roots.length) return unchecked('unconfigured');
  const project = memory.getProject(projectId);
  if (!project) return unchecked('unbound');
  const matches = [];
  let branchMismatch = false;
  for (const root of roots) {
    try {
      const context = resolveGitContext({ cwd: root, execFile });
      if (!sameRoot(root, context.repoPath, realpath)) continue;
      const identity = resolveGitRepositoryIdentity({ repoPath: context.repoPath, execFile });
      if (identity.projectId !== project.project_id
          || identity.repoIdentity !== project.repo_identity
          || (project.canonical_remote != null && identity.canonicalRemote !== project.canonical_remote)) {
        continue;
      }
      if (context.branch !== branch) {
        branchMismatch = true;
        continue;
      }
      if (!SHA.test(context.revisionSha)) continue;
      matches.push(context);
    } catch {
      // A deleted checkout, detached HEAD, or invalid Git identity cannot grant trust.
    }
  }
  if (matches.length > 1) return unchecked('ambiguous');
  if (matches.length === 1) {
    return { status: 'verified', revisionSha: matches[0].revisionSha, repoPath: matches[0].repoPath };
  }
  return unchecked(branchMismatch ? 'branch_mismatch' : 'unbound');
}

/** Ensure the Evidence path refers to exactly one regular file in a Git tree. */
function safeGitFilePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 4096
    && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/')
    && !path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

/**
 * Wrap only read methods required by Graph v2. The in-memory materializeRecall
 * adapter independently verifies committed blobs, not the database freshness cache.
 * No canonical memory, repository state, or Recall implementation is modified.
 */
export function createReadOnlyGitGraphView(memory, { projectId, branch, scope, execFile = executeGit } = {}) {
  if (!memory || typeof memory.exportCanonical !== 'function'
      || typeof memory.inspectClaimObservability !== 'function'
      || typeof memory.listTypedRelations !== 'function') {
    throw new TypeError('MemoryEngine read methods are required');
  }
  if (!scope || scope.status !== 'verified' || !SHA.test(scope.revisionSha)
      || typeof scope.repoPath !== 'string' || !scope.repoPath) {
    throw new TypeError('a verified server-side Git checkout is required');
  }
  const canonical = memory.exportCanonical();
  const evidence = new Map((canonical.evidence ?? []).map((item) => [item.id, item]));
  const claims = new Map((canonical.claims ?? [])
    .filter((item) => item.project_id === projectId && item.branch_scope === branch)
    .map((item) => [item.id, item]));
  const observed = new Map();
  const blobs = new Map();

  /** Revalidate exact canonical primary Evidence blob OIDs against immutable HEAD. */
  function eligible(id) {
    if (observed.has(id)) return observed.get(id);
    const claim = claims.get(id);
    const e = claim && evidence.get(claim.created_from_evidence_id);
    let accepted = false;
    if (e && e.project_id === projectId && e.branch === branch
        && safeGitFilePath(e.path) && typeof e.blob_oid === 'string' && OID.test(e.blob_oid)) {
      if (!blobs.has(e.path)) {
        try {
          blobs.set(e.path, gitBlobOid({
            repoPath: scope.repoPath, revisionSha: scope.revisionSha, path: e.path, execFile,
          }));
        } catch {
          blobs.set(e.path, null);
        }
      }
      accepted = blobs.get(e.path) !== null && blobs.get(e.path) === e.blob_oid;
    }
    observed.set(id, accepted);
    return accepted;
  }

  const view = {
    exportCanonical: () => memory.exportCanonical(),
    inspectClaimObservability: (options) => memory.inspectClaimObservability(options),
    listTypedRelations: (options) => memory.listTypedRelations(options),
    materializeRecall(options) {
      if (!options || options.projectId !== projectId || options.branch !== branch
          || options.revisionSha !== scope.revisionSha || options.mode !== 'current'
          || !Array.isArray(options.claimIds)) return { items: [] };
      const ids = [...new Set(options.claimIds)].filter((id) => typeof id === 'string' && eligible(id));
      return { items: ids.map((id) => ({ claim: { id } })) };
    },
  };
  if (typeof memory.getClaimEmbedding === 'function') {
    view.getClaimEmbedding = (options) => memory.getClaimEmbedding(options);
  }
  return Object.freeze(view);
}

/** Make a public, path-free status object for the browser. */
export function publicMemoryConsoleGitScope(scope) {
  return Object.freeze({
    status: scope.status,
    revisionSha: scope.status === 'verified' ? scope.revisionSha : null,
    source: scope.status === 'verified' ? 'server_configured_checkout' : null,
  });
}
