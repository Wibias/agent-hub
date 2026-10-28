import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
