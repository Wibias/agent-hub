#!/usr/bin/env node
/**
 * D7: ephemeral Git/SQLite scale and freshness verification, or read-only live
 * repository coverage. Never inserts fixture Evidence into a user's database.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  createAsyncGitGraphView, resolveMemoryConsoleGitScopeAsync,
} from '../memory-engine/memory-console-git-context.mjs';
import { runGraphDiagnostics } from '../memory-engine/memory-graph-diagnostics.mjs';
import {
  assessD7FreshnessTransitions, assessD7LiveCoverage, assessD7ScaleProfile,
} from '../memory-engine/memory-graph-d7-validation.mjs';
import { memoryUiGraph } from '../memory-engine/memory-ui-model.mjs';
import { createMemoryUiServer } from './memory-ui.mjs';
import { executeMemoryGraphDiagnosis } from './diagnose-memory-graph.mjs';

const PROJECT = 'github.com/example/d7-ephemeral-validation';
const BRANCH = 'main';
const SIZES = [100, 250, 500, 501];
const HELP = `Memory Graph D7 validation (Node 24)

Synthetic scale + Git state verification, using disposable SQLite and checkout:
  node scripts/validate-memory-graph-d7.mjs [--samples 1..5]

Read-only live coverage (requires at least one actual fresh repository claim):
  node scripts/validate-memory-graph-d7.mjs --live --project-id ID --branch BRANCH
    --repo-root PATH [--db-path PATH] [--samples 1..5] [--max-p95-ms N]

Live mode never writes Evidence; synthetic mode writes only to OS temp files.
Reports contain only counts, state labels, and aggregate latencies.
`;

/** Permit only explicit bounded flags and prevent silent scope inference. */
export function parseD7Args(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('arguments array required');
  const value = { live: false, help: false, dbPath: null, projectId: null,
    branch: null, repoRoot: null, samples: 3, maxP95Ms: null };
  const known = new Map([
    ['--db-path', 'dbPath'], ['--project-id', 'projectId'],
    ['--branch', 'branch'], ['--repo-root', 'repoRoot'],
    ['--samples', 'samples'], ['--max-p95-ms', 'maxP95Ms'],
  ]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (seen.has(name)) throw new TypeError('duplicate option');
    seen.add(name);
    if (name === '--help') { value.help = true; continue; }
    if (name === '--live') { value.live = true; continue; }
    if (!known.has(name)) throw new TypeError('unknown option');
    const arg = argv[++i];
    if (typeof arg !== 'string' || !arg.trim() || arg.startsWith('--') || arg.includes('\0')) {
      throw new TypeError('option value required');
    }
    value[known.get(name)] = arg;
  }
  if (value.help) return value;
  value.samples = Number(value.samples);
  if (!Number.isInteger(value.samples) || value.samples < 1 || value.samples > 5) {
    throw new RangeError('samples must be between 1 and 5');
  }
  if (value.maxP95Ms !== null) {
    value.maxP95Ms = Number(value.maxP95Ms);
    if (!Number.isFinite(value.maxP95Ms) || value.maxP95Ms <= 0 || value.maxP95Ms > 600_000) {
      throw new RangeError('invalid p95 threshold');
    }
  }
  if (value.live) {
    if (!value.projectId || !value.branch || !value.repoRoot) {
      throw new TypeError('live mode needs explicit project, branch and repository root');
    }
  } else if (value.projectId || value.branch || value.repoRoot || value.dbPath || value.maxP95Ms !== null) {
    throw new TypeError('synthetic mode does not accept live scope arguments');
  }
  return value;
}

/** Execute Git only for disposable fixture construction, never in HTTP handlers. */
function fixtureGit(repo, ...args) {
  // `git -C` does not override GIT_DIR / GIT_WORK_TREE. Never let caller
  // repository, index, object or config overrides redirect fixture writes.
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^GIT_/i.test(name)) delete env[name];
  }
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  }).trim();
}

/** Build a disposable checkout with an actual Git tree and canonical remote. */
async function createFixtureCheckout(directory) {
  const repoRoot = join(directory, 'checkout');
  await mkdir(join(repoRoot, 'docs'), { recursive: true });
  fixtureGit(repoRoot, 'init', '-b', BRANCH);
  fixtureGit(repoRoot, 'config', 'user.email', 'd7@example.invalid');
  fixtureGit(repoRoot, 'config', 'user.name', 'D7 Fixture');
  fixtureGit(repoRoot, 'config', 'commit.gpgsign', 'false');
  fixtureGit(repoRoot, 'config', 'core.autocrlf', 'false');
  const disabledHooks = join(directory, 'hooks-disabled');
  await mkdir(disabledHooks);
  fixtureGit(repoRoot, 'config', 'core.hooksPath', disabledHooks);
  fixtureGit(repoRoot, 'remote', 'add', 'origin', `https://${PROJECT}.git`);
  const path = join(repoRoot, 'docs', 'guide.md');
  await writeFile(path, 'D7 fixture version one.\n', 'utf8');
  fixtureGit(repoRoot, 'add', 'docs/guide.md');
  fixtureGit(repoRoot, 'commit', '-m', 'initial fixture');
  const revision = fixtureGit(repoRoot, 'rev-parse', 'HEAD');
  const blobOid = fixtureGit(repoRoot, 'rev-parse', `${revision}:docs/guide.md`);
  return { repoRoot, path, revision, blobOid };
}

