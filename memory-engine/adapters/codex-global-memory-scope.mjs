import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultCodexMemoryDbPath, resolveCodexProjectScope } from './codex-hook-cli-core.mjs';
import { readCodexMemory } from './codex-readonly-memory-mcp.mjs';
import { readPublishedProjectUserMemories } from './project-wide-user-memory.mjs';
import { enforceRecallBudget } from '../hybrid-retrieval.mjs';

const MAX_PROJECTS = 128;
const SCHEMA = 1;

function nonEmpty(s) { return typeof s === 'string' && s.trim().length > 0; }
function isRecord(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
export function samePath(a, b, platform = process.platform) {
  // Git for Windows may spell a checkout root differently from a direct
  // Node realpath (drive casing, junctions and path separators). Canonicalize
  // both sides before checking an approval or revocation.
  const canonical = (path) => {
    const absolute = resolve(path);
    let real;
    try { real = realpathSync(absolute); }
    catch { real = absolute; }
    return platform === 'win32'
      ? real.replaceAll('/', '\\').toLowerCase()
      : real;
  };
  if (canonical(a) === canonical(b)) return true;
  // Windows 8.3 aliases (e.g. RUNNER~1) may name the identical NTFS object
  // but do not necessarily expand through realpathSync. Compare exact file IDs.
  try {
    const left = statSync(a, { bigint: true });
    const right = statSync(b, { bigint: true });
    return left.ino !== 0n && left.ino === right.ino
      && left.dev === right.dev
      && left.isFile() === right.isFile()
      && left.isDirectory() === right.isDirectory();
  } catch {
    return false;
  }
}
function canonicalRoot(path) {
  if (!nonEmpty(path) || !isAbsolute(path)) throw new Error('absolute_path_required');
  return realpathSync(resolve(path));
}

export function defaultGlobalMemoryScopePath({
  env = process.env, platform = process.platform, homeDir = homedir(),
} = {}) {
  if (platform === 'win32') {
    const base = nonEmpty(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA : win32.join(homeDir, 'AppData', 'Local');
    return win32.join(base, 'agent-hub', 'codex-memory-scopes.json');
  }
  const state = nonEmpty(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME : join(homeDir, '.local', 'state');
  return join(state, 'agent-hub', 'codex-memory-scopes.json');
}

function checkFile(path) {
  if (!nonEmpty(path) || !isAbsolute(path)) throw new Error('invalid_scope_file');
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_scope_file');
  return true;
}

export function loadGlobalMemoryScope(scopePath) {
  if (!checkFile(scopePath)) return null;
  const data = JSON.parse(readFileSync(scopePath, 'utf8'));
  if (!isRecord(data)
    || data.schema !== SCHEMA
    || !nonEmpty(data.memory_db)
    || !isAbsolute(data.memory_db)
    || !Array.isArray(data.projects)
    || data.projects.length > MAX_PROJECTS
    || Object.keys(data).some((key) => !['schema', 'memory_db', 'projects'].includes(key))) {
    throw new Error('invalid_scope_manifest');
  }
  const seen = new Set();
  for (const p of data.projects) {
    if (!isRecord(p)
      || Object.keys(p).some((key) => !['root', 'project_id', 'repo_identity'].includes(key))
      || !nonEmpty(p.root) || !isAbsolute(p.root)
      || !nonEmpty(p.project_id) || !nonEmpty(p.repo_identity)
      || p.project_id !== p.repo_identity) {
      throw new Error('invalid_scope_project');
    }
    const key = process.platform === 'win32' ? resolve(p.root).toLowerCase() : resolve(p.root);
    if (seen.has(key)) throw new Error('duplicate_scope_root');
    seen.add(key);
  }
  return data;
}

/** Resolve a project from the real host process cwd, not from MCP arguments.
 * Neither AGENT_HUB_MEMORY_PROJECT_ID nor prompt text is consulted here. */
export function describeGlobalMemoryProject({
  cwd, execGit = (args) => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
  }),
  scopeResolver = resolveCodexProjectScope,
} = {}) {
  const input = canonicalRoot(cwd);
  const root = canonicalRoot(
    String(execGit(['-C', input, 'rev-parse', '--show-toplevel'])).trim(),
  );
  const identity = scopeResolver({
    event: { cwd: root },
    config: { projectId: null, repoIdentity: null },
    execFile: (command, args) => execGit(args),
  });
  if (!nonEmpty(identity.projectId) || identity.projectId !== identity.repoIdentity) {
    throw new Error('invalid_git_identity');
  }
  return { root, project_id: identity.projectId, repo_identity: identity.repoIdentity };
}

/** Central global MCP mode: fixed user-approved roots + independently
 * re-observed Git identity; DB path comes only from the allowlist file.
 * No tool argument may select a project, path, identity or database.
 */
export function readGlobalCodexMemory({
  cwd, query, maxItems = 5,
  scopePath = defaultGlobalMemoryScopePath(),
  describe = describeGlobalMemoryProject,
  read = readCodexMemory,
  readPublished = readPublishedProjectUserMemories,
} = {}) {
  let manifest;
  try {
    manifest = loadGlobalMemoryScope(scopePath);
  } catch {
    return { status: 'scope_invalid', items: [], read_only: true };
  }
  if (!manifest) return { status: 'scope_not_configured', items: [], read_only: true };
  let current;
  try {
    current = describe({ cwd });
  } catch {
    return { status: 'project_context_unavailable', items: [], read_only: true };
  }
  const enrolled = manifest.projects.find((p) => samePath(p.root, current.root));
  if (!enrolled) return { status: 'project_not_approved', items: [], read_only: true };
  if (current.project_id !== enrolled.project_id
    || current.repo_identity !== enrolled.repo_identity) {
    return { status: 'project_identity_changed', items: [], read_only: true };
  }
  // Deliberately ignore all inherited AGENT_HUB_MEMORY_* overrides.
  // This is not host authentication. The trusted allowlist is the authority.
  let result;
  try {
    result = read({
      cwd: current.root, query, maxItems,
      env: {
        AGENT_HUB_MEMORY_DB: manifest.memory_db,
        AGENT_HUB_MEMORY_PROJECT_ID: enrolled.project_id,
        AGENT_HUB_MEMORY_REPO_IDENTITY: enrolled.repo_identity,
      },
    });
  } catch {
    // Expose only which read stage failed, never SQLite or file details.
    return { status: 'memory_read_failed', stage: 'branch_recall',
      items: [], read_only: true };
  }
  if (!['found', 'no_current_authorized_match'].includes(result?.status)) return result;

  // Cross-branch visibility requires a separate, explicit operator-approved
  // publication in canonical Evidence. Ordinary branch-scoped user decisions
  // and model-inferred facts never become project-wide implicitly.
  let published;
  try {
    published = readPublished({
      dbPath: manifest.memory_db, projectId: enrolled.project_id,
      currentBranch: result.branch, query, maxItems,
    });
  } catch {
    return { status: 'memory_read_failed', stage: 'published_recall',
      items: [], read_only: true };
  }
  if (published.length === 0) return result;

  const seen = new Set(result.items.map((item) => item.claim.id));
  const items = [...result.items];
  for (const item of published) {
    if (seen.has(item.claim.id)) continue;
    seen.add(item.claim.id);
    items.push(item);
  }
  const bounded = enforceRecallBudget({ items, conflicts: [] }, {
    maxItems, maxSerializedBytes: 12_000,
  });
  return {
    ...result,
    status: bounded.items.length ? 'found' : 'no_current_authorized_match',
    items: bounded.items,
    project_wide_matches: bounded.items.filter((item) => item.scope === 'project').length,
  };
}

function ensureRegularDb(path) {
  if (!isAbsolute(path)) throw new Error('memory_database_path_must_be_absolute');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('memory_database_must_be_regular_file');
  }
  return realpathSync(path);
}

