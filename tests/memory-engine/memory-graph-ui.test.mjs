import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import * as memoryUiModel from '../../memory-engine/memory-ui-model.mjs';
import { createMemoryUiServer } from '../../scripts/memory-ui.mjs';

function seed(memory) {
  memory.registerProject({
    projectId: 'github.com/example/graph-ui',
    repoIdentity: 'github.com/example/graph-ui',
    createdAt: '2026-10-28T10:00:00.000Z',
  });
  memory.ingest({
    evidence: {
      id: 'e-graph-ui',
      projectId: 'github.com/example/graph-ui',
      harness: 'codex',
      sessionId: 'graph-ui',
      sourceKind: 'session',
      sourceRef: 'session:graph-ui',
      capturedAt: '2026-10-28T10:01:00.000Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'The word vector may safely occur in claim text.',
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    },
    claim: {
      id: 'claim-graph-ui',
      kind: 'user_direct',
      subject: 'memory graph',
      predicate: 'states',
      value: 'The word vector may safely occur in claim text.',
      state: 'active',
      branchScope: 'main',
      createdAt: '2026-10-28T10:01:00.000Z',
    },
  });
}

function hasPropertyDeep(value, propertyName) {
  if (Array.isArray(value)) {
    return value.some((item) => hasPropertyDeep(item, propertyName));
  }
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, propertyName)) return true;
  return Object.values(value).some((item) => hasPropertyDeep(item, propertyName));
}

test('memoryUiGraph returns a browser-safe project/branch projection', async (t) => {
  assert.equal(typeof memoryUiModel.memoryUiGraph, 'function');

  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-graph-ui-model-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  t.after(async () => {
    memory.close();
    await rm(root, { recursive: true, force: true });
  });
  seed(memory);

  const graph = memoryUiModel.memoryUiGraph(memory, {
    projectId: 'github.com/example/graph-ui',
    branch: 'main',
  });

  assert.equal(graph.projectId, 'github.com/example/graph-ui');
  assert.equal(graph.branch, 'main');
  assert.equal(graph.nodes.length, 1);
  assert.match(graph.nodes[0].ref, /^@[0-9a-f]{10}$/);
  assert.equal(graph.nodes[0].authority, 'user_direct');
  assert.equal(hasPropertyDeep(graph, 'vector'), false);
});

test('GET /api/graph is scoped, guarded, browser-safe, and read-only', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-graph-ui-http-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  seed(memory);
  const runtime = createMemoryUiServer({
    dbPath,
    memory,
    includeRuntimeHealth: false,
  });

  t.after(async () => {
    await new Promise((resolvePromise) => runtime.server.close(resolvePromise));
    memory.close();
    await rm(root, { recursive: true, force: true });
  });

  await new Promise((resolvePromise, rejectPromise) => {
    runtime.server.once('error', rejectPromise);
    runtime.server.listen(0, runtime.host, () => {
      runtime.server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const address = runtime.server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const graphUrl = (
    base
    + '/api/graph?projectId='
    + encodeURIComponent('github.com/example/graph-ui')
    + '&branch=main'
  );

  let response = await fetch(graphUrl);
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.projectId, 'github.com/example/graph-ui');
  assert.equal(payload.branch, 'main');
  assert.equal(payload.nodes.length, 1);
  assert.equal(hasPropertyDeep(payload, 'vector'), false);

  response = await fetch(base + '/api/graph?branch=main');
  assert.equal(response.status, 400);
  payload = await response.json();
  assert.equal(payload.error, 'invalid_graph_scope');

  response = await fetch(
    base
    + '/api/graph?projectId='
    + encodeURIComponent('github.com/example/missing')
    + '&branch=main',
  );
  assert.equal(response.status, 404);
  payload = await response.json();
  assert.equal(payload.error, 'graph_scope_not_found');

  response = await fetch(graphUrl, { method: 'POST' });
  assert.equal(response.status, 405);
  payload = await response.json();
  assert.equal(payload.error, 'method_not_allowed');
});

test('Memory Console exposes an interactive Graph tab with safe graph affordances', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../../memory-ui/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../memory-ui/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../../memory-ui/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /data-view="graph"[^>]*>Graph</);
  assert.match(app, /['"]\/api\/graph['"]/);
  assert.match(app, /Explicit relation/);
  assert.match(app, /Inferred similarity/);
  assert.match(app, /Open in Memories/);
  assert.match(app, /graph-search/);
  assert.match(app, /graph-origin-filter/);
  assert.match(app, /graph-state-filter/);
  assert.match(app, /<svg[\s\S]*graph-canvas/);
  assert.match(css, /\.graph-layout\b/);
  assert.match(css, /\.graph-edge\.inferred\b/);
  assert.match(css, /\.graph-node\b/);
});

test('memoryUiGraph treats an evidence-only branch as an empty valid graph', () => {
  const projectId = 'github.com/example/evidence-only';
  const graph = memoryUiModel.memoryUiGraph({
    exportCanonical() {
      return {
        projects: [{
          project_id: projectId,
          repo_identity: projectId,
          canonical_remote: projectId,
          created_at: '2026-10-31T00:00:00.000Z',
        }],
        evidence: [{
          id: 'e-evidence-only',
          project_id: projectId,
          branch: 'main',
        }],
        claims: [],
        lifecycle_events: [],
        conflicts: [],
      };
    },
  }, {
    projectId,
    branch: 'main',
  });

  assert.equal(graph.projectId, projectId);
  assert.equal(graph.branch, 'main');
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
});

test('Graph tab click synchronizes active tab state before Graph rendering', async () => {
  const app = await readFile(
    new URL('../../memory-ui/app.js', import.meta.url),
    'utf8',
  );

  assert.match(
    app,
    /state\.view = button\.dataset\.view;[\s\S]{0,700}renderTabs\(\);[\s\S]{0,300}if \(state\.view === 'graph'\)/,
  );
});

test('memoryUiGraph keeps an evidence-only branch valid when the project has claims elsewhere', () => {
  const projectId = 'github.com/example/mixed-branches';

  const memory = {
    exportCanonical() {
      return {
        projects: [{
          project_id: projectId,
          repo_identity: projectId,
          canonical_remote: projectId,
          created_at: '2026-10-31T00:00:00.000Z',
        }],
        evidence: [{
          id: 'e-main-only',
          project_id: projectId,
          branch: 'main',
        }],
        claims: [{
          id: 'claim-feature',
          project_id: projectId,
          kind: 'user_direct',
          subject: 'user memory',
          predicate: 'states',
          value_text: 'Feature branch memory',
          state: 'active',
          branch_scope: 'feature',
          created_from_evidence_id: 'e-feature',
          created_at: '2026-10-31T00:01:00.000Z',
        }],
        lifecycle_events: [],
        conflicts: [],
      };
    },
  };

  const graph = memoryUiModel.memoryUiGraph(memory, {
    projectId,
    branch: 'main',
  });

  assert.equal(graph.projectId, projectId);
  assert.equal(graph.branch, 'main');
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);

  assert.throws(
    () => memoryUiModel.memoryUiGraph(memory, {
      projectId,
      branch: 'missing',
    }),
    /unknown project branch/,
  );
});