import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { buildMemoryGraphV2 } from '../../memory-engine/memory-graph-v2.mjs';
import { memoryUiGraph } from '../../memory-engine/memory-ui-model.mjs';

const PROJECT = 'github.com/example/d4-integration';
const AT = '2026-11-04T19:00:00.000Z';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-d4-real-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  t.after(async () => {
    memory.close();
    await rm(root, { recursive: true, force: true });
  });
  memory.registerProject({
    projectId: PROJECT, repoIdentity: PROJECT, createdAt: '2026-11-03T00:00:00.000Z',
  });
  for (const [claimId, authority] of [['one', 'agent_inference'], ['two', 'user_direct']]) {
    memory.ingest({
      evidence: {
        id: `e-${claimId}`, projectId: PROJECT,
        harness: 'codex', sessionId: 'd4-integration', sourceKind: 'session',
        sourceRef: 'session:d4-integration', capturedAt: '2026-11-03T11:00:00.000Z',
        branch: 'main', commitSha: null, path: null, blobOid: null,
        content: `Evidence for ${claimId}`, authorityClass: authority,
        metadata: { event_type: 'user_prompt' },
      },
      claim: {
        id: claimId, kind: 'decision', subject: 'graph quality', predicate: 'uses',
        value: `D4 describes ${claimId}`, state: 'active', branchScope: 'main',
        createdAt: '2026-11-03T11:00:00.000Z',
      },
    });
  }
  return memory;
}

test('D4 real MemoryEngine projects typed relations but never changes canonical export', async (t) => {
  const memory = await fixture(t);
  const before = memory.exportCanonical();
  memory.proposeTypedRelation({
    projectId: PROJECT, branch: 'main', sourceClaimId: 'one', targetClaimId: 'two',
    relation: 'supports', confidence: 'high', reason: 'Both claims support D4.',
  }, { evaluatorId: 'fixture-d4', policyVersion: 'semantic-relation-v1', at: '2026-11-04T18:00:00.000Z' });
  const graph = buildMemoryGraphV2(memory, { projectId: PROJECT, branch: 'main', at: AT });
  assert.equal(graph.schemaVersion, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].source, 'typed_relation');
  assert.equal(graph.edges[0].origin, 'inferred');
  assert.equal(graph.nodes.find((node) => node.id === 'one').authority, 'agent_inference');
  assert.equal(graph.nodes.find((node) => node.id === 'two').authority, 'user_direct');
  assert.deepEqual(memory.exportCanonical(), before);
});

test('D4 Memory Console projection is v2 with reference labels and optional similarity disabled', async (t) => {
  const memory = await fixture(t);
  const graph = memoryUiGraph(memory, { projectId: PROJECT, branch: 'main' });
  assert.equal(graph.schemaVersion, 2);
  assert.equal(graph.stats.similarityEnabled, false);
  assert.deepEqual(graph.groups.map((group) => group.id).sort(), ['agent_inference', 'user_direct']);
  assert.equal(graph.nodes.every((node) => /^@[a-f0-9]{10}$/.test(node.ref)), true);
});

test('D4 real bounded SQLite relation query filters before LIMIT and reports exact count', async (t) => {
  const memory = await fixture(t);
  for (const relation of ['supports', 'depends_on']) {
    memory.proposeTypedRelation({
      projectId: PROJECT, branch: 'main', sourceClaimId: 'one', targetClaimId: 'two',
      relation, confidence: 'high', reason: 'Both claims describe D4.',
    }, { evaluatorId: 'd4-bound', policyVersion: 'semantic-relation-v1',
      at: '2026-11-04T18:00:00.000Z' });
  }
  const options = {
    projectId: PROJECT, branch: 'main', activeOnly: true, at: AT,
    claimIds: ['one', 'two'], limit: 1, withCount: true, auditedAtOrBefore: true,
  };
  const bounded = memory.listTypedRelations(options);
  assert.equal(bounded.relations.length, 1);
  assert.equal(bounded.total, 2);
  assert.equal(memory.listTypedRelations({ projectId: PROJECT, branch: 'main' }).length, 2);
  assert.deepEqual(memory.listTypedRelations({ ...options, claimIds: ['one'] }), {
    relations: [], total: 0,
  });
  assert.deepEqual(memory.listTypedRelations({
    ...options, at: '2026-11-04T17:00:00.000Z',
  }), { relations: [], total: 0 });
});
