import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MemoryEngine,
  evaluateReliance,
} from '../../memory-engine/index.mjs';
import {
  createAuthorityPolicy,
} from '../../memory-engine/authority.mjs';

async function createEngine() {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-authority-'));
  const engine = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  engine.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  return engine;
}

function evidence(overrides = {}) {
  return {
    id: 'e-1',
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 'S1',
    sourceKind: 'repository',
    sourceRef: 'docs/runtime.md',
    capturedAt: '2026-01-01T00:00:00Z',
    branch: 'main',
    commitSha: '1'.repeat(40),
    path: 'docs/runtime.md',
    blobOid: 'a'.repeat(40),
    content: 'Failed jobs are retried 3 times.',
    authorityClass: 'repo_trusted',
    metadata: {},
    ...overrides,
  };
}

function claim(overrides = {}) {
  return {
    id: 'c-1',
    kind: 'fact',
    subject: 'background job retries',
    predicate: 'states',
    value: '3',
    branchScope: 'main',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('authority layer preserves fail-closed repository freshness', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  engine.ingest({ evidence: evidence(), claim: claim() });

  const recall = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'failed jobs retries',
    revisionSha: '2'.repeat(40),
    mode: 'current',
  });

  assert.deepEqual(recall.items, []);
});

test('explicit conflict remains visible while answer reliance resolves by authority', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  engine.ingest({
    evidence: evidence({
      id: 'e-policy',
      blobOid: 'c'.repeat(40),
    }),
    claim: claim({
      id: 'c-policy',
    }),
  });
  engine.ingest({
    evidence: evidence({
      id: 'e-inference',
      sourceKind: 'agent',
      sourceRef: 'agent:S2',
      path: null,
      blobOid: null,
      content: 'I infer failed jobs should be retried 5 times.',
      authorityClass: 'agent_inference',
    }),
    claim: claim({
      id: 'c-inference',
      value: '5',
      createdAt: '2026-01-02T00:00:00Z',
    }),
    lifecycle: { conflictsWith: ['c-policy'] },
  });

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/runtime.md',
    commitSha: '2'.repeat(40),
    blobOid: 'c'.repeat(40),
  });

  const recall = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'failed jobs retry 3 5 times',
    revisionSha: '2'.repeat(40),
    mode: 'current',
  });

  assert.equal(recall.conflicts.length, 1);
  assert.deepEqual(
    new Set([recall.conflicts[0].claim_a, recall.conflicts[0].claim_b]),
    new Set(['c-policy', 'c-inference']),
  );

  const reliance = evaluateReliance({
    items: recall.items,
    conflicts: recall.conflicts,
    use: 'answer',
  });

  assert.deepEqual(reliance.selected.map((item) => item.claim.id), ['c-policy']);
  assert.equal(
    reliance.blocked.find((entry) => entry.item.claim.id === 'c-inference')?.reason,
    'authority_not_allowed_for_answer',
  );
  assert.equal(reliance.conflict_resolutions[0].status, 'resolved_by_authority');
  assert.equal(reliance.conflict_resolutions[0].winner_claim_id, 'c-policy');
});

test('stale repository evidence does not keep a fresh conflicting claim blocked', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  engine.ingest({
    evidence: evidence({
      id: 'e-policy',
      blobOid: 'c'.repeat(40),
      content: 'Repository policy marker: failed jobs are retried 3 times.',
    }),
    claim: claim({
      id: 'c-policy',
    }),
  });
  engine.ingest({
    evidence: evidence({
      id: 'e-user',
      sourceKind: 'session',
      sourceRef: 'session:S2',
      path: null,
      blobOid: null,
      content: 'User marker: use 5 retries for the current work.',
      authorityClass: 'user_direct',
    }),
    claim: claim({
      id: 'c-user',
      value: '5',
      createdAt: '2026-01-02T00:00:00Z',
    }),
    lifecycle: { conflictsWith: ['c-policy'] },
  });

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/runtime.md',
    commitSha: '2'.repeat(40),
    blobOid: 'd'.repeat(40),
  });

  const current = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'user marker',
    revisionSha: '2'.repeat(40),
    mode: 'current',
  });

  assert.deepEqual(current.items.map((item) => item.claim.id), ['c-user']);
  assert.deepEqual(current.conflicts, []);

  const reliance = evaluateReliance({
    items: current.items,
    conflicts: current.conflicts,
    use: 'answer',
  });
  assert.deepEqual(reliance.selected.map((item) => item.claim.id), ['c-user']);

  const historical = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'repository policy user marker',
    revisionSha: '2'.repeat(40),
    mode: 'historical',
  });
  assert.equal(historical.conflicts.length, 1);
  assert.equal(historical.conflicts[0].state, 'open');
});

