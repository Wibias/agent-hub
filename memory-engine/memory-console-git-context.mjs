/**
 * D5: trusted, stateless repository freshness for the read-only Memory Console.
 * Git roots are configured at server startup, never selected by HTTP clients.
 * The immutable HEAD tree is checked directly without updating SQLite state.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { realpath as realpathAsync } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gitBlobOid, resolveGitContext } from './git-freshness.mjs';
import { resolveGitRepositoryIdentity } from './repository-identity.mjs';

const MAX_ROOTS = 16;
const MAX_GRAPH_NODES = 500;
const BLOB_BATCH = 24;
const gitExecAsync = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/i;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

function executeGit(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2500, maxBuffer: 64 * 1024, windowsHide: true,
  });
}

/** Spawn Git without blocking the HTTP event loop; cap each command's runtime/output. */
async function executeGitAsync(command, args) {
  const result = await gitExecAsync(command, args, {
    encoding: 'utf8', windowsHide: true, timeout: 2500, maxBuffer: 1024 * 1024,
  });
  return result.stdout;
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
      // Catch a checkout switch that happened after the initial branch read.
      const branchAgain = String(execFile('git', ['-C', context.repoPath, 'branch', '--show-current'])).trim();
      const headAgain = String(execFile('git', ['-C', context.repoPath, 'rev-parse', 'HEAD'])).trim();
      if (branchAgain !== context.branch || headAgain.toLowerCase() !== context.revisionSha.toLowerCase()) {
        branchMismatch = true;
        continue;
      }
      if (matches.some((item) => sameRoot(item.repoPath, context.repoPath, realpath))) continue;
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
    && !path.startsWith(':') && !/[*?\[\]]/.test(path)
    && !path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

/**
 * Wrap only read methods required by Graph v2. The in-memory materializeRecall
 * adapter independently verifies committed blobs, not the database freshness cache.
 * No canonical memory, repository state, or Recall implementation is modified.
 */
export function createReadOnlyGitGraphView(memory, {
  projectId, branch, scope, execFile = executeGit, canonicalSnapshot = null, blobOids = null,
} = {}) {
  if (!memory || typeof memory.exportCanonical !== 'function'
      || typeof memory.inspectClaimObservability !== 'function'
      || typeof memory.listTypedRelations !== 'function') {
    throw new TypeError('MemoryEngine read methods are required');
  }
  if (!scope || scope.status !== 'verified' || !SHA.test(scope.revisionSha)
      || typeof scope.repoPath !== 'string' || !scope.repoPath) {
    throw new TypeError('a verified server-side Git checkout is required');
  }
  const canonical = canonicalSnapshot ?? memory.exportCanonical();
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
        if (blobOids instanceof Map) {
          // The HTTP path supplies pre-fetched immutable-tree blobs, never sync Git.
          blobs.set(e.path, blobOids.get(e.path) ?? null);
        } else {
          try {
            blobs.set(e.path, gitBlobOid({
              repoPath: scope.repoPath, revisionSha: scope.revisionSha, path: e.path, execFile,
            }));
          } catch {
            blobs.set(e.path, null);
          }
        }
      }
      accepted = blobs.get(e.path) !== null
        && String(blobs.get(e.path)).toLowerCase() === e.blob_oid.toLowerCase();
    }
    observed.set(id, accepted);
    return accepted;
  }

  const view = {
    exportCanonical: () => canonical,
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


/** Inspect one approved checkout using only asynchronous Git subprocesses. */
async function inspectCheckoutAsync(root, { execGit, realpath }) {
  const command = async (...args) => String(await execGit('git', ['-C', root, ...args])).trim();
  const repoPath = await command('rev-parse', '--show-toplevel');
  const [approvedPath, actualPath] = await Promise.all([realpath(root), realpath(repoPath)]);
  if ((process.platform === 'win32' ? approvedPath.toLowerCase() : approvedPath)
      !== (process.platform === 'win32' ? actualPath.toLowerCase() : actualPath)) return null;
  const branch = await command('branch', '--show-current');
  if (!branch) return null;
  const revisionSha = await command('rev-parse', 'HEAD');
  if (!SHA.test(revisionSha)) return null;

  // Reuse the existing canonical identity resolver with asynchronously captured
  // answers. Never invoke its sync Git runner on the HTTP request path.
  const known = new Map();
  const probe = async (args) => {
    try { known.set(args.join('\0'), await execGit('git', ['-C', repoPath, ...args])); }
    catch { /* Missing local identity/remote is expected for some repositories. */ }
  };
  const local = ['config', '--local', '--get', 'agent-hub.project-id'];
  const remote = ['remote', 'get-url', 'origin'];
  const roots = ['rev-list', '--max-parents=0', 'HEAD'];
  await probe(local);
  if (!String(known.get(local.join('\0')) ?? '').trim()) await probe(remote);
  if (!String(known.get(local.join('\0')) ?? '').trim()
      && !String(known.get(remote.join('\0')) ?? '').trim()) await probe(roots);
  const identity = resolveGitRepositoryIdentity({
    repoPath,
    execFile(_command, args) {
      const key = args.slice(2).join('\0');
      if (!known.has(key)) throw new Error('Git identity probe unavailable');
      return known.get(key);
    },
  });

  // Recheck HEAD and branch after identity reads to reduce checkout-switch races.
  const finalBranch = await command('branch', '--show-current');
  const finalHead = await command('rev-parse', 'HEAD');
  if (branch !== finalBranch || revisionSha.toLowerCase() !== finalHead.toLowerCase()) {
    return { changed: true };
  }
  return { repoPath, branch, revisionSha, identity };
}

/**
 * Resolve Git checkout trust outside the Node.js event loop. All root
 * candidates are examined, with a maximum of four Git scans at once.
 */
export async function resolveMemoryConsoleGitScopeAsync({
  memory, projectId, branch, repositoryRoots = [],
  execGit = executeGitAsync, realpath = realpathAsync,
} = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()
      || typeof branch !== 'string' || !branch.trim()) {
    throw new TypeError('projectId and branch are required');
  }
  if (!memory || typeof memory.getProject !== 'function') {
    throw new TypeError('registered MemoryEngine project lookup is required');
  }
  const roots = normalizeRepositoryRoots(repositoryRoots);
  const unchecked = (status) => ({ status, revisionSha: null, repoPath: null });
  if (!roots.length) return unchecked('unconfigured');
  const project = memory.getProject(projectId);
  if (!project) return unchecked('unbound');
  if (typeof execGit !== 'function' || typeof realpath !== 'function') {
    throw new TypeError('async Git execution and filesystem resolution are required');
  }

  let nextRoot = 0;
  const results = new Array(roots.length);
  async function worker() {
    while (nextRoot < roots.length) {
      const index = nextRoot++;
      try {
        results[index] = await inspectCheckoutAsync(roots[index], { execGit, realpath });
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, roots.length) }, () => worker()));
  const matches = [];
  const canonicalPaths = new Set();
  let branchMismatch = false;
  for (const result of results) {
    if (!result) continue;
    if (result.changed) { branchMismatch = true; continue; }
    const identity = result.identity;
    if (identity.projectId !== project.project_id
        || identity.repoIdentity !== project.repo_identity
        || (project.canonical_remote != null && identity.canonicalRemote !== project.canonical_remote)) {
      continue;
    }
    if (result.branch !== branch) { branchMismatch = true; continue; }
    const real = await realpath(result.repoPath);
    const key = process.platform === 'win32' ? real.toLowerCase() : real;
    if (canonicalPaths.has(key)) continue;
    canonicalPaths.add(key);
    matches.push(result);
  }
  if (matches.length > 1) return unchecked('ambiguous');
  if (!matches.length) return unchecked(branchMismatch ? 'branch_mismatch' : 'unbound');
  return { status: 'verified', revisionSha: matches[0].revisionSha, repoPath: matches[0].repoPath };
}

