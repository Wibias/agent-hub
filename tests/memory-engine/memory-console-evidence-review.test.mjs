import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { memoryEvidenceReviewSnapshot } from '../../memory-engine/evidence-bound-review-readonly.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { installEvidenceBoundReviewIntentSchema } from '../../memory-engine/evidence-bound-review-intent-staging.mjs';
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

test('optional intent audit is visible as unapproved, without changing the review queue', () => {
  withDb(({ dbPath, memory }) => {
    seedProposal(dbPath);
    memory.recordEvidence({
      id: 'e-intent',
      projectId,
      harness: 'codex',
      sessionId: 'fixture-intent',
      sourceKind: 'session',
      sourceRef: 'session:fixture-intent',
      capturedAt: '2026-11-14T08:02:00.000Z',
      branch: 'preview',
      content: 'Synthetic exact review intent',
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    });
    const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    try {
      installEvidenceBoundReviewIntentSchema(db);
      db.prepare(
        'INSERT INTO memory_evidence_bound_review_intents '
        + '(proposal_id,decision_evidence_id,project_id,branch,revision_sha,proposal_ref,'
        + 'snapshot_sha256,canonical_fact_sha256,decision,policy_version,recorded_at,status) '
        + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        'evidence-proposal-1', 'e-intent', projectId, 'preview',
        'a'.repeat(40), 'E~1234567890', 'b'.repeat(64), 'c'.repeat(64),
        'reject', 'evidence-bound-review-intent-v1',
        '2026-11-14T08:03:00.000Z', 'awaiting_independent_host_authorization',
      );
      const review = memoryEvidenceReviewSnapshot({ dbPath, projectId, branch: 'preview' });
      assert.equal(review.status, 'ready');
      assert.equal(review.total, 1);
      assert.equal(review.items.length, 1);
      assert.deepEqual(review.items[0].reviewIntent, {
        decision: 'reject',
        status: 'awaiting_independent_host_authorization',
        recordedAt: '2026-11-14T08:03:00.000Z',
        humanApprovalVerified: false,
        claimsModified: false,
      });
      assert.equal(review.items[0].status, 'needs_confirmation');
      assert.equal(memoryEvidenceReviewSnapshot({
        dbPath, projectId, branch: 'main',
      }).items.length, 0);
      assert.equal(db.prepare(
        "SELECT status FROM memory_evidence_proposals WHERE id = 'evidence-proposal-1'",
      ).get().status, 'needs_confirmation');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0);
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

test('Console E~ preflight uses only server-approved exact Git revision and never grants write authority', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-evidence-preflight-http-'));
  const repoRoot = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  mkdirSync(repoRoot);
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-b', 'preview');
  git('config', 'user.name', 'Preflight Test');
  git('config', 'user.email', 'preflight@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/example/evidence-review.git');
  writeFileSync(join(repoRoot, 'README.md'), 'Synthetic review fixture.\\n');
  git('add', 'README.md');
  git('commit', '-m', 'fixture');
  const revisionSha = git('rev-parse', 'HEAD');

  const memory = new MemoryEngine({ dbPath });
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    memory.close();
    rmSync(root, { recursive: true, force: true });
  });
  memory.registerProject({ projectId, repoIdentity: projectId });
  memory.recordEvidence({
    id: 'e-review', projectId,
    harness: 'codex', sessionId: 'fixture',
    sourceKind: 'session', sourceRef: 'session:fixture',
    capturedAt: '2026-11-14T06:51:00.000Z', branch: 'preview',
    content: 'Agent Hub itself targets Windows x64 only.',
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt' },
  });
  seedProposal(dbPath);

  const baseline = memory.exportCanonical();
  const ui = createMemoryUiServer({
    dbPath, memory, repositoryRoots: [repoRoot], includeRuntimeHealth: false,
  });
  server = ui.server;
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + server.address().port;
  const original = memoryEvidenceReviewSnapshot({ dbPath, projectId, branch: 'preview' });
  const selectedRef = original.items[0].ref;
  const url = base + '/api/review-preflight?projectId=' + encodeURIComponent(projectId)
    + '&branch=preview&proposalRef=' + encodeURIComponent(selectedRef);
  const response = await fetch(url + '&revisionSha=' + 'f'.repeat(40)
    + '&repoPath=/not/allowed&dbPath=/not/allowed');
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.type, 'agent_hub_evidence_bound_decision_preflight_v1');
  assert.equal(report.selectedRef, selectedRef);
  assert.equal(report.gitContext.status, 'verified');
  assert.equal(report.gitContext.revisionSha, revisionSha);
  assert.equal(report.scope.revisionSha, revisionSha);
  assert.ok(['requires_review', 'reviewable_no_write_authority'].includes(report.status));
  assert.equal(report.readOnly, true);
  assert.equal(report.promotionAllowed, false);
  assert.equal(report.hostUserOriginAuthenticated, false);
  assert.equal(report.decisionCommandEnabled, false);
  assert.equal(report.claimsCreated, 0);
  assert.equal(report.decisionsApplied, 0);
  assert.equal(report.writesToSource, false);
  assert.equal('canonicalFact' in report, false);
  assert.equal('repoPath' in report.gitContext, false);
  assert.doesNotMatch(JSON.stringify(report), /agent-hub-evidence-preflight-http-/);

  const malformed = await fetch(url.replace(encodeURIComponent(selectedRef), 'E~invalid'));
  assert.equal(malformed.status, 400);
  git('checkout', '-b', 'feature/wrong-branch');
  const changed = await (await fetch(url)).json();
  assert.equal(changed.status, 'git_context_unavailable');
  assert.equal(changed.gitContext.status, 'branch_mismatch');
  assert.equal(changed.promotionAllowed, false);
  assert.equal(changed.claimsCreated, 0);

  const unchanged = memoryEvidenceReviewSnapshot({ dbPath, projectId, branch: 'preview' });
  assert.equal(unchanged.total, 1);
  assert.equal(unchanged.items[0].status, 'needs_confirmation');
  assert.deepEqual(memory.exportCanonical(), baseline);
});

test('Console E~ preflight with no configured checkout stays read-only and does not invent a revision', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-evidence-preflight-unconfigured-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    memory.close();
    rmSync(root, { recursive: true, force: true });
  });
  memory.registerProject({ projectId, repoIdentity: projectId });
  memory.recordEvidence({
    id: 'e-review', projectId,
    harness: 'codex', sessionId: 'fixture',
    sourceKind: 'session', sourceRef: 'session:fixture',
    capturedAt: '2026-11-14T06:51:00.000Z', branch: 'preview',
    content: 'Agent Hub itself targets Windows x64 only.',
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt' },
  });
  seedProposal(dbPath);
  const ui = createMemoryUiServer({ dbPath, memory, includeRuntimeHealth: false });
  server = ui.server;
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const ref = memoryEvidenceReviewSnapshot({ dbPath, projectId, branch: 'preview' }).items[0].ref;
  const url = 'http://127.0.0.1:' + server.address().port
    + '/api/review-preflight?projectId=' + encodeURIComponent(projectId)
    + '&branch=preview&proposalRef=' + encodeURIComponent(ref);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, 'git_context_unavailable');
  assert.equal(data.gitContext.status, 'unconfigured');
  assert.equal(data.gitContext.revisionSha, null);
  assert.equal(data.promotionAllowed, false);
  assert.equal(data.hostUserOriginAuthenticated, false);
  assert.equal(data.claimsCreated, 0);
  assert.equal('reviewSnapshotSha256' in data, false);
});