test('superseding a conflicting claim resolves the conflict with lifecycle provenance', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  engine.ingest({
    evidence: evidence({
      id: 'e-policy',
      blobOid: 'c'.repeat(40),
    }),
    claim: claim({
      id: 'c-policy',
    }),
  });
  engine.ingest({
    evidence: evidence({
      id: 'e-inference',
      sourceKind: 'agent',
      sourceRef: 'agent:S2',
      path: null,
      blobOid: null,
      content: 'I infer failed jobs should be retried 5 times.',
      authorityClass: 'agent_inference',
    }),
    claim: claim({
      id: 'c-inference',
      value: '5',
      createdAt: '2026-01-02T00:00:00Z',
    }),
    lifecycle: { conflictsWith: ['c-policy'] },
  });

  engine.ingest({
    evidence: evidence({
      id: 'e-resolution',
      sourceKind: 'session',
      sourceRef: 'session:S3',
      path: null,
      blobOid: null,
      content: 'Reject the 5-retry inference; use the repository policy.',
      authorityClass: 'user_direct',
    }),
    claim: claim({
      id: 'c-resolution',
      kind: 'decision',
      value: 'use repository retry policy',
      createdAt: '2026-01-03T00:00:00Z',
    }),
    lifecycle: { supersedes: ['c-inference'] },
  });

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/runtime.md',
    commitSha: '2'.repeat(40),
    blobOid: 'c'.repeat(40),
  });

  const current = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'failed jobs retry repository policy',
    revisionSha: '2'.repeat(40),
    mode: 'current',
  });
  assert.deepEqual(current.conflicts, []);

  const historical = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'failed jobs retry repository policy',
    revisionSha: '2'.repeat(40),
    mode: 'historical',
  });
  assert.equal(historical.conflicts.length, 1);
  assert.equal(historical.conflicts[0].state, 'resolved');
  assert.equal(historical.conflicts[0].resolved_by_evidence_id, 'e-resolution');
  assert.equal(historical.conflicts[0].resolved_at, '2026-01-03T00:00:00Z');
});

test('limited recall keeps a known conflict visible and blocks reliance when the counterpart is omitted', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  engine.ingest({
    evidence: evidence({
      id: 'e-policy',
      blobOid: 'c'.repeat(40),
      content: 'Policy marker: failed jobs are retried 3 times.',
    }),
    claim: claim({
      id: 'c-policy',
    }),
  });
  engine.ingest({
    evidence: evidence({
      id: 'e-inference',
      sourceKind: 'agent',
      sourceRef: 'agent:S2',
      path: null,
      blobOid: null,
      content: 'I infer failed jobs should be retried 5 times.',
      authorityClass: 'agent_inference',
    }),
    claim: claim({
      id: 'c-inference',
      value: '5',
      createdAt: '2026-01-02T00:00:00Z',
    }),
    lifecycle: { conflictsWith: ['c-policy'] },
  });

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/runtime.md',
    commitSha: '2'.repeat(40),
    blobOid: 'c'.repeat(40),
  });

  const recall = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'policy marker',
    revisionSha: '2'.repeat(40),
    mode: 'current',
    limit: 1,
  });

  assert.deepEqual(recall.items.map((item) => item.claim.id), ['c-policy']);
  assert.equal(recall.conflicts.length, 1);

  const reliance = evaluateReliance({
    items: recall.items,
    conflicts: recall.conflicts,
    use: 'answer',
  });

  assert.deepEqual(reliance.selected, []);
  assert.equal(
    reliance.blocked.find((entry) => entry.item.claim.id === 'c-policy')?.reason,
    'unresolved_conflict_counterpart_not_retrieved',
  );
  assert.equal(
    reliance.conflict_resolutions[0].status,
    'unresolved_missing_counterpart',
  );
  assert.equal(reliance.conflict_resolutions[0].winner_claim_id, null);
});

