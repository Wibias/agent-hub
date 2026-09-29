import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  decodeFloat32Vector,
  encodeFloat32Vector,
  hashEmbeddingText,
} from '../../memory-engine/semantic-vectors.mjs';

async function createEngine(name) {
  const root = await mkdtemp(join(tmpdir(), `memory-engine-semantic-${name}-`));
  return new MemoryEngine({
    dbPath: join(root, 'memory.sqlite3'),
    clock: () => '2026-01-02T12:00:00Z',
  });
}

function seedClaim(engine) {
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  engine.ingest({
    evidence: {
      id: 'e-postgres',
      projectId: 'project-a',
      harness: 'codex',
      sessionId: 'session-1',
      sourceKind: 'session',
      sourceRef: 'session:session-1',
      capturedAt: '2026-01-02T09:00:00Z',
      branch: 'main',
      commitSha: null,
      path: null,
      blobOid: null,
      content: 'Use Postgres for concurrent writers.',
      authorityClass: 'user_direct',
      metadata: { fixture: true },
    },
    claim: {
      id: 'c-postgres',
      kind: 'decision',
      subject: 'database',
      predicate: 'uses',
      value: 'Postgres',
      branchScope: 'main',
      createdAt: '2026-01-02T09:00:00Z',
    },
  });
}

test('semantic vector codec round-trips little-endian Float32 and hashes passage text', () => {
  const vector = new Float32Array([0.25, -0.5, 1]);
  const blob = encodeFloat32Vector(vector);

  assert.ok(Buffer.isBuffer(blob));
  assert.deepEqual([...decodeFloat32Vector(blob, 3)], [...vector]);
  assert.equal(
    hashEmbeddingText('passage: hello'),
    'eead569eadac2fcb1eecc8b0cde37ec2ce764617516e70d0aa7a91de7e623f8a',
  );
});

test('semantic vector codec fails closed on invalid vectors and dimensions', () => {
  assert.throws(() => encodeFloat32Vector([1, 2]), /Float32Array/i);
  assert.throws(() => encodeFloat32Vector(new Float32Array()), /empty|length/i);
  assert.throws(
    () => encodeFloat32Vector(new Float32Array([1, Number.NaN])),
    /finite/i,
  );
  assert.throws(
    () => encodeFloat32Vector(new Float32Array([1, Number.POSITIVE_INFINITY])),
    /finite/i,
  );

  const blob = Buffer.alloc(12);
  assert.throws(() => decodeFloat32Vector(blob, 2), /dimension|length/i);
  assert.throws(() => decodeFloat32Vector(Buffer.alloc(5), 1), /byte|length/i);
});

test('semantic vectors are keyed by exact claim model and revision identity', async (t) => {
  const engine = await createEngine('identity');
  t.after(() => engine.close());
  seedClaim(engine);

  const textHash = hashEmbeddingText('passage: decision database uses Postgres');
  const vector1 = new Float32Array([0.25, 0.5, 0.75]);
  const vector2 = new Float32Array([0.75, 0.5, 0.25]);

  const stored = engine.putClaimEmbedding({
    claimId: 'c-postgres',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    textHash,
    dimensions: 3,
    vector: vector1,
    indexedAt: '2026-01-02T10:00:00Z',
  });
  engine.putClaimEmbedding({
    claimId: 'c-postgres',
    modelId: 'fake-e5',
    modelRevision: 'rev-2',
    textHash,
    dimensions: 3,
    vector: vector2,
    indexedAt: '2026-01-02T10:01:00Z',
  });

  assert.equal(stored.claim_id, 'c-postgres');
  assert.equal(stored.model_id, 'fake-e5');
  assert.equal(stored.model_revision, 'rev-1');
  assert.equal(stored.text_hash, textHash);
  assert.equal(stored.dimensions, 3);
  assert.equal(stored.indexed_at, '2026-01-02T10:00:00Z');
  assert.deepEqual([...stored.vector], [...vector1]);

  assert.deepEqual(
    [...engine.getClaimEmbedding({
      claimId: 'c-postgres',
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
    }).vector],
    [...vector1],
  );
  assert.deepEqual(
    [...engine.getClaimEmbedding({
      claimId: 'c-postgres',
      modelId: 'fake-e5',
      modelRevision: 'rev-2',
    }).vector],
    [...vector2],
  );
});

test('semantic vector storage validates claim identity hash and dimensions', async (t) => {
  const engine = await createEngine('validation');
  t.after(() => engine.close());
  seedClaim(engine);

  const base = {
    claimId: 'c-postgres',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    textHash: hashEmbeddingText('passage: postgres'),
    dimensions: 3,
    vector: new Float32Array([0.25, 0.5, 0.75]),
  };

  assert.throws(
    () => engine.putClaimEmbedding({ ...base, dimensions: 2 }),
    /dimension/i,
  );
  assert.throws(
    () => engine.putClaimEmbedding({ ...base, textHash: 'not-a-sha256' }),
    /sha-256|text hash/i,
  );
  assert.throws(
    () => engine.putClaimEmbedding({ ...base, claimId: 'c-missing' }),
    /unknown claim/i,
  );
});

test('semantic vectors are derived state excluded from canonical export and cleared explicitly', async (t) => {
  const source = await createEngine('derived-source');
  const target = await createEngine('derived-target');
  t.after(() => source.close());
  t.after(() => target.close());
  seedClaim(source);

  source.putClaimEmbedding({
    claimId: 'c-postgres',
    modelId: 'fake-e5',
    modelRevision: 'rev-1',
    textHash: hashEmbeddingText('passage: postgres'),
    dimensions: 3,
    vector: new Float32Array([0.25, 0.5, 0.75]),
  });

  const exported = source.exportCanonical();
  assert.equal(Object.hasOwn(exported, 'claim_embeddings'), false);

  target.importCanonical(exported);
  assert.equal(
    target.getClaimEmbedding({
      claimId: 'c-postgres',
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
    }),
    null,
  );

  source.clearDerivedState();
  assert.equal(
    source.getClaimEmbedding({
      claimId: 'c-postgres',
      modelId: 'fake-e5',
      modelRevision: 'rev-1',
    }),
    null,
  );
});
