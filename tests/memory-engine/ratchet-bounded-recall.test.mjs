import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRecallCase } from '../memory-ratchet/adapter-contract.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { HybridMemoryRetriever } from '../../memory-engine/hybrid-retrieval.mjs';

test('M14 keeps bounded recall relevant under 2000 distractors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m14-'));
  const result = await runRecallCase(createReferenceMemoryAdapter(), 'M14', root);

  const targetIndex = result.raw_recall.items.findIndex(
    (item) => item.claim.id === 'claim:EV-A-POSTGRES-DECISION',
  );

  assert.ok(targetIndex >= 0, 'target decision must be recalled');
  assert.ok(targetIndex < 5, 'target decision must appear in the top five');
  assert.ok(result.raw_recall.items.length <= 10, 'recall must return at most 10 items');
  assert.ok(result.metrics.memory_items_returned <= 10, 'runner must observe at most 10 memory items');
  assert.ok(
    result.metrics.recall_payload_bytes <= 16_384,
    `raw recall payload exceeded 16 KiB: ${result.metrics.recall_payload_bytes} bytes`,
  );
});


test('hybrid recall keeps paraphrase retrieval bounded with a deterministic semantic provider', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m14-hybrid-'));
  const engine = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  t.after(() => engine.close());

  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });

  const ingest = ({ evidenceId, claimId, content, value, createdAt }) => {
    engine.ingest({
      evidence: {
        id: evidenceId,
        projectId: 'project-a',
        harness: 'codex',
        sessionId: evidenceId,
        sourceKind: 'session',
        sourceRef: `session:${evidenceId}`,
        capturedAt: createdAt,
        branch: 'main',
        commitSha: null,
        path: null,
        blobOid: null,
        content,
        authorityClass: 'user_direct',
        metadata: {},
      },
      claim: {
        id: claimId,
        kind: 'decision',
        subject: 'database',
        predicate: 'uses',
        value,
        branchScope: 'main',
        createdAt,
      },
    });
  };

  ingest({
    evidenceId: 'e-hybrid-postgres',
    claimId: 'c-hybrid-postgres',
    content: 'Use Postgres for concurrent writers.',
    value: 'Postgres',
    createdAt: '2026-01-02T09:00:00Z',
  });
  for (let index = 0; index < 20; index += 1) {
    ingest({
      evidenceId: `e-hybrid-distractor-${index}`,
      claimId: `c-hybrid-distractor-${index}`,
      content: `Unrelated build preference number ${index}.`,
      value: `build-${index}`,
      createdAt: `2026-01-02T09:${String(index + 10).padStart(2, '0')}:00Z`,
    });
  }

  const embedder = {
    modelId: 'fake-multilingual-e5',
    modelRevision: 'fixture-1',
    dimensions: 2,
    async embedQuery(text) {
      assert.ok(
        /multiple processes writing|paralleler Schreibzugriffe/i.test(text),
        'fixture query must be a lexical-light paraphrase',
      );
      return new Float32Array([1, 0]);
    },
    async embedPassages(texts) {
      return texts.map((text) => (
        /Postgres for concurrent writers/i.test(text)
          ? new Float32Array([1, 0])
          : new Float32Array([0, 1])
      ));
    },
  };

  const hybrid = new HybridMemoryRetriever({ memory: engine, embedder });
  assert.deepEqual(
    await hybrid.rebuildSemanticIndex({ projectId: 'project-a', branch: 'main' }),
    { indexed: 21, failed: 0 },
  );

  for (const query of [
    'Which storage engine did we choose to handle multiple processes writing at once?',
    'Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?',
  ]) {
    const result = await hybrid.recall({
      projectId: 'project-a',
      branch: 'main',
      query,
      maxItems: 10,
      maxSerializedBytes: 16_384,
    });
    const targetIndex = result.items.findIndex(
      (item) => item.claim.id === 'c-hybrid-postgres',
    );

    assert.ok(targetIndex >= 0, `Postgres must be recalled for: ${query}`);
    assert.ok(targetIndex < 5, `Postgres must be top five for: ${query}`);
    assert.ok(result.items.length <= 10);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 16_384);
  }
});
