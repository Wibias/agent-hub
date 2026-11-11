import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  readCodexMemory, createCodexMemoryMcpDispatcher,
} from '../../memory-engine/adapters/codex-readonly-memory-mcp.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-readonly-mcp-'));
  const cwd = join(root, 'project');
  const dbDir = join(root, 'memory');
  mkdirSync(cwd); mkdirSync(dbDir);
  execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Tester',
    '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'init'], { stdio: 'ignore' });
  const db = join(dbDir, 'memory.sqlite3');
  const env = {
    ...process.env,
    AGENT_HUB_MEMORY_DB: db,
    AGENT_HUB_MEMORY_PROJECT_ID: 'allowed-project',
    AGENT_HUB_MEMORY_REPO_IDENTITY: 'allowed-project',
  };
  function insert(memory, id, projectId, authorityClass, value, {
    sessionId = 'real-observation', sourceRef = 'session:real-observation',
    metadata = {}, subject = 'cache storage',
  } = {}) {
    memory.ingest({
      evidence: {
        id: 'e-' + id, projectId, harness: 'codex',
        sessionId, sourceKind: 'session',
        sourceRef, capturedAt: '2026-11-12T10:00:00.000Z',
        branch: 'main', commitSha: null, path: null, blobOid: null,
        content: value, authorityClass, metadata,
      },
      claim: {
        id: 'c-' + id, kind: 'decision', subject,
        predicate: 'uses', value, branchScope: 'main',
        createdAt: '2026-11-12T10:00:00.000Z',
      },
    });
  }
  const memory = new MemoryEngine({ dbPath: db });
  memory.registerProject({ projectId: 'allowed-project', repoIdentity: 'allowed-project' });
  memory.registerProject({ projectId: 'other-project', repoIdentity: 'other-project' });
  insert(memory, 'allowed', 'allowed-project', 'user_direct', 'Use SQLite for local cache storage');
  insert(memory, 'inference', 'allowed-project', 'agent_inference', 'Use Redis for cache storage');
  insert(memory, 'other', 'other-project', 'user_direct', 'Use Postgres for cache storage');
  insert(memory, 'legacy-seed', 'allowed-project', 'user_direct', 'Seed Redis cache storage', {
    sessionId: 'runtime-e2e-seed-doctor',
    sourceRef: 'session:runtime-e2e-seed-doctor',
  });
  insert(memory, 'explicit-fixture', 'allowed-project', 'user_direct', 'Seed Memcached cache storage', {
    metadata: { test_fixture: true },
  });
  memory.close();
  return {
    root, cwd, db, env,
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

test('existing approved current memory is retrieved with evidence; no canonical DB mutation', () => {
  const f = fixture();
  try {
    const before = createHash('sha256').update(readFileSync(f.db)).digest('hex');
    const result = readCodexMemory({ cwd: f.cwd, env: f.env, query: 'cache storage' });
    const after = createHash('sha256').update(readFileSync(f.db)).digest('hex');
    assert.equal(before, after);
    assert.equal(result.status, 'found');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].claim.id, 'c-allowed');
    assert.equal(result.items[0].claim.value, 'Use SQLite for local cache storage');
    assert.equal(result.items[0].evidence.id, 'e-allowed');
    assert.equal(result.items[0].evidence.authority_class, 'user_direct');
    assert.equal(result.read_only, true);
    assert.ok(result.omitted_by_policy > 0);
    assert.equal(result.omitted_test_data, 2);
    assert.ok(/^[0-9a-f]{40}$/.test(result.revision_sha));
  } finally { f.cleanup(); }
});

test('missing memory DB returns a safe unavailable status without creating a file', () => {
  const f = fixture();
  try {
    const missing = join(f.root, 'never-created.sqlite3');
    const result = readCodexMemory({
      cwd: f.cwd, env: { ...f.env, AGENT_HUB_MEMORY_DB: missing },
      query: 'cache',
    });
    assert.equal(result.status, 'memory_database_unavailable');
    assert.equal(existsSync(missing), false);
  } finally { f.cleanup(); }
});