function atomicSave(scopePath, contents) {
  mkdirSync(dirname(scopePath), { recursive: true });
  const temporary = scopePath + '.new-' + randomUUID();
  try {
    writeFileSync(temporary, JSON.stringify(contents, null, 2) + '\n', {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    renameSync(temporary, scopePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Project enrollment is a separate explicit operator action and cannot be
 * invoked through the MCP tool. Dry-run is the default.
 */
export function manageGlobalMemoryProject({
  cwd = null, operation = 'list', apply = false,
  scopePath = defaultGlobalMemoryScopePath(),
  dbPath = null,
  env = process.env,
  describe = describeGlobalMemoryProject,
} = {}) {
  if (!isAbsolute(scopePath)) throw new Error('scopePath must be absolute');
  const old = loadGlobalMemoryScope(scopePath);
  if (operation === 'remove' && !old) {
    return { status: 'revocation_planned', applied: false, changed: false,
      scope_path: scopePath, memory_db: null, projects: [] };
  }
  if (operation === 'list') {
    if (apply || cwd !== null || dbPath !== null) throw new Error('list_takes_no_changes');
    return { status: 'listed', applied: false, scope_path: scopePath,
      projects: old?.projects ?? [], memory_db: old?.memory_db ?? null };
  }
  if (!['add', 'remove'].includes(operation)) throw new Error('unsupported_operation');
  if (!nonEmpty(cwd) || !isAbsolute(cwd)) throw new Error('absolute_repository_cwd_required');

  let observed;
  if (operation === 'add') observed = describe({ cwd });
  else {
    // Match the same Git-root spelling used at enrollment whenever possible.
    // If the remote identity is now invalid, revocation must still work when
    // the operator supplies the exact canonical Git root.
    let root;
    try { root = describe({ cwd }).root; }
    catch { root = canonicalRoot(cwd); }
    observed = { root };
  }

  const proposedDb = operation === 'add'
    ? ensureRegularDb(dbPath ?? old?.memory_db ?? defaultCodexMemoryDbPath({ env }))
    : old?.memory_db;
  if (old && proposedDb && !samePath(proposedDb, old.memory_db)) {
    throw new Error('database_path_change_denied');
  }
  const projects = [...(old?.projects ?? [])];
  const previous = projects.findIndex((p) => samePath(p.root, observed.root));
  if (operation === 'add') {
    if (previous >= 0) {
      const entry = projects[previous];
      if (entry.project_id !== observed.project_id
        || entry.repo_identity !== observed.repo_identity) {
        throw new Error('repository_identity_change_requires_revoke');
      }
    } else {
      if (projects.length >= MAX_PROJECTS) throw new Error('project_limit_reached');
      projects.push(observed);
    }
  } else if (previous >= 0) {
    projects.splice(previous, 1);
  }
  projects.sort((a, b) => a.root.localeCompare(b.root));
  const next = { schema: SCHEMA, memory_db: proposedDb, projects };
  const changed = JSON.stringify(next) !== JSON.stringify(old);
  if (apply && changed) atomicSave(scopePath, next);
  return {
    status: operation === 'add' ? 'enrollment_planned' : 'revocation_planned',
    applied: apply && changed, changed,
    scope_path: scopePath, memory_db: proposedDb,
    projects,
  };
}