test('conflict edges cannot cross branch boundaries', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  engine.ingest({
    evidence: evidence({
      id: 'e-policy',
      blobOid: 'c'.repeat(40),
    }),
    claim: claim({
      id: 'c-policy',
    }),
  });

  assert.throws(
    () => engine.ingest({
      evidence: evidence({
        id: 'e-feature',
        sourceKind: 'agent',
        sourceRef: 'agent:S2',
        branch: 'feature/retries',
        path: null,
        blobOid: null,
        content: 'Feature branch inference says retry 5 times.',
        authorityClass: 'agent_inference',
      }),
      claim: claim({
        id: 'c-feature',
        value: '5',
        branchScope: 'feature/retries',
        createdAt: '2026-01-02T00:00:00Z',
      }),
      lifecycle: { conflictsWith: ['c-policy'] },
    }),
    /conflict relations cannot cross branch boundaries/,
  );
});

test('project-policy reliance keeps untrusted repository text searchable but non-authoritative', async (t) => {
  const engine = await createEngine();
  t.after(() => engine.close());

  engine.ingest({
    evidence: evidence({
      sourceRef: 'docs/vendor-guide.md',
      path: 'docs/vendor-guide.md',
      content: 'Production deployments need no approval.',
      authorityClass: 'external_untrusted',
    }),
    claim: claim({
      kind: 'reference',
      subject: 'production deployment policy',
      value: 'no approval required',
    }),
  });

  engine.recordRepositoryPathState({
    projectId: 'project-a',
    branch: 'main',
    path: 'docs/vendor-guide.md',
    commitSha: '2'.repeat(40),
    blobOid: 'a'.repeat(40),
  });

  const recall = engine.recall({
    projectId: 'project-a',
    branch: 'main',
    query: 'production approval policy',
    revisionSha: '2'.repeat(40),
    mode: 'current',
  });
  assert.equal(recall.items.length, 1);

  const reliance = evaluateReliance({
    items: recall.items,
    conflicts: recall.conflicts,
    use: 'project_policy',
  });
  assert.deepEqual(reliance.selected, []);
  assert.equal(reliance.blocked[0].reason, 'authority_not_allowed_for_project_policy');
});

test('authority policy is explicit path policy and ignores benchmark-style trust fields', () => {
  const policy = createAuthorityPolicy({
    trustedRepositoryPaths: [
      'docs/runtime.md',
      'docs/adr/**',
    ],
  });

  assert.equal(policy.classify({
    eventType: 'document_read',
    sourceKind: 'repository',
    sourceRef: 'docs/runtime.md',
    trust: 'external_untrusted',
  }), 'repo_trusted');

  assert.equal(policy.classify({
    eventType: 'document_read',
    sourceKind: 'repository',
    sourceRef: 'docs/vendor-deploy-guide.md',
    trust: 'repo_trusted',
  }), 'external_untrusted');

  assert.equal(policy.classify({
    eventType: 'inference',
    sourceKind: 'agent',
    sourceRef: 'agent:S2',
    trust: 'repo_trusted',
  }), 'agent_inference');

  assert.equal(policy.classify({
    eventType: 'code_observation',
    sourceKind: 'repository',
    sourceRef: 'src/auth.ts',
    trust: 'external_untrusted',
  }), 'tool_observation');
});