/** Seed only temporary SQLite with one repository-backed and N-1 user claims. */
function seedFixture(memory, claimsCount, fixture) {
  memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
  const capturedAt = new Date(Date.now() - 120_000).toISOString();
  for (let index = 0; index < claimsCount; index++) {
    const id = String(index).padStart(4, '0');
    const repository = index === 0;
    memory.ingest({
      evidence: {
        id: `e-${id}`, projectId: PROJECT, harness: 'codex', sessionId: 'd7-temp',
        sourceKind: repository ? 'repository' : 'session',
        sourceRef: repository ? 'docs/guide.md' : `session:${id}`,
        capturedAt, branch: BRANCH, commitSha: repository ? fixture.revision : null,
        path: repository ? 'docs/guide.md' : null,
        blobOid: repository ? fixture.blobOid : null,
        content: `EPHEMERAL_EVIDENCE_${id}`, authorityClass: repository ? 'repo_trusted' : 'user_direct',
        metadata: {},
      },
      claim: {
        id: `claim-${id}`, kind: 'code_observation', subject: 'd7-fixture',
        predicate: 'validates', value: `EPHEMERAL_CLAIM_${id}`,
        state: 'active', branchScope: BRANCH, createdAt: capturedAt,
      },
    });
  }
  memory.proposeTypedRelation({
    projectId: PROJECT, branch: BRANCH, sourceClaimId: 'claim-0000',
    targetClaimId: 'claim-0001', relation: 'supports', confidence: 'high',
    reason: 'Temporary evidence-backed relation for D7.',
  }, { evaluatorId: 'd7-validation', policyVersion: 'semantic-relation-v1', at: capturedAt });
}

/** Query the exact D5/D6 graph path without modifying canonical memory. */
async function inspectGraph(memory, roots) {
  const scope = await resolveMemoryConsoleGitScopeAsync({
    memory, projectId: PROJECT, branch: BRANCH, repositoryRoots: roots,
  });
  const graphMemory = scope.status === 'verified'
    ? await createAsyncGitGraphView(memory, { projectId: PROJECT, branch: BRANCH, scope })
    : memory;
  const graph = memoryUiGraph(graphMemory, {
    projectId: PROJECT, branch: BRANCH, revisionSha: scope.revisionSha,
  });
  return { scope, graph };
}

/** Exercise the real loopback HTTP server under concurrent graph requests. */
async function checkConcurrentHttp(memory, dbPath, repoRoot, revision) {
  const runtime = createMemoryUiServer({
    dbPath, memory, repositoryRoots: [repoRoot], includeRuntimeHealth: false,
  });
  await new Promise((resolveListen, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, runtime.host, resolveListen);
  });
  try {
    const url = `http://127.0.0.1:${runtime.server.address().port}`;
    const path = `/api/graph?projectId=${encodeURIComponent(PROJECT)}&branch=main`;
    const started = performance.now();
    const requests = [
      fetch(url + path, { signal: AbortSignal.timeout(20000) }),
      fetch(url + path + '&revisionSha=' + 'f'.repeat(40) + '&repoRoot=/untrusted',
        { signal: AbortSignal.timeout(20000) }),
      fetch(url + path, { signal: AbortSignal.timeout(20000) }),
      fetch(url + '/api/overview', { signal: AbortSignal.timeout(20000) }),
    ];
    const responses = await Promise.all(requests);
    if (responses.some((response) => response.status !== 200)) throw new Error('HTTP status invariant');
    const bodies = await Promise.all(responses.map((response) => response.json()));
    if (bodies.slice(0, 3).some((body) => body.gitContext?.status !== 'verified'
        || body.gitContext?.revisionSha !== revision
        || body.nodes?.length !== 100
        || body.nodes?.find((node) => node.id === 'claim-0000')?.freshness?.status !== 'fresh')) {
      throw new Error('parallel trusted graph invariant');
    }
    if (!bodies[3]?.projects || !Array.isArray(bodies[3].projects)) {
      throw new Error('concurrent overview invariant');
    }
    const text = JSON.stringify(bodies);
    if (text.includes(repoRoot) || text.includes('EPHEMERAL_EVIDENCE_')) {
      throw new Error('HTTP privacy invariant');
    }
    return { status: 'pass', requests: 4, wallMs: Math.round((performance.now() - started) * 100) / 100 };
  } finally {
    await new Promise((done) => runtime.server.close(done));
  }
}