function sortGraphClaims(a, b) {
  const aActive = a.state === 'active' ? 1 : 0;
  const bActive = b.state === 'active' ? 1 : 0;
  const date = (value) => { const n = Date.parse(value ?? ''); return Number.isFinite(n) ? n : 0; };
  return bActive - aActive || date(b.created_at) - date(a.created_at)
    || String(a.id).localeCompare(String(b.id), 'en');
}

/** Parse a Git ls-tree batch, retaining only regular executable/non-executable blobs. */
function parseBatchBlobs(output, requested) {
  const result = new Map();
  for (const record of String(output).split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const fields = record.slice(0, tab).split(' ');
    if (fields.length !== 3) continue;
    const [mode, type, oid] = fields;
    const path = record.slice(tab + 1);
    if (!requested.has(path) || !['100644', '100755'].includes(mode)
        || type !== 'blob' || !OID.test(oid)) continue;
    result.set(path, oid.toLowerCase());
  }
  return result;
}

/**
 * Pre-fetch at most 500 graph-selected canonical paths in bounded Git batches.
 * A failed batch remains unverified. Both the graph and eligibility checks then
 * consume the same captured export; no per-path synchronous Git calls occur.
 */
export async function createAsyncGitGraphView(memory, {
  projectId, branch, scope, execGit = executeGitAsync,
} = {}) {
  if (!scope || scope.status !== 'verified') {
    throw new TypeError('a verified server-side Git checkout is required');
  }
  const canonical = memory.exportCanonical();
  const evidenceById = new Map((canonical.evidence ?? []).map((e) => [e.id, e]));
  const scopedClaims = (canonical.claims ?? [])
    .filter((claim) => claim.project_id === projectId && claim.branch_scope === branch)
    .sort(sortGraphClaims).slice(0, MAX_GRAPH_NODES);
  const paths = [...new Set(scopedClaims
    .map((claim) => evidenceById.get(claim.created_from_evidence_id))
    .filter((e) => e && e.project_id === projectId && e.branch === branch
      && safeGitFilePath(e.path) && typeof e.blob_oid === 'string' && OID.test(e.blob_oid))
    .map((e) => e.path))];
  const blobOids = new Map();
  const chunks = [];
  for (let index = 0; index < paths.length; index += BLOB_BATCH) {
    chunks.push(paths.slice(index, index + BLOB_BATCH));
  }
  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++];
      try {
        const output = await execGit('git', [
          '-C', scope.repoPath, 'ls-tree', '-z', scope.revisionSha, '--', ...chunk,
        ]);
        const parsed = parseBatchBlobs(output, new Set(chunk));
        for (const [path, oid] of parsed) blobOids.set(path, oid);
      } catch {
        // Any inaccessible path or Git failure stays stale; no DB fallback.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, () => worker()));
  return createReadOnlyGitGraphView(memory, {
    projectId, branch, scope, canonicalSnapshot: canonical, blobOids,
  });
}

/** Make a public, path-free status object for the browser. */
export function publicMemoryConsoleGitScope(scope) {
  return Object.freeze({
    status: scope.status,
    revisionSha: scope.status === 'verified' ? scope.revisionSha : null,
    source: scope.status === 'verified' ? 'server_configured_checkout' : null,
  });
}
