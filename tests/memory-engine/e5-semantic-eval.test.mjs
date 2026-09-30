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
import {
  summarizeRecallQuality,
  sweepSemanticThresholds,
} from '../../memory-engine/recall-quality-eval.mjs';

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
  'real pinned E5 reports positive recall quality and negative-query noise',
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

    const positiveCases = [
      {
        id: 'postgres-concurrent-writers',
        query: 'Which database was selected because concurrent writers are required?',
        targetClaimId: 'c-postgres',
      },
      {
        id: 'postgres-storage-engine-paraphrase',
        query: 'Which storage engine did we choose to handle multiple processes writing at once?',
        targetClaimId: 'c-postgres',
      },
      {
        id: 'postgres-german-paraphrase',
        query: 'Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt?',
        targetClaimId: 'c-postgres',
      },
      {
        id: 'postgres-replaced-sqlite',
        query: 'Which active database replaced SQLite?',
        targetClaimId: 'c-postgres',
      },
      {
        id: 'postgres-simultaneous-writes',
        query: 'Was Postgres chosen to support simultaneous writes?',
        targetClaimId: 'c-postgres',
      },
      {
        id: 'audit-retention-paraphrase',
        query: 'For how long do we preserve security event records?',
        targetClaimId: 'c-audit',
      },
      {
        id: 'audit-retention-direct',
        query: 'What is the retention period for audit logs?',
        targetClaimId: 'c-audit',
      },
      {
        id: 'audit-retention-german',
        query: 'Wie lange speichern wir Audit-Logs?',
        targetClaimId: 'c-audit',
      },
      {
        id: 'retry-failed-request-count',
        query: 'How many times do we retry a failed request before surfacing the error?',
        targetClaimId: 'c-retry',
      },
      {
        id: 'retry-failed-request-german',
        query: 'Wie viele Versuche machen wir bei fehlgeschlagenen Requests, bevor der Fehler angezeigt wird?',
        targetClaimId: 'c-retry',
      },
    ];

    const negativeCases = [
      {
        id: 'negative-marketing-color',
        query: 'What color should the marketing homepage hero use?',
      },
      {
        id: 'negative-company-offsite',
        query: 'Which city hosts the next company offsite?',
      },
      {
        id: 'negative-billing-owner',
        query: 'Who owns the corporate billing account?',
      },
      {
        id: 'negative-mobile-bundle',
        query: 'What is the mobile application bundle identifier?',
      },
      {
        id: 'negative-gpu',
        query: 'Which GPU model is installed in the inference server?',
      },
      {
        id: 'negative-support-phone',
        query: 'What is the customer support phone number?',
      },
      {
        id: 'negative-office-wifi',
        query: 'What is the office Wi-Fi network name?',
      },
      {
        id: 'negative-vacation-policy',
        query: 'How many paid vacation days do employees receive?',
      },
      {
        id: 'hard-negative-database-analytics',
        query: 'Which database do we use for analytics workloads?',
      },
      {
        id: 'hard-negative-storage-read-replicas',
        query: 'Which storage engine is used for read replicas?',
      },
      {
        id: 'hard-negative-build-log-retention',
        query: 'How long do we retain build logs?',
      },
      {
        id: 'hard-negative-backup-retention',
        query: 'How long are database backups retained?',
      },
      {
        id: 'hard-negative-migration-retries',
        query: 'How many times do failed database migrations retry?',
      },
      {
        id: 'hard-negative-login-attempts',
        query: 'How many login attempts are allowed before account lockout?',
      },
      {
        id: 'hard-negative-audit-database',
        query: 'Which database stores the audit logs?',
      },
      {
        id: 'hard-negative-websocket-retries',
        query: 'How many retries do WebSocket reconnects use?',
      },
      {
        id: 'hard-negative-sqlite-cache',
        query: 'Do we use SQLite for the local cache?',
      },
      {
        id: 'hard-negative-request-log-retention',
        query: 'What is the retention period for request logs?',
      },
    ];

    const qualityCases = [];

    for (const entry of [...positiveCases, ...negativeCases]) {
      const lexical = engine.recall({
        projectId: 'project-a',
        branch: 'main',
        query: entry.query,
        mode: 'current',
        limit: 32,
      });
      const lexicalIds = lexical.items.map((item) => item.claim.id);

      const queryVector = await embedder.embedQuery(entry.query);
      const semanticCandidates = engine.semanticCandidates({
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
        .slice(0, 32);

      const semanticIds = semanticCandidates.map(
        (candidate) => candidate.claim_id,
      );

      const fused = await hybrid.recall({
        projectId: 'project-a',
        branch: 'main',
        query: entry.query,
        mode: 'current',
        maxItems: 10,
        maxSerializedBytes: 16_384,
      });
      const fusedIds = fused.items.map((item) => item.claim.id);

      qualityCases.push({
        id: entry.id,
        relevantClaimIds: entry.targetClaimId ? [entry.targetClaimId] : [],
        rankings: {
          lexical: lexicalIds,
          semantic: semanticIds,
          fused: fusedIds,
        },
        semanticCandidates: semanticCandidates.map((candidate) => ({
          claimId: candidate.claim_id,
          similarity: candidate.similarity,
        })),
      });

      const targetCandidate = entry.targetClaimId
        ? semanticCandidates.find(
          (candidate) => candidate.claim_id === entry.targetClaimId,
        )
        : null;
      const bestIrrelevant = entry.targetClaimId
        ? semanticCandidates.find(
          (candidate) => candidate.claim_id !== entry.targetClaimId,
        )
        : null;
      const semanticTop1 = semanticCandidates[0] ?? null;
      const semanticTop2 = semanticCandidates[1] ?? null;

      const evidence = {
        type: entry.targetClaimId ? 'positive_case' : 'negative_case',
        id: entry.id,
        query: entry.query,
        target_claim_id: entry.targetClaimId ?? null,
        lexical_rank: entry.targetClaimId
          ? rankOf(lexicalIds, entry.targetClaimId)
          : null,
        semantic_rank: entry.targetClaimId
          ? rankOf(semanticIds, entry.targetClaimId)
          : null,
        fused_rank: entry.targetClaimId
          ? rankOf(fusedIds, entry.targetClaimId)
          : null,
        semantic_top1_similarity: semanticTop1?.similarity ?? null,
        semantic_top2_similarity: semanticTop2?.similarity ?? null,
        semantic_top1_margin: (
          semanticTop1 && semanticTop2
            ? semanticTop1.similarity - semanticTop2.similarity
            : null
        ),
        target_similarity: targetCandidate?.similarity ?? null,
        target_margin_over_best_irrelevant: (
          targetCandidate && bestIrrelevant
            ? targetCandidate.similarity - bestIrrelevant.similarity
            : null
        ),
        fused_count: fusedIds.length,
      };
      console.log(JSON.stringify(evidence));

      if (entry.targetClaimId) {
        assert.notEqual(
          evidence.fused_rank,
          null,
          `target must be recalled for: ${entry.query}`,
        );
        assert.ok(
          evidence.fused_rank <= 5,
          `target must rank top five for: ${entry.query}`,
        );
      }

      assert.ok(fused.items.length <= 10);
      assert.ok(
        Buffer.byteLength(JSON.stringify(fused), 'utf8') <= 16_384,
        `hybrid result exceeded 16 KiB for: ${entry.query}`,
      );
    }

    const summary = summarizeRecallQuality(qualityCases, {
      kValues: [1, 5, 10],
    });
    const thresholdSweep = sweepSemanticThresholds(qualityCases, {
      thresholds: [
        0.74,
        0.75,
        0.76,
        0.77,
        0.78,
        0.7825,
        0.785,
        0.7875,
        0.79,
        0.7925,
        0.795,
        0.7975,
        0.80,
        0.8025,
        0.805,
        0.81,
        0.82,
        0.85,
      ],
      k: 5,
    });

    console.log(JSON.stringify({
      type: 'recall_quality_summary',
      model_id: embedder.modelId,
      model_revision: embedder.modelRevision,
      summary,
      semantic_threshold_sweep_at_5: thresholdSweep,
    }));

    assert.deepEqual(summary.counts, {
      queries: 28,
      positiveQueries: 10,
      negativeQueries: 18,
    });
    assert.equal(summary.routes.fused.hitRateAtK[5], 1);
    assert.equal(summary.routes.fused.falseNegativeRateAtK[5], 0);
    assert.equal(thresholdSweep.length, 18);
  },
);
