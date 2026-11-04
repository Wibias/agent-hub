import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMemoryGraphV2 } from '../../memory-engine/memory-graph-v2.mjs';

const PROJECT = 'github.com/example/d4';
const SHA = 'a'.repeat(40);
const AT = '2026-11-04T12:00:00.000Z';

function node(id, authority, { state = 'active', repo = false, validFrom = null, validUntil = null } = {}) {
  return {
    id, kind: 'decision', value: `Memory ${id}`, subject: 'd4', predicate: 'states',
    branch: 'main', state, createdAt: '2026-10-01T00:00:00Z', validFrom, validUntil,
    provenance: {
      evidenceId: `e-${id}`, authorityClass: authority,
      sourceKind: repo ? 'repo_file' : 'session', path: repo ? `src/${id}.mjs` : null,
      blobOid: repo ? 'b'.repeat(40) : null,
    },
  };
}

function fixture({
  nodes = [node('a', 'agent_inference'), node('b', 'user_direct')],
  typed = [],
  verified = [],
  otherEdges = [],
} = {}) {
  const calls = { materialize: [], list: [], export: 0 };
  const memory = {
    exportCanonical() { calls.export++; return {}; },
    listTypedRelations(options) { calls.list.push(options); return typed; },
    materializeRecall(options) {
      calls.materialize.push(options);
      return { items: verified.map((id) => ({ claim: { id } })) };
    },
    __d4BaseGraph: {
      schemaVersion: 1, projectId: PROJECT, branch: 'main', nodes,
      edges: otherEdges,
      stats: { totalClaims: nodes.length, nodeCount: nodes.length, edgeCount: otherEdges.length,
        explicitEdges: otherEdges.filter((x) => x.origin === 'explicit').length,
        inferredEdges: otherEdges.filter((x) => x.origin === 'inferred').length,
        truncated: false, omittedClaims: 0, semanticThreshold: 0.82, maxSemanticNeighbors: 3 },
    },
  };
  return { memory, calls };
}

function relation(source = 'a', target = 'b', overrides = {}) {
  return {
    id: `${source}-${target}`, project_id: PROJECT, branch_scope: 'main',
    source_claim_id: source, target_claim_id: target, source_evidence_id: `e-${source}`,
    target_evidence_id: `e-${target}`, relation: 'supports', origin: 'inferred', confidence: 'high',
    reason: 'Both claims support the same implementation step.', evaluator_id: 'test',
    policy_version: 'semantic-relation-v1', created_at: '2026-11-03T12:00:00.000Z',
    validated_at: '2026-11-03T13:00:00.000Z', ...overrides,
  };
}

function build(options = {}, data = {}) {
  const { memory, calls } = fixture(data);
  const graph = projectMemoryGraphV2(memory, memory.__d4BaseGraph, { projectId: PROJECT, branch: 'main', at: AT, ...options });
  return { graph, calls };
}

test('D4 graph v2 defaults to no embedding similarity, keeps canonical explicit history', () => {
  const canonical = { id: 'explicit:a:b', from: 'a', to: 'b', origin: 'explicit', relation: 'supersedes', weight: 1 };
  const sim = { id: 'sim:a:b', from: 'a', to: 'b', origin: 'inferred', relation: 'semantic_similarity', weight: 0.99 };
  const { graph } = build({}, { otherEdges: [canonical, sim] });
  assert.equal(graph.schemaVersion, 2);
  assert.equal(graph.projection, 'graph-quality-v2');
  assert.equal(graph.readOnly, true);
  assert.deepEqual(graph.edges.map((edge) => edge.id), [canonical.id]);
  assert.equal(graph.stats.similarityEnabled, false);
});

test('D4 groups by primary Evidence authority, never by descriptive claim.kind', () => {
  const { graph } = build();
  assert.deepEqual(graph.groups.map(({ id }) => id), ['agent_inference', 'user_direct']);
  assert.equal(graph.nodes.find((x) => x.id === 'b').authority, 'user_direct');
  assert.equal(graph.nodes.find((x) => x.id === 'a').groupLabel, 'Agent inference');
});

test('D4 shows current high-confidence typed edges with source provenance as advisory only', () => {
  const { graph, calls } = build({}, { typed: [relation()] });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].source, 'typed_relation');
  assert.equal(graph.edges[0].advisory, true);
  assert.equal(graph.edges[0].weight, null);
  assert.equal(graph.edges[0].provenance.policyVersion, 'semantic-relation-v1');
  assert.equal(graph.stats.typedRelations, 1);
  assert.equal(calls.list[0].activeOnly, true);
  assert.equal(calls.materialize.length, 0);
});