/** Perform destructive changes only inside the disposable checkout, never live. */
async function checkFreshness(memory, fixture) {
  const initial = await inspectGraph(memory, [fixture.repoRoot]);
  await writeFile(fixture.path, 'D7 fixture version two.\n', 'utf8');
  fixtureGit(fixture.repoRoot, 'add', 'docs/guide.md');
  fixtureGit(fixture.repoRoot, 'commit', '-m', 'change fixture blob');
  const changedCommit = await inspectGraph(memory, [fixture.repoRoot]);
  fixtureGit(fixture.repoRoot, 'checkout', '-b', 'feature/d7-different-branch');
  const wrongBranch = await inspectGraph(memory, [fixture.repoRoot]);
  const noRoot = await inspectGraph(memory, []);
  const invalidGit = await resolveMemoryConsoleGitScopeAsync({
    memory, projectId: PROJECT, branch: BRANCH, repositoryRoots: [fixture.repoRoot],
    execGit: async () => { throw new Error('PRIVATE_GIT_FAILURE'); },
  });
  const assessment = assessD7FreshnessTransitions({ initial, changedCommit, wrongBranch, noRoot });
  return { ...assessment, gitFailureFailClosed: invalidGit.status === 'unbound' };
}

/** Measure finite, real graph projections over disposable 100/250/500/501-claim stores. */
export async function runSyntheticD7({ samples = 3 } = {}) {
  if (!Number.isInteger(samples) || samples < 1 || samples > 5) throw new RangeError('samples must be 1..5');
  const directory = await mkdtemp(join(tmpdir(), 'agent-hub-d7-validation-'));
  try {
    const fixture = await createFixtureCheckout(directory);
    const profiles = [];
    let freshness = null;
    let concurrency = null;
    let databasesUnchanged = true;
    for (const size of SIZES) {
      const dbPath = join(directory, `fixture-${size}.sqlite3`);
      const memory = new MemoryEngine({ dbPath });
      try {
        seedFixture(memory, size, fixture);
        const canonicalBefore = memory.exportCanonical();
        const hashBefore = createHash('sha256').update(await readFile(dbPath)).digest('hex');
        const report = await runGraphDiagnostics({
          projectId: PROJECT, branch: BRANCH, rootsConfigured: 1, samples,
          queryGraph: () => inspectGraph(memory, [fixture.repoRoot]),
        });
        profiles.push(assessD7ScaleProfile(report, size));
        if (size === 100) {
          concurrency = await checkConcurrentHttp(memory, dbPath, fixture.repoRoot, fixture.revision);
          freshness = await checkFreshness(memory, fixture);
          fixtureGit(fixture.repoRoot, 'checkout', BRANCH);
          fixtureGit(fixture.repoRoot, 'reset', '--hard', fixture.revision);
        }
        const hashAfter = createHash('sha256').update(await readFile(dbPath)).digest('hex');
        databasesUnchanged &&= hashBefore === hashAfter
          && JSON.stringify(memory.exportCanonical()) === JSON.stringify(canonicalBefore);
      } finally {
        memory.close();
      }
    }
    const passed = profiles.every((item) => item.status === 'pass')
      && freshness?.status === 'pass' && freshness?.gitFailureFailClosed === true
      && concurrency?.status === 'pass' && databasesUnchanged;
    return { schemaVersion: 1, mode: 'synthetic_ephemeral', outcome: passed ? 'pass' : 'fail',
      profiles, freshness, concurrency, databasesUnchanged };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Verify repository coverage in the user's database through D6's read-only CLI. */
export async function runLiveD7({ projectId, branch, repoRoot, dbPath = null, samples = 3, maxP95Ms = null } = {}) {
  if (!projectId || !branch || !repoRoot) throw new TypeError('explicit live scope required');
  const args = ['--project-id', projectId, '--branch', branch, '--repo-root', repoRoot,
    '--samples', String(samples)];
  if (dbPath) args.push('--db-path', dbPath);
  if (maxP95Ms !== null) args.push('--max-p95-ms', String(maxP95Ms));
  const report = await executeMemoryGraphDiagnosis({ argv: args, emit: () => {} });
  const assessment = assessD7LiveCoverage(report);
  return { schemaVersion: 1, mode: 'live_read_only', outcome: assessment.status,
    scope: { projectId, branch }, assessment };
}

/** Emit one path-free report; never print raw SQLite/Git errors. */
export async function executeD7({ argv = [], emit = console.log } = {}) {
  const options = parseD7Args(argv);
  if (options.help) { emit(HELP); return { outcome: 'help' }; }
  const report = options.live ? await runLiveD7(options)
    : await runSyntheticD7({ samples: options.samples });
  emit(JSON.stringify(report, null, 2));
  return report;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  try {
    const result = await executeD7({ argv: process.argv.slice(2) });
    if (result.outcome === 'blocked') process.exitCode = 2;
    else if (result.outcome === 'fail') process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ schemaVersion: 1, outcome: 'fail', code: 'd7_validation_failed' }));
    process.exitCode = 1;
  }
}