test('unknown project cannot leak another project memory', () => {
  const f = fixture();
  try {
    const result = readCodexMemory({
      cwd: f.cwd,
      env: { ...f.env, AGENT_HUB_MEMORY_PROJECT_ID: 'nonexistent-project' },
      query: 'cache',
    });
    assert.equal(result.status, 'project_not_registered');
    assert.deepEqual(result.items, []);
  } finally { f.cleanup(); }
});

test('tool contract permits only recall and refuses scope/path override', async () => {
  const f = fixture();
  try {
    const dispatch = createCodexMemoryMcpDispatcher({ cwd: f.cwd, env: f.env });
    const init = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(init.result.serverInfo.name, 'agenthub-memory-readonly');
    const list = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.result.tools.map((x) => x.name), ['memory_recall']);
    const denied = await dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'memory_recall', arguments: { query: 'cache', project_id: 'other-project' } } });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /forbidden_argument/);
    const valid = await dispatch({ jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'memory_recall', arguments: { query: 'SQLite' } } });
    const body = JSON.parse(valid.result.content[0].text);
    assert.equal(body.items[0].claim.id, 'c-allowed');
    const bad = await dispatch({ jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'capture_evidence', arguments: { query: 'overwrite' } } });
    assert.equal(bad.result.isError, true);
  } finally { f.cleanup(); }
});

test('real stdio MCP process lists and calls only read-only tool', async () => {
  const f = fixture();
  try {
    const entry = resolve('scripts/run-codex-memory-mcp.mjs');
    const child = spawn(process.execPath, [entry, '--cwd', f.cwd], {
      env: f.env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const request = (id, method, params) =>
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    child.stdin.end(
      request(1, 'initialize', { protocolVersion: '2025-06-18' })
      + request(2, 'tools/list', {})
      + request(3, 'tools/call', { name: 'memory_recall', arguments: { query: 'SQLite' } }),
    );
    const stdout = [];
    const stderr = [];
    for await (const chunk of child.stdout) stdout.push(chunk);
    for await (const chunk of child.stderr) stderr.push(chunk);
    const exit = await new Promise((done) => child.on('close', done));
    assert.equal(exit, 0, Buffer.concat(stderr).toString('utf8'));
    const messages = Buffer.concat(stdout).toString('utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(messages.map((m) => m.id), [1, 2, 3]);
    const data = JSON.parse(messages[2].result.content[0].text);
    assert.equal(data.status, 'found');
    assert.equal(data.items[0].claim.id, 'c-allowed');
  } finally { f.cleanup(); }
});


test('legacy user_direct E2E seeds do not appear even for a seed-only query', () => {
  const f = fixture();
  try {
    const result = readCodexMemory({
      cwd: f.cwd, env: f.env, query: 'Memcached',
    });
    assert.equal(result.status, 'no_current_authorized_match');
    assert.equal(result.omitted_test_data, 1);
    assert.deepEqual(result.items, []);
    const legacy = readCodexMemory({
      cwd: f.cwd, env: f.env, query: 'Redis',
    });
    assert.equal(legacy.status, 'no_current_authorized_match');
    assert.equal(legacy.omitted_test_data, 1);
  } finally { f.cleanup(); }
});

test('test words in genuine claim content do not masquerade as fixture provenance', async () => {
  const { isSyntheticMemoryItem } = await import(
    '../../memory-engine/adapters/memory-read-provenance.mjs'
  );
  const genuine = {
    claim: { id: 'claim:user:thoughts' },
    evidence: {
      id: 'evidence:user:thoughts', session_id: 'regular-session',
      source_ref: 'session:regular-session',
      content_redacted: 'We should test runtime-e2e-seed-doctor examples.',
      metadata: {},
    },
  };
  assert.equal(isSyntheticMemoryItem(genuine), false);
  assert.equal(isSyntheticMemoryItem({
    ...genuine,
    evidence: { ...genuine.evidence, metadata: { origin: 'test_fixture' } },
  }), true);
  const withSupportingFixture = { ...genuine };
  Object.defineProperty(withSupportingFixture, 'provenance', {
    value: [
      { evidence: genuine.evidence },
      { evidence: { id: 'test-fixture-abc' } },
    ],
    enumerable: false,
  });
  assert.equal(isSyntheticMemoryItem(withSupportingFixture), true);
});
