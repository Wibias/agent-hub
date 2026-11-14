import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { readGlobalCodexMemory } from '../../memory-engine/adapters/codex-global-memory-scope.mjs';
import {
  prepareApprovedMemoryWrite,
  commitApprovedMemoryWrite,
} from '../../memory-engine/adapters/codex-approved-memory-write.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import { createMemoryUiServer } from '../../scripts/memory-ui.mjs';

/**
 * Existing MVP baseline only:
 *  - project-scoped read;
 *  - evidence-bound review inbox, not an approval;
 *  - distinct same-user operator write PREVIEW, not protected service authority.
 * This test intentionally does not claim to implement protected E~ finalization.
 */
test('project read + evidence review + distinct operator preview remain isolated end-to-end', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-memory-mvp-'));
  const cwd = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  const scopeDir = join(root, 'scope');
  const scopePath = join(scopeDir, 'codex-memory-scopes.json');
  let server;
  let memory;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    memory?.close();
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(cwd);
  mkdirSync(scopeDir);
  execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, 'config', 'user.name', 'MVP Test']);
  execFileSync('git', ['-C', cwd, 'config', 'user.email', 'mvp@example.test']);
  execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin',
    'https://github.com/example/memory-mvp.git']);
  writeFileSync(join(cwd, 'README.md'), '# isolated test\n');
  execFileSync('git', ['-C', cwd, 'add', 'README.md']);
  execFileSync('git', ['-C', cwd, 'commit', '-m', 'fixture'], { stdio: 'ignore' });

  const projectId = 'github.com/example/memory-mvp';
  memory = new MemoryEngine({ dbPath });
  memory.registerProject({ projectId, repoIdentity: projectId, canonicalRemote: projectId });
  memory.recordEvidence({
    id: 'evidence-mvp-proposal', projectId,
    harness: 'codex', sessionId: 'mvp-fixture',
    sourceKind: 'session', sourceRef: 'session:mvp-fixture',
    capturedAt: '2026-11-14T08:00:00Z', branch: 'main',
    content: 'Proposal only: Use SQLite for the MVP.',
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt' },
  });
  const fact = 'Proposal only: Use SQLite for the MVP.';
  const store = new EvidenceBoundProposalStore({
    dbPath,
    inspectTextSensitivity: () => ({ containsSecret: false }),
  });
  const proposal = store.record({
    id: 'mvp-evidence-proposal', projectId, branch: 'main',
    kind: 'knowledge', canonicalFact: fact, evidenceIds: ['evidence-mvp-proposal'],
    fingerprint: evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact: fact }),
    policyVersion: 'mvp-smoke', evaluatorId: 'synthetic-test',
    createdAt: '2026-11-14T08:01:00Z',
  });
  store.close();

  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('UPDATE memory_evidence_proposals SET status=? WHERE id=?')
      .run('needs_confirmation', proposal.id);
  } finally {
    db.close();
  }

  writeFileSync(scopePath, JSON.stringify({
    schema: 1, memory_db: dbPath,
    projects: [{ root: cwd, project_id: projectId, repo_identity: projectId }],
  }));
  const firstRead = readGlobalCodexMemory({
    cwd, query: 'SQLite for the MVP', scopePath,
  });
  assert.notEqual(firstRead.status, 'found', 'an unapproved E~ proposal must not be recalled as a Claim');

  const ui = createMemoryUiServer({ dbPath, memory, includeRuntimeHealth: false });
  server = ui.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const scopeUrl = base + '/api/scope?projectId='
    + encodeURIComponent(projectId) + '&branch=main';
  const reviewResponse = await fetch(scopeUrl);
  assert.equal(reviewResponse.status, 200);
  const reviewScope = await reviewResponse.json();
  assert.equal(reviewScope.evidenceBoundReview.total, 1);
  assert.equal(reviewScope.evidenceBoundReview.items[0].id, proposal.id);
  assert.equal(reviewScope.evidenceBoundReview.items[0].value, fact);
  assert.equal(reviewScope.evidenceBoundReview.items[0].status, 'needs_confirmation');

  // There must be no HTTP "approve E~" shortcut; the existing legacy
  // candidate endpoints do not apply to evidence-bound proposals.
  const overview = await (await fetch(base + '/api/overview')).json();
  const forbiddenApproval = await fetch(base + '/api/actions/evidence-confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      'x-agent-hub-action-token': overview.actions.token,
    },
    body: JSON.stringify({ projectId, branch: 'main', proposalRef:
      reviewScope.evidenceBoundReview.items[0].ref }),
  });
  assert.equal(forbiddenApproval.status, 404);

  // Existing independent operator preview: the one-use approval is for a
  // DIFFERENT direct memory, not a promotion of the pending E~ proposal.
  const prepared = prepareApprovedMemoryWrite({
    cwd, scopePath, text: 'Operator preview: Prefer Node.js 24.', confirmed: true,
  });
  const committed = await commitApprovedMemoryWrite({
    cwd, scopePath, evidenceId: prepared.evidence_id,
  });
  assert.equal(committed.status, 'committed');
  assert.equal((await commitApprovedMemoryWrite({
    cwd, scopePath, evidenceId: prepared.evidence_id,
  })).status, 'approval_denied');

  const secondRead = readGlobalCodexMemory({
    cwd, query: 'Prefer Node.js 24', scopePath,
  });
  assert.equal(secondRead.status, 'found');
  assert.ok(secondRead.items.some((item) => item.claim.id === committed.claim_id));
  const readReviewAgain = await (await fetch(scopeUrl)).json();
  assert.equal(readReviewAgain.evidenceBoundReview.total, 1);
  assert.equal(readReviewAgain.evidenceBoundReview.items[0].status, 'needs_confirmation');

  const audit = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(audit.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 1);
    assert.equal(audit.prepare('SELECT status FROM memory_evidence_proposals WHERE id=?')
      .get(proposal.id).status, 'needs_confirmation');
  } finally {
    audit.close();
  }
});
