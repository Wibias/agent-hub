import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GraphRecallShadowStore,
  buildGraphRecallShadowRecord,
  graphRecallShadowCandidateKey,
} from '../../memory-engine/graph-recall-shadow-store.mjs';

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    policyVersion: 'graph-recall-shadow-v1',
    qualityEligible: true,
    judgeCalled: true,
    judgeAvailable: true,
    anchorIds: ['claim-a'],
    missingAnchorIds: ['claim-missing'],
    graphCandidateIds: ['claim-a', 'claim-novel'],
    sourceRetainedIds: ['claim-a'],
    sourcePrunedIds: ['claim-b', 'claim-missing'],
    novelGraphIds: ['claim-novel'],
    authoritativeSelectedIds: ['claim-a', 'claim-b'],
    authoritativeHitIds: ['claim-a'],
    falseNegativeIds: ['claim-b'],
    traversedEdges: [
      {
        id: 'edge:claim-a:claim-novel',
        from: 'claim-a',
        to: 'claim-novel',
        relation: 'semantic_similarity',
        origin: 'inferred',
        weight: 0.93,
      },
    ],
    metrics: {
      source_candidate_count: 3,
      anchor_count: 1,
      missing_anchor_count: 1,
      graph_candidate_count: 2,
      source_retained_count: 1,
      source_pruned_count: 2,
      novel_graph_count: 1,
      authoritative_selected_count: 2,
      authoritative_hit_count: 1,
      false_negative_count: 1,
      final_selection_recall: 0.5,
      exact_preservation: false,
      graph_vs_source_candidate_delta: -1,
      estimated_source_candidate_tokens: 18,
      estimated_graph_candidate_tokens: 11,
      local_duration_ms: 4,
    },
    ...overrides,
  };
}

function hasPropertyDeep(value, propertyName) {
  if (Array.isArray(value)) return value.some((item) => hasPropertyDeep(item, propertyName));
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, propertyName)) return true;
  return Object.values(value).some((item) => hasPropertyDeep(item, propertyName));
}

test('graph shadow candidate keys are deterministic SHA-256 values', () => {
  const first = graphRecallShadowCandidateKey('claim-a');
  const second = graphRecallShadowCandidateKey('claim-a');
  const other = graphRecallShadowCandidateKey('claim-b');

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test('graph shadow record is deterministic and stores hashed candidate identities without prompt or claim content', () => {
  const input = {
    projectId: 'github.com/example/graph-shadow',
    branch: 'main',
    query: 'remember my secret launch preference',
    observedAt: '2026-10-29T00:15:00.000Z',
    report: report(),
  };

  const first = buildGraphRecallShadowRecord(input);
  const second = buildGraphRecallShadowRecord(input);

  assert.deepEqual(first, second);
  assert.match(first.observation_id, /^[a-f0-9]{64}$/);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.source, 'exact_runtime');
  assert.equal(first.project_id, 'github.com/example/graph-shadow');
  assert.equal(first.branch, 'main');
  assert.equal(first.observed_at, '2026-10-29T00:15:00.000Z');
  assert.equal(first.policy_version, 'graph-recall-shadow-v1');
  assert.equal(first.quality_eligible, true);
  assert.equal(first.judge_called, true);
  assert.equal(first.judge_available, true);
  assert.equal(first.metrics.final_selection_recall, 0.5);

  const keyA = graphRecallShadowCandidateKey('claim-a');
  const keyB = graphRecallShadowCandidateKey('claim-b');
  const keyMissing = graphRecallShadowCandidateKey('claim-missing');
  const keyNovel = graphRecallShadowCandidateKey('claim-novel');
  assert.deepEqual(first.source_candidate_keys, [keyA, keyB, keyMissing].sort());
  assert.deepEqual(first.graph_candidate_keys, [keyA, keyNovel].sort());
  assert.deepEqual(first.authoritative_selected_keys, [keyA, keyB].sort());
  assert.deepEqual(first.false_negative_keys, [keyB]);
  assert.deepEqual(first.novel_graph_keys, [keyNovel]);
  assert.deepEqual(first.missing_anchor_keys, [keyMissing]);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(input.query), false);
  for (const rawId of ['claim-a', 'claim-b', 'claim-missing', 'claim-novel']) {
    assert.equal(serialized.includes(rawId), false, `raw id leaked: ${rawId}`);
  }
  assert.equal(serialized.includes('edge:claim-a:claim-novel'), false);
  assert.equal(hasPropertyDeep(first, 'query'), false);
  assert.equal(hasPropertyDeep(first, 'text'), false);
  assert.equal(hasPropertyDeep(first, 'value'), false);
  assert.equal(hasPropertyDeep(first, 'vector'), false);
  assert.equal(hasPropertyDeep(first, 'traversedEdges'), false);
});

test('observation id changes when query digest or candidate evidence changes', () => {
  const base = {
    projectId: 'github.com/example/graph-shadow',
    branch: 'main',
    observedAt: '2026-10-29T00:15:00.000Z',
    report: report(),
  };
  const first = buildGraphRecallShadowRecord({ ...base, query: 'query one' });
  const changedQuery = buildGraphRecallShadowRecord({ ...base, query: 'query two' });
  const changedGraph = buildGraphRecallShadowRecord({
    ...base,
    query: 'query one',
    report: report({ graphCandidateIds: ['claim-a'] }),
  });

  assert.notEqual(first.observation_id, changedQuery.observation_id);
  assert.notEqual(first.observation_id, changedGraph.observation_id);
});

test('graph shadow store is immutable, idempotent, deterministic, and conflict-safe', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-graph-shadow-store-'));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const store = new GraphRecallShadowStore({ rootDir: root });
  const first = buildGraphRecallShadowRecord({
    projectId: 'github.com/example/graph-shadow',
    branch: 'main',
    query: 'first query',
    observedAt: '2026-10-29T00:15:00.000Z',
    report: report(),
  });
  const second = buildGraphRecallShadowRecord({
    projectId: 'github.com/example/graph-shadow',
    branch: 'main',
    query: 'second query',
    observedAt: '2026-10-29T00:16:00.000Z',
    report: report({
      authoritativeSelectedIds: ['claim-a'],
      falseNegativeIds: [],
      metrics: {
        ...report().metrics,
        authoritative_selected_count: 1,
        false_negative_count: 0,
        final_selection_recall: 1,
        exact_preservation: true,
      },
    }),
  });

  const recorded = store.record(first);
  assert.equal(recorded.status, 'recorded');
  assert.match(recorded.path, /graph-calibration[\\/][a-f0-9]{64}\.json$/);
  assert.equal(store.count(), 1);

  const existing = store.record(first);
  assert.equal(existing.status, 'existing');
  assert.equal(store.count(), 1);

  store.record(second);
  assert.equal(store.count(), 2);
  assert.deepEqual(
    store.list().map((item) => item.observation_id),
    [first.observation_id, second.observation_id].sort(),
  );

  const persisted = await readFile(recorded.path, 'utf8');
  assert.equal(persisted.includes('first query'), false);
  assert.equal(persisted.includes('claim-a'), false);

  const conflict = structuredClone(first);
  conflict.metrics.local_duration_ms = 999;
  await assert.rejects(
    async () => store.record(conflict),
    (error) => error?.code === 'GRAPH_RECALL_SHADOW_CONFLICT',
  );
  assert.equal(store.count(), 2);
});
