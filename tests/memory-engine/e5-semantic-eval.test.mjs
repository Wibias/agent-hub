import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { HybridMemoryRetriever } from '../../memory-engine/hybrid-retrieval.mjs';
import {
  createE5Embedder,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from '../../memory-engine/e5-embedder.mjs';

const cacheDir = process.env.MEMORY_E5_MODEL_CACHE;

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function rankOf(ids, targetId) {
  const index = ids.indexOf(targetId);
  return index < 0 ? null : index + 1;
}

function ingestClaim(engine, {
  evidenceId,
  claimId,
  subject,
  predicate,
  value,
  content,
  createdAt,
  supersedes = [],
}) {
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
      subject,
      predicate,
      value,
      branchScope: 'main',
      createdAt,
    },
    lifecycle: supersedes.length > 0 ? { supersedes } : undefined,
  });
}

test(
  'real pinned E5 improves bounded semantic retrieval for required paraphrases',
  { skip: !cacheDir },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'memory-engine-e5-eval-'));
    const engine = new MemoryEngine({
      dbPath: join(root, 'memory.sqlite3'),
      clock: () => '2026-01-02T12:00:00Z',
    });
    t.after(() => engine.close());

    engine.registerProject({
      projectId: 'project-a',
      repoIdentity: 'project-a',
    });

    ingestClaim(engine, {
      evidenceId: 'e-sqlite',
      claimId: 'c-sqlite',
      subject: 'database',
      predicate: 'uses',
      value: 'SQLite',
      content: 'Accept SQLite for the initial local storage implementation.',
      createdAt: '2026-01-02T09:00:00Z',
    });

    ingestClaim(engine, {
      evidenceId: 'e-postgres',
      claimId: 'c-postgres',
      subject: 'database',
      predicate: 'uses',
      value: 'Postgres',
      content: 'Supersede SQLite. Use Postgres because concurrent writers are required.',
      createdAt: '2026-01-02T09:10:00Z',
      supersedes: ['c-sqlite'],
    });

    ingestClaim(engine, {
      evidenceId: 'e-audit',
      claimId: 'c-audit',
      subject: 'audit_logs',
      predicate: 'retention',
      value: '30 days',
      content: 'Keep audit logs for 30 days.',
      createdAt: '2026-01-02T09:20:00Z',
    });

    ingestClaim(engine, {
      evidenceId: 'e-retry',
      claimId: 'c-retry',
      subject: 'request_retry',
      predicate: 'max_attempts',
      value: '3',
      content: 'Retry failed requests 3 times before surfacing the error.',
      createdAt: '2026-01-02T09:30:00Z',
    });

    for (let index = 0; index < 32; index += 1) {
      ingestClaim(engine, {
        evidenceId: `e-distractor-${index}`,
        claimId: `c-distractor-${index}`,
        subject: `build_preference_${index}`,
        predicate: 'value',
        value: `choice-${index}`,
        content: `Unrelated build preference number ${index} for fixture noise.`,
        createdAt: `2026-01-02T10:${String(index).padStart(2, '0')}:00Z`,
      });
    }

    const embedder = await createE5Embedder({ cacheDir });
    assert.equal(embedder.modelId, E5_MODEL_ID);
    assert.equal(embedder.modelRevision, E5_MODEL_REVISION);

    const hybrid = new HybridMemoryRetriever({ memory: engine, embedder });
    const rebuild = await hybrid.rebuildSemanticIndex({
      projectId: 'project-a',
      branch: 'main',
    });
    assert.deepEqual(rebuild, { indexed: 36, failed: 0 });

    const cases = [
      {
        query: 'Which database was selected because concurrent writers are required?',
        targetClaimId: 'c-postgres',
      },
      {
        query: 'Which storage engine did we choose to handle multiple processes writing at once?',
        targetClaimId: 'c-postgres',
      },
      {
        query: 'Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?',
        targetClaimId: 'c-postgres',
      },
      {
        query: 'For how long do we preserve security event records?',
        targetClaimId: 'c-audit',
      },
    ];

    for (const entry of cases) {
      const lexical = engine.recall({
        projectId: 'project-a',
        branch: 'main',
        query: entry.query,
        mode: 'current',
        limit: 32,
      });
      const lexicalIds = lexical.items.map((item) => item.claim.id);

      const queryVector = await embedder.embedQuery(entry.query);
      const semanticIds = engine.semanticCandidates({
        projectId: 'project-a',
        branch: 'main',
        mode: 'current',
        modelId: embedder.modelId,
        modelRevision: embedder.modelRevision,
      })
        .filter((candidate) => candidate.dimensions === queryVector.length)
        .map((candidate) => ({
          ...candidate,
          similarity: candidate.vector.reduce(
            (score, value, index) => score + (value * queryVector[index]),
            0,
          ),
        }))
        .sort((left, right) => (
          (right.similarity - left.similarity)
          || compareCodePoints(right.created_at, left.created_at)
          || compareCodePoints(left.claim_id, right.claim_id)
        ))
        .slice(0, 32)
        .map((candidate) => candidate.claim_id);

      const fused = await hybrid.recall({
        projectId: 'project-a',
        branch: 'main',
        query: entry.query,
        mode: 'current',
        maxItems: 10,
        maxSerializedBytes: 16_384,
      });
      const fusedIds = fused.items.map((item) => item.claim.id);

      const evidence = {
        query: entry.query,
        target_claim_id: entry.targetClaimId,
        lexical_rank: rankOf(lexicalIds, entry.targetClaimId),
        semantic_rank: rankOf(semanticIds, entry.targetClaimId),
        fused_rank: rankOf(fusedIds, entry.targetClaimId),
      };
      console.log(JSON.stringify(evidence));

      assert.notEqual(
        evidence.fused_rank,
        null,
        `target must be recalled for: ${entry.query}`,
      );
      assert.ok(
        evidence.fused_rank <= 5,
        `target must rank top five for: ${entry.query}`,
      );
      assert.ok(fused.items.length <= 10);
      assert.ok(
        Buffer.byteLength(JSON.stringify(fused), 'utf8') <= 16_384,
        `hybrid result exceeded 16 KiB for: ${entry.query}`,
      );
    }
  },
);