test('D4 repository endpoints stay unchecked and cannot create typed edges without trusted Git revision', () => {
  const { graph, calls } = build({}, {
    nodes: [node('a', 'repo_trusted', { repo: true }), node('b', 'user_direct')],
    typed: [relation()],
  });
  assert.equal(graph.nodes[0].freshness.status, 'unchecked');
  assert.equal(graph.stats.typedSuppressedFreshness, 1);
  assert.equal(graph.edges.length, 0);
  assert.equal(calls.materialize.length, 0);
});

test('D4 checks trusted Git revision through current materializeRecall and exposes only eligible typed edge', () => {
  const data = {
    nodes: [node('a', 'repo_trusted', { repo: true }), node('b', 'user_direct')],
    typed: [relation()], verified: ['a'],
  };
  const { graph, calls } = build({ revisionSha: SHA }, data);
  assert.equal(graph.nodes[0].freshness.status, 'fresh');
  assert.equal(graph.edges.length, 1);
  assert.equal(calls.materialize.length, 1);
  assert.deepEqual(calls.materialize[0], {
    projectId: PROJECT, branch: 'main', revisionSha: SHA,
    mode: 'current', claimIds: ['a'],
  });
});

test('D4 wrong or inaccessible Git freshness state blocks typed relation, preserving visible node', () => {
  const data = {
    nodes: [node('a', 'repo_trusted', { repo: true }), node('b', 'user_direct')],
    typed: [relation()], verified: [],
  };
  const { graph } = build({ revisionSha: SHA }, data);
  assert.equal(graph.nodes[0].freshness.status, 'stale');
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.nodes.length, 2);
});

test('D4 historical states remain inspectable, never support current inferred relations', () => {
  const data = {
    nodes: [node('a', 'agent_inference', { state: 'superseded' }), node('b', 'user_direct')],
    typed: [relation()], otherEdges: [
      { id: 'history', from: 'a', to: 'b', origin: 'explicit', relation: 'supersedes', weight: 1 },
    ],
  };
  const { graph } = build({}, data);
  assert.equal(graph.nodes[0].lifecycleStatus, 'historical');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].current, false);
});

test('D4 temporal validity of relations and nodes is enforced independently of ledger', () => {
  const { graph } = build({}, {
    nodes: [node('a', 'user_direct', { validUntil: '2026-11-04T12:00:00.000Z' }), node('b', 'user_direct')],
    typed: [relation()],
  });
  assert.equal(graph.nodes[0].lifecycleStatus, 'historical');
  assert.equal(graph.edges.length, 0);
});

test('D4 rejects mismatched Evidence, malicious relation types and future revalidations', () => {
  const { graph } = build({}, { typed: [
    relation('a', 'b', { source_evidence_id: 'e-imposter' }),
    relation('a', 'b', { relation: 'supersedes' }),
    relation('a', 'b', { validated_at: '2026-11-05T00:00:00.000Z' }),
  ] });
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.stats.typedSuppressedOther, 3);
});

test('D4 similarity opt-in still requires current and fresh endpoints', () => {
  const sim = { id: 'sim', from: 'a', to: 'b', origin: 'inferred', relation: 'semantic_similarity', weight: 0.99 };
  const { graph } = build({ includeSimilarity: true }, { otherEdges: [sim] });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].source, 'embedding_similarity');
  assert.equal(graph.edges[0].advisory, true);
});

test('D4 rejects invalid inputs and never calls any memory write method', () => {
  const { memory } = fixture();
  for (const method of ['ingest', 'saveTypedRelation', 'recordRepositoryPathState', 'recall']) {
    memory[method] = () => { throw new Error(`${method} write used`); };
  }
  const graph = projectMemoryGraphV2(memory, memory.__d4BaseGraph, { projectId: PROJECT, branch: 'main', at: AT });
  assert.equal(graph.nodes.length, 2);
  assert.throws(() => projectMemoryGraphV2(memory, memory.__d4BaseGraph, { projectId: PROJECT, branch: 'main', revisionSha: 'main' }), /SHA/);
  assert.throws(() => projectMemoryGraphV2(memory, memory.__d4BaseGraph, { projectId: PROJECT, branch: 'main', includeSimilarity: 'false' }), /boolean/);
});


test('D4 bounds excessive derived relations and reports truncated rows', () => {
  const rows = Array.from({ length: 5010 }, (_, index) => relation('a', 'b', { id: `r-${index}` }));
  const { graph } = build({}, { typed: rows });
  assert.equal(graph.edges.length, 1500);
  assert.equal(graph.stats.typedRelationsOmittedByBound, 3510);
});

test('D4 treats repo-trusted claims with missing path as unverifiable', () => {
  const repo = node('a', 'repo_trusted');
  const { graph } = build({}, { nodes: [repo, node('b', 'user_direct')], typed: [relation()] });
  assert.equal(graph.nodes[0].freshness.status, 'unchecked');
  assert.equal(graph.edges.length, 0);
});
