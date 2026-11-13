import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  manageGlobalMemoryProject, readGlobalCodexMemory,
} from '../../memory-engine/adapters/codex-global-memory-scope.mjs';

function repoInit(root, label) {
  const cwd = join(root, label);
  mkdirSync(cwd);
  execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, '-c', 'user.name=CI',
    '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty',
    '-m', 'initial'], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin',
    'https://github.com/example/' + label + '.git']);
  return cwd;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-global-memory-'));
  const alpha = repoInit(root, 'alpha');
  const beta = repoInit(root, 'beta');
  const outsider = repoInit(root, 'outsider');
  const empty = join(root, 'not-a-repository');
  mkdirSync(empty);
  const memoryDb = join(root, 'memory.sqlite3');
  const scopePath = join(root, 'approved-scopes.json');
  const memory = new MemoryEngine({ dbPath: memoryDb });
  for (const label of ['alpha', 'beta']) {
    const id = 'github.com/example/' + label;
    memory.registerProject({ projectId: id, repoIdentity: id });
    memory.ingest({
      evidence: {
        id: 'e-' + label, projectId: id, harness: 'codex', sessionId: 'real-' + label,
        sourceKind: 'session', sourceRef: 'session:real-' + label,
        capturedAt: '2026-11-12T00:00:00Z', branch: 'main',
        commitSha: null, path: null, blobOid: null,
        content: 'Decision ' + label + ' uses ' + label.toUpperCase(),
        authorityClass: 'user_direct', metadata: {},
      },
      claim: {
        id: 'c-' + label, kind: 'decision', subject: 'database backend',
        predicate: 'uses', value: 'Decision ' + label + ' uses ' + label.toUpperCase(),
        branchScope: 'main', createdAt: '2026-11-12T00:00:00Z',
      },
    });
  }
  memory.close();
  return {
    root, alpha, beta, outsider, empty, memoryDb, scopePath,
    enroll(cwd, apply = true) {
      return manageGlobalMemoryProject({
        operation: 'add', cwd, apply, dbPath: memoryDb, scopePath,
      });
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

function toolCall(cwd, scopePath, query, options = {}) {
  const entry = resolve('scripts/run-codex-memory-mcp.mjs');
  const envelope = {
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'memory_recall', arguments: { query } },
  };
  const stdout = execFileSync(process.execPath, [
    entry, '--global', '--scope', scopePath,
  ], {
    cwd, encoding: 'utf8',
    input: JSON.stringify(envelope) + '\n',
    timeout: 15_000,
    env: { ...process.env, ...options.env },
  });
  const response = JSON.parse(stdout.trim());
  assert.equal(response.id, 9);
  assert.equal(response.result.isError, false);
  return JSON.parse(response.result.content[0].text);
}

test('global registry is operator opt-in, dry-run and SQLite remain unchanged', () => {
  const f = setup();
  try {
    const before = createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    const dry = f.enroll(f.alpha, false);
    assert.equal(dry.applied, false);
    assert.equal(existsSync(f.scopePath), false);
    assert.equal(dry.projects[0].project_id, 'github.com/example/alpha');
    const applied = f.enroll(f.alpha);
    assert.equal(applied.applied, true);
    assert.equal(applied.projects.length, 1);
    const after = createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    assert.equal(before, after);
    const again = f.enroll(f.alpha);
    assert.equal(again.applied, false);
    assert.equal(again.changed, false);
  } finally { f.cleanup(); }
});

test('one global stdio launcher independently selects two approved repos by actual process cwd', () => {
  const f = setup();
  try {
    f.enroll(f.alpha);
    f.enroll(f.beta);
    const oldDbHash = createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    const a = toolCall(f.alpha, f.scopePath, 'database');
    const b = toolCall(f.beta, f.scopePath, 'database');
    assert.equal(a.status, 'found');
    assert.equal(a.project_id, 'github.com/example/alpha');
    assert.deepEqual(a.items.map((v) => v.claim.id), ['c-alpha']);
    assert.equal(b.status, 'found');
    assert.equal(b.project_id, 'github.com/example/beta');
    assert.deepEqual(b.items.map((v) => v.claim.id), ['c-beta']);
    assert.equal(createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex'), oldDbHash);
  } finally { f.cleanup(); }
});

test('global server fails closed in unknown project, non-repo cwd, and no scope file', () => {
  const f = setup();
  try {
    f.enroll(f.alpha);
    assert.equal(toolCall(f.outsider, f.scopePath, 'database').status, 'project_not_approved');
    assert.equal(toolCall(f.empty, f.scopePath, 'database').status, 'project_context_unavailable');
    assert.equal(toolCall(f.alpha, join(f.root, 'absent.json'), 'database').status, 'scope_not_configured');
  } finally { f.cleanup(); }
});

test('project identity is re-observed: remote reassignment does not leak previous identity', () => {
  const f = setup();
  try {
    f.enroll(f.alpha);
    execFileSync('git', ['-C', f.alpha, 'remote', 'set-url', 'origin',
      'https://github.com/example/beta.git']);
    assert.equal(toolCall(f.alpha, f.scopePath, 'database').status, 'project_identity_changed');
  } finally { f.cleanup(); }
});

test('untrusted inherited project-identity overrides cannot redirect global scope', () => {
  const f = setup();
  try {
    f.enroll(f.alpha);
    f.enroll(f.beta);
    const a = toolCall(f.alpha, f.scopePath, 'database', {
      env: {
        AGENT_HUB_MEMORY_PROJECT_ID: 'github.com/example/beta',
        AGENT_HUB_MEMORY_REPO_IDENTITY: 'github.com/example/beta',
        AGENT_HUB_MEMORY_DB: join(f.root, 'absent.sqlite3'),
      },
    });
    assert.equal(a.status, 'found');
    assert.deepEqual(a.items.map((v) => v.claim.id), ['c-alpha']);
  } finally { f.cleanup(); }
});

test('global recall identifies branch vs published-read failure without exposing internals', () => {
  const f = setup();
  try {
    f.enroll(f.alpha);
    const branchFailure = readGlobalCodexMemory({
      cwd: f.alpha, scopePath: f.scopePath,
      query: 'database',
      read: () => { throw new Error('sensitive branch SQL and file path'); },
    });
    assert.deepEqual(branchFailure, {
      status: 'memory_read_failed', stage: 'branch_recall',
      items: [], read_only: true,
    });

    const publicationFailure = readGlobalCodexMemory({
      cwd: f.alpha, scopePath: f.scopePath,
      query: 'database',
      read: () => ({
        status: 'found', project_id: 'github.com/example/alpha',
        branch: 'main', items: [], read_only: true,
      }),
      readPublished: () => { throw new Error('sensitive published memory SQL'); },
    });
    assert.deepEqual(publicationFailure, {
      status: 'memory_read_failed', stage: 'published_recall',
      items: [], read_only: true,
    });
    assert.doesNotMatch(JSON.stringify([branchFailure, publicationFailure]),
      /sensitive|SQL|file path/);
  } finally { f.cleanup(); }
});

test('explicit revocation closes access without changing existing memories', () => {
  const f = setup();
  try {
    f.enroll(f.alpha);
    f.enroll(f.beta);
    const deny = manageGlobalMemoryProject({
      operation: 'remove', cwd: f.alpha, scopePath: f.scopePath, apply: true,
    });
    assert.equal(deny.applied, true);
    assert.equal(toolCall(f.alpha, f.scopePath, 'database').status, 'project_not_approved');
    assert.deepEqual(toolCall(f.beta, f.scopePath, 'database').items.map(v => v.claim.id), ['c-beta']);
  } finally { f.cleanup(); }
});
