import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { memoryEvidenceReviewSnapshot } from '../../memory-engine/evidence-bound-review-readonly.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import { createMemoryUiServer } from '../../scripts/memory-ui.mjs';

const projectId = 'github.com/example/evidence-review';

function withDb(run) {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-evidence-review-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    const evidence = memory.recordEvidence({
      id: 'e-review',
      projectId,
      harness: 'codex',
      sessionId: 'fixture',
      sourceKind: 'session',
      sourceRef: 'session:fixture',
      capturedAt: '2026-11-14T06:51:00.000Z',
      branch: 'preview',
      content: 'Agent Hub itself targets Windows x64 only.',
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    });
    run({ root, dbPath, memory, evidence });
  } finally {
    memory.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function seedProposal(dbPath) {
  const store = new EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity() { return { containsSecret: false }; },
  });
  const canonicalFact = 'Agent Hub itself targets Windows x64 only.';
  const proposal = store.record({
    id: 'evidence-proposal-1',
    projectId,
    branch: 'preview',
    kind: 'knowledge',
    canonicalFact,
    evidenceIds: ['e-review'],
    fingerprint: evidenceExtractionFingerprint({
      kind: 'knowledge',
      canonicalFact,
    }),
    policyVersion: 'test-extraction',
    evaluatorId: 'test-judge',
    createdAt: '2026-11-14T06:51:53.221Z',
  });
  store.close();
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('UPDATE memory_evidence_proposals SET status = ? WHERE id = ?')
      .run('needs_confirmation', proposal.id);
  } finally {
    db.close();
  }
  return proposal;
}

test('legacy Memory databases expose an unavailable review queue without schema writes', () => {
  withDb(({ dbPath }) => {
    assert.deepEqual(memoryEvidenceReviewSnapshot({
      dbPath, projectId, branch: 'preview',
    }), {
      status: 'not_configured', total: 0, truncated: false, items: [],
    });
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='memory_evidence_proposals'",
      ).get().n, 0);
    } finally {
      db.close();
    }
  });
});

test('evidence-bound review lists only same-project same-branch confirmation proposals', () => {
  withDb(({ dbPath }) => {
    seedProposal(dbPath);
    const review = memoryEvidenceReviewSnapshot({
      dbPath, projectId, branch: 'preview',
    });
    assert.equal(review.status, 'ready');
    assert.equal(review.total, 1);
    assert.equal(review.items.length, 1);
    assert.match(review.items[0].ref, /^E~[a-f0-9]{10}$/);
    assert.equal(review.items[0].value, 'Agent Hub itself targets Windows x64 only.');
    assert.equal(review.items[0].kind, 'knowledge');
    assert.deepEqual(review.items[0].authorities, ['user_direct']);
    assert.equal(review.items[0].sourceCount, 1);
    assert.equal('evidence_ids' in review.items[0], false);
    assert.equal('vector' in review.items[0], false);
    assert.deepEqual(memoryEvidenceReviewSnapshot({
      dbPath, projectId, branch: 'main',
    }).items, []);
    assert.deepEqual(memoryEvidenceReviewSnapshot({
      dbPath, projectId: 'github.com/other/repo', branch: 'preview',
    }).items, []);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare(
        "SELECT status FROM memory_evidence_proposals WHERE id = 'evidence-proposal-1'",
      ).get().status, 'needs_confirmation');
    } finally {
      db.close();
    }
  });
});

test('Memory Console GET /api/scope includes read-only evidence-bound review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-evidence-review-http-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let server;
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    memory.recordEvidence({
      id: 'e-review',
      projectId,
      harness: 'codex',
      sessionId: 'fixture',
      sourceKind: 'session',
      sourceRef: 'session:fixture',
      capturedAt: '2026-11-14T06:51:00.000Z',
      branch: 'preview',
      content: 'Agent Hub itself targets Windows x64 only.',
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    });
    seedProposal(dbPath);
    const runtime = createMemoryUiServer({ dbPath, memory, includeRuntimeHealth: false });
    server = runtime.server;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = 'http://127.0.0.1:' + port
      + '/api/scope?projectId=' + encodeURIComponent(projectId) + '&branch=preview';
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.evidenceBoundReview.total, 1);
    assert.equal(payload.evidenceBoundReview.items[0].kind, 'knowledge');
    const disallowed = await fetch(url.replace('branch=preview', 'branch=main'));
    assert.equal(disallowed.status, 500);
    assert.equal((await disallowed.json()).error, 'memory_console_error');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    memory.close();
    rmSync(root, { recursive: true, force: true });
  }
});
